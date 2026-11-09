import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheRoot, ensureSnapshot, expandHome, snapshotDigest, snapshotMatches, withLock } from "./snapshot.mjs";
import { ensureToolchain, readToolchain } from "./toolchain.mjs";

const HASH = "a".repeat(64);

async function plugin(commit = "1".repeat(40)) {
  const root = await mkdtemp(join(tmpdir(), "craft-snapshot-"));
  const source = join(root, "ui-plugins", "photocraft");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "upstream.json"), JSON.stringify({
    name: "photocraft", title: "PhotoCraft", repository: "https://example.invalid/photocraft.git", commit, version: "1.0.0",
  }));
  return { root, source, env: { CRAFT_BUILD_CACHE: join(root, "cache") } };
}

// Stands in for compile.mjs: writes what a real compilation leaves in web/.
function compiler(calls) {
  return async ({ source, digest }) => {
    calls.push(digest);
    const web = join(source, "web");
    await mkdir(join(web, "licenses"), { recursive: true });
    await writeFile(join(web, `${HASH}.gz`), "wasm");
    await writeFile(join(web, "tools.json"), "[]");
    await writeFile(join(web, "manifest.json"), JSON.stringify({ snapshotDigest: digest, files: [{ path: "index.html", sha256: HASH }] }));
  };
}

test("cache location honours CRAFT_BUILD_CACHE and a leading ~", () => {
  assert.equal(expandHome("~/x", "/home/ci"), "/home/ci/x");
  assert.equal(expandHome("/abs/x", "/home/ci"), "/abs/x");
  assert.equal(cacheRoot("/repo", {}), "/repo/.craft-cache");
  assert.equal(cacheRoot("/repo", { CRAFT_BUILD_CACHE: "/var/cache/craft" }), "/var/cache/craft");
});

test("the digest follows the pinned upstream and the patches", async () => {
  const a = await plugin();
  const b = await plugin("2".repeat(40));
  const first = await snapshotDigest(a.source);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await snapshotDigest(a.source));
  assert.notEqual(first, await snapshotDigest(b.source));
  await mkdir(join(a.source, "patches"));
  await writeFile(join(a.source, "patches", "one.patch"), "diff");
  assert.notEqual(first, await snapshotDigest(a.source));
  await rm(a.root, { recursive: true }); await rm(b.root, { recursive: true });
});

test("a clean checkout compiles once, then every later build restores from the cache", async () => {
  const { root, source, env } = await plugin();
  const calls = [];
  const options = { source, root, env, compile: compiler(calls), log: () => {} };
  assert.equal((await ensureSnapshot(options)).origin, "compiled");
  assert.equal((await ensureSnapshot(options)).origin, "local");
  // CI wipes ignored files between jobs; the cache outlives the checkout.
  await rm(join(source, "web"), { recursive: true });
  assert.equal((await ensureSnapshot(options)).origin, "cache");
  assert.equal(calls.length, 1);
  assert.equal(await readFile(join(source, "web", `${HASH}.gz`), "utf8"), "wasm");
  await rm(root, { recursive: true });
});

test("a snapshot built for other inputs is never reused", async () => {
  const { root, source, env } = await plugin();
  const calls = [];
  const options = { source, root, env, compile: compiler(calls), log: () => {} };
  await ensureSnapshot(options);
  await mkdir(join(source, "patches"));
  await writeFile(join(source, "patches", "new.patch"), "diff");
  assert.equal((await ensureSnapshot(options)).origin, "compiled");
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
  // Both stay cached: another branch may still pin the older inputs.
  assert.equal((await readdir(join(env.CRAFT_BUILD_CACHE, "snapshots", "photocraft"))).length, 2);
  await rm(root, { recursive: true });
});

