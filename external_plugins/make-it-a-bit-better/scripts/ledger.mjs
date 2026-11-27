import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_BYTES, parseSkillVocab, validateLedger } from "./ledger-format.mjs";

const EXIT = { pass: 0, findings: 1, usage: 2, legacy: 3, gate: 4 };
const USAGE = `usage:
  node scripts/ledger.mjs check  --target <repo-root | dir | file> [--no-git]
  node scripts/ledger.mjs backup --target <dir | file> --round <N> -- <file...>
  node scripts/ledger.mjs fail   --target <dir | file> --round <N>
exit codes: 0 pass, 1 findings to repair, 2 misuse, 3 legacy ledger, 4 gate (stop)`;
const HASH = /^[0-9a-f]{7,40}$/;
const ROUND_IN_SUBJECT = /^(?:mabb #(\d+)(?!\d)|[a-z]+(?:\([^)]*\))?[:!] mabb #(\d+)(?!\d))/;
const ROUND_SUBJECT_GREP = "^mabb #[0-9]+|^[a-z]+(\\([^)]*\\))?[:!] mabb #[0-9]+";
const LEDGER = ".agents/mabb/ledger.md";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function die(message) {
  console.error(`ledger: ${message}`);
  process.exit(EXIT.usage);
}

function parseArgs(argv) {
  const options = { command: null, target: null, noGit: false, round: null, files: [] };
  options.command = argv[0];
  if (!options.command) die(`missing command\n${USAGE}`);
  const rest = argv.slice(1);
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--") {
      positional.push(...rest.slice(index + 1));
      break;
    }
    if (arg === "--no-git") {
      options.noGit = true;
      continue;
    }
    if (arg === "--target" || arg === "--round") {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) die(`${arg} needs a value\n${USAGE}`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) die(`unknown option ${arg}\n${USAGE}`);
    positional.push(arg);
  }
  options.files = positional;
  return options;
}

function loadVocab() {
  const skillsDir = path.join(scriptDir, "..", "skills");
  const skills = existsSync(skillsDir) ? readdirSync(skillsDir).filter((name) => existsSync(path.join(skillsDir, name, "SKILL.md"))) : [];
  if (skills.length !== 1) die(`expected exactly one skill with a SKILL.md under ${skillsDir}, found ${skills.length}`);
  return parseSkillVocab(readFileSync(path.join(skillsDir, skills[0], "SKILL.md"), "utf8"));
}

function resolveTargetDir(target, noGit) {
  if (!target) die(`--target is required\n${USAGE}`);
  if (!existsSync(target)) die(`target not found: ${target}`);
  if (statSync(target).isFile()) {
    if (!noGit) die(`git mode takes the repository root directory, got the file ${target} — a single file is no-git mode`);
    return path.dirname(path.resolve(target));
  }
  return path.resolve(target);
}

function git(dir, args) {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") die("git not found on PATH — git mode needs it");
    throw result.error;
  }
  return result;
}

const short = (hash) => hash.slice(0, 7);
const describe = (commits) => commits.map((item) => `${short(item.hash)} "${item.subject}"`).join("; ");
const isRevert = (subject, n) => new RegExp(`mabb #${n}(?!\\d): revert\\s*$`, "i").test(subject);

function requireRepoRoot(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    const reason = top.stderr.trim().split("\n")[0] || `git exited ${top.status}`;
    return [`${dir} is not a git repository (${reason})`];
  }
  const root = top.stdout.trim();
  if (realpathSync(root) !== realpathSync(dir)) {
    return [`${dir} is nested inside the repository ${root} — mabb runs at the repository root`];
  }
  return [];
}

function roundCommits(dir) {
  const log = git(dir, ["log", "--all", "--format=%H%x09%s", "-E", `--grep=${ROUND_SUBJECT_GREP}`]);
  if (log.status !== 0) die(`git log failed in ${dir}: ${log.stderr.trim()}`);
  const byRound = new Map();
  for (const line of log.stdout.split("\n")) {
    const [hash, subject] = line.split("\t");
    const match = ROUND_IN_SUBJECT.exec(subject ?? "");
    if (!hash || !match) continue;
    const n = Number(match[1] ?? match[2]);
    if (!byRound.has(n)) byRound.set(n, []);
    byRound.get(n).push({ hash, subject });
  }
  return byRound;
}

function privacyFindings(dir) {
  if (git(dir, ["check-ignore", "-q", "--", LEDGER]).status === 0) return [];
  if (git(dir, ["ls-files", "--error-unmatch", "--", LEDGER]).status === 0) return [];
  return [
    `${LEDGER} is neither ignored nor tracked, so a commit could sweep it in — append \`.agents/mabb/\` to .gitignore (to .git/info/exclude instead when .gitignore carries someone else's change; see "Ledger privacy" in SKILL.md)`,
  ];
}

