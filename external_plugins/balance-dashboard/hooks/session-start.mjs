#!/usr/bin/env node
/**
 * SessionStart hook.
 *
 * 1. Sync the injector runtime into a stable user directory.
 * 2. Make sure app.asar contains the loader line (repair after ZCode updates).
 * 3. If app.asar is locked, stage the patch and start a detached finalizer.
 *
 * The hook always prints one JSON object and never fails the session.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME =
  (process.env.BALANCE_RUNTIME_DIR && process.env.BALANCE_RUNTIME_DIR.trim()) ||
  path.join(os.homedir(), ".zcode", "balance-dashboard", "runtime");
const STATUS_PATH = path.join(RUNTIME, "status.json");
const VERSION = "0.3.0";

const FILES = [
  ["server/data.mjs", "server/data.mjs"],
  ["scripts/collect-once.mjs", "scripts/collect-once.mjs"],
  ["scripts/query-analytics.mjs", "scripts/query-analytics.mjs"],
  ["scripts/asar-patch.mjs", "scripts/asar-patch.mjs"],
  ["scripts/restore-backup.mjs", "scripts/restore-backup.mjs"],
  ["sidebar/inject-main.cjs", "sidebar/inject-main.cjs"],
  ["sidebar/sidebar-widget.js", "sidebar/sidebar-widget.js"],
  ["hooks/finalize.mjs", "hooks/finalize.mjs"],
  ["hooks/post-patch.mjs", "hooks/post-patch.mjs"],
];

function readPreviousStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeStatus(state, message, extra = {}) {
  try {
    fs.mkdirSync(RUNTIME, { recursive: true });
    const tmp = `${STATUS_PATH}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        {
          state,
          message,
          updatedAt: new Date().toISOString(),
          pluginRoot: PLUGIN_ROOT,
          runtime: RUNTIME,
          version: VERSION,
          ...extra,
        },
        null,
        2,
      ),
    );
    fs.renameSync(tmp, STATUS_PATH);
  } catch {
    // diagnostic only
  }
}

function copyRuntime() {
  const errors = [];
  for (const [srcRel, dstRel] of FILES) {
    const src = path.join(PLUGIN_ROOT, srcRel);
    const dst = path.join(RUNTIME, dstRel);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    } catch (error) {
      errors.push(`${srcRel}: ${error.message}`);
    }
  }
  try {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(
      path.join(RUNTIME, "config.json"),
      JSON.stringify(
        {
          pluginRoot: PLUGIN_ROOT,
          version: VERSION,
          loader: path.join(RUNTIME, "sidebar", "inject-main.cjs"),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    errors.push(`config.json: ${error.message}`);
  }
  return errors;
}

function removeStage(stage) {
  for (const file of [stage, `${stage}.json`]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

function spawnPostPatch(asar) {
  const lock = `${asar}.balance-dashboard.postpatch.lock`;
  try {
    const stat = fs.statSync(lock);
    if (Date.now() - stat.mtimeMs < 30 * 60 * 1000) return false;
  } catch {
    // no live lock
  }
  try {
    fs.writeFileSync(lock, String(Date.now()));
  } catch {
    // ignore; the process still de-duplicates by checking the marker
  }
  try {
    const child = spawn(
      process.execPath,
      [
        path.join(RUNTIME, "hooks", "post-patch.mjs"),
        "--asar",
        asar,
        "--runtime",
        RUNTIME,
        "--wait-for",
        `${asar}.zusage.tmp`,
      ],
      { detached: true, stdio: "ignore", windowsHide: true, cwd: RUNTIME },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function spawnFinalizer(stage, asar) {
  try {
    const child = spawn(
      process.execPath,
      [
        path.join(RUNTIME, "hooks", "finalize.mjs"),
        "--stage",
        stage,
        "--asar",
        asar,
        "--runtime",
        RUNTIME,
      ],
      { detached: true, stdio: "ignore", windowsHide: true, cwd: RUNTIME },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const copyErrors = copyRuntime();
  const patchMod = await import(
    `${pathToFileURL(path.join(RUNTIME, "scripts", "asar-patch.mjs")).href}?v=${Date.now()}`
  );

  const asar = patchMod.findAppAsar(process.env.ZCODE_ASAR || process.env.ZCODE_APP_ASAR);
  if (!asar) {
    writeStatus("unknown", "未找到 ZCode 的 app.asar；左侧组件未注入。", { pluginRoot: PLUGIN_ROOT });
    return { suppressOutput: true };
  }

  const stage = `${asar}.balance-dashboard.tmp`;
  const metaPath = `${stage}.json`;
  let inspection;
  try {
    inspection = patchMod.inspectAsar(asar);
  } catch (error) {
    writeStatus("error", `无法读取 app.asar：${error.message}`, { asarPath: asar });
    return { suppressOutput: true };
  }

  if (inspection.hasBalanceLine) {
    removeStage(stage);
    writeStatus("injected", "左侧余额组件已注入；如刚更新 ZCode，请重启后生效。", {
      asarPath: asar,
      injected: true,
      pending: false,
      hasZusageLine: inspection.hasZusageLine,
    });
    return { suppressOutput: true };
  }

  // Do not race with the token-usage statusbar's own pending repack. Let it
  // finish, then patch the new asar with a detached follow-up process.
  if (fs.existsSync(`${asar}.zusage.tmp`)) {
    spawnPostPatch(asar);
    writeStatus(
      "waiting-zusage",
      "检测到 token 用量悬浮条正在更新 app.asar；已排定后续注入，等它完成后自动写入。",
      { asarPath: asar, injected: false, pending: true },
    );
    return { suppressOutput: true };
  }

  // A stage from an earlier session may still be waiting for ZCode to quit.
  if (fs.existsSync(stage) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const stat = fs.statSync(asar);
      if (meta?.source?.size === stat.size && meta?.source?.mtimeMs === stat.mtimeMs) {
        try {
          patchMod.validateAsar(stage, { expectBalance: true });
        } catch (error) {
          removeStage(stage);
          writeStatus("error", `旧补丁校验失败，已丢弃：${error.message}`, { asarPath: asar });
          return { suppressOutput: true };
        }
        try {
          const replaced = patchMod.replaceAsarWithBackup(stage, asar, {
            stageOptions: { expectBalance: true },
            postOptions: { expectBalance: true },
          });
          removeStage(stage);
          writeStatus("injected", "左侧余额组件已注入；重启 ZCode 后生效。", {
            asarPath: asar,
            injected: true,
            backup: replaced.backup,
          });
          return { suppressOutput: true };
        } catch {
          spawnFinalizer(stage, asar);
          writeStatus("pending-restart", "左侧余额组件已排定，完全退出 ZCode 后自动完成替换；重开后生效。", {
            asarPath: asar,
            injected: false,
            pending: true,
          });
          return { suppressOutput: true };
        }
      }
      removeStage(stage);
    } catch {
      removeStage(stage);
    }
  }

  let before;
  try {
    before = fs.statSync(asar);
  } catch (error) {
    writeStatus("error", `无法读取 app.asar 状态：${error.message}`, { asarPath: asar });
    return { suppressOutput: true };
  }

  let result;
  try {
    result = patchMod.buildPatchedAsar({
      asarPath: asar,
      loaderPath: path.join(RUNTIME, "sidebar", "inject-main.cjs"),
      stagePath: stage,
    });
  } catch (error) {
    const code = error?.code || "";
    const needsAdmin = ["EACCES", "EPERM", "EROFS"].includes(code);
    writeStatus(
      needsAdmin ? "needs-admin" : "error",
      needsAdmin
        ? "写入 app.asar 需要管理员权限。请以管理员身份运行 ZCode，或手动执行注入脚本。"
        : `生成左侧组件补丁失败：${error.message}`,
      { asarPath: asar, injected: false, pending: false },
    );
    return { suppressOutput: true };
  }

  if (result.status === "already") {
    writeStatus("injected", "左侧余额组件已经注入。", { asarPath: asar, injected: true });
    return { suppressOutput: true };
  }

  // If an official update rewrote the asar during the repack, discard the stage.
  try {
    const after = fs.statSync(asar);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      removeStage(stage);
      writeStatus("error", "重打包期间 app.asar 发生变化，已丢弃本次补丁；请重启 ZCode 重试。", {
        asarPath: asar,
        injected: false,
      });
      return { suppressOutput: true };
    }
  } catch {
    removeStage(stage);
    writeStatus("error", "重打包后无法确认 app.asar 状态，已丢弃本次补丁。", { asarPath: asar });
    return { suppressOutput: true };
  }

  try {
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        { source: { size: before.size, mtimeMs: before.mtimeMs }, createdAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  } catch (error) {
    removeStage(stage);
    writeStatus("error", `无法写入补丁元数据：${error.message}`, { asarPath: asar });
    return { suppressOutput: true };
  }

  try {
    patchMod.validateAsar(stage, { expectBalance: true });
  } catch (error) {
    removeStage(stage);
    writeStatus("error", `补丁校验失败，未替换 app.asar：${error.message}`, { asarPath: asar });
    return { suppressOutput: true };
  }

  try {
    const replaced = patchMod.replaceAsarWithBackup(stage, asar, {
      stageOptions: { expectBalance: true },
      postOptions: { expectBalance: true },
    });
    removeStage(stage);
    writeStatus("injected", "左侧余额组件已注入；请完全退出并重开 ZCode 生效。", {
      asarPath: asar,
      injected: true,
      pending: false,
      backup: replaced.backup,
    });
    return {
      suppressOutput: true,
      systemMessage: "余额面板的左侧组件已安装，请完全退出并重开 ZCode 生效。",
    };
  } catch {
    if (!spawnFinalizer(stage, asar)) {
      removeStage(stage);
      writeStatus("error", "app.asar 被占用，且无法启动收尾进程；请完全退出 ZCode 后重启。", {
        asarPath: asar,
      });
      return { suppressOutput: true };
    }
    writeStatus("pending-restart", "左侧余额组件已排定，完全退出 ZCode 后自动完成替换；重开后生效。", {
      asarPath: asar,
      injected: false,
      pending: true,
    });
    return {
      suppressOutput: true,
      systemMessage: "余额面板的左侧组件已排定，完全退出 ZCode 后会自动完成替换；重开后生效。",
    };
  }
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

try {
  const previous = readPreviousStatus();
  const result = await main();
  const current = readPreviousStatus();
  if (
    current &&
    (current.state === "pending-restart" || current.state === "needs-admin") &&
    (!previous || previous.state !== current.state) &&
    result.systemMessage === undefined
  ) {
    result.systemMessage = current.message;
  }
  output(result);
} catch (error) {
  writeStatus("error", `左侧组件自检失败：${error.message || error}`);
  output({ suppressOutput: true, systemMessage: `余额面板左侧组件自检失败：${error.message || error}` });
}
