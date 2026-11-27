/** 工时解析、取整、费率匹配 */
const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(v: string): string {
  const t = v.trim();
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t); // 美式 M/D/YYYY
  if (m) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(t); // 欧式 D.M.YYYY
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  if (/^\d{5}(\.\d+)?$/.test(t)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86400000); return d.toISOString().slice(0, 10); }
  return "";
}

/** 时刻 → 当天分钟数 */
export function parseClock(v: string): number | null {
  const t = v.trim();
  const all = [...t.matchAll(/(\d{1,2})[:：](\d{2})(?::\d{2})?/g)];
  let h: number, mi: number;
  if (all.length) { const m = all[all.length - 1]; h = +m[1]; mi = +m[2]; }
  else { const m = /^(\d{1,2})\s*(am|pm)$/i.exec(t); if (!m) return null; h = +m[1]; mi = 0; }
  if (/pm|下午|晚上/i.test(t) && h < 12) h += 12;
  if (/am|上午|凌晨/i.test(t) && h === 12) h = 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

/** 时长 → 小时；识别 1.5 / 1,5 / 1:30 / 1h30m / 90m / 1小时30分 / PT1H30M */
export function parseHours(v: string): number | null {
  const t = v.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let m = /^(\d+)[:：](\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (m) return +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
  m = /^pt(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/.exec(t);
  if (m && (m[1] || m[2] || m[3])) return +(m[1] ?? 0) + +(m[2] ?? 0) / 60 + +(m[3] ?? 0) / 3600;
  m = /^(?:(\d+(?:[.,]\d+)?)(?:h|hr|hrs|hours?|小时|时|个小时))?(?:(\d+(?:[.,]\d+)?)(?:m|min|mins|minutes?|分钟|分))?$/.exec(t);
  if (m && (m[1] || m[2])) return +(m[1] ?? "0").replace(",", ".") + +(m[2] ?? "0").replace(",", ".") / 60;
  m = /^(\d+(?:[.,]\d+)?)$/.exec(t);
  if (m) return +m[1].replace(",", ".");
  return null;
}

export type Rounding = "none" | "up6" | "up15" | "near15" | "up30" | "up60";
export const ROUNDINGS: { value: Rounding; zh: string; en: string; step: number; up: boolean }[] = [
  { value: "none", zh: "不取整", en: "No rounding", step: 0, up: false },
  { value: "up6", zh: "向上取整到 6 分钟（0.1 小时）", en: "Up to 6 min (0.1 h)", step: 6, up: true },
  { value: "up15", zh: "向上取整到 15 分钟", en: "Up to 15 min", step: 15, up: true },
  { value: "near15", zh: "四舍五入到 15 分钟", en: "Nearest 15 min", step: 15, up: false },
  { value: "up30", zh: "向上取整到 30 分钟", en: "Up to 30 min", step: 30, up: true },
  { value: "up60", zh: "向上取整到 1 小时", en: "Up to 1 hour", step: 60, up: true },
];
export function roundHours(h: number, mode: Rounding): number {
  const r = ROUNDINGS.find((x) => x.value === mode);
  if (!r || !r.step) return Math.round(h * 100) / 100;
  const min = Math.round(h * 60 * 1000) / 1000;
  const n = r.up ? Math.ceil(min / r.step - 1e-9) : Math.round(min / r.step);
  return Math.round(((n * r.step) / 60) * 10000) / 10000;
}

/** 费率表：每行 “客户 = 300”“客户/项目 = 360”“@成员 = 200”；越具体越优先 */
export interface RateRule { client: string; project: string; person: string; rate: number; line: number }
export function parseRates(text: string): { rules: RateRule[]; bad: number[] } {
  const rules: RateRule[] = [], bad: number[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = /^(.+?)\s*[=:：]\s*[^\d-]*?(\d+(?:\.\d+)?)\s*(?:\/\s*h|\/\s*小时|元|每小时)?\s*$/.exec(line);
    if (!m) { bad.push(i + 1); return; }
    const key = m[1].trim();
    if (key.startsWith("@")) rules.push({ client: "", project: "", person: key.slice(1).trim(), rate: +m[2], line: i + 1 });
    else { const [c, p] = key.split(/\s*[/／>]\s*/); rules.push({ client: c ?? "", project: p ?? "", person: "", rate: +m[2], line: i + 1 }); }
  });
  return { rules, bad };
}
const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export function rateFor(rules: RateRule[], e: { client: string; project: string; person: string }, fallback: number): { rate: number; from: string } {
  const pick = (f: (r: RateRule) => boolean) => rules.find(f);
  let r = pick((x) => !!x.project && !!x.client && eq(x.client, e.client) && eq(x.project, e.project));
  if (r) return { rate: r.rate, from: `${r.client}/${r.project}` };
  r = pick((x) => !!x.client && !x.project && eq(x.client, e.client));
  if (r) return { rate: r.rate, from: r.client };
  r = pick((x) => !!x.person && eq(x.person, e.person));
  if (r) return { rate: r.rate, from: `@${r.person}` };
  r = pick((x) => x.client === "*" || x.client === "默认" || eq(x.client, "default"));
  if (r) return { rate: r.rate, from: "default" };
  return { rate: fallback, from: fallback ? "default" : "" };
}
export const hm = (h: number) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
