# Changelog

## 0.3.8

A full review of 0.3.7 found sixteen things to fix; all of them are in here.

- `init` only ever adds files. `--force` used to overwrite whatever the
  directory already had — README, `AGENTS.md`, `.gitignore`, the spec and
  `galadon.yaml` — while its help text and the error that suggested it both
  said "add Galadon files". Adding Galadon to a project with a history now
  keeps every existing file and lists them; the managed block is still
  appended to `AGENTS.md`. Re-running `init` on a project whose
  `galadon.yaml` names another layout or stack is refused, because the file
  is kept and the request could not be honoured.
- A fresh clone of a scaffolded project passes `galadon check` again. The
  layout contract asked for six `.agents/` slots that the scaffold's own
  `.gitignore` keeps out of git, so every clone — a colleague, CI, a new
  machine — failed with "missing: .agents/plans/; …". The slots are local
  runtime state by design, so `next`, `check` and `ship` now recreate the ones
  that are missing and say so on stderr.
- `pip install` delivers a working CLI. The wheel carried only the Python
  modules, so `galadon init` from a pip or pipx install failed with "missing
  template base". The templates live inside the package now
  (`src/galadon/templates/`), declared as package data.
- Every loop after the first skipped its retro. `galadon new` archived the
  check and release records but left the previous retro in place, and that
  retro satisfied the next loop's `learn` gate: the second ship went straight
  to `done`. `new` archives the retro with the rest, and the `done` action
  says to update the spec and run `new`.
- An exception the probe did not wrap left the release live with no rollback
  and no record. `ship` now treats any failure of the probe as a failed probe
  — rollback, record, non-zero exit — and does the same for a rollback that
  itself crashes.
- A key left empty in `galadon.yaml` (`probe_url:` with nothing after it) was
  read as the string `None` and requested as a URL once the release was
  already switched. Empty means not configured everywhere, and the probe
  settings are checked before anything is built: the local adapter's missing
  `probe_expect`, which used to be discovered by the probe after the switch,
  is refused up front too.
- The readiness window also waits out a reverse proxy. It retried a refused
  connection but took any HTTP answer as final, while the `ssh` adapter puts
  every service behind Caddy — which answers 502/503/504 until the restarted
  upstream listens. A service with a slow start failed its probe and rolled
  back every time. Those three statuses are now "not ready yet" inside the
  window; anything else is still final. The window is
  `deploy.options.probe_ready_seconds` (default 15). The probe also closes
  the responses it rejects instead of leaving them to the garbage collector.
- A failed first release left the failed release live. With no `previous`,
  rollback stopped at "no previous release link" and `current` stayed on the
  release that had just failed. Nothing was live before a first release, so
  that is what gets restored: `current` is removed, the `ssh` adapter also
  stops the service, and the record and the message say so.
- `ship --dry-run` is a preview. It ran the whole test suite, rewrote the
  evidence and the check record, and moved the phase. It now runs nothing,
  writes nothing, and prints the plan together with every reason a real ship
  would refuse.
- `galadon next` no longer trusts a stale green check. The check record is
  bound to the commit and the uncommitted files it ran against; change the
  project afterwards and `next` returns to `verify`. Committing exactly what
  was checked is not a change, so "check, then commit" does not send the agent
  back. `verify/evidence.md` names the commit that was checked.
- `ship` refuses an unverified spec. A scaffold's placeholder spec ships with
  every box unticked, and one green check on its hello-world test carried it
  all the way to a release. Every criterion under `## Acceptance` has to be
  ticked before `ship` runs; `next` in the `ship` phase says how many are open.
- A failing `check` shows why. It printed only stdout, so a unittest failure
  read as an empty `[1] test:` line and the reason sat in the evidence file.
  The stderr of a failed command is printed with it.
- git that cannot answer is an error, not a clean tree. A corrupt repository
  read as "no git here" and switched the uncommitted-changes guard off. A
  project inside another repository it is not tracked by no longer stamps
  that repository's commit on its releases: it ships with none and says so.
  A project that is a subdirectory of a larger repository is versioned by it
  and judges only its own directory.
