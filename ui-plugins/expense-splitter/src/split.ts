// 分账核心：全部用“分”（整数）计算，避免浮点误差。
export interface Expense { date: string; item: string; payer: string; amount: number; participants: string; }
export interface Parsed { row: number; amount: number; paid: Map<string, number>; owed: Map<string, number>; errors: string[]; warns: string[] }
export interface Transfer { from: string; to: string; amount: number }

const ALL = /^(全部|全体|所有人|大家|全员|all|everyone|everybody|\*)$/i;
const sep = /[,，、;；\n]+/;
const cents = (n: number) => Math.round(n * 100);

/** 金额：支持 1,234.5、¥30、30元、3万。 */
export function money(v: unknown): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim().replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const wan = /万/.test(s);
  s = s.replace(/[¥￥$€£,，\s元万]|RMB|CNY|USD|EUR/gi, "");
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return NaN;
  return Number(s) * (wan ? 10000 : 1);
}

/** “A:300; B:200” 或 “A 300, B 200” → 每人付了多少；单个名字 → 全额。 */
export function parsePayers(text: string, amount: number): { paid: Map<string, number>; error?: string } {
  const paid = new Map<string, number>();
  const parts = String(text ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return { paid, error: "no payer / 没有付款人" };
  if (parts.length === 1 && !/[:：=]\s*[\d.]|\s\d[\d.,]*$/.test(parts[0])) { paid.set(parts[0], cents(amount)); return { paid }; }
  for (const p of parts) {
    const m = /^(.+?)\s*(?:[:：=]\s*|\s+)([¥￥$]?\s*[\d.,]+\s*元?)$/.exec(p);
    if (!m) return { paid, error: `can't read payer “${p}” (use 名字:金额) / 看不懂付款人` };
    const n = money(m[2]);
    if (!Number.isFinite(n)) return { paid, error: `bad amount in “${p}”` };
    paid.set(m[1].trim(), (paid.get(m[1].trim()) ?? 0) + cents(n));
  }
  const sum = [...paid.values()].reduce((a, b) => a + b, 0);
  if (sum !== cents(amount)) return { paid, error: `payers add up to ${(sum / 100).toFixed(2)}, not ${amount.toFixed(2)} / 付款人金额之和与总额不符` };
  return { paid };
}

/**
 * 参与人：“全部” / “A, B, C” / “全部, -C”（除了 C）/ “A*2, B”（按份数）/ “A:50, B, C”（A 正好 50，其余由 B、C 平分）/ “A+30, 全部”（A 多承担 30，其余所有人平分）。
 * 均分除不尽的零头（分）按列出的顺序依次多分 1 分。
 */
export function parseShares(text: string, amountCents: number, people: string[]): { owed: Map<string, number>; error?: string; warn?: string } {
  const owed = new Map<string, number>();
  const tokens = String(text ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
  const weights = new Map<string, number>(), fixed = new Map<string, number>(), extra = new Map<string, number>();
  const minus = new Set<string>();
  if (!tokens.length) tokens.push("全部");
  for (const t of tokens) {
    const ex = /^(?:-|－|除了?|except\s+|not\s+)(.+)$/i.exec(t);
    if (ex) { for (const n of ex[1].split(/\s*[和&+]\s*/)) minus.add(n.trim()); continue; }
    if (ALL.test(t)) { for (const p of people) if (!weights.has(p) && !fixed.has(p)) weights.set(p, 1); continue; }
    let m = /^(.+?)\s*[+＋]\s*([¥￥$]?\s*[\d.,]+\s*元?)$/.exec(t);
    if (m) { const n = money(m[2]); if (!Number.isFinite(n)) return { owed, error: `bad amount in “${t}”` }; extra.set(m[1].trim(), (extra.get(m[1].trim()) ?? 0) + cents(n)); if (!fixed.has(m[1].trim()) && !weights.has(m[1].trim())) weights.set(m[1].trim(), 1); continue; }
    m = /^(.+?)\s*[:：=]\s*([¥￥$]?\s*[\d.,]+\s*元?)$/.exec(t);
    if (m) { const n = money(m[2]); if (!Number.isFinite(n)) return { owed, error: `bad amount in “${t}”` }; fixed.set(m[1].trim(), cents(n)); weights.delete(m[1].trim()); continue; }
    m = /^(.+?)\s*(?:[*×xX]\s*|[（(])(\d+(?:\.\d+)?)[)）]?$/.exec(t);
    if (m) { weights.set(m[1].trim(), Number(m[2])); continue; }
    weights.set(t, 1);
  }
  for (const n of minus) { weights.delete(n); fixed.delete(n); extra.delete(n); }
  const fixedSum = [...fixed.values(), ...extra.values()].reduce((a, b) => a + b, 0);
  if (fixedSum > amountCents) return { owed, error: `fixed shares (${(fixedSum / 100).toFixed(2)}) are more than the amount / 固定金额超过总额` };
  for (const [n, c] of fixed) owed.set(n, c);
  for (const [n, c] of extra) owed.set(n, (owed.get(n) ?? 0) + c);
  const rest = amountCents - fixedSum;
  const w = [...weights].filter(([, x]) => x > 0);
  const wsum = w.reduce((a, [, x]) => a + x, 0);
  if (rest > 0 && !wsum) return { owed, error: fixed.size ? `fixed shares cover only ${(fixedSum / 100).toFixed(2)} and nobody shares the rest / 剩余金额没人分摊` : "nobody shares this expense / 没有参与人" };
  // 按份额分配，最大余数法保证合计正好等于总额
  const raw = w.map(([n, x]) => ({ n, exact: (rest * x) / wsum }));
  const base = raw.map((r) => ({ n: r.n, c: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let left = rest - base.reduce((a, b) => a + b.c, 0);
  const order = base.map((b, i) => ({ i, frac: b.frac })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) { if (left <= 0) break; base[o.i].c++; left--; }
  for (const b of base) owed.set(b.n, (owed.get(b.n) ?? 0) + b.c);
  const unknown = [...minus].filter((n) => !people.includes(n));
  return { owed, warn: unknown.length ? `excluded ${unknown.join(", ")} is not in the group / 排除的人不在名单里` : undefined };
}

/** 每人余额（分）：正数 = 应收，负数 = 应付。 */
export function balances(items: Parsed[], people: string[]) {
  const bal = new Map(people.map((p) => [p, 0]));
  const paid = new Map(people.map((p) => [p, 0]));
  const owed = new Map(people.map((p) => [p, 0]));
  for (const it of items) {
    if (it.errors.length) continue;
    for (const [n, c] of it.paid) { bal.set(n, (bal.get(n) ?? 0) + c); paid.set(n, (paid.get(n) ?? 0) + c); }
    for (const [n, c] of it.owed) { bal.set(n, (bal.get(n) ?? 0) - c); owed.set(n, (owed.get(n) ?? 0) + c); }
  }
  return { bal, paid, owed };
}

/**
 * 最少转账：把余额分成尽可能多的“和为 0”的小组（每组 k 人只需 k-1 笔），
 * 人数 ≤ 16 时用状态压缩 DP 求最优，组内再按“最大欠款还给最大债主”配对；人更多时直接贪心。
 */
export function settle(bal: Map<string, number>): Transfer[] {
  const ppl = [...bal].filter(([, c]) => c !== 0);
  const k = ppl.length;
  if (!k) return [];
  let groups: [string, number][][];
  if (k <= 16) {
    const N = 1 << k;
    const sum = new Int32Array(N), dp = new Int8Array(N), from = new Int8Array(N);
    for (let m = 1; m < N; m++) { const b = 31 - Math.clz32(m & -m); sum[m] = sum[m & (m - 1)] + ppl[b][1]; }
    for (let m = 1; m < N; m++) {
      let best = -1, bi = 0;
      for (let i = 0; i < k; i++) if (m & (1 << i)) { const v = dp[m ^ (1 << i)]; if (v > best) { best = v; bi = i; } }
      dp[m] = best + (sum[m] === 0 ? 1 : 0); from[m] = bi;
    }
    // 回溯：沿着 from 链，每遇到和为 0 的前缀就切出一组
    groups = [];
    let m = N - 1, cur: number[] = [];
    while (m) {
      const i = from[m];
      cur.push(i);
      const next = m ^ (1 << i);
      if (sum[next] === 0 && cur.length) { groups.push(cur.map((j) => ppl[j])); cur = []; }
      m = next;
    }
    if (cur.length) groups.push(cur.map((j) => ppl[j]));
  } else groups = [ppl];
  const out: Transfer[] = [];
  for (const g of groups) {
    const cred = g.filter(([, c]) => c > 0).map(([n, c]) => ({ n, c }));
    const debt = g.filter(([, c]) => c < 0).map(([n, c]) => ({ n, c: -c }));
    while (cred.length && debt.length) {
      cred.sort((a, b) => b.c - a.c); debt.sort((a, b) => b.c - a.c);
      const x = Math.min(cred[0].c, debt[0].c);
      out.push({ from: debt[0].n, to: cred[0].n, amount: x });
      cred[0].c -= x; debt[0].c -= x;
      if (!cred[0].c) cred.shift();
      if (!debt[0].c) debt.shift();
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from, "zh") || b.amount - a.amount);
}
