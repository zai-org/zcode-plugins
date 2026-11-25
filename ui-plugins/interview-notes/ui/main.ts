import css from "./kit.css";
import panelCss from "./panel.css";
import { applyTheme, call, h, initHost, locale, onHostContext, onToolResult, put, toast } from "./kit.ts";

const style = document.createElement("style");
style.textContent = css + panelCss;
document.head.append(style);

interface Utterance { id: string; start: number; end: number; speaker: string; text: string }
interface Quote { utterance: string; text: string }
interface Need { id: string; title: string; detail: string; category: string; priority: "high" | "medium" | "low"; status: "open" | "confirmed" | "rejected"; quotes: Quote[] }
interface Session { version: 1; audio: string; transcript: string; title: string; speakers: Record<string, string>; utterances: Utterance[]; needs: Need[] }

const T = (cn: string, en: string) => (locale() === "zh" ? cn : en);
const COLORS = ["#2563eb", "#db2777", "#0d9488", "#ea580c", "#7c3aed", "#65a30d", "#0891b2", "#9333ea"];
const state: { s?: Session; sel?: string; on?: string; warnings: string[]; files?: { recordings: string[]; transcripts: string[] }; dirty: boolean; exported?: string[] } = { warnings: [], dirty: false };
const root = document.getElementById("root")!;
const player = new Audio();
const clock = (s: number) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

async function busy<R>(work: () => Promise<R>, label = ""): Promise<R | undefined> {
  root.classList.add("busy");
  const st = document.getElementById("status");
  if (st) st.textContent = label;
  try { return await work(); } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); return undefined; } finally { root.classList.remove("busy"); if (st) st.textContent = ""; }
}

function load(v: Record<string, unknown>) {
  state.s = v.session as Session;
  state.warnings = (v.warnings as string[]) ?? [];
  if (!state.s.needs.some((n) => n.id === state.sel)) state.sel = state.s.needs[0]?.id;
  state.dirty = false;
  render();
}
onToolResult((v) => {
  if (!v) return;
  if (v.kind === "session" || v.kind === "saved") load(v);
  if (v.kind === "exported") { load(v); state.exported = v.files as string[]; render(); }
});

const speakerColor = (sp: string) => COLORS[Object.keys(state.s!.speakers).indexOf(sp) % COLORS.length];
const name = (sp: string) => state.s!.speakers[sp] ?? sp;
function changed() { state.dirty = true; const b = document.getElementById("save") as HTMLButtonElement | null; if (b) b.disabled = false; }

