import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, put, initHost, locale, onHostContext, onToolResult, sendMessage, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Zoom { at: number; duration: number; x: number; y: number; w: number; h: number }
interface Timed { at: number; duration: number; text: string; position?: "top" | "bottom" }
interface Segment { id: string; label: string; source: string; start: number; end: number; zooms: Zoom[]; callouts: Timed[]; subtitles: Timed[]; mute: boolean }
interface Project { version: 1; width: number; height: number; fps: number; background: string; accent: string; intro?: { title: string; subtitle: string; seconds: number }; segments: Segment[]; output: string }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { project?: Project; path: string; sel: number; t: number; frame?: string; dirty: boolean; files?: { videos: string[]; projects: string[] }; rendered?: { output: string; fresh: string[]; reused: string[]; duration: number; frames: string[] }; warnings: string[] } = { path: "demo/demo.demovideo.json", sel: 0, t: 0, dirty: false, warnings: [] };
const root = document.getElementById("root")!;
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const seg = () => state.project?.segments[state.sel];

async function busy<R>(work: () => Promise<R>, label?: string): Promise<R | undefined> {
  root.classList.add("busy");
  const status = document.getElementById("status");
  if (status && label) status.textContent = label;
  try {
    return await work();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  } finally {
    root.classList.remove("busy");
    if (status) status.textContent = "";
  }
}

async function loadFiles() {
  state.files = await call<{ videos: string[]; projects: string[] }>("workspace_files").catch(() => ({ videos: [], projects: [] }));
  render();
}

function load(value: Record<string, unknown>) {
  state.project = value.project as Project;
  if (typeof value.path === "string") state.path = value.path;
  state.warnings = (value.warnings as string[]) ?? [];
  state.sel = Math.min(state.sel, state.project.segments.length - 1);
  state.dirty = false;
  const s = seg();
  state.t = s ? s.start : 0;
  render();
  void loadFrame();
}

onToolResult((value) => {
  if (!value) return;
  if (value.kind === "project") load(value);
  if (value.kind === "rendered") {
    load(value);
    void showRendered(value);
  }
});

let frameToken = 0;
async function loadFrame() {
  const s = seg();
  const p = state.project;
  if (!s || !p) return;
  const token = ++frameToken;
  const r = await call<{ data: string }>("frame", { source: s.source, t: state.t, width: p.width, height: p.height, background: p.background }).catch(() => undefined);
  if (token !== frameToken || !r) return;
  state.frame = `data:image/jpeg;base64,${r.data}`;
  renderStage();
}

async function showRendered(value: Record<string, unknown>) {
  const duration = Number(value.duration);
  const output = String(value.output);
  const times = Array.from({ length: 6 }, (_, i) => (duration * (i + 0.5)) / 6);
  const frames: string[] = [];
  for (const t of times) {
    const r = await call<{ data: string }>("frame", { source: output, t, width: state.project!.width, height: state.project!.height }).catch(() => undefined);
    if (r) frames.push(`data:image/jpeg;base64,${r.data}`);
  }
  state.rendered = { output, fresh: value.fresh as string[], reused: value.reused as string[], duration, frames };
  render();
}

const changed = () => {
  state.dirty = true;
  const b = document.getElementById("save") as HTMLButtonElement | null;
  if (b) b.disabled = false;
};

async function save() {
  if (!state.project) return;
  const r = await busy(() => call<Record<string, unknown>>("demo_save", { path: state.path, project: state.project }), T("保存中…", "Saving…"));
  if (r) {
    load(r);
    toast(T("已保存", "Saved"));
  }
}

async function renderVideo() {
  if (!state.project) return;
  const r = await busy(() => call<Record<string, unknown>>("demo_render", { path: state.path, project: state.project }, 3_600_000), T("渲染中…（只重渲染改动过的段）", "Rendering… (only changed segments)"));
  if (r) {
    load(r);
    await showRendered(r);
    toast(T(`已生成 ${r.output}`, `Rendered ${r.output}`));
  }
}

function num(value: number, onChange: (v: number) => void, step = 0.1) {
  return h("input", { type: "number", step, value: Number(value.toFixed(2)), onchange: (e: Event) => { onChange(Number((e.target as HTMLInputElement).value)); changed(); renderStage(); } });
}

