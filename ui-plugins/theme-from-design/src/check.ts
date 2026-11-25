// Shopify theme-check（@shopify/theme-check-node，离线文档数据随插件打包）。
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Issue } from "./theme.ts";

let prepared = false;
/** 打包后：文档数据和配置在 dist/data、dist/configs（theme-check 用 WEBPACK_MODE 找它们）；下载被替换成离线 stub。 */
export function prepareThemeCheck(assetRoot: string) {
  if (prepared) return;
  prepared = true;
  const bundled = import.meta.url.endsWith("/server.mjs");
  if (bundled && existsSync(join(assetRoot, "data")) && existsSync(join(assetRoot, "configs"))) process.env.WEBPACK_MODE ??= "1";
}

export async function runThemeCheck(root: string): Promise<{ issues: Issue[]; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const tc = await import("@shopify/theme-check-node");
    const run = await tc.themeCheckRun(root, undefined, () => undefined);
    const issues: Issue[] = run.offenses.map((o) => ({
      file: decodeURIComponent(o.uri.replace(/^file:\/\//, "")).replace(root.replace(/\/$/, "") + "/", ""),
      ...(o.start ? { line: o.start.line + 1 } : {}),
      severity: o.severity === 0 ? "error" : "warning",
      check: o.check,
      message: o.message,
      source: "theme-check",
    }));
    return { issues, ms: Date.now() - t0 };
  } catch (e) {
    return { issues: [], ms: Date.now() - t0, error: (e as Error).message };
  }
}
