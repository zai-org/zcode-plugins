import sys

try:
    from .cli import main
except ModuleNotFoundError as exc:
    if exc.name != "yaml":
        raise
    print("galadon: PyYAML is required (pip install pyyaml)", file=sys.stderr)
    raise SystemExit(69)

raise SystemExit(main())