function gitFindings(dir, result, byRound, reachable) {
  const findings = [];
  for (const row of result.rows) {
    const round = byRound.get(row.n) ?? [];
    if (row.commit === "no-git") {
      findings.push(`row #${row.n}: commit "no-git" inside a git repository`);
      continue;
    }
    if (row.commit === "lost") {
      if (round.length) findings.push(`row #${row.n} says \`lost\` but round #${row.n} is in this repository: ${describe(round)} — put its hash back`);
      continue;
    }
    if (!HASH.test(row.commit)) continue;
    const found = locateCommit(dir, row.commit, reachable);
    if (found.state !== "reachable") {
      const moved = round.filter((item) => !isRevert(item.subject, row.n));
      findings.push(
        moved.length === 1
          ? `row #${row.n}: commit ${row.commit} is gone (history rewritten) but round #${row.n} now lives at ${short(moved[0].hash)} "${moved[0].subject}" — update the cell to that hash`
          : `row #${row.n}: commit ${row.commit} is no longer reachable — history was rewritten${found.state === "unreachable" ? " (the object lingers locally until garbage collection)" : ""}. Take its files from \`git show ${row.commit}\` if that still prints, else from the old row; set the cell to \`lost\`. A \`lost\` row is a record, not proof: when its change is missing from the tree too, write \`change gone\` in evidence and return its angle to the Backlog`,
      );
      continue;
    }
    const subject = git(dir, ["log", "-1", "--format=%s", found.hash]).stdout.trim();
    if (!row.legacy && !new RegExp(`mabb #${row.n}(?!\\d)`).test(subject)) {
      findings.push(
        `row #${row.n}: commit ${short(row.commit)} is "${subject}" — it does not cite mabb #${row.n} (wrong hash? a row imported from a legacy ledger whose commit kept another message is written \`v1 <hash>\`)`,
      );
    }
    const changed = new Set(git(dir, ["-c", "core.quotePath=false", "show", "--name-only", "--format=", found.hash]).stdout.split("\n").filter(Boolean));
    const stray = row.files.filter((file) => !changed.has(file));
    if (stray.length) findings.push(`row #${row.n}: not in commit ${short(row.commit)}: ${stray.join(", ")}`);
    if (row.failed) {
      const revert = round.find((item) => isRevert(item.subject, row.n));
      if (!revert) findings.push(`row #${row.n} is "failed, reverted" but there is no \`mabb #${row.n}: revert\` commit — the red change may still be in the tree`);
      else if (!revert.hash.startsWith(row.commit)) findings.push(`row #${row.n} is "failed, reverted" and must cite the revert commit ${short(revert.hash)}, not ${short(row.commit)}`);
    }
  }
  const recorded = new Set([...result.rows.map((row) => row.n), ...result.archiveNs]);
  for (const [n, commits] of byRound) {
    if (recorded.has(n)) continue;
    const plural = commits.length > 1 ? "s" : "";
    const revert = commits.find((item) => isRevert(item.subject, n));
    const how = revert
      ? `it was reverted (${short(revert.hash)}) — record the row as "failed, reverted" citing that revert commit`
      : "rebuild the row from the commit (angle from its subject, files from its diff, who feels it + evidence from its body)";
    findings.push(`round commit${plural} for #${n} exist${plural ? "" : "s"} but the ledger has no row: ${describe(commits)} — an earlier run stopped before recording; ${how}`);
  }
  return findings;
}

function legacyRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    rows.push({ n: Number(cells[0]), hash: cells.find((cell) => HASH.test(cell)) ?? null });
  }
  return rows;
}

function reachableCommits(dir) {
  const list = git(dir, ["rev-list", "--all"]);
  if (list.status !== 0) die(`git rev-list failed in ${dir}: ${list.stderr.trim()}`);
  return new Set(list.stdout.split("\n").filter(Boolean));
}

function locateCommit(dir, hash, reachable) {
  const full = git(dir, ["rev-parse", "--verify", "--quiet", `${hash}^{commit}`]);
  if (full.status !== 0) return { state: "gone" };
  return reachable.has(full.stdout.trim()) ? { state: "reachable", hash: full.stdout.trim() } : { state: "unreachable" };
}

function legacyCommitState(dir, row, reachable) {
  if (!row.hash) return "no commit cell — write `lost`";
  const found = locateCommit(dir, row.hash, reachable);
  if (found.state === "gone") return "gone — write `lost`";
  if (found.state !== "reachable") return "gone from every branch (the object lingers locally until garbage collection) — write `lost`";
  const subject = git(dir, ["log", "-1", "--format=%s", found.hash]).stdout.trim();
  const cited = new RegExp(`mabb #${row.n}(?!\\d)`).test(subject);
  return cited ? "reachable and cites its round — keep the hash" : `reachable as "${subject}" — write \`v1 ${row.hash}\``;
}

