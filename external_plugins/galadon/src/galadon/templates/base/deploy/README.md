# Deploy

The `local` adapter is a reference implementation: it runs configured build,
migrate and release commands, then requires a real `probe_url`. Releases live in
`deploy.options.root` (default `.galadon/deploy`) as immutable
`releases/<timestamp>-<version>` directories, with an atomic `current` switch, a
retained `previous` and a `shared/deploy.lock`. A failed probe restores
`previous` and re-probes it.

The `ssh` adapter is built in: set `deploy.adapter: ssh` in `galadon.yaml`. To
connect Kubernetes or anything else, write a `DeployPort` in this project and point
`ports.deploy` at it. `deploy.envs` gives each environment its own target and
probe; `--env` picks one. Do not fake success by removing the probe.
