import { createHash, randomBytes } from "node:crypto";

/** 可复现的随机数：第 i 个数 = SHA-256(种子 + ":" + i) 前 8 字节 / 2^64。任何人用同样的种子都能算出同样的结果。 */
export function rng(seed: string, i: number): number {
  const h = createHash("sha256").update(`${seed}:${i}`).digest();
  return Number(h.readBigUInt64BE(0) >> 11n) / 2 ** 53;
}
export const newSeed = () => randomBytes(6).toString("hex");

export interface Prize { name: string; count: number }
/** “一等奖×1, 二等奖 3, 三等奖*5” → 奖项列表。 */
export function parsePrizes(text: string): Prize[] {
  return String(text ?? "").split(/[\n,，;；、]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)\s*(?:[×xX*＊]\s*|\s)(\d+)\s*(?:名|个|人)?$/.exec(x);
    return m && m[1].trim() ? { name: m[1].trim(), count: Number(m[2]) } : { name: x, count: 1 };
  }).filter((p) => p.count > 0);
}

export interface Entrant { id: number; name: string; weight: number; fixed: string; tag: string }
export interface Step { step: number; prize: string; pool: number; totalWeight: number; random: number; winner: string; id: number }

/** 抽奖：按奖项顺序逐个抽，按权重；fixed 的人直接占名额（锁定）。 */
export function drawRaffle(entrants: Entrant[], prizes: Prize[], seed: string, opts: { weighted: boolean; repeat: boolean }) {
  const result = new Map<number, string[]>();
  const steps: Step[] = [];
  const short: { prize: string; missing: number }[] = [];
  const add = (id: number, prize: string) => result.set(id, [...(result.get(id) ?? []), prize]);
  for (const e of entrants) if (e.fixed) add(e.id, e.fixed);
  let pool = entrants.filter((e) => !e.fixed && e.weight > 0);
  let n = 0;
  for (const p of prizes) {
    const already = entrants.filter((e) => e.fixed === p.name).length;
    for (let k = already; k < p.count; k++) {
      if (!pool.length) { short.push({ prize: p.name, missing: p.count - k }); break; }
      const w = (e: Entrant) => (opts.weighted ? e.weight : 1);
      const total = pool.reduce((s, e) => s + w(e), 0);
      const r = rng(seed, n++);
      let acc = 0, pick = pool[pool.length - 1];
      for (const e of pool) { acc += w(e); if (r * total < acc) { pick = e; break; } }
      add(pick.id, p.name);
      steps.push({ step: steps.length + 1, prize: p.name, pool: pool.length, totalWeight: total, random: Number(r.toFixed(12)), winner: pick.name, id: pick.id });
      if (!opts.repeat) pool = pool.filter((e) => e !== pick);
    }
  }
  return { result, steps, short };
}

/** 随机分组：可按某一列均衡（每组各类人数尽量相同）。 */
export function drawGroups(entrants: Entrant[], groups: number, seed: string, balance: boolean) {
  const g = Math.max(1, Math.min(groups, entrants.length || 1));
  // 种子洗牌（Fisher–Yates）
  const shuffled = [...entrants];
  let n = 0;
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rng(seed, n++) * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const out = new Map<number, number>();
  const sizes = Array(g).fill(0);
  if (balance) {
    const tags = [...new Set(shuffled.map((e) => e.tag))].sort((a, b) => shuffled.filter((e) => e.tag === b).length - shuffled.filter((e) => e.tag === a).length || a.localeCompare(b));
    for (const t of tags) for (const e of shuffled.filter((x) => x.tag === t)) {
      // 放进当前人数最少的组；人数相同时选这一类最少的组，再按组号
      let best = 0;
      for (let k = 1; k < g; k++) {
        const ck = [...out].filter(([id, gg]) => gg === k && entrants.find((x) => x.id === id)!.tag === t).length;
        const cb = [...out].filter(([id, gg]) => gg === best && entrants.find((x) => x.id === id)!.tag === t).length;
        if (sizes[k] < sizes[best] || (sizes[k] === sizes[best] && ck < cb)) best = k;
      }
      out.set(e.id, best); sizes[best]++;
    }
  } else shuffled.forEach((e, i) => { out.set(e.id, i % g); sizes[i % g]++; });
  return { group: out, sizes };
}

export function inputHash(entrants: Entrant[]) {
  return createHash("sha256").update(entrants.map((e) => `${e.name}\t${e.weight}\t${e.fixed}\t${e.tag}`).join("\n")).digest("hex");
}
