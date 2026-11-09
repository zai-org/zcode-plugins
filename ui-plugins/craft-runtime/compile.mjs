import { cp, mkdir, readFile, readdir, writeFile, access, rm } from "node:fs/promises";
import { dirname, join, resolve, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { gzipSync } from "node:zlib";
import { sha256 } from "./assets.mjs";
import { normalizeWasm, normalization } from "./normalize-wasm.mjs";
import { overlayDigest } from "./overlay.mjs";
import { cacheRoot, readPatches, snapshotDigest } from "./snapshot.mjs";

const runtime = dirname(fileURLToPath(import.meta.url));
const root = resolve(runtime, "../..");
const source = process.cwd();
const config = JSON.parse(await readFile(join(source, "upstream.json"), "utf8"));
const snapshot = join(source, "web");
const automationOverlay = await overlayDigest(config.name);
const cache = cacheRoot(root);
const exists = async (path) => access(path).then(() => true, () => false);
const git = (cwd, args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
async function run(command, args, cwd, env = process.env) {
  await new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? accept() : reject(new Error(`${command} failed (${code})`)));
  });
}
let upstream = resolve(process.env.CRAFT_SOURCE_ROOT || dirname(root), config.name);
if (!(await exists(join(upstream, ".git")))) {
  upstream = join(cache, "sources", config.name);
  await mkdir(upstream, { recursive: true });
  if (!(await exists(join(upstream, ".git")))) await run("git", ["init", "--quiet"], upstream);
  // The cache outlives a pin change and an interrupted fetch: always land on the pinned commit.
  const head = () => { try { return git(upstream, ["rev-parse", "--verify", "--quiet", "HEAD"]); } catch { return ""; } };
  if (head() !== config.commit) {
    for (let attempt = 1; ; attempt++) {
      try {
        await run("git", ["fetch", "--depth", "1", config.repository, config.commit], upstream);
        break;
      } catch (error) {
        if (attempt === 3) throw error;
        console.log(`${config.name}: upstream fetch failed (attempt ${attempt}); retrying`);
        await new Promise((done) => setTimeout(done, 10000));
      }
    }
    await run("git", ["checkout", "--force", "--detach", "FETCH_HEAD"], upstream);
  }
}
if (git(upstream, ["rev-parse", "HEAD"]) !== config.commit)
  throw new Error(`${config.name}: expected upstream commit ${config.commit}`);
if (git(upstream, ["status", "--porcelain", "--untracked-files=no"]))
  throw new Error(`${config.name}: upstream checkout has tracked changes; use a clean pinned checkout`);

const patches = await readPatches(source);
const sourcePrefix = dirname(upstream);
const patchDir = join(source, "patches");
{
  const patched = join(cache, "patched", config.name);
  await rm(patched, { recursive: true, force: true });
  await mkdir(patched, { recursive: true });
  await new Promise((accept, reject) => {
    const archive = spawn("git", ["-C", upstream, "archive", config.commit], { stdio: ["ignore", "pipe", "inherit"] });
    const unpack = spawn("tar", ["-x", "-C", patched], { stdio: ["pipe", "inherit", "inherit"] });
    archive.stdout.pipe(unpack.stdin);
    const finished = (child) => new Promise((ok, fail) => {
      child.on("error", fail);
      child.on("exit", (code) => code === 0 ? ok() : fail(new Error(`Source extraction failed (${code})`)));
    });
    Promise.all([finished(archive), finished(unpack)]).then(accept, reject);
  });
  for (const patch of patches) await run("git", ["apply", join(patchDir, patch.name)], patched);
  await run("python3", [join(runtime, "prepare-automation.py"), patched, config.name], root);
  await run("python3", [join(runtime, "prepare-fonts.py"), patched, config.name], root);
  upstream = patched;
}
const site = join(upstream, "dist/web");
const trunk = process.env.TRUNK || "trunk";
{
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(cache, "target"),
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4",
    CARGO_INCREMENTAL: "0",
    CRAFT_FONTS_DIR: runtime,
    CRAFT_FONTS_REQUIRED: "1",
    CRAFT_CJK_FONT: join(runtime, "fonts/LXGWWenKai-Regular.ttf"),
  };
  delete env.NO_COLOR;
  delete env.TRUNK_NO_COLOR;
  // Resolve only the added overlay edges; upstream dependency versions remain lock-pinned.
  execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], { cwd: upstream, env, stdio: "ignore" });
  execFileSync("cargo", ["check", "--target", "wasm32-unknown-unknown", "-p", `${config.name}-web`], { cwd: upstream, env, stdio: "inherit" });
  await run(trunk, ["build", "--release", "--locked", "--skip-version-check", "--color", "never"],
    join(upstream, "apps", `${config.name}-web`), env);
}


