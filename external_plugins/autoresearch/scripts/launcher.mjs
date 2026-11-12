// Cross-platform Node launcher: the registered entry for the MCP server and
// every hook. Replaces run-node.sh (ADR-9 wrapper) after the 2026-11-09 field
// evidence: the Windows host spawns `command` directly and `sh` is not on its
// PATH, so a .sh wrapper can never run there (`'sh' is not recognized`,
// mcp.server.failed). Plain `node` is the only command the host reliably
// resolves on all three platforms — official plugins ship `command: node`.
//
// Contract (port of run-node.sh, unchanged semantics):
//   node launcher.mjs <script.ts> [args...]   resolve Node >= 24, run script
//   node launcher.mjs --resolve               print resolved node, exit 0
//
// Resolution order:
//   1. AUTORESEARCH_NODE_BIN  — authoritative; missing / not executable /
//                               too old is a hard error (127), no fallback.
//   2. PATH                   — first suitable `node`(/node.exe).
//   3. nvm                    — POSIX: $NVM_DIR (default ~/.nvm)
//                               versions/node/*/bin/node, glob order, first
//                               qualifying; win32: %NVM_HOME% (default
//                               %APPDATA%\nvm) v*/node.exe, highest qualifying.
//   4. Known install dirs     — POSIX: /opt/homebrew/bin/node,
//                               /usr/local/bin/node; win32:
//                               %ProgramFiles%\nodejs\node.exe and x86.
//
// stdout belongs to the JSON-RPC channel: in exec mode this launcher writes
// no stdout at all (probing happens in spawnSync with captured output), and
// diagnostics go to stderr only. Exit codes pass through (signal n exits
// 128+n, matching the shell convention the .sh wrapper gave us via exec).
// This launcher must parse on any modern Node: plain ESM, stdlib only,
// no build step (ADR-6 unchanged), no third-party deps.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NODE_MIN_MAJOR = 24;
const NODE_HINT =
  "Install Node >= 24, or set AUTORESEARCH_NODE_BIN to a suitable binary.";

function fail(message) {
  process.stderr.write(`autoresearch launcher: ${message}\n`);
  process.exit(127);
}

