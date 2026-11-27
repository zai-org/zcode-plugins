// 口算题生成（可复现的随机数）与校验
export type Op = "+" | "-" | "×" | "÷";
export type Range = [number, number];
export interface Params {
  ops: Op[]; addA: Range; addB: Range; sumMax: number; subA: Range; subB: Range;
  mulA: Range; mulB: Range; divisor: Range; quotient: Range; remainder: boolean;
  carry: "any" | "yes" | "no";
}
export interface Problem { a: number; op: Op; b: number; blank: "answer" | "a" | "b" }

export const PRESETS: Record<string, { label: [string, string]; p: Params }> = {
  g1a: { label: ["一年级 · 20 以内加减", "Grade 1 · add/subtract within 20"], p: { ops: ["+", "-"], addA: [1, 19], addB: [1, 19], sumMax: 20, subA: [2, 20], subB: [1, 19], mulA: [1, 9], mulB: [1, 9], divisor: [1, 9], quotient: [1, 9], remainder: false, carry: "any" } },
  g1b: { label: ["一年级 · 100 以内不进位/不退位", "Grade 1 · within 100, no carrying"], p: { ops: ["+", "-"], addA: [10, 89], addB: [1, 89], sumMax: 100, subA: [11, 99], subB: [1, 89], mulA: [1, 9], mulB: [1, 9], divisor: [1, 9], quotient: [1, 9], remainder: false, carry: "no" } },
  g2a: { label: ["二年级 · 100 以内进位/退位加减", "Grade 2 · within 100 with carrying"], p: { ops: ["+", "-"], addA: [11, 89], addB: [11, 89], sumMax: 100, subA: [21, 99], subB: [11, 89], mulA: [1, 9], mulB: [1, 9], divisor: [1, 9], quotient: [1, 9], remainder: false, carry: "yes" } },
  g2b: { label: ["二年级 · 表内乘除", "Grade 2 · times tables"], p: { ops: ["×", "÷"], addA: [1, 9], addB: [1, 9], sumMax: 100, subA: [1, 9], subB: [1, 9], mulA: [2, 9], mulB: [2, 9], divisor: [2, 9], quotient: [2, 9], remainder: false, carry: "any" } },
  g2c: { label: ["二年级 · 有余数的除法", "Grade 2 · division with remainders"], p: { ops: ["÷"], addA: [1, 9], addB: [1, 9], sumMax: 100, subA: [1, 9], subB: [1, 9], mulA: [2, 9], mulB: [2, 9], divisor: [2, 9], quotient: [1, 9], remainder: true, carry: "any" } },
  g3a: { label: ["三年级 · 三位数加减", "Grade 3 · 3-digit add/subtract"], p: { ops: ["+", "-"], addA: [100, 899], addB: [100, 899], sumMax: 1000, subA: [200, 999], subB: [100, 899], mulA: [1, 9], mulB: [1, 9], divisor: [1, 9], quotient: [1, 9], remainder: false, carry: "any" } },
  g3b: { label: ["三年级 · 两位数乘一位数、除以一位数", "Grade 3 · 2-digit × 1-digit, ÷ 1-digit"], p: { ops: ["×", "÷"], addA: [1, 9], addB: [1, 9], sumMax: 100, subA: [1, 9], subB: [1, 9], mulA: [11, 99], mulB: [2, 9], divisor: [2, 9], quotient: [11, 99], remainder: false, carry: "any" } },
  g4a: { label: ["四年级 · 两位数乘两位数、除数是两位数", "Grade 4 · 2-digit × 2-digit, ÷ 2-digit"], p: { ops: ["×", "÷"], addA: [1, 9], addB: [1, 9], sumMax: 100, subA: [1, 9], subB: [1, 9], mulA: [11, 99], mulB: [11, 99], divisor: [11, 99], quotient: [2, 30], remainder: false, carry: "any" } },
};

export function rng(seed: number) {
  let t = (Math.floor(seed) >>> 0) || 1;
  const next = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (Math.max(lo, hi) - lo + 1)), pick: <T,>(a: T[]) => a[Math.floor(next() * a.length)] };
}

const digits = (n: number) => String(Math.abs(Math.trunc(n))).split("").reverse().map(Number);
export function hasCarry(a: number, b: number) { const x = digits(a), y = digits(b); let c = 0; for (let i = 0; i < Math.max(x.length, y.length); i++) { const s = (x[i] ?? 0) + (y[i] ?? 0) + c; if (s >= 10) return true; c = 0; } return false; }
export function hasBorrow(a: number, b: number) { const x = digits(a), y = digits(b); for (let i = 0; i < y.length; i++) if ((x[i] ?? 0) < y[i]) return true; return false; }

export function solve(p: Pick<Problem, "a" | "op" | "b">): { value?: number; rem?: number; error?: string } {
  const { a, b } = p;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: "not a number" };
  switch (p.op) {
    case "+": return { value: a + b };
    case "-": return { value: a - b };
    case "×": return { value: a * b };
    case "÷": if (b === 0) return { error: "division by zero" }; return Number.isInteger(a) && Number.isInteger(b) ? { value: Math.floor(a / b), rem: a % b } : { value: a / b };
  }
}

