"""Movie candidate signals and deterministic sampling; no semantic scene claims.

Candidate thumbnails are collected during the coarse detector's existing scan.
Only selected frames are decoded at observation resolution. Sparse observations
and omitted shots remain separate.
"""
from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import time

from .shots import file_signature, load_json, save_json
from .recap_runtime_state import resource_slot

CANDIDATE_VERSION = 'movie-candidate-signals-v1'
# The coarse pass indexes scenes for story selection; the pictures a sentence
# actually plays over are checked later, inside their arranged windows.
COARSE_VERSION = 'movie-coarse-sampling-v1'
COARSE_MIN_SPAN = 45.0
COARSE_MAX_SPAN = 120.0
COARSE_BREAK_DISTANCE = 0.3
COARSE_MAX_FRAMES = 144


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def exact_fps(timeline: dict) -> float:
    value = (float(timeline['fps_num']) / float(timeline['fps_den'])
             if timeline.get('fps_num') and timeline.get('fps_den') else float(timeline['fps']))
    if not math.isfinite(value) or value <= 0:
        raise ValueError('sampling requires a positive finite FPS')
    return value


def image_metrics(frame, previous=None) -> tuple[dict, object]:
    import cv2
    import numpy as np

    gray = cv2.cvtColor(cv2.resize(frame, (64, 36), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).reshape(-1)
    phash = sum(int(bit) << pos for pos, bit in enumerate(bits))
    delta = np.abs(gray.astype(np.float32) - previous.astype(np.float32)) if previous is not None else None
    regional = (max(float(delta[y:y+12, x:x+16].mean()) for y in (0, 12, 24)
                    for x in (0, 16, 32, 48)) if delta is not None else 0.0)
    return {'luminance': round(float(gray.mean()), 3), 'contrast': round(float(gray.std()), 3),
            'sharpness': round(float(cv2.Laplacian(gray, cv2.CV_32F).var()), 3),
            'change': round(float(delta.mean()), 3) if delta is not None else 0.0,
            'regional_change': round(regional, 3), 'dhash': f'{phash:016x}'}, gray


class CandidateRecorder:
    """One detector owns a cache; incomplete scans cannot masquerade as complete."""

    def __init__(self, parent: Path, video: Path, meta: dict, *, threshold: float):
        self.fps = exact_fps(meta)
        self.binding = {'schema': CANDIDATE_VERSION, 'source': file_signature(video),
                        'fps': self.fps, 'threshold': threshold,
                        'analysis_interval': 0.5, 'baseline_interval': 2.0, 'thumbnail_width': 160}
        self.directory = parent / digest(self.binding)[:24]
        self.directory.mkdir(parents=True, exist_ok=True)
        self.rows = []
        self._row_of = {}       # frame number -> index in rows
        self.previous = None
        self.last_analysis = self.last_kept = -10**12
        self.started = time.monotonic()
        self.last_save = 0.0
        self.flush(complete=False)

    def observe(self, frame_number: int, frame, *, cut=False) -> None:
        import cv2

        number = int(frame_number)
        if not cut and number - self.last_analysis < max(1, round(self.fps * 0.5)):
            return
        metrics, gray = image_metrics(frame, self.previous)
        self.previous, self.last_analysis = gray, number
        if (not cut and number - self.last_kept < self.fps * 2
                and metrics['change'] < 12 and metrics['regional_change'] < 22):
            return
        height = max(1, round(frame.shape[0] * 160 / frame.shape[1]))
        thumb = cv2.resize(frame, (160, height), interpolation=cv2.INTER_AREA)
        success, data = cv2.imencode('.jpg', thumb, [cv2.IMWRITE_JPEG_QUALITY, 82])
        if not success:
            raise ValueError('candidate_thumbnail_encode_failed')
        name = f'frame_{number:09d}.jpg'
        target = self.directory / name
        temporary = target.with_suffix('.writing')
        temporary.write_bytes(data.tobytes())
        temporary.replace(target)
        row = {'frame_number': number, 'time': round(number / self.fps, 6),
               'detected_cut': bool(cut), 'thumbnail': name,
               'sha256': hashlib.sha256(data).hexdigest(), 'metrics': metrics}
        if number in self._row_of:
            # The detector can deliver one frame number twice around a cut (a cut bypasses the
            # interval check above). The thumbnail file was just overwritten, so the row that
            # matches it replaces the earlier one; two rows made the whole cache unreadable
            # ("invalid or duplicate candidate frame").
            self.rows[self._row_of[number]] = row
        else:
            self._row_of[number] = len(self.rows)
            self.rows.append(row)
        self.last_kept = number
        if time.monotonic() - self.last_save >= 5:
            self.flush(complete=False)

    def flush(self, *, complete: bool) -> None:
        save_json({'schema': CANDIDATE_VERSION, 'binding': self.binding, 'complete': complete,
                   'frames': self.rows, 'last_frame': self.last_analysis,
                   'elapsed_seconds': round(time.monotonic() - self.started, 3)},
                  self.directory / 'manifest.json')
        self.last_save = time.monotonic()

    def finish(self) -> None:
        self.flush(complete=True)

    def reference(self) -> dict:
        path = self.directory / 'manifest.json'
        return {'path': str(path.relative_to(self.directory.parent.parent)),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def read_candidates(out: Path, timeline: dict) -> list[dict]:
    ref = timeline.get('candidate_cache') or {}
    path = (out / ref['path']).resolve(strict=True)
    if not path.is_relative_to((out / 'frame_candidates').resolve()):
        raise ValueError('candidate cache is outside movie output')
    if hashlib.sha256(path.read_bytes()).hexdigest() != ref.get('sha256'):
        raise ValueError('candidate cache changed')
    value = load_json(path)
    if (value.get('schema') != CANDIDATE_VERSION or value.get('complete') is not True
            or value.get('binding', {}).get('source') != timeline['video_signature']
            or value['binding']['fps'] != exact_fps(timeline)):
        raise ValueError('candidate cache is incomplete or belongs to another source')
    return value['frames']


def dialogue_fraction(dialogue: list[dict], start: float, end: float) -> float:
    if end <= start:
        return 0.0
    cursor, covered = start, 0.0
    for row in sorted(dialogue, key=lambda d: d['start']):
        left, right = max(start, float(row['start'])), min(end, float(row['end']))
        if right <= left:
            continue
        left = max(left, cursor)
        covered += max(0.0, right - left)
        cursor = max(cursor, right)
    return min(1.0, covered / (end - start))


def _check_unavailable(unavailable_intervals) -> list:
    unavailable_intervals = unavailable_intervals or []
    if any(not isinstance(row, (list, tuple)) or len(row) != 2
           or any(type(n) not in (int, float) or not math.isfinite(n) for n in row)
           or not 0 <= row[0] < row[1] for row in unavailable_intervals):
        raise ValueError('invalid unavailable source interval')
    return unavailable_intervals


def _candidate_rows(timeline: dict, dialogue: list[dict], candidates: list[dict], fps: float):
    """Score every in-shot candidate with local signals; shared by all sampling policies."""
    shots = sorted(timeline['shots'], key=lambda s: s['start'])
    if (not shots or len({s['shot_id'] for s in shots}) != len(shots)
            or any(float(s['end']) <= float(s['start']) for s in shots)):
        raise ValueError('invalid sampling timeline')
    starts = [round(float(s['start']) * fps) for s in shots]
    rows, seen, recent = [], set(), []
    for candidate in sorted(candidates, key=lambda r: r['frame_number']):
        number = candidate['frame_number']
        if type(number) is not int or number < 0 or number in seen:
            raise ValueError('invalid or duplicate candidate frame')
        seen.add(number)
        pos = bisect_right(starts, number) - 1
        if pos < 0 or number >= round(float(shots[pos]['end']) * fps):
            continue
        shot = shots[pos]
        t = number / fps
        metrics = candidate['metrics']
        phash = int(metrics['dhash'], 16)
        novelty = min(((phash ^ old).bit_count() / 64 for old in recent[-60:]), default=1.0)
        recent.append(phash)
        speech = dialogue_fraction(dialogue, max(shot['start'], t-2), min(shot['end'], t+2))
        change = min(1.0, max(metrics['change'] / 40, metrics['regional_change'] / 60))
        quality = min(1.0, metrics['contrast'] / 30) * min(1.0, metrics['sharpness'] / 80)
        if metrics['luminance'] < 8 or metrics['luminance'] > 248:
            quality *= 0.2
        short = float(shot['end']) - float(shot['start']) < 1.0
        score = 1.8 * (1-speech) + 2.0 * change + 1.8 * novelty + quality + 1.6 * short
        rows.append({'shot_id': shot['shot_id'], 'start': shot['start'], 'end': shot['end'],
                     'frame_number': number, 'time': round(t, 6), 'position':
                         round((t-shot['start']) / (shot['end']-shot['start']), 4),
                     'image': f'frames/frame_{number:09d}.jpg',
                     'signals': {'asr_coverage': round(speech, 4), 'image_change': round(change, 4),
                                 'novelty': round(novelty, 4), 'quality': round(quality, 4),
                                 'short_insert': short}, 'score': round(score, 6)})
    if not rows:
        raise ValueError('no usable candidate frames')
    return shots, rows


def select_coarse(timeline: dict, dialogue: list[dict], candidates: list[dict], *,
                  unavailable_intervals: list | None = None, min_span: float = COARSE_MIN_SPAN,
                  max_span: float = COARSE_MAX_SPAN, max_frames: int = COARSE_MAX_FRAMES) -> dict:
    """One representative frame per cluster of consecutive shots: a scene-level index.

    Clusters close at a strong composition change once ``min_span`` seconds are
    covered, and always by ``max_span``; adjacent clusters are merged until the
    film has at most ``max_frames`` representatives, so the coarse pass stays a
    handful of observer tasks for any feature length. Detail is checked later,
    only inside the windows the narration actually plays over.
    """
    duration, fps = float(timeline['duration']), exact_fps(timeline)
    if (not math.isfinite(duration) or duration <= 0 or not 0 < min_span <= max_span
            or not math.isfinite(max_span) or type(max_frames) is not int or max_frames < 1):
        raise ValueError('invalid coarse sampling parameters')
    unavailable_intervals = _check_unavailable(unavailable_intervals)
    shots, rows = _candidate_rows(timeline, dialogue, candidates, fps)
    hashes = {c['frame_number']: int(c['metrics']['dhash'], 16) for c in candidates}
    by_shot = defaultdict(list)
    for row in rows:
        by_shot[row['shot_id']].append(row)
    clusters, current, anchor = [], None, 0
    for shot in shots:
        values = by_shot.get(shot['shot_id'])
        if not values:
            continue
        first = hashes[values[0]['frame_number']]
        if current is not None:
            span = float(shot['end']) - current['start']
            covered = float(shot['start']) - current['start']
            distance = (anchor ^ first).bit_count() / 64
            if span > max_span or (covered >= min_span and distance >= COARSE_BREAK_DISTANCE):
                clusters.append(current)
                current = None
        if current is None:
            current = {'start': float(shot['start']), 'end': float(shot['end']), 'rows': []}
            anchor = first
        current['end'] = float(shot['end'])
        current['rows'].extend(values)
    if current is not None:
        clusters.append(current)
    while len(clusters) > max_frames:
        # Merge the shortest adjacent pair; deterministic and keeps film order.
        index = min(range(len(clusters) - 1),
                    key=lambda i: (clusters[i + 1]['end'] - clusters[i]['start'], i))
        left, right = clusters[index], clusters.pop(index + 1)
        left['end'] = right['end']
        left['rows'].extend(right['rows'])
    selected = []
    for cluster in clusters:
        center = (cluster['start'] + cluster['end']) / 2
        width = max(1e-6, cluster['end'] - cluster['start'])
        row = max(cluster['rows'], key=lambda r: (r['signals']['quality'] + 0.5 * r['signals']['novelty']
                                                  - abs(r['time'] - center) / width, -r['frame_number']))
        selected.append({**row, **{'selection_reasons': ['scene_cluster'], 'reason': 'scene_cluster',
                           'cluster': [round(cluster['start'], 3), round(cluster['end'], 3)]}})
    selected.sort(key=lambda r: r['frame_number'])
    observed = {r['shot_id'] for r in selected}
    unavailable_shots = [s for s in shots if any(a < s['end'] and b > s['start']
                                               for a, b in unavailable_intervals)]
    points = [0.0] + [r['time'] for r in selected] + [duration]
    value = {'schema': COARSE_VERSION,
             'parameters': {'min_span_seconds': min_span,
                            'max_span_seconds': max_span, 'max_frames': max_frames,
                            'break_distance': COARSE_BREAK_DISTANCE},
             'frames': selected,
             'unobserved_shot_ids': [s['shot_id'] for s in shots if s['shot_id'] not in observed],
             'stats': {'candidate_frames': len(rows), 'initial_frames': len(selected),
                       'clusters': len(clusters), 'selected_shots': len(observed), 'total_shots': len(shots),
                       'max_sample_gap_seconds': round(max(b-a for a, b in zip(points, points[1:])), 3)},
             'scope': ('coarse_scene_index; one representative frame per shot cluster. Unselected shots, '
                       'action continuity and detail are unverified here.')}
    if unavailable_intervals:
        value.update(unavailable_intervals=unavailable_intervals,
                     unavailable_shot_ids=[s['shot_id'] for s in unavailable_shots])
    value['selection_id'] = digest(value)
    return value


def balanced_select(numbers) -> str:
    """Equivalent frame predicates with logarithmic FFmpeg expression depth."""
    terms = [f'eq(n\\,{number})' for number in numbers]
    if not terms:
        raise ValueError('empty frame selection')
    while len(terms) > 1:
        terms = ['(' + '+'.join(terms[i:i+2]) + ')' for i in range(0, len(terms), 2)]
    return terms[0]


# Decoder tuning is fixed in code (no environment knobs); tests override entries here.
SETTINGS: dict[str, str] = {}


def _setting(name: str, default: str) -> str:
    return SETTINGS.get(name) or default


def _setting_float(name: str, default: float) -> float:
    try:
        value = float(_setting(name, str(default)))
        return value if math.isfinite(value) and value > 0 else default
    except ValueError:
        return default


def _video_stream(video: Path) -> dict:
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                             'stream=codec_name,width,height,start_pts,time_base:format=start_time',
                             '-of', 'json', str(video)], capture_output=True, text=True, timeout=120)
    try:
        value = json.loads(result.stdout or '{}')
        return {**(value.get('streams') or [{}])[0], 'format_start_time': value.get('format', {}).get('start_time')}
    except ValueError:
        return {}


