import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Sound { name: string; category: string; event: string; kind: "synth" | "file"; preset: string; seed: number; params: Record<string, unknown>; source: string; trim: boolean; loop: boolean; crossfade: number; gain: number }
interface Project { version: 1; name: string; sounds: Sound[]; loudness: number; format: string; sampleRate: number; output: string }
interface Rendered { data: string; duration: number; loudness: number; peak: number; wave: number[]; params?: Record<string, number> }

const PRESETS = ["pickup", "coin", "laser", "explosion", "powerup", "hit", "jump", "blip", "confirm", "error", "step", "whoosh"];
const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const state: { p?: Project; cache: Map<number, Rendered>; warnings: string[]; files?: { audio: string[]; projects: string[] }; dirty: boolean; sel?: number; exported?: string } = { cache: new Map(), warnings: [], dirty: false };
const root = document.getElementById("root")!;
const player = new Audio();

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); if (st) st.textContent = ""; }
}
function load(v: Record<string, unknown>) {
  state.p = v.project as Project;
  state.warnings = (v.warnings as string[]) ?? [];
  state.cache.clear();
  state.dirty = false;
  render();
  void renderAll();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "project") { state.exported = undefined; load(v); }
  if (v.kind === "exported") { load(v); state.exported = `${(v.rows as unknown[]).length} → ${state.p!.output}/`; render(); }
});

async function renderOne(i: number) {
  const r = await call<Rendered>("sfx_render", { project: state.p, index: i }).catch((e) => { toast(String(e?.message ?? e), "error"); return undefined; });
  if (r) { state.cache.set(i, r); drawWave(i); }
  return r;
}
async function renderAll() { for (let i = 0; i < (state.p?.sounds.length ?? 0); i++) if (!state.cache.has(i)) await renderOne(i); render(); }
function drawWave(i: number) {
  const c = document.getElementById(`w${i}`) as HTMLCanvasElement | null;
  const r = state.cache.get(i);
  if (!c || !r) return;
  c.width = 240; c.height = 60;
  const g = c.getContext("2d")!;
  g.fillStyle = state.p!.sounds[i].kind === "file" ? "#16a34a" : "#4f46e5";
  r.wave.forEach((v, k) => { const x = (k / r.wave.length) * 240, y = v * 28; g.fillRect(x, 30 - y, Math.max(1, 240 / r.wave.length), Math.max(1, 2 * y)); });
}
async function play(i: number) {
  state.sel = i;
  const r = state.cache.get(i) ?? (await renderOne(i));
  if (!r) return;
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: "audio/wav" }));
  await player.play().catch(() => undefined);
  document.querySelectorAll(".snd.sel").forEach((e) => e.classList.remove("sel"));
  document.getElementById(`s${i}`)?.classList.add("sel");
}
function changed(i?: number, playIt = false) {
  state.dirty = true;
  const b = document.getElementById("save") as HTMLButtonElement | null;
  if (b) b.disabled = false;
  if (i === undefined) { state.cache.clear(); void renderAll(); return; }
  state.cache.delete(i);
  void renderOne(i).then(() => { render(); if (playIt) void play(i); });
}

