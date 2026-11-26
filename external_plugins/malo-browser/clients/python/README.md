# Python client

`malo_client.py` — zero-dependency (stdlib only) transport client for the malo
daemon: on-demand daemon spawn, lease acquire/release with a background
heartbeat, profile-backed sessions, tool calls, capability checks, and the
profile login import (`import_profile_login`).

```python
from malo_client import acquire_lease, import_profile_login

with acquire_lease("my-agent") as lease:
    import_profile_login(lease, "work", "http://127.0.0.1:9223", domains=["example.com"])
    with lease.new_session("work", profile="work") as s:
        s.call("navigate", {"url": "https://example.com"})
        print(s.call("snapshot", {"max_chars": 4000}))
```

- **Heartbeat is built in.** `acquire_lease` starts a daemon thread that renews
  the lease every third of its TTL and stops on `release()`; pass
  `heartbeat=False` to call `lease.heartbeat()` yourself. A lease whose
  heartbeat failed is reported as lost on the next call instead of surfacing as
  a confusing connection error.
- **Timeouts follow the daemon.** `session.call` waits as long as the daemon may
  take for that tool (`login` and `run_steps` are longer than the default). A
  read timeout is reported as a timeout, not as "cannot connect".
- **Debug port is opt-in and unauthenticated.** Pass `debug_port=` to
  `open_session` / `ensure_daemon` only when a Playwright `connect_over_cdp`
  workflow needs it. Any local process that reaches that port can drive every
  session and logged-in profile in the daemon.
- **Version skew.** When the repo is newer than the running daemon and the
  daemon has no leases, `ensure_daemon` restarts it so the new build takes
  effect; while leases exist it refuses and names the agents that hold them.
- **Daemon flags.** `daemon_args=[...]` or the `MALO_DAEMON_ARGS` environment
  variable add flags at cold start (for example `--proxy-server=...`); an
  already running daemon is reused as is.
- **Import scope is explicit.** `import_profile_login` requires `domains`.
- The library logs to stderr. `broker_file=` points the client at another data
  directory's daemon.
- Drop the file into any project to talk to a running daemon; auto-spawn derives
  the repo root from the file's own location (`MALO_REPO`), so a copy placed
  elsewhere cannot start one — start the daemon from the repo first.

Tests: `npm run test:client` (offline, stdlib `unittest`).
