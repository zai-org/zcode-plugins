/** 固定资产折旧：直线法、双倍余额递减法（最后两年改直线）、年数总和法；按月计提，当月购入次月开始。 */
export type Method = "straight" | "ddb" | "syd";

export function methodOf(v: string): Method | null {
  const t = v.trim().toLowerCase();
  if (!t || /直线|平均|年限平均|straight|sl/.test(t)) return "straight";
  if (/双倍|余额|ddb|declining/.test(t)) return "ddb";
  if (/年数总和|总和|syd|sum/.test(t)) return "syd";
  return null;
}
export const METHOD_ZH: Record<Method, string> = { straight: "年限平均法", ddb: "双倍余额递减法", syd: "年数总和法" };

/** 每月折旧额，下标 0 = 购入次月。 */
export function monthly(cost: number, residual: number, years: number, method: Method): number[] {
  const n = Math.round(years * 12), base = cost - residual, out: number[] = [];
  if (n <= 0 || base <= 0) return [];
  if (method === "straight") { for (let i = 0; i < n; i++) out.push(base / n); return out; }
  const Y = Math.ceil(years), yearly: number[] = [];
  if (method === "syd") { const sum = (Y * (Y + 1)) / 2; for (let k = 1; k <= Y; k++) yearly.push((base * (Y - k + 1)) / sum); }
  else if (Y <= 2) { for (let k = 0; k < Y; k++) yearly.push(base / Y); }
  else {
    let nbv = cost;
    for (let k = 1; k <= Y - 2; k++) { const d = (nbv * 2) / Y; yearly.push(d); nbv -= d; }
    const last = (nbv - residual) / 2; yearly.push(last, last);
  }
  for (let i = 0; i < n; i++) out.push(yearly[Math.floor(i / 12)] / 12);
  return out;
}

/** 两个日期之间已计提的月数（购入当月不提）。 */
export function monthsElapsed(bought: string, asOf: string): number {
  const [by, bm] = bought.split("-").map(Number), [ay, am] = asOf.split("-").map(Number);
  return Math.max(0, ay * 12 + am - (by * 12 + bm));
}

/** 每个自然年的折旧额。 */
export function byCalendarYear(bought: string, m: number[]): Map<number, number> {
  const [by, bmo] = bought.split("-").map(Number), out = new Map<number, number>();
  m.forEach((v, i) => { const idx = by * 12 + (bmo - 1) + 1 + i, y = Math.floor(idx / 12); out.set(y, (out.get(y) ?? 0) + v); });
  return out;
}

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