- `checks.timeout` must be a positive whole number. `abc` raised a traceback,
  `-5` made every check "time out after -5s", and `0` silently meant 300. A
  truncated check or release record names the file and the way out instead of
  a traceback, and records are written in one step so a crash cannot truncate
  them.
- `--env` selects a real target. It only relabelled the release, so
  `ship --env prod` went to the `test` host and was recorded as `prod`.
  `deploy.envs` now gives each environment its own target, options and probe,
  and naming an environment that is not defined is an error. An environment is
  protected when its name starts with `prod` or it sets `protected: true`;
  the guard used to know only the literal `prod`.
- The `ssh` adapter gained what a real deploy needs: `options.remote_migrate`
  runs on the host inside the new release before `current` switches (a
  failure leaves `current` alone), `options.environment_file` becomes
  `EnvironmentFile=` in the unit, and `options.keep_releases` (default 5, `0`
  keeps all) prunes the oldest releases after a successful switch, never the
  live or the previous one. Releases used to accumulate forever.
- `bootstrap` keeps every managed site out of search engines — `noindex` and a
  `robots.txt` that disallows all — and never said so. It is documented now,
  and `options.search_index: true` turns it off.
- The ports are replaceable. `ports.role`, `ports.template` and `ports.deploy`
  point at code or templates inside the project; the loader instantiates a
  class, checks the port against its contract and names what is missing. The
  README had promised this since 0.1.0 while every port was a hard-coded
  branch. A template root may add profiles, so `--template` is no longer
  limited to `web`, `api` and `static`.
- The six-ring preset has its `fix` ring: verify is `test`, `fix`, `check`.
- Smaller: `.galadon/state.json` was written by every command and read by
  none, so it is gone; `next` leaves `AGENTS.md` alone when nothing changed;
  `schema/galadon.schema.json` was shipped, never used and already out of step
  with the loader, so the loader is the only description of the configuration;
  the `ssh` adapter's remote scripts moved to their own module; a bad
  `--template` no longer leaves an empty directory behind.
- Found while cutting this release. The marketplace zip carries every file as
  `0644`, templates included, and rendering copied that mode — so a scaffold
  made from a zip-installed plugin had `bin/<project>`, `scripts/dev.sh` and
  `scripts/quality-check.sh` that refused to run, while `check` stayed green
  because nothing executes them. The wrappers are executable by where they
  land now, whatever mode the template arrived with. And the move of the
  templates into the package made two `package.json` `files` entries overlap
  (the `*.py` glob also matched template sources), which the ZCode payload
  tool refuses; the package directory is listed once instead.
- Tests: the bash the `ssh` adapter sends to a host is now executed in the
  suite against a real release tree, with `systemctl`, `flock` and `chown`
  replaced by logging shims. It had only ever been read as text.

## 0.3.7

- Version sources realigned: `galadon.__version__` and `pyproject.toml` were
  still on 0.3.5 after the 0.3.6 icon round bumped only the manifests and
  `package.json`. Every version source now states 0.3.7, and a new version
  consistency test fails the suite when any of them drifts again.
- The ssh adapter's release step ignored `DeployContext.commit` and re-read
  git itself, so a commit pinned on the context by the caller could disagree
  with the release name and the probe expectation. It now prefers
  `ctx.commit` and only falls back to the commit provider — the same
  precedence the local adapter uses.
- The byte-identical `deploy/README.md` shipped twice (service and webapp
  layouts); it moved to the `_shared` layout layer, so a fix can no longer
  land in one copy and leave the other stale. Plugin scaffolds now render the
  same layout-level deploy README through that shared layer.
- Dropped a dead `description=__doc__` argument from the argument parser:
  `cli.py` has no module docstring, so the description was always `None`.

## 0.3.6

- New icon: 1-bit monochrome pixel robot pushing a glowing block around a
  five-segment track. Part of the shared pixel family across the six plugins;
  no code changes.

## 0.3.5

- The ship dirty-tree guard now counts untracked files. `git status
  --porcelain --untracked-files=no` let a brand-new file ride along silently:
  the guard exists because the build copies the whole workspace, and `cp -r`
  treats an untracked file exactly like an uncommitted edit, so an untracked
  source file shipped under a commit it was never part of. The status call now
  uses `--untracked-files=all`; the loop's own exemptions (evidence, release
  record, `AGENTS.md`, `.galadon/`) already cover what `check`/`ship` generate
  and the scaffold `.gitignore` keeps `out/`/`dist/` out of the report.
