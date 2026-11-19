// launcher.mjs resolver tests: the launch contract shared by the MCP server
// and every hook. Subprocess pattern (the launcher is the registered entry, so
// its observable interface is the process boundary). Branches:
//   - AUTORESEARCH_NODE_BIN override wins / is authoritative
//   - PATH-first, nvm fallthrough, exhaust-with-remedy
//   - win32 nvm-windows layout (versioned dirs, newest first)
//   - exit-code passthrough, stdout purity, real MCP handshake
// POSIX-only branches keep run-node.sh's shell-stub trick; win32 branches
// hardlink the real test node (named node.exe) — previously the whole file
// was skipped on Windows, which is exactly where the 2026-11-09 attach
// failure happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LAUNCHER = join(ROOT, "scripts", "launcher.mjs");
const SERVER = join(ROOT, "mcp", "server.ts");
const REAL_NODE = process.execPath;

const isWin = process.platform === "win32";
const skipPosixOnly = isWin ? "POSIX-only branch (shell stub)" : false;
const skipWinOnly = !isWin ? "win32-only branch" : false;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `ar-launcher-${prefix}-`));
}

// POSIX stub node: reports the given version to the `-p` probe, echoes its
// arguments otherwise (so exec passthrough is observable on stdout).
function stubNode(dir: string, version: string): string {
  const bin = join(dir, "node");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "\${1:-}" = "-p" ]; then echo "${version}"; exit 0; fi\nfor arg in "$@"; do echo "$arg"; done\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

// win32 stand-in for a node.exe: hardlink the real binary when possible (same
// volume), fall back to a copy. The probe reports the real version, so any
// placement of this file behaves like an install of the current node.
function realNodeAs(dir: string, name = "node.exe"): string {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, name);
  try {
    linkSync(REAL_NODE, bin);
  } catch {
    copyFileSync(REAL_NODE, bin);
  }
  return bin;
}

const pathSep = isWin ? ";" : ":";

