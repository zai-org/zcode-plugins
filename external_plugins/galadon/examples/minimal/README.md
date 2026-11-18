# Minimal example

A complete Galadon workspace that fits in five files. Copy this directory,
replace the `deploy.options` values, and the loop works end to end.

```bash
cd examples/minimal
../../bin/galadon next
../../bin/galadon check
../../bin/galadon ship --env test --dry-run
```

`server.py` serves `GET /health.json` with the commit recorded in
`commit.txt`, which is what the probe checks after a deploy.