- With a static `deploy.probe_expect`, the local adapter reported a successful
  rollback as failed. The rollback re-probe asserted `body.commit == version`,
  an invariant that only holds for the `{{COMMIT}}` template; a static expect
  pins a marker both releases emit, so after switching back, the probe answered
  the marker while the check demanded the previous release's version. The
  re-probe now asserts the static expect when one is configured (the same thing
  the release gate asserts) and the version only for `{{COMMIT}}`. To keep the
  template visible at rollback time, `ship` no longer rewrites
  `config.deploy.probe_expect` in place — it only fails early when the
  placeholder cannot render; each adapter renders against its own release
  commit.
- The ssh preflight no longer drops the systemd unit drift check silently when
  the bootstrap options are incomplete. Previously the whole drift block was
  left out of the script without a word; preflight now records (and `ship`
  prints) a note: `skipping unit drift check: unit template incomplete
  (missing bootstrap keys: …)` naming the absent keys, so the degradation is
  visible instead of implied.
- `init --list-layouts` no longer claims every stack's build command ends in
  `&& <layout shell checks>`. Only the plugin layout appends a shell check
  (`bash -n bin/<project>`); webapp and service builds have no tail, so the
  listing showed a suffix the generated `galadon.yaml` never contains. The
  stack lines now match the generated commands for shell-check-free layouts,
  and the plugin's exact append is stated on its own line.

## 0.3.4

- Scaffold docs no longer point at things the scaffold does not generate. The
  layout `AGENTS.md` templates sent reusable cross-project knowledge to "the
  Guster hub" — a plugin the generated project does not have; the sentence now
  names a knowledge hub outside the repo generically. The base `deploy/README`
  told readers to implement `DeployPort` to connect SSH, but the `ssh` adapter
  is built in (`deploy.adapter: ssh` in `galadon.yaml`); only Kubernetes still
  needs a new adapter. READMEs, config notes, the plugin `AGENTS.md` and the
  service spec acceptance item now say `scripts/dev.sh` is added by the
  python/node stack layer, so a `--stack none` project no longer lists a
  first command whose file was never generated.
- The shipped schema's `required` matches the loader: only `project` and
  `template` are mandatory, and `deploy` no longer marks `adapter`/`env`.
  `load_config` defaults `role` to `solo` and fills `deploy`/`checks` when the
  blocks are absent, so the old list made the schema reject `galadon.yaml`
  files the tool itself accepts.
- `.npmignore` is removed: `files` in `package.json` is an allowlist that
  overrides it, so no line in it could affect the tarball; the bytecode defence
  is the `prepack` script.
- `RolePolicy.assign(phase)` drops its unused `task` argument (no
  implementation read it and the only caller passed an empty string), and
  `extract_commit` reads the single `commit` field directly instead of looping
  over a one-element tuple.
- The bundled example's health test no longer writes a `commit.txt` into a
  temporary directory that nothing reads.

## 0.3.3

- The deploy probe now waits for a service that was just restarted.
  `systemctl restart` returns once the process is spawned, not once it is
  listening: measured on a real host, the port refused connections for ~150 ms
  afterwards. The probe fired immediately and failed, so every shipment of a
  real project failed its probe and rolled back (2 out of 2 on the host used for
  the relay dogfood). Connection-level failures are now retried inside a bounded
  readiness window (15s); an HTTP answer is final and immediately subject to the
  commit check, and a target that never answers still fails loudly, naming the
  attempt count and the budget. The same zero tolerance made a rollback that had
  actually restored service report itself as failed, because the post-rollback
  re-check used the same probe.
- The probe fetch moved into `adapters/probe.py`, so the `local` and `ssh`
  adapters share one readiness policy instead of carrying a copy each.
- `bootstrap` refuses a `remote_root` it does not own. It used to `install -d`
  whatever path it was given and write its ownership marker into it, so a
  directory with someone else's data became a galadon root; `teardown` then
  deleted it, because the marker it checks was planted by that same bootstrap.
  It now refuses a non-empty unmarked directory, and a root that carries another
  slot's marker, before touching the user, the unit or Caddy.
