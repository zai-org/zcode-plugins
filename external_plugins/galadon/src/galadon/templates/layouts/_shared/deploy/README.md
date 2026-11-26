# Deploy

`galadon.yaml` selects the deployment adapter; this directory holds what only
this project can describe, not credentials.

- `local` publishes into `.galadon/deploy` with immutable releases, an atomic
  `current` switch, a retained `previous`, and a deploy lock.
- `ssh` targets a host with systemd and a reverse proxy; its settings live under
  `deploy.options` (`remote_migrate` runs on the host, `deploy.migrate` here).
- `deploy.envs` gives each environment its own target and probe; `--env` picks one.
- A `DeployPort` of this project's own goes behind `ports.deploy`.

Never put secret values here. A failed probe rolls back to `previous` and exits
non-zero; do not fake a successful deploy by removing the probe.