function isExecutable(path) {
  try {
    const st = statSync(path);
    if (!st.isFile()) return false;
    return process.platform === "win32" || (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Integer major of "vMAJOR.MINOR.PATCH" (or the raw process.versions.node).
function versionMajor(version) {
  const digits = String(version ?? "").replace(/^v/, "");
  const major = Number.parseInt(digits.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

// `node -p process.versions.node` on a candidate; empty when it does not run.
function probeVersion(bin) {
  const probe = spawnSync(bin, ["-p", "process.versions.node"], {
    encoding: "utf8",
  });
  const out = (probe.stdout ?? "").trim();
  return /^\d+\.\d+\.\d+$/.test(out) ? out : "";
}

// Candidate executables from PATH entries (node.exe on win32, node elsewhere).
function pathCandidates() {
  const dirs = (process.env.PATH ?? "").split(
    process.platform === "win32" ? ";" : ":",
  );
  const name = process.platform === "win32" ? "node.exe" : "node";
  const out = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const bin = join(dir, name);
    if (isExecutable(bin) && !out.includes(bin)) out.push(bin);
  }
  return out;
}

// nvm candidates. POSIX nvm-sh keeps versions at `$NVM_DIR/versions/node/<v>`
// (legacy layouts put them at the root); win32 nvm-windows at `<root>/<v>`.
// Within a base, newest version first — the search takes the first qualifying.
function nvmCandidates() {
  const out = [];
  const nvmDir =
    process.env.NVM_HOME ||
    process.env.NVM_DIR ||
    (process.platform === "win32"
      ? join(process.env.APPDATA ?? "", "nvm")
      : join(process.env.HOME ?? "", ".nvm"));
  const bases =
    process.platform === "win32"
      ? [nvmDir]
      : [join(nvmDir, "versions", "node"), nvmDir];
  for (const base of bases) {
    let versions = [];
    try {
      versions = readdirSync(base)
        .filter((name) => /^v?\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => {
          const pa = a.replace(/^v/, "").split(".").map(Number);
          const pb = b.replace(/^v/, "").split(".").map(Number);
          for (let i = 0; i < 3; i += 1) {
            if ((pa[i] ?? 0) !== (pb[i] ?? 0))
              return (pb[i] ?? 0) - (pa[i] ?? 0);
          }
          return 0;
        });
    } catch {
      // base does not exist — no candidates from here.
      continue;
    }
    for (const version of versions) {
      const bin =
        process.platform === "win32"
          ? join(base, version, "node.exe")
          : join(base, version, "bin", "node");
      if (isExecutable(bin) && !out.includes(bin)) out.push(bin);
    }
  }
  return out;
}

// Known fixed install locations (platform-specific).
function fixedCandidates() {
  const out = [];
  const push = (bin) => {
    if (isExecutable(bin) && !out.includes(bin)) out.push(bin);
  };
  if (process.platform === "win32") {
    push(
      join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "nodejs",
        "node.exe",
      ),
    );
    push(
      join(
        process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
        "nodejs",
        "node.exe",
      ),
    );
  } else {
    push("/opt/homebrew/bin/node");
    push("/usr/local/bin/node");
  }
  return out;
}

// Sets NODE_BIN; returns false when nothing suitable exists.
function chooseNode() {
  const override = process.env.AUTORESEARCH_NODE_BIN;
  if (override) {
    if (!isExecutable(override)) {
      fail(`AUTORESEARCH_NODE_BIN=${override} is not an executable file`);
    }
    const version = probeVersion(override);
    if (versionMajor(version) < NODE_MIN_MAJOR) {
      fail(
        `AUTORESEARCH_NODE_BIN=${override} is Node ${version || "unknown"}; ` +
          `Node >= ${NODE_MIN_MAJOR} is required (native TypeScript execution)`,
      );
    }
    NODE_BIN = override;
    return true;
  }

  for (const bin of [
    ...pathCandidates(),
    ...nvmCandidates(),
    ...fixedCandidates(),
  ]) {
    if (versionMajor(probeVersion(bin)) >= NODE_MIN_MAJOR) {
      NODE_BIN = bin;
      return true;
    }
  }
  return false;
}

const searched =
  process.platform === "win32"
    ? "Searched: PATH, nvm (%NVM_HOME% or %APPDATA%\\nvm), %ProgramFiles%\\nodejs."
    : "Searched: PATH, nvm (${NVM_DIR:-$HOME/.nvm}), /opt/homebrew/bin, /usr/local/bin.";

let NODE_BIN;
const args = process.argv.slice(2);

if (args[0] === "--resolve") {
  if (!chooseNode()) {
    fail(`no Node >= ${NODE_MIN_MAJOR} found. ${searched} ${NODE_HINT}`);
  }
  process.stdout.write(`node=${NODE_BIN}\nversion=${probeVersion(NODE_BIN)}\n`);
  process.exit(0);
}

if (args.length < 1) {
  process.stderr.write(
    "autoresearch launcher: usage: launcher.mjs <script.ts> [args...] | --resolve\n",
  );
  process.exit(2);
}

if (!chooseNode()) {
  fail(
    `no Node >= ${NODE_MIN_MAJOR} found. ${searched} ${NODE_HINT} (tried to run: ${args[0]})`,
  );
}

// Signal kills surface as exit 128+n (the shell convention run-node.sh's exec
// preserved); a normal exit passes through verbatim.
const SIGNAL_EXIT = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGABRT: 134,
  SIGKILL: 137,
  SIGTERM: 143,
};
const child = spawnSync(NODE_BIN, args, { stdio: "inherit" });
if (child.error) fail(`failed to launch ${NODE_BIN}: ${child.error.message}`);
process.exit(
  child.status ?? (child.signal ? (SIGNAL_EXIT[child.signal] ?? 128) : 1),
);
