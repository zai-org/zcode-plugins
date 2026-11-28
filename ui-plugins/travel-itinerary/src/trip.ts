/** 时区、日期、时间解析：只用 Node 自带的 Intl（ICU），不联网。 */

const CITY: Record<string, string> = {
  北京: "Asia/Shanghai", 上海: "Asia/Shanghai", 广州: "Asia/Shanghai", 深圳: "Asia/Shanghai", 成都: "Asia/Shanghai", 杭州: "Asia/Shanghai", 中国: "Asia/Shanghai", 北京时间: "Asia/Shanghai",
  香港: "Asia/Hong_Kong", 澳门: "Asia/Macau", 台北: "Asia/Taipei", 东京: "Asia/Tokyo", 大阪: "Asia/Tokyo", 京都: "Asia/Tokyo", 日本: "Asia/Tokyo",
  首尔: "Asia/Seoul", 韩国: "Asia/Seoul", 曼谷: "Asia/Bangkok", 泰国: "Asia/Bangkok", 新加坡: "Asia/Singapore", 吉隆坡: "Asia/Kuala_Lumpur", 迪拜: "Asia/Dubai",
  伦敦: "Europe/London", 巴黎: "Europe/Paris", 柏林: "Europe/Berlin", 罗马: "Europe/Rome", 纽约: "America/New_York", 洛杉矶: "America/Los_Angeles", 旧金山: "America/Los_Angeles",
  温哥华: "America/Vancouver", 多伦多: "America/Toronto", 悉尼: "Australia/Sydney", 墨尔本: "Australia/Melbourne", 奥克兰: "Pacific/Auckland",
};

export type Tz = { kind: "iana"; id: string } | { kind: "fixed"; min: number };

export function parseTz(v: string): Tz | null {
  const t = v.trim();
  if (!t) return null;
  if (CITY[t]) return { kind: "iana", id: CITY[t] };
  const m = /^(?:UTC|GMT)?\s*([+-−])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (m) return { kind: "fixed", min: (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0)) };
  if (/^(UTC|GMT|Z)$/i.test(t)) return { kind: "fixed", min: 0 };
  try { new Intl.DateTimeFormat("en-US", { timeZone: t }); return { kind: "iana", id: t }; } catch { return null; }
}

/** tz 在某个 UTC 时刻的偏移（分钟）。 */
export function offsetAt(tz: Tz, utcMs: number): number {
  if (tz.kind === "fixed") return tz.min;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz.id, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

/** 当地日期 + 时间 → UTC 毫秒。 */
export function localToUtc(date: string, minutes: number, tz: Tz): number {
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d) + minutes * 60000;
  let off = offsetAt(tz, guess - offsetAt(tz, guess) * 60000);
  return guess - off * 60000;
}

export const fmtOffset = (min: number) => `UTC${min < 0 ? "-" : "+"}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, "0")}` : ""}`;

/** “2026-12-18”“2026/12/18”“12月18日”（借年份）、Excel 日期 → YYYY-MM-DD；读不懂返回 null。 */
export function parseDate(v: unknown, year?: number): string | null {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const t = String(v ?? "").trim();
  if (!t) return null;
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t);
  if (!m && year) { const k = /^(\d{1,2})[-/.月](\d{1,2})日?$/.exec(t); if (k) m = ["", String(year), k[1], k[2]] as unknown as RegExpExecArray; }
  if (!m && /^\d{5}$/.test(t)) return new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000).toISOString().slice(0, 10);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** “08:55”“8:55”“0855”“8点半”；+1 / 次日 表示第二天 → {min, plus}；空返回 undefined；读不懂返回 null。 */
export function parseTime(v: unknown): { min: number; plus: number } | null | undefined {
  if (v instanceof Date && !isNaN(+v)) return { min: v.getUTCHours() * 60 + v.getUTCMinutes(), plus: 0 };
  let t = String(v ?? "").trim();
  if (!t) return undefined;
  let plus = 0;
  const pm = /\s*(?:\(\s*)?(?:\+(\d)|次日|第二天)\s*\)?\s*/.exec(t);
  if (pm) { plus = pm[1] ? Number(pm[1]) : 1; t = t.replace(pm[0], "").trim(); }
  if (/^0?\.\d+$/.test(t)) { const m = Math.round(Number(t) * 1440); return { min: m, plus }; }
  let m = /^(\d{1,2})[:：](\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (m) { const h = +m[1], mi = +m[2]; if (h > 23 || mi > 59) return null; return { min: h * 60 + mi, plus }; }
  m = /^(\d{1,2})点(半|(\d{1,2})分?)?$/.exec(t);
  if (m) { const h = +m[1]; if (h > 23) return null; return { min: h * 60 + (m[2] === "半" ? 30 : Number(m[3] || 0)), plus }; }
  return null;
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const WK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const weekday = (date: string) => WK[new Date(`${date}T00:00:00Z`).getUTCDay()];
/** UTC 毫秒在某时区的当地日期和时间。 */
export function utcToLocal(ms: number, tz: Tz) { const d = new Date(ms + offsetAt(tz, ms) * 60000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
export const fmtDur = (min: number) => `${min < 0 ? "-" : ""}${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, "0")}`;

export type Kind = "flight" | "train" | "transfer" | "hotel" | "activity" | "meal" | "other";
function classify(t: string): Kind {
  if (/航班|飞机|flight|机票|起飞/.test(t)) return "flight";
  if (/酒店|住宿|民宿|hotel|airbnb|hostel|入住|旅馆/.test(t)) return "hotel";
  if (/火车|高铁|动车|新干线|列车|train|rail/.test(t)) return "train";
  if (/交通|接送|打车|巴士|大巴|地铁|transfer|taxi|bus|租车|轮渡|ferry|特快/.test(t)) return "transfer";
  if (/餐|饭|吃|meal|dinner|lunch|breakfast|restaurant/.test(t)) return "meal";
  if (/活动|景点|游览|参观|门票|activity|tour|visit|museum|乐园|影城|游玩/.test(t)) return "activity";
  return "other";
}
/** 类型列优先；类型列为空时看标题（含航班号如 MU523 视为航班）。 */
export function kindOf(v: string, title = ""): Kind {
  if (v.trim()) return classify(v.toLowerCase());
  if (/\b[A-Z0-9]{2}\s?\d{2,4}\b/.test(title) && /→|-|到|飞/.test(title)) return "flight";
  return classify(title.toLowerCase());
}
export const KIND_ZH: Record<Kind, string> = { flight: "航班", train: "火车", transfer: "交通", hotel: "住宿", activity: "游玩", meal: "用餐", other: "其他" };