const files = [];
await mkdir(snapshot, { recursive: true });
await run(process.execPath, [join(runtime, "extract-catalog.mjs"), site, join(snapshot, "tools.json")], root);
async function pack(folder) {
  for (const file of (await readdir(folder, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = join(folder, file.name);
    if (file.isDirectory()) await pack(path);
    else if (file.isFile() && !/\.(map|br|gz)$/.test(file.name)) {
      const original = await readFile(path);
      const bytes = file.name.endsWith(".wasm") ? normalizeWasm(original, [homedir(), sourcePrefix]) : original;
      const hash = sha256(bytes);
      await writeFile(join(snapshot, hash + ".gz"), gzipSync(bytes, { level: 9 }));
      files.push({ path: relative(site, path).split("\\").join("/"), bytes: bytes.length, sha256: hash, sourceSha256: sha256(original) });
    }
  }
}
await pack(site);
for (const file of await readdir(snapshot)) {
  if (/^[a-f0-9]{64}\.gz$/.test(file) && !files.some((entry) => entry.sha256 + ".gz" === file))
    await rm(join(snapshot, file));
}
// Retain upstream notices and the license text of the dependencies actually linked to wasm.
const licenseDir = join(snapshot, "licenses");
await rm(licenseDir, { recursive: true, force: true });
await mkdir(licenseDir, { recursive: true });
for (const entry of await readdir(upstream, { withFileTypes: true })) {
  const file = entry.name;
  if (entry.isFile() && /^(LICENSE|NOTICE|ATTRIBUTION|ASSETS)([-.]|$)/i.test(file)) {
    try { await cp(join(upstream, file), join(licenseDir, file), { recursive: true }); } catch (error) {
      throw new Error(`Could not preserve ${file}: ${error.message}`);
    }
  }
}
async function assetLicenses(folder) {
  if (!(await exists(folder))) return;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await assetLicenses(path);
    else if (entry.isFile() && /^(LICENSE|COPYING|NOTICE|OFL)([-.]|$)/i.test(entry.name)) {
      const destination = join(licenseDir, relative(upstream, path));
      await mkdir(dirname(destination), { recursive: true });
      await cp(path, destination);
    }
  }
}
await assetLicenses(join(upstream, "assets"));
await mkdir(join(licenseDir, "fonts"), { recursive: true });
for (const file of ["OFL-LXGWWenKai.txt", "provenance.json"])
  await cp(join(runtime, "fonts", file), join(licenseDir, "fonts", file));
const brand = join(upstream, "docs/brand/LICENSE-brand.txt");
if (await exists(brand)) await cp(brand, join(licenseDir, "LICENSE-brand.txt"));
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown"], {
  cwd: upstream, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
}));
const packages = new Map(metadata.packages.map((item) => [item.id, item]));
const nodes = new Map(metadata.resolve.nodes.map((item) => [item.id, item]));
const visited = new Set();
const visit = (id) => { if (visited.has(id)) return; visited.add(id); for (const dep of nodes.get(id)?.dependencies || []) visit(dep); };
visit(metadata.packages.find((item) => item.name === `${config.name}-web`).id);
const notices = [];
for (const id of [...visited].sort()) {
  const item = packages.get(id);
  notices.push(`\n${item.name} ${item.version}\nLicense: ${item.license || "See accompanying text"}\n${item.repository || item.source || config.repository}\n`);
  const folder = dirname(item.manifest_path);
  const files = new Set((await readdir(folder)).filter((file) => /^(LICENSE|COPYING|NOTICE)([-.]|$)/i.test(file)));
  if (item.license_file) files.add(item.license_file);
  for (const file of [...files].sort()) {
    try { notices.push(`--- ${basename(file)} ---\n${await readFile(join(folder, file), "utf8")}\n`); }
    catch (error) { if (error.code !== "EISDIR") throw error; }
  }
}
await writeFile(join(licenseDir, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));

await writeFile(join(snapshot, "manifest.json"), JSON.stringify({
  snapshotDigest: await snapshotDigest(source),
  repository: config.repository, commit: config.commit, version: config.version,
  patches,
  automationOverlay,
  toolCatalogSha256: sha256(await readFile(join(snapshot, "tools.json"))),
  diagnosticPathNormalization: normalization,
  command: "trunk build --release --locked --skip-version-check --color never",
  rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  files,
}, null, 2) + "\n");
console.log(`Compiled snapshot ${config.name}: ${files.length} files`);
