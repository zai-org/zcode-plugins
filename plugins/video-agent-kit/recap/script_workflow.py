"""The writing packet, the coordinator's draft and the writer script that voices it.

The packet binds the outline to the exact dialogue and observation it cites; the
draft is imported against that packet; the writer script splits the draft into
sentences with their shots without changing a word of it.
"""
from __future__ import annotations

import hashlib
import json
import re
import tempfile
from pathlib import Path

from ve_tools.visual_review import ReviewError, atomic_json, encoded, object_schema

VERSION = 'movie-writing-packet-v1'
DRAFT_SCHEMA = 'recap-coordinator-draft-v1'
TEXT = {'type': 'string'}
STRINGS = {'type': 'array', 'items': TEXT}
WRITE_SCHEMA = object_schema({
    'paragraphs': {'type': 'array', 'items': object_schema({
        'id': TEXT, 'beat_indices': {'type': 'array', 'items': {'type': 'integer'}}, 'text': TEXT})},
    'notes': {'type': 'array', 'items': object_schema({
        'paragraph_id': TEXT, 'claim': TEXT, 'source_ids': STRINGS, 'uncertainty': TEXT})},
    'open_questions': STRINGS,
})
PRODUCTION_NOTES = re.compile(r'(?:shot_\d+|\[(?:D|V|F)\d+\]|制作备注[:：]|原声插入[:：])')
KEY_ROLES = ('action', 'turn', 'payoff')


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text())


def _rows(value, key: str) -> list:
    return value.get(key, []) if isinstance(value, dict) else value


def _clean_text(value) -> str:
    if not isinstance(value, str) or not value.strip() or 'data:image/' in value:
        raise ReviewError('invalid_text')
    return value


def _keys(obj, expected):
    if not isinstance(obj, dict) or set(obj) != set(expected):
        raise ReviewError('invalid_text_result_schema')


def _ids(values, valid: set, *, nonempty=False):
    if (not isinstance(values, list) or (nonempty and not values)
            or any(not isinstance(x, str) for x in values)
            or len(set(values)) != len(values) or not set(values) <= valid):
        raise ReviewError('invalid_source_or_scope_ids')


def _source_refs(point: dict) -> list[str]:
    return list(point.get('dlg', [])) + list(point.get('vis', [])) + [
        'F' + str(n) for n in point.get('frames', [])] + list(point.get('source_ids', []))


def _dialogue_context_ids(dialogue: list[dict], selected: set[str], *,
                          max_added: int = 32) -> list[str]:
    """Keep nearby questions and replies with cited lines, without growing a scene.

    Only the original selection supplies anchors. Added lines never recursively
    expand the window, bridge long pauses, or establish a speaker's identity.
    """
    ordered = sorted(dialogue, key=lambda row: (row['start'], row['end'], row['id']))
    candidates = {}
    for index, anchor in enumerate(ordered):
        if anchor['id'] not in selected:
            continue
        for direction in (-1, 1):
            previous = anchor
            for distance in (1, 2):
                neighbor_index = index + direction * distance
                if not 0 <= neighbor_index < len(ordered):
                    break
                row = ordered[neighbor_index]
                gap = (previous['start'] - row['end'] if direction < 0
                       else row['start'] - previous['end'])
                separation = max(0, anchor['start'] - row['end'], row['start'] - anchor['end'])
                if gap > 4 or separation > 12:
                    break
                previous = row
                if row['id'] not in selected:
                    rank = (distance, separation, row['start'], row['id'])
                    candidates[row['id']] = min(candidates.get(row['id'], rank), rank)
    return sorted(candidates, key=candidates.__getitem__)[:max_added]


def _scoped_characters(packet: dict) -> list[tuple[dict, list[str]]]:
    """Bind each character observation to its own frame ids, never just a shot."""
    registry = packet.get('character_observations') or {}
    return [(character, ['F' + str(number) for number in character.get('frame_numbers', [])])
            for character in registry.get('characters', [])]


