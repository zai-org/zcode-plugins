"""Run the shared produce_film tool synchronously from produce_args.json."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()
from recap.project_context import ProjectContext
from ve_tools import catalog, jobs
from ve_tools.recap_security import tool_error


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-dir', type=Path, required=True)
    parser.add_argument('--args-file', type=Path, default=Path('out/produce_args.json'))
    options = parser.parse_args(argv)
    try:
        project = options.project_dir.resolve(strict=True)
        os.environ['VE_PROJECT_DIR'] = str(project)
        ctx = ProjectContext(project_root=project)
        arguments = json.loads(ctx.resolve(options.args_file).read_text())
        schema = catalog.BUSINESS_SCHEMAS['produce_film']['inputSchema']
        arguments = jobs.validate_arguments('produce_film', arguments, schema)
        implementation = catalog.TOOLS['produce_film']
        result = implementation(arguments, ctx)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        result = tool_error(exc, (catalog.BUSINESS_SCHEMAS.get('produce_film') or {}).get('inputSchema'))
    print(json.dumps(result.to_dict(), ensure_ascii=False))
    return int(result.failed)


if __name__ == '__main__':
    raise SystemExit(main())
