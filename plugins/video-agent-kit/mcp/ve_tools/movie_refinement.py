"""Selected production boundaries, separate from immutable observation indexes."""
from __future__ import annotations

from bisect import bisect_left
import copy
from fractions import Fraction
from functools import partial
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import time

from . import shots
from .movie_sampling import digest, exact_fps

VERSION = 'movie-selected-refinement-v1'
TIMELINE = 'shots_refined.json'
REPORT = 'shot_refinement.json'
FRAME_BOUNDARY_POLICY = 'frame-time-ms-canonical-v1'
FRAME_DECODER_VERSION = 'movie-source-pts-frames-v2'
CLOCK = 'source_frame_clock.json'
TIME_ORIGIN = 'source_container_pts'
CFR, PTS_LIST = 'cfr', 'pts_list'


def frame_within_shot(shot: dict, timestamp: float, fps: float) -> bool:
    """Compare frame times despite millisecond boundary serialization.

    Only snap values within the known serialization error to an exact frame.
    Arbitrary subframe boundaries retain their original times, and the end
    remains exclusive so the next shot's first frame cannot become evidence.
    """
    def canonical(value: float) -> float:
        exact = round(value * fps) / fps
        return exact if abs(value - exact) <= 0.00051 else value

    return canonical(shot['start']) <= canonical(timestamp) < canonical(shot['end'])


def _clock_analysis(probe: dict, fps: float) -> dict:
    """Prove the timestamp-to-index rule for every video access unit.

    Constant-rate sources keep the original rounding proof. Variable-rate,
    telecined or irregular sources fall back to the measured PTS list: frame
    indices still map to actual presentation times, never to index/fps.
    Missing, duplicate or non-finite timestamps remain hard failures.
    """
    streams = probe.get('streams', [])
    packets = probe.get('packets', [])
    if len(streams) != 1 or not packets or any(type(p.get('pts')) is not int for p in packets):
        raise ValueError('movie frame clock requires complete video packet timestamps')
    base = float(Fraction(streams[0]['time_base']))
    points = sorted(p['pts'] for p in packets)
    if base <= 0 or len(set(points)) != len(points):
        raise ValueError('movie frame clock has invalid or duplicate timestamps')
    origin = points[0] * base
    format_start = float(probe.get('format', {}).get('start_time', origin))
    if not all(math.isfinite(v) for v in (origin, format_start, fps)) or fps <= 0:
        raise ValueError('movie frame clock contains invalid times')
    residual = max(abs((pts-points[0]) * base * fps-i) for i, pts in enumerate(points))
    start_pts = streams[0].get('start_pts', points[0])
    if start_pts != points[0]:
        raise ValueError('movie frame clock starts before the selected video stream')
    value = {'frame_origin_seconds': origin, 'format_start_seconds': format_start,
             'frame_count': len(points), 'time_base': streams[0]['time_base'],
             'max_cfr_residual_frames': residual, 'packet_pts_sha256': digest(points), 'frame_pts': points}
    if residual >= .25:
        # CFR clocks keep their historical identity; only the fallback adds fields.
        value['clock_mode'] = PTS_LIST
    return value


def clock_mode(clock: dict) -> str:
    return clock.get('clock_mode', CFR)


def picture_span(clock: dict, start: float, duration: float) -> tuple[int, int]:
    """Source frame indices [first, end) whose PTS fall inside the interval."""
    base = float(Fraction(clock['time_base']))
    # Source boundary times are serialized to microseconds. Recover exact ticks
    # within that known error, with an exclusive end for the following shot.
    left = (start+clock['format_start_seconds']-.00000051) / base
    right = (start+duration+clock['format_start_seconds']-.00000051) / base
    return bisect_left(clock['frame_pts'], left), bisect_left(clock['frame_pts'], right)


def nearest_frame_time(clock: dict, seconds: float) -> float:
    """Snap a container-relative time to the nearest real source frame time."""
    base = float(Fraction(clock['time_base']))
    points = clock['frame_pts']
    tick = (seconds+clock['format_start_seconds']) / base
    index = bisect_left(points, tick)
    if index >= len(points):
        return source_frame_time(clock, len(points))
    if index > 0 and tick-points[index-1] <= points[index]-tick:
        index -= 1
    return source_frame_time(clock, index)


