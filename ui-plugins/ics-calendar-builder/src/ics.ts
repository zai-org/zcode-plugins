import { createHash } from "node:crypto";

export interface Ev {
  title: string; date: string; endDate: string; start: string; end: string; allDay: boolean;
  location: string; desc: string; reminders: number[]; rrule: string; category: string; url: string;
  /** 重复截止日（当地日期，用于显示）。 */
  until?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 某时区在某个 UTC 时刻的偏移（分钟）。 */
export function tzOffset(tz: string, utcMs: number): number {
  const v = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(utcMs)).find((p) => p.type === "timeZoneName")!.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(v);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
export function validTz(tz: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
/** 当地时间 → UTC 毫秒。 */
export function localToUtc(tz: string, date: string, minutes: number): number {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  let t = guess - tzOffset(tz, guess) * 60000;
  t = guess - tzOffset(tz, t) * 60000;
  return t;
}

const offStr = (m: number) => `${m < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`;
const localStamp = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`; };

/** 由 Intl 推出这几年的夏令时切换，生成 VTIMEZONE（每次切换写一条，不依赖规则）。 */
export function vtimezone(tz: string, fromYear: number, toYear: number): string[] {
  const start = Date.UTC(fromYear, 0, 1), end = Date.UTC(toYear + 1, 0, 1);
  const trans: { at: number; from: number; to: number }[] = [];
  let prev = tzOffset(tz, start);
  for (let t = start + 3600000 * 6; t <= end; t += 3600000 * 6) {
    const o = tzOffset(tz, t);
    if (o !== prev) {
      let lo = t - 3600000 * 6, hi = t;
      while (hi - lo > 60000) { const mid = Math.floor((lo + hi) / 2 / 60000) * 60000; if (tzOffset(tz, mid) === prev) lo = mid; else hi = mid; }
      trans.push({ at: hi, from: prev, to: o });
      prev = o;
    }
  }
  const L = ["BEGIN:VTIMEZONE", `TZID:${tz}`];
  if (!trans.length) {
    const o = tzOffset(tz, start);
    L.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${offStr(o)}`, `TZOFFSETTO:${offStr(o)}`, "END:STANDARD");
  } else {
    for (const x of trans) {
      const kind = x.to > x.from ? "DAYLIGHT" : "STANDARD";
      L.push(`BEGIN:${kind}`, `DTSTART:${localStamp(x.at + x.from * 60000)}`, `TZOFFSETFROM:${offStr(x.from)}`, `TZOFFSETTO:${offStr(x.to)}`, `END:${kind}`);
    }
  }
  L.push("END:VTIMEZONE");
  return L;
}

