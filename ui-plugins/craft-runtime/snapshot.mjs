import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { sha256 } from "./assets.mjs";
import { normalization } from "./normalize-wasm.mjs";
import { overlayDigest } from "./overlay.mjs";

// The compiled Web snapshot under <plugin>/web is a build output. It is never
// committed: a build takes it from the working tree, then from the snapshot
// cache, and compiles the pinned upstream only when neither has it.

const runtime = dirname(fileURLToPath(import.meta.url));
const exists = (path) => access(path).then(() => true, () => false);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// GitLab expands $HOME in `variables:` to an empty string, so CI passes "~/...".
export function expandHome(path, home = homedir()) {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

export function cacheRoot(root, env = process.env) {
  return resolve(env.CRAFT_BUILD_CACHE ? expandHome(env.CRAFT_BUILD_CACHE) : join(root, ".craft-cache"));
}

export async function readPatches(source) {
  const folder = join(source, "patches");
  if (!(await exists(folder))) return [];
  const patches = [];
  for (const name of (await readdir(folder)).filter((name) => name.endsWith(".patch")).sort())
    patches.push({ name, sha256: sha256(await readFile(join(folder, name))) });
  return patches;
}

// Everything that decides the compiled bytes, apart from the machine it runs on.
// Scripts are part of it: a changed compiler or packer must not reuse old output.
const COMPILER_FILES = ["compile.mjs", "extract-catalog.mjs", "normalize-wasm.mjs", "toolchain.json"];

export async function snapshotDigest(source, runtimeDir = runtime) {
  const config = JSON.parse(await readFile(join(source, "upstream.json"), "utf8"));
  const compiler = {};
  for (const file of COMPILER_FILES) compiler[file] = sha256(await readFile(join(runtimeDir, file)));
  return sha256(JSON.stringify({
    name: config.name,
    repository: config.repository,
    commit: config.commit,
    patches: await readPatches(source),
    overlay: await overlayDigest(config.name),
    normalization,
    compiler,
  }));
}

// Cheap completeness check; build.mjs still verifies every byte it unpacks.
export async function snapshotMatches(folder, digest) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
  } catch {
    return false;
  }
  if (manifest.snapshotDigest !== digest || !Array.isArray(manifest.files) || !manifest.files.length) return false;
  for (const file of manifest.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "") || !(await exists(join(folder, `${file.sha256}.gz`)))) return false;
  }
  return (await exists(join(folder, "tools.json"))) && (await exists(join(folder, "licenses")));
}

async function lockOwnerAlive(lock, staleMs, now) {
  try {
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    if (now() - owner.startedAt > staleMs) return false;
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "EPERM") return true;
    // A lock directory without a readable owner is either being written or abandoned.
    const info = await stat(lock).catch(() => null);
    return info ? now() - info.mtimeMs < 5000 : false;
  }
}

// Two jobs of one pipeline build on the same machine at the same time. They share
// the cargo target directory and the patched source copy, so only one may compile.
export async function withLock(lock, task, { waitMs = 3 * 60 * 60 * 1000, staleMs = 4 * 60 * 60 * 1000, pollMs = 5000, now = Date.now, log = () => {} } = {}) {
  await mkdir(dirname(lock), { recursive: true });
  const deadline = now() + waitMs;
  let announced = false;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!(await lockOwnerAlive(lock, staleMs, now))) {
      await rm(lock, { recursive: true, force: true });
      continue;
    }
    if (now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
    if (!announced) log(`Another build holds ${lock}; waiting`);
    announced = true;
    await sleep(pollMs);
  }
  try {
    await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: now() }));
    return await task();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function replaceFolder(from, to) {
  const staging = `${to}.tmp-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(dirname(to), { recursive: true });
  await cp(from, staging, { recursive: true });
  await rm(to, { recursive: true, force: true });
  await rename(staging, to);
}

/**
 * Make <source>/web hold the snapshot for the current inputs.
 * Returns where it came from: "local", "cache" or "compiled".
 */
export async function ensureSnapshot({ source, root, env = process.env, compile, log = console.log, runtimeDir = runtime, lockOptions }) {
  const config = JSON.parse(await readFile(join(source, "upstream.json"), "utf8"));
  const digest = await snapshotDigest(source, runtimeDir);
  const web = join(source, "web");
  if (await snapshotMatches(web, digest)) return { origin: "local", digest };

  const cache = cacheRoot(root, env);
  const cached = join(cache, "snapshots", config.name, digest);
  const restore = async () => {
    if (!(await snapshotMatches(cached, digest))) return false;
    await replaceFolder(cached, web);
    return true;
  };
  if (await restore()) {
    log(`${config.name}: Web snapshot ${digest.slice(0, 12)} restored from ${cached}`);
    return { origin: "cache", digest };
  }

  return withLock(join(cache, "locks", `${config.name}.lock`), async () => {
    // The job that held the lock before us usually compiled exactly this snapshot.
    if (await restore()) {
      log(`${config.name}: Web snapshot ${digest.slice(0, 12)} restored from ${cached}`);
      return { origin: "cache", digest };
    }
    log(`${config.name}: compiling Web snapshot ${digest.slice(0, 12)} from ${config.repository}@${config.commit.slice(0, 12)}`);
    await rm(web, { recursive: true, force: true });
    await compile({ source, digest, cache });
    if (!(await snapshotMatches(web, digest)))
      throw new Error(`${config.name}: compilation finished without a complete Web snapshot`);
    await replaceFolder(web, cached);
    return { origin: "compiled", digest };
  }, { log, ...lockOptions });
}
