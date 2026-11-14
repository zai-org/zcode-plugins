#!/usr/bin/env node
/**
 * Detached follow-up patch after another asar injector finishes.
 *
 * If the token-usage statusbar has a pending app.asar repack, the hook lets it
 * finish first. This process waits for `app.asar.zusage.tmp` to disappear, then
 * appends the zcode-context line to the new asar so the user only needs one
 * restart instead of two.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const asar = arg("--asar");
const runtime = arg("--runtime");
const waitFor = arg("--wait-for") || (asar ? `${asar}.zusage.tmp` : "");
const statusPath = runtime ? path.join(runtime, "status.json") : "";
const lockPath = asar ? `${asar}.zcode-context.postpatch.lock` : "";

if (lockPath) {
  process.on("exit", () => {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  });
}

function log(...args) {
  if (!runtime) return;
  try {
    fs.appendFileSync(
      path.join(runtime, "inject.log"),
      `[${new Date().toISOString()}] [post-patch] ${args.join(" ")}\n`,
    );
  } catch {
    // ignore
  }
}

function writeStatus(state, message, extra = {}) {
  if (!statusPath) return;
  try {
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
    // ignore
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!asar || !runtime) throw new Error("--asar and --runtime are required");
  const patchMod = await import(
    `${pathToFileURL(path.join(runtime, "scripts", "asar-patch.mjs")).href}?v=${Date.now()}`
  );
  const stage = `${asar}.zcode-context.tmp`;
  const metaPath = `${stage}.json`;
  const deadline = Date.now() + 2 * 60 * 60 * 1000;

  while (Date.now() < deadline) {
    let inspection;
    try {
      inspection = patchMod.inspectAsar(asar);
    } catch (error) {
      log("cannot read app.asar:", error.message);
      await sleep(5000);
      continue;
    }
    if (inspection.hasBalanceLine) {
      writeStatus("injected", "上下文洞察入口已注入；重启 ZCode 后生效。", {
        asarPath: asar,
        injected: true,
        pending: false,
      });
      return;
    }
    if (waitFor && fs.existsSync(waitFor)) {
      await sleep(3000);
      continue;
    }

    let before;
    try {
      before = fs.statSync(asar);
    } catch {
      await sleep(5000);
      continue;
    }
    try {
      const result = patchMod.buildPatchedAsar({
        asarPath: asar,
        loaderPath: path.join(runtime, "sidebar", "inject-main.cjs"),
        stagePath: stage,
      });
      if (result.status === "already") {
        writeStatus("injected", "上下文洞察入口已注入。", { asarPath: asar, injected: true });
        return;
      }
      const after = fs.statSync(asar);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        try {
          fs.unlinkSync(stage);
          fs.unlinkSync(metaPath);
        } catch {
          // ignore
        }
        await sleep(5000);
        continue;
      }
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          { source: { size: before.size, mtimeMs: before.mtimeMs }, createdAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      try {
        patchMod.validateAsar(stage, { expectBalance: true });
      } catch (error) {
        try {
          fs.unlinkSync(stage);
          fs.unlinkSync(metaPath);
        } catch {
          // ignore
        }
        log("stage validation failed; discarding:", error.message);
        writeStatus("error", `补丁校验失败，未替换 app.asar：${error.message}`, { asarPath: asar });
        return;
      }
      try {
        const replaced = patchMod.replaceAsarWithBackup(stage, asar, {
          stageOptions: { expectBalance: true },
          postOptions: { expectBalance: true },
        });
        try {
          fs.unlinkSync(metaPath);
        } catch {
          // ignore
        }
        log("follow-up patch completed; backup:", replaced.backup);
        writeStatus("injected", "上下文洞察入口已注入；重启 ZCode 后生效。", {
          asarPath: asar,
          injected: true,
          pending: false,
          backup: replaced.backup,
        });
        return;
      } catch {
        // ZCode is running again; retry until it quits or the next session repairs it.
        await sleep(5000);
      }
    } catch (error) {
      const code = error?.code || "";
      if (["EACCES", "EPERM", "EROFS"].includes(code)) {
        writeStatus("needs-admin", "写入 app.asar 需要管理员权限。", { asarPath: asar });
        return;
      }
      log("patch attempt failed:", error.message);
      await sleep(5000);
    }
  }
  writeStatus("waiting-zusage", "等待其他插件完成 app.asar 更新超时；请重启 ZCode 后重试。", {
    asarPath: asar,
    pending: true,
  });
}

main().catch((error) => {
  log("fatal:", error.stack || error.message);
  writeStatus("error", `后续注入失败：${error.message || error}`);
  process.exitCode = 1;
});