function row(s: Sound, i: number) {
  const r = state.cache.get(i);
  const prm = (r?.params ?? {}) as Record<string, number>;
  const setParam = (k: string, v: number) => { s.params = { ...s.params, [k]: v }; changed(i, true); };
  const ctl = s.kind === "synth"
    ? h("div", { class: "ctl" },
      h("select", { onchange: (e: Event) => { s.preset = (e.target as HTMLSelectElement).value; s.params = {}; changed(i, true); } }, ...PRESETS.map((x) => h("option", { value: x, selected: s.preset === x }, x))),
      h("button", { title: T("换一个变体", "Another variation"), onclick: () => { s.seed = Math.floor(Math.random() * 1e6) + 1; s.params = {}; changed(i, true); } }, `🎲 #${s.seed}`),
      r?.params ? h("label", { title: T("音高（Hz）", "Pitch (Hz)") }, T("音高", "Pitch"), h("input", { type: "range", min: 40, max: 3000, step: 10, value: prm.freq, onchange: (e: Event) => setParam("freq", Number((e.target as HTMLInputElement).value)) })) : null,
      r?.params ? h("label", { title: T("衰减（秒）", "Decay (s)") }, T("长度", "Length"), h("input", { type: "range", min: 0.02, max: 1.5, step: 0.01, value: prm.decay, onchange: (e: Event) => setParam("decay", Number((e.target as HTMLInputElement).value)) })) : null,
      r?.params ? h("label", { title: T("滑音（八度/秒）", "Slide (octaves/s)") }, T("滑音", "Slide"), h("input", { type: "range", min: -10, max: 10, step: 0.1, value: prm.slide, onchange: (e: Event) => setParam("slide", Number((e.target as HTMLInputElement).value)) })) : null)
    : h("div", { class: "ctl" }, h("span", { class: "muted", title: s.source }, s.source.split("/").pop()),
      h("label", {}, h("input", { type: "checkbox", checked: s.trim, onchange: (e: Event) => { s.trim = (e.target as HTMLInputElement).checked; changed(i); } }), T("去首尾静音", "Trim")),
      h("label", {}, h("input", { type: "checkbox", checked: s.loop, onchange: (e: Event) => { s.loop = (e.target as HTMLInputElement).checked; changed(i, true); } }), T("无缝循环", "Seamless loop")),
      s.loop ? h("label", {}, T("交叉", "X-fade"), h("input", { class: "num", type: "number", min: 0.01, max: 5, step: 0.05, value: s.crossfade, onchange: (e: Event) => { s.crossfade = Number((e.target as HTMLInputElement).value) || 0.5; changed(i, true); } }), "s") : null);
  return h("div", { id: `s${i}`, class: `snd${state.sel === i ? " sel" : ""}` },
    h("button", { class: "play", title: T("试听", "Play"), onclick: () => void play(i) }, "▶"),
    h("div", {}, h("input", { type: "text", value: s.name, onchange: (e: Event) => { s.name = (e.target as HTMLInputElement).value; changed(i); render(); } }), h("div", { class: "small muted", title: s.event }, s.event.slice(0, 30))),
    h("div", {}, h("input", { type: "text", value: s.category, title: T("分类文件夹", "Category folder"), onchange: (e: Event) => { s.category = (e.target as HTMLInputElement).value; changed(i); render(); } }), h("span", { class: `badge ${s.kind}` }, s.kind === "file" ? T("已有声音", "file") : T("合成", "synth"))),
    ctl,
    h("div", {}, h("canvas", { id: `w${i}` }), h("div", { class: "small muted" }, r ? `${r.duration.toFixed(2)}s · ${r.loudness.toFixed(1)} dB` : "…",
      h("input", { class: "num", type: "number", step: 1, value: s.gain, title: T("相对音量 dB", "Relative gain dB"), style: { width: "40px", marginLeft: "4px" }, onchange: (e: Event) => { s.gain = Number((e.target as HTMLInputElement).value) || 0; changed(i, true); } }),
      h("button", { title: T("删除", "Delete"), onclick: () => { state.p!.sounds.splice(i, 1); changed(); render(); } }, "✕"))));
}