test("an incomplete snapshot is rejected and a failed compilation caches nothing", async () => {
  const { root, source, env } = await plugin();
  const digest = await snapshotDigest(source);
  const web = join(source, "web");
  await mkdir(web, { recursive: true });
  await writeFile(join(web, "manifest.json"), JSON.stringify({ snapshotDigest: digest, files: [{ path: "a.wasm", sha256: HASH }] }));
  assert.equal(await snapshotMatches(web, digest), false);
  await assert.rejects(ensureSnapshot({ source, root, env, log: () => {}, compile: async () => { throw new Error("cargo failed"); } }), /cargo failed/);
  await assert.rejects(ensureSnapshot({ source, root, env, log: () => {}, compile: async () => {} }), /without a complete Web snapshot/);
  assert.deepEqual(await readdir(join(env.CRAFT_BUILD_CACHE, "snapshots")).catch(() => []), []);
  assert.deepEqual(await readdir(join(env.CRAFT_BUILD_CACHE, "locks")), []);
  await rm(root, { recursive: true });
});

test("concurrent jobs compile once: the second waits and restores", async () => {
  const { root, source, env } = await plugin();
  const other = join(root, "ui-plugins", "second");
  await mkdir(other, { recursive: true });
  await writeFile(join(other, "upstream.json"), await readFile(join(source, "upstream.json")));
  const calls = [];
  const slow = async (context) => { await new Promise((done) => setTimeout(done, 150)); await compiler(calls)(context); };
  const options = { root, env, compile: slow, log: () => {}, lockOptions: { pollMs: 20 } };
  const results = await Promise.all([ensureSnapshot({ ...options, source }), ensureSnapshot({ ...options, source: other })]);
  assert.deepEqual(results.map((result) => result.origin).sort(), ["cache", "compiled"]);
  assert.equal(calls.length, 1);
  await rm(root, { recursive: true });
});

test("a lock left by a dead process is taken over; a live one times out", async () => {
  const folder = await mkdtemp(join(tmpdir(), "craft-lock-"));
  const lock = join(folder, "locks", "x.lock");
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: Date.now() }));
  assert.equal(await withLock(lock, async () => "ran", { pollMs: 10 }), "ran");
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  await assert.rejects(withLock(lock, async () => "ran", { pollMs: 10, waitMs: 60 }), /Timed out/);
  await rm(folder, { recursive: true });
});

function fakeTools(installed) {
  const ran = [];
  const probe = async (command, args, env) => {
    assert.equal(env.RUSTUP_TOOLCHAIN, undefined, "a probe must not select the toolchain it is checking for");
    assert.equal(env.RUSTUP_AUTO_INSTALL, "0");
    if (command === "rustup" && args[0] === "--version") return { ok: installed.rustup, output: "rustup 1.28" };
    if (command === "rustup" && args[0] === "toolchain") return { ok: true, output: installed.rust ? "stable-aarch64-apple-darwin (default)\n1.95.0-aarch64-apple-darwin" : "stable-aarch64-apple-darwin (default)" };
    if (command === "rustup" && args[0] === "target") return { ok: installed.rust, output: installed.rust ? "aarch64-apple-darwin\nwasm32-unknown-unknown" : "" };
    if (command.endsWith("trunk")) return { ok: installed.trunk, output: installed.trunk ? `trunk ${installed.trunk}` : "" };
    return { ok: false, output: "" };
  };
  const exec = async (command, args) => {
    ran.push([command, ...args].join(" "));
    if (command === "sh") installed.rustup = true;
    if (command === "rustup") installed.rust = true;
    if (command === "cargo") installed.trunk = "0.21.14";
  };
  return { ran, probe, exec };
}

