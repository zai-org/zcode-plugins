import css from "./kit.css";
import panelCss from "./panel.css";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast, updateContext } from "./kit.ts";
import { ANGLE_PRESETS, loadModel, Studio, type Angle } from "./scene.ts";
import { muxWebm, type Frame } from "./webm.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Settings { version: 1; model: string; title: string; angles: Angle[]; lighting: "studio" | "soft" | "dramatic"; background: string; shadow: boolean; exposure: number; size: number; video: { enabled: boolean; seconds: number; size: number; pitch: number }; viewer: boolean; output: string }
type Info = Record<string, any>;
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { s?: Settings; info?: Info; models: string[]; thumbs: Map<string, string>; dirty: boolean; done?: string[]; progress?: string; loadedModel?: string } = { models: [], thumbs: new Map(), dirty: false };
const root = document.getElementById("root")!;

// 预览（可拖动）与离屏渲染（导出用）各一个 WebGL 画布。
const previewCanvas = h("canvas", {}) as HTMLCanvasElement;
const preview = new Studio(previewCanvas);
const controls = new OrbitControls(preview.camera, previewCanvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
const shotCanvas = h("canvas", { class: "offscreen" }) as HTMLCanvasElement;
document.body.append(shotCanvas);
const shot = new Studio(shotCanvas);
const hud = h("div", { class: "hud" });

const look = (s: Settings) => ({ lighting: s.lighting, background: s.background, shadow: s.shadow, exposure: s.exposure });
function currentAngle(): Angle {
  const d = preview.camera.position.clone().sub(controls.target);
  const dist = d.length();
  const fov = (preview.camera.fov * Math.PI) / 180;
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * preview.camera.aspect));
  const base = (preview.radius / Math.sin(fit / 2)) * 1.08;
  const r = (x: number) => Math.round(x);
  return { name: "custom", yaw: r((Math.atan2(d.x, d.z) * 180) / Math.PI), pitch: r((Math.asin(d.y / dist) * 180) / Math.PI), zoom: Math.round((base / dist) * 100) / 100 };
}
function viewAngle(a: Angle) {
  const w = previewCanvas.clientWidth || 640, hh = previewCanvas.clientHeight || 480;
  preview.renderer.setSize(w, hh, false);
  preview.frame(a, w / hh);
  controls.target.copy(preview.center);
  controls.update();
}
let lastSize = "";
function loop() {
  const w = previewCanvas.clientWidth, hh = previewCanvas.clientHeight;
  if (w && hh) {
    if (`${w}x${hh}` !== lastSize) { lastSize = `${w}x${hh}`; preview.renderer.setPixelRatio(Math.min(2, devicePixelRatio)); preview.renderer.setSize(w, hh, false); preview.camera.aspect = w / hh; preview.camera.updateProjectionMatrix(); }
    controls.update();
    preview.renderer.render(preview.scene, preview.camera);
    const a = currentAngle();
    hud.textContent = `yaw ${a.yaw}° · pitch ${a.pitch}° · zoom ${a.zoom}`;
  }
  requestAnimationFrame(loop);
}

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  state.progress = label;
  updateStatus();
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); state.progress = ""; updateStatus(); }
}
function updateStatus() { const st = document.getElementById("status"); if (st) st.textContent = state.progress ?? ""; }

async function ensureModel(s: Settings) {
  if (state.loadedModel === s.model) return;
  // model_data comes in parts (a large model in one message would exceed the host's limit).
  type Part = { format: "glb" | "gltf"; data: string; offset: number; total: number };
  let part = await call<Part>("model_data", { model: s.model, offset: 0 }, 300_000);
  const format = part.format;
  const parts = [part.data];
  let got = part.data.length;
  while (got < (part.total ?? got) && part.data.length > 0) {
    part = await call<Part>("model_data", { model: s.model, offset: got }, 300_000);
    parts.push(part.data);
    got += part.data.length;
  }
  const m = { format, data: parts.join("") };
  const [a, b] = await Promise.all([loadModel(m), loadModel(m)]);
  preview.setModel(a);
  shot.setModel(b);
  state.loadedModel = s.model;
  viewAngle(s.angles[0] ?? ANGLE_PRESETS[0]);
}
function applyLook() {
  if (!state.s) return;
  preview.setLook(look(state.s));
  shot.setLook(look(state.s));
}

