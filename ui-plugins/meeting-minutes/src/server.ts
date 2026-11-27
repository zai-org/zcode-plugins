import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { parseNotes, splitNames, type Header, type Kind } from "./parse.ts";

export const NAME = "meeting-minutes";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".md", ".markdown", ".txt", ".text", ".vtt", ".srt"];
const KINDS: Kind[] = ["agenda", "decision", "action", "question", "note"];
type Meta = { files: { path: string; text: string }[]; detected: Header; cjk: boolean };

const LBL = {
  zh: { minutes: "会议纪要", date: "日期", location: "地点", attendees: "参会人", recorder: "记录", agenda: "议程", notes: "讨论要点", decisions: "决定", actions: "行动项", questions: "待定问题", item: "事项", owner: "负责人", due: "截止日期", none: "（无）", tbd: "待定", general: "其他" },
  en: { minutes: "Minutes", date: "Date", location: "Location", attendees: "Attendees", recorder: "Minutes by", agenda: "Agenda", notes: "Discussion", decisions: "Decisions", actions: "Action items", questions: "Open questions", item: "Item", owner: "Owner", due: "Due", none: "(none)", tbd: "TBD", general: "General" },
};

/** 把 SRT/VTT 字幕变成 “说话人: 文本” 逐字稿 */
function subtitleToText(t: string) {
  return t.replace(/^WEBVTT.*$/m, "").split(/\r?\n\r?\n/).map((b) => b.split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).map((l) => l.replace(/^<v\s+([^>]+)>/, "$1: ").replace(/<[^>]+>/g, "")).join(" ")).filter(Boolean).join("\n");
}

interface Minutes {
  h: Header & { lang: "zh" | "en" };
  agenda: string[];
  notes: { topic: string; items: string[] }[];
  decisions: string[];
  actions: { text: string; owner: string; due: string }[];
  questions: string[];
}

