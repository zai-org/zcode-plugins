# Deploy

The `local` adapter is a reference implementation: it runs configured build,
migrate and release commands, then requires a real `probe_url`. Releases live in
`deploy.options.root` (default `.galadon/deploy`) as immutable
`releases/<timestamp>-<version>` directories, with an atomic `current` switch, a
retained `previous` and a `shared/deploy.lock`. A failed probe restores
`previous` and re-probes it.

The `ssh` adapter is built in: set `deploy.adapter: ssh` in `galadon.yaml`. To
connect Kubernetes, implement `DeployPort` and register a new adapter. Do not
fake success by removing the probe.
