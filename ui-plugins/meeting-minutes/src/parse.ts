/** 会议记录 / 逐字稿解析：标题、日期、参会人、议程、决定、行动项（负责人 + 截止日期）、待定问题 */
export type Kind = "agenda" | "decision" | "action" | "question" | "note";
export interface Item { kind: Kind; text: string; owner: string; due: string; topic: string; file: string; line: number; speaker?: string; transcript: boolean }
export interface Header { title: string; date: string; time: string; location: string; attendees: string[]; recorder: string }
export interface Parsed { header: Header; items: Item[] }

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const mk = (y: number, m: number, d: number) => { const x = new Date(Date.UTC(y, m - 1, d)); return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x : null; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const wd = (d: Date) => d.getUTCDay() || 7; // 周一=1 … 周日=7

const ZH_WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const EN_WD: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
const EN_MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ZH_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 找文本里的绝对日期（会议日期用） */
export function findDate(text: string): string {
  let m = /(20\d\d)\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
  if (m) { const d = mk(+m[1], +m[2], +m[3]); if (d) return iso(d); }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/i.exec(text);
  if (m) { const d = mk(+m[3], EN_MON[m[1].toLowerCase()], +m[2]); if (d) return iso(d); }
  m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d\d)\b/i.exec(text);
  if (m) { const d = mk(+m[3], EN_MON[m[2].toLowerCase()], +m[1]); if (d) return iso(d); }
  return "";
}

/** 截止日期：相对会议日期解析，返回 [日期, 命中的短语] */
export function findDue(text: string, meeting: string): [string, string] {
  const base = meeting ? new Date(meeting + "T00:00:00Z") : null;
  const t = text;
  let m = /(20\d\d)\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?/.exec(t);
  if (m) { const d = mk(+m[1], +m[2], +m[3]); if (d) return [iso(d), m[0]]; }
  const year = (mo: number, da: number) => {
    if (!base) return null;
    let d = mk(base.getUTCFullYear(), mo, da);
    if (d && d.getTime() < base.getTime() - 180 * 86400000) d = mk(base.getUTCFullYear() + 1, mo, da);
    return d;
  };
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(t);
  if (m) { const d = year(+m[1], +m[2]); if (d) return [iso(d), m[0]]; }
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(t) ?? null;
  if (m) { const d = year(EN_MON[m[1].toLowerCase()], +m[2]); if (d) return [iso(d), m[0]]; }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.exec(t);
  if (m) { const d = year(EN_MON[m[2].toLowerCase()], +m[1]); if (d) return [iso(d), m[0]]; }
  m = /(?:by|due|before|until)\s+(\d{1,2})\/(\d{1,2})\b|(?<![\d/])(\d{1,2})\/(\d{1,2})\s*(?:前|之前|before)/i.exec(t);
  if (m) { const d = year(+(m[1] ?? m[3]), +(m[2] ?? m[4])); if (d) return [iso(d), m[0]]; }
  if (!base) return ["", ""];
  const monday = addDays(base, 1 - wd(base));
  m = /(下下|下|本|这)?\s*(?:周|星期|礼拜)([一二三四五六日天])/.exec(t);
  if (m) {
    const x = ZH_WD[m[2]];
    const d = m[1] === "下下" ? addDays(monday, 13 + x) : m[1] === "下" ? addDays(monday, 6 + x) : m[1] ? addDays(monday, x - 1) : addDays(base, ((x - wd(base) + 7) % 7) || 7);
    return [iso(d), m[0]];
  }
  m = /\b(next|this)?\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*day\b|\b(next|this)?\s*(tues|wednes|thurs)day\b/i.exec(t);
  if (m) {
    const key = (m[2] ?? m[4]).slice(0, 3).toLowerCase(), x = EN_WD[key], q = (m[1] ?? m[3] ?? "").toLowerCase();
    const d = q === "next" ? addDays(monday, 6 + x) : q === "this" ? addDays(monday, x - 1) : addDays(base, ((x - wd(base) + 7) % 7) || 7);
    return [iso(d), m[0]];
  }
  if ((m = /明天|明日|\btomorrow\b/i.exec(t))) return [iso(addDays(base, 1)), m[0]];
  if ((m = /后天/.exec(t))) return [iso(addDays(base, 2)), m[0]];
  if ((m = /今天|今日|\btoday\b|\bEOD\b/i.exec(t))) return [iso(base), m[0]];
  if ((m = /本周内|这周内|\bEOW\b|end of (?:the )?week/i.exec(t))) return [iso(addDays(monday, 4)), m[0]];
  if ((m = /下周内|下周之内/.exec(t))) return [iso(addDays(monday, 11)), m[0]];
  if ((m = /月底|月末|\bend of (?:the )?month\b|\bEOM\b/i.exec(t))) return [iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0))), m[0]];
  if ((m = /([\d一二两三四五六七八九十]+)\s*(?:个)?(?:工作日|天)内|within\s+(\d+)\s+days?/i.exec(t))) {
    const n = m[2] ? +m[2] : /^\d+$/.test(m[1]) ? +m[1] : ZH_NUM[m[1]] ?? 0;
    if (n) return [iso(addDays(base, n)), m[0]];
  }
  return ["", ""];
}

