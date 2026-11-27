export type Method = "annuity" | "principal";
export interface Prepay { month: string; amount: number; mode: "shorten" | "reduce" }
export interface RateChange { month: string; rate: number }
export interface Plan { name: string; principal: number; rate: number; months: number; method: Method; start: string; prepays: Prepay[]; rates: RateChange[] }
export interface Period { n: number; month: string; rate: number; payment: number; principal: number; interest: number; prepay: number; balance: number }
export interface Result { schedule: Period[]; totalInterest: number; totalPaid: number; months: number; payoff: string; firstPayment: number; maxPayment: number }

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
export function addMonths(ym: string, k: number) {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const annuity = (b: number, r: number, n: number) => (n <= 0 ? b : r === 0 ? b / n : (b * r) / (1 - (1 + r) ** -n));

/** 解析“2029-01:200000 缩短期限; 第36期:50000 减少月供”。 */
export function parsePrepays(text: string, start: string): Prepay[] | null {
  const out: Prepay[] = [];
  for (const part of String(text ?? "").split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(?:(\d{4})[-/.年](\d{1,2})月?|第?(\d+)期)\s*[:：,，\s]\s*([\d.,]+)\s*(万)?\s*(.*)$/.exec(part);
    if (!m) return null;
    const month = m[1] ? `${m[1]}-${m[2].padStart(2, "0")}` : addMonths(start, Number(m[3]) - 1);
    const amount = Number(m[4].replace(/,/g, "")) * (m[5] ? 10000 : 1);
    out.push({ month, amount, mode: /减少月供|月供|reduce|payment/i.test(m[6]) ? "reduce" : "shorten" });
  }
  return out;
}
export function parseRates(text: string, start: string): RateChange[] | null {
  const out: RateChange[] = [];
  for (const part of String(text ?? "").split(/[;；\n,，]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(?:(\d{4})[-/.年](\d{1,2})月?|第?(\d+)期)\s*[:：\s]\s*([\d.]+)\s*%?$/.exec(part);
    if (!m) return null;
    out.push({ month: m[1] ? `${m[1]}-${m[2].padStart(2, "0")}` : addMonths(start, Number(m[3]) - 1), rate: Number(m[4]) });
  }
  return out;
}

/** 逐月计算。提前还款在当月正常还款之后发生；利率调整从当月起生效。 */
export function schedule(p: Plan): Result {
  let bal = p.principal;
  let remaining = p.months;
  let rate = p.rate;
  let pay = 0, part = 0;
  const recalc = () => { const r = rate / 1200; if (p.method === "annuity") pay = annuity(bal, r, remaining); else part = bal / remaining; };
  recalc();
  const out: Period[] = [];
  for (let n = 1; bal > 0.005 && n <= 1200; n++) {
    const month = addMonths(p.start, n - 1);
    const rc = p.rates.find((x) => x.month === month);
    if (rc && rc.rate !== rate) { rate = rc.rate; recalc(); }
    const r = rate / 1200;
    const interest = bal * r;
    let principal = p.method === "annuity" ? pay - interest : part;
    if (principal > bal || remaining <= 1) principal = bal;
    bal -= principal;
    remaining--;
    let prepay = 0;
    for (const pp of p.prepays.filter((x) => x.month === month)) {
      const amt = Math.min(pp.amount, bal);
      if (amt <= 0) continue;
      prepay += amt;
      bal -= amt;
      if (bal <= 0.005) break;
      if (pp.mode === "reduce") recalc();
      else if (p.method === "annuity") { remaining = r === 0 ? Math.ceil(bal / pay) : Math.ceil(-Math.log(1 - (bal * r) / pay) / Math.log(1 + r)); recalc(); }
      else remaining = Math.ceil(bal / part - 1e-9);
    }
    out.push({ n, month, rate, payment: r2(principal + interest), principal: r2(principal), interest: r2(interest), prepay: r2(prepay), balance: r2(Math.max(0, bal)) });
    if (bal <= 0.005) break;
  }
  const totalInterest = r2(out.reduce((a, x) => a + x.interest, 0));
  return { schedule: out, totalInterest, totalPaid: r2(p.principal + totalInterest), months: out.length, payoff: out[out.length - 1]?.month ?? p.start, firstPayment: out[0]?.payment ?? 0, maxPayment: Math.max(...out.map((x) => x.payment)) };
}
