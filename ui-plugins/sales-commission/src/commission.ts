// 提成计算核心：金额按“分”取整分配，保证明细合计等于个人合计。
export interface Tier { from: number; to: number; rate: number }
export interface SpecialRate { match: string; rate: number }
export interface Sale { row: number; date: string; person: string; order: string; product: string; category: string; amount: number; refund: boolean }
export interface LineResult { row: number; kind: "tier" | "special" | "refund" | "special-refund" | "skip"; rate: number; commission: number }
export interface PersonResult {
  person: string; sales: number; refunds: number; tierBase: number; tierCommission: number; specialSales: number; specialCommission: number;
  clawback: number; total: number; topRate: number; breakdown: { tier: Tier; amount: number; commission: number }[]; lines: number[];
}

const unit = (s: string) => (/万/.test(s) ? 10000 : /k$/i.test(s) ? 1000 : /w$/i.test(s) ? 10000 : 1);
export function amountOf(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$|^（.*）$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const u = unit(s);
  s = s.replace(/[¥￥$€£,，\s元万]|RMB|CNY|USD/gi, "").replace(/[kw]$/i, "");
  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  const n = Number(s) * u;
  return neg ? -n : n;
}
const num = (s: string) => amountOf(s.replace(/以上|及以上|起|\+$/g, ""));
const pct = (s: string) => { const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(s.trim()); return m ? Number(m[1]) / 100 : NaN; };

/**
 * 阶梯：“0-5万:3%; 5万-10万:5%; 10万+:8%”，也可以只写上限“5万:3%; 10万:5%; 以上:8%”。
 * 返回从 0 开始、首尾相接的区间；最后一档到无穷大。
 */
export function parseTiers(text: string): { tiers: Tier[]; error?: string } {
  const parts = String(text ?? "").split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { tiers: [], error: "no tiers / 没有阶梯规则" };
  const tiers: Tier[] = [];
  let prev = 0;
  for (const p of parts) {
    const m = /^(.*?)\s*[:：=]\s*([\d.]+\s*%?)$/.exec(p);
    if (!m) return { tiers, error: `can't read tier “${p}” (e.g. 0-50000:3%) / 看不懂这一档` };
    const rate = pct(m[2]);
    const range = m[1].replace(/\s+/g, "");
    let from: number, to: number;
    const r = /^(.+?)[-~～至到](.+)$/.exec(range);
    if (r) { from = num(r[1]); to = num(r[2]); }
    else if (/\+$|以上|及以上|起$|^>/.test(range) || /^(以上|其余|其他|rest|above|over)$/i.test(range)) { from = /^(以上|其余|其他|rest|above|over)$/i.test(range) ? prev : num(range.replace(/^>=?/, "")); to = Infinity; }
    else { from = prev; to = num(range.replace(/^<=?|^≤|以下$|以内$/g, "")); }
    if (!Number.isFinite(from) || !(to > from) || !Number.isFinite(rate) || rate < 0 || rate > 1) return { tiers, error: `bad tier “${p}” / 这一档的范围或比例不对` };
    if (Math.abs(from - prev) > 1e-9) return { tiers, error: `tier “${p}” should start at ${prev} (tiers must follow each other from 0) / 阶梯要从 0 开始首尾相接` };
    tiers.push({ from, to, rate });
    prev = to;
  }
  if (tiers[tiers.length - 1].to !== Infinity) tiers.push({ from: prev, to: Infinity, rate: tiers[tiers.length - 1].rate });
  return { tiers };
}

/** 特殊品类：“配件:10%; 服务:15%”。 */
export function parseSpecial(text: string): { rates: SpecialRate[]; error?: string } {
  const rates: SpecialRate[] = [];
  for (const p of String(text ?? "").split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*[:：=]\s*([\d.]+\s*%?)$/.exec(p);
    const rate = m ? pct(m[2]) : NaN;
    if (!m || !Number.isFinite(rate)) return { rates, error: `can't read product rate “${p}” (e.g. 配件:10%) / 看不懂特殊提成` };
    rates.push({ match: m[1].trim(), rate });
  }
  return { rates };
}

/**
 * 有品类时只看品类（相同或包含，不分大小写）——避免“服务器”被当成“服务”；
 * 没填品类的行才按产品名包含来匹配。
 */
