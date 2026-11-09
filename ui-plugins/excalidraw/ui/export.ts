import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { call } from "#ui/bridge.ts";
import type { Diagram } from "#excalidraw/contract.ts";

export async function exportDiagram(
  api: ExcalidrawImperativeAPI,
  doc: Diagram,
  format: string,
  path: string,
  overwrite: boolean,
): Promise<string> {
  const args = { id: doc.id, expectedRevision: doc.revision, path, overwrite };
  if (format === "excalidraw") return (await call("export_diagram", args)).path;
  // 字体加载期间画板仍可能更新；图片导出固定点击时的内容，与传给后端的文档版本一致。
  const options = {
    elements: structuredClone(api.getSceneElements()),
    appState: { ...api.getAppState(), exportWithDarkMode: false },
    files: structuredClone(api.getFiles()),
  };
  await document.fonts.ready;
  let data: string;
  if (format === "png") {
    const blob = await exportToBlob({ ...options, mimeType: "image/png" });
    data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } else {
    // 沙箱不允许字体子集 WASM/eval；嵌入已实际加载的本地字体，保留矢量和中文显示。
    const svg = await exportToSvg({ ...options, skipInliningFonts: true });
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    for (const [font, source] of window.__excalidrawFontSources) {
      if (font.status !== "loaded" || !source.includes("data:")) continue;
      style.textContent += `@font-face{font-family:${font.family};src:${source};font-weight:${font.weight};font-style:${font.style};unicode-range:${font.unicodeRange};}`;
    }
    svg.prepend(style);
    data = svg.outerHTML;
  }
  return (await call("save_image", { ...args, format, data })).path;
}
