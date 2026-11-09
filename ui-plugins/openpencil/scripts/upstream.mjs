import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

export const upstreamRevision = "c29654cd07ac46b53e76c16b18505919f16571be";
const sha256 = "68f86e1f807f35847b9453a7049b3d59375c4eef441a4afffc215a24c843a409";
export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(pluginRoot, "../../node_modules/.cache/openpencil-upstream");
export const upstreamRoot = join(cache, `open-pencil-${upstreamRevision}`);
// The checkout-local cache is wiped with node_modules. A build machine can keep the
// verified source archive elsewhere so it is downloaded once (a leading ~ is expanded).
const archives = process.env.OPENPENCIL_SOURCE_CACHE
  ? resolve(process.env.OPENPENCIL_SOURCE_CACHE.replace(/^~(?=\/|$)/, homedir()))
  : cache;
const sourceUrl = `https://codeload.github.com/open-pencil/open-pencil/tar.gz/${upstreamRevision}`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function run(command, args, cwd) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

// curl honours HTTPS_PROXY / NO_PROXY and retries a dropped connection; Node's fetch does
// neither here. fetch stays as the fallback where curl is not installed.
async function download(destination) {
  try {
    await run(
      "curl",
      ["--fail", "--location", "--silent", "--show-error", "--retry", "4", "--retry-all-errors",
        "--connect-timeout", "30", "--max-time", "900", "--output", destination, sourceUrl],
      dirname(destination),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`OpenPencil source download: ${error.message}`);
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`OpenPencil source download: ${response.status}`);
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
  }
}

export async function prepareUpstream() {
  await mkdir(cache, { recursive: true });
  await mkdir(archives, { recursive: true });
  const archive = join(archives, `open-pencil-${upstreamRevision}.tar.gz`);
  const bytes = await readFile(archive).catch(() => null);
  if (!bytes || digest(bytes) !== sha256) {
    // Verified before it takes the cached name: a concurrent build never reads a partial file.
    const partial = `${archive}.${process.pid}.partial`;
    try {
      await download(partial);
      if (digest(await readFile(partial)) !== sha256)
        throw new Error("OpenPencil source checksum mismatch");
      await rename(partial, archive);
    } finally {
      await rm(partial, { force: true });
    }
  }
  if (
    !(await access(join(upstreamRoot, "package.json")).then(
      () => true,
      () => false,
    ))
  ) {
    await run("tar", ["-xzf", archive, "-C", cache], cache);
  }
  const marker = join(upstreamRoot, ".zcode-dependencies-ready");
  if (
    !(await access(marker).then(
      () => true,
      () => false,
    ))
  ) {
    await run(process.env.BUN_BIN ?? "bun", ["install", "--frozen-lockfile"], upstreamRoot);
    await writeFile(marker, upstreamRevision);
  }
  return upstreamRoot;
}
