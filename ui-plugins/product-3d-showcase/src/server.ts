import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { ffmpeg } from "./kit/ffmpeg.ts";
import { readModel } from "./model.ts";
import { normalizeSettings, type Settings } from "./settings.ts";

export const NAME = "product-3d-showcase";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
/** Largest model_data part, in characters; keeps every stdio message well under ZCode's 10 MB limit. */
export const MODEL_CHUNK = 4 * 1024 * 1024;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
  });

  async function settingsFrom(raw: any) {
    const model = String(raw?.model ?? "");
    if (!model) throw new KitError("missing_model", "Pass `model`: a .glb or .gltf file.");
    const m = await readModel(ws, model);
    return { s: normalizeSettings(raw, model), m };
  }
  const settingsPath = (s: Settings) => `${s.output}/showcase.json`;
  const describe = (s: Settings, info: Record<string, unknown>) =>
    [
      `${s.title} (${s.model}): ${info.meshes} mesh(es), ${info.materials} material(s), ${info.textures} texture(s), ${info.megabytes} MB${(info.extensions as string[]).length ? `; extensions ${(info.extensions as string[]).join(", ")}` : ""}.`,
      `Angles: ${s.angles.map((a) => `${a.name} (yaw ${a.yaw}°, pitch ${a.pitch}°${a.zoom !== 1 ? `, zoom ${a.zoom}` : ""})`).join(", ")}.`,
      `Look: ${s.lighting} lighting, background ${s.background}${s.shadow ? ", ground shadow" : ""}, exposure ${s.exposure}; stills ${s.size}×${s.size}; ${s.video.enabled ? `360° video ${s.video.seconds}s at ${s.video.size}px` : "no video"}; ${s.viewer ? "web viewer" : "no viewer"} → ${s.output}/.`,
    ].join("\n");
  const settingsSchema = z
    .record(z.string(), z.unknown())
    .describe('{model, title, angles: ["front","three-quarter-left","three-quarter-right","side","back","top"] or [{name, yaw (deg, 0 = front), pitch (deg), zoom}], lighting "studio"|"soft"|"dramatic", background "#ffffff"|"transparent"|"#rrggbb", shadow, exposure, size (px), video {enabled, seconds, size, pitch}, viewer (bool), output}');

  tool(
    "showcase_open",
    {
      description:
        "Open Product 3D Showcase with a glTF/GLB product model. The panel renders it in a consistent studio (lighting preset, ground shadow, auto-framed camera) and exports multi-angle product images (PNG, white or transparent background), a 360° turntable video (WebM, plus MP4 when ffmpeg is installed) and a self-contained web viewer (three.js, works offline). Settings can be passed now or later with showcase_save.",
      input: { model: z.string(), settings: settingsSchema.optional() },
      openPanel: true,
      timeoutMs: 120_000,
    },
    async ({ model, settings }) => {
      let raw: any = { ...(settings ?? {}), model };
      if (!settings) {
        const prev = normalizeSettings({}, model);
        if (await ws.exists(settingsPath(prev))) raw = { ...JSON.parse(await ws.readText(settingsPath(prev))), model };
      }
      const { s, m } = await settingsFrom(raw);
      await ws.write(settingsPath(s), JSON.stringify(s, null, 1) + "\n");
      return { text: `${describe(s, m.info)}\nThe panel shows a live preview. Change settings with showcase_save; showcase_export renders and saves everything (in the panel, which must stay open).`, structured: { kind: "settings", settings: s, info: m.info } };
    },
  );

  tool(
    "showcase_save",
    { description: "Validate and save showcase settings (angles, lighting, background, shadow, exposure, sizes, video, viewer, output).", input: { settings: settingsSchema } },
    async ({ settings }) => {
      const { s, m } = await settingsFrom(settings);
      await ws.write(settingsPath(s), JSON.stringify(s, null, 1) + "\n");
      return { text: `${describe(s, m.info)}\nSaved ${settingsPath(s)}.`, structured: { kind: "settings", settings: s, info: m.info } };
    },
  );

  tool(
    "showcase_export",
    {
      description: "Render and save all outputs with the current settings: one PNG per angle, the 360° WebM and the web viewer. Rendering runs in the open panel (WebGL); files appear in the output folder within a few seconds to a minute, and the panel reports them.",
      input: { settings: settingsSchema },
    },
    async ({ settings }) => {
      const { s, m } = await settingsFrom(settings);
      await ws.write(settingsPath(s), JSON.stringify(s, null, 1) + "\n");
      const expected = [...s.angles.map((a) => `${s.output}/${a.name}.png`), ...(s.video.enabled ? [`${s.output}/turntable.webm`, `${s.output}/turntable.mp4 (if ffmpeg is installed)`] : []), ...(s.viewer ? [`${s.output}/viewer/index.html`] : [])];
      return { text: `Rendering in the panel → ${expected.join(", ")}.`, structured: { kind: "export", settings: s, info: m.info, expected } };
    },
  );

  tool(
    "model_data",
    {
      description: "Model bytes (GLB base64, or self-contained glTF JSON) for the panel, in parts of at most MODEL_CHUNK characters: call again with offset until offset + data.length reaches total.",
      input: { model: z.string(), offset: z.number().int().min(0).optional() },
      visibility: ["app"],
      readOnly: true,
      timeoutMs: 120_000,
    },
    async ({ model, offset }) => {
      // ZCode Desktop drops a stdio MCP server whose single message exceeds 10 MB, so large models go in parts.
      const m = await readModel(ws, model);
      const start = Math.min(offset ?? 0, m.data.length);
      const data = m.data.slice(start, start + MODEL_CHUNK);
      return { text: `${m.format} ${m.info.megabytes} MB (${start + data.length}/${m.data.length})`, structured: { format: m.format, data, offset: start, total: m.data.length, info: m.info } };
    },
  );

  tool(
    "save_output",
    { description: "Save a rendered PNG or WebM from the panel into the output folder.", input: { settings: settingsSchema, name: z.string(), data: z.string() }, visibility: ["app"] },
    async ({ settings, name, data }) => {
      const s = normalizeSettings(settings, String((settings as any)?.model ?? "model.glb"));
      if (!/^[\w.-]+\.(png|webm)$/i.test(name)) throw new KitError("bad_name", "Only .png / .webm files can be saved.");
      // 只为确实存在且有效的模型保存输出；空数据也给出可读错误（TEST-FINDINGS #8）
      if (!(await ws.exists(s.model))) throw new KitError("not_found", `Model ${s.model} not found; open it with showcase_open first.`);
      await readModel(ws, s.model);
      const buf = Buffer.from(data, "base64");
      if (buf.length < 8) throw new KitError("bad_data", `${name}: no image/video data received from the panel.`);
      const png = buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG";
      const webm = buf.readUInt32BE(0) === 0x1a45dfa3;
      if (!(name.endsWith(".png") ? png : webm)) throw new KitError("bad_data", `${name}: data is not a ${name.split(".").pop()} file.`);
      const path = await ws.write(posix.join(s.output, name), buf);
      if (!webm) return { text: path, structured: { path, bytes: buf.length } };
      // 电商平台多要 MP4：有 ffmpeg 就顺手转一份 H.264（yuv420p，+faststart）。
      const mp4 = path.replace(/\.webm$/i, ".mp4");
      try {
        await ffmpeg(["-i", ws.resolve(path), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", "-an", ws.resolve(mp4)], { timeoutMs: 300_000 });
        return { text: `${path}, ${mp4}`, structured: { path, mp4, bytes: buf.length } };
      } catch (error) {
        const note = error instanceof KitError && error.code === "ffmpeg_missing" ? "WebM saved; install ffmpeg to also get an MP4." : `WebM saved; MP4 conversion failed: ${error instanceof Error ? error.message.slice(-200) : error}`;
        return { text: `${path} (${note})`, structured: { path, bytes: buf.length, note } };
      }
    },
  );

  tool(
    "save_viewer",
    { description: "Write the offline web viewer (index.html + viewer.js + model.js).", input: { settings: settingsSchema }, visibility: ["app"], timeoutMs: 120_000 },
    async ({ settings }) => {
      const { s, m } = await settingsFrom(settings);
      const dir = `${s.output}/viewer`;
      const look = { lighting: s.lighting, background: s.background === "transparent" ? "#ffffff" : s.background, shadow: s.shadow, exposure: s.exposure };
      const files = [
        await ws.write(`${dir}/viewer.js`, await readFile(join(options.assetRoot, "viewer.js"))),
        await ws.write(`${dir}/model.js`, `window.SHOWCASE=${JSON.stringify({ title: s.title, look, autoRotate: true, model: { format: m.format, data: m.data } })};\n`),
        await ws.write(
          `${dir}/index.html`,
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)}</title><style>html,body{margin:0;height:100%;background:${look.background};font-family:-apple-system,"PingFang SC",sans-serif}#view{width:100%;height:100%;display:block;touch-action:none}#loading,h1{position:fixed;left:16px;color:#475569}h1{top:8px;font-size:16px;font-weight:600;margin:0}#loading{top:40px;font-size:13px}.hint{position:fixed;bottom:10px;left:0;right:0;text-align:center;color:#94a3b8;font-size:12px}</style></head><body><h1>${esc(s.title)}</h1><div id="loading">Loading 3D model…</div><canvas id="view"></canvas><div class="hint">Drag to rotate · scroll to zoom · 拖动旋转 · 滚轮缩放</div><script src="model.js"></script><script src="viewer.js"></script></body></html>\n`,
        ),
      ];
      return { text: files.join(", "), structured: { files } };
    },
  );

  tool(
    "workspace_files",
    { description: "glTF models for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => ({ text: "", structured: { models: (await ws.list({ exts: [".glb", ".gltf"], limit: 2000 })).map((f) => f.path) } }),
  );

  return server;
}