/** 画面：当前帧 + 放大框（当前时间生效的高亮），拖动画新的放大框。 */
let dragging = false;
function renderStage() {
  if (dragging) return;
  const box = document.getElementById("stage");
  const s = seg();
  if (!box || !s) return;
  const rel = state.t - s.start;
  const stage = h("div", { class: "stage" }, state.frame ? h("img", { src: state.frame, draggable: false }) : h("div", { style: { height: "300px" } }));
  s.zooms.forEach((z, i) => {
    const on = rel >= z.at && rel <= z.at + z.duration;
    stage.append(h("div", { class: `zr ${on ? "on" : ""}`, style: { left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` } }, h("span", {}, `Z${i + 1} ${z.at}s`)));
  });
  for (const c of s.callouts) if (rel >= c.at && rel <= c.at + c.duration) stage.append(h("div", { class: "ov", style: c.position === "top" ? { top: "6%" } : { bottom: "18%" } }, c.text));
  for (const c of s.subtitles) if (rel >= c.at && rel <= c.at + c.duration) stage.append(h("div", { class: "ov", style: { bottom: "5%", background: "#000a" } }, c.text));
  let startPt: [number, number] | undefined;
  let ghost: HTMLElement | undefined;
  const pos = (e: MouseEvent) => {
    const r = stage.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] as [number, number];
  };
  stage.addEventListener("mousedown", (e) => {
    startPt = pos(e);
    dragging = true;
    window.addEventListener("mouseup", onUp, { once: true });
    ghost = h("div", { class: "zr on" });
    stage.append(ghost);
  });
  const onMove = (e: MouseEvent) => {
    if (!startPt || !ghost) return;
    const [x, y] = pos(e);
    Object.assign(ghost.style, { left: `${Math.min(x, startPt[0]) * 100}%`, top: `${Math.min(y, startPt[1]) * 100}%`, width: `${Math.abs(x - startPt[0]) * 100}%`, height: `${Math.abs(y - startPt[1]) * 100}%` });
  };
  stage.addEventListener("mousemove", onMove);
  const onUp = (e: MouseEvent) => {
    if (!startPt) return;
    dragging = false;
    const [x, y] = pos(e);
    const w = Math.abs(x - startPt[0]);
    const hgt = Math.abs(y - startPt[1]);
    const begin = startPt;
    startPt = undefined;
    if (w < 0.04 || hgt < 0.04) return renderStage();
    const side = Math.max(w, hgt, 0.1);
    const cx = Math.min(x, begin[0]) + w / 2;
    const cy = Math.min(y, begin[1]) + hgt / 2;
    const len = s.end - s.start;
    s.zooms.push({ at: Number(Math.min(rel, Math.max(0, len - 0.5)).toFixed(2)), duration: Number(Math.min(2.5, len - rel).toFixed(2)) || 1, x: Math.max(0, Math.min(1 - side, cx - side / 2)), y: Math.max(0, Math.min(1 - side, cy - side / 2)), w: side, h: side });
    s.zooms.sort((a, b) => a.at - b.at);
    changed();
    renderEditor();
  };
  box.replaceChildren(stage);
}

function renderEditor() {
  const box = document.getElementById("editor");
  const s = seg();
  if (!box || !s) return;
  const rel = () => Number((state.t - s.start).toFixed(2));
  const slider = h("input", {
    type: "range",
    min: s.start,
    max: s.end,
    step: 0.05,
    value: state.t,
    oninput: (e: Event) => {
      state.t = Number((e.target as HTMLInputElement).value);
      const label = document.getElementById("tlabel");
      if (label) label.textContent = `${fmt(state.t)} · ${T("段内", "in segment")} ${rel()}s`;
      renderStage();
      clearTimeout((slider as any)._t);
      (slider as any)._t = setTimeout(() => void loadFrame(), 120);
    },
  });
  const row = (cells: (Node | string)[]) => h("tr", {}, ...cells.map((c) => h("td", {}, c)));
  const del = <X,>(list: X[], i: number) => h("button", { onclick: () => { list.splice(i, 1); changed(); renderEditor(); } }, "✕");
  box.replaceChildren(
    h("div", { class: "row" }, h("label", {}, T("名称", "Label"), h("input", { type: "text", value: s.label, onchange: (e: Event) => { s.label = (e.target as HTMLInputElement).value; changed(); renderList(); } })), h("span", { class: "muted small" }, `${s.source}`), h("label", {}, h("input", { type: "checkbox", checked: s.mute, onchange: (e: Event) => { s.mute = (e.target as HTMLInputElement).checked; changed(); } }), T("静音", "Mute"))),
    h("div", { id: "stage" }),
    slider,
    h("div", { class: "row small" }, h("span", { id: "tlabel" }, `${fmt(state.t)} · ${T("段内", "in segment")} ${rel()}s`), h("span", { class: "spacer" }),
      h("button", { onclick: () => { s.start = Number(state.t.toFixed(2)); changed(); renderEditor(); renderList(); } }, T("设为入点", "Set in")),
      h("button", { onclick: () => { s.end = Number(state.t.toFixed(2)); changed(); renderEditor(); renderList(); } }, T("设为出点", "Set out")),
      h("span", { class: "muted" }, `${fmt(s.start)} – ${fmt(s.end)}`)),
    h("div", { class: "muted small" }, T("在画面上拖一个框 = 在当前时间加一个放大。", "Drag a box on the frame to add a zoom at the current time.")),
    h("div", { class: "items" },
      h("h2", {}, T("放大", "Zooms")),
      h("table", {}, ...s.zooms.map((z, i) => row([`Z${i + 1}`, T("开始", "at"), num(z.at, (v) => (z.at = v)), T("时长", "for"), num(z.duration, (v) => (z.duration = v)), `${Math.round(1 / z.w * 10) / 10}×`, del(s.zooms, i)]))),
      h("h2", {}, T("说明文字", "Callouts"), " ", h("button", { onclick: () => { s.callouts.push({ at: rel(), duration: 3, text: T("说明", "Note"), position: "bottom" }); changed(); renderEditor(); } }, "+")),
      h("table", {}, ...s.callouts.map((c, i) => row([num(c.at, (v) => (c.at = v)), num(c.duration, (v) => (c.duration = v)), h("input", { type: "text", value: c.text, onchange: (e: Event) => { c.text = (e.target as HTMLInputElement).value; changed(); renderStage(); } }), h("select", { onchange: (e: Event) => { c.position = (e.target as HTMLSelectElement).value as "top"; changed(); renderStage(); } }, h("option", { value: "bottom", selected: c.position !== "top" }, T("下", "bottom")), h("option", { value: "top", selected: c.position === "top" }, T("上", "top"))), del(s.callouts, i)]))),
      h("h2", {}, T("字幕", "Subtitles"), " ", h("button", { onclick: () => { s.subtitles.push({ at: rel(), duration: 2.5, text: "" }); changed(); renderEditor(); } }, "+")),
      h("table", {}, ...s.subtitles.map((c, i) => row([num(c.at, (v) => (c.at = v)), num(c.duration, (v) => (c.duration = v)), h("input", { type: "text", value: c.text, onchange: (e: Event) => { c.text = (e.target as HTMLInputElement).value; changed(); renderStage(); } }), del(s.subtitles, i)]))),
    ),
  );
  renderStage();
}

function renderList() {
  const box = document.getElementById("list");
  const p = state.project;
  if (!box || !p) return;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= p.segments.length) return;
    [p.segments[i], p.segments[j]] = [p.segments[j], p.segments[i]];
    state.sel = j;
    changed();
    render();
  };
  put(box,
    ...p.segments.map((s, i) =>
      h("div", { class: `seg ${i === state.sel ? "on" : ""}`, onclick: () => { if (state.sel !== i) { state.sel = i; state.t = s.start; render(); void loadFrame(); } } },
        h("div", { class: "t" }, `${i + 1}. ${s.label}`),
        h("div", { class: "m" }, `${fmt(s.start)}–${fmt(s.end)} · ${s.zooms.length}Z · ${s.callouts.length}${T("说明", "C")} · ${s.subtitles.length}${T("字幕", "S")}`),
        h("div", { class: "btns" },
          h("button", { onclick: (e: Event) => { e.stopPropagation(); move(i, -1); } }, "↑"),
          h("button", { onclick: (e: Event) => { e.stopPropagation(); move(i, 1); } }, "↓"),
          h("button", { title: T("换录屏", "Replace recording"), onclick: (e: Event) => { e.stopPropagation(); void sendMessage(T(`请用新的录屏替换演示视频第 ${i + 1} 段「${s.label}」（id ${s.id}，工程 ${state.path}）：用 demo_replace_segment，然后 demo_render。新录屏是：`, `Replace segment ${i + 1} "${s.label}" (id ${s.id}, project ${state.path}) with a new recording using demo_replace_segment, then demo_render. The new recording is: `)); } }, T("换录屏", "Replace")),
          p.segments.length > 1 ? h("button", { onclick: (e: Event) => { e.stopPropagation(); p.segments.splice(i, 1); state.sel = 0; changed(); render(); } }, "✕") : null,
        ),
      ),
    ),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!v) return; p.segments.push({ id: `s${Date.now() % 100000}`, label: v.split("/").pop()!.replace(/\.\w+$/, ""), source: v, start: 0, end: 36000, zooms: [], callouts: [], subtitles: [], mute: false }); state.sel = p.segments.length - 1; changed(); void save(); } },
      h("option", { value: "" }, T("+ 添加录屏为新段…", "+ Add a recording…")), ...(state.files?.videos ?? []).map((v) => h("option", { value: v }, v))),
    h("h2", {}, T("片头", "Intro")),
    h("label", {}, h("input", { type: "checkbox", checked: !!p.intro, onchange: (e: Event) => { p.intro = (e.target as HTMLInputElement).checked ? { title: T("产品演示", "Product demo"), subtitle: "", seconds: 3 } : undefined; changed(); render(); } }), T("加片头", "Add intro")),
    p.intro ? h("div", { class: "controls" },
      h("input", { type: "text", value: p.intro.title, placeholder: T("标题", "Title"), onchange: (e: Event) => { p.intro!.title = (e.target as HTMLInputElement).value; changed(); } }),
      h("input", { type: "text", value: p.intro.subtitle, placeholder: T("副标题", "Subtitle"), onchange: (e: Event) => { p.intro!.subtitle = (e.target as HTMLInputElement).value; changed(); } }),
    ) : null,
    h("h2", {}, T("画面", "Output")),
    h("div", { class: "row small" },
      h("select", { onchange: (e: Event) => { const [w, hh] = (e.target as HTMLSelectElement).value.split("x").map(Number); p.width = w; p.height = hh; changed(); void loadFrame(); } }, ...["1920x1080", "1280x720", "1080x1920", "1080x1080"].map((v) => h("option", { value: v, selected: `${p.width}x${p.height}` === v }, v))),
      h("input", { type: "color", value: p.accent, title: T("强调色", "Accent"), oninput: (e: Event) => { p.accent = (e.target as HTMLInputElement).value; changed(); } }),
      h("input", { type: "color", value: p.background, title: T("背景色", "Background"), oninput: (e: Event) => { p.background = (e.target as HTMLInputElement).value; changed(); } }),
    ),
    h("div", { class: "muted small" }, p.output),
  );
}

function render() {
  applyTheme();
  const p = state.project;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("产品演示视频制作", "Demo Video Maker")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void busy(async () => load(await call("demo_open", { project: v }))); } },
      h("option", { value: "" }, T("打开工程…", "Open project…")), ...(state.files?.projects ?? []).map((v) => h("option", { value: v, selected: v === state.path && !!p }, v))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    p ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void save() }, T("保存", "Save")) : null,
    p ? h("button", { class: "primary", onclick: () => void renderVideo() }, T("渲染视频", "Render video")) : null,
  );
  if (!p) {
    root.replaceChildren(toolbar, h("div", { class: "empty" }, T("把产品录屏放进工作区，然后对 Agent 说“用这几段录屏做一个产品演示视频”。也可以从上方打开已有工程，或者选一段录屏开始：", "Put screen recordings in the workspace and ask the agent to make a product demo video from them, open a saved project above, or start from a recording:"),
      h("div", { class: "row", style: { justifyContent: "center" } }, h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void busy(async () => load(await call("demo_open", { recordings: [v] }))); } }, h("option", { value: "" }, T("选择录屏…", "Choose a recording…")), ...(state.files?.videos ?? []).map((v) => h("option", { value: v }, v))))));
    return;
  }
  const rendered = state.rendered
    ? h("div", { class: "card" }, h("b", {}, T(`已生成 ${state.rendered.output}（${fmt(state.rendered.duration)}）`, `Rendered ${state.rendered.output} (${fmt(state.rendered.duration)})`)),
        h("div", { class: "small muted" }, T(`重新渲染：${state.rendered.fresh.join("、") || "无"}；沿用缓存：${state.rendered.reused.join("、") || "无"}`, `Re-rendered: ${state.rendered.fresh.join(", ") || "none"}; cached: ${state.rendered.reused.join(", ") || "none"}`)),
        h("div", { class: "frames" }, ...state.rendered.frames.map((f) => h("img", { src: f }))))
    : null;
  put(root, toolbar,
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    h("div", { class: "layout" }, h("div", { id: "list" }), h("div", {}, h("div", { id: "editor" }), rendered)));
  renderList();
  renderEditor();
}

onHostContext(() => render());
render();
void initHost("demo-video-maker", "0.1.0").then(() => loadFiles());