function renderShot(a: Angle, size: number, background?: string): HTMLCanvasElement {
  if (background) shot.setLook({ ...look(state.s!), background });
  shot.frame(a, 1);
  const c = shot.render(size, size);
  if (background) shot.setLook(look(state.s!));
  return c;
}
const toB64 = (blob: Blob) => blob.arrayBuffer().then((b) => { const u = new Uint8Array(b); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); });
const canvasPng = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));

async function refreshThumbs() {
  const s = state.s;
  if (!s || state.loadedModel !== s.model) return;
  state.thumbs.clear();
  for (const a of s.angles) state.thumbs.set(a.name, renderShot(a, 240).toDataURL("image/png"));
  renderAngles();
}

const FPS = 30;
/** 逐帧渲染并用 WebCodecs 编码（与渲染速度无关，帧数精确）；没有 WebCodecs 时退回实时 MediaRecorder。 */
async function recordTurntable(s: Settings): Promise<Blob> {
  const size = s.video.size;
  const bg = s.background === "transparent" ? "#ffffff" : undefined; // WebM 不保留透明，透明背景时视频用白底
  if (bg) shot.setLook({ ...look(s), background: bg });
  shot.renderer.setPixelRatio(1);
  shot.renderer.setSize(size, size, false);
  const total = Math.round(s.video.seconds * FPS);
  const draw = (k: number) => { shot.frame({ name: "spin", yaw: (360 * k) / total, pitch: s.video.pitch, zoom: 1 }, 1); shot.renderer.render(shot.scene, shot.camera); };
  const progress = (k: number) => { state.progress = T(`渲染 360° 视频… ${Math.round((k / total) * 100)}%`, `Rendering 360° video… ${Math.round((k / total) * 100)}%`); updateStatus(); };
  try {
    if (typeof VideoEncoder !== "undefined") {
      for (const [codec, name] of [["vp09.00.40.08", "V_VP9"], ["vp8", "V_VP8"]] as const) {
        const config = { codec, width: size, height: size, bitrate: Math.round(size * size * FPS * 0.1), framerate: FPS };
        if (!(await VideoEncoder.isConfigSupported(config)).supported) continue;
        const frames: Frame[] = [];
        let failure: unknown;
        const encoder = new VideoEncoder({ output: (chunk) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); frames.push({ data, ms: chunk.timestamp / 1000, key: chunk.type === "key" }); }, error: (e) => (failure = e) });
        encoder.configure(config);
        for (let k = 0; k < total; k++) {
          draw(k);
          const frame = new VideoFrame(shotCanvas, { timestamp: Math.round((k * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
          encoder.encode(frame, { keyFrame: k % (FPS * 2) === 0 });
          frame.close();
          if (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 0));
          if (k % 5 === 0) { progress(k); await new Promise((r) => requestAnimationFrame(r)); }
          if (failure) throw failure;
        }
        await encoder.flush();
        encoder.close();
        if (failure) throw failure;
        return new Blob([muxWebm(frames, size, size, name, (total * 1000) / FPS) as BlobPart], { type: "video/webm" });
      }
    }
    // 退路：实时录制（慢机器上帧数可能偏少）
    const stream = shotCanvas.captureStream(FPS);
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(size * size * FPS * 0.1) });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250);
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => { const t = Math.min(1, (performance.now() - t0) / (s.video.seconds * 1000)); draw(t * total); progress(t * total); if (t < 1) requestAnimationFrame(step); else done(); };
      requestAnimationFrame(step);
    });
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    return new Blob(chunks, { type: "video/webm" });
  } finally {
    if (bg) shot.setLook(look(s));
  }
}

async function exportAll(s: Settings) {
  await ensureModel(s);
  applyLook();
  const files: string[] = [];
  for (const [i, a] of s.angles.entries()) {
    state.progress = T(`渲染 ${a.name}（${i + 1}/${s.angles.length}）…`, `Rendering ${a.name} (${i + 1}/${s.angles.length})…`);
    updateStatus();
    const r = await call<{ path: string }>("save_output", { settings: s, name: `${a.name}.png`, data: await toB64(await canvasPng(renderShot(a, s.size))) });
    files.push(r.path);
  }
  if (s.video.enabled) {
    const blob = await recordTurntable(s);
    state.progress = T("保存视频…", "Saving video…");
    updateStatus();
    const v = await call<{ path: string; mp4?: string; note?: string }>("save_output", { settings: s, name: "turntable.webm", data: await toB64(blob) }, 600_000);
    files.push(v.path, ...(v.mp4 ? [v.mp4] : []));
    if (v.note) toast(v.note);
  }
  if (s.viewer) {
    state.progress = T("写网页展示…", "Writing web viewer…");
    updateStatus();
    files.push(...(await call<{ files: string[] }>("save_viewer", { settings: s }, 300_000)).files.filter((f) => f.endsWith("index.html")));
  }
  state.done = files;
  render();
  toast(T(`已导出 ${files.length} 个文件`, `Exported ${files.length} files`));
  await updateContext(`Product 3D Showcase exported ${s.title}: ${files.join(", ")}`).catch(() => undefined);
}

