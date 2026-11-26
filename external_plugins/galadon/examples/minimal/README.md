# Minimal example

A complete Galadon workspace that fits in five files. Copy this directory,
replace the `deploy.options` values, and the loop works end to end. The copy
needs git: the build stamps `git rev-parse HEAD` into `dist/commit.txt`, so
`git init` and commit it first.

```bash
cd examples/minimal
../../bin/galadon next
../../bin/galadon check
../../bin/galadon ship --env test --dry-run
```

The three commands only read. A real `galadon ship` waits until the
acceptance criteria in `spec/spec.md` are ticked.

`server.py` serves `GET /health.json` with the commit recorded in
`commit.txt`, which is what the probe checks after a deploy.