def frame_selection(clock: dict, first: int, end: int) -> str:
    """FFmpeg select predicate (copyts input) for source frames [first, end)."""
    if clock_mode(clock) == CFR:
        origin, fps = clock['frame_origin_seconds'], clock['binding']['fps']
        return f'between(round((t-({origin:.12f}))*{fps:.12f}),{first},{end-1})'
    base = float(Fraction(clock['time_base']))
    points = clock['frame_pts']
    # Midpoints between neighbouring PTS: exact for any irregular cadence.
    low = (points[first-1]+points[first]) / 2 * base if first > 0 else points[first]*base-.001
    high = (points[end-1]+points[end]) / 2 * base if end < len(points) else points[end-1]*base+.001
    return f'between(t,{low:.9f},{high:.9f})'


def source_frame_time(clock: dict, number: int) -> float:
    """Map an observed source frame index to the container's seek time."""
    if type(number) is not int or not 0 <= number <= clock['frame_count']:
        raise ValueError('source frame index is outside the verified clock')
    base = float(Fraction(clock['time_base']))
    absolute = (clock['frame_pts'][number] * base if number < clock['frame_count'] else
                clock['frame_pts'][-1] * base + 1/clock['binding']['fps'])
    return round(absolute-clock['format_start_seconds'], 6)


def _whole_source_fallback(timeline: dict) -> bool:
    """Recognize the no-cut detector fallback, which uses container duration."""
    rows = timeline['shots']
    duration = timeline.get('duration')
    return (len(rows) == 1 and rows[0]['start'] == 0
            and type(duration) in (int, float) and math.isfinite(duration) and duration > 0
            and rows[0]['end'] == round(duration, 3))


def _source_frame_spans(timeline: dict, clock: dict) -> list[tuple[int, int]]:
    """Recover frame indices without treating container duration as frame time.

    Detected/refined cuts encode frame_index / fps, including on VFR sources.
    With no cuts, shots._detect_raw instead covers the probed container duration,
    which may include an initial video offset, irregular PTS or an audio tail.
    That one whole-source interval covers every verified video frame. Other
    intervals retain their original indices and are never clamped to fit.
    """
    if _whole_source_fallback(timeline):
        return [(0, clock['frame_count'])]
    fps = exact_fps(timeline)
    return [(round(shot['start']*fps), round(shot['end']*fps)) for shot in timeline['shots']]


def _project_source_times(timeline: dict, clock: dict) -> None:
    for shot, (first, end) in zip(timeline['shots'], _source_frame_spans(timeline, clock)):
        shot.update(frame_start=first, frame_end=end,
                    start=source_frame_time(clock, first), end=source_frame_time(clock, end))
        shot['dur'] = round(shot['end']-shot['start'], 3)
    timeline.update(time_origin=TIME_ORIGIN, frame_clock_id=clock['clock_id'])


def picture_cut_input(video: str, start: float, duration: float, clock: dict) -> tuple[list[str], str]:
    """Select source frames before resetting timestamps and converting output FPS."""
    if not all(math.isfinite(v) for v in (start, duration)) or duration <= 0:
        raise ValueError('invalid movie source cut interval')
    if shots.file_signature(Path(video)) != clock['binding']['source']:
        raise ValueError('movie cut source changed')
    first, end = picture_span(clock, start, duration)
    if first >= end:
        raise ValueError('movie cut contains no source frames')
    lookback = min(max(0., start), 1.)
    arguments = ['-copyts', '-ss', f'{max(0., start-lookback):.9f}',
                 '-t', f'{lookback+duration+1:.9f}', '-i', video]
    return arguments, f"select='{frame_selection(clock, first, end)}'"


def _clock_digest(value: dict) -> str:
    """Keep checked clock identities portable across equivalent bind mounts."""
    material = {key: item for key, item in value.items() if key != 'clock_id'}
    if material.get('identity_policy') == 'source-bytes-and-pts-v1':
        # These fields still invalidate the local cache and require a new full
        # byte hash and packet scan. They do not change the movie's frame times.
        material['binding'] = {key: item for key, item in material['binding'].items()
                               if key not in ('ctime_ns', 'inode', 'device')}
    return digest(material)