function load(v: Record<string, unknown>) {
  state.s = v.settings as Settings;
  state.info = v.info as Info;
  state.dirty = false;
  state.done = undefined;
  render();
  return busy(async () => { await ensureModel(state.s!); applyLook(); await refreshThumbs(); }, T("加载模型…", "Loading model…"));
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "settings") void load(v);
  if (v.kind === "export") void load(v).then(() => busy(() => exportAll(state.s!), T("导出中…", "Exporting…")));
});

function changed(thumbs = true) {
  state.dirty = true;
  const b = document.getElementById("save") as HTMLButtonElement | null;
  if (b) b.disabled = false;
  applyLook();
  if (thumbs) void refreshThumbs();
}

function renderAngles() {
  const box = document.getElementById("angles");
  const s = state.s;
  if (!box || !s) return;
  put(box, ...s.angles.map((a, i) => h("div", { class: "ang" },
    h("img", { src: state.thumbs.get(a.name) ?? "", alt: a.name, title: T("点击在预览里查看", "Click to view in the preview"), onclick: () => viewAngle(a) }),
    h("div", { class: "row" },
      h("input", { type: "text", value: a.name, onchange: (e: Event) => { a.name = (e.target as HTMLInputElement).value.trim().replace(/\s+/g, "-") || a.name; changed(); } }),
      h("button", { title: T("删除", "Remove"), onclick: () => { s.angles.splice(i, 1); changed(); } }, "✕")),
    h("div", { class: "muted" }, `${a.yaw}° / ${a.pitch}°${a.zoom !== 1 ? ` ×${a.zoom}` : ""}`))));
}

