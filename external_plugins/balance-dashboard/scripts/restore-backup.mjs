#!/usr/bin/env node
/**
 * Restore app.asar from the pre-patch backup created by replaceAsarWithBackup.
 * Use this if ZCode cannot start after an injection attempt.
 *
 * Quit ZCode completely before running.
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
  const patchMod = await import(pathToFileURL(path.join(HERE, "asar-patch.mjs")).href);
  const asar = patchMod.findAppAsar(arg("--asar") || process.env.ZCODE_ASAR || process.env.ZCODE_APP_ASAR);
  if (!asar) {
    console.error("未找到 app.asar；可用 --asar <path> 指定。");
    process.exitCode = 2;
    return;
  }
  const backup = patchMod.backupPathOf(asar);
  if (!fs.existsSync(backup)) {
    console.error(`备份不存在：${backup}`);
    process.exitCode = 2;
    return;
  }
  let check;
  try {
    check = patchMod.validateAsar(backup);
  } catch (error) {
    console.error(`备份本身校验失败，未恢复：${error.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    fs.copyFileSync(backup, asar);
    const post = patchMod.validateAsar(asar);
    try {
      fs.mkdirSync(RUNTIME, { recursive: true });
      fs.writeFileSync(
        path.join(RUNTIME, "status.json"),
        JSON.stringify(
          {
            state: "restored",
            message: "已从备份恢复 app.asar；重启 ZCode 后生效。",
            updatedAt: new Date().toISOString(),
            asarPath: asar,
            backup,
            injected: false,
            pending: false,
          },
          null,
          2,
        ),
      );
    } catch {
      // diagnostic only
    }
    console.log(JSON.stringify({ status: "restored", asar, backup, check, post }, null, 2));
  } catch (error) {
    console.error(
      `恢复失败：${error.message}\n请完全退出 ZCode 后重试：\n  node "${path.join(HERE, "restore-backup.mjs")}"`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
