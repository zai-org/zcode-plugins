# Configuration and environment

## Runtime

- `HOST` (default `127.0.0.1`): backend bind address.
- `PORT` (default `8000`): backend port.
- Secrets belong in `.env`; only variable names go in `.env.example`.

## Local development

With the `python` or `node` stack:

```bash
scripts/dev.sh
curl http://127.0.0.1:8000/health.json
```

## Checks

`galadon.yaml` declares the real commands:

- build compiles or syntax-checks the backend;
- test runs the test suite.

`galadon check` runs both and writes `verify/evidence.md`.

## Deploy

`deploy.adapter` is `local` by default and publishes under `.galadon/deploy`.
The `ssh` adapter targets a host with systemd and a reverse proxy; the option
shape is documented in the Galadon README. Do not put credentials in
`galadon.yaml`.
