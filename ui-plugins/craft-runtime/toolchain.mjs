import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

// Compiling a Craft application needs the pinned Rust toolchain and Trunk.
// A build machine opts into installing them with CRAFT_TOOLCHAIN_INSTALL=1;
// anywhere else a missing tool is reported with the command that provides it.

const runtime = dirname(fileURLToPath(import.meta.url));
const exists = (path) => access(path).then(() => true, () => false);

// Version probes must answer from what is installed. They run without the pinned
// toolchain selected and with rustup's install-on-demand off, otherwise a probe
// would start a silent download of the toolchain it is asking about.
function capture(command, args, env) {
  return new Promise((accept) => {
    let output = "";
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", () => { clearTimeout(timer); accept({ ok: false, output: "" }); });
    child.on("exit", (code) => { clearTimeout(timer); accept({ ok: code === 0, output: output.trim() }); });
  });
}

function run(command, args, env, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? accept() : reject(new Error(`${command} ${args.join(" ")} failed (${code})`))));
  });
}

export async function readToolchain(runtimeDir = runtime) {
  return JSON.parse(await readFile(join(runtimeDir, "toolchain.json"), "utf8"));
}

const OFFICIAL_DIST = "https://static.rust-lang.org";
const fetchLine = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.text()).trim().split(/\s+/)[0];
};

// A mirror may serve the toolchain only if its channel manifest is the official one,
// byte for byte. rustup then checks every component against the hashes in that manifest.
async function trustedDistServer(mirror, version, fetchHash) {
  const path = `/dist/channel-rust-${version}.toml.sha256`;
  const [official, mirrored] = await Promise.all([fetchHash(OFFICIAL_DIST + path), fetchHash(mirror.replace(/\/$/, "") + path)]);
  if (!/^[a-f0-9]{64}$/.test(official) || official !== mirrored)
    throw new Error(`CRAFT_RUSTUP_DIST_SERVER serves a different Rust ${version} manifest than ${OFFICIAL_DIST}; refusing to install from it`);
  return mirror.replace(/\/$/, "");
}

// Cargo cannot take a registry replacement from the environment. A config file in the cache
// root covers the patched sources below it; Cargo.lock checksums still verify every crate.
async function writeCargoConfig(cache, registry) {
  const file = join(cache, ".cargo", "config.toml");
  if (!registry) return rm(file, { force: true });
  if (!/^sparse\+https:\/\/[A-Za-z0-9._~\/-]+$/.test(registry)) throw new Error("CRAFT_CARGO_REGISTRY must be a sparse+https:// registry URL");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `# Written by the Craft build from CRAFT_CARGO_REGISTRY.\n[source.crates-io]\nreplace-with = "craft-mirror"\n\n[source.craft-mirror]\nregistry = "${registry}"\n`);
}

/**
 * Resolve the environment for compile.mjs, installing what is missing when allowed.
 * Trunk is installed into <cache>/tools; rustup keeps its usual home.
 */
export async function ensureToolchain({ env = process.env, cache, log = console.log, runtimeDir = runtime, probe = capture, exec = run, fetchHash = fetchLine } = {}) {
  const pinned = await readToolchain(runtimeDir);
  const tools = join(cache, "tools");
  await mkdir(cache, { recursive: true });
  await writeCargoConfig(cache, env.CRAFT_CARGO_REGISTRY);
  const install = env.CRAFT_TOOLCHAIN_INSTALL === "1";
  const cargoHome = env.CARGO_HOME || join(homedir(), ".cargo");
  const result = {
    ...env,
    PATH: [join(tools, "bin"), join(cargoHome, "bin"), env.PATH].filter(Boolean).join(delimiter),
  };
  delete result.RUSTUP_TOOLCHAIN;
  const probing = { ...result, RUSTUP_AUTO_INSTALL: "0" };
  const probeTool = (command, args) => probe(command, args, probing);
  const missing = (what, fix) =>
    new Error(`${what} is required to compile Craft Web snapshots. ${fix} Or set CRAFT_TOOLCHAIN_INSTALL=1 to let the build install it.`);

  if (!(await probeTool("rustup", ["--version"])).ok) {
    if (!install) throw missing("rustup", "Install it from https://rustup.rs.");
    log("Installing rustup (no default toolchain, PATH untouched)");
    await exec("sh", ["-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --profile minimal --default-toolchain none"], result);
  }
  const toolchains = await probeTool("rustup", ["toolchain", "list"]);
  const present = toolchains.ok && toolchains.output.split("\n").some((line) => line.startsWith(`${pinned.rust}-`));
  const targets = present ? await probeTool("rustup", ["target", "list", "--installed", "--toolchain", pinned.rust]) : { ok: false, output: "" };
  if (!targets.ok || !targets.output.split(/\s+/).includes(pinned.target)) {
    const command = ["toolchain", "install", pinned.rust, "--profile", "minimal", "--target", pinned.target];
    if (!install) throw missing(`Rust ${pinned.rust} with ${pinned.target}`, `Run: rustup ${command.join(" ")}.`);
    const dist = env.CRAFT_RUSTUP_DIST_SERVER ? await trustedDistServer(env.CRAFT_RUSTUP_DIST_SERVER, pinned.rust, fetchHash) : null;
    log(`Installing Rust ${pinned.rust} with ${pinned.target}${dist ? ` from ${dist} (manifest matches ${OFFICIAL_DIST})` : ""}`);
    await exec("rustup", command, dist ? { ...result, RUSTUP_DIST_SERVER: dist } : result);
  }

  const wanted = `trunk ${pinned.trunk}`;
  const candidates = [env.TRUNK, join(tools, "bin", "trunk"), "trunk"].filter(Boolean);
  let trunk;
  for (const candidate of candidates) {
    if ((await probeTool(candidate, ["--version"])).output === wanted) { trunk = candidate; break; }
  }
  if (!trunk) {
    // `cargo install` ignores directory configuration, so the registry mirror is passed inline.
    const mirror = env.CRAFT_CARGO_REGISTRY
      ? ["--config", 'source.crates-io.replace-with="craft-mirror"', "--config", `source.craft-mirror.registry="${env.CRAFT_CARGO_REGISTRY}"`]
      : [];
    const command = ["install", "trunk", "--version", pinned.trunk, "--locked", "--root", tools, ...mirror];
    if (!install) throw missing(`Trunk ${pinned.trunk}`, `Run: cargo ${command.slice(0, 7).join(" ")}, or point TRUNK at that version.`);
    log(`Installing Trunk ${pinned.trunk} into ${tools}`);
    await exec("cargo", command, { ...result, RUSTUP_TOOLCHAIN: pinned.rust }, { cwd: cache });
    trunk = join(tools, "bin", "trunk");
    if ((await probeTool(trunk, ["--version"])).output !== wanted) throw new Error(`Installed Trunk is not ${pinned.trunk}`);
  }
  result.TRUNK = trunk;
  // Upstream checkouts may carry their own toolchain file; the snapshot records this one.
  result.RUSTUP_TOOLCHAIN = pinned.rust;

  // The tool catalogue is read from the compiled WASM in a real browser.
  if (!result.CHROME_PATH) {
    const defaults = process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
    let found = false;
    for (const path of defaults) found ||= await exists(path);
    if (!found && process.platform !== "win32")
      throw new Error("Chrome is required to extract the tool catalogue from the compiled WASM. Install Google Chrome or set CHROME_PATH.");
  }
  return result;
}
