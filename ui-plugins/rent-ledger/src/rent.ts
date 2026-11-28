/** 租金计划、付款分摊（先到期先冲）、金额大写。 */

export interface Charge { unit: string; label: string; period: string; due: string; amount: number; paid: number; paidOn?: string; pays: number[] }
export interface Lease { unit: string; tenant: string; rent: number; start: string; end: string; dueDay: number; cycle: number; settledTo: string }

const pad = (n: number) => String(n).padStart(2, "0");
export const ym = (y: number, m: number) => `${y + Math.floor((m - 1) / 12)}-${pad(((m - 1) % 12 + 12) % 12 + 1)}`;
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addMonths = (d: string, n: number) => { const [y, m, dd] = d.split("-").map(Number); const t = ym(y, m + n); const [ty, tm] = t.split("-").map(Number); return `${t}-${pad(Math.min(dd, dim(ty, tm)))}`; };
export const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
export const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function cycleOf(v: string): number | null {
  const t = v.trim().toLowerCase();
  if (!t || /月付|每月|押一付一|押二付一|monthly|month/.test(t)) return 1;
  if (/季|付三|quarter/.test(t)) return 3;
  if (/半年|付六|half/.test(t)) return 6;
  if (/年付|每年|付十二|year|annual/.test(t)) return 12;
  const m = /^(\d+)\s*(个月|月|m)?$/.exec(t); if (m) return Number(m[1]) || null;
  return null;
}

/** 从起租日到截至日（不超过到期日）的每期应收；已结清月份之前的不计。 */
export function schedule(l: Lease, asOf: string): Charge[] {
  const out: Charge[] = [];
  for (let k = 0; k < 600; k++) {
    const ps = addMonths(l.start, k * l.cycle);
    if (ps > l.end || ps > asOf) break;
    const pe = addMonths(l.start, (k + 1) * l.cycle), stop = addDay(l.end);
    let amount = l.rent * l.cycle;
    if (pe > stop) {
      let f = 0; while (f < l.cycle && addMonths(ps, f + 1) <= stop) f++;
      const rest = addMonths(ps, f), md = dim(+rest.slice(0, 4), +rest.slice(5, 7));
      amount = l.rent * f + (l.rent * Math.max(0, days(rest, stop))) / md;
    }
    const [y, m] = ps.split("-").map(Number);
    const dueDay = l.dueDay || Number(l.start.slice(8, 10));
    const due = `${ym(y, m)}-${pad(Math.min(dueDay, dim(y, m)))}`;
    const label = l.cycle === 1 ? `${y}年${m}月房租` : `${y}年${m}月起 ${l.cycle} 个月房租`;
    if (l.settledTo && ym(y, m) <= l.settledTo) continue;
    out.push({ unit: l.unit, label, period: ym(y, m), due, amount: Math.round(amount * 100) / 100, paid: 0, pays: [] });
  }
  return out;
}

/** 先到期先冲：返回余下的预付（credit）。 */
export function allocate(charges: Charge[], pays: { i: number; date: string; amount: number }[]): { credit: number; used: Map<number, { label: string; amount: number }[]> } {
  const cs = [...charges].sort((a, b) => (a.due < b.due ? -1 : 1)), used = new Map<number, { label: string; amount: number }[]>();
  let credit = 0;
  for (const p of [...pays].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i))) {
    let left = p.amount;
    for (const c of cs) {
      if (left <= 0.004) break;
      const need = Math.round((c.amount - c.paid) * 100) / 100;
      if (need <= 0.004) continue;
      const x = Math.min(need, left);
      c.paid = Math.round((c.paid + x) * 100) / 100; left = Math.round((left - x) * 100) / 100; c.pays.push(p.i);
      if (c.amount - c.paid <= 0.004) c.paidOn = p.date;
      used.set(p.i, [...(used.get(p.i) ?? []), { label: c.label, amount: x }]);
    }
    if (left > 0.004) { credit += left; used.set(p.i, [...(used.get(p.i) ?? []), { label: "预付（下期抵扣）", amount: left }]); }
  }
  return { credit: Math.round(credit * 100) / 100, used };
}

const D = "零壹贰叁肆伍陆柒捌玖", U = ["", "拾", "佰", "仟"], B = ["", "万", "亿"];
/** 人民币金额大写。 */
export function rmbUpper(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const fen = Math.round(n * 100), yuan = Math.floor(fen / 100), jiao = Math.floor(fen / 10) % 10, f = fen % 10;
  let s = "";
  if (yuan === 0) s = "零";
  else {
    const str = String(yuan), groups: string[] = [];
    for (let i = str.length; i > 0; i -= 4) groups.unshift(str.slice(Math.max(0, i - 4), i));
    groups.forEach((g, gi) => {
      let part = "", zero = false;
      for (let k = 0; k < g.length; k++) { const d = +g[k], pos = g.length - 1 - k; if (d === 0) zero = true; else { if (zero && part) part += "零"; zero = false; part += D[d] + U[pos]; } }
      if (part) { if (s && (g.length < 4 || g[0] === "0")) s += "零"; s += part + B[groups.length - 1 - gi]; }
    });
  }
  s += "元";
  if (!jiao && !f) return s + "整";
  if (jiao) s += D[jiao] + "角"; else if (yuan) s += "零";
  if (f) s += D[f] + "分";
  return s;
}