- `teardown` no longer fails when the run user is shared. `userdel` on the
  default `galadon` user fails while any other slot runs as it — which is the
  normal state on a host with two deployments — and the teardown aborted
  *after* removing the root. It now leaves the user in place, says so, and
  reports `user_skip_reason`, while still failing loudly if the user cannot be
  removed for any other reason.
- `ship` refuses to publish a dirty working tree. The commit stamped on the
  release comes from `HEAD`, but the build copies the working tree, so
  uncommitted changes shipped under a commit they are not part of and a later
  rollback would restore a version that never existed. The loop's own files
  (evidence, the release record, `.galadon/`, the phase block in `AGENTS.md`)
  are exempt.
- `ship --dry-run` no longer demands `--yes-prod`. Previewing a production
  release required the flag that authorises one; the plan now prints
  `requires: --yes-prod` instead, and the guard still applies to a real run.

## 0.3.2

- `pytest` no longer walks into `examples/`. Running it from the repo root used
  to collect `examples/minimal/tests/test_health.py`, import the example's
  `server.py`, and leave `__pycache__` inside the directory that ships in the
  npm tarball. `files` is an allowlist and overrides `.npmignore`, so those
  bytecode files ride into the package and turn the "npm tarball excludes
  Python bytecode" test red for anyone who ran pytest before `node --test`.
  `npm test` was unaffected because unittest discovery already stays in
  `tests/`, which is why the failure surfaced only on the pytest path. The
  example is still covered: it is exercised from a scratch copy.
- `prepack` deletes `__pycache__` and `*.pyc` before packing, so the tarball is
  bytecode-free regardless of what ran in the tree beforehand.

## 0.3.1

- `galadon.yaml` rejects unknown top-level keys instead of ignoring them. The
  shipped schema already declared `additionalProperties: false`, so a block that
  had stopped meaning anything — the retired 0.1.0 `tools:` port — could sit in
  a real config doing nothing. The error names every unknown key and the allowed
  set.