def decode_deadline(video: Path, duration: float, info: dict | None = None) -> float:
    """Wall-clock budget scaled by pixel count and codec cost, never tied to realtime."""
    info = _video_stream(video) if info is None else info
    pixels = float(info.get('width') or 1920) * float(info.get('height') or 1080)
    scale = min(4.0, max(1.0, pixels / (1920*1080)))
    codec = {'hevc': 1.6, 'av1': 2.0, 'vp9': 1.6, 'prores': 1.3}.get(str(info.get('codec_name')), 1.0)
    return max(_setting_float('MIN_DEADLINE', 300.0),
               float(duration) * _setting_float('DEADLINE_FACTOR', 1.0) * scale * codec)


def _frame_times(video: Path, info: dict) -> list[float] | None:
    """Presentation-ordered frame times (copyts seconds) from a packet scan; None if not provable."""
    result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                             'packet=pts', '-of', 'json', str(video)], capture_output=True, text=True, timeout=600)
    try:
        from fractions import Fraction
        points = [p.get('pts') for p in json.loads(result.stdout or '{}').get('packets', [])]
        base = float(Fraction(info['time_base']))
    except (ValueError, KeyError, TypeError, ZeroDivisionError):
        return None
    if (result.returncode != 0 or not points or any(type(p) is not int for p in points)
            or len(set(points)) != len(points) or base <= 0
            or info.get('start_pts', min(points)) != min(points)):
        return None
    return [p * base for p in sorted(points)]


