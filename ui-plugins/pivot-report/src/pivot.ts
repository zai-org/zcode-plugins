import { num } from "./kit/columns.ts";

export type Agg = "sum" | "count" | "avg" | "min" | "max" | "distinct";
export type DateGroup = "none" | "day" | "week" | "month" | "quarter" | "year";

export function dateKey(v: string, g: DateGroup): string {
  if (g === "none") return v;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v;
  if (g === "day") return m[0];
  if (g === "month") return `${m[1]}-${m[2]}`;
  if (g === "quarter") return `${m[1]}-Q${Math.ceil(Number(m[2]) / 3)}`;
  if (g === "year") return m[1];
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const w = 1 + Math.floor((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 / 7);
  return `${y}-W${String(Math.floor(w)).padStart(2, "0")}`;
}

class Acc {
  n = 0; sum = 0; min = Infinity; max = -Infinity; set = new Set<string>();
  add(raw: string) {
    this.set.add(raw);
    const x = num(raw);
    this.n++;
    if (!isNaN(x)) { this.sum += x; this.min = Math.min(this.min, x); this.max = Math.max(this.max, x); }
  }
  value(a: Agg) {
    if (a === "count") return this.n;
    if (a === "distinct") return this.set.size;
    if (!this.n) return 0;
    if (a === "avg") return Math.round((this.sum / this.n) * 100) / 100;
    if (a === "min") return this.min === Infinity ? 0 : this.min;
    if (a === "max") return this.max === -Infinity ? 0 : this.max;
    return Math.round(this.sum * 100) / 100;
  }
}

export interface PivotSpec { rows: number[]; col: number; value: number; agg: Agg; dateGroup: DateGroup; dateCols: Set<number>; topN: number; sort: "label" | "value" }
export interface Pivot { rowKeys: string[][]; colKeys: string[]; cells: number[][]; rowTotals: number[]; colTotals: number[]; total: number; others: number }

export function pivot(data: string[][], s: PivotSpec): Pivot {
  const key = (r: string[], c: number) => { const v = (r[c] ?? "").trim() || "(空)"; return s.dateCols.has(c) ? dateKey(v, s.dateGroup) : v; };
  const cells = new Map<string, Map<string, Acc>>();
  const rowAcc = new Map<string, Acc>(), colAcc = new Map<string, Acc>(), all = new Acc();
  for (const r of data) {
    const rk = JSON.stringify(s.rows.map((c) => key(r, c)));
    const ck = s.col >= 0 ? key(r, s.col) : "";
    const v = s.value >= 0 ? r[s.value] ?? "" : "1";
    if (!cells.has(rk)) cells.set(rk, new Map());
    const row = cells.get(rk)!;
    if (!row.has(ck)) row.set(ck, new Acc());
    row.get(ck)!.add(v);
    if (!rowAcc.has(rk)) rowAcc.set(rk, new Acc());
    rowAcc.get(rk)!.add(v);
    if (!colAcc.has(ck)) colAcc.set(ck, new Acc());
    colAcc.get(ck)!.add(v);
    all.add(v);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, "zh", { numeric: true });
  let rowKeys = [...cells.keys()];
  if (s.sort === "value") rowKeys.sort((a, b) => rowAcc.get(b)!.value(s.agg) - rowAcc.get(a)!.value(s.agg));
  else rowKeys.sort((a, b) => { const x = JSON.parse(a) as string[], y = JSON.parse(b) as string[]; for (let i = 0; i < x.length; i++) { const c = cmp(x[i], y[i]); if (c) return c; } return 0; });
  let others = 0;
  if (s.topN > 0 && rowKeys.length > s.topN) { others = rowKeys.length - s.topN; rowKeys = rowKeys.slice(0, s.topN); }
  const colKeys = [...colAcc.keys()].sort(cmp);
  return {
    rowKeys: rowKeys.map((k) => JSON.parse(k)),
    colKeys,
    cells: rowKeys.map((rk) => colKeys.map((ck) => cells.get(rk)!.get(ck)?.value(s.agg) ?? 0)),
    rowTotals: rowKeys.map((rk) => rowAcc.get(rk)!.value(s.agg)),
    colTotals: colKeys.map((ck) => colAcc.get(ck)!.value(s.agg)),
    total: all.value(s.agg),
    others,
  };
}
