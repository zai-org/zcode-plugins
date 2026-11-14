#!/usr/bin/env node
/**
 * Detached finalizer for the balance-dashboard app.asar injection.
 *
 * ZCode keeps app.asar open while it runs. If the atomic replace fails, this
 * process waits for the lock to clear, verifies that app.asar is still the same
 * source the stage was built from, then replaces it. It never overwrites an
 * asar that changed in the meantime (for example after an official update).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const stage = arg("--stage");
const asar = arg("--asar");
const runtime = arg("--runtime") || (stage ? path.dirname(stage) : "");
const metaPath = stage ? `${stage}.json` : "";
const statusPath = runtime ? path.join(runtime, "status.json") : "";

function log(...args) {
  if (!runtime) return;
  try {
    fs.appendFileSync(
      path.join(runtime, "inject.log"),
      `[${new Date().toISOString()}] [finalize] ${args.join(" ")}\n`,
    );
  } catch {
    // logging must never throw
  }
}

function writeStatus(state, message, extra = {}) {
  if (!statusPath) return;
  try {
    fs.mkdirSync(runtime, { recursive: true });
    const tmp = `${statusPath}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          state,
          message,
          asarPath: asar || "",
          injected: state === "injected",
          pending: state === "pending-restart",
          updatedAt: new Date().toISOString(),
          ...extra,
        },
        null,
        2,
      ),
    );
    fs.renameSync(tmp, statusPath);
  } catch {
    // status is diagnostic only
  }
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch {
    return null;
  }
}

function sameSource(meta) {
  try {
    const stat = fs.statSync(asar);
    return stat.size === meta.source.size && stat.mtimeMs === meta.source.mtimeMs;
  } catch {
    return false;
  }
}

function removeStage() {
  try {
    fs.unlinkSync(stage);
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(metaPath);
  } catch {
    // ignore
  }
}

async function main() {
  if (!stage || !asar) throw new Error("--stage and --asar are required");
  const started = Date.now();
  const deadline = started + 2 * 60 * 60 * 1000;
  const patchMod = await import(
    `${pathToFileURL(path.join(runtime, "scripts", "asar-patch.mjs")).href}?v=${Date.now()}`
  );

  while (Date.now() < deadline) {
    if (!fs.existsSync(stage)) return;
    const meta = readMeta();
    if (!meta || !meta.source) {
      log("stage metadata missing; discarding", stage);
      removeStage();
      return;
    }
    if (!sameSource(meta)) {
      log("app.asar changed since the stage was built; discarding", stage);
      removeStage();
      writeStatus("error", "ZCode 已更新或 app.asar 已变化，请重启 ZCode 触发重新注入。");
      return;
    }
    try {
      // Never promote an unvalidated stage. Full hash check of every entry.
      patchMod.validateAsar(stage, { expectBalance: true });
    } catch (error) {
      log("stage validation failed; discarding:", error.message);
      removeStage();
      writeStatus("error", `补丁校验失败，未替换 app.asar：${error.message}`);
      return;
    }
    try {
      const result = patchMod.replaceAsarWithBackup(stage, asar, {
        stageOptions: { expectBalance: true },
        postOptions: { expectBalance: true },
      });
      try {
        fs.unlinkSync(metaPath);
      } catch {
        // ignore
      }
      log("replacement completed; backup:", result.backup);
      writeStatus("injected", "左侧余额组件已注入；重启 ZCode 后生效。", {
        backup: result.backup,
      });
      return;
    } catch (error) {
      log("replacement blocked, retrying:", error.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  writeStatus("pending-restart", "等待 ZCode 退出超时；请完全退出 ZCode 后重启。");
}

main().catch((error) => {
  log("fatal:", error.stack || error.message);
  writeStatus("error", `注入收尾失败：${error.message || error}`);
  process.exitCode = 1;
});
