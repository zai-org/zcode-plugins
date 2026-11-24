// Bash invocation details shared by the two spawn sites in server.ts:
// shell-argument quoting and Windows process semantics.
//
// Two facts make a naive `spawn("bash", …)` wrong on Windows:
// 1. Two unrelated bash.exe ship on a typical Windows box — Git Bash's
//    usr\bin\bash.exe and the WSL launcher at System32\bash.exe. Which one
//    PATH yields depends on the caller's environment (an MCP server started
//    from a GUI gets a different PATH than a terminal), so commands can
//    silently execute in WSL with different path semantics.
// 2. runCommand kills benchmarks via negative-pid process groups
//    (process.kill(-pid)); Windows has no such addressing — every call
//    fails with ESRCH and the tree survives the timeout, hanging the tool
//    call until the benchmark finishes naturally.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

let cachedBash: string | null = null;

// WSL's launcher masquerades as bash.exe in three places: the system copies
// (System32/SysWOW64) and the store's app-execution aliases — machine-wide
// (C:\Windows\WindowsApps) and per-user (%LOCALAPPDATA%\Microsoft\WindowsApps,
// on every default Windows user PATH). None accept Git-Bash-style scripts:
// handing one a repo path fails with "/bin/bash: <path>: No such file or
// directory" (exit 127), and a benchmark command would silently run under
// WSL path semantics instead.
function isWslOrStub(path: string): boolean {
  return /(\\Windows\\(System32|SysWOW64|WindowsApps)|\\Microsoft\\WindowsApps)\\/i.test(
    path,
  );
}

// The selection rule for where.exe hits, as a pure function so the stub
// filter and the usr\bin preference are testable on every platform.
export function pickUsableBash(paths: string[]): string | null {
  const usable = paths.filter((p) => !isWslOrStub(p));
  // Git for Windows installs bash at <root>\usr\bin\bash.exe — prefer it so
  // the outer shell matches what measure.sh authors expect and so
  // unixToolsPathEntry sees a coreutils-bearing directory.
  const gitBash = usable.find((p) => /\\usr\\bin\\bash\.exe$/i.test(p));
  return gitBash ?? usable[0] ?? null;
}

// Standard install locations a slim GUI PATH can hide — the bash twin of
// resolveGit's GIT_CANDIDATES. Git for Windows' installer puts bash.exe under
// <root>\usr\bin and <root>\bin, but the default PATH entry it adds is only
// Git\cmd (git's shim directory, no bash), so a GUI-launched server's
// where.exe finds nothing but the WSL launchers. Real evidence 2026-10-29
// (nano-jev V1 resume): registry PATH carried Git\cmd only; every
// run_experiment died with "no usable bash.exe on PATH". Prefer usr\bin.
const BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

export function resolveBash(candidates?: string[]): string {
  if (candidates !== undefined) {
    // Injected candidates (tests) bypass the PATH probe and the cache.
    for (const path of candidates) {
      if (existsSync(path)) return path;
    }
    throw new Error(
      "no usable bash.exe among injected candidates or standard install locations (install Git for Windows; the WSL launchers in System32 and the WindowsApps aliases are excluded)",
    );
  }
  if (process.platform !== "win32") return "bash";
  if (cachedBash) return cachedBash;
  let hits: string[] = [];
  try {
    // where.exe reads the Windows PATH directly, no shell in the middle.
    hits = execFileSync("where.exe", ["bash"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    hits = [];
  }
  const resolved = pickUsableBash(hits);
  if (resolved) {
    cachedBash = resolved;
    return resolved;
  }
  // PATH hides bash entirely — derive it from where git landed (the one Git
  // directory the installer does put on PATH) before falling back to the
  // installer defaults. <root>\cmd\git.exe ⇒ <root>\{usr\bin,bin}\bash.exe.
  try {
    const gitHit = execFileSync("where.exe", ["git"], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)[0];
    if (gitHit) {
      const root = dirname(dirname(gitHit));
      const derived = [
        `${root}\\usr\\bin\\bash.exe`,
        `${root}\\bin\\bash.exe`,
      ].find((p) => existsSync(p));
      if (derived) {
        cachedBash = derived;
        return derived;
      }
    }
  } catch {
    // no git on PATH either — fall through to the standard locations
  }
  for (const path of BASH_CANDIDATES) {
    if (existsSync(path)) {
      cachedBash = path;
      return path;
    }
  }
  throw new Error(
    "no usable bash.exe on PATH or standard install locations (install Git for Windows; the WSL launchers in System32 and the WindowsApps aliases are excluded)",
  );
}

// Single-quote a value for `bash -c`. Paths reach runCommand inside a shell
// string, where an unquoted apostrophe (e.g. "Alex's project") ends the
// quoting early and the command dies with a syntax error; the checks gate
// would read that nonzero exit as "checks failed". Inside single quotes bash
// treats every character literally, so only the quote itself needs escaping.
export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Windows equivalent of killing the process group: taskkill /T walks the
// child tree, /F forces termination. Returns false when the tree was
// already gone. On POSIX callers keep their own group-kill semantics.
export function killTree(pid: number): boolean {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

// Kill the wrapper when the tree walk fails. A failed taskkill means the
// child tree outlives the timeout and the caller waits for an "exit" that may
// never come; killing the wrapper is the lesser failure.
export function killTreeOrWrapper(
  pid: number | undefined,
  killWrapper: () => void,
  treeKiller: (pid: number) => boolean = killTree,
): void {
  if (pid == null || treeKiller(pid)) return;
  try {
    killWrapper();
  } catch {
    /* already gone */
  }
}

// Git for Windows keeps its coreutils (head, grep, date…) next to bash.exe
// in <root>\usr\bin; prepend that directory to spawned shells so benchmark
// and hook scripts keep coreutils. No-op under plain PATH semantics —
// usr\bin must already be on the server's PATH for resolveBash to land
// there — kept as cheap defense for hosts that curate child environments.
export function unixToolsPathEntry(bashPath: string): string | null {
  if (process.platform !== "win32") return null;
  const dir = dirname(bashPath);
  return /usr[\\/]bin$/i.test(dir) ? dir : null;
}

export function spawnEnv(
  bashPath: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const entry = unixToolsPathEntry(bashPath);
  if (!entry) return base;
  // Windows env keys are case-insensitive in spirit but plain objects are
  // not; reuse the existing key so we never emit both PATH and Path.
  const pathKey =
    Object.keys(base).find((key) => key.toLowerCase() === "path") ?? "PATH";
  return { ...base, [pathKey]: `${entry};${base[pathKey] ?? ""}` };
}