def _character_context(scoped: list[tuple[dict, list[str]]], sources: dict,
                       selected: set[str]) -> tuple[list[dict], list[str]]:
    """Keep exact-frame witnesses and their primary naming sources in one hop.

    The reader receives the complete name evidence, doubts and frame bindings.
    This neither merges identities nor changes their verdicts.
    """
    characters, additional = [], set()
    fields = ('observation_id', 'name', 'appearance', 'identity_status', 'name_evidence',
              'uncertainty', 'frame_numbers', 'source_shots', 'sample_times', 'dialogue_ids')
    for character, frames in scoped:
        if not set(frames).intersection(selected):
            continue
        missing = []
        for refs, kind in ((frames, 'sparse_frame'),
                           (character.get('dialogue_ids', []), 'dialogue_statement')):
            for ref in refs:
                if ref not in sources:
                    missing.append(ref)
                elif sources[ref]['kind'] != kind:
                    raise ReviewError('character_source_kind_mismatch')
                elif ref not in selected:
                    additional.add(ref)
        row = {key: character[key] for key in fields if key in character}
        row['source_frame_ids'] = list(frames)
        if missing:
            row['unavailable_source_ids'] = sorted(set(missing))
        characters.append(row)
    return characters, sorted(additional)


def build_packet(out: Path) -> dict:
    """Build source-bound writing materials without altering raw evidence."""
    packet = assemble_packet(out)
    packet['packet_id'] = sha(encoded(packet))
    atomic_json(out / 'writing_packet.json', packet)
    return packet