function failedDirFindings(dir, result) {
  const findings = [];
  for (const row of result.rows.filter((item) => item.failed)) {
    if (!existsSync(path.join(dir, ".agents", "mabb", "failed", String(row.n)))) {
      findings.push(`row #${row.n} is "failed, reverted" but .agents/mabb/failed/${row.n}/ is missing`);
    }
  }
  return findings;
}

function readLedger(dir) {
  const ledgerPath = path.join(dir, LEDGER);
  if (!existsSync(ledgerPath)) return "";
  if (!statSync(ledgerPath).isFile()) die(`${LEDGER} is not a file`);
  return readFileSync(ledgerPath, "utf8");
}

function check({ target, noGit }) {
  const dir = resolveTargetDir(target, noGit);
  if (!noGit) {
    const rootFindings = requireRepoRoot(dir);
    if (rootFindings.length) {
      console.log("ledger: STOP — git mode runs at a repository root");
      for (const finding of rootFindings) console.log(`  - ${finding}`);
      return EXIT.gate;
    }
  }
  const vocab = loadVocab();
  const text = readLedger(dir);
  const commits = noGit ? new Map() : roundCommits(dir);
  if (!text.trim()) {
    const findings = noGit ? [] : privacyFindings(dir);
    if (commits.size > 0) {
      const rounds = [...commits.keys()].sort((a, b) => a - b).join(", #");
      findings.unshift(`this repository already holds mabb round commits (#${rounds}) but has no ledger — rebuild the rows from those commits (angle from the subject, files from the diff, who feels it + evidence from its body) before round 1 is reused`);
    }
    if (findings.length === 0) {
      console.log("ledger: none yet — this is round 1");
      return EXIT.pass;
    }
    console.log(`ledger: FAIL — this is round 1, ${findings.length} finding${findings.length > 1 ? "s" : ""}`);
    for (const finding of findings) console.log(`  - ${finding}`);
    return EXIT.findings;
  }
  const result = validateLedger(text, vocab);
  if (result.legacy) {
    console.log("ledger: legacy format — convert it before any round work, once the repo gate and ledger privacy are settled; keep the old file as ledger.v1.md");
    console.log("  how: keep #, date, dimension, angle and evidence; take files from the old change text; an id-less icebox entry takes the next free IB-n; keep only the latest Lenses used line; a one-line next-round hint");
    console.log("  a `lost` row is a record, not proof: when its change is missing from the tree too, write `change gone` in evidence and return its angle to the Backlog");
    if (!noGit) {
      const reachable = reachableCommits(dir);
      for (const row of legacyRows(text)) console.log(`  - row #${row.n} commit ${row.hash ?? "-"}: ${legacyCommitState(dir, row, reachable)}`);
    }
    console.log(`next round: ${result.nextRound}`);
    return EXIT.legacy;
  }
  const findings = [...result.findings];
  if (noGit) {
    findings.push(...result.rows.filter((row) => row.commit !== "no-git").map((row) => `row #${row.n}: commit must be "no-git" in no-git mode, got "${row.commit}"`));
    findings.push(...failedDirFindings(dir, result));
  } else {
    findings.push(...privacyFindings(dir));
    if (!result.unmarked) findings.push(...gitFindings(dir, result, commits, reachableCommits(dir)));
  }
  const shape = `${result.rows.length} full row${result.rows.length === 1 ? "" : "s"}${result.archiveNs.length ? `, ${result.archiveNs.length} archived` : ""}`;
  if (findings.length === 0) {
    console.log(`ledger: PASS — next round ${result.nextRound} (${shape}), ${result.bytes}/${BUDGET_BYTES} bytes`);
    return EXIT.pass;
  }
  console.log(`ledger: FAIL — next round ${result.nextRound} (${shape}), ${findings.length} finding${findings.length > 1 ? "s" : ""}`);
  for (const finding of findings) console.log(`  - ${finding}`);
  return EXIT.findings;
}

function stateDir(dir, name) {
  return path.join(dir, ".agents", "mabb", name);
}

function relativeInside(dir, input) {
  const rel = path.relative(dir, path.resolve(dir, input));
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) die(`backup: ${input} is not inside the target directory`);
  const normalized = rel.split(path.sep).join("/");
  const lower = normalized.toLowerCase();
  if (lower === ".agents/mabb" || lower.startsWith(".agents/mabb/")) die(`backup: ${input} is mabb's own state, not a round's file`);
  return normalized;
}

function lstat(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function copyInto(root, rel, source) {
  const destination = path.join(root, rel);
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { dereference: true });
}

