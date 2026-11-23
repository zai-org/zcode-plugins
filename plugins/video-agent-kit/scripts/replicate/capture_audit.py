"""Classify explicit capture failures separately from visual findings.

No brightness heuristic: a black frame is valid unless the capture itself failed.
Legacy text is preserved; this sidecar never rewrites historical evidence.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

# Require explicit browser/transport diagnostics, not generic words like 'black'.
ERROR = re.compile(r'ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|'
                   r'net::ERR_|ECONNREFUSED|page\.goto: Timeout|Navigation timeout', re.I)
IMAGE = re.compile(r'(?:out/)?(?:cmp|self)/[^\s\)\]"\'`<>]+\.(?:png|jpg|jpeg|webp)')


def audit(project: Path) -> dict:
    invalid = set()
    invalid_rows = set()
    incidents = []
    records = []
    ledger = project / 'out/verify.jsonl'
    if ledger.is_file():
        for line_number, line in enumerate(ledger.read_text(errors='replace').splitlines(), 1):
            try:
                row = json.loads(line)
                if isinstance(row, dict):
                    records.append((line_number, row))
            except ValueError:
                continue
    rounds = sorted((project / 'out/verify').glob('*.md'), key=lambda p: p.stat().st_mtime_ns)
    texts = [(str(p.relative_to(project)), p.read_text(errors='replace')) for p in rounds[-1:]]
    latest = {}
    for line_number, row in records:
        latest[str(row.get('id', line_number))] = (line_number, row)
    active_failure = False
    for i, row in records:
        text = json.dumps(row, ensure_ascii=False)
        if ERROR.search(text) or row.get('capture_status') in ('failed', 'unavailable'):
            invalid_rows.add(i)
            evidence = row.get('evidence')
            if isinstance(evidence, str):
                invalid.add(evidence)
            incidents.append({'record': f'out/verify.jsonl:{i}', 'status': 'capture_failed'})
    errors = project / '.v2c/capture_errors.jsonl'
    if errors.is_file():
        for line in errors.read_text(errors='replace').splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if not isinstance(rec, dict):
                continue
            evidence = rec.get('evidence', [])
            if isinstance(evidence, list):
                invalid.update(p for p in evidence if isinstance(p, str))
            incidents.append({'record': '.v2c/capture_errors.jsonl',
                              'status': 'capture_failed', 'error_code': rec.get('error_code')})
    for _, row in latest.values():
        evidence = row.get('evidence')
        if isinstance(evidence, str) and evidence in invalid:
            active_failure = True
        if row.get('capture_status') in ('failed', 'unavailable') or ERROR.search(json.dumps(row)):
            active_failure = True
    for path, text in texts:
        if set(IMAGE.findall(text)) & invalid:
            active_failure = True
        if ERROR.search(text):
            active_failure = True
            invalid.update(IMAGE.findall(text))
            incidents.append({'record': path, 'status': 'capture_failed'})
    affected = [i for i, row in records
                if i in invalid_rows or (isinstance(row.get('evidence'), str) and row['evidence'] in invalid)]
    return {'capture_status': 'unavailable' if active_failure else 'unknown',
            'visual_assessment_status': 'unassessed' if active_failure else 'unknown',
            'invalid_evidence': sorted(invalid), 'excluded_visual_rows': affected,
            'capture_incidents': incidents}


if __name__ == '__main__':
    print(json.dumps(audit(Path(sys.argv[1])), ensure_ascii=False))
