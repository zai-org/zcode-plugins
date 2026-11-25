import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Track { file: string; name: string; offset: number; gain: number; mute: boolean }
interface Cut { start: number; end: number; note: string }
interface Project { version: 1; title: string; tracks: Track[]; cuts: Cut[]; intro: string; outro: string; denoise: "off" | "light" | "strong"; loudness: number; format: "mp3" | "wav" | "both"; output: string }
interface Wave { peaks: Uint8Array; duration: number }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const COLORS = ["#2563eb", "#db2777", "#0d9488", "#ea580c", "#7c3aed", "#65a30d", "#0891b2", "#9333ea"];
const state: {
  p?: Project; total: number; pauses: { start: number; end: number }[]; confidences: number[]; warnings: string[]; t: number; view: { start: number; span: number };
  waves: Record<string, Wave>; files?: { audio: string[]; projects: string[] }; dirty: boolean; rendered?: { files: string[]; length: number; loudness: number; truePeak: number }; temp?: [number, number];
} = { total: 0, pauses: [], confidences: [], warnings: [], t: 0, view: { start: 0, span: 0 }, waves: {}, dirty: false };
const root = document.getElementById("root")!;
const player = new Audio();
const clock = (s: number, d = 1) => { const neg = s < 0; s = Math.round(Math.abs(s) * 10 ** d) / 10 ** d; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return `${neg ? "-" : ""}${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${x.toFixed(d).padStart(d ? 3 + d : 2, "0")}`; };
const parseClock = (v: string) => (/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v.trim()) ? v.trim().split(":").reduce((s, x) => s * 60 + Number(x), 0) : NaN);

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); if (st) st.textContent = ""; }
}

function load(v: Record<string, unknown>, keepView = false) {
  state.p = v.project as Project;
  state.total = Number(v.total ?? state.total);
  if (v.pauses) state.pauses = v.pauses as typeof state.pauses;
  if (v.confidences) state.confidences = v.confidences as number[];
  state.warnings = (v.warnings as string[]) ?? [];
  if (!keepView || !state.view.span) state.view = { start: 0, span: state.total };
  state.dirty = false;
  render();
  void loadWaves();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "project" || v.kind === "aligned") load(v, true);
  if (v.kind === "rendered") { load(v, true); state.rendered = v as any; render(); }
});

async function loadWaves() {
  for (const t of state.p?.tracks ?? []) {
    if (state.waves[t.file]) continue;
    const r = await call<{ data: string; duration: number }>("waveform", { file: t.file }, 600_000).catch(() => undefined);
    if (!r) continue;
    state.waves[t.file] = { peaks: Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0)), duration: r.duration };
    drawLanes();
  }
}

function changed() { state.dirty = true; const b = document.getElementById("save") as HTMLButtonElement | null; if (b) b.disabled = false; drawLanes(); }

const x2t = (lane: HTMLElement, clientX: number) => { const r = lane.getBoundingClientRect(); return state.view.start + ((clientX - r.left) / r.width) * state.view.span; };
const pct = (t: number) => `${((t - state.view.start) / state.view.span) * 100}%`;