def assemble_packet(out: Path) -> dict:
    """The writing packet's content from current inputs; nothing is written."""
    from recap.native_observation import coverage_gaps, evidence_files
    gaps_left = coverage_gaps(out)
    if gaps_left:
        raise ReviewError('initial_observations_incomplete', diagnostics={'gaps': gaps_left[:20]})
    inputs = {}

    def load(name, *, required=True, text=False, jsonl=False):
        path = out / name
        if not path.exists():
            if required:
                raise ReviewError('packet_input_missing_' + name.replace('.', '_'))
            inputs[name] = None
            return None
        raw = path.read_bytes()
        inputs[name] = sha(raw)
        if text:
            return raw.decode('utf-8')
        if jsonl:
            return [json.loads(line) for line in raw.splitlines() if line.strip()]
        return json.loads(raw)

    profile = load('production_profile.json')
    # The exports below are checked against these accepted observation reports.
    for name in evidence_files(out):
        load(name)
    outline = load('outline.json')
    spine = load('story_spine.md', text=True)
    brief = load('writing_brief.txt', required=False, text=True)
    plan = load('plan.json', required=False) or []
    reel = load('reel.json', required=False) or {}
    dialogue = _rows(load('dialogue_index.json'), 'lines')
    visuals = _rows(load('visual_index.json'), 'events')
    frames = load('visual_frames.jsonl', jsonl=True)
    shots = _rows(load('shots.json'), 'shots')
    gaps = load('visual_coverage_gaps.json')
    characters = load('visual_characters.json', required=False)
    originals = load('original_audio.json', required=False) or []
    ranges = load('shot_ranges.json', required=False) or {}
    forbidden = {s for gap in gaps for s in gap.get('shot_ids', [])}
    shot_map = {s['shot_id']: {k: s[k] for k in ('shot_id', 'start', 'end', 'dur') if k in s} for s in shots}
    if len(shot_map) != len(shots):
        raise ReviewError('duplicate_shot_ids')
    catalog = {}

    def add(sid, kind, text, **metadata):
        if sid in catalog:
            raise ReviewError('duplicate_source_ids')
        catalog[sid] = {'id': sid, 'kind': kind, 'text': _clean_text(text), **metadata}

    for row in dialogue:
        add(row['id'], 'dialogue_statement', row['text'], start=row['start'], end=row['end'],
            speaker=row.get('speaker', ''), uncertainty='ASR/人物台词不自动等于已发生事实')
    observed_shots = set()
    forbidden_frame_ids = set()
    frame_refs = {}
    for row in frames:
        sid = row['shot_id']
        if sid not in shot_map:
            raise ReviewError('frame_unknown_shot')
        fid = 'F' + str(row['frame_number'])
        if fid in frame_refs:
            raise ReviewError('duplicate_source_ids')
        frame_refs[fid] = row
        if sid in forbidden:
            forbidden_frame_ids.add(fid)
            continue
        observed_shots.add(sid)
        add(fid, 'sparse_frame', row.get('visible') or '无法辨认',
            time=row['time'], shot_id=sid, uncertainty=row.get('uncertain', ''),
            event_ids=row.get('event_ids', [row['vid']] if row.get('vid') else []))
    excluded_events, visual_ids = [], set()
    for row in visuals:
        if row['vid'] in visual_ids or row['vid'] in catalog or row['vid'] in forbidden_frame_ids:
            raise ReviewError('duplicate_source_ids')
        visual_ids.add(row['vid'])
        frame_ids = ['F' + str(n['frame_number'] if isinstance(n, dict) else n)
                     for n in row.get('source_frames', [])]
        _ids(frame_ids, set(frame_refs))
        dids = row.get('dialogue_ids', [])
        _ids(dids, {d['id'] for d in dialogue})
        # A shot can occur in both observed and unavailable batches. Omit the
        # whole event if any of its evidence is unavailable: keeping its summary
        # after removing only those references would overstate the evidence.
        excluded_frames = forbidden_frame_ids.intersection(frame_ids)
        excluded_shots = forbidden.intersection(row.get('source_shots', []))
        if excluded_frames or excluded_shots:
            excluded_events.append({'source_id': row['vid'], 'reason': 'unavailable_visual_evidence',
                                    'frame_ids': sorted(excluded_frames), 'shot_ids': sorted(excluded_shots)})
            continue
        add(row['vid'], 'event_index', row['cap'], start=row['t0'], end=row['t1'],
            source_ids=frame_ids + dids, uncertainty=row.get('uncertainty', row.get('open_questions', [])),
            visible_facts=row.get('visible_facts', []), dialogue_inference=row.get('dialogue_inference', []))
    from ve_tools.recap_original_audio import subtitle_corrections
    try:
        subtitle_corrections(originals, dialogue, catalog)
    except ValueError as exc:
        raise ReviewError(str(exc)) from exc
    scoped_characters = _scoped_characters({'character_observations': characters})
    from recap.movie_editorial import planning
    budgets = {p['idx']: p for p in plan}
    beats, selected = [], set()
    for pos, beat in enumerate(outline['beats'], 1):
        idx = beat.get('idx', pos)
        points = []
        beat_sources = set()
        for point_idx, point in enumerate(beat['points'], 1):
            refs = _source_refs(point)
            _ids(refs, set(catalog), nonempty=True)
            expanded = set(refs)
            for ref in refs:
                expanded.update(catalog[ref].get('source_ids', []))
            beat_sources.update(expanded)
            points.append({'id': f'B{idx:03d}P{point_idx:02d}', 'planning_claim': point['text'],
                           'source_ids': sorted(expanded)})
        reel_beat = (reel.get('beats', {}) or {}).get(f's{idx:03d}', {})
        available = {catalog[r]['shot_id'] for r in beat_sources if catalog[r]['kind'] == 'sparse_frame'}
        requested = {s for p in beat['points'] for s in p.get('shots', [])}
        if not requested <= observed_shots - forbidden:
            raise ReviewError('point_uses_unobserved_shot')
        for fid, f in catalog.items():
            if f['kind'] == 'sparse_frame' and f['shot_id'] in requested:
                beat_sources.add(fid)
        available.update(requested)
        selected.update(beat_sources)
        originals_here = [o for o in originals if o['after_seg_id'] == f's{idx:03d}']
        # Original excerpts are data, not an acceptance of their reviewed flag.
        for original in originals_here:
            for correction in original.get('subtitle_corrections', []):
                beat_sources.add(correction['source_id'])
                selected.add(correction['source_id'])
            for row in dialogue:
                if row['end'] > original['start'] and row['start'] < original['end']:
                    beat_sources.add(row['id'])
                    selected.add(row['id'])
        context_ids = _dialogue_context_ids(dialogue, beat_sources)
        beat_sources.update(context_ids)
        selected.update(context_ids)
        _, character_context_ids = _character_context(scoped_characters, catalog, beat_sources)
        beat_sources.update(character_context_ids)
        selected.update(character_context_ids)
        beats.append({'idx': idx, 'summary': beat['summary'], 'cold_open': bool(beat.get('cold_open')),
            'points': points, 'source_ids': sorted(beat_sources), 'available_shots': sorted(available),
            'source_window': reel_beat.get('window'),
            'suggested_chars': budgets.get(idx, {}).get('chars'),
            'original_audio_after': originals_here,
            'open_questions': [catalog[r]['uncertainty'] for r in sorted(beat_sources)
                               if catalog[r].get('uncertainty') and catalog[r]['kind'] != 'dialogue_statement'],
            **planning(beat, len(outline['beats']), set(shot_map))})
        if context_ids:
            beats[-1]['dialogue_context_ids'] = sorted(context_ids)
        if character_context_ids:
            beats[-1]['character_context_source_ids'] = character_context_ids
    if [b['idx'] for b in beats] != list(range(1, len(beats) + 1)):
        raise ReviewError('outline_beat_order_invalid')
    for i, beat in enumerate(beats):
        beat['previous_summary'] = beats[i-1]['summary'] if i else ''
        beat['next_summary'] = beats[i+1]['summary'] if i+1 < len(beats) else ''
    reviewed_ranges = {sid: r for sid, r in ranges.items() if sid in observed_shots}
    from recap.story_budget import plan_budget
    packet = {'schema_version': VERSION, 'inputs': inputs,
        'profile': {k: profile[k] for k in ('title', 'target_minutes', 'voice', 'tts_provider',
                    'measured_chars_per_sec', 'target_chars', 'duration_policy') if k in profile},
        'story_spine': spine, 'characters': outline.get('characters', []),
        'character_observations': characters,
        'writing_brief': brief, 'beats': beats,
        'sources': {sid: catalog[sid] for sid in sorted(selected)},
        'shots': {sid: shot_map[sid] for b in beats for sid in b['available_shots']},
        'reviewed_shot_ranges': reviewed_ranges,
        'visual_gaps': [{'start': g.get('start'), 'end': g.get('end'), 'status': g.get('status'),
                         'shot_ids': g.get('shot_ids', [])} for g in gaps],
        'narration_budget': plan_budget(profile, beats, reel, shot_map, originals,
                                        reviewed_ranges=reviewed_ranges),
        'limitations': ['稀疏帧不是连续动作观看', '角色表及大纲是作者主张，需要核对引用',
                        'V 是索引，具体事实须读 F/D；尚未实际回听最终声音']}
    if excluded_events:
        packet['excluded_visual_events'] = excluded_events
    return packet


