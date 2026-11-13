#!/usr/bin/env node
/**
 * Remove only the balance-dashboard loader line from app.asar.
 * Other injection lines (including the token-usage statusbar) are preserved.
 *
 * Run with ZCode fully quit when possible. If app.asar is locked, the command
 * leaves a stage file and explains how to finish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME =
  (process.env.BALANCE_RUNTIME_DIR && process.env.BALANCE_RUNTIME_DIR.trim()) ||
  path.join(process.env.USERPROFILE || process.env.HOME || "", ".zcode", "balance-dashboard", "runtime");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { findAppAsar, inspectAsar, buildUnpatchedAsar, replaceAsarWithBackup } = await import(
    pathToFileURL(path.join(HERE, "asar-patch.mjs")).href
  );
  const asar = findAppAsar(arg("--asar") || process.env.ZCODE_ASAR || process.env.ZCODE_APP_ASAR);
  if (!asar) {
    console.error("未找到 app.asar；可用 --asar <path> 指定。");
    process.exitCode = 2;
    return;
  }
  const before = inspectAsar(asar);
  if (!before.hasBalanceLine) {
    console.log(JSON.stringify({ status: "already-clean", asar }, null, 2));
    return;
  }
  const result = buildUnpatchedAsar({ asarPath: asar });
  if (result.status === "already-clean") {
    console.log(JSON.stringify({ status: "already-clean", asar }, null, 2));
    return;
  }
  try {
    const replaced = replaceAsarWithBackup(result.stagePath, asar, {
      stageOptions: { expectBalance: false },
      postOptions: { expectBalance: false },
    });
    try {
      fs.unlinkSync(`${result.stagePath}.json`);
    } catch {
      // ignore
    }
    try {
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(
        path.join(RUNTIME, "status.json"),
        JSON.stringify(
          {
            state: "disabled",
            message: "左侧余额组件已移除；重启 ZCode 后生效。",
            updatedAt: new Date().toISOString(),
            asarPath: asar,
            injected: false,
            pending: false,
            backup: replaced.backup,
          },
          null,
          2,
        ),
      );
    } catch {
      // ignore
    }
    console.log(JSON.stringify({ status: "removed", asar, restartRequired: true }, null, 2));
  } catch (error) {
    console.error(
      `app.asar 当前被 ZCode 占用，未能替换（${error.message}）。\n` +
        `请完全退出 ZCode 后重新运行：\n  node "${path.join(HERE, "unpatch.mjs")}"\n` +
        `临时补丁文件保留在：${result.stagePath}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