def _seek_extract(video: Path, directory: Path, pending: list[dict], times: list[float],
                  width: int, threads: int, info: dict, deadline: float, on_done) -> int:
    """Independent accurate seeks to exact PTS; returns how many leading rows completed."""
    from concurrent.futures import ThreadPoolExecutor
    from PIL import Image

    start_time = float(info.get('format_start_time') or 0)
    started = time.monotonic()

    def one(item):
        index, row = item
        number = row['frame_number']
        if number >= len(times) or time.monotonic() - started > deadline:
            return False
        stamp = times[number]
        low = (times[number-1]+stamp) / 2 if number > 0 else stamp-.001
        high = (stamp+times[number+1]) / 2 if number+1 < len(times) else stamp+.001
        source = directory / f'seek_{index:09d}.jpg'
        result = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-threads', str(threads), '-copyts',
                                 '-ss', f'{max(0.0, stamp-start_time-1.0):.9f}', '-i', str(video),
                                 '-map', '0:v:0', '-an', '-sn', '-dn',
                                 '-vf', f"select='between(t,{low:.9f},{high:.9f})',scale={width}:-2",
                                 '-fps_mode', 'passthrough', '-frames:v', '1', '-q:v', '3', '-update', '1',
                                 str(source)], capture_output=True, stdin=subprocess.DEVNULL, timeout=300)
        if result.returncode != 0 or not source.is_file():
            return False
        with Image.open(source) as img:
            img.verify()
        return True

    workers = max(1, min(len(pending), int(_setting_float('SEEK_WORKERS', 4))))
    copied = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for ok, (index, row) in zip(pool.map(one, enumerate(pending)), enumerate(pending)):
            if not ok:
                break
            target = directory.parent / row['image']
            target.parent.mkdir(parents=True, exist_ok=True)
            (directory / f'seek_{index:09d}.jpg').replace(target)
            copied += 1
            on_done(copied)
    return copied


