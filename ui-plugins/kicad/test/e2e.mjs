#!/usr/bin/env node
// Runs test/e2e-artifact.mjs (real KiCad 10, uv, headless Chrome). Inside the zcode-plugins workspace it runs in place; in any other tree set ZT_PLUGINS_SRC to a
// zcode-plugins checkout and the file is run from there, where playwright-core, esbuild and the pinned SDKs are installed.
//   pnpm build && pnpm test:e2e
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, ZT_KICAD_UI_PLUGIN: ROOT };
const inPlace = (() => { try { createRequire(join(ROOT, "package.json")).resolve("playwright-core"); return true; } catch { return false; } })();
if (inPlace) process.exit(spawnSync(process.execPath, [join(ROOT, "test/e2e-artifact.mjs")], { cwd: ROOT, stdio: "inherit", env }).status ?? 1);
if (!process.env.ZT_PLUGINS_SRC) { console.error("playwright-core is not installed here: run pnpm install, or set ZT_PLUGINS_SRC to a zcode-plugins checkout"); process.exit(2); }
const PLUGINS = resolve(process.env.ZT_PLUGINS_SRC);
const target = join(PLUGINS, "scripts", "zt-kicad-artifact-test.mjs");
copyFileSync(join(ROOT, "test/e2e-artifact.mjs"), target);
try { process.exitCode = spawnSync(process.execPath, [target], { cwd: PLUGINS, stdio: "inherit", env }).status ?? 1; } finally { rmSync(target, { force: true }); }
