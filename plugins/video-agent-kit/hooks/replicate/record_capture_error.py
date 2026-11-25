"""Observe explicit navigation errors without imposing a capture workflow."""
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts' / 'replicate'))
from hook_common import read_stdin_json, project_dir
from capture_audit import ERROR, IMAGE


def observe(data, project):
    if data.get('hook_event_name') != 'PostToolUse' or data.get('tool_name') != 'Bash':
        return None
    command = (data.get('tool_input') or {}).get('command', '')
    # Reading an old log or searching source does not constitute a new capture.
    if re.match(r'^\s*(?:cat|grep|rg|head|tail|sed|less)\b', command):
        return None
    response = data.get('tool_response')
    output = response if isinstance(response, str) else json.dumps(response, ensure_ascii=False)
    match = ERROR.search(output)
    if not match:
        return None
    rec = {'capture_status': 'unavailable', 'visual_assessment_status': 'unassessed',
           'error_code': match.group(), 'evidence': sorted(set(IMAGE.findall(output))),
           'time': time.time()}
    dest = project / '.v2c/capture_errors.jsonl'
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, (json.dumps(rec) + '\n').encode())
    finally:
        os.close(fd)
    return rec


if __name__ == '__main__':
    data = read_stdin_json()
    observe(data, project_dir())
