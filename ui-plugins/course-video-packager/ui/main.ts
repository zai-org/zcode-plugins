import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Chapter { title: string; start: number; end: number; summary: string }
interface Project { version: 1; video: string; subtitles?: string; title: string; author: string; accent: string; mode: "reencode" | "copy"; chapters: Chapter[]; output: string }
interface Row { n: number; title: string; duration: number; file: string; cover: string }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#65a30d", "#0891b2", "#9333ea"];
const state: { project?: Project; duration: number; candidates: { at: number; length: number; kind: string }[]; cues: [number, number][]; t: number; frame?: string; warnings: string[]; files?: { videos: string[]; subtitles: string[]; projects: string[] }; built?: { rows: Row[]; zip: string; index: string; covers: Record<string, string> }; dirty: boolean } = { duration: 0, candidates: [], cues: [], t: 0, warnings: [], dirty: false };
const root = document.getElementById("root")!;
const clock = (s: number) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const x = s % 60; return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };
const parseClock = (v: string) => (/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(v.trim()) ? v.trim().split(":").reduce((s, x) => s * 60 + Number(x), 0) : NaN);

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try {
    return await work();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "error");
    return undefined;
  } finally {
    root.classList.remove("busy");
    if (st) st.textContent = "";
  }
}

function load(v: Record<string, unknown>) {
  state.project = v.project as Project;
  state.duration = Number(v.duration ?? state.duration);
  if (v.candidates) state.candidates = v.candidates as typeof state.candidates;
  if (v.cues) state.cues = v.cues as [number, number][];
  state.warnings = (v.warnings as string[]) ?? [];
  state.dirty = false;
  render();
  void loadFrame();
}

onToolResult((v) => {
  if (!v) return;
  if (v.kind === "project") load(v);
  if (v.kind === "built") {
    load(v);
    void showBuilt(v);
  }
});

let token = 0;
async function loadFrame() {
  if (!state.project) return;
  const my = ++token;
  const r = await call<{ data: string }>("frame", { source: state.project.video, t: state.t, width: 640 }).catch(() => undefined);
  if (my !== token || !r) return;
  state.frame = `data:image/jpeg;base64,${r.data}`;
  const img = document.getElementById("frame") as HTMLImageElement | null;
  if (img) img.src = state.frame;
}

async function showBuilt(v: Record<string, unknown>) {
  const rows = v.rows as Row[];
  const p = state.project!;
  const covers: Record<string, string> = {};
  for (const r of rows) {
    const c = await call<{ data: string }>("frame", { source: `${p.output}/${r.cover}`, t: 0, width: 340 }).catch(() => undefined);
    if (c) covers[r.cover] = `data:image/jpeg;base64,${c.data}`;
  }
  state.built = { rows, zip: String(v.zip), index: String(v.index), covers };
  render();
}

function changed() {
  state.dirty = true;
  const b = document.getElementById("save") as HTMLButtonElement | null;
  if (b) b.disabled = false;
  renderTimeline();
}

function seek(t: number) {
  state.t = Math.max(0, Math.min(state.duration, t));
  const s = document.getElementById("slider") as HTMLInputElement | null;
  if (s) s.value = String(state.t);
  const l = document.getElementById("tlabel");
  if (l) l.textContent = clock(state.t);
  renderTimeline();
  clearTimeout((seek as any)._t);
  (seek as any)._t = setTimeout(() => void loadFrame(), 150);
}

function chaptersWithEnds() {
  const p = state.project!;
  const sorted = [...p.chapters].sort((a, b) => a.start - b.start);
  return sorted.map((c, i) => ({ ...c, end: i + 1 < sorted.length ? sorted[i + 1].start : state.duration }));
}

function renderTimeline() {
  const box = document.getElementById("timeline");
  if (!box || !state.project || !state.duration) return;
  const pct = (s: number) => `${(s / state.duration) * 100}%`;
  put(box,
    ...chaptersWithEnds().map((c, i) => h("div", { class: "ch", title: c.title, style: { left: pct(c.start), width: pct(c.end - c.start), background: COLORS[i % COLORS.length] } }, `${i + 1} ${c.title}`)),
    ...state.cues.filter((_, i) => i % 2 === 0).map(([a, b]) => h("div", { class: "cue", style: { left: pct(a), width: pct(Math.max(b - a, state.duration / 2000)) } })),
    ...state.candidates.map((c) => h("div", { class: "cand", title: `${clock(c.at)} ${c.kind} ${c.length}s`, style: { left: pct(c.at) } })),
    h("div", { class: "head", style: { left: pct(state.t) } }),
  );
}

async function save() {
  const r = await busy(() => call<Record<string, unknown>>("course_save", { project: state.project }), T("保存中…", "Saving…"));
  if (r) { load(r); toast(T("已保存", "Saved")); }
}
async function build() {
  const r = await busy(() => call<Record<string, unknown>>("course_build", { project: state.project }, 3_600_000), T("正在生成章节视频、字幕和封面…", "Building chapters, subtitles and covers…"));
  if (r) { load(r); await showBuilt(r); toast(T("发布包已生成", "Package built")); }
}

