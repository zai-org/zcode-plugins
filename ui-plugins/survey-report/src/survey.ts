// 问卷分析：题型识别、统计、交叉分析（纯函数）
export type QType = "single" | "multi" | "rating" | "nps" | "number" | "text" | "skip";
export const QTYPES: QType[] = ["single", "multi", "rating", "nps", "number", "text", "skip"];

export const SPLIT = /\s*(?:┋|\||;|；|、|\n|,|，)\s*/;
const SKIP_HEADER = /^(序号|编号|答卷编号|id|编号id|用户id|用户|提交时间|提交答卷时间|开始时间|结束时间|答题时间|填写时间|所用时间|作答时长|时间|timestamp|time|date|日期|ip|ip地址|来源|来自|来源详情|总分|得分|姓名|name|email|邮箱|电子邮件|手机|手机号|电话|微信|response id|respondent id)$/i;
const isNum = (v: string) => /^-?\d+(\.\d+)?$/.test(v);
const isDate = (v: string) => /^\d{4}[-/年.]\d{1,2}([-/月.]\d{1,2})?/.test(v);

export function cleanLabel(header: string): string {
  return header.replace(/^\s*(?:第\s*\d+\s*题|Q\s*\d+|\d+)\s*[.、:：)）\-]?\s*/i, "").trim() || header.trim();
}

export function detectType(header: string, values: string[]): QType {
  const vs = values.map((v) => v.trim()).filter(Boolean);
  const h = header.trim().toLowerCase().replace(/[\s:：]/g, "");
  if (SKIP_HEADER.test(h)) return "skip";
  if (!vs.length) return "text";
  if (vs.filter(isDate).length >= vs.length * 0.8) return "skip";
  if (vs.every(isNum)) {
    const ns = vs.map(Number), min = Math.min(...ns), max = Math.max(...ns), ints = ns.every(Number.isInteger);
    if (ints && min >= 0 && max <= 10 && (/推荐|recommend|nps|0-10|0～10|0到10/.test(h) || (max === 10 && min <= 6 && /可能|likely/.test(h)))) return "nps";
    if (ints && min >= 0 && max <= 10 && new Set(ns).size <= 11 && !(new Set(ns).size === vs.length && vs.length > 11)) return "rating";
    return "number";
  }
  const withSep = vs.filter((v) => SPLIT.test(v)).length;
  if (withSep >= vs.length * 0.15) {
    // 多选：同一个选项出现在不同的回答里（文字题即使整句重复，分出来的片段也不会跨回答共用）
    const seenIn = new Map<string, number>();
    for (const v of new Set(vs)) for (const tok of new Set(v.split(SPLIT).filter(Boolean))) seenIn.set(tok, (seenIn.get(tok) ?? 0) + 1);
    const distinct = seenIn.size, shared = [...seenIn.values()].filter((c) => c >= 2).length;
    if (distinct <= 25 && shared >= distinct * 0.5) return "multi";
  }
  const distinct = new Set(vs).size;
  if (distinct <= 15 && distinct <= Math.max(2, vs.length * 0.6)) return "single";
  return "text";
}

export interface Opt { label: string; count: number; pct: number }
export interface QResult {
  type: QType; answered: number; options: Opt[]; mean?: number; median?: number; min?: number; max?: number;
  nps?: { score: number; promoters: number; passives: number; detractors: number };
  topBox?: number; scale?: [number, number]; texts?: string[]; ignored: number; mentions?: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number) => (b ? r1((a / b) * 100) : 0);
const OTHER = /^(其他|其它|other|others)$/i;

function scaleOf(ns: number[]): [number, number] {
  const max = Math.max(...ns, 0), min = Math.min(...ns);
  const top = max <= 5 ? 5 : max <= 7 ? 7 : 10;
  return [min === 0 ? 0 : 1, top];
}