def validate_packet(packet: dict, out: Path | None = None) -> None:
    """The packet is unchanged and, with ``out``, still bound to its current inputs."""
    if (packet.get('schema_version') != VERSION or packet.get('packet_id') !=
            sha(encoded({k: v for k, v in packet.items() if k != 'packet_id'}))):
        raise ReviewError('writing_packet_manifest_changed')
    if out is None:
        return
    for name, expected in packet['inputs'].items():
        path = out / name
        actual = sha(path.read_bytes()) if path.exists() else None
        if actual != expected:
            raise ReviewError('writing_packet_stale_' + name.replace('.', '_'))


def prose_sentences(writer: dict) -> list[dict]:
    """Writer sentences with stable ids (B<beat>S<n>) and their picture fields.

    ``visual_claim`` marks a sentence that says something concrete the picture
    must show; only those sentences are checked against their arranged frames.
    """
    rows = []
    seen = set()
    for pos, beat in enumerate(writer['beats'], 1):
        idx = beat.get('idx', pos)
        if type(idx) is not int or idx in seen:
            raise ReviewError('writer_beat_ids_invalid')
        seen.add(idx)
        for i, sentence in enumerate(beat['sentences'], 1):
            text = _clean_text(sentence['text'])
            if PRODUCTION_NOTES.search(text):
                raise ReviewError('production_notes_in_prose')
            if type(sentence.get('visual_claim')) is not bool:
                raise ReviewError('writer_visual_claim_required', diagnostics={
                    'sentence_id': f'B{idx:03d}S{i:03d}'})
            rows.append({'id': f'B{idx:03d}S{i:03d}', 'beat_idx': idx, 'text': text,
                         'role': sentence.get('role', ''), 'point': sentence.get('point'),
                         'visual_claim': sentence['visual_claim'],
                         'shots': sentence.get('shots', []), 'board': sentence.get('board', []),
                         'visual_requirement': sentence.get('visual_requirement'),
                         'required_shot_ids': sentence.get('required_shot_ids', []),
                         'candidate_shot_ids': sentence.get('candidate_shot_ids', []),
                         **{k: sentence[k] for k in ('picture_intent', 'picture_cues') if k in sentence}})
    if not rows:
        raise ReviewError('empty_writer_script')
    return rows