let playToken = 0;
async function play(u: Utterance) {
  const my = ++playToken;
  highlight(u.id, true);
  const r = await call<{ data: string; offset: number }>("audio_clip", { audio: state.s!.audio, start: u.start, end: u.end }).catch((e) => { toast(String(e?.message ?? e), "error"); return undefined; });
  if (!r || my !== playToken) return;
  if (player.src) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))], { type: "audio/mpeg" }));
  player.play().catch(() => undefined);
}
function highlight(id: string, scroll: boolean) {
  state.on = id;
  document.querySelectorAll(".line.on").forEach((e) => e.classList.remove("on"));
  const el = document.getElementById(`line-${id}`);
  el?.classList.add("on");
  if (scroll) el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function save() {
  const r = await busy(() => call<Record<string, unknown>>("interview_save", { session: state.s }), T("保存中…", "Saving…"));
  if (r) { load(r); toast(T("已保存", "Saved")); }
}
async function exportAll() {
  if (state.dirty) await save();
  const r = await busy(() => call<Record<string, unknown>>("interview_export", { audio: state.s!.audio }), T("导出中…", "Exporting…"));
  if (r) { state.exported = r.files as string[]; render(); toast(T("已导出", "Exported")); }
}

function needCard(n: Need, i: number) {
  const s = state.s!;
  const byId = new Map(s.utterances.map((u) => [u.id, u]));
  const set = (k: keyof Need, v: string) => { (n as any)[k] = v; changed(); };
  return h("div", { class: `need ${n.status}${state.sel === n.id ? " sel" : ""}`, onclick: () => { if (state.sel !== n.id) { state.sel = n.id; render(); } } },
    h("div", { class: "head" }, h("b", {}, `${i + 1}.`),
      h("input", { class: "title", type: "text", value: n.title, onchange: (e: Event) => set("title", (e.target as HTMLInputElement).value) }),
      h("button", { title: T("删除", "Delete"), onclick: (e: Event) => { e.stopPropagation(); s.needs.splice(i, 1); changed(); render(); } }, "✕")),
    h("div", { class: "meta" },
      h("select", { class: `pri-${n.priority}`, onchange: (e: Event) => { set("priority", (e.target as HTMLSelectElement).value); render(); } },
        ...(["high", "medium", "low"] as const).map((p) => h("option", { value: p, selected: n.priority === p }, { high: T("高优先级", "High"), medium: T("中优先级", "Medium"), low: T("低优先级", "Low") }[p]))),
      h("input", { type: "text", placeholder: T("分类", "Category"), value: n.category, onchange: (e: Event) => set("category", (e.target as HTMLInputElement).value) }),
      h("span", { class: "st" }, ...(["open", "confirmed", "rejected"] as const).map((st) => h("button", { class: n.status === st ? "on" : "", onclick: (e: Event) => { e.stopPropagation(); n.status = st; changed(); render(); } }, { open: T("待确认", "Open"), confirmed: T("确认", "Confirm"), rejected: T("不采纳", "Reject") }[st])))),
    h("textarea", { placeholder: T("说明", "Detail"), value: n.detail, onchange: (e: Event) => set("detail", (e.target as HTMLTextAreaElement).value) }),
    ...n.quotes.map((q, k) => {
      const u = byId.get(q.utterance);
      if (!u) return null;
      return h("div", { class: "quote" },
        h("button", { class: "play", onclick: (e: Event) => { e.stopPropagation(); void play(u); } }, `▶ ${clock(u.start)}`),
        h("span", { class: "q", onclick: () => highlight(u.id, true) }, `“${q.text}”`),
        h("span", { class: "who" }, name(u.speaker)),
        h("button", { class: "small", title: T("移除引用", "Remove quote"), onclick: (e: Event) => { e.stopPropagation(); n.quotes.splice(k, 1); changed(); render(); } }, "−"));
    }),
    n.quotes.length ? null : h("div", { class: "small muted" }, T("还没有原话引用：在右侧文字稿某句上点“+ 引用”。", "No quote yet: use “+ quote” on a transcript line.")),
  );
}

function render() {
  applyTheme();
  const s = state.s;
  const toolbar = h("div", { class: "toolbar" },
    h("b", {}, T("访谈纪要", "Interview Notes")),
    h("select", { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) void busy(async () => load(await call("interview_open", { audio: v })), T("读取中…", "Loading…")); } },
      h("option", { value: "" }, T("打开访谈录音…", "Open a recording…")),
      ...(state.files?.recordings ?? []).map((f) => h("option", { value: f, selected: s?.audio === f }, f))),
    h("span", { id: "status", class: "muted" }),
    h("span", { class: "spacer" }),
    s ? h("button", { id: "save", disabled: !state.dirty, onclick: () => void save() }, T("保存", "Save")) : null,
    s ? h("button", { class: "primary", onclick: () => void exportAll() }, T("导出纪要", "Export")) : null,
  );
  if (!s) {
    put(root, toolbar, h("div", { class: "empty" }, T("选一段访谈录音（同目录同名的 .srt / .vtt / .txt 转写会自动带上），或者对 Agent 说“整理 interview.m4a 的用户需求，每条附上原话”。插件不做语音识别，需要现成的转写（飞书妙记、腾讯会议、剪映等导出的都可以）。", "Pick an interview recording (a transcript with the same name is picked up), or ask the agent to pull the user needs out of interview.m4a with the original quotes. This plugin does not transcribe; bring a transcript (SRT, VTT, or a timestamped text export).")));
    return;
  }
  const sel = s.needs.find((n) => n.id === state.sel);
  const quoted = new Set(s.needs.flatMap((n) => n.quotes.map((q) => q.utterance)));
  const left = h("div", { class: "col" },
    h("div", { class: "row" }, h("b", {}, T(`需求 ${s.needs.length} 条`, `${s.needs.length} needs`)), h("span", { class: "muted small" }, T(`已确认 ${s.needs.filter((n) => n.status === "confirmed").length}`, `${s.needs.filter((n) => n.status === "confirmed").length} confirmed`)), h("span", { class: "spacer" }),
      h("button", { onclick: () => { const id = `n${Date.now().toString(36)}`; s.needs.push({ id, title: T("新需求", "New need"), detail: "", category: "", priority: "medium", status: "open", quotes: [] }); state.sel = id; changed(); render(); } }, T("+ 新需求", "+ Need"))),
    ...s.needs.map(needCard),
    s.needs.length ? null : h("div", { class: "empty small" }, T("还没有需求。让 Agent 读文字稿后用 interview_submit 填进来，或手动新建。", "No needs yet. Ask the agent to extract them, or add one by hand.")),
  );
  const right = h("div", { class: "col" },
    h("div", { class: "speakers" }, h("span", { class: "muted" }, T("说话人：", "Speakers:")),
      ...Object.keys(s.speakers).map((sp) => h("label", {}, h("span", { class: "dot", style: { background: speakerColor(sp) } }),
        h("input", { type: "text", value: s.speakers[sp], title: sp, onchange: (e: Event) => { s.speakers[sp] = (e.target as HTMLInputElement).value.trim() || sp; changed(); render(); } })))),
    ...s.utterances.map((u) => h("div", { id: `line-${u.id}`, class: `line${state.on === u.id ? " on" : ""}${quoted.has(u.id) ? " quoted" : ""}` },
      h("button", { class: "play", onclick: () => void play(u) }, clock(u.start)),
      h("select", { class: "sp", style: { color: speakerColor(u.speaker) }, onchange: (e: Event) => { u.speaker = (e.target as HTMLSelectElement).value; changed(); render(); } },
        ...Object.keys(s.speakers).map((sp) => h("option", { value: sp, selected: sp === u.speaker }, name(sp)))),
      h("span", { class: "tx" }, u.text),
      sel ? h("button", { class: "add", title: T(`加为「${sel.title}」的原话`, `Quote under “${sel.title}”`), onclick: () => { if (!sel.quotes.some((q) => q.utterance === u.id)) { sel.quotes.push({ utterance: u.id, text: u.text }); changed(); render(); } } }, T("+ 引用", "+ quote")) : null)),
  );
  put(root, toolbar,
    h("div", { class: "small muted" }, `${s.title} · ${s.audio} · ${s.transcript} · ${s.utterances.length} ${T("句", "lines")}`),
    state.warnings.length ? h("div", { class: "card small" }, ...state.warnings.map((w) => h("div", {}, `⚠ ${w}`))) : null,
    state.exported ? h("div", { class: "card small" }, T("已导出：", "Exported: "), state.exported.join(" · ")) : null,
    h("div", { class: "layout" }, left, right));
}

onHostContext(() => render());
render();
void initHost("interview-notes", "0.1.0").then(async () => {
  state.files = await call<{ recordings: string[]; transcripts: string[] }>("workspace_files").catch(() => undefined);
  render();
});
