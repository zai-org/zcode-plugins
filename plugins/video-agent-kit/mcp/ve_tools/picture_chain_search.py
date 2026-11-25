"""Bounded whole-shot search for chains that greedy selection cannot align.

Search changes shot choices and the length of reviewable long-shot excerpts.
It never changes speech timestamps, evidence policies or short-shot boundaries.
The normal semantic and EDL audits still run on the selected result.
"""
from __future__ import annotations

import itertools
import math

from .picture_semantics import audit_requirements, map_intervals, policy
from .picture_source import edit_ranges, span_metadata
from .source_usage import ChainLedger, audit_chain_usage, normalize_window, verified_pool

SEARCH_BEAM_SIZE = 64
SEARCH_MAX_EXPANSIONS = 20000


def _rows(chain: list[dict], sentences: list[dict], fps: float, *,
          source_edit_proof: dict | None = None, source_clock: dict | None = None) -> list[dict]:
    windows = [{"shot_id": p["shot_id"], "start_frame": round(p["start"] * fps),
                "end_frame": round(p["end"] * fps)} for p in chain]
    if source_edit_proof is not None:
        for piece, window in zip(chain, windows):
            source = normalize_window(piece, fps, source_edit_proof=source_edit_proof, source_clock=source_clock)
            window.update(source_start=source['source_start'], source_end=source['source_end'])
    units = [{**s, "unit_id": s.get("unit_id", f"unit_{i}"),
              "event_ids": s.get("event_ids", []), "claim_ids": s.get("claim_ids", [])}
             for i, s in enumerate(sentences)]
    return map_intervals(windows, units, fps)


def chain_issues(chain: list[dict], sentences: list[dict], fps: float, *,
                 source_edit_proof: dict | None = None,
                 source_clock: dict | None = None) -> list[dict]:
    source_args = {'source_edit_proof': source_edit_proof, 'source_clock': source_clock}
    physical = source_edit_proof is not None or any(span_metadata(piece) for piece in chain)
    usage = []
    if physical:
        usage = audit_chain_usage(chain, fps, **source_args)
    try:
        rows = _rows(chain, sentences, fps, **source_args)
    except ValueError:
        if usage:
            return usage
        raise
    issues = audit_requirements(rows, fps)["issues"] + usage
    if not physical:
        if any(a['end'] > b['start'] + 1 / fps for a, b in zip(chain, chain[1:])):
            issues.append({'reason': 'source_intervals_overlap'})
        seen = {}
        for piece in chain:
            previous = seen.get(piece['shot_id'])
            if previous is not None and abs(previous-piece['start']) > 1 / fps:
                issues.append({'reason': 'unplanned_source_replay', 'shot_id': piece['shot_id']})
            seen[piece['shot_id']] = piece['end']
    for sentence, row in zip(sentences, rows):
        if "allowed_shot_ids" in sentence:
            unsupported = {o["shot_id"] for o in row["overlaps"]
                           if o["seconds"] > 1 / fps + 1e-6
                           and o["shot_id"] not in sentence["allowed_shot_ids"]}
            if unsupported:
                issues.append({"semantic_unit_id": row["semantic_unit_id"],
                               "reason": "unsupported_picture_overlap",
                               "shot_ids": sorted(unsupported)})
    return issues


def _reserved_ends(pool: list[dict], sentences: list[dict], audio_dur: float,
                   long_shot_sec: float) -> dict[str, set[float]]:
    """Give a long shot room for subsequent complete required shots.

    At most three later sentences and 64 combinations supply extra endpoints;
    ordinary sentence boundaries are also considered by the search. These are
    scheduling candidates, never permissions to crop a short shot.
    """
    by_id = {p["shot_id"]: p for p in pool}
    ends = {}
    for shot in pool:
        if shot["dur"] <= long_shot_sec:
            continue
        choices = []
        for s in sentences:
            requirements = policy(s)
            if requirements["visual_requirement"] != "required":
                continue
            ids = requirements["required_shot_ids"] or requirements["candidate_shot_ids"]
            later = [by_id[sid] for sid in ids if sid in by_id
                     and by_id[sid]["start"] >= shot["end"] - 1e-6
                     and by_id[sid]["dur"] <= long_shot_sec
                     and not by_id[sid].get("reviewed_span")]
            if not later:
                continue
            if requirements["required_shot_ids"]:
                if len(later) != len(requirements["required_shot_ids"]):
                    continue
                choices.append([sum(p["dur"] for p in later)])
            else:
                choices.append(sorted({p["dur"] for p in later})[:4])
        endpoints = set()
        for count in range(1, min(3, len(choices)) + 1):
            for durations in itertools.islice(itertools.product(*choices[-count:]), 64):
                endpoints.add(audio_dur - sum(durations))
        ends[shot["shot_id"]] = endpoints
    return ends