def extract_selected(video: Path, output: Path, frames: list[dict], *, width=640,
                     duration: float, on_progress=None) -> None:
    """Exact selected frames; complete images survive an interrupted scan.

    Sparse selections use parallel accurate seeks to measured frame PTS (no
    full-film decode). Dense selections, unprovable timestamps or any failed
    seek fall back to one multithreaded sequential decode. SETTINGS MODE
    (auto/seek/sequential), THREADS and DEADLINE_FACTOR
    are configurable; the deadline scales with resolution and codec.
    """
    from PIL import Image

    pending = []
    for row in sorted(frames, key=lambda r: r['frame_number']):
        target = (output / row['image']).resolve()
        if not target.is_relative_to(output.resolve()):
            raise ValueError('frame output escapes coverage directory')
        try:
            with Image.open(target) as img:
                img.verify()
        except (OSError, ValueError):
            pending.append(row)
    if not pending:
        return
    output.mkdir(parents=True, exist_ok=True)
    threads = int(_setting_float('THREADS', min(4, os.cpu_count() or 1)))
    info = _video_stream(video)
    deadline = decode_deadline(video, duration, info)
    started = time.monotonic()
    mode = _setting('MODE', 'auto').lower()
    span = max(1e-6, float(duration))
    sparse = len(pending) <= 1 or span / len(pending) >= _setting_float('SEEK_MIN_GAP_SECONDS', 8.0)

    def progress(done):
        if on_progress:
            on_progress({'stage': 'extract_selected_frames', 'done': len(frames)-len(pending)+done,
                         'total': len(frames), 'elapsed_seconds': round(time.monotonic()-started, 2)})

    with tempfile.TemporaryDirectory(prefix='.decode-', dir=output) as temporary:
        directory = Path(temporary)
        if mode == 'seek' or (mode == 'auto' and sparse):
            with resource_slot('prepare', timeout=600):
                times = _frame_times(video, info)
                if times is not None:
                    done = _seek_extract(video, directory, pending, times, width, threads, info, deadline, progress)
                    pending = pending[done:]
            if not pending:
                return
        expression = balanced_select(r['frame_number'] for r in pending)
        command = ['ffmpeg', '-nostdin', '-v', 'error', '-threads', str(threads), '-i', str(video),
                   '-vf', f'select={expression},scale={width}:-2', '-fps_mode', 'passthrough',
                   '-frames:v', str(len(pending)), '-threads', str(threads), '-q:v', '3', '-atomic_writing', '1',
                   str(directory / '%09d.jpg')]
        copied = 0
        with resource_slot('prepare', timeout=600), tempfile.TemporaryFile() as errors:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errors)
            try:
                while True:
                    while copied < len(pending) and (source := directory / f'{copied+1:09d}.jpg').is_file():
                        target = output / pending[copied]['image']
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with Image.open(source) as img:
                            img.verify()
                        source.replace(target)
                        copied += 1
                    progress(copied)
                    if process.poll() is not None:
                        # Reap once more after FFmpeg's final atomic rename.
                        if copied < len(pending) and (directory / f'{copied+1:09d}.jpg').is_file():
                            continue
                        break
                    if time.monotonic() - started > deadline:
                        raise TimeoutError('selected-frame decoding deadline')
                    time.sleep(1)
                if process.returncode != 0 or copied != len(pending):
                    raise ValueError('selected_frame_decode_incomplete')
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