export const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** 按 75 字节折行（不拆开 UTF-8 字符）。 */
export function fold(line: string): string {
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

const WEEK: Record<string, string> = { 一: "MO", 二: "TU", 三: "WE", 四: "TH", 五: "FR", 六: "SA", 日: "SU", 天: "SU", mon: "MO", tue: "TU", wed: "WE", thu: "TH", fri: "FR", sat: "SA", sun: "SU" };
const NUM: Record<string, number> = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
/** “每周一三五 / 每两周 / 每月 / 工作日 / weekly / every 2 weeks” → RRULE（不含 COUNT/UNTIL）；无法识别返回 null。 */
export function parseRepeat(text: string): string | null | "" {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t || /^(不重复|无|none|no|once|-)$/.test(t)) return "";
  if (/工作日|weekdays?/.test(t)) return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  let m = /^每(?:隔)?([两二三四五六]|\d+)?个?(天|日|周|星期|礼拜|月|年)(.*)$/.exec(t);
  if (m) {
    const n = m[1] ? NUM[m[1]] ?? Number(m[1]) : 1;
    const freq = { 天: "DAILY", 日: "DAILY", 周: "WEEKLY", 星期: "WEEKLY", 礼拜: "WEEKLY", 月: "MONTHLY", 年: "YEARLY" }[m[2]]!;
    let r = `FREQ=${freq}${n > 1 ? `;INTERVAL=${n}` : ""}`;
    if (freq === "WEEKLY" && m[3]) {
      const days = [...m[3].replace(/[、，,和及\s]/g, "")].map((c) => WEEK[c]).filter(Boolean);
      if (days.length) r += `;BYDAY=${[...new Set(days)].join(",")}`;
    }
    return r;
  }
  m = /^(daily|weekly|monthly|yearly|annually)$/.exec(t);
  if (m) return `FREQ=${m[1] === "annually" ? "YEARLY" : m[1].toUpperCase()}`;
  m = /^every\s+(\d+)?\s*(day|week|month|year)s?(?:\s+on\s+(.+))?$/.exec(t);
  if (m) {
    const freq = { day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" }[m[2]]!;
    let r = `FREQ=${freq}${m[1] && Number(m[1]) > 1 ? `;INTERVAL=${m[1]}` : ""}`;
    if (m[3] && freq === "WEEKLY") { const days = m[3].split(/[\s,]+|and/).map((d) => WEEK[d.slice(0, 3)]).filter(Boolean); if (days.length) r += `;BYDAY=${days.join(",")}`; }
    return r;
  }
  return null;
}

/** “15分钟, 1小时, 1天, 提前2天, 30m, 1h” → 分钟数列表；无法识别的忽略。 */
export function parseReminders(text: string): number[] | null {
  const parts = String(text ?? "").split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (/^(无|不提醒|none|no)$/i.test(p)) continue;
    const m = /^(?:提前)?(\d+(?:\.\d+)?)\s*(分钟?|min(?:ute)?s?|m|小时|个小时|h(?:ours?)?|hr|天|日|d(?:ays?)?|周|w(?:eeks?)?)?$/i.exec(p);
    if (!m) return null;
    const n = Number(m[1]);
    const u = (m[2] ?? "分").toLowerCase();
    out.push(Math.round(/^(小时|个小时|h|hr|hour|hours)$/.test(u) ? n * 60 : /^(天|日|d|day|days)$/.test(u) ? n * 1440 : /^(周|w|week|weeks)$/.test(u) ? n * 10080 : n));
  }
  return out;
}
const trigger = (m: number) => (m % 1440 === 0 ? `-P${m / 1440}D` : m % 60 === 0 ? `-PT${m / 60}H` : `-PT${m}M`);

export const uidOf = (e: Ev, cal: string) => `${createHash("sha1").update(`${cal}|${e.title}|${e.date}|${e.start}`).digest("hex").slice(0, 20)}@ics-calendar-builder`;
const dateOnly = (d: string) => d.replace(/-/g, "");
export function addDay(date: string, n = 1) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export function buildIcs(events: Ev[], o: { calName: string; tz: string; stamp?: string }): string {
  const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Penova//ics-calendar-builder 0.1//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (o.calName) L.push(`X-WR-CALNAME:${esc(o.calName)}`);
  L.push(`X-WR-TIMEZONE:${o.tz}`);
  const timed = events.filter((e) => !e.allDay);
  if (timed.length) {
    const years = timed.flatMap((e) => [Number(e.date.slice(0, 4)), Number((e.endDate || e.date).slice(0, 4))]);
    const repeats = timed.some((e) => e.rrule);
    L.push(...vtimezone(o.tz, Math.min(...years), Math.max(...years) + (repeats ? 2 : 0)));
  }
  const stamp = o.stamp ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  for (const e of events) {
    L.push("BEGIN:VEVENT", `UID:${uidOf(e, o.calName)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      L.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${dateOnly(addDay(e.endDate && e.endDate >= e.date ? e.endDate : e.date))}`);
    } else {
      const sm = toMin(e.start)!;
      const endDate = e.endDate || e.date;
      const em = toMin(e.end) ?? sm + 60;
      const fmtLocal = (d: string, m: number) => `${dateOnly(d)}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
      const ed = em <= sm && endDate === e.date ? addDay(e.date) : endDate; // 跨零点
      L.push(`DTSTART;TZID=${o.tz}:${fmtLocal(e.date, sm)}`, `DTEND;TZID=${o.tz}:${fmtLocal(ed, em)}`);
    }
    L.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) L.push(`LOCATION:${esc(e.location)}`);
    if (e.desc) L.push(`DESCRIPTION:${esc(e.desc)}`);
    if (e.category) L.push(`CATEGORIES:${esc(e.category)}`);
    if (e.url) L.push(`URL:${e.url}`);
    if (e.rrule) L.push(`RRULE:${e.rrule}`);
    for (const m of e.reminders) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${trigger(m)}`, "END:VALARM");
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