test("a missing toolchain is reported with its fix unless installation is enabled", async () => {
  const pinned = await readToolchain();
  const cache = await mkdtemp(join(tmpdir(), "craft-tools-"));
  const tools = join(cache, "tools");
  const base = { PATH: "/usr/bin", CHROME_PATH: "/chrome" };
  let fake = fakeTools({ rustup: true, rust: false, trunk: null });
  await assert.rejects(ensureToolchain({ env: base, cache, log: () => {}, ...fake }), new RegExp(`rustup toolchain install ${pinned.rust}`));
  assert.deepEqual(fake.ran, []);
  fake = fakeTools({ rustup: true, rust: true, trunk: "0.20.0" });
  await assert.rejects(ensureToolchain({ env: base, cache, log: () => {}, ...fake }), /Trunk 0\.21\.14/);

  fake = fakeTools({ rustup: false, rust: false, trunk: null });
  const env = await ensureToolchain({ env: { ...base, CRAFT_TOOLCHAIN_INSTALL: "1" }, cache, log: () => {}, ...fake });
  assert.equal(fake.ran.length, 3);
  assert.match(fake.ran[0], /sh\.rustup\.rs.*--no-modify-path.*--default-toolchain none/);
  assert.equal(fake.ran[1], `rustup toolchain install ${pinned.rust} --profile minimal --target ${pinned.target}`);
  assert.equal(fake.ran[2], `cargo install trunk --version ${pinned.trunk} --locked --root ${tools}`);
  assert.equal(env.RUSTUP_TOOLCHAIN, pinned.rust);
  assert.equal(env.TRUNK, join(tools, "bin", "trunk"));
  assert.ok(env.PATH.startsWith(join(tools, "bin")));

  fake = fakeTools({ rustup: true, rust: true, trunk: pinned.trunk });
  await ensureToolchain({ env: base, cache, log: () => {}, ...fake });
  assert.deepEqual(fake.ran, []);
  await rm(cache, { recursive: true });
});

test("mirrors are optional: a dist mirror must serve the official manifest, a registry mirror is written for cargo", async () => {
  const pinned = await readToolchain();
  const cache = await mkdtemp(join(tmpdir(), "craft-tools-"));
  const base = { PATH: "/usr/bin", CHROME_PATH: "/chrome", CRAFT_TOOLCHAIN_INSTALL: "1", CRAFT_RUSTUP_DIST_SERVER: "https://mirror.invalid/" };
  const hashes = (mirror) => async (url) => (url.startsWith("https://static.rust-lang.org/") ? "a".repeat(64) : mirror);

  let fake = fakeTools({ rustup: true, rust: false, trunk: pinned.trunk });
  await assert.rejects(ensureToolchain({ env: base, cache, log: () => {}, fetchHash: hashes("b".repeat(64)), ...fake }), /different Rust .* manifest/);
  assert.deepEqual(fake.ran, []);

  fake = fakeTools({ rustup: true, rust: false, trunk: null });
  const seen = [];
  const installs = [];
  const exec = async (command, args, env) => {
    if (command === "rustup") seen.push(env.RUSTUP_DIST_SERVER);
    if (command === "cargo") installs.push(args.join(" "));
    return fake.exec(command, args);
  };
  await ensureToolchain({ env: { ...base, CRAFT_CARGO_REGISTRY: "sparse+https://mirror.invalid/index/" }, cache, log: () => {}, fetchHash: hashes("a".repeat(64)), probe: fake.probe, exec });
  assert.deepEqual(seen, ["https://mirror.invalid"]);
  assert.match(installs[0], /--config source\.crates-io\.replace-with="craft-mirror" --config source\.craft-mirror\.registry="sparse\+https:\/\/mirror\.invalid\/index\/"$/);
  const config = await readFile(join(cache, ".cargo", "config.toml"), "utf8");
  assert.match(config, /\[source\.crates-io\]\nreplace-with = "craft-mirror"/);
  assert.match(config, /registry = "sparse\+https:\/\/mirror\.invalid\/index\/"/);

  // Without the setting the replacement goes away again; a malformed one is refused.
  fake = fakeTools({ rustup: true, rust: true, trunk: pinned.trunk });
  await ensureToolchain({ env: { PATH: "/usr/bin", CHROME_PATH: "/chrome" }, cache, log: () => {}, ...fake });
  await assert.rejects(readFile(join(cache, ".cargo", "config.toml")), /ENOENT/);
  await assert.rejects(ensureToolchain({ env: { PATH: "/usr/bin", CRAFT_CARGO_REGISTRY: 'x"\n[evil]' }, cache, log: () => {}, ...fake }), /sparse\+https/);
  await rm(cache, { recursive: true });
});