function one(r: ReturnType<typeof rng>, p: Params, op: Op): Pick<Problem, "a" | "op" | "b"> | undefined {
  for (let t = 0; t < 200; t++) {
    if (op === "+") {
      const a = r.int(...p.addA), b = r.int(...p.addB);
      if (a + b > p.sumMax) continue;
      if (p.carry === "yes" && !hasCarry(a, b)) continue;
      if (p.carry === "no" && hasCarry(a, b)) continue;
      return { a, op, b };
    }
    if (op === "-") {
      const a = r.int(...p.subA), b = r.int(...p.subB);
      if (b > a) continue;
      if (p.carry === "yes" && !hasBorrow(a, b)) continue;
      if (p.carry === "no" && hasBorrow(a, b)) continue;
      return { a, op, b };
    }
    if (op === "×") return { a: r.int(...p.mulA), op, b: r.int(...p.mulB) };
    const d = r.int(...p.divisor), q = r.int(...p.quotient);
    const rem = p.remainder ? r.int(1, Math.max(1, d - 1)) : 0;
    if (p.remainder && d < 2) continue;
    return { a: d * q + rem, op, b: d };
  }
  return undefined;
}

/** 生成 count 道题；尽量不重复。blankMode: answer 只填结果；mixed 随机挖空一个运算数（□ + 5 = 12）。 */
export function generate(p: Params, count: number, seed: number, blankMode: "answer" | "mixed" = "answer"): Problem[] {
  const r = rng(seed), out: Problem[] = [], seen = new Set<string>();
  for (let i = 0, tries = 0; out.length < count && tries < count * 50; tries++) {
    const op = p.ops[(out.length + Math.floor(r.next() * p.ops.length)) % p.ops.length];
    const x = one(r, p, op);
    if (!x) continue;
    const key = `${x.a}${x.op}${x.b}`;
    if (seen.has(key) && tries < count * 25) continue;
    seen.add(key);
    const blank = blankMode === "mixed" && !(x.op === "÷" && p.remainder) ? r.pick(["answer", "a", "b"] as const) : "answer";
    out.push({ ...x, blank });
    i++;
  }
  return out;
}

export function parseOps(t: string): Op[] {
  const out = new Set<Op>();
  for (const ch of String(t ?? "")) { if (ch === "+" || ch === "加") out.add("+"); if ("-−减".includes(ch)) out.add("-"); if ("×x*乘".includes(ch)) out.add("×"); if ("÷/除".includes(ch)) out.add("÷"); }
  return [...out];
}

export function parseRange(t: string, d: Range): Range {
  const m = String(t ?? "").match(/(\d+)\s*[-–~～到至,，]\s*(\d+)/);
  if (!m) return d;
  const a = Number(m[1]), b = Number(m[2]);
  return a <= b ? [a, b] : [b, a];
}

/** “37 + 48”“□-5=12”“84÷9” → 题目。 */
export function parseExpr(line: string): Problem | undefined {
  const t = line.replace(/\s+/g, "").replace(/[xX*]/g, "×").replace(/[/]/g, "÷").replace(/[−–]/g, "-").replace(/（|）|\(|\)/g, "").replace(/[＝]/g, "=").replace(/[＋]/g, "+");
  let m = t.match(/^(\d+)([+\-×÷])(\d+)(?:=.*)?$/);
  if (m) return { a: Number(m[1]), op: m[2] as Op, b: Number(m[3]), blank: "answer" };
  m = t.match(/^(□|_+|\?|？)([+\-×÷])(\d+)=(\d+)$/);
  if (m) { const b = Number(m[3]), c = Number(m[4]), op = m[2] as Op; const a = op === "+" ? c - b : op === "-" ? c + b : op === "×" ? c / b : c * b; return { a, op, b, blank: "a" }; }
  m = t.match(/^(\d+)([+\-×÷])(□|_+|\?|？)=(\d+)$/);
  if (m) { const a = Number(m[1]), c = Number(m[4]), op = m[2] as Op; const b = op === "+" ? c - a : op === "-" ? a - c : op === "×" ? c / a : a / c; return { a, op, b, blank: "b" }; }
  return undefined;
}

export function display(p: Problem, withAnswer: boolean): { text: string; answer: string } {
  const s = solve(p);
  const ans = s.value === undefined ? "?" : p.op === "÷" && s.rem ? `${s.value}……${s.rem}` : String(Math.round((s.value) * 1e6) / 1e6);
  const box = "□";
  const A = p.blank === "a" ? (withAnswer ? String(p.a) : box) : String(p.a);
  const B = p.blank === "b" ? (withAnswer ? String(p.b) : box) : String(p.b);
  const R = p.blank === "answer" ? (withAnswer ? ans : "") : ans;
  return { text: `${A} ${p.op} ${B} = ${R}`.trimEnd(), answer: p.blank === "a" ? String(p.a) : p.blank === "b" ? String(p.b) : ans };
}