def _paragraphs(draft: str) -> list[str]:
    return [p.strip() for p in re.split(r'\n\s*\n', draft.strip())]


def validate_conversion(out: Path, packet: dict, sentences: list[dict]) -> None:
    """The writer script says exactly the imported draft, beat by beat, with valid shots."""
    from recap.movie_editorial import prose_issues
    from ve_tools.movie_picture import bind, forbidden
    normalize = lambda text: re.sub(r'\s+', '', text)
    draft = (out / 'draft_story.md').read_text()
    blocked = [r for r in prose_issues([{'id': s['id'], 'text': s['text']} for s in sentences])
               if r['severity'] == 'must_fix']
    if blocked:
        raise ReviewError('production_notes_in_prose', diagnostics={'issues': blocked})
    if normalize(draft) != normalize(''.join(s['text'] for s in sentences)):
        raise ReviewError('writer_changed_draft_prose_or_order')
    if sorted({s['beat_idx'] for s in sentences}) != [b['idx'] for b in packet['beats']]:
        raise ReviewError('writer_does_not_cover_outline_beats')
    notes = read_json(out / 'script_notes.json') if (out / 'script_notes.json').is_file() else {}
    if (notes.get('schema_version') != VERSION or notes.get('packet_id') != packet['packet_id']
            or notes.get('draft_sha256') != sha((out / 'draft_story.md').read_bytes())):
        raise ReviewError('draft_notes_inputs_changed')
    mapping = notes.get('paragraph_map', [])
    paragraphs = _paragraphs(draft)
    if len(paragraphs) != len(mapping):
        raise ReviewError('draft_paragraph_map_changed')
    for paragraph, entry in zip(paragraphs, mapping):
        assigned = ''.join(s['text'] for s in sentences if s['beat_idx'] in entry['beat_indices'])
        if normalize(paragraph) != normalize(assigned):
            raise ReviewError('writer_moved_paragraph_or_original_audio_anchor')
    by_beat = {b['idx']: set(b['available_shots']) for b in packet['beats']}
    positions, counts = {}, {}
    for sentence in sentences:
        idx = sentence['beat_idx']
        positions[idx] = positions.get(idx, 0) + 1
        refs = sentence['shots'] + sentence['required_shot_ids'] + sentence['candidate_shot_ids']
        try:
            expression = bind(sentence, packet, idx, positions[idx])
        except (ValueError, KeyError, TypeError) as error:
            raise ReviewError('picture_expression_invalid', diagnostics={
                'sentence_id': sentence['id'], 'detail': str(error)}) from None
        refs += [cue['shot_id'] for cue in expression.get('picture_cues', [])]
        if set(refs) & forbidden(expression):
            raise ReviewError('picture_plan_premature_reveal', diagnostics={'sentence_id': sentence['id']})
        if sentence['board']:
            if ''.join(row['text'] for row in sentence['board']) != sentence['text']:
                raise ReviewError('board_changes_prose')
            refs += [s for row in sentence['board'] for s in row.get('shots', [])]
        _ids(list(dict.fromkeys(refs)), by_beat[idx])
        if sentence['visual_requirement'] not in (None, 'required', 'background'):
            raise ReviewError('invalid_visual_requirement')
        if sentence['visual_requirement'] == 'background' and sentence['role'] in KEY_ROLES:
            raise ReviewError('key_action_cannot_be_background')
    for sentence in sentences:
        idx = sentence['beat_idx']
        counts[idx] = counts.get(idx, 0) + 1
        if any(c.get('allow_after_seconds', 0) for c in sentence.get('picture_cues', [])) and counts[idx] != positions[idx]:
            raise ReviewError('picture_hold_requires_paragraph_end')
    for beat in packet['beats']:
        for limit in beat['picture_plan'].get('withhold', []):
            if limit.get('not_before_sentence', 1) > positions.get(limit['not_before_beat'], 0):
                raise ReviewError('picture_reveal_location_missing')