function drawLanes() {
  const p = state.p;
  if (!p) return;
  const { start, span } = state.view;
  document.querySelectorAll<HTMLElement>(".lane").forEach((lane) => {
    const i = Number(lane.dataset.i);
    const t = p.tracks[i];
    const canvas = lane.querySelector("canvas")!;
    const w = (canvas.width = lane.clientWidth * devicePixelRatio);
    const hgt = (canvas.height = lane.clientHeight * devicePixelRatio);
    const g = canvas.getContext("2d")!;
    g.clearRect(0, 0, w, hgt);
    const wave = state.waves[t.file];
    g.fillStyle = t.mute ? "#94a3b8" : COLORS[i % COLORS.length];
    if (wave) {
      const gain = Math.pow(10, t.gain / 40);
      for (let x = 0; x < w; x++) {
        const a = start + (x / w) * span - t.offset;
        const b = start + ((x + 1) / w) * span - t.offset;
        if (b < 0 || a > wave.duration) continue;
        let m = 0;
        for (let k = Math.max(0, Math.floor(a * 10)); k <= Math.min(wave.peaks.length - 1, Math.floor(b * 10)); k++) m = Math.max(m, wave.peaks[k]);
        const y = Math.min(1, (m / 255) * gain) * (hgt / 2 - 2);
        g.fillRect(x, hgt / 2 - y, 1, Math.max(1, y * 2));
      }
    } else { g.font = `${11 * devicePixelRatio}px sans-serif`; g.fillText(T("读取波形…", "Loading waveform…"), 8, 20 * devicePixelRatio); }
    lane.querySelectorAll(".cutbox,.playhead").forEach((e) => e.remove());
    for (const c of p.cuts) lane.append(h("div", { class: "cutbox", style: { left: pct(c.start), width: `${((c.end - c.start) / span) * 100}%` } }));
    if (state.temp) lane.append(h("div", { class: "cutbox temp", style: { left: pct(Math.min(...state.temp)), width: `${(Math.abs(state.temp[1] - state.temp[0]) / span) * 100}%` } }));
    lane.append(h("div", { class: "playhead", style: { left: pct(state.t) } }));
  });
  const ruler = document.getElementById("ruler");
  if (ruler) {
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900].find((s) => span / s <= 12) ?? 1800;
    const marks: HTMLElement[] = [];
    for (let s = Math.ceil(start / step) * step; s <= start + span; s += step) marks.push(h("span", { style: { left: pct(s) } }, clock(s, 0)));
    put(ruler, ...marks, h("div", { class: "playhead", style: { left: pct(state.t) } }));
  }
}

let dragging = false;
function laneDown(e: MouseEvent) {
  const lane = e.currentTarget as HTMLElement;
  const t0 = x2t(lane, e.clientX);
  dragging = true;
  state.temp = [t0, t0];
  const move = (ev: MouseEvent) => { if (!dragging) return; state.temp = [t0, x2t(lane, ev.clientX)]; drawLanes(); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", (ev) => {
    dragging = false;
    window.removeEventListener("mousemove", move);
    const t1 = x2t(lane, ev.clientX);
    state.temp = undefined;
    const [a, b] = [Math.max(0, Math.min(t0, t1)), Math.min(state.total, Math.max(t0, t1))];
    if (b - a > Math.max(0.2, state.view.span / 400)) { addCut(a, b, ""); }
    else { state.t = Math.max(0, Math.min(state.total, t0)); drawLanes(); }
  }, { once: true });
}

function addCut(a: number, b: number, note: string) {
  const p = state.p!;
  p.cuts.push({ start: Math.round(a * 100) / 100, end: Math.round(b * 100) / 100, note });
  p.cuts.sort((x, y) => x.start - y.start);
  changed();
  render();
}

async function playMp3(args: Record<string, unknown>) {
  const r = await busy(() => call<{ data: string }>("preview", args, 120_000), T("生成试听…", "Preparing preview…"));
  if (!r) return;
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: "audio/mpeg" }));
  await player.play().catch(() => undefined);
}

async function save() {
  const r = await busy(() => call<Record<string, unknown>>("podcast_save", { project: state.p }), T("保存中…", "Saving…"));
  if (r) { load(r, true); toast(T("已保存", "Saved")); }
}
async function reopen(tracks: string[]) {
  const r = await busy(() => call<Record<string, unknown>>("podcast_open", { tracks, title: state.p?.title }, 1_200_000), T("读取并自动对齐…", "Reading and aligning…"));
  if (r) load(r);
}