const SECTION: [RegExp, Kind | "skip"][] = [
  [/议程|议题|agenda/i, "agenda"],
  [/行动|待办|任务|下一步|跟进事项|action|to-?do|next steps|follow-?ups?/i, "action"],
  [/决定|决议|结论|共识|decision|agreed|outcomes?/i, "decision"],
  [/问题|待定|待确认|open (?:questions|issues)|questions|parking lot/i, "question"],
];
const HEADER_KEYS: [RegExp, keyof Header][] = [
  [/^(?:日期|时间|会议时间|date|time|when)$/i, "date"],
  [/^(?:地点|会议地点|location|where|place|room)$/i, "location"],
  [/^(?:参会人|参会人员|与会人|与会者|出席|参加人员|attendees|participants|present)$/i, "attendees"],
  [/^(?:记录|记录人|纪要|note-?taker|minutes by|recorder|scribe)$/i, "recorder"],
  [/^(?:主题|会议主题|标题|subject|title|meeting)$/i, "title"],
];
export const splitNames = (s: string) => s.split(/[、，,;；/]|\s+and\s+|\s*&\s*/).map((x) => x.replace(/[（(][^）)]*[）)]/g, "").replace(/^\s*@/, "").trim()).filter((x) => x && x.length <= 30);

const ACTION_RE = /^\s*(?:[-*]\s*)?\[\s?\]|\bTODO\b|\bAction(?: item)?s?\s*[:：]|\bAI\s*[:：]|行动项|待办|负责|跟进|我来|我去|我会|\bI'?ll\b|\bI will\b|\bI can\b|can you|could you|\bplease\b|\bwill (?:send|update|share|prepare|draft|follow|check|fix|write|book|review)|^请|需要.{0,20}(?:前|之前)完成/i;
const DECISION_RE = /^(?:决定|决议|结论|共识|decision|agreed|resolved)\s*[:：]|决定|一致同意|同意|确定了|定下来|拍板|\bwe agreed\b|\bagreed\b|\bdecided\b|\bdecision\b/i;
const QUESTION_RE = /[？?]\s*$|待定|待确认|\bTBD\b|open question|还不确定/i;

export function cleanText(s: string) {
  return s.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/, "").replace(/^\[\s?\]\s*/, "").replace(/^\[[xX]\]\s*/, "").replace(/^(?:TODO|Action(?: item)?|AI|行动项|决定|决议|结论|Decision)\s*[:：]\s*/i, "").replace(/@(\S+?)(?=[\s，,：:]|$)/g, "$1").trim();
}