function pruneEmpty(directory, stop) {
  for (let current = directory; current !== stop && current.startsWith(stop); current = path.dirname(current)) {
    try {
      rmdirSync(current);
    } catch (error) {
      if (error.code === "ENOTEMPTY" || error.code === "EEXIST" || error.code === "ENOENT") return;
      throw error;
    }
  }
}

function parseRound(round) {
  if (round === null) die(`--round is required\n${USAGE}`);
  if (!/^[1-9]\d*$/.test(round)) die(`--round must be a positive integer, got "${round}"`);
  return Number(round);
}

function readManifest(backupDir) {
  const manifestPath = path.join(backupDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    die(`backup manifest is unreadable (${manifestPath}): ${error.message}`);
  }
  const shaped =
    manifest &&
    Number.isInteger(manifest.round) &&
    manifest.round >= 1 &&
    Array.isArray(manifest.files) &&
    manifest.files.every((entry) => entry && typeof entry.path === "string" && typeof entry.existed === "boolean");
  if (!shaped) die(`backup manifest is malformed (${manifestPath}) — remove .agents/mabb/backup and back the round's files up again before editing`);
  return manifest;
}

function backup({ target, round, files }) {
  const dir = resolveTargetDir(target, true);
  const n = parseRound(round);
  if (!files.length) die(`backup needs at least one file after "--"\n${USAGE}`);
  const backupDir = stateDir(dir, "backup");
  const existing = readManifest(backupDir);
  if (existing && existing.round !== n) rmSync(backupDir, { recursive: true, force: true });
  const manifest = existing && existing.round === n ? existing : { round: n, files: [] };
  const known = new Set(manifest.files.map((entry) => entry.path));
  const requested = [...new Set(files.map((input) => relativeInside(dir, input)))];
  const late = requested.filter((rel) => !known.has(rel));
  if (known.size && late.length) {
    die(
      `backup: round ${n} already declared its files — ${late.join(", ")} came later. Run \`fail --round ${n}\` to undo this attempt, then start the round over listing every file up front`,
    );
  }
  const filesRoot = path.join(backupDir, "files");
  for (const rel of requested.filter((item) => !known.has(item))) {
    const source = path.join(dir, rel);
    const stats = lstat(source);
    if (stats) {
      if (stats.isSymbolicLink()) die(`backup: ${rel} is a symlink — no-git mode does not back symlinks up; polish the real file instead`);
      if (!stats.isFile()) die(`backup: ${rel} is not a regular file`);
      copyInto(filesRoot, rel, source);
    }
    manifest.files.push({ path: rel, existed: Boolean(stats) });
  }
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const listed = manifest.files.map((entry) => (entry.existed ? entry.path : `${entry.path} (new)`)).join(", ");
  console.log(`backup: round ${n} — ${listed}`);
  return EXIT.pass;
}

function fail({ target, round }) {
  const dir = resolveTargetDir(target, true);
  const n = parseRound(round);
  const backupDir = stateDir(dir, "backup");
  const manifest = readManifest(backupDir);
  if (!manifest) die(`no backup to fail — run backup before the round's first edit`);
  if (manifest.round !== n) die(`the backup is for round ${manifest.round}, not ${n}`);
  const failedDir = stateDir(dir, path.join("failed", String(n)));
  if (existsSync(failedDir)) die(`.agents/mabb/failed/${n}/ already exists`);
  for (const entry of manifest.files) {
    const current = path.join(dir, entry.path);
    const stats = lstat(current);
    if (stats && !stats.isFile()) {
      die(`fail: ${entry.path} became a ${stats.isSymbolicLink() ? "symlink" : "directory"} during round ${n} — restore it by hand from ${path.join(backupDir, "files", entry.path)}`);
    }
    if (entry.existed && !existsSync(path.join(backupDir, "files", entry.path))) die(`backup copy of ${entry.path} is missing — cannot restore it`);
  }
  for (const entry of manifest.files) {
    const current = path.join(dir, entry.path);
    if (lstat(current)) copyInto(path.join(failedDir, "after"), entry.path, current);
    if (!entry.existed) {
      rmSync(current, { force: true });
      pruneEmpty(path.dirname(current), dir);
      continue;
    }
    const before = path.join(backupDir, "files", entry.path);
    copyInto(path.join(failedDir, "before"), entry.path, before);
    cpSync(before, current);
  }
  rmSync(backupDir, { recursive: true, force: true });
  console.log(`fail: round ${n} reverted — before/after copies kept in .agents/mabb/failed/${n}/`);
  return EXIT.pass;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "check") return check(options);
  if (options.command === "backup") return backup(options);
  if (options.command === "fail") return fail(options);
  die(`unknown command "${options.command}"\n${USAGE}`);
}

process.exit(main());