function render() {
  applyTheme();
  const p = state.project;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("课程视频整理", "Course Video Packager")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void busy(async () => load(await call("course_open", v.endsWith(".json") ? { project: v } : { video: v }, 1_200_000)), T("分析中（找停顿）…", "Analysing pauses…")); } },
      h("option", { value: "" }, T("打开课程录像或工程…", "Open a recording or project…")),
      ...(state.files?.projects ?? []).map((f) => h("option", { value: f }, `📁 ${f}`)),
      ...(state.files?.videos ?? []).map((f) => h("option", { value: f, selected: p?.video === f }, f))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    p ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void save() }, T("保存", "Save")) : null,
    p ? h("button", { class: "primary", onclick: () => void build() }, T("生成发布包", "Build package")) : null,
  );
  if (!p) {
    put(root, toolbar, h("div", { class: "empty" }, T("选择一段完整的课程录像（同目录下同名的 .srt/.vtt 字幕会自动带上），或者对 Agent 说“把 lecture.mp4 按内容分成章节，做成发布包”。", "Pick a full lecture recording (an .srt/.vtt with the same name is picked up automatically), or ask the agent to split lecture.mp4 into chapters and build a publishing package.")));
    return;
  }
  const table = h("table", { class: "chs" },
    h("tr", {}, h("td", {}, "#"), h("td", {}, T("开始", "Start")), h("td", {}, T("标题 / 简介", "Title / summary")), h("td", {})),
    ...p.chapters.map((c, i) => {
      const end = chaptersWithEnds().find((x) => x.start === c.start)?.end ?? c.end;
      return h("tr", { class: state.t >= c.start && state.t < end ? "on" : "" },
        h("td", {}, String(i + 1)),
        h("td", {}, h("input", { class: "t", type: "text", value: clock(c.start), onchange: (e: Event) => { const v = parseClock((e.target as HTMLInputElement).value); if (Number.isFinite(v)) { c.start = v; changed(); } }, onfocus: () => seek(c.start) }), h("div", { class: "small muted" }, clock(end - c.start))),
        h("td", {}, h("input", { type: "text", value: c.title, onchange: (e: Event) => { c.title = (e.target as HTMLInputElement).value; changed(); } }), h("textarea", { placeholder: T("简介（可选）", "Summary (optional)"), value: c.summary, onchange: (e: Event) => { c.summary = (e.target as HTMLTextAreaElement).value; changed(); } })),
        h("td", {}, h("button", { onclick: () => { p.chapters.splice(i, 1); changed(); render(); } }, "✕")),
      );
    }),
  );
  const left = h("div", {},
    h("div", { class: "small muted" }, T("色块 = 章节；橙色竖线 = 较长停顿（适合换章）；灰条 = 有字幕的地方。点时间条跳转。", "Blocks = chapters; orange ticks = long pauses (good breaks); grey = subtitles. Click to seek.")),
    h("div", { id: "timeline", class: "timeline", onclick: (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * state.duration); } }),
    table,
  );
  const right = h("div", {},
    h("div", { class: "preview" }, h("img", { id: "frame", src: state.frame ?? "" })),
    h("input", { id: "slider", type: "range", min: 0, max: state.duration, step: 0.5, value: state.t, oninput: (e: Event) => seek(Number((e.target as HTMLInputElement).value)) }),
    h("div", { class: "row" }, h("span", { id: "tlabel" }, clock(state.t)), h("span", { class: "muted small" }, `/ ${clock(state.duration)}`), h("span", { class: "spacer" }),
      h("button", { onclick: () => { p.chapters.push({ title: T("新章节", "New chapter"), start: Math.round(state.t), end: 0, summary: "" }); p.chapters.sort((a, b) => a.start - b.start); changed(); render(); } }, T("在这里开新章", "New chapter here"))),
    h("div", { class: "controls" },
      h("label", {}, T("课程名", "Course"), h("input", { type: "text", value: p.title, onchange: (e: Event) => { p.title = (e.target as HTMLInputElement).value; changed(); } })),
      h("label", {}, T("讲者", "Author"), h("input", { type: "text", value: p.author, onchange: (e: Event) => { p.author = (e.target as HTMLInputElement).value; changed(); } })),
      h("label", {}, T("封面颜色", "Accent"), h("input", { type: "color", value: p.accent, oninput: (e: Event) => { p.accent = (e.target as HTMLInputElement).value; changed(); } }),
        h("select", { onchange: (e: Event) => { p.mode = (e.target as HTMLSelectElement).value as "copy"; changed(); } }, h("option", { value: "reencode", selected: p.mode === "reencode" }, T("精确切分（重新编码）", "Exact cuts (re-encode)")), h("option", { value: "copy", selected: p.mode === "copy" }, T("快速切分（不重编码）", "Fast cuts (no re-encode)")))),
      h("div", { class: "small muted" }, `${p.video}${p.subtitles ? ` · ${p.subtitles}` : T(" · 无字幕", " · no subtitles")} → ${p.output}/`),
    ),
  );
  const built = state.built ? h("div", { class: "card" },
    h("b", {}, T(`已生成 ${state.built.rows.length} 章 · ${state.built.zip}`, `Built ${state.built.rows.length} chapters · ${state.built.zip}`)),
    h("div", { class: "small muted" }, `${state.built.index}`),
    h("div", { class: "covers" }, ...state.built.rows.map((r) => h("figure", {}, state.built!.covers[r.cover] ? h("img", { src: state.built!.covers[r.cover] }) : null, h("figcaption", {}, `${r.n}. ${r.title} · ${clock(r.duration)}`))))) : null;
  put(root, toolbar,
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    h("div", { class: "layout" }, left, right), built);
  renderTimeline();
}

onHostContext(() => render());
render();
void initHost("course-video-packager", "0.1.0").then(async () => {
  state.files = await call<{ videos: string[]; subtitles: string[]; projects: string[] }>("workspace_files").catch(() => undefined);
  render();
});