export function findOwner(text: string, names: string[], speaker?: string): string {
  let m = /@([\p{L}\p{N}_.-]+)/u.exec(text);
  if (m) { const n = names.find((x) => m![1].startsWith(x)); return n ?? m[1]; }
  m = /(?:负责人|owner|assignee|由)\s*[:：]?\s*([\p{L}·.]+)/iu.exec(text);
  if (m) { const n = names.find((x) => m![1].startsWith(x)); if (n) return n; if (/负责人|owner|assignee/i.test(m[0])) return m[1].slice(0, 12); }
  const hits = names.filter((n) => n !== speaker || !speaker).map((n) => ({ n, at: text.search(new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`, "iu")) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  if (hits.length) return hits[0].n;
  m = /^(?:[-*]\s*)?(?:\[\s?\]\s*)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|to|can|should|is going to)\b/.exec(text) ?? /^(?:[-*]\s*)?(?:\[\s?\]\s*)?([\u4e00-\u9fa5]{2,3})(?:负责|来负责|去|会在)/.exec(text);
  if (m && !/^(?:We|I|You|They|He|She|It|This|That|Someone|Everyone|我们|大家|我|你|他|她)$/.test(m[1])) return m[1];
  if (speaker && /我来|我去|我会|我负责|我这边|\bI'?ll\b|\bI will\b|\bI can\b|\blet me\b/i.test(text)) return speaker;
  if (speaker && names.includes(speaker) && /^(?:\s*)(?:我|I\b)/.test(text)) return speaker;
  return "";
}

const TRANSCRIPT_LINE = /^\s*(?:\[?\(?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\)?\s*)?([\p{L}][\p{L}\p{N} ._·-]{0,23}?)\s*[:：]\s*(.+)$/u;

export function parseNotes(files: { path: string; text: string }[], dateOverride?: string): Parsed {
  const header: Header = { title: "", date: "", time: "", location: "", attendees: [], recorder: "" };
  type Raw = { kind?: Kind; text: string; topic: string; file: string; line: number; speaker?: string; transcript: boolean; section?: Kind | null };
  const raws: Raw[] = [];
  const speakers: string[] = [];
  for (const f of files) {
    const lines = f.text.replace(/^\uFEFF/, "").split(/\r?\n/);
    // 是逐字稿吗：一半以上的非空行是 “名字: 话”
    const nonEmpty = lines.filter((l) => l.trim());
    const isHeaderKey = (k: string) => HEADER_KEYS.some(([re]) => re.test(k.trim()));
    const tl = nonEmpty.filter((l) => { const m = TRANSCRIPT_LINE.exec(l); return m && !isHeaderKey(m[2]) && !/^#/.test(l); }).length;
    const transcript = tl >= Math.max(3, nonEmpty.length * 0.5);
    let section: Kind | null = null, topic = "", inCode = false;
    lines.forEach((raw, idx) => {
      const line = raw.trimEnd();
      if (/^\s*```/.test(line)) { inCode = !inCode; return; }
      if (inCode || !line.trim()) return;
      const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line) ?? (/^\*\*([^*]{1,40})\*\*\s*[:：]?$/.test(line.trim()) ? [line, "##", line.trim().replace(/^\*\*|\*\*\s*[:：]?$/g, "")] : null);
      if (h) {
        const title = h[2].replace(/[:：]$/, "");
        if (h[1].length === 1 && !header.title) { header.title = title; return; }
        const sec = SECTION.find(([re]) => re.test(title));
        if (h[1].length <= 2) { section = sec ? (sec[1] as Kind) : null; topic = sec ? "" : title; }
        else topic = title;
        return;
      }
      // 头部字段 “日期：…”
      const kv = /^\s*(?:[-*]\s*)?\**([^:：*]{1,12})\**\s*[:：]\s*(.+)$/.exec(line);
      if (kv && !section) {
        const key = HEADER_KEYS.find(([re]) => re.test(kv[1].trim()));
        if (key) {
          const v = kv[2].trim(), k = key[1];
          if (k === "date") { header.date ||= findDate(v); const tm = /(\d{1,2}[:：]\d{2})(?:\s*[-–~至到]\s*(\d{1,2}[:：]\d{2}))?/.exec(v); if (tm) header.time ||= tm[0].replace(/：/g, ":").replace(/\s+/g, ""); }
          else if (k === "attendees") header.attendees.push(...splitNames(v));
          else if (k === "title") header.title ||= v;
          else (header[k] as string) ||= k === "recorder" ? splitNames(v)[0] ?? v : v;
          return;
        }
      }
      if (transcript) {
        const m = TRANSCRIPT_LINE.exec(line);
        if (!m) { if (!header.title && !raws.some((r) => r.file === f.path)) { header.title = line.trim(); header.date ||= findDate(line); } return; }
        const who = m[2].trim();
        if (!speakers.includes(who)) speakers.push(who);
        const said = m[3].trim();
        const ag = /^(?:.*?\b)?(?:agenda|议程|今天(?:主要)?(?:讨论|聊)(?:三件事|两件事|几件事)?)\s*(?:is|are)?\s*[:：]\s*(.+)$/i.exec(said);
        if (ag) { for (const a of ag[1].split(/[,，、;；]|\band\b/).map((x) => x.replace(/[.。]$/, "").trim()).filter(Boolean)) raws.push({ kind: "agenda", text: a, topic: "", file: f.path, line: idx + 1, speaker: who, transcript }); return; }
        raws.push({ text: said, topic, file: f.path, line: idx + 1, speaker: who, transcript, section });
        return;
      }
      if (!header.title && /^\S/.test(line) && !raws.length && line.length < 60 && !/^[-*\d]/.test(line)) { header.title = line.trim(); header.date ||= findDate(line); return; }
      raws.push({ text: line.trim(), topic, file: f.path, line: idx + 1, transcript, section });
    });
    if (!header.date) header.date = findDate(lines.slice(0, 15).join("\n"));
  }
  if (dateOverride) header.date = dateOverride;
  for (const s of speakers) if (!header.attendees.includes(s)) header.attendees.push(s);
  header.attendees = [...new Set(header.attendees)];
  const names = [...header.attendees].sort((a, b) => b.length - a.length);
  const items: Item[] = raws.map((r) => {
    const text = r.kind === "agenda" ? r.text : cleanText(r.text);
    let kind: Kind = r.kind ?? "note";
    const bare = r.text.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/, "");
    if (!r.kind) {
      if (r.section === "agenda") kind = "agenda";
      else if (r.section === "action") kind = "action";
      else if (r.section === "decision") kind = "decision";
      else if (r.section === "question") kind = "question";
      else if (ACTION_RE.test(bare) && !/^(?:决定|决议|结论|decision)\s*[:：]/i.test(bare)) kind = "action";
      else if (DECISION_RE.test(bare) && !/[？?]\s*$/.test(bare)) kind = "decision";
      else if (QUESTION_RE.test(bare)) kind = "question";
    }
    let owner = "", due = "";
    if (kind === "action") { owner = findOwner(r.text, names, r.speaker); due = findDue(r.text, header.date)[0]; }
    return { kind, text, owner, due, topic: r.topic, file: r.file, line: r.line, speaker: r.speaker, transcript: r.transcript };
  });
  return { header, items };
}