def frame_clock(video: Path, fps: float, path: Path) -> dict:
    """Cache a checked source clock; a changed source or probe invalidates it."""
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError('movie frame clock requires a positive finite FPS')
    executable = shutil.which('ffprobe')
    if executable is None:
        raise ValueError('ffprobe is required for movie frame clock validation')
    stat = video.stat()
    binding = {'schema': FRAME_DECODER_VERSION, 'source': shots.file_signature(video), 'fps': fps,
               'ctime_ns': stat.st_ctime_ns, 'inode': stat.st_ino, 'device': stat.st_dev,
               'probe': shots.file_signature(Path(executable))}
    if path.is_file():
        previous = shots.load_json(path)
        if previous.get('binding') == binding and previous.get('clock_id') == _clock_digest(previous):
            return previous
    with shots.resource_slot('prepare', timeout=600):
        result = subprocess.run([executable, '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=start_pts,time_base:format=start_time:packet=pts', '-of', 'json', str(video)],
            capture_output=True, check=True, timeout=180)
    checksum = hashlib.sha256()
    with video.open('rb') as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            checksum.update(block)
    value = {'binding': binding, **_clock_analysis(json.loads(result.stdout), fps),
             'identity_policy': 'source-bytes-and-pts-v1', 'source_sha256': checksum.hexdigest()}
    after = video.stat()
    if (shots.file_signature(video) != binding['source']
            or (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_ino, after.st_dev) != (
                stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino, stat.st_dev)):
        raise ValueError('movie source changed during frame clock validation')
    value['clock_id'] = _clock_digest(value)
    shots.save_json(value, path)
    return value


def _decode_boundary_frames(video: Path, first: int, count: int, fps: float, *, clock: dict,
                            accurate: bool | None = None):
    """Select source PTS with a proved index mapping, independent of audio origin."""
    import numpy as np

    if (type(first) is not int or type(count) is not int or first < 0 or count <= 0
            or not math.isfinite(fps) or fps <= 0):
        raise ValueError('invalid movie boundary frame range')
    if clock['binding']['fps'] != fps or clock['binding']['source'] != shots.file_signature(video):
        raise ValueError('movie frame decoder source or FPS changed')
    count = min(count, clock['frame_count']-first)
    if count < 4:
        return None
    origin = clock['frame_origin_seconds']
    lookback = 1.0 if accurate else shots.REFINE_PRESEEK
    first_time = (origin-clock['format_start_seconds'] + first/fps if clock_mode(clock) == CFR
                  else source_frame_time(clock, first))
    relative_start = max(0.0, first_time-lookback)
    span = ((count+2)/fps if clock_mode(clock) == CFR
            else source_frame_time(clock, first+count)-first_time+2/fps)
    selection = frame_selection(clock, first, first+count)
    with shots.resource_slot('prepare', timeout=600):
        result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '1', '-copyts',
            '-ss', f'{relative_start:.9f}', '-t', f'{lookback+span+1:.9f}', '-i', str(video),
            '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', f"select='{selection}',scale=64:36,format=gray",
            '-fps_mode', 'passthrough', '-frames:v', str(count), '-threads', '1', '-f', 'rawvideo', '-'],
            capture_output=True, stdin=subprocess.DEVNULL, timeout=shots.REFINE_TIMEOUT_SECONDS)
    if result.returncode != 0 or len(result.stdout) != count*64*36:
        return None
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(count, 36, 64).astype(np.int16)


def enabled(out: Path) -> bool:
    path = out / 'production_profile.json'
    return path.is_file() and shots.load_json(path).get('shot_strategy') == 'coarse-first-v1'


def timeline_name(out: Path) -> str:
    return TIMELINE if enabled(out) else 'shots.json'


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _coarse(out: Path) -> tuple[dict, str]:
    path = out / 'shots.json'
    timeline = shots.load_json(path)
    if timeline.get('segment_version') != shots.SEGMENT_VERSION_COARSE:
        raise ValueError('selected refinement requires the preserved coarse timeline')
    source = Path(timeline['video'])
    if timeline.get('video_signature') != shots.file_signature(source):
        raise ValueError('selected refinement source changed')
    return timeline, _file_hash(path)


