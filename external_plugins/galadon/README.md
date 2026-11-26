# Galadon

A five-stage engineering loop for agent-built projects.

```text
Spec -> Build -> Verify -> Ship -> Learn
```

Galadon initializes a small engineering workspace, then keeps the agent on one
phase at a time. The core knows only phases, artifacts and gates. Everything
else is a port:

| Port | Purpose | Bundled | Replaced by |
|---|---|---|---|
| `RolePort` | Who does the work | `solo`, `six-ring`, `orchestrator` | `ports.role` |
| `TemplatePort` | The template tree: profiles and layout skeletons | profiles `web`, `api`, `static` | `ports.template` |
| `DeployPort` | How to build, migrate, release, probe and roll back | `local`, `ssh` | `ports.deploy` |

A project replaces a port in `galadon.yaml` without touching the five-stage
loop (see [Ports](#ports)).

## Install

The plugin ships the skill and the CLI together; no separate install step is
needed.

```bash
# DeepSeek Harness
dsh plugin --profile headless add <path-or-repo>

# ZCode
zcode plugins install galadon@<marketplace>

# Codex
codex plugin add galadon@<marketplace>
```

Inside a workspace the agent runs the bundled `bin/galadon`; a plugin
installed from a zip does not carry the executable bit, so run it as
`bash bin/galadon` there. To use the CLI yourself, either call `bin/galadon`
from the plugin directory or install it:

```bash
pip install <plugin-dir>   # or: pipx install <plugin-dir>
```

Requires Python 3.10+ and `PyYAML`.

## Quick start

```bash
galadon init --template api --role solo   # an empty directory; --force adds the missing files to one that is not
galadon next                              # one phase, one next action
```

`init` never overwrites: whatever the directory already has is kept and
listed, so `--force` is safe on a project with a history.

Then let the agent drive: it reads `galadon.yaml`, does the current phase, and
runs `galadon check` until the loop reaches `learn`. With the default `none`
layout the first gate is the spec: `init` writes a `spec/spec.md` stub full of
TODO, so `check` fails with "spec/spec.md still contains TODO" until you write
it. `init` also leaves `checks.build` and `checks.test` empty on purpose, so
once the spec is done `check` fails loudly with "no checks configured — declare
checks.build/checks.test" until you declare the real commands. A non-`none`
layout ships a filled-in spec and real checks instead (see Layouts below).

## The gates

`next` names one phase and one action, `check` runs the current gate, and
`ship` refuses — before it builds or touches a host — while any of these holds:

- the loop has already shipped: write the retro or run `galadon new`;
- the tree has uncommitted or untracked changes (git that cannot answer is an
  error, not a clean tree);
- a criterion under `## Acceptance` in the spec is still unticked;
- the target is a protected environment and `--yes-prod` is missing.

A green `check` is bound to the commit and the uncommitted files it ran
against. Change the project afterwards and `next` sends you back to `verify`.
Committing exactly what was checked does not count as a change. A project
that nothing versions is not bound.

`ship --dry-run` prints the plan and every reason a real ship would refuse. It
runs no check and writes nothing. A failed `check` prints the failing
command's stderr, not just its exit code.

`galadon new` archives the check record, the release record and the retro, so
the next loop gets a `learn` phase of its own.

## Layouts

`init --layout` adds the inside-project layering shared by the production
projects this scaffold was sampled from. The default
`none` keeps 0.2.x behaviour: base template only, no layout contract.

| Layout | Use it for | Creates |
|---|---|---|
| `none` (default) | a bare Galadon loop | base template only |
| `webapp` | a product with a backend and a frontend | `server/`, `src/` (python stack), `web/`, `e2e/`, `tests/`, `scripts/`, `deploy/`, `openspec/`, `spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`, `wiki/{knowledge,progress,runbook}/`, `.agents/`, `config.md` |
| `service` | a backend service or scheduled job | `server/`, `src/` (python stack), `tests/`, `scripts/`, `deploy/`, `openspec/`, `spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`, `wiki/{knowledge,progress,runbook}/`, `.agents/`, `config.md` |
| `plugin` | a distributable agent plugin | `bin/<project>`, `src/<project>/`, `skills/<project>/`, `docs/`, `tests/`, `scripts/`, `openspec/`, `spec/{spec.md,INDEX.md,TESTING.md,CONSTITUTION.md,domains/}`, `wiki/{knowledge,progress,runbook}/`, `.agents/`, `config.md` |

The `python` stack adds a `src/<package>/` code root; the `node` stack puts the
entry in `server/index.js` (`webapp`, `service`) or `src/index.js` (`plugin`), so
`webapp` and `service` have no `src/` on `node`.

Every non-`none` layout also carries the spec truth layer under `spec/`:
`INDEX.md` (the living feature index), `domains/README.md` (one behaviour
contract per domain), `TESTING.md` (the change-to-check trigger matrix), and
`CONSTITUTION.md` (the hard rules). These four files live once in
`templates/layouts/_shared/` and render before the layout's own `common/`
layer, so a layout can override a file while `none` stays unchanged. The files
every layout shares byte for byte (the `.agents/` slots and READMEs, the
`wiki/`, `openspec/` and `scripts/` READMEs, `.gitignore` and
`openspec/config.yaml`) live there once too; `plugin` keeps its own versions of
the ones that differ.

`--stack` picks the code skeleton and the real checks:

| Stack | build | test |
|---|---|---|
| `python` (default) | `python3 -m compileall -f -q src server`; plugin: `src` + `bash -n bin/<project>` | `python3 -m unittest discover -s tests -v` |
| `node` | `node --check <layout entry>`; plugin: + `bash -n bin/<project>` | `npm test` (`node --test tests/`) |
| `none` | — | — |

A non-`none` layout with `--stack python|node` ships at least one real test, so
`galadon check` is green right after `init`; `--stack none` has no checks and
fails loudly. The build compiles or syntax-checks every source root the
layout ships and runs `bash -n` on the plugin's bash wrapper for both stacks, so
a broken entry point fails the gate instead of passing it. It also enforces the
layout contract: `AGENTS.md`, `openspec/config.yaml`, `spec/INDEX.md`,
`spec/domains/`, `spec/TESTING.md`, `spec/CONSTITUTION.md`, the three `wiki/`
directories, the six `.agents/` slots, non-empty checks, and `out/` +
`.agents/` in `.gitignore`. A missing item fails the gate and is named.
`.agents/` is stored in the templates as `__agents__/` because `.agents/` is
gitignored in this repository; the renderer maps it back during render. The
same `.gitignore` keeps the slots out of every clone, so `next`, `check` and
`ship` recreate the ones that are missing and say so on stderr.

The `paths:` block in `galadon.yaml` moves the stage artifacts (`spec`,
`evidence`, `retro`, `release`). Defaults are the 0.2.x paths; layouts put the
retro in `wiki/progress/retro.md` because a retro is short-term progress, not
durable knowledge.

```bash
galadon init --layout webapp --stack node --template web
galadon init --list-layouts        # stable text: layouts and stacks
```

## Commands

```bash
galadon init --template web --role solo
galadon init --layout webapp --stack python --template web
galadon next
galadon check
galadon new
galadon bootstrap --env test
galadon ship --env test
galadon teardown --env test --yes
```

`ship` refuses to report success without a real probe. Protected environments
require `--yes-prod` in the same invocation.

## Environments

`deploy.envs` gives each environment its own target and probe, and `--env`
picks one; `deploy.env` is the default. An environment may override any
deploy setting except `adapter`; `options` merges key by key.

```yaml
deploy:
  adapter: ssh
  env: test
  artifact: dist
  probe_expect: "{{COMMIT}}"
  options:
    service: demo
    run_user: demo
    exec_start: "/usr/bin/python3 /srv/demo/current/server.py"
  envs:
    test:
      options: {host: test.example.com, remote_root: /srv/demo}
      probe_url: "https://test.example.com/health.json"
    prod:
      options: {host: demo.example.com, remote_root: /srv/demo}
      probe_url: "https://demo.example.com/health.json"
```

Naming an environment that is not defined is an error, so a release can no
longer be recorded against a target it never went to. An environment whose
name starts with `prod` is protected, and so is one that sets
`protected: true`; shipping to it, or bootstrapping or tearing it down,
requires `--yes-prod` in the same invocation.

## Remote deploys

`deploy.adapter: ssh` ships a directory to a host that runs systemd and a
reverse proxy, with releases, an atomic `current`/`previous` switch, a deploy
lock and a commit-versioned JSON probe:

```yaml
deploy:
  adapter: ssh
  env: test
  build: "mkdir -p dist && cp server.py dist/ && git rev-parse --short HEAD > dist/commit.txt"
  probe_url: "https://demo.example.com/health.json"
  probe_expect: "{{COMMIT}}"
  artifact: "dist"
  options:
    host: 203.0.113.10
    user: root
    remote_root: /srv/demo
    service: demo
    domain: demo.example.com
    listen: 127.0.0.1:18790
    exec_start: "/usr/bin/python3 /srv/demo/current/server.py"
    caddy_block: demo
```

`bootstrap` creates the system user, release tree, systemd unit and a marked
reverse-proxy block (it backs the proxy config up and validates before
reloading). `teardown --yes` only removes a root that still carries the
`bootstrap` marker.

`deploy.options` for the `ssh` adapter:

| Option | Meaning |
|---|---|
| `host`, `user`, `remote_root`, `service` | required: where to ship and what to restart |
| `domain`, `listen`, `exec_start`, `caddy_block` | required by `bootstrap` |
| `run_user` (default `galadon`), `manage_user` (default `true`) | the service account |
| `environment_file` | an absolute path on the host, written into the unit as `EnvironmentFile=` |
| `remote_migrate` | a command run on the host inside the new release, before `current` switches; a failure leaves `current` alone |
| `keep_releases` (default `5`) | releases to keep besides the live and the previous one; `0` keeps all |
| `search_index` (default `false`) | `true` drops the `noindex` header and the `robots.txt` block |
| `probe_ready_seconds` (default `15`) | how long the probe waits for the service to answer |

`keep_releases` and `probe_ready_seconds` apply to `local` as well.
`deploy.migrate` runs on the machine that ships; `options.remote_migrate` runs
on the host, which is where a database migration belongs.

The probe waits for the service: a refused connection, and the 502/503/504 a
reverse proxy answers while its upstream restarts, are retried inside
`probe_ready_seconds`. Any other HTTP status is final and still has to carry
the build's commit.

`deploy.adapter: local` uses the same release tree under
`deploy.options.root` (default `.galadon/deploy`):
`releases/<timestamp>-<version>`, an atomic `current` switch, a retained
`previous`, and `shared/deploy.lock`. A held lock refuses the ship; a failed
probe restores `current` to `previous`, re-probes that release and exits
non-zero with the live release named. Both adapters behave the same when the
failed release was the first one: there is nothing to restore to, so `current`
is removed (`ssh` also stops the service) and the release record says so.

## Ports

```yaml
ports:
  role: "team.roles:Pair"        # an object with assign(phase) -> role names
  template: "./scaffold"         # a template tree: base/, profiles/, layouts/
  deploy: "team.deploy:Nomad"    # a DeployPort
```

Each entry points at code or templates inside the project. When it names a
class, Galadon instantiates it. A `DeployPort` provides `describe`, `build`,
`migrate`, `release`, `probe`, `rollback`, `bootstrap`, `teardown` and a
`name`; `preflight` is optional. A `RolePort` provides `assign(phase)`. A
template root may add profiles, which `--template` then accepts. `k8s` is
still a declared adapter with no implementation: this is how you connect one.

## Side effects

Read this before pointing it at a machine you care about.

- `bootstrap` writes on the remote host: a system user (unless
  `options.manage_user: false`), `<remote_root>/{releases,shared}`, a systemd
  unit, and one marked block in the reverse-proxy config. The proxy config is
  backed up first and validated before any reload; a failed validation restores
  it and does not reload. Every managed site is kept out of search engines
  (`noindex` and a `robots.txt` that disallows all) unless
  `options.search_index: true`.
- `ship` writes an immutable release, switches `current` atomically and keeps
  `previous`; the `ssh` adapter also restarts the service. It then probes the
  release. A failed probe rolls back to `previous`, re-probes it and exits
  non-zero; on a first release it removes `current` instead. After a successful
  switch it deletes the oldest releases beyond `options.keep_releases`, never
  the live or the previous one, and lists them in the release record.
- `teardown --yes` removes the unit, the marked proxy block, the release tree
  and the system user, but only if the root still carries the `bootstrap`
  marker.
- Every remote write prints its target first. A protected environment
  additionally requires `--yes-prod` in the same invocation.

## Limits

- `DeployPort` implementations: `local` and `ssh` (systemd + Caddy). `k8s` is a
  declared port with no implementation; calling it fails loudly.
- macOS and Linux only: the adapters rely on `fcntl` and `/bin/sh`.
- The `ssh` adapter assumes root access (or an account that can write the unit
  and the proxy config), `rsync`, `flock` and `systemctl` on the target.
- The proxy block uses a Caddy snippet named `access_log`; hosts without that
  snippet need their own `DeployPort` implementation.
- The `ssh` adapter requires probes to return JSON with a `commit` field that
  matches the build; the `local` adapter requires `deploy.probe_expect` and
  compares it exactly: a JSON body must carry a `commit` field equal to that
  value, and a non-JSON body must equal it exactly.

## Design rules

- One phase has one artifact and one gate.
- The core never imports SSH, Kubernetes, Jira or a notification SDK.
- The six-ring workflow is a `RolePort` preset, not the core.
- Git content cannot authorize a production release.
- Fail loud; no silent fallback and no partial-success claim.
- `galadon.yaml` is read by exactly one loader: a key it does not know is an
  error, and so is a key left empty where a value is required.

## Development

```bash
PYTHONPATH=src python3 -m galadon --help
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```
