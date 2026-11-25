"""Read current source limitations before an automatic movie repair round."""
from __future__ import annotations

import json
import sys
from pathlib import Path

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()
from recap import script_workflow as sw
from recap.movie_source import source_identity
from ve_tools.visual_review import ReviewError

VERSION = 'recap-source-blockers-v1'
BINDING_FILES = ('writer_script.json', 'draft_story.md', 'writing_packet.json',
                 'script_notes.json', 'production_profile.json')


def inspect(out: Path, *, source_video: Path | None = None) -> dict:
    """Recognize a current limitation report without accepting the delivery.

    This checks the saved editorial diagnosis and its source references. It
    neither proves the diagnosis nor approves the script, pictures or video.
    Missing, stale or malformed reports leave the usual repair policy intact.
    """
    fallback = {'status': 'no_current_source_blocker'}
    try:
        report = sw.read_json(out / 'production_blockers.json')
        if (report.get('schema') != VERSION
                or report.get('status') != 'needs_primary_source_evidence'
                or report.get('complete_video_exists') is not False
                or report.get('active_jobs') != []
                or set(report.get('inputs', {})) != set(BINDING_FILES)):
            return fallback
        if any(report['inputs'][name] != sw.sha((out / name).read_bytes())
               for name in BINDING_FILES):
            return fallback
        if any(path.stat().st_size for path in out.glob('final*.mp4') if path.is_file()):
            return fallback
        packet = sw.read_json(out / 'writing_packet.json')
        notes = sw.read_json(out / 'script_notes.json')
        profile = sw.read_json(out / 'production_profile.json')
        video = source_video if source_video is not None else Path(profile['video'])
        if source_identity(video) != profile.get('source_identity'):
            return fallback
        sw.validate_packet(packet, out)
        sw.validate_conversion(out, packet,
            sw.prose_sentences(sw.read_json(out / 'writer_script.json')))
        if (report.get('packet_id') != packet['packet_id']
                or report.get('script_sha256') != report['inputs']['writer_script.json']
                or report.get('draft_sha256') != report['inputs']['draft_story.md']
                or notes.get('draft_sha256') != report['draft_sha256']):
            return fallback
        blockers = report.get('story_evidence_blockers')
        if (not isinstance(blockers, list) or not blockers
                or blockers != notes.get('unresolved_production_limitations')):
            return fallback
        beats = {b['idx'] for b in packet['beats']}
        for blocker in blockers:
            refs = blocker.get('evidence')
            if (type(blocker.get('beat')) is not int or blocker['beat'] not in beats
                    or not isinstance(blocker.get('issue'), str) or not blocker['issue'].strip()
                    or not isinstance(refs, list) or not refs
                    or any(not isinstance(ref, str) or ref not in packet['sources'] for ref in refs)):
                return fallback
        return {'status': 'needs_primary_source_evidence', 'packet_id': packet['packet_id'],
                'inputs': report['inputs'], 'blockers': blockers,
                'contract_ok': False, 'report': 'out/production_blockers.json'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ReviewError):
        return fallback


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--source-video', type=Path,
                        help='Host path for the same source; identity must match the saved profile.')
    args = parser.parse_args()
    print(json.dumps(inspect(args.out, source_video=args.source_video), ensure_ascii=False))