def initialize(out: Path) -> None:
    """An unrefined editing view may be planned but cannot pass production gates."""
    if not enabled(out):
        return
    coarse, coarse_hash = _coarse(out)
    path = out / TIMELINE
    clock = None
    if path.is_file():
        current = shots.load_json(path)
        if current.get('coarse_sha256') != coarse_hash:
            raise ValueError('production timeline belongs to another coarse index')
        if current.get('frame_decoder') == FRAME_DECODER_VERSION:
            if not _whole_source_fallback(coarse):
                return
            clock = frame_clock(Path(coarse['video']), exact_fps(coarse), out / CLOCK)
            rows = current.get('shots', [])
            if (len(rows) == 1 and rows[0].get('frame_start') == 0
                    and rows[0].get('frame_end') == clock['frame_count']
                    and rows[0]['start'] == source_frame_time(clock, 0)
                    and rows[0]['end'] == source_frame_time(clock, clock['frame_count'])
                    and current.get('frame_clock_id') == clock['clock_id']):
                return
        if current.get('refined_shot_ids') or current.get('refine'):
            history = out / 'shot_refinement_history' / _file_hash(path)
            history.mkdir(parents=True, exist_ok=True)
            for name in (TIMELINE, REPORT, 'shot_seek_validation.json'):
                original = out / name
                if original.is_file():
                    target = history / name
                    if target.is_file() and target.read_bytes() != original.read_bytes():
                        raise ValueError('saved refinement history changed')
                    if not target.exists():
                        shutil.copy2(original, target)
    value = copy.deepcopy(coarse)
    value.update(segment_version=VERSION, coarse_sha256=coarse_hash, refined_shot_ids=[],
                 frame_decoder=FRAME_DECODER_VERSION)
    clock = clock or frame_clock(Path(coarse['video']), exact_fps(coarse), out / CLOCK)
    _project_source_times(value, clock)
    for shot in value['shots'][1:]:
        shot['boundary_in'] = 'unknown'
    shots.save_json(value, path)


def verify_seek(video: Path, timeline: dict, path: Path) -> dict:
    """Enable input-only seek after actual frame equality checks on this source."""
    import numpy as np

    executable = shutil.which('ffmpeg')
    if executable is None:
        raise ValueError('ffmpeg is required for selected refinement')
    binary = shots.file_signature(Path(executable))
    fps = exact_fps(timeline)
    clock = frame_clock(video, fps, path.parent / CLOCK)
    binding = {'schema': 'movie-seek-validation-v1', 'source': shots.file_signature(video),
               'decoder': binary, 'fps': fps, 'radius': shots.REFINE_RADIUS,
               'frame_decoder': FRAME_DECODER_VERSION, 'frame_clock_id': clock['clock_id']}
    if path.is_file():
        previous = shots.load_json(path)
        if previous.get('binding') == binding and previous.get('proof_id') == digest(
                {k: v for k, v in previous.items() if k != 'proof_id'}):
            return previous
    boundaries = timeline['shots'][1:]
    selected = sorted({round((len(boundaries)-1) * i / 5) for i in range(6)}) if boundaries else []
    samples = []
    for index in selected:
        number = max(0, round(boundaries[index]['start'] * fps)-shots.REFINE_RADIUS)
        row = {'first_frame': number, 'frames': 2*shots.REFINE_RADIUS+1, 'matched': False}
        try:
            start = time.monotonic()
            compatible = _decode_boundary_frames(video, number, row['frames'], fps, clock=clock, accurate=False)
            row['compatible_seconds'] = round(time.monotonic()-start, 3)
            start = time.monotonic()
            fast = _decode_boundary_frames(video, number, row['frames'], fps, clock=clock, accurate=True)
            row['accurate_seconds'] = round(time.monotonic()-start, 3)
            row['matched'] = (compatible is not None and fast is not None
                              and len(compatible) == row['frames'] and np.array_equal(compatible, fast))
            if row['matched']:
                row['frames_sha256'] = hashlib.sha256(compatible.tobytes()).hexdigest()
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
        samples.append(row)
    value = {'binding': binding, 'samples': samples,
             'mode': 'accurate' if samples and all(s['matched'] for s in samples) else 'compatible',
             'scope': 'sampled_frame_identity; remaining boundaries and final cuts still need checks'}
    value['proof_id'] = digest(value)
    shots.save_json(value, path)
    return value


def _evidence_inputs(out: Path) -> dict:
    paths = [out / 'visual_frames.jsonl'] + sorted(out.glob('visual_supplements/*/supplement_evidence.json'))
    return {str(path.relative_to(out)): _file_hash(path) if path.is_file() else None for path in paths}