function trackRow(t: Track, i: number) {
  const p = state.p!;
  const nudge = (d: number) => { t.offset = Math.round((t.offset + d) * 1000) / 1000; changed(); const inp = document.getElementById(`off-${i}`) as HTMLInputElement | null; if (inp) inp.value = t.offset.toFixed(3); };
  const conf = state.confidences[i];
  return h("div", { class: "trow" },
    h("div", { class: "thead" },
      h("div", { class: "r" }, h("span", { class: "dot", style: { width: "9px", height: "9px", borderRadius: "50%", background: COLORS[i % COLORS.length], display: "inline-block" } }),
        h("input", { type: "text", value: t.name, title: t.file, onchange: (e: Event) => { t.name = (e.target as HTMLInputElement).value; changed(); } }),
        p.tracks.length > 1 ? h("button", { title: T("移除音轨", "Remove track"), onclick: () => { p.tracks.splice(i, 1); changed(); render(); } }, "✕") : null),
      h("div", { class: "r" }, T("偏移", "Offset"), h("input", { id: `off-${i}`, class: "num", type: "number", step: 0.01, value: t.offset.toFixed(3), onchange: (e: Event) => { t.offset = Number((e.target as HTMLInputElement).value) || 0; changed(); } }), "s",
        h("button", { onclick: () => nudge(-0.1) }, "«"), h("button", { onclick: () => nudge(-0.01) }, "‹"), h("button", { onclick: () => nudge(0.01) }, "›"), h("button", { onclick: () => nudge(0.1) }, "»")),
      h("div", { class: "r" }, T("音量", "Gain"), h("input", { class: "num", type: "number", step: 1, min: -30, max: 20, value: t.gain, onchange: (e: Event) => { t.gain = Number((e.target as HTMLInputElement).value) || 0; changed(); } }), "dB",
        h("label", {}, h("input", { type: "checkbox", checked: t.mute, onchange: (e: Event) => { t.mute = (e.target as HTMLInputElement).checked; changed(); } }), T("静音", "Mute")),
        i > 0 && conf !== undefined ? h("span", { class: "small muted", title: T("自动对齐可信度", "Alignment confidence") }, conf >= 1.25 ? T("✓ 已对齐", "✓ aligned") : T("⚠ 未能自动对齐", "⚠ not aligned")) : null)),
    h("div", { class: "lane", "data-i": String(i), onmousedown: laneDown }, h("canvas", {})));
}