function render() {
  applyTheme();
  const s = state.s;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("产品 3D 展示", "Product 3D Showcase")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void busy(async () => load(await call("showcase_open", { model: v }))); } },
      h("option", { value: "" }, s ? `📦 ${s.model}` : T("选择 glTF / GLB 模型…", "Choose a glTF / GLB model…")),
      ...state.models.map((f) => h("option", { value: f }, f))),
    h("span", { id: "status", class: "muted" }, state.progress ?? ""),
    h("span", { class: "spacer" }),
    s ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void busy(async () => { await load(await call("showcase_save", { settings: s })); toast(T("已保存", "Saved")); }) }, T("保存", "Save")) : null,
    s ? h("button", { class: "primary", onclick: () => void busy(async () => { await call("showcase_save", { settings: s }); state.dirty = false; await exportAll(s); }, T("导出中…", "Exporting…")) }, T("导出全部", "Export all")) : null);
  if (!s) {
    put(root, toolbar, h("div", { class: "empty" }, T("选择一个 .glb / .gltf 产品模型，或对 Agent 说：“用 bottle.glb 做一套白底产品图：正面、左右 45°、侧面、背面，再出一段 6 秒的 360° 旋转视频和网页 3D 展示”。", "Choose a .glb / .gltf product model, or ask the agent: make white-background product shots of bottle.glb — front, 45° left and right, side, back — plus a 6-second 360° video and a web 3D viewer.")));
    return;
  }
  const num = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, thumbs = true) =>
    h("label", {}, h("span", {}, label), h("input", { type: "number", value, min, max, step, onchange: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); changed(thumbs); } }));
  const bgSel = s.background === "transparent" ? "transparent" : s.background === "#ffffff" ? "#ffffff" : "custom";
  const settings = h("div", { class: "settings" },
    h("label", {}, h("span", {}, T("标题", "Title")), h("input", { type: "text", value: s.title, onchange: (e: Event) => { s.title = (e.target as HTMLInputElement).value; changed(false); } })),
    h("label", {}, h("span", {}, T("灯光", "Lighting")), h("select", { onchange: (e: Event) => { s.lighting = (e.target as HTMLSelectElement).value as Settings["lighting"]; changed(); } }, ...[["studio", T("影棚", "Studio")], ["soft", T("柔光", "Soft")], ["dramatic", T("戏剧", "Dramatic")]].map(([v, l]) => h("option", { value: v, selected: s.lighting === v }, l)))),
    h("label", {}, h("span", {}, T("背景", "Background")),
      h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; s.background = v === "custom" ? "#f1f5f9" : v; changed(); render(); } }, ...[["#ffffff", T("白色", "White")], ["transparent", T("透明", "Transparent")], ["custom", T("自定义", "Custom")]].map(([v, l]) => h("option", { value: v, selected: bgSel === v }, l))),
      bgSel === "custom" ? h("input", { type: "color", value: s.background, onchange: (e: Event) => { s.background = (e.target as HTMLInputElement).value; changed(); } }) : null),
    h("label", {}, h("span", {}, T("地面阴影", "Shadow")), h("input", { type: "checkbox", checked: s.shadow, onchange: (e: Event) => { s.shadow = (e.target as HTMLInputElement).checked; changed(); } })),
    h("label", {}, h("span", {}, T("曝光", "Exposure")), h("input", { type: "range", min: 0.3, max: 2.5, step: 0.05, value: s.exposure, onchange: (e: Event) => { s.exposure = Number((e.target as HTMLInputElement).value); changed(); } })),
    num(T("图片尺寸", "Image px"), s.size, 256, 4096, 100, (v) => (s.size = v), false),
    h("label", {}, h("span", {}, T("360° 视频", "360° video")), h("input", { type: "checkbox", checked: s.video.enabled, onchange: (e: Event) => { s.video.enabled = (e.target as HTMLInputElement).checked; changed(false); render(); } })),
    s.video.enabled ? num(T("视频秒数", "Seconds"), s.video.seconds, 2, 30, 1, (v) => (s.video.seconds = v), false) : null,
    s.video.enabled ? num(T("视频尺寸", "Video px"), s.video.size, 360, 2160, 2, (v) => (s.video.size = v), false) : null,
    h("label", {}, h("span", {}, T("网页展示", "Web viewer")), h("input", { type: "checkbox", checked: s.viewer, onchange: (e: Event) => { s.viewer = (e.target as HTMLInputElement).checked; changed(false); } })),
    h("label", {}, h("span", {}, T("输出", "Output")), h("input", { type: "text", value: s.output, onchange: (e: Event) => { s.output = (e.target as HTMLInputElement).value; changed(false); } })),
    h("div", { class: "info muted" }, `${state.info?.meshes ?? "?"} mesh · ${state.info?.materials ?? "?"} mat · ${state.info?.textures ?? "?"} tex · ${state.info?.megabytes ?? "?"} MB`),
    h("div", { class: "small muted" }, T("拖动预览选角度，点“＋ 加入这个角度”。透明背景只用于图片，视频用白底。", "Drag the preview to pick a view and press “+ Add this view”. Transparent background applies to images; the video uses white.")));
  const presetSel = h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; const p = ANGLE_PRESETS.find((a) => a.name === v); if (p && !s.angles.some((a) => a.name === p.name)) { s.angles.push({ ...p }); changed(); render(); } } },
    h("option", { value: "" }, T("+ 预设角度…", "+ Preset angle…")), ...ANGLE_PRESETS.map((a) => h("option", { value: a.name }, a.name)));
  const addView = h("button", { class: "add primary", onclick: () => { const a = currentAngle(); let n = 1; while (s.angles.some((x) => x.name === `view-${n}`)) n++; s.angles.push({ ...a, name: `view-${n}` }); changed(); render(); } }, T("＋ 加入这个角度", "+ Add this view"));
  put(root, toolbar,
    state.done ? h("div", { class: "card done" }, h("b", {}, T(`已导出到 ${s.output}/`, `Exported to ${s.output}/`)), ...state.done.map((f) => h("div", { class: "small" }, f))) : null,
    h("div", { class: "layout" },
      h("div", {}, h("div", { class: "stage" }, previewCanvas, hud, addView), h("div", { class: "toolbar", style: "border:0;margin:6px 0 0" }, h("b", {}, T(`角度（${s.angles.length}）`, `Angles (${s.angles.length})`)), presetSel), h("div", { id: "angles", class: "angles" })),
      settings));
  lastSize = "";
  renderAngles();
}

onHostContext(() => render());
render();
requestAnimationFrame(loop);
void initHost("product-3d-showcase", "0.1.0").then(async () => {
  state.models = (await call<{ models: string[] }>("workspace_files").catch(() => ({ models: [] }))).models;
  render();
});
