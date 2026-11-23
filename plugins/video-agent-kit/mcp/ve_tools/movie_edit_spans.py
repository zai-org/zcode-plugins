"""Evidence-bound internal editing spans; preserved parent timelines stay intact.

This deliberately recognizes only persistent switches between stable pictures.
It is not a general shot detector: moving/dissolving/brief ambiguous material
keeps one parent span and gains no repeated-parent usage exemption. Parents
longer than ``maximum_scan_seconds`` (for example a whole-film fallback shot)
are recorded as not scanned and also keep one parent span.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
import copy
from ve_tools import file_lock
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import threading

from . import movie_refinement as refinement, shots
from .movie_sampling import digest
from .visual_review import atomic_json

VERSION = 'movie-edit-spans-v1'
FILE = 'source_edit_spans.json'
HISTORY = 'source_edit_spans_history'
EVIDENCE = 'source_edit_spans_evidence'
DETECTOR = {'version': 'persistent-static-switch-v1', 'width': 160, 'height': 90,
    'pixel_format': 'rgb24', 'scale': 'area', 'long_shot_seconds': 30.0,
    'stable_seconds': .35, 'minimum_stable_seconds': .20, 'return_seconds': 1.0,
    'maximum_stable_mae': 1.0, 'minimum_jump': 2.5, 'jump_over_background': 8.0,
    'minimum_structure_mae': 2.0, 'minimum_changed_regions': 3,
    'minimum_changed_region_rows': 2, 'minimum_changed_region_columns': 2,
    'minimum_picture_std': 8.0, 'photometric_gain_min': .125, 'photometric_gain_max': 8.0,
    'photometric_inlier_fraction': .70, 'photometric_fit_iterations': 3,
    'region_structure_mae': 2.0, 'minimum_persistence_ratio': .75,
    # Affine re-sampling is lossy; require both a small residual and an 80% reduction.
    'maximum_motion_residual': 3.0, 'maximum_motion_ratio': .20,
    'minimum_motion_overlap': .70, 'maximum_candidates': 64,
    # Interior-cut scanning decodes every parent frame; bound its cost. Longer
    # parents keep the conservative single-parent rule (status not_scanned_long).
    'maximum_scan_seconds': 600.0,
    # Decoder deadline scales with the decoded duration instead of one fixed total.
    'decode_timeout_base_seconds': 60.0, 'decode_timeout_per_source_second': 1.0,
    'frame_scan_format': 'jump-list-v1', 'frame_decoder': refinement.FRAME_DECODER_VERSION}

NOT_SCANNED = frozenset({'not_scanned_short', 'not_scanned_long'})


def _decode_timeout(seconds):
    return DETECTOR['decode_timeout_base_seconds'] + DETECTOR['decode_timeout_per_source_second']*max(0., seconds)


def _read(path):
    try:
        value = json.loads(Path(path).read_text())
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (OSError, ValueError, TypeError):
        raise ValueError('movie edit span record missing or invalid') from None


def _bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode() + b'\n'


def _hash_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def _immutable(path, value):
    raw = _bytes(value)
    if path.is_symlink():
        raise ValueError('movie edit span archive path changed')
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError('saved movie edit span evidence changed')
        return
    atomic_json(path, value)


def _source(timeline, clock):
    video = Path(timeline['video'])
    if (shots.file_signature(video) != clock['binding']['source']
            or timeline.get('frame_clock_id') != clock['clock_id']
            or timeline.get('time_origin') != refinement.TIME_ORIGIN
            or not isinstance(clock.get('source_sha256'), str)
            or len(clock['source_sha256']) != 64):
        raise ValueError('movie edit span source or frame clock changed')
    return video


def _binding(timeline, clock):
    _source(timeline, clock)
    return {'schema': VERSION, 'source_sha256': clock['source_sha256'],
            'frame_clock_id': clock['clock_id'], 'timeline_digest': digest(timeline),
            'detector': copy.deepcopy(DETECTOR)}


def _parent(row, clock):
    first, end = row.get('frame_start'), row.get('frame_end')
    if (type(first) is not int or type(end) is not int
            or not 0 <= first < end <= clock['frame_count']):
        raise ValueError('movie edit span parent requires verified source frame bounds')
    start, stop = refinement.source_frame_time(clock, first), refinement.source_frame_time(clock, end)
    if row['start'] != start or row['end'] != stop:
        raise ValueError('movie edit span parent does not match its source PTS')
    return {'frame_start': first, 'frame_end': end, 'start': start, 'end': stop}


def _decode(video, clock, first, end):
    """Bounded-memory, source-PTS selection; no output FPS conversion."""
    import numpy as np

    start = refinement.source_frame_time(clock, first)
    stop = refinement.source_frame_time(clock, end)
    lookback = min(max(start, 0.), 1.)
    executable = shutil.which('ffmpeg')
    if executable is None:
        raise ValueError('ffmpeg is required for movie edit span detection')
    selection = refinement.frame_selection(clock, first, end)
    command = [executable, '-nostdin', '-v', 'error', '-threads', '1', '-copyts',
        '-ss', f'{max(0., start-lookback):.9f}', '-t', f'{lookback+stop-start+1:.9f}',
        '-i', str(video), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf',
        f"select='{selection}',scale={DETECTOR['width']}:{DETECTOR['height']}:flags=area,format=rgb24",
        '-fps_mode', 'passthrough', '-threads', '1', '-f', 'rawvideo', '-']
    size = DETECTOR['width'] * DETECTOR['height'] * 3
    with shots.resource_slot('prepare', timeout=600):
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL)
        timer = threading.Timer(_decode_timeout(lookback+stop-start), process.kill)
        timer.daemon = True
        timer.start()
        count = 0
        try:
            while raw := process.stdout.read(size):
                if len(raw) != size or count >= end-first:
                    raise ValueError('movie edit span decoder returned a different frame range')
                count += 1
                yield np.frombuffer(raw, dtype=np.uint8).reshape(DETECTOR['height'], DETECTOR['width'], 3)
            if process.wait(timeout=5) or count != end-first:
                raise ValueError('movie edit span decoder did not return every selected source frame')
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            process.stdout.close()


def _mae(a, b):
    import numpy as np
    return float(np.abs(a.astype(np.float32)-b.astype(np.float32)).mean())


def _structure(a, b, mask=None):
    """Remove global contrast, exposure and tint before testing changed structure."""
    import numpy as np
    source, target = a.astype(np.float32), b.astype(np.float32)
    old = source.reshape(-1, 3) if mask is None else source[mask]
    new = target.reshape(-1, 3) if mask is None else target[mask]
    gain, offset = np.ones(3), np.median(new-old, axis=0)
    # Fit corresponding pixels, not independent histograms: a subtitle change
    # must not manufacture apparent changes in untouched picture regions.
    for _ in range(DETECTOR['photometric_fit_iterations']):
        errors = np.abs(new-(old*gain+offset))
        cutoff = np.percentile(errors, DETECTOR['photometric_inlier_fraction']*100, axis=0)
        for channel in range(3):
            keep = errors[:, channel] <= cutoff[channel]+1e-6
            x, y = old[keep, channel], new[keep, channel]
            variance = float(np.var(x))
            if variance > 1.:
                slope = float(np.mean((x-x.mean())*(y-y.mean())) / variance)
                gain[channel] = np.clip(slope, DETECTOR['photometric_gain_min'], DETECTOR['photometric_gain_max'])
            offset[channel] = np.median(y-gain[channel]*x)
    residual = np.abs(target-np.clip(source*gain+offset, 0, 255)).mean(axis=2)
    return residual, float(residual.mean() if mask is None else residual[mask].mean())


def _motion_residual(before, after):
    """Reject a jump explained by an affine camera move plus global exposure."""
    import cv2
    import numpy as np
    a = cv2.cvtColor(before, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    b = cv2.cvtColor(after, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_AFFINE,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 3)
    except cv2.error:
        return {'fitted': False}
    dimensions = (before.shape[1], before.shape[0])
    aligned = cv2.warpAffine(after, warp, dimensions, flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    mask = cv2.warpAffine(np.ones(before.shape[:2], np.uint8), warp, dimensions,
                          flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP).astype(bool)
    overlap = float(mask.mean())
    if overlap < DETECTOR['minimum_motion_overlap']:
        return {'fitted': False, 'overlap': round(overlap, 6)}
    _, residual = _structure(before, aligned, mask)
    return {'fitted': True, 'overlap': round(overlap, 6), 'residual': round(residual, 6),
            'affine': [[round(float(v), 6) for v in row] for row in warp]}


def _times(clock, first, end):
    return [refinement.source_frame_time(clock, number) for number in range(first, end)]


def _candidate_indices(jumps, first, clock):
    """Offsets (relative to ``first``) of persistent-switch candidates."""
    import numpy as np
    times = _times(clock, first, first+len(jumps))
    candidates = []
    for i in range(1, len(jumps)):
        jump = jumps[i]
        if jump < DETECTOR['minimum_jump']:
            continue
        left = bisect_left(times, times[i]-DETECTOR['stable_seconds'])
        right = bisect_right(times, times[i]+DETECTOR['stable_seconds'])
        surrounding = [jumps[j] for j in range(max(1, left), right) if j != i]
        background = float(np.percentile(surrounding, 90)) if surrounding else jump
        if jump >= max(DETECTOR['minimum_jump'], 1.+DETECTOR['jump_over_background']*background):
            candidates.append(i)
    return candidates


def _decision(item):
    if type(item.get('enough_context')) is not bool:
        raise ValueError('movie edit span context evidence is invalid')
    if not item.get('enough_context'):
        return 'insufficient_stable_context'
    for key in ('before_stability', 'after_stability', 'structure_mae', 'persistent_jump', 'jump'):
        value = item[key]
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 255:
            raise ValueError('movie edit span decision contains invalid measurements')
    if (type(item['return_match']) is not bool or type(item['informative_sides']) is not bool
            or type(item['changed_regions']) is not int or not 0 <= item['changed_regions'] <= 12
            or type(item['changed_region_rows']) is not int or not 0 <= item['changed_region_rows'] <= 3
            or type(item['changed_region_columns']) is not int or not 0 <= item['changed_region_columns'] <= 4
            or type(item['motion'].get('fitted')) is not bool):
        raise ValueError('movie edit span decision evidence is invalid')
    motion = item['motion']
    if motion['fitted'] and (type(motion.get('residual')) not in (int, float)
            or not math.isfinite(motion['residual']) or not 0 <= motion['residual'] <= 255
            or type(motion.get('overlap')) not in (int, float)
            or not DETECTOR['minimum_motion_overlap'] <= motion['overlap'] <= 1):
        raise ValueError('movie edit span motion evidence is invalid')
    if max(item['before_stability'], item['after_stability']) > DETECTOR['maximum_stable_mae']:
        return 'moving_or_gradual_context'
    if item['return_match']:
        return 'brief_return_or_flash'
    if not item['informative_sides']:
        return 'exposure_or_flat_picture'
    if (item['structure_mae'] < DETECTOR['minimum_structure_mae']
            or item['changed_regions'] < DETECTOR['minimum_changed_regions']
            or item['changed_region_rows'] < DETECTOR['minimum_changed_region_rows']
            or item['changed_region_columns'] < DETECTOR['minimum_changed_region_columns']):
        return 'exposure_or_local_change'
    if item['persistent_jump'] < max(DETECTOR['minimum_jump'],
                                     item['jump']*DETECTOR['minimum_persistence_ratio']):
        return 'nonpersistent_change'
    if (motion.get('fitted') and motion['residual'] <= DETECTOR['maximum_motion_residual']
            and motion['residual'] <= item['structure_mae']*DETECTOR['maximum_motion_ratio']):
        return 'camera_motion'
    return 'verified_static_cut'


def _inspect_candidate(video, clock, parent, jumps, thumbnails, times, offset):
    import numpy as np
    number = parent['frame_start']+offset
    point = times[offset]
    left = bisect_left(times, point-DETECTOR['return_seconds'])
    right = bisect_right(times, point+DETECTOR['return_seconds'])
    pictures = list(_decode(video, clock, parent['frame_start']+left, parent['frame_start']+right))
    if len(pictures) != right-left:
        raise ValueError('movie edit span context does not match the source frame scan')
    for thumbnail, picture in zip(thumbnails[left:right], pictures):
        if _hash_bytes(picture.tobytes()) != thumbnail:
            raise ValueError('movie edit span context does not match the source frame scan')
    before = [j for j in range(left, offset) if times[j] >= point-DETECTOR['stable_seconds']]
    after = [j for j in range(offset, right) if times[j] <= point+DETECTOR['stable_seconds']]
    item = {'frame_index': number, 'pts': clock['frame_pts'][number], 'time': point,
            'jump': jumps[offset], 'context_frame_start': parent['frame_start']+left,
            'context_frame_end': parent['frame_start']+right,
            'enough_context': (len(before) >= 3 and len(after) >= 3
                and times[before[-1]]-times[before[0]] >= DETECTOR['minimum_stable_seconds']
                and times[after[-1]]-times[after[0]] >= DETECTOR['minimum_stable_seconds'])}
    if not item['enough_context']:
        item['decision'] = _decision(item)
        return item
    a = np.median(np.stack([pictures[j-left] for j in before]), axis=0).astype(np.uint8)
    b = np.median(np.stack([pictures[j-left] for j in after]), axis=0).astype(np.uint8)
    residual, structure = _structure(a, b)
    regions = [float(tile.mean()) for row in np.array_split(residual, 3, axis=0)
               for tile in np.array_split(row, 4, axis=1)]
    changed = [i for i, value in enumerate(regions) if value >= DETECTOR['region_structure_mae']]
    earlier = [j for j in range(left, before[0])]
    later = [j for j in range(after[-1]+1, right)]
    returns = [_mae(pictures[j-left], b) for j in earlier] + [_mae(pictures[j-left], a) for j in later]
    item.update(before_stability=round(max(_mae(pictures[j-left], a) for j in before), 6),
        after_stability=round(max(_mae(pictures[j-left], b) for j in after), 6),
        persistent_jump=round(min(_mae(pictures[j-left], a) for j in after), 6),
        return_match=bool(returns and min(returns) <= DETECTOR['maximum_stable_mae']),
        informative_sides=bool(min(float(a.std()), float(b.std())) >= DETECTOR['minimum_picture_std']),
        structure_mae=round(structure, 6),
        changed_regions=len(changed), changed_region_rows=len({i//4 for i in changed}),
        changed_region_columns=len({i%4 for i in changed}),
        motion=_motion_residual(a, b))
    item['decision'] = _decision(item)
    return item


def _pts_digest(clock, first, end):
    return _hash_bytes(_bytes(clock['frame_pts'][first:end]))


def _analyze(video, clock, parent):
    """Scan once; persist a compact per-frame jump list, not per-frame rows."""
    jumps, thumbnails, previous = [], [], None
    for picture in _decode(video, clock, parent['frame_start'], parent['frame_end']):
        thumbnails.append(_hash_bytes(picture.tobytes()))
        jumps.append(round(_mae(previous, picture), 6) if previous is not None else 0.)
        previous = picture
    if len(jumps) != parent['frame_end']-parent['frame_start']:
        raise ValueError('movie edit span decoder did not return every selected source frame')
    times = _times(clock, parent['frame_start'], parent['frame_end'])
    indices = _candidate_indices(jumps, parent['frame_start'], clock)
    inspected = ([] if len(indices) > DETECTOR['maximum_candidates'] else
                 [_inspect_candidate(video, clock, parent, jumps, thumbnails, times, i) for i in indices])
    accepted = [item for item in inspected if item['decision'] == 'verified_static_cut']
    status = ('ambiguous_candidate_budget' if len(indices) > DETECTOR['maximum_candidates'] else
              'verified_static_cuts' if accepted else 'no_verified_internal_cut')
    scan = {'format': DETECTOR['frame_scan_format'], 'frame_start': parent['frame_start'],
            'frame_end': parent['frame_end'], 'pts_sha256': _pts_digest(clock, parent['frame_start'], parent['frame_end']),
            'thumbnail_chain_sha256': _hash_bytes(''.join(thumbnails).encode()), 'rgb_jump': jumps}
    return {'schema': VERSION, 'source_sha256': clock['source_sha256'], 'frame_clock_id': clock['clock_id'],
            'parent': parent, 'detector': copy.deepcopy(DETECTOR), 'frame_scan': scan,
            'candidate_count': len(indices), 'candidates': inspected, 'status': status}


def _unscanned_status(parent):
    """Short parents need no scan; very long parents are not decoded frame by frame."""
    duration = parent['end']-parent['start']
    if duration < DETECTOR['long_shot_seconds']:
        return 'not_scanned_short'
    if duration > DETECTOR['maximum_scan_seconds']:
        return 'not_scanned_long'
    return None


def _spans(binding, parent_id, parent, cuts, clock):
    boundaries = [parent['frame_start']] + [item['frame_index'] for item in cuts] + [parent['frame_end']]
    result = []
    for first, end in zip(boundaries, boundaries[1:]):
        material = {key: binding[key] for key in ('schema', 'source_sha256', 'frame_clock_id', 'detector')}
        material.update(parent_shot_id=parent_id, frame_start=first, frame_end=end)
        result.append({'span_id': 'edit_'+digest(material)[:24], 'parent_shot_id': parent_id,
            'frame_start': first, 'frame_end': end, 'start': refinement.source_frame_time(clock, first),
            'end': refinement.source_frame_time(clock, end)})
    return result


def _integrity(out, proof):
    body = {key: value for key, value in proof.items() if key != 'proof_id'}
    proof_id = proof.get('proof_id')
    if proof_id != digest(body) or proof.get('schema') != VERSION:
        raise ValueError('movie edit span proof changed')
    archive = out / HISTORY / (proof_id+'.json')
    if archive.is_symlink() or not archive.is_file() or archive.read_bytes() != _bytes(proof):
        raise ValueError('movie edit span proof archive missing or changed')
    for row in proof['shots'].values():
        analysis = row['analysis']
        if analysis['status'] in NOT_SCANNED:
            continue
        expected = EVIDENCE+'/'+analysis['sha256']+'.json'
        if analysis.get('path') != expected:
            raise ValueError('movie edit span analysis path changed')
        path = out / expected
        if (path.is_symlink() or not path.resolve().is_relative_to(out.resolve())
                or not path.is_file() or _hash_bytes(path.read_bytes()) != analysis['sha256']):
            raise ValueError('movie edit span frame analysis missing or changed')


def _validate(out, timeline, clock, proof):
    _integrity(out, proof)
    binding = _binding(timeline, clock)
    if any(proof.get(key) != value for key, value in binding.items()):
        raise ValueError('movie edit span proof belongs to stale inputs')
    if (not isinstance(proof.get('selected_shot_ids'), list)
            or proof['selected_shot_ids'] != sorted(proof['shots'])):
        raise ValueError('movie edit span proof scope changed')
    parents = {row['shot_id']: row for row in timeline['shots']}
    for parent_id, row in proof['shots'].items():
        if parent_id not in parents:
            raise ValueError('movie edit span parent is absent')
        parent = _parent(parents[parent_id], clock)
        if any(row.get(key) != value for key, value in parent.items()):
            raise ValueError('movie edit span parent coverage changed')
        analysis = row['analysis']
        if analysis.get('frame_count') != parent['frame_end']-parent['frame_start']:
            raise ValueError('movie edit span analysis coverage changed')
        unscanned = _unscanned_status(parent)
        if unscanned:
            if analysis != {'status': unscanned, 'frame_count': parent['frame_end']-parent['frame_start'],
                            'decoded_frames': 0} or row['cuts']:
                raise ValueError('unscanned movie edit span must retain its single parent range')
        else:
            if (analysis['status'] not in {'verified_static_cuts', 'no_verified_internal_cut', 'ambiguous_candidate_budget'}
                    or analysis.get('decoded_frames') != analysis['frame_count']):
                raise ValueError('movie edit span analysis status is invalid')
            data = _read(out / analysis['path'])
            if (data.get('schema') != VERSION or data.get('parent') != parent
                    or data.get('detector') != DETECTOR or data.get('source_sha256') != clock['source_sha256']
                    or data.get('frame_clock_id') != clock['clock_id'] or data.get('status') != analysis['status']):
                raise ValueError('movie edit span frame analysis binding changed')
            scan = data['frame_scan']
            jumps = scan['rgb_jump']
            chain = scan['thumbnail_chain_sha256']
            if (scan.get('format') != DETECTOR['frame_scan_format'] or not isinstance(jumps, list)
                    or len(jumps) != analysis['frame_count']
                    or (scan['frame_start'], scan['frame_end']) != (parent['frame_start'], parent['frame_end'])):
                raise ValueError('movie edit span frame analysis is incomplete')
            if (scan['pts_sha256'] != _pts_digest(clock, parent['frame_start'], parent['frame_end'])
                    or not isinstance(chain, str) or len(chain) != 64
                    or any(c not in '0123456789abcdef' for c in chain)
                    or any(type(jump) not in (int, float) or not math.isfinite(jump) or not 0 <= jump <= 255
                           for jump in jumps)):
                raise ValueError('movie edit span analyzed frame changed')
            indices = _candidate_indices(jumps, parent['frame_start'], clock)
            expected = [] if len(indices) > DETECTOR['maximum_candidates'] else [parent['frame_start']+i for i in indices]
            if data['candidate_count'] != len(indices) or [item['frame_index'] for item in data['candidates']] != expected:
                raise ValueError('movie edit span candidate analysis changed')
            for item in data['candidates']:
                number = item['frame_index']
                if (item['pts'] != clock['frame_pts'][number]
                        or item['time'] != refinement.source_frame_time(clock, number)
                        or not parent['frame_start'] <= number < parent['frame_end']
                        or item['jump'] != jumps[number-parent['frame_start']]
                        or item['decision'] != _decision(item)):
                    raise ValueError('movie edit span cut evidence changed')
            accepted = [item for item in data['candidates'] if item['decision'] == 'verified_static_cut']
            status = ('ambiguous_candidate_budget' if len(indices) > DETECTOR['maximum_candidates'] else
                      'verified_static_cuts' if accepted else 'no_verified_internal_cut')
            if row['cuts'] != accepted or analysis['status'] != status:
                raise ValueError('movie edit span cuts differ from verified evidence')
        if row['spans'] != _spans(binding, parent_id, parent, row['cuts'], clock):
            raise ValueError('movie edit spans no longer partition their parent')
    return proof


def load(out: Path, timeline: dict, clock: dict, *, proof_id=None):
    """Missing active proof means no exemptions; malformed/stale proof is an error."""
    out = Path(out)
    if proof_id is not None and (not isinstance(proof_id, str) or len(proof_id) != 64
                                  or any(c not in '0123456789abcdef' for c in proof_id)):
        raise ValueError('invalid movie edit span proof id')
    path = out / (HISTORY+'/'+proof_id+'.json' if proof_id else FILE)
    if path.is_symlink():
        raise ValueError('movie edit span proof path changed')
    if not path.exists() and proof_id is None:
        return None
    try:
        proof = _read(path)
        if proof_id is not None and proof.get('proof_id') != proof_id:
            raise ValueError('movie edit span archive identity changed')
        return _validate(out, timeline, clock, proof)
    except (KeyError, TypeError, AttributeError, OSError) as exc:
        raise ValueError('movie edit span proof missing or invalid') from exc


def validate(out: Path, timeline: dict, clock: dict, *, proof_id=None):
    return load(out, timeline, clock, proof_id=proof_id)


def prepare(out: Path, timeline: dict, clock: dict, selected_ids: set[str]):
    """Analyze only new selected long parents; reuse immutable analysis on repeat."""
    out = Path(out)
    if not isinstance(selected_ids, (set, frozenset)) or any(not isinstance(key, str) for key in selected_ids):
        raise ValueError('movie edit span selection must be a set of parent ids')
    binding = _binding(timeline, clock)
    parents = {row['shot_id']: row for row in timeline['shots']}
    if not selected_ids <= parents.keys():
        raise ValueError('movie edit span selection contains an unknown parent')
    out.mkdir(parents=True, exist_ok=True)
    with (out / '.source_edit_spans.lock').open('a') as lock:
        file_lock.flock(lock, file_lock.LOCK_EX)
        previous = _read(out / FILE) if (out / FILE).exists() else None
        retained = {}
        if previous is not None:
            _integrity(out, previous)
            if all(previous.get(key) == value for key, value in binding.items()):
                _validate(out, timeline, clock, previous)
                if selected_ids <= previous['shots'].keys():
                    return previous
                retained = copy.deepcopy(previous['shots'])
        for parent_id in sorted(selected_ids-retained.keys()):
            parent = _parent(parents[parent_id], clock)
            unscanned = _unscanned_status(parent)
            if unscanned:
                analysis = {'status': unscanned, 'frame_count': parent['frame_end']-parent['frame_start'],
                            'decoded_frames': 0}
                cuts = []
            else:
                video = _source(timeline, clock)
                signature = video.stat()
                data = _analyze(video, clock, parent)
                after = video.stat()
                if ((signature.st_size, signature.st_mtime_ns, signature.st_ctime_ns, signature.st_ino)
                        != (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_ino)):
                    raise ValueError('movie edit span source changed during analysis')
                checksum = _hash_bytes(_bytes(data))
                path = EVIDENCE+'/'+checksum+'.json'
                _immutable(out / path, data)
                count = len(data['frame_scan']['rgb_jump'])
                analysis = {'status': data['status'], 'frame_count': count,
                            'decoded_frames': count, 'path': path, 'sha256': checksum}
                cuts = [item for item in data['candidates'] if item['decision'] == 'verified_static_cut']
            retained[parent_id] = {**parent, 'analysis': analysis, 'cuts': cuts,
                                  'spans': _spans(binding, parent_id, parent, cuts, clock)}
        proof = {**binding, 'selected_shot_ids': sorted(retained),
                 'shots': {key: retained[key] for key in sorted(retained)}}
        proof['proof_id'] = digest(proof)
        _immutable(out / HISTORY / (proof['proof_id']+'.json'), proof)
        _validate(out, timeline, clock, proof)
        atomic_json(out / FILE, proof)
        return proof


def locate(proof, parent_id, first, end):
    """Locate a window within one validated span; crossing a cut is not exempt."""
    if type(first) is not int or type(end) is not int or first >= end:
        raise ValueError('invalid source frame interval for movie edit span')
    parent = proof['shots'].get(parent_id) if proof is not None else None
    if parent is None:
        return None
    for span in parent['spans']:
        if span['frame_start'] <= first < end <= span['frame_end']:
            return copy.deepcopy(span)
    raise ValueError('source window crosses a verified internal cut or parent boundary')