def _excluded_frames(out: Path, timeline: dict, requested: set[str]) -> list[dict]:
    refined_map = {s['shot_id']: s for s in timeline['shots']}
    fps = exact_fps(timeline)
    clock = shots.load_json(out / CLOCK) if timeline.get('time_origin') == TIME_ORIGIN else None
    frame_sources = []
    path = out / 'visual_frames.jsonl'
    if path.is_file():
        frame_sources += [('F'+str(f['frame_number']), f) for f in
                          (json.loads(line) for line in path.read_text().splitlines() if line.strip())]
    for path in sorted(out.glob('visual_supplements/*/supplement_evidence.json')):
        value = shots.load_json(path)
        frame_sources += [('SF'+path.parent.name+':'+str(f['frame_number']), f) for f in value['frames']]
    excluded = []
    for ref, frame in frame_sources:
        if frame['shot_id'] not in requested:
            continue
        shot = refined_map[frame['shot_id']]
        stamp = source_frame_time(clock, frame['frame_number']) if clock and ref.startswith('F') else frame['time']
        if not frame_within_shot(shot, stamp, fps):
            excluded.append({'evidence_id': ref, 'shot_id': frame['shot_id'], 'time': frame['time'],
                             'production_time': stamp,
                             'reason': 'outside_refined_shot; original evidence retained'})
    return excluded


def refine_selected(out: Path, shot_ids: set[str], *, on_progress=None) -> dict:
    """Refine selected shots and bounded backups; keep original IDs and evidence."""
    initialize(out)
    coarse, coarse_hash = _coarse(out)
    previous = shots.load_json(out / TIMELINE)
    by_id = {s['shot_id']: i for i, s in enumerate(coarse['shots'])}
    if not shot_ids <= set(by_id):
        raise ValueError('unknown selected shot')
    requested = set(previous.get('refined_shot_ids', [])) | set(shot_ids)
    if (requested <= set(previous.get('refined_shot_ids', [])) and (out / REPORT).is_file()
            and previous.get('frame_decoder') == FRAME_DECODER_VERSION):
        validate_selected(out, requested)
        report = shots.load_json(out / REPORT)
        evidence_inputs = _evidence_inputs(out)
        if (report.get('evidence_inputs') != evidence_inputs
                or report.get('frame_boundary_policy') != FRAME_BOUNDARY_POLICY):
            # A new supplement can be checked against already verified cuts
            # without moving those cuts.
            excluded = _excluded_frames(out, previous, requested)
            if _evidence_inputs(out) != evidence_inputs:
                raise ValueError('refinement evidence changed during refresh')
            history = out / 'shot_refinement_history' / _file_hash(out / REPORT)
            history.mkdir(parents=True, exist_ok=True)
            archive = history / REPORT
            if archive.is_file() and archive.read_bytes() != (out / REPORT).read_bytes():
                raise ValueError('saved refinement history changed')
            if not archive.exists():
                shutil.copy2(out / REPORT, archive)
            report.update(evidence_inputs=evidence_inputs, frame_boundary_policy=FRAME_BOUNDARY_POLICY,
                          excluded_source_frames=excluded)
            shots.save_json(report, out / REPORT)
        return {**report, 'cache_hit': True}
    indices = {b for sid in requested for b in (by_id[sid], by_id[sid]+1)
               if 0 < b < len(by_id)}
    seek = verify_seek(Path(coarse['video']), coarse, out / 'shot_seek_validation.json')
    clock = frame_clock(Path(coarse['video']), exact_fps(coarse), out / CLOCK)
    timeline = copy.deepcopy(coarse)
    stats = shots.refine_boundaries(Path(coarse['video']), timeline['shots'], exact_fps(coarse),
        checkpoint=out / 'selected_boundaries_pts_v2.json', boundary_indices=indices,
        accurate=seek['mode'] == 'accurate', on_progress=on_progress,
        frame_decoder=partial(_decode_boundary_frames, clock=clock),
        decoder_binding={'version': FRAME_DECODER_VERSION, 'clock_id': clock['clock_id']},
        prefer_existing=True, bound_to_neighbors=True)
    for raw, row in zip(coarse['shots'], timeline['shots']):
        row['coarse_start'], row['coarse_end'] = raw['start'], raw['end']
    _project_source_times(timeline, clock)
    known = {0, len(by_id)} | {i for i in range(1, len(by_id))
                             if timeline['shots'][i].get('boundary_in') in ('hard', 'soft')}
    refined = sorted(sid for sid in requested if {by_id[sid], by_id[sid]+1} <= known)
    timeline.update(segment_version=VERSION, coarse_sha256=coarse_hash, refine=stats,
                    refined_shot_ids=refined, seek_proof_id=seek['proof_id'],
                    frame_decoder=FRAME_DECODER_VERSION, frame_clock_id=clock['clock_id'])
    shots.save_json(timeline, out / TIMELINE)
    record = {'schema': VERSION, 'status': 'ready' if set(refined) >= requested else 'needs_refinement',
              'coarse_sha256': coarse_hash, 'timeline_sha256': _file_hash(out / TIMELINE),
              'requested_shot_ids': sorted(requested), 'refined_shot_ids': refined,
              'missing_shot_ids': sorted(requested-set(refined)), 'evidence_inputs': _evidence_inputs(out),
              'frame_boundary_policy': FRAME_BOUNDARY_POLICY,
              'excluded_source_frames': _excluded_frames(out, timeline, requested),
              'seek_proof_id': seek['proof_id'], 'stats': stats}
    shots.save_json(record, out / REPORT)
    return record