function render() {
  applyTheme();
  const p = state.p;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("游戏音效素材包", "Game SFX Pack")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!v) return; void busy(async () => { if (v.endsWith(".sfx.json")) load(await call("sfx_open", { project: v })); else if (p) { p.sounds.push({ name: v.split("/").pop()!.replace(/\.[^.]+$/, ""), category: "imported", event: v, kind: "file", preset: "blip", seed: 1, params: {}, source: v, trim: true, loop: false, crossfade: 0.5, gain: 0 }); load(await call("sfx_save", { project: p })); } else load(await call("sfx_open", { files: [v] })); }); } },
      h("option", { value: "" }, p ? T("+ 导入已有声音…", "+ Import a sound…") : T("打开工程或导入声音…", "Open a project or import a sound…")),
      ...(state.files?.projects ?? []).map((f) => h("option", { value: f }, `📁 ${f}`)),
      ...(state.files?.audio ?? []).map((f) => h("option", { value: f }, f))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    p ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void busy(async () => { load(await call("sfx_save", { project: p })); toast(T("已保存", "Saved")); }) }, T("保存", "Save")) : null,
    p ? h("button", { class: "primary", onclick: () => void busy(async () => { const r = await call<Record<string, unknown>>("sfx_export", { project: p }, 1_800_000); load(r); state.exported = `${(r.rows as unknown[]).length} → ${p.output}/`; render(); toast(T("已导出", "Exported")); }, T("渲染并导出…", "Rendering and exporting…")) }, T("导出素材包", "Export pack")) : null);
  const addEvent = (v: string) => { const name = v.trim(); if (!name) return; const base = { name, event: name }; void busy(async () => load(await call("sfx_save", { project: { ...(p ?? { name: "sfx" }), sounds: [...(p?.sounds ?? []), base] } }))); };
  const add = h("div", { class: "add" }, h("input", { id: "newev", type: "text", placeholder: T("输入游戏事件，回车添加（如：拾取金币、角色受击、菜单确认）", "Type a game event and press Enter (e.g. coin pickup, player hurt, menu confirm)"), onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") addEvent((e.target as HTMLInputElement).value); } }));
  if (!p) { put(root, toolbar, add, h("div", { class: "empty" }, T("输入游戏里需要音效的事件，或导入已有的声音；也可以对 Agent 说“给我的平台跳跃游戏做一套音效：跳跃、拾取金币、受击、死亡、按钮点击、菜单确认，再把 rain.wav 做成无缝循环”。", "Type the game events that need sounds, or import existing ones; or ask the agent: make a sound set for my platformer — jump, coin, hurt, death, button click, menu confirm — and turn rain.wav into a seamless loop."))); return; }
  const cats = [...new Set(p.sounds.map((s) => s.category))];
  const list = h("div", {}, add, ...cats.map((c) => h("div", { class: "cat" }, h("h3", {}, `📂 ${c}/`), ...p.sounds.map((s, i) => (s.category === c ? row(s, i) : null)).filter(Boolean) as HTMLElement[])));
  const settings = h("div", { class: "settings" },
    h("label", {}, h("span", {}, T("名称", "Name")), h("input", { type: "text", value: p.name, onchange: (e: Event) => { p.name = (e.target as HTMLInputElement).value; state.dirty = true; } })),
    h("label", {}, h("span", {}, T("统一响度", "Loudness")), h("select", { onchange: (e: Event) => { p.loudness = Number((e.target as HTMLSelectElement).value); changed(); } }, ...[-12, -15, -18, -21, -24].map((v) => h("option", { value: v, selected: p.loudness === v }, `${v} dBFS RMS`)))),
    h("label", {}, h("span", {}, T("格式", "Format")), h("select", { onchange: (e: Event) => { p.format = (e.target as HTMLSelectElement).value; state.dirty = true; } }, ...[["wav", "WAV 16-bit"], ["ogg", T("OGG（需 ffmpeg）", "OGG (ffmpeg)")], ["both", "WAV + OGG"]].map(([v, l]) => h("option", { value: v, selected: p.format === v }, l)))),
    h("label", {}, h("span", {}, T("采样率", "Sample rate")), h("select", { onchange: (e: Event) => { p.sampleRate = Number((e.target as HTMLSelectElement).value); changed(); } }, ...[22050, 44100, 48000].map((v) => h("option", { value: v, selected: p.sampleRate === v }, `${v} Hz`)))),
    h("label", {}, h("span", {}, T("输出", "Output")), h("input", { type: "text", value: p.output, onchange: (e: Event) => { p.output = (e.target as HTMLInputElement).value; state.dirty = true; } })),
    h("div", { class: "small muted" }, T("按分类导出到 输出/分类/名字.wav，附 manifest.json 和 manifest.csv。", "Exports to output/category/name.wav with manifest.json and manifest.csv.")));
  put(root, toolbar,
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    state.exported ? h("div", { class: "card" }, T(`已导出 ${state.exported}`, `Exported ${state.exported}`)) : null,
    h("div", { class: "layout" }, list, settings));
  for (let i = 0; i < p.sounds.length; i++) drawWave(i);
}

onHostContext(() => render());
render();
void initHost("game-sfx-pack", "0.1.0").then(async () => {
  state.files = await call<{ audio: string[]; projects: string[] }>("workspace_files").catch(() => undefined);
  render();
});
