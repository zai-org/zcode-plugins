import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Frame { source: string; region?: { x: number; y: number; w: number; h: number }; duration: number; dx: number; dy: number }
interface Action { name: string; frames: Frame[]; loop: boolean; anchor: "auto" | "feet" | "center" | "keep" }
interface Project { version: 1; name: string; actions: Action[]; scale: number; padding: number; background: string; output: string }
interface Rect { action: string; index: number; name: string; x: number; y: number; duration: number }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: {
  p?: Project; sel: number; frame?: number; playing: boolean; onion: boolean; zoom: number; warnings: string[]; modes: Record<string, string>;
  atlas?: HTMLImageElement; rects: Rect[]; cell: [number, number]; pivot: [number, number]; files?: { pngs: string[]; folders: string[]; projects: string[] }; dirty: boolean; exported?: string[]; exportedPng?: string;
} = { sel: 0, playing: true, onion: false, zoom: 6, warnings: [], modes: {}, rects: [], cell: [1, 1], pivot: [0, 0], dirty: false };
const root = document.getElementById("root")!;

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); if (st) st.textContent = ""; }
}

function load(v: Record<string, unknown>) {
  state.p = v.project as Project;
  state.warnings = (v.warnings as string[]) ?? [];
  state.modes = (v.modes as Record<string, string>) ?? {};
  if (state.sel >= state.p.actions.length) state.sel = 0;
  state.dirty = false;
  render();
  void refresh();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "project") { state.exported = undefined; load(v); }
  if (v.kind === "exported") { load(v); showExported(v.files as string[]); }
});

let token = 0;
async function refresh() {
  if (!state.p) return;
  const my = ++token;
  const r = await call<{ data: string; frames: Rect[]; cell: [number, number]; pivot: [number, number]; modes: Record<string, string>; warnings: string[] }>("atlas_preview", { project: state.p }).catch((e) => { toast(String(e?.message ?? e), "error"); return undefined; });
  if (!r || my !== token) return;
  const img = new Image();
  img.src = `data:image/png;base64,${r.data}`;
  await img.decode().catch(() => undefined);
  if (my !== token) return;
  Object.assign(state, { atlas: img, rects: r.frames, cell: r.cell, pivot: r.pivot, modes: r.modes, warnings: r.warnings });
  render();
}
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function changed(rerender = true) {
  state.dirty = true;
  if (rerender) render();
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), 120);
}

function showExported(files: string[]) {
  state.exported = files;
  render();
}

const actionRects = () => state.rects.filter((r) => r.action === state.p!.actions[state.sel]?.name);
function drawFrame(ctx: CanvasRenderingContext2D, r: Rect, zoom: number, alpha = 1) {
  if (!state.atlas) return;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(state.atlas, r.x, r.y, state.cell[0], state.cell[1], 0, 0, state.cell[0] * zoom, state.cell[1] * zoom);
  ctx.globalAlpha = 1;
}