def validate_draft(value: dict, packet: dict) -> dict:
    _keys(value, WRITE_SCHEMA['properties'])
    if not isinstance(value['paragraphs'], list) or not value['paragraphs']:
        raise ReviewError('empty_draft')
    covered, paragraphs = [], {}
    for p in value['paragraphs']:
        _keys(p, ('id', 'beat_indices', 'text'))
        if not isinstance(p['id'], str) or p['id'] in paragraphs or not p['id']:
            raise ReviewError('invalid_paragraph_ids')
        if (not isinstance(p['beat_indices'], list) or not p['beat_indices']
                or any(type(idx) is not int for idx in p['beat_indices'])):
            raise ReviewError('invalid_paragraph_scope')
        covered.extend(p['beat_indices'])
        text = _clean_text(p['text'])
        if PRODUCTION_NOTES.search(text) or re.search(r'(?:^#|\n\s*\n)', text):
            raise ReviewError('production_notes_in_prose')
        paragraphs[p['id']] = p
    if covered != [b['idx'] for b in packet['beats']]:
        raise ReviewError('draft_beat_coverage_incomplete')
    for note in value['notes']:
        _keys(note, ('paragraph_id', 'claim', 'source_ids', 'uncertainty'))
        if note['paragraph_id'] not in paragraphs or not _clean_text(note['claim']) in paragraphs[note['paragraph_id']]['text']:
            raise ReviewError('draft_note_quote_invalid')
        _ids(note['source_ids'], set(packet['sources']))
        if not isinstance(note['uncertainty'], str):
            raise ReviewError('invalid_note_uncertainty')
    if not isinstance(value['open_questions'], list):
        raise ReviewError('invalid_open_questions')
    for q in value['open_questions']:
        _clean_text(q)
    from recap.movie_editorial import prose_issues
    blocked = [row for row in prose_issues(value['paragraphs']) if row['severity'] == 'must_fix']
    if blocked:
        raise ReviewError('production_notes_in_prose', diagnostics={'issues': blocked})
    return value


def _replace_text(path: Path, text: str) -> None:
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                     prefix='.draft-', delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(text)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def import_draft(out: Path, submission: dict, *, replace=False) -> dict:
    """Publish the coordinator's draft for the current packet, archiving the old one."""
    _keys(submission, ('schema', 'packet_id', 'draft'))
    packet = read_json(out / 'writing_packet.json')
    validate_packet(packet, out)
    if submission['schema'] != DRAFT_SCHEMA or submission['packet_id'] != packet['packet_id']:
        raise ReviewError('coordinator_draft_packet_mismatch')
    value = validate_draft(submission['draft'], packet)
    existing = out / 'draft_story.md'
    if existing.exists() and not replace:
        raise ReviewError('draft_exists_use_replace_draft')
    prose = '\n\n'.join(p['text'] for p in value['paragraphs']) + '\n'
    from recap.movie_editorial import report as editorial_report
    atomic_json(out / 'editorial_report.json', editorial_report(packet, value))
    if existing.exists():
        archive = out / 'script_workflow/drafts' / (sha(existing.read_bytes()) + '.md')
        archive.parent.mkdir(parents=True, exist_ok=True)
        if not archive.exists():
            archive.write_bytes(existing.read_bytes())
    _replace_text(existing, prose)
    atomic_json(out / 'script_notes.json', {'schema_version': VERSION,
        'packet_id': packet['packet_id'], 'draft_sha256': sha(prose.encode()),
        'import_id': sha(encoded(submission)), 'paragraph_map': [
            {'id': p['id'], 'beat_indices': p['beat_indices']} for p in value['paragraphs']],
        'notes': value['notes'], 'open_questions': value['open_questions']})
    return {'status': 'imported', 'paragraphs': len(value['paragraphs']),
            'characters': len(prose.strip()), 'open_questions': len(value['open_questions']),
            'next': 'Place the draft into out/writer_script.json (sentences with point, role, shots and '
                    'visual_claim), then run review.'}


