import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initRenderer, loadFonts, renderSvg, type FontSet } from "./kit/render.ts";

/** resvg.wasm：打包后在 dist/ 旁边，开发/测试时从依赖里找。 */
export function wasmPath(assetRoot: string) {
  const p = join(assetRoot, "resvg.wasm");
  if (existsSync(p)) return p;
  return createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
}

export async function fontsFor(assetRoot: string, fontEnv?: string): Promise<FontSet> {
  await initRenderer(wasmPath(assetRoot));
  return loadFonts(fontEnv ? process.env[fontEnv] : undefined);
}

export async function svgToPng(assetRoot: string, svg: string, width?: number, fontEnv?: string) {
  const fonts = await fontsFor(assetRoot, fontEnv);
  return (await renderSvg(svg, fonts, width)).png;
}