def validate_selected(out: Path, required: set[str]) -> None:
    coarse, coarse_hash = _coarse(out)
    timeline = shots.load_json(out / TIMELINE)
    report = shots.load_json(out / REPORT)
    seek = shots.load_json(out / 'shot_seek_validation.json')
    clock = frame_clock(Path(coarse['video']), exact_fps(coarse), out / CLOCK)
    rows = timeline['shots']
    if (timeline.get('segment_version') != VERSION or timeline.get('coarse_sha256') != coarse_hash
            or report.get('schema') != VERSION or report.get('coarse_sha256') != coarse_hash
            or report.get('timeline_sha256') != _file_hash(out / TIMELINE)
            or timeline.get('refined_shot_ids') != report.get('refined_shot_ids')
            or not required <= set(timeline.get('refined_shot_ids', []))
            or [s['shot_id'] for s in rows] != [s['shot_id'] for s in coarse['shots']]):
        raise ValueError('selected boundaries are missing or stale')
    if (seek.get('proof_id') != digest({k: v for k, v in seek.items() if k != 'proof_id'})
            or timeline.get('seek_proof_id') != seek['proof_id'] or report.get('seek_proof_id') != seek['proof_id']
            or seek.get('binding', {}).get('source') != coarse['video_signature']
            or seek['binding'].get('fps') != exact_fps(coarse)
            or timeline.get('frame_decoder') != FRAME_DECODER_VERSION
            or seek['binding'].get('frame_decoder') != FRAME_DECODER_VERSION
            or timeline.get('frame_clock_id') != clock['clock_id']
            or seek['binding'].get('frame_clock_id') != clock['clock_id']
            or seek.get('mode') not in ('accurate', 'compatible')
            or seek['mode'] == 'accurate' and (not seek.get('samples') or not all(s.get('matched') for s in seek['samples']))):
        raise ValueError('selected seek proof is missing or stale')
    spans = _source_frame_spans(coarse, clock)
    if (not rows or rows[0]['start'] != source_frame_time(clock, spans[0][0])
            or rows[-1]['end'] != source_frame_time(clock, spans[-1][1])
            or timeline.get('time_origin') != TIME_ORIGIN
            or timeline.get('video_signature') != coarse['video_signature']):
        raise ValueError('refined timeline source or coverage changed')
    for i, row in enumerate(rows):
        if any(type(row.get(k)) not in (int, float) or not math.isfinite(row[k]) for k in ('start', 'end', 'dur')):
            raise ValueError('refined timeline contains invalid times')
        if row['end'] <= row['start'] or i and rows[i-1]['end'] != row['start']:
            raise ValueError('refined timeline is not monotonic and contiguous')
        if (source_frame_time(clock, row['frame_start']) != row['start']
                or source_frame_time(clock, row['frame_end']) != row['end']):
            raise ValueError('refined boundary does not match its source frame timestamp')
        if abs(row['dur']-(row['end']-row['start'])) > .002:
            raise ValueError('refined shot duration changed')
        if row['shot_id'] in required:
            if (i and row.get('boundary_in') not in ('hard', 'soft') or
                    i+1 < len(rows) and rows[i+1].get('boundary_in') not in ('hard', 'soft')):
                raise ValueError('selected boundary is unrefined')