function minutes(p: Pick<Project, "rows" | "settings" | "meta">): Minutes {
  const meta = p.meta as Meta, d = meta.detected;
  const lang = s(p.settings.lang) === "en" ? "en" : s(p.settings.lang) === "zh" ? "zh" : meta.cjk ? "zh" : "en";
  const att = s(p.settings.attendees) ? splitNames(s(p.settings.attendees)) : d.attendees;
  const h = { title: s(p.settings.title) || d.title || (lang === "zh" ? "会议" : "Meeting"), date: s(p.settings.date) || d.date, time: s(p.settings.time) || d.time, location: s(p.settings.location) || d.location, attendees: att, recorder: s(p.settings.recorder) || d.recorder, lang } as Minutes["h"];
  const inc = p.rows.filter((r) => r.include !== false && s(r.text));
  const by = (k: Kind) => inc.filter((r) => s(r.kind) === k);
  const notes: Minutes["notes"] = [];
  if (p.settings.includeNotes !== false) for (const r of by("note")) {
    const topic = s(r.topic);
    let g = notes.find((n) => n.topic === topic);
    if (!g) notes.push((g = { topic, items: [] }));
    g.items.push(s(r.text));
  }
  return { h, agenda: by("agenda").map((r) => s(r.text)), notes, decisions: by("decision").map((r) => s(r.text)), actions: by("action").map((r) => ({ text: s(r.text), owner: s(r.owner), due: s(r.due) })).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")), questions: by("question").map((r) => s(r.text)) };
}

function toMd(m: Minutes) {
  const L = LBL[m.h.lang];
  const out = [`# ${m.h.title} — ${L.minutes}`, ""];
  if (m.h.date || m.h.time) out.push(`- **${L.date}**: ${[m.h.date, m.h.time].filter(Boolean).join(" ")}`);
  if (m.h.location) out.push(`- **${L.location}**: ${m.h.location}`);
  if (m.h.attendees.length) out.push(`- **${L.attendees}**: ${m.h.attendees.join(m.h.lang === "zh" ? "、" : ", ")}`);
  if (m.h.recorder) out.push(`- **${L.recorder}**: ${m.h.recorder}`);
  const cell = (x: string) => x.replace(/\|/g, "\\|");
  if (m.agenda.length) out.push("", `## ${L.agenda}`, "", ...m.agenda.map((a, i) => `${i + 1}. ${a}`));
  if (m.notes.length) { out.push("", `## ${L.notes}`); for (const n of m.notes) { out.push(""); if (n.topic) out.push(`### ${n.topic}`, ""); out.push(...n.items.map((x) => `- ${x}`)); } }
  out.push("", `## ${L.decisions}`, "", ...(m.decisions.length ? m.decisions.map((x, i) => `${i + 1}. ${x}`) : [L.none]));
  out.push("", `## ${L.actions}`, "");
  if (m.actions.length) out.push(`| # | ${L.item} | ${L.owner} | ${L.due} |`, "| - | - | - | - |", ...m.actions.map((a, i) => `| ${i + 1} | ${cell(a.text)} | ${cell(a.owner || L.tbd)} | ${a.due || L.tbd} |`));
  else out.push(L.none);
  if (m.questions.length) out.push("", `## ${L.questions}`, "", ...m.questions.map((q) => `- ${q}`));
  return out.join("\n") + "\n";
}

async function toDocx(m: Minutes) {
  const L = LBL[m.h.lang];
  const P = (text: string, o: { bold?: boolean; color?: string; size?: number } = {}) => new Paragraph({ children: [new TextRun({ text, bold: o.bold, color: o.color, size: o.size })] });
  const H = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  const kids: (Paragraph | Table)[] = [new Paragraph({ text: `${m.h.title} — ${L.minutes}`, heading: HeadingLevel.TITLE })];
  const metaRows: [string, string][] = [];
  if (m.h.date || m.h.time) metaRows.push([L.date, [m.h.date, m.h.time].filter(Boolean).join(" ")]);
  if (m.h.location) metaRows.push([L.location, m.h.location]);
  if (m.h.attendees.length) metaRows.push([L.attendees, m.h.attendees.join(m.h.lang === "zh" ? "、" : ", ")]);
  if (m.h.recorder) metaRows.push([L.recorder, m.h.recorder]);
  for (const [k, v] of metaRows) kids.push(new Paragraph({ children: [new TextRun({ text: `${k}: `, bold: true }), new TextRun(v)] }));
  if (m.agenda.length) { kids.push(H(L.agenda, HeadingLevel.HEADING_1)); m.agenda.forEach((a, i) => kids.push(P(`${i + 1}. ${a}`))); }
  if (m.notes.length) {
    kids.push(H(L.notes, HeadingLevel.HEADING_1));
    for (const n of m.notes) { if (n.topic) kids.push(H(n.topic, HeadingLevel.HEADING_2)); for (const x of n.items) kids.push(new Paragraph({ text: x, bullet: { level: 0 } })); }
  }
  kids.push(H(L.decisions, HeadingLevel.HEADING_1));
  if (m.decisions.length) m.decisions.forEach((x, i) => kids.push(P(`${i + 1}. ${x}`))); else kids.push(P(L.none, { color: "6B7280" }));
  kids.push(H(L.actions, HeadingLevel.HEADING_1));
  if (m.actions.length) {
    const border = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (text: string, o: { head?: boolean; w: number; warn?: boolean }) => new TableCell({ width: { size: o.w, type: WidthType.PERCENTAGE }, borders, shading: o.head ? { fill: "F3F4F6", type: ShadingType.CLEAR, color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text, bold: o.head, color: o.warn ? "B45309" : undefined })] })] });
    kids.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: [cell("#", { head: true, w: 6 }), cell(L.item, { head: true, w: 58 }), cell(L.owner, { head: true, w: 18 }), cell(L.due, { head: true, w: 18 })] }),
        ...m.actions.map((a, i) => new TableRow({ children: [cell(String(i + 1), { w: 6 }), cell(a.text, { w: 58 }), cell(a.owner || L.tbd, { w: 18, warn: !a.owner }), cell(a.due || L.tbd, { w: 18, warn: !a.due })] })),
      ],
    }));
  } else kids.push(P(L.none, { color: "6B7280" }));
  if (m.questions.length) { kids.push(H(L.questions, HeadingLevel.HEADING_1)); for (const q of m.questions) kids.push(new Paragraph({ text: q, bullet: { level: 0 } })); }
  kids.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 360 }, children: [new TextRun({ text: m.h.recorder ? `${L.recorder}: ${m.h.recorder}` : "", color: "6B7280", size: 18 })] }));
  const doc = new Document({
    creator: "Penova",
    title: `${m.h.title} ${L.minutes}`,
    styles: { default: { document: { run: { font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" }, size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: kids }],
  });
  return Packer.toBuffer(doc);
}

/** RFC 5545：转义、按 75 字节折行、CRLF */
const icsEsc = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string) {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function hash(t: string) { let h = 2166136261; for (const c of t) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
export function toIcs(m: Minutes, time: string, now = new Date()) {
  const L = LBL[m.h.lang];
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Penova//meeting-minutes//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc(`${m.h.title} ${L.actions}`)}`];
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  for (const a of m.actions.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.due))) {
    const d = a.due.replace(/-/g, "");
    const next = new Date(Date.parse(a.due + "T00:00:00Z") + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    lines.push("BEGIN:VEVENT", `UID:${hash(a.text + a.due + m.h.title)}-${d}@meeting-minutes.penova`, `DTSTAMP:${stamp}`);
    if (tm) {
      const hh = tm[1].padStart(2, "0"), mm = tm[2];
      const end = new Date(Date.UTC(2000, 0, 1, +hh, +mm + 30));
      lines.push(`DTSTART:${d}T${hh}${mm}00`, `DTEND:${d}T${String(end.getUTCHours()).padStart(2, "0")}${String(end.getUTCMinutes()).padStart(2, "0")}00`);
    } else lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, "TRANSP:TRANSPARENT");
    lines.push(`SUMMARY:${icsEsc(`${a.owner ? a.owner + ": " : ""}${a.text}`)}`, `DESCRIPTION:${icsEsc(`${L.actions} — ${m.h.title}${m.h.date ? ` (${m.h.date})` : ""}\n${L.owner}: ${a.owner || L.tbd}`)}`, "CATEGORIES:Action item");
    if (tm) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(a.text)}`, "TRIGGER:-PT15M", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

function preview(m: Minutes, rows: Row[]) {
  const L = LBL[m.h.lang];
  const sec = (t: string, body: string) => `<h4 style="margin:12px 0 4px">${esc(t)}</h4>${body}`;
  const ol = (xs: string[]) => (xs.length ? `<ol style="margin:0;padding-left:20px">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : `<p class="muted">${L.none}</p>`);
  const warn = (t: string) => `<span style="color:#b45309">${esc(t)}</span>`;
  void rows;
  return `<div style="font-size:13px;line-height:1.5">
<h3 style="margin:0 0 4px">${esc(m.h.title)} — ${L.minutes}</h3>
<div class="muted">${esc([m.h.date, m.h.time].filter(Boolean).join(" "))}${m.h.location ? ` · ${esc(m.h.location)}` : ""}</div>
<div>${L.attendees}: ${esc(m.h.attendees.join(m.h.lang === "zh" ? "、" : ", ")) || warn(L.tbd)}</div>
${m.agenda.length ? sec(L.agenda, ol(m.agenda)) : ""}
${sec(L.decisions, ol(m.decisions))}
${sec(L.actions, m.actions.length ? `<table class="data"><tr><th>#</th><th>${L.item}</th><th>${L.owner}</th><th>${L.due}</th></tr>${m.actions.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.text)}</td><td>${a.owner ? esc(a.owner) : warn(L.tbd)}</td><td>${a.due ? esc(a.due) : warn(L.tbd)}</td></tr>`).join("")}</table>` : `<p class="muted">${L.none}</p>`)}
${m.questions.length ? sec(L.questions, `<ul style="margin:0;padding-left:20px">${m.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>`) : ""}
${m.notes.length ? sec(L.notes, m.notes.map((n) => `${n.topic ? `<div style="font-weight:600">${esc(n.topic)}</div>` : ""}<ul style="margin:0 0 4px;padding-left:20px">${n.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")) : ""}
</div>`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "minutes",
  title: ["会议纪要整理", "Meeting Minutes"],
  openDescription:
    "Turn raw meeting notes (Markdown/text) or a transcript ('Name: words' lines, optionally with [hh:mm:ss] timestamps; SRT/VTT also work) into standard minutes. Detects title, date, time, location, attendees ('参会人：…' / 'Attendees: …' plus transcript speakers) and recorder; sorts every line into agenda, decision, action, question or note using section headings (议程/决定/行动项/问题, Agenda/Decisions/Action items/Open questions) and wording (决定/同意/agreed, TODO/[ ]/负责/I'll/can you, ？). Actions get an owner (@name, '负责人：', a known attendee named in the line, or the speaker for 'I'll/我来') and a due date resolved against the meeting date (周五前, 下周一, 11月22日, 月底, by Friday, next Monday, tomorrow, Dec 3, within 3 days). One row per item: include, kind, text, owner, due (YYYY-MM-DD), topic, source; rows can be added. Transcript chatter is excluded by default. Settings override detected header fields: title, date (re-resolves relative due dates), time, location, attendees, recorder, lang (auto/zh/en), icsTime (HH:MM for timed reminders; empty = all-day), includeNotes. Exports minutes.docx, minutes.md, actions.ics (one calendar event per dated action) and actions.csv.",
  inputs: { exts: EXTS, min: 1, max: 10, folders: true, label: ["选择会议记录或逐字稿", "Pick meeting notes or a transcript"] },
  settings: [
    { key: "title", label: ["会议名称（留空=自动识别）", "Title (empty = detected)"], type: "text", default: "" },
    { key: "date", label: ["会议日期（留空=自动识别）", "Meeting date (empty = detected)"], type: "date", default: "", reload: true },
    { key: "time", label: ["时间", "Time"], type: "text", default: "" },
    { key: "location", label: ["地点", "Location"], type: "text", default: "" },
    { key: "attendees", label: ["参会人（逗号或顿号分隔）", "Attendees (comma-separated)"], type: "text", default: "", reload: true },
    { key: "recorder", label: ["记录人", "Minutes by"], type: "text", default: "" },
    { key: "lang", label: ["纪要语言", "Language"], type: "select", default: "auto", options: [{ value: "auto", label: ["自动", "Auto"] }, { value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }] },
    { key: "icsTime", label: ["日历提醒时间（如 09:00，留空=全天）", "Reminder time (e.g. 09:00; empty = all-day)"], type: "text", default: "" },
    { key: "includeNotes", label: ["纪要里包含讨论要点", "Include discussion notes"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "include", label: ["包含", "Include"], type: "bool" },
    { key: "kind", label: ["类型", "Kind"], type: "select", options: KINDS },
    { key: "text", label: ["内容", "Text"], wide: true },
    { key: "owner", label: ["负责人", "Owner"] },
    { key: "due", label: ["截止日期", "Due"], type: "date" },
    { key: "topic", label: ["议题", "Topic"] },
    { key: "source", label: ["来源", "Source"], readOnly: true },
  ] as Column[],
  newRow: () => ({ include: true, kind: "action", text: "", owner: "", due: "", topic: "", source: "manual 手动" }),
  async load({ ws, files, settings, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 50 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en")).slice(0, 10);
    if (!uniq.length) throw new KitError("no_files", "No .md/.txt/.srt/.vtt notes found.");
    const mf: Meta["files"] = [];
    for (const f of uniq) { let text = (await ws.read(f, 5 * 1024 * 1024)).toString("utf8"); if (/\.(srt|vtt)$/i.test(f)) text = subtitleToText(text); mf.push({ path: f, text }); }
    const parsed = parseNotes(mf, /^\d{4}-\d{2}-\d{2}$/.test(s(settings.date)) ? s(settings.date) : undefined);
    if (s(settings.attendees)) {
      // 用户给的参会人参与负责人识别
      const again = parseNotes(mf.map((f) => ({ ...f, text: `参会人：${s(settings.attendees)}\n${f.text}` })), parsed.header.date || undefined);
      parsed.items = again.items.map((it) => ({ ...it, line: it.line - 1 }));
    }
    const prev = new Map((previous ?? []).map((r) => [s(r._key), r]));
    const count = new Map<string, number>();
    const rows: Row[] = parsed.items.map((it) => {
      const base = `${it.file}:${it.line}`;
      const n = (count.get(base) ?? 0) + 1; count.set(base, n);
      const key = `${base}:${n}`;
      const row: Row = { include: !(it.transcript && it.kind === "note"), kind: it.kind, text: it.text, owner: it.owner, due: it.due, topic: it.topic, source: `${it.file.split("/").pop()}:${it.line}${it.speaker ? ` (${it.speaker})` : ""}`, _key: key };
      const o = prev.get(key);
      if (o) for (const k of ["include", "kind", "text", "owner", "due", "topic"]) row[k] = o[k];
      return row;
    });
    for (const o of previous ?? []) if (!s(o._key)) rows.push(o);
    return { rows, meta: { files: mf, detected: parsed.header, cjk: /[\u4e00-\u9fff]/.test(mf.map((f) => f.text).join("")) } };
  },
  compute(p): Computed {
    const m = minutes(p);
    const issues: Issue[] = [];
    const L = LBL[m.h.lang];
    if (!m.h.date) issues.push({ level: "warn", message: "No meeting date found — set it in settings so 周五/next Monday style deadlines can be resolved / 没找到会议日期" });
    const att = new Set(m.h.attendees);
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!KINDS.includes(s(r.kind) as Kind)) issues.push({ level: "error", row: i, key: "kind", message: `Row ${i}: kind must be one of ${KINDS.join("/")}` });
      if (s(r.kind) !== "action") return;
      const due = s(r.due);
      if (!s(r.owner)) issues.push({ level: "warn", row: i, key: "owner", message: `Action “${s(r.text).slice(0, 40)}” has no owner / 行动项没有负责人` });
      else if (att.size && !att.has(s(r.owner))) issues.push({ level: "info", row: i, key: "owner", message: `${s(r.owner)} isn't in the attendee list / 不在参会人名单里` });
      if (!due) issues.push({ level: "warn", row: i, key: "due", message: `Action “${s(r.text).slice(0, 40)}” has no due date / 行动项没有截止日期` });
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) issues.push({ level: "error", row: i, key: "due", message: `Row ${i}: due “${due}” must be YYYY-MM-DD / 日期格式应为 YYYY-MM-DD` });
      else if (m.h.date && due < m.h.date) issues.push({ level: "warn", row: i, key: "due", message: `Due ${due} is before the meeting (${m.h.date}) / 截止日期早于会议日期` });
    });
    const dated = m.actions.filter((a) => a.due).length;
    return {
      rows: p.rows,
      issues,
      summary: `${m.h.title} ${m.h.date}: ${m.decisions.length} decision(s), ${m.actions.length} action(s) (${dated} dated), ${m.questions.length} open question(s). ${m.decisions.length} 项决定，${m.actions.length} 个行动项，${m.questions.length} 个待定问题。`,
      stats: { attendees: m.h.attendees.length, agenda: m.agenda.length, decisions: m.decisions.length, actions: m.actions.length, dated, unowned: m.actions.filter((a) => !a.owner).length, questions: m.questions.length },
      preview: preview(m, p.rows),
    };
  },
  exports: [
    {
      id: "docx", label: ["Word 纪要", "Word minutes"], description: "minutes.docx — title, date/attendees, agenda, discussion, numbered decisions, action table (owner, due) and open questions",
      async run({ project, write }: ExportCtx) { return [await write("minutes.docx", await toDocx(minutes(project)))]; },
    },
    {
      id: "md", label: ["Markdown 纪要", "Markdown minutes"], description: "minutes.md — the same minutes as Markdown (action items as a table)",
      async run({ project, write }: ExportCtx) { return [await write("minutes.md", toMd(minutes(project)))]; },
    },
    {
      id: "ics", label: ["日历文件", "Calendar"], description: "actions.ics — one event per action with a due date (all-day, or timed with a 15-minute alarm when icsTime is set)",
      async run({ project, write }: ExportCtx) {
        const m = minutes(project);
        const n = m.actions.filter((a) => a.due).length;
        if (!n) throw new KitError("no_dates", "No action items have a due date.");
        return { files: [await write("actions.ics", toIcs(m, s(project.settings.icsTime)))], note: `${n} event(s); ${m.actions.length - n} action(s) without a date were skipped` };
      },
    },
    {
      id: "csv", label: ["行动项 CSV", "Actions (CSV)"], description: "actions.csv — action, owner, due, meeting, date",
      async run({ project, write }: ExportCtx) {
        const m = minutes(project);
        return [await write("actions.csv", toCsv(["action", "owner", "due", "meeting", "meeting_date"], m.actions.map((a) => [a.text, a.owner, a.due, m.h.title, m.h.date])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} [${s(r.kind)}] ${s(r.text)}${s(r.kind) === "action" ? ` — owner: ${s(r.owner) || "?"}, due: ${s(r.due) || "?"}` : ""}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