def _fact_context_sources(packet: dict, idx: int, *, max_added: int = 64) -> list[str]:
    """Carry primary evidence for the nearby prose already shown to the reviewer.

    Whole source records from the preceding two outline points and the next
    opening point; never expanded recursively, never an author's summary.
    """
    beats = {beat['idx']: beat for beat in packet['beats']}
    selected = set(beats[idx]['source_ids'])
    points = list(reversed(beats.get(idx - 1, {}).get('points', [])[-2:]))
    points += beats.get(idx + 1, {}).get('points', [])[:1]
    added = []
    for point in points:
        refs = point.get('source_ids', [])
        _ids(refs, set(packet['sources']))
        # A primary source is more useful than an event index when the budget fills.
        for ref in sorted(refs, key=lambda ref: (packet['sources'][ref]['kind'] == 'event_index', ref)):
            if ref not in selected:
                added.append(ref)
                selected.add(ref)
                if len(added) == max_added:
                    return added
    return added


def _fact_characters(packet: dict, material: dict, refs: set[str]) -> list[dict]:
    """Author characters linked to or mentioned in this material (author claims, not evidence)."""
    context = encoded({k: v for k, v in material.items() if k != 'characters'}).decode()
    selected = []
    for character in packet.get('characters', []):
        name = character.get('name', '')
        aliases = character.get('aliases', [])
        terms = [name, *(aliases if isinstance(aliases, list) else [])]
        if re.fullmatch(r'[\u3400-\u9fff]{3,4}', name):
            terms.append(name[1:])
        linked = refs.intersection(character.get('source_ids', []))
        if linked or any(isinstance(term, str) and term and term in context for term in terms):
            selected.append({**character, 'source_ids': sorted(linked)})
    if not selected:
        selected = packet.get('characters', [])
    return sorted(selected, key=lambda row: encoded(row))


def fact_material(packet: dict, sentences: list[dict], idx: int) -> dict:
    """One beat's sentences with the exact sources a fact check may use."""
    beat = next(b for b in packet['beats'] if b['idx'] == idx)
    refs = set(beat['source_ids'])
    context_refs = _fact_context_sources(packet, idx)
    refs.update(context_refs)
    seed_refs = set(beat['source_ids']) - set(beat.get('character_context_source_ids', []))
    seed_refs.update(context_refs)
    characters, identity_refs = _character_context(_scoped_characters(packet), packet['sources'], seed_refs)
    refs.update(identity_refs)
    # The last two sentences before this beat and the first after it: the same
    # bounded neighbourhood as the context sources above.
    before = [s for s in sentences if s['beat_idx'] == idx - 1][-2:]
    after = [s for s in sentences if s['beat_idx'] == idx + 1][:1]
    material = {'sentences': [{'id': s['id'], 'text': s['text'], 'role': s['role']}
                              for s in sentences if s['beat_idx'] == idx],
                'context': [{'beat_idx': s['beat_idx'], 'text': s['text']} for s in before + after],
                'sources': {r: packet['sources'][r] for r in sorted(refs)},
                'character_observations': characters,
                'character_context_source_ids': identity_refs}
    if context_refs:
        material['context_source_ids'] = context_refs
    material['characters'] = _fact_characters(packet, material, refs)
    return material


def validate_review_artifacts(out: Path) -> list[str]:
    """Delivery entrypoint: the current manuscript has a current script review."""
    from recap.script_review import review_gaps
    return review_gaps(out)
