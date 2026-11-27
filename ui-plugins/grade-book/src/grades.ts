// 成绩计算：满分、权重、分数段、排名（纯函数）
export const ABSENT = /^(缺考|缺|缺席|请假|免考|absent|abs|ab|ex|exempt|-|—|–|\/|n\/a|na)$/i;

export type Score = { kind: "ok"; value: number } | { kind: "absent" } | { kind: "bad"; raw: string };

export function parseScore(v: unknown): Score {
  if (typeof v === "number") return Number.isFinite(v) ? { kind: "ok", value: v } : { kind: "bad", raw: String(v) };
  const t = String(v ?? "").trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/分$/, "");
  if (!t || ABSENT.test(t)) return { kind: "absent" };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { kind: "ok", value: Number(t) };
  return { kind: "bad", raw: t };
}

/** “数学=150; 英语=120” 或 “150”（全部）。 */
export function parseKeyNums(text: string): { all?: number; map: Map<string, number>; errors: string[] } {
  const map = new Map<string, number>(), errors: string[] = [];
  let all: number | undefined;
  for (const part of String(text ?? "").split(/[;；\n,，]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*[=:：]\s*([\d.]+)$/) ?? part.match(/^(.+?)\s+([\d.]+)$/);
    if (m) map.set(m[1].trim(), Number(m[2]));
    else if (/^[\d.]+$/.test(part)) all = Number(part);
    else errors.push(part);
  }
  return { all, map, errors };
}

export function autoFull(values: number[]): number {
  const max = Math.max(0, ...values);
  for (const f of [10, 20, 50, 100, 120, 150]) if (max <= f) return f;
  return Math.ceil(max / 10) * 10;
}

export interface Band { name: string; min: number }
/** “优秀 85; 良好 75; 及格 60; 不及格 0”（满分的百分比），从高到低。 */
export function parseBands(text: string): Band[] {
  const out: Band[] = [];
  for (const part of String(text ?? "").split(/[;；\n,，]/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s*[=:：≥>]*\s*([\d.]+)\s*%?$/);
    if (m) out.push({ name: m[1].trim(), min: Number(m[2]) });
  }
  out.sort((a, b) => b.min - a.min);
  if (!out.length || out[out.length - 1].min > 0) out.push({ name: out.length ? "其他" : "—", min: 0 });
  return out;
}
export const bandOf = (pct: number, bands: Band[]) => (bands.find((b) => pct >= b.min - 1e-9) ?? bands[bands.length - 1]).name;

/** 竞赛排名：1, 2, 2, 4。值相同名次相同；undefined 不排。 */
export function rank(values: (number | undefined)[]): (number | undefined)[] {
  const sorted = values.filter((v): v is number => v !== undefined).sort((a, b) => b - a);
  return values.map((v) => (v === undefined ? undefined : sorted.findIndex((x) => Math.abs(x - v) < 1e-9) + 1));
}

export interface Stat { n: number; mean: number; max: number; min: number; median: number; sd: number; pass: number; excellent: number; absent: number }
export function stats(values: number[], full: number, passPct: number, excPct: number, absent = 0): Stat {
  const n = values.length;
  if (!n) return { n: 0, mean: 0, max: 0, min: 0, median: 0, sd: 0, pass: 0, excellent: 0, absent };
  const s = [...values].sort((a, b) => a - b), mean = values.reduce((a, b) => a + b, 0) / n;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    n, mean: r2(mean), max: s[n - 1], min: s[0], median: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
    sd: r2(Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)),
    pass: r2((values.filter((v) => (v / full) * 100 >= passPct - 1e-9).length / n) * 100),
    excellent: r2((values.filter((v) => (v / full) * 100 >= excPct - 1e-9).length / n) * 100), absent,
  };
}

/** 分数段（按满分百分比，每 10%）：[0,60) 合并为一段。 */
export function histogram(values: number[], full: number): { label: string; count: number }[] {
  const edges = [0, 60, 70, 80, 90, 100.0001];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const a = Math.round((lo / 100) * full), b = Math.round((Math.min(hi, 100) / 100) * full);
    return { label: i === 0 ? `<${b}` : i === edges.length - 2 ? `${a}–${b}` : `${a}–${b - 1}`, count: values.filter((v) => { const p = (v / full) * 100; return p >= lo - 1e-9 && p < hi - 1e-9; }).length };
  });
}