- The documented `check` behaviour with the default `none` layout now matches
  the code: the first failure is the spec gate ("spec/spec.md still contains
  TODO"), and "no checks configured" only appears once the spec is complete.
  `README.md`, `README_CN.md` and `galadon init --list-layouts` had the checks
  failure first.
- Tests: a standing matrix covers all 36 layout × stack × template
  combinations, asserting each one is either green on a fresh scaffold or fails
  loudly with the reason it is expected to produce. `examples/minimal` — shipped
  in the npm tarball and previously covered by nothing — must pass `galadon
  check` from a scratch copy.

## 0.3.0

- `galadon init --layout {none,webapp,service,plugin}` (default `none`) and
  `--stack {python,node,none}` (default `python`) generate the nine layers that
  three unrelated real projects already share: entry, plan, truth, knowledge,
  context, code, run, verify, output. `galadon init --list-layouts` prints the
  shipped layouts and stacks.
- `layout=none` keeps 0.2.x behaviour: the base template only, the same
  directories, and the same artifact paths.
- Real stack checks: `python3 -m compileall -f -q <layout source roots>` and
  `python3 -m unittest discover -s tests -v`, or `node --check <entry>` plus
  `npm test` (`node --test tests/`). The plugin layout also runs
  `bash -n bin/<project>` on both stacks. Every layout ships passing tests, so
  `galadon check` is genuinely green right after `init`; `--stack none` still
  fails loudly with "no checks configured".
- `galadon check` enforces the layout contract for non-`none` layouts:
  `AGENTS.md`, `openspec/config.yaml`, `spec/INDEX.md`, `spec/domains/`,
  `spec/TESTING.md`, `spec/CONSTITUTION.md`,
  `wiki/{knowledge,progress,runbook}/`, the six `.agents/` slots, non-empty
  checks, and `out/` + `.agents/` in `.gitignore`. A missing item fails the gate
  and is named.
- Every non-`none` layout scaffolds the spec truth layer under `spec/`:
  `INDEX.md` (living feature index with `F-<DOMAIN>-01` IDs, `1w`/`2w` gates
  and `主落点` pointers), `domains/README.md` (behaviour truth and `impl`
  pointers), `TESTING.md` (change-to-check trigger matrix) and
  `CONSTITUTION.md` (hard rules). The files live once in
  `templates/layouts/_shared/` and render before the layout's `common/` layer,
  so a layout can override them; `none` is unchanged.
- New `paths:` block in `galadon.yaml` (`spec`, `evidence`, `retro`, `release`)
  read by the loop instead of hardcoded constants. Defaults are the 0.2.x
  paths; layouts put `retro` under `wiki/progress/`.
- Layout templates are organised as `templates/layouts/<layout>/{common,python,node}`,
  with the spec truth layer stored once in `templates/layouts/_shared/` and
  rendered before each layout's `common/` layer. `.agents/` is stored as
  `__agents__/` because that directory is gitignored in this repository, and the
  renderer maps it back, substituting placeholders in paths as well as content.
- `webapp` and `service` shipped two byte-identical copies of the app skeleton
  (`server/app.py`, `src/<pkg>/`, `tests/`, `scripts/dev.sh`, for both stacks —
  10 files, 206 lines). A fix to one would have left the other silently stale,
  which is exactly the failure mode nobody notices until a user picks that
  layout, so `service` now renders `webapp`'s stack templates through
  `LayoutSpec.stack_templates`. Generated output is unchanged across all 36
  profile × layout × stack combinations, verified against a pre-change baseline.

## 0.2.2

- The `local` DeployPort now uses the same release contract as `ssh`: immutable
  `releases/<timestamp>-<version>` directories under `deploy.options.root`
  (default `.galadon/deploy`), an atomic `current` switch, a retained
  `previous`, and an exclusive `shared/deploy.lock`. A held lock refuses the
  ship with a non-zero exit instead of interleaving releases.
- A failed local probe rolls back to `previous`, re-probes the restored
  release, and names the release that is live again.
- The local probe is exact: a JSON response must carry a `commit` field equal
  to `deploy.probe_expect`, and a non-JSON response must equal it exactly. The
  recorded `actual_commit` now comes from the probe response, not build
  metadata.
- `galadon init` no longer scaffolds the do-nothing `checks: {build: "true",
  test: "true"}` gate. Empty checks make `galadon check` fail loudly with
  "no checks configured — declare checks.build/checks.test" until real commands
  are declared.
- `npm pack` no longer ships `__pycache__/` or `*.pyc` files from the working
  tree.

## 0.2.1

- The `local` DeployPort hashes an artifact directory the same way the `ssh`
  adapter does, so `artifact: dist` works with either adapter; an unreadable
  artifact reports a `galadon:` error instead of a Python traceback.
- An invalid `galadon.yaml` reports the parser message instead of a Python
  traceback.
- The `local` DeployPort requires `deploy.probe_expect`: a bare HTTP 200 is not
  a version probe, so it no longer counts as a successful ship.
- A missing PyYAML reports `galadon: PyYAML is required (pip install pyyaml)`
  and exits 69 instead of an import traceback.

## 0.2.0

- `ssh` DeployPort: release directories, atomic `current`/`previous` switch,
  remote deploy lock, commit-versioned JSON probe and automatic rollback.
- `bootstrap` / `teardown` are part of `DeployPort`; the CLI no longer reaches
  into adapter internals.
- `teardown` refuses a remote root that `bootstrap` did not create.
- `ship` fails before deploying when the installed systemd unit drifted from
  `galadon.yaml`.
- `galadon new` archives a finished loop and returns to `build`.
- Remote paths are charset-checked before reaching a shell or a unit file.
- Added a runnable `examples/minimal` workspace.

## 0.1.0

- Five-stage loop (`spec`, `build`, `verify`, `ship`, `learn`) with one artifact
  and one gate per phase.
- `RolePort` presets (`solo`, `six-ring`, `orchestrator`), `TemplatePort`
  profiles (`web`, `api`, `static`), local `DeployPort` reference and `ToolPort`
  interfaces.
- `init`, `next`, `check`, `ship` and the managed `AGENTS.md` block.