let playIndex = 0;
let last = 0;
let acc = 0;
function tick(now: number) {
  const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
  const rects = state.p ? actionRects() : [];
  if (canvas && rects.length && state.atlas) {
    const z = state.zoom;
    const dt = last ? now - last : 0;
    last = now;
    if (state.playing) {
      acc += dt;
      while (acc >= (rects[playIndex % rects.length]?.duration ?? 100)) {
        acc -= rects[playIndex % rects.length].duration;
        playIndex++;
        if (!state.p!.actions[state.sel].loop && playIndex >= rects.length) { playIndex = rects.length - 1; acc = 0; break; }
      }
    }
    const i = state.playing ? playIndex % rects.length : Math.min(state.frame ?? 0, rects.length - 1);
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (state.onion && rects.length > 1) drawFrame(ctx, rects[(i - 1 + rects.length) % rects.length], z, 0.3);
    drawFrame(ctx, rects[i], z);
    ctx.strokeStyle = "rgba(239,68,68,.7)";
    ctx.beginPath();
    ctx.moveTo(0, state.pivot[1] * z + 0.5);
    ctx.lineTo(canvas.width, state.pivot[1] * z + 0.5);
    ctx.moveTo(state.pivot[0] * z + 0.5, state.pivot[1] * z - 8);
    ctx.lineTo(state.pivot[0] * z + 0.5, state.pivot[1] * z + 8);
    ctx.stroke();
    const label = document.getElementById("flabel");
    if (label) label.textContent = `${i + 1} / ${rects.length}`;
  } else last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function thumbs() {
  const a = state.p!.actions[state.sel];
  const rects = actionRects();
  return a.frames.map((f, i) => {
    const r = rects[i];
    const c = h("canvas", { width: state.cell[0] * 2, height: state.cell[1] * 2 }) as HTMLCanvasElement;
    if (r) drawFrame(c.getContext("2d")!, r, 2);
    const nudge = (dx: number, dy: number) => { f.dx += dx; f.dy += dy; changed(false); };
    return h("div", { class: `fr${!state.playing && state.frame === i ? " sel" : ""}`, onclick: () => { state.playing = false; state.frame = i; render(); } },
      c,
      h("div", {}, `${i + 1}`, f.dx || f.dy ? h("span", { class: "muted" }, ` (${f.dx},${f.dy})`) : null),
      h("input", { type: "number", min: 10, step: 10, value: f.duration, title: T("时长（毫秒）", "Duration (ms)"), onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => { f.duration = Number((e.target as HTMLInputElement).value) || 100; changed(); } }),
      h("div", { class: "nudge" },
        h("button", { title: T("左移 1px", "1 px left"), onclick: (e: Event) => { e.stopPropagation(); nudge(-1, 0); } }, "←"),
        h("button", { title: T("上移 1px", "1 px up"), onclick: (e: Event) => { e.stopPropagation(); nudge(0, -1); } }, "↑"),
        h("button", { title: T("下移 1px", "1 px down"), onclick: (e: Event) => { e.stopPropagation(); nudge(0, 1); } }, "↓"),
        h("button", { title: T("右移 1px", "1 px right"), onclick: (e: Event) => { e.stopPropagation(); nudge(1, 0); } }, "→")),
      h("div", { class: "nudge" },
        h("button", { title: T("前移", "Move earlier"), disabled: i === 0, onclick: (e: Event) => { e.stopPropagation(); a.frames.splice(i - 1, 0, ...a.frames.splice(i, 1)); state.frame = i - 1; changed(); } }, "◀"),
        h("button", { title: T("删除这帧", "Delete frame"), disabled: a.frames.length < 2, onclick: (e: Event) => { e.stopPropagation(); a.frames.splice(i, 1); state.frame = Math.max(0, i - 1); changed(); } }, "✕"),
        h("button", { title: T("后移", "Move later"), disabled: i === a.frames.length - 1, onclick: (e: Event) => { e.stopPropagation(); a.frames.splice(i + 1, 0, ...a.frames.splice(i, 1)); state.frame = i + 1; changed(); } }, "▶")));
  });
}

function render() {
  applyTheme();
  const p = state.p;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("游戏角色动作包", "Sprite Animation Pack")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!v) return; const [kind, path] = [v.slice(0, 2), v.slice(2)]; void busy(async () => load(await call("sprite_open", kind === "p:" ? { project: path } : kind === "s:" ? { sheet: path } : { frames: path })), T("读取中…", "Loading…")); } },
      h("option", { value: "" }, T("打开动作帧文件夹 / 精灵图 / 工程…", "Open frames folder / sheet / project…")),
      ...(state.files?.projects ?? []).map((f) => h("option", { value: `p:${f}` }, `📁 ${f}`)),
      ...(state.files?.folders ?? []).map((f) => h("option", { value: `f:${f}` }, `🗂 ${f}/`)),
      ...(state.files?.pngs ?? []).map((f) => h("option", { value: `s:${f}` }, `🖼 ${f}`))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    p ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void busy(async () => { load(await call("sprite_save", { project: p })); toast(T("已保存", "Saved")); }, T("保存中…", "Saving…")) }, T("保存", "Save")) : null,
    p ? h("button", { class: "primary", onclick: () => void busy(async () => { const r = await call<Record<string, unknown>>("sprite_export", { project: p }); load(r); showExported(r.files as string[]); toast(T("已导出", "Exported")); }, T("导出中…", "Exporting…")) }, T("导出动作包", "Export pack")) : null,
  );
  if (!p) {
    put(root, toolbar, h("div", { class: "empty" }, T("选一个装着动作帧的文件夹（run_01.png、run_02.png… 或按动作分子文件夹），或者一整张精灵图；也可以对 Agent 说“把 hero.png 按 32×32 切开，三行分别是 idle、run、jump，导出 Godot 和 Phaser 用的动作包”。", "Pick a folder of frames (run_01.png, run_02.png… or one sub-folder per action) or a whole sprite sheet; or ask the agent to slice hero.png into 32×32 cells (rows idle, run, jump) and export a pack for Godot and Phaser.")));
    return;
  }
  const a = p.actions[state.sel];
  const acts = h("div", { class: "acts" },
    ...p.actions.map((x, i) => h("div", { class: `act${i === state.sel ? " sel" : ""}`, onclick: () => { if (state.sel !== i) { state.sel = i; state.frame = 0; playIndex = 0; render(); } } },
      h("div", { class: "r" }, h("input", { type: "text", value: x.name, onchange: (e: Event) => { x.name = (e.target as HTMLInputElement).value; changed(); } }), h("span", { class: "muted" }, `${x.frames.length}f`),
        h("button", { title: T("删除动作", "Delete action"), disabled: p.actions.length < 2, onclick: (e: Event) => { e.stopPropagation(); p.actions.splice(i, 1); state.sel = 0; changed(); } }, "✕")),
      h("div", { class: "r" }, "fps", h("input", { class: "num", type: "number", min: 1, max: 60, value: Math.round(1000 / x.frames[0].duration), title: T("把这个动作所有帧设成同一速度", "Set all frames of this action to this speed"), onchange: (e: Event) => { const fps = Number((e.target as HTMLInputElement).value) || 10; for (const f of x.frames) f.duration = Math.round(1000 / fps); changed(); } }),
        h("label", {}, h("input", { type: "checkbox", checked: x.loop, onchange: (e: Event) => { x.loop = (e.target as HTMLInputElement).checked; changed(); } }), T("循环", "Loop"))),
      h("div", { class: "r" }, T("对齐", "Align"), h("select", { onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => { x.anchor = (e.target as HTMLSelectElement).value as Action["anchor"]; changed(); } },
        ...([["auto", T(`自动（${state.modes[x.name] === "keep" ? "保持原位" : "脚底"}）`, `Auto (${state.modes[x.name] ?? "…"})`)], ["feet", T("脚底对齐", "Feet")], ["center", T("中心对齐", "Center")], ["keep", T("保持原位", "Keep position")]] as const).map(([v, l]) => h("option", { value: v, selected: x.anchor === v }, l)))))));
  const [cw, ch] = state.cell;
  const stage = h("div", { class: "stage" },
    h("canvas", { id: "stage", width: cw * state.zoom, height: ch * state.zoom }),
    h("div", { class: "controls" },
      h("button", { onclick: () => { state.playing = !state.playing; state.frame = playIndex % Math.max(1, a.frames.length); render(); } }, state.playing ? T("❚❚ 暂停", "❚❚ Pause") : T("▶ 播放", "▶ Play")),
      h("button", { onclick: () => { state.playing = false; state.frame = ((state.frame ?? 0) - 1 + a.frames.length) % a.frames.length; render(); } }, "⏮"),
      h("button", { onclick: () => { state.playing = false; state.frame = ((state.frame ?? 0) + 1) % a.frames.length; render(); } }, "⏭"),
      h("span", { id: "flabel", class: "muted" }),
      h("label", {}, h("input", { type: "checkbox", checked: state.onion, onchange: (e: Event) => { state.onion = (e.target as HTMLInputElement).checked; } }), T("洋葱皮", "Onion skin")),
      h("label", {}, T("放大", "Zoom"), h("input", { type: "range", min: 1, max: 12, value: state.zoom, oninput: (e: Event) => { state.zoom = Number((e.target as HTMLInputElement).value); const c = document.getElementById("stage") as HTMLCanvasElement; c.width = cw * state.zoom; c.height = ch * state.zoom; } })),
      h("span", { class: "muted small" }, T(`单元格 ${cw}×${ch}，红线 = 锚点 / 地面`, `Cell ${cw}×${ch}; red = anchor / ground`))),
    h("div", { class: "strip" }, ...thumbs()));
  const settings = h("div", { class: "settings" },
    h("label", {}, h("span", {}, T("名称", "Name")), h("input", { type: "text", value: p.name, onchange: (e: Event) => { p.name = (e.target as HTMLInputElement).value; changed(); } })),
    h("label", {}, h("span", {}, T("放大倍数", "Scale")), h("select", { onchange: (e: Event) => { p.scale = Number((e.target as HTMLSelectElement).value); changed(); } }, ...[1, 2, 3, 4, 6, 8].map((k) => h("option", { value: k, selected: p.scale === k }, `${k}×`)))),
    h("label", {}, h("span", {}, T("留边", "Padding")), h("input", { type: "number", min: 0, max: 16, value: p.padding, style: { width: "60px" }, onchange: (e: Event) => { p.padding = Number((e.target as HTMLInputElement).value) || 0; changed(); } }), "px"),
    h("label", {}, h("span", {}, T("去底色", "Background")), h("select", { onchange: (e: Event) => { p.background = (e.target as HTMLSelectElement).value; changed(); } },
      ...([["auto", T("自动（左上角是纯色时去掉）", "Auto (key out a solid corner colour)")], ["none", T("不处理", "Keep")], ["#ff00ff", T("品红 #ff00ff", "Magenta #ff00ff")], ["#00ff00", T("绿幕 #00ff00", "Green #00ff00")]] as const).map(([v, l]) => h("option", { value: v, selected: p.background === v }, l)))),
    h("label", {}, h("span", {}, T("输出", "Output")), h("input", { type: "text", value: p.output, onchange: (e: Event) => { p.output = (e.target as HTMLInputElement).value; changed(); } })),
    h("div", { class: "small muted" }, T("导出：图集 PNG、Aseprite/Phaser JSON、Godot .tres、Unity 切片说明。", "Exports: atlas PNG, Aseprite/Phaser JSON, Godot .tres, Unity slicing notes.")),
    state.atlas ? h("div", { class: "atlas" }, h("div", { class: "small muted" }, T(`图集 ${state.atlas.width * p.scale}×${state.atlas.height * p.scale}`, `Atlas ${state.atlas.width * p.scale}×${state.atlas.height * p.scale}`)), h("img", { src: state.atlas.src })) : null);
  put(root, toolbar,
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    state.exported ? h("div", { class: "card small" }, h("b", {}, T("已导出：", "Exported: ")), state.exported.join(" · ")) : null,
    h("div", { class: "layout" }, acts, stage, settings));
}

onHostContext(() => render());
render();
void initHost("sprite-animation-pack", "0.1.0").then(async () => {
  state.files = await call<{ pngs: string[]; folders: string[]; projects: string[] }>("workspace_files").catch(() => undefined);
  render();
});