def search_chain(pool: list[dict], sentences: list[dict], audio_dur: float,
                 fps: float, long_shot_sec: float, min_window: float,
                 tail_cap: float, *, source_edit_proof: dict | None = None,
                 source_clock: dict | None = None) -> tuple[list[dict] | None, dict]:
    """Search a bounded set of monotonic, non-repeating whole-shot chains.

    Irreversible sentence failures are pruned immediately. A bounded search may
    find no solution even when one exists; it returns that fact to the normal
    failure path instead of relaxing requirements.
    """
    source_args = {'source_edit_proof': source_edit_proof, 'source_clock': source_clock}
    pool = verified_pool(pool, fps, **source_args)
    shots = []
    for shot in pool:
        for source_span in edit_ranges(shot):
            a, b = source_span['start'], source_span['end']
            natural_duration = source_span['span_end'] - source_span['span_start']
            starts = {a}
            if natural_duration > long_shot_sec:
                for sentence in sentences:
                    for cue in sentence.get('picture_cues', []):
                        if cue['shot_id'] == shot['shot_id'] and 'sample_span' in cue:
                            first, last = cue['sample_span']
                            starts.update((max(a, first - min(.5, cue['min_seconds'] / 2)), first))
            for left in sorted(starts):
                if a <= left < b:
                    shots.append({**shot, 'start': left, 'end': b, 'dur': natural_duration,
                                  'source_bounds': [shot['start'], shot['end']], **span_metadata(source_span)})
    shots.sort(key=lambda p: (p['start'], p['shot_id']))
    ends = _reserved_ends(shots, sentences, audio_dur, long_shot_sec)
    tolerance = 0.5 / fps
    minimum_frames = math.ceil(min_window * fps - 1e-7)
    target_frames = math.ceil(audio_dur * fps - 1e-7)
    policies = [policy(s) for s in sentences]
    # (chain, first remaining source-shot index, output frames, support score,
    #  incremental source ledger of the already-passed prefix)
    beam = [([], 0, 0, 0.0, ChainLedger(fps, **source_args) if source_edit_proof is not None else None)]
    best = None
    best_rank = None
    expansions = 0
    exhausted = False

    for _ in range(min(len(shots), 2 * len(sentences) + 4)):
        next_states = []
        for chain, next_index, frames, _support, ledger in beam:
            output_start = frames / fps
            for pi in range(next_index, len(shots)):
                p = shots[pi]
                if chain and (p['start'] < chain[-1]['end'] - tolerance
                              or (source_edit_proof is None and p['shot_id'] in {q['shot_id'] for q in chain})):
                    continue
                span = p.get("reviewed_span") or [p["start"], p["end"]]
                left = max(p["start"], span[0])
                right = min(p["end"], span[1])
                sf, ef = round(left * fps), round(right * fps)
                if ef - sf < minimum_frames:
                    continue
                if p.get("reviewed_span") or p["dur"] <= long_shot_sec:
                    end_frames = [ef]
                else:
                    targets = {audio_dur, output_start + min_window}
                    targets.update(ends.get(p["shot_id"], ()))
                    for s in sentences:
                        exposure = min(0.25, (s["end"] - s["start"]) / 2)
                        targets.update((s["start"], s["end"],
                                        s["start"] + exposure, s["end"] - exposure))
                        for cue in s.get('picture_cues', []):
                            if cue['shot_id'] == p['shot_id'] and 'sample_span' in cue:
                                targets.update((output_start + cue['sample_span'][1] - left + 1 / fps,
                                                output_start + cue['min_seconds']))
                    end_frames = sorted({min(ef, sf + max(minimum_frames,
                                         round((t - output_start) * fps)))
                                         for t in targets if t > output_start + tolerance})
                for end_frame in end_frames:
                    expansions += 1
                    if expansions > SEARCH_MAX_EXPANSIONS:
                        exhausted = True
                        break
                    # Preserve natural short-shot boundaries; quantize only a
                    # long excerpt endpoint, as the final EDL must use frames.
                    end = right if end_frame == ef else end_frame / fps
                    piece = {"shot_id": p["shot_id"], "start": left, "end": end,
                             "dur": end - left,
                             "partial": left > p['source_bounds'][0] + 1e-6 or end < p['source_bounds'][1] - 1e-6,
                             "boundary_in": p.get("boundary_in", "hard"), **span_metadata(p)}
                    candidate = chain + [piece]
                    extended = None
                    if ledger is not None:
                        problems, extended = ledger.extend(piece)
                        if problems:
                            continue
                    total_frames = frames + end_frame - sf
                    output_end = total_frames / fps
                    rows = _rows(candidate, sentences, fps, **source_args)
                    completed = [r for r in rows if r["tts_end"] + max(
                        (c.get('allow_after_seconds', 0) for c in r.get('picture_cues', [])), default=0)
                        <= output_end + tolerance]
                    if audit_requirements(completed, fps)["issues"]:
                        continue
                    invalid = False
                    support = 0.0
                    remaining = {q["shot_id"] for q in shots[pi + 1:]}
                    for s, requirement, row in zip(sentences, policies, rows):
                        allowed = s.get("allowed_shot_ids")
                        if allowed is not None and any(o["seconds"] > 1 / fps + 1e-6
                                                       and o["shot_id"] not in allowed
                                                       for o in row["overlaps"]):
                            invalid = True
                            break
                        exposure = {}
                        for overlap in row["overlaps"]:
                            sid = overlap["shot_id"]
                            exposure[sid] = exposure.get(sid, 0) + overlap["seconds"]
                        required = set(requirement["required_shot_ids"])
                        alternatives = set(requirement["candidate_shot_ids"])
                        threshold = min(0.25, (s["end"] - s["start"]) / 2)
                        visible = {sid for sid, seconds in exposure.items()
                                   if seconds + 1e-6 >= threshold}
                        if (requirement["visual_requirement"] == "required"
                                and (required - visible - remaining or
                                     (not required and not alternatives & (visible | remaining)))):
                            invalid = True
                            break
                        supported = required | alternatives
                        weight = 2 if requirement["visual_requirement"] == "required" else 1
                        support += weight * sum(sec for sid, sec in exposure.items() if sid in supported)
                    if invalid:
                        continue
                    if total_frames >= target_frames:
                        if chain_issues(candidate, sentences, fps, **source_args):
                            continue
                        tail = max(0, output_end - audio_dur)
                        rank = (tail > tail_cap + tolerance, round(tail, 9), -support, len(candidate),
                                tuple(q["shot_id"] for q in candidate))
                        if best_rank is None or rank < best_rank:
                            best, best_rank = candidate, rank
                    else:
                        next_states.append((candidate, pi + 1, total_frames, support, extended))
                if exhausted:
                    break
            if exhausted:
                break
        if exhausted or not next_states:
            break
        # Prefer prefixes that have covered more speech with relevant evidence.
        # Keep deterministic ties and bound both memory and work per layer.
        next_states.sort(key=lambda state: (-state[3], -state[2], len(state[0]),
                                           tuple((q["shot_id"], q["end"]) for q in state[0])))
        beam = next_states[:SEARCH_BEAM_SIZE]
    return best, {"strategy": "bounded_whole_shot_search", "expansions": min(expansions, SEARCH_MAX_EXPANSIONS),
                  "search_limit_reached": exhausted, "solution_found": best is not None}