function render() {
  applyTheme();
  const p = state.p;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("播客制作台", "Podcast Studio")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (!v) return; if (v.endsWith(".json")) void busy(async () => load(await call("podcast_open", { project: v }, 1_200_000)), T("读取中…", "Loading…")); else void reopen([v]); } },
      h("option", { value: "" }, T("打开录音或工程…", "Open a recording or project…")),
      ...(state.files?.projects ?? []).map((f) => h("option", { value: f }, `📁 ${f}`)),
      ...(state.files?.audio ?? []).map((f) => h("option", { value: f }, f))),
    p ? h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void reopen([...p.tracks.map((t) => t.file), v]); } },
      h("option", { value: "" }, T("+ 添加音轨（嘉宾）…", "+ Add track (guest)…")),
      ...(state.files?.audio ?? []).filter((f) => !p.tracks.some((t) => t.file === f)).map((f) => h("option", { value: f }, f))) : null,
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    p ? h("button", { onclick: () => void playMp3({ project: p, start: state.t, length: 15 }) }, T("▶ 试听 15 秒", "▶ Preview 15 s")) : null,
    p && p.tracks.length > 1 ? h("button", { onclick: () => void busy(async () => { const r = await call<Record<string, unknown>>("podcast_align", { project: p }, 600_000); load(r, true); state.dirty = true; render(); toast((r.report as string[]).join("\n")); }, T("对齐中…", "Aligning…")) }, T("自动对齐", "Auto-align")) : null,
    p ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void save() }, T("保存", "Save")) : null,
    p ? h("button", { class: "primary", onclick: () => void busy(async () => { const r = await call<Record<string, unknown>>("podcast_render", { project: p }, 3_600_000); load(r, true); state.rendered = r as any; render(); toast(T("已导出", "Rendered")); }, T("混音、响度统一、导出中…", "Mixing, normalising and exporting…")) }, T("导出节目", "Render episode")) : null,
  );
  if (!p) {
    put(root, toolbar, h("div", { class: "empty" }, T("选一段主持人录音，再用“添加音轨”加上嘉宾的录音；或者对 Agent 说“把 host.wav 和 guest.wav 对齐，剪掉 12:30 到 14:05，加上片头片尾，导出 -16 LUFS 的 MP3”。", "Pick the host recording, then add the guest's with “Add track”; or ask the agent to align host.wav and guest.wav, cut 12:30–14:05, add the intro and outro and export an MP3 at -16 LUFS.")));
    return;
  }
  const zoom = (f: number) => { const c = state.view.start + state.view.span / 2; const span = Math.max(2, Math.min(state.total, state.view.span * f)); state.view = { span, start: Math.max(0, Math.min(state.total - span, c - span / 2)) }; render(); };
  const lanes = h("div", { class: "tracks" },
    h("div", { class: "trow" }, h("div", { class: "thead small muted" }, T("在波形上拖动 = 剪掉这段；单击 = 定位", "Drag on a waveform = cut that range; click = move playhead")), h("div", { id: "ruler", class: "ruler" })),
    ...p.tracks.map(trackRow));
  const view = h("div", { class: "view" },
    h("button", { onclick: () => zoom(0.5) }, "＋"), h("button", { onclick: () => zoom(2) }, "－"), h("button", { onclick: () => { state.view = { start: 0, span: state.total }; render(); } }, T("全部", "Fit")),
    h("input", { type: "range", min: 0, max: Math.max(0, state.total - state.view.span), step: 0.1, value: state.view.start, disabled: state.view.span >= state.total, oninput: (e: Event) => { state.view.start = Number((e.target as HTMLInputElement).value); drawLanes(); } }),
    h("span", { class: "muted" }, `${clock(state.t)} / ${clock(state.total)}`));
  const kept = state.total - p.cuts.reduce((s, c) => s + c.end - c.start, 0);
  const cuts = h("div", {},
    h("div", { class: "row" }, h("b", {}, T(`剪辑 ${p.cuts.length} 处`, `${p.cuts.length} cuts`)), h("span", { class: "muted small" }, T(`正片 ${clock(kept, 0)}（原 ${clock(state.total, 0)}）`, `body ${clock(kept, 0)} (from ${clock(state.total, 0)})`))),
    h("table", { class: "cuts" }, ...p.cuts.map((c, i) => h("tr", {},
      h("td", {}, h("button", { title: T("从剪辑点前 3 秒试听（未剪）", "Listen from 3 s before (uncut)"), onclick: () => void playMp3({ project: p, start: Math.max(0, c.start - 3), length: Math.min(30, c.end - c.start + 6) }) }, "▶")),
      h("td", {}, h("input", { class: "t", type: "text", value: clock(c.start), onchange: (e: Event) => { const v = parseClock((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { c.start = v; changed(); } } }), " – ",
        h("input", { class: "t", type: "text", value: clock(c.end), onchange: (e: Event) => { const v = parseClock((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { c.end = v; changed(); } } })),
      h("td", { class: "small muted" }, `${(c.end - c.start).toFixed(1)}s`),
      h("td", { style: { width: "40%" } }, h("input", { class: "n", type: "text", placeholder: T("备注", "Note"), value: c.note, onchange: (e: Event) => { c.note = (e.target as HTMLInputElement).value; changed(); } })),
      h("td", {}, h("button", { onclick: () => { p.cuts.splice(i, 1); changed(); render(); } }, "✕"))))),
    state.pauses.length ? h("div", { class: "small muted", style: { marginTop: "6px" } }, T("较长停顿（点一下缩短到 1 秒）：", "Long pauses (click to shorten to 1 s):")) : null,
    h("div", { class: "chips" }, ...state.pauses.filter((x) => !p.cuts.some((c) => c.start < x.end && c.end > x.start)).map((x) => h("button", { onclick: () => addCut(x.start + 0.5, x.end - 0.5, T("缩短停顿", "shorten pause")) }, `${clock(x.start, 0)} · ${(x.end - x.start).toFixed(1)}s`))));
  const audioOpts = (cur: string) => [h("option", { value: "" }, T("无", "None")), ...(state.files?.audio ?? []).map((f) => h("option", { value: f, selected: f === cur }, f))];
  const settings = h("div", { class: "settings" },
    h("label", {}, h("span", {}, T("节目名", "Title")), h("input", { type: "text", value: p.title, onchange: (e: Event) => { p.title = (e.target as HTMLInputElement).value; changed(); } })),
    h("label", {}, h("span", {}, T("片头", "Intro")), h("select", { onchange: (e: Event) => { p.intro = (e.target as HTMLSelectElement).value; changed(); } }, ...audioOpts(p.intro))),
    h("label", {}, h("span", {}, T("片尾", "Outro")), h("select", { onchange: (e: Event) => { p.outro = (e.target as HTMLSelectElement).value; changed(); } }, ...audioOpts(p.outro))),
    h("label", {}, h("span", {}, T("降噪", "Noise reduction")), h("select", { onchange: (e: Event) => { p.denoise = (e.target as HTMLSelectElement).value as any; changed(); } },
      ...([["off", T("关", "Off")], ["light", T("轻度（推荐）", "Light (recommended)")], ["strong", T("较强", "Strong")]] as const).map(([v, l]) => h("option", { value: v, selected: p.denoise === v }, l)))),
    h("label", {}, h("span", {}, T("响度", "Loudness")), h("select", { onchange: (e: Event) => { p.loudness = Number((e.target as HTMLSelectElement).value); changed(); } },
      ...([[-16, T("-16 LUFS（播客平台通用）", "-16 LUFS (podcast standard)")], [-14, T("-14 LUFS（音乐平台）", "-14 LUFS (music platforms)")], [-19, T("-19 LUFS（单声道习惯）", "-19 LUFS (mono convention)")], [-23, T("-23 LUFS（广播 EBU R128）", "-23 LUFS (broadcast)")]] as const).map(([v, l]) => h("option", { value: v, selected: p.loudness === v }, l)))),
    h("label", {}, h("span", {}, T("格式", "Format")), h("select", { onchange: (e: Event) => { p.format = (e.target as HTMLSelectElement).value as any; changed(); } },
      ...([["mp3", "MP3 128 kbps"], ["wav", "WAV 16-bit"], ["both", "MP3 + WAV"]] as const).map(([v, l]) => h("option", { value: v, selected: p.format === v }, l)))),
    h("label", {}, h("span", {}, T("输出文件夹", "Output folder")), h("input", { type: "text", value: p.output, onchange: (e: Event) => { p.output = (e.target as HTMLInputElement).value; changed(); } })),
  );
  const r = state.rendered;
  put(root, toolbar,
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    r ? h("div", { class: "card" }, h("b", {}, T(`已导出 · ${clock(r.length, 0)} · ${r.loudness} LUFS · 峰值 ${r.truePeak} dBTP`, `Rendered · ${clock(r.length, 0)} · ${r.loudness} LUFS · peak ${r.truePeak} dBTP`)), " ",
      h("button", { onclick: () => void playMp3({ file: r.files[0], start: 0, length: 30 }) }, T("▶ 听开头", "▶ Play start")),
      h("div", { class: "small muted" }, r.files.join(" · "))) : null,
    lanes, view, h("div", { class: "grid2" }, cuts, settings));
  requestAnimationFrame(drawLanes);
}

window.addEventListener("resize", () => drawLanes());
onHostContext(() => render());
render();
void initHost("podcast-studio", "0.1.0").then(async () => {
  state.files = await call<{ audio: string[]; projects: string[] }>("workspace_files").catch(() => undefined);
  render();
});
