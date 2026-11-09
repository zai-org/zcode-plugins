import { getClient } from "./client.ts";

(async () => {
  const fonts = new Map<FontFace, string>();
  window.__excalidrawFontSources = fonts;
  const NativeFontFace = window.FontFace;
  window.FontFace = class extends NativeFontFace {
    constructor(family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
      super(family, source, descriptors);
      if (typeof source === "string") fonts.set(this, source);
    }
  };
  async function resource(name: string) {
    const r = await getClient().readResource("ui://excalidraw/assets/" + name);
    if (!r.contents[0] || !("text" in r.contents[0]) || !r.contents[0].text)
      throw Error("Empty asset " + name);
    return r.contents[0].text;
  }
  const manifest = JSON.parse(await resource("assets.json"));
  const [css, ...parts] = await Promise.all([
    resource("panel.css"),
    ...manifest.scripts.map(resource),
  ]);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.getElementById("root")!.removeAttribute("style");
  const script = document.createElement("script");
  script.textContent = parts.join("");
  document.body.append(script);
})().catch((e) => {
  document.getElementById("root")!.textContent = "画板加载失败 / Failed to load: " + e.message;
});