export function analyze(type: QType, values: string[], o: { sort?: "count" | "original"; scale?: [number, number] } = {}): QResult {
  const vs = values.map((v) => String(v ?? "").trim());
  const ans = vs.filter(Boolean);
  if (type === "skip") return { type, answered: ans.length, options: [], ignored: 0 };
  if (type === "text") return { type, answered: ans.length, options: [], texts: ans, ignored: 0 };
  if (type === "single" || type === "multi") {
    const counts = new Map<string, number>();
    let mentions = 0;
    for (const v of ans) {
      const toks = type === "multi" ? [...new Set(v.split(SPLIT).filter(Boolean))] : [v];
      for (const t of toks) { counts.set(t, (counts.get(t) ?? 0) + 1); mentions++; }
    }
    let opts = [...counts].map(([label, count]) => ({ label, count, pct: pct(count, ans.length) }));
    if (o.sort !== "original") opts = opts.sort((a, b) => Number(OTHER.test(a.label)) - Number(OTHER.test(b.label)) || b.count - a.count);
    return { type, answered: ans.length, options: opts, ignored: 0, mentions };
  }
  const nums = ans.filter(isNum).map(Number);
  const ignored = ans.length - nums.length;
  const n = nums.length;
  const sorted = [...nums].sort((a, b) => a - b);
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
  const base: QResult = { type, answered: n, options: [], mean: Math.round((n ? nums.reduce((a, b) => a + b, 0) / n : 0) * 100) / 100, median, min: sorted[0], max: sorted[n - 1], ignored };
  if (type === "nps") {
    const p = nums.filter((x) => x >= 9).length, d = nums.filter((x) => x <= 6).length;
    base.scale = [0, 10];
    base.options = Array.from({ length: 11 }, (_, i) => ({ label: String(i), count: nums.filter((x) => x === i).length, pct: pct(nums.filter((x) => x === i).length, n) }));
    base.nps = { score: Math.round(pct(p, n) - pct(d, n)), promoters: pct(p, n), passives: pct(n - p - d, n), detractors: pct(d, n) };
    return base;
  }
  if (type === "rating") {
    const [lo, hi] = o.scale ?? scaleOf(nums.length ? nums : [1, 5]);
    base.scale = [lo, hi];
    base.options = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((v) => ({ label: String(v), count: nums.filter((x) => x === v).length, pct: pct(nums.filter((x) => x === v).length, n) }));
    const top = hi - lo >= 4 ? 2 : 1;
    base.topBox = pct(nums.filter((x) => x > hi - top).length, n);
    return base;
  }
  // number：五段直方图
  if (n) {
    const lo = sorted[0], hi = sorted[n - 1], w = hi > lo ? (hi - lo) / 5 : 1;
    base.options = Array.from({ length: hi > lo ? 5 : 1 }, (_, i) => {
      const a = lo + i * w, b = i === 4 ? hi : lo + (i + 1) * w;
      const c = nums.filter((x) => x >= a && (i === 4 || hi === lo ? x <= b : x < b)).length;
      return { label: hi > lo ? `${+a.toFixed(2)}–${+b.toFixed(2)}` : String(lo), count: c, pct: pct(c, n) };
    });
  }
  return base;
}

export interface Cross { groups: { label: string; n: number }[]; rows: { label: string; cells: { count?: number; pct: number; value?: number }[] }[]; kind: "dist" | "mean" | "nps" }

/** 按分组题（单选）交叉分析目标题。 */
export function crossTab(groupVals: string[], groups: string[], type: QType, values: string[], o: { sort?: "count" | "original"; scale?: [number, number] } = {}): Cross | undefined {
  if (type === "text" || type === "skip") return undefined;
  const per = groups.map((g) => values.filter((_, i) => groupVals[i]?.trim() === g));
  const res = per.map((vs) => analyze(type, vs, o));
  const gs = groups.map((g, i) => ({ label: g, n: res[i].answered }));
  if (type === "single" || type === "multi") {
    const all = analyze(type, values, o).options.map((x) => x.label);
    return { kind: "dist", groups: gs, rows: all.map((label) => ({ label, cells: res.map((r) => { const x = r.options.find((y) => y.label === label); return { count: x?.count ?? 0, pct: x?.pct ?? 0 }; }) })) };
  }
  if (type === "nps") return { kind: "nps", groups: gs, rows: [{ label: "NPS", cells: res.map((r) => ({ pct: 0, value: r.nps?.score ?? 0 })) }, { label: "推荐者 Promoters %", cells: res.map((r) => ({ pct: r.nps?.promoters ?? 0 })) }, { label: "贬损者 Detractors %", cells: res.map((r) => ({ pct: r.nps?.detractors ?? 0 })) }] };
  const rows: Cross["rows"] = [{ label: "平均 Mean", cells: res.map((r) => ({ pct: 0, value: r.mean ?? 0 })) }];
  if (type === "rating") rows.push({ label: "高分占比 Top box %", cells: res.map((r) => ({ pct: r.topBox ?? 0 })) });
  return { kind: "mean", groups: gs, rows };
}