export function specialFor(sale: Pick<Sale, "product" | "category">, rates: SpecialRate[]) {
  const c = sale.category.trim().toLowerCase(), p = sale.product.toLowerCase();
  if (c) return rates.find((r) => c === r.match.toLowerCase()) ?? rates.find((r) => c.includes(r.match.toLowerCase()));
  return rates.find((r) => p.includes(r.match.toLowerCase()));
}

/** 阶梯提成。progressive = 超额累进（像个税）；whole = 全额（达到哪档，全部按哪档）。 */
export function tierCommission(base: number, tiers: Tier[], mode: "progressive" | "whole") {
  if (base < 0) return { commission: base * tiers[0].rate, breakdown: [{ tier: tiers[0], amount: base, commission: base * tiers[0].rate }], topRate: tiers[0].rate };
  const top = tiers.find((t) => base >= t.from && base < t.to) ?? tiers[tiers.length - 1];
  if (mode === "whole") return { commission: base * top.rate, breakdown: [{ tier: top, amount: base, commission: base * top.rate }], topRate: top.rate };
  const breakdown = tiers.filter((t) => base > t.from).map((t) => { const amount = Math.min(base, t.to) - t.from; return { tier: t, amount, commission: amount * t.rate }; });
  return { commission: breakdown.reduce((a, b) => a + b.commission, 0), breakdown, topRate: top.rate };
}

/** 把总额（分）按权重分给各行，最大余数法保证合计不差一分。 */
function allocate(totalCents: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map((w) => (totalCents * w) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (const o of order) { if (left <= 0) break; out[o.i]++; left--; }
  return out;
}

export function compute(sales: Sale[], tiers: Tier[], special: SpecialRate[], mode: "progressive" | "whole") {
  const lines = new Map<number, LineResult>();
  const people = [...new Set(sales.map((s) => s.person))];
  const results: PersonResult[] = [];
  for (const person of people) {
    const mine = sales.filter((s) => s.person === person);
    const tierLines = mine.filter((s) => !specialFor(s, special));
    const specLines = mine.filter((s) => specialFor(s, special));
    const signed = (s: Sale) => (s.refund ? -Math.abs(s.amount) : s.amount);
    const tierBase = tierLines.reduce((a, s) => a + signed(s), 0);
    const t = tierCommission(tierBase, tiers, mode);
    const tierCents = Math.round(t.commission * 100);
    // 正向销售和退货都按“有效费率”分摊：先给退货按有效费率算负数，再把余下的分给销售行
    const eff = tierBase !== 0 ? t.commission / tierBase : t.topRate;
    const refundRows = tierLines.filter((s) => s.refund);
    const saleRows = tierLines.filter((s) => !s.refund);
    const refundCents = refundRows.map((s) => -Math.round(Math.abs(s.amount) * eff * 100));
    const saleCents = allocate(tierCents - refundCents.reduce((a, b) => a + b, 0), saleRows.map((s) => s.amount));
    refundRows.forEach((s, i) => lines.set(s.row, { row: s.row, kind: "refund", rate: eff, commission: refundCents[i] / 100 }));
    saleRows.forEach((s, i) => lines.set(s.row, { row: s.row, kind: "tier", rate: eff, commission: saleCents[i] / 100 }));
    let specialCommission = 0, specialSales = 0, clawback = refundCents.reduce((a, b) => a + b, 0) / 100;
    for (const s of specLines) {
      const r = specialFor(s, special)!.rate;
      const c = Math.round(signed(s) * r * 100) / 100;
      lines.set(s.row, { row: s.row, kind: s.refund ? "special-refund" : "special", rate: r, commission: c });
      specialSales += signed(s);
      if (s.refund) clawback += c; else specialCommission += c;
    }
    const sum = (k: (s: Sale) => boolean) => mine.filter(k).reduce((a, s) => a + Math.abs(s.amount), 0);
    const r2 = (x: number) => Math.round(x * 100) / 100;
    const tierPositive = saleCents.reduce((a, b) => a + b, 0) / 100;
    results.push({
      person, sales: r2(sum((s) => !s.refund)), refunds: r2(sum((s) => s.refund)), tierBase: r2(tierBase), tierCommission: r2(tierPositive), specialSales: r2(specialSales), specialCommission: r2(specialCommission),
      clawback: r2(clawback), total: r2(tierPositive + specialCommission + clawback), topRate: t.topRate, breakdown: t.breakdown, lines: mine.map((s) => s.row),
    });
  }
  return { results, lines };
}