function runLauncher(
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      input: "",
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

test("override wins and passes arguments through exec", () => {
  const resolved = runLauncher(["--resolve"], {
    AUTORESEARCH_NODE_BIN: REAL_NODE,
  });
  assert.equal(resolved.status, 0);
  assert.match(resolved.stdout, /^node=.+/m);
  assert.match(resolved.stdout, /^version=\d+\.\d+\.\d+$/m);

  // The target writes exactly one line, so an exact stdout match also proves
  // the launcher itself writes no stdout before handing over the channel.
  const exec = runLauncher(["-e", "console.log('alpha')"], {
    AUTORESEARCH_NODE_BIN: REAL_NODE,
  });
  assert.equal(exec.status, 0);
  assert.equal(exec.stdout, "alpha\n");
});

test("override is authoritative: missing binary is a hard error", () => {
  const missing = join(tempDir("missing"), isWin ? "node.exe" : "node");
  const out = runLauncher(["--resolve"], { AUTORESEARCH_NODE_BIN: missing });
  assert.equal(out.status, 127);
  assert.match(out.stderr, /is not an executable file/);
});

test(
  "override is authoritative: too old is a hard error, no fallback",
  { skip: skipPosixOnly },
  () => {
    const dir = tempDir("old-override");
    const bin = stubNode(dir, "18.19.0");
    const out = runLauncher(["--resolve"], { AUTORESEARCH_NODE_BIN: bin });
    assert.equal(out.status, 127);
    assert.match(out.stderr, /Node >= 24 is required/);
    assert.match(out.stderr, /18\.19\.0/);
  },
);

test("PATH node is used when suitable", () => {
  const pathDir = tempDir("path-dir");
  if (isWin) {
    realNodeAs(pathDir);
  } else {
    stubNode(pathDir, "24.3.0");
  }
  const emptyNvm = tempDir("empty-nvm");
  const resolved = runLauncher(["--resolve"], {
    PATH: `${pathDir}${pathSep}${tempDir("filler")}`,
    NVM_DIR: emptyNvm,
    NVM_HOME: emptyNvm,
    APPDATA: tempDir("empty-appdata"),
    AUTORESEARCH_NODE_BIN: "",
  });
  assert.equal(resolved.status, 0);
  assert.match(
    resolved.stdout,
    new RegExp(
      `^node=${pathDir.replace(/[\\\\/]/g, "[\\\\/]")}[\\\\/]node(\\.exe)?$`,
      "m",
    ),
  );
});

test(
  "too-old PATH node falls through to a suitable nvm node",
  { skip: skipPosixOnly },
  () => {
    const pathDir = tempDir("old-path");
    stubNode(pathDir, "18.0.0");
    const nvmDir = tempDir("nvm");
    const bin = stubNode(
      join(nvmDir, "versions", "node", "v24.5.0", "bin"),
      "24.5.0",
    );
    const resolved = runLauncher(["--resolve"], {
      PATH: `${pathDir}${pathSep}${tempDir("filler")}`,
      NVM_DIR: nvmDir,
      AUTORESEARCH_NODE_BIN: "",
    });
    assert.equal(resolved.status, 0);
    assert.match(
      resolved.stdout,
      new RegExp(`^node=${bin.replace(/\//g, "\\/")}$`, "m"),
    );
  },
);

test(
  "win32 nvm-windows layout: newest versioned node.exe under NVM_HOME wins",
  { skip: skipWinOnly },
  () => {
    const nvmHome = tempDir("nvm-home");
    // Both directories hold the real binary; only the directory names differ,
    // so the winner is decided by the newest-first ordering alone.
    realNodeAs(join(nvmHome, "v24.2.0"));
    const newest = realNodeAs(join(nvmHome, "v24.10.0"));
    // An old versioned directory without a runnable node.exe must be skipped.
    mkdirSync(join(nvmHome, "v18.0.0"), { recursive: true });
    const resolved = runLauncher(["--resolve"], {
      NVM_HOME: nvmHome,
      NVM_DIR: "",
      PATH: tempDir("empty-path"),
      AUTORESEARCH_NODE_BIN: "",
    });
    assert.equal(resolved.status, 0);
    assert.match(
      resolved.stdout,
      new RegExp(`^node=${newest.replace(/\\/g, "\\\\")}$`, "m"),
    );
  },
);

const posixHostFallbackNode =
  !isWin &&
  (existsSync("/opt/homebrew/bin/node") || existsSync("/usr/local/bin/node"));

// When the host ships node in the unconditional fallback locations the search
// space cannot be emptied from the test sandbox; the exhaust branch then only
// runs where those paths are absent (e.g. the Linux CI runner). win32 is
// skipped for the same reason (%ProgramFiles%\nodejs).
test(
  "nothing found anywhere exits 127 with a remedy on stderr",
  { skip: isWin || posixHostFallbackNode },
  () => {
    const out = runLauncher(["--resolve"], {
      PATH: `${tempDir("empty-path")}${pathSep}${tempDir("filler")}`,
      NVM_DIR: tempDir("empty-nvm"),
      AUTORESEARCH_NODE_BIN: "",
    });
    assert.equal(out.status, 127);
    assert.match(out.stderr, /no Node >= 24 found/);
    assert.match(out.stderr, /AUTORESEARCH_NODE_BIN/);
  },
);

test("real node: exit code passes through exec", () => {
  const out = runLauncher(["-e", "process.exit(7)"]);
  assert.equal(out.status, 7);
});

test("real node: --resolve reports the resolved binary and version", () => {
  const out = runLauncher(["--resolve"]);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^node=.+\nversion=\d+\.\d+\.\d+\n$/);
});

// Regression for the 2026-11-09 attach failure: the registered entry must
// bring up the real MCP server on every platform (the Windows host failed
// `'sh' is not recognized` with the .sh wrapper).
test("MCP handshake through the launcher", async () => {
  const child = spawn(process.execPath, [LAUNCHER, SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    }) + "\n",
  );
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n",
  );
  const lines: string[] = [];
  await new Promise<void>((resolveParse) => {
    let buffer = "";
    const timer = setTimeout(() => resolveParse(), 15000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\n");
      while (index !== -1) {
        lines.push(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
      if (lines.length >= 2) {
        clearTimeout(timer);
        child.kill();
        resolveParse();
      }
    });
    child.on("exit", () => resolveParse());
  });
  const initialize = JSON.parse(lines[0] ?? "{}") as {
    result?: { serverInfo?: { name?: string } };
  };
  assert.equal(initialize.result?.serverInfo?.name, "autoresearch");
  const listed = JSON.parse(lines[1] ?? "{}") as {
    result?: { tools?: Array<{ name: string }> };
  };
  assert.deepEqual(
    (listed.result?.tools ?? []).map((tool) => tool.name).sort(),
    [
      "clear_experiments",
      "export_dashboard",
      "init_experiment",
      "log_experiment",
      "run_experiment",
    ],
  );
});
