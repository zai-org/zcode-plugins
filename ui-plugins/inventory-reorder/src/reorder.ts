// 补货计算：日均销量 × (交货期 + 安全天数) = 再订货点；低于它就补到“再覆盖 N 天”的目标库存，再按箱规和起订量取整。
export interface Item { sku: string; onHand: number; onOrder: number; lead: number; moq: number; pack: number; safetyDays?: number; daily: number }
export interface Plan { rop: number; target: number; position: number; suggest: number; daysLeft: number; runsOutBeforeArrival: boolean }

export function plan(it: Item, o: { safetyDays: number; coverDays: number }): Plan {
  const safety = Number.isFinite(it.safetyDays) && it.safetyDays! >= 0 ? it.safetyDays! : o.safetyDays;
  const d = Math.max(0, it.daily);
  const rop = d * (it.lead + safety);
  const target = d * (it.lead + safety + o.coverDays);
  const position = it.onHand + it.onOrder;
  let suggest = 0;
  if (d > 0 && position <= rop + 1e-9) {
    suggest = Math.max(0, Math.ceil(target - position - 1e-9));
    const pack = it.pack > 1 ? it.pack : 1;
    suggest = Math.ceil(suggest / pack) * pack;
    if (it.moq > 0 && suggest < it.moq) suggest = Math.ceil(it.moq / pack) * pack;
  }
  const daysLeft = d > 0 ? it.onHand / d : Infinity;
  return { rop, target, position, suggest, daysLeft, runsOutBeforeArrival: d > 0 && (it.onHand + it.onOrder) / d < it.lead };
}

/** 销量明细 → 每个 SKU 的日均销量。窗口 = 最近 lookback 天（以明细里最晚的日期为止）。 */
export function dailyDemand(lines: { date: string; sku: string; qty: number }[], lookback: number) {
  const dated = lines.filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date));
  const out = new Map<string, number>();
  if (!dated.length) return { daily: out, from: "", to: "", days: 0 };
  const to = dated.map((l) => l.date).sort().pop()!;
  const end = Date.parse(`${to}T00:00:00Z`);
  const start = end - (lookback - 1) * 86400000;
  const first = Math.max(start, Date.parse(`${dated.map((l) => l.date).sort()[0]}T00:00:00Z`));
  const days = Math.round((end - first) / 86400000) + 1;
  for (const l of dated) {
    const t = Date.parse(`${l.date}T00:00:00Z`);
    if (t < first || t > end) continue;
    out.set(l.sku, (out.get(l.sku) ?? 0) + l.qty);
  }
  for (const [k, v] of out) out.set(k, v / days);
  return { daily: out, from: new Date(first).toISOString().slice(0, 10), to, days };
}
