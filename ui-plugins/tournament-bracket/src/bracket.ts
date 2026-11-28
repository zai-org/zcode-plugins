/** 循环赛/淘汰赛赛程生成、比分解析、积分榜。 */
export interface Team { name: string; seed: number }
export interface Match { id: string; round: number; home: string; away: string }

/** 单循环（圆桌法），人数为奇数时每轮一队轮空；double=true 时主客互换再打一轮。 */
export function roundRobin(teams: string[], double = false): Match[] {
  const t = [...teams]; if (t.length % 2) t.push("");
  const n = t.length, out: Match[] = [];
  let k = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      let a = t[i], b = t[n - 1 - i];
      if (i === 0 && r % 2) [a, b] = [b, a];
      if (a && b) out.push({ id: `M${++k}`, round: r + 1, home: a, away: b });
    }
    t.splice(1, 0, t.pop()!);
  }
  if (double) for (const m of [...out]) out.push({ id: `M${++k}`, round: m.round + n - 1, home: m.away, away: m.home });
  return out;
}

/** 标准种子位置：1 和 2 号种子在两端，依此类推。 */
export function seedOrder(size: number): number[] {
  let o = [1];
  while (o.length < size) { const m = o.length * 2 + 1; o = o.flatMap((x) => [x, m - x]); }
  return o;
}

/** 淘汰赛：签表补到 2 的幂，空位作为轮空给高种子。后续轮次用 “W:M1” 表示 M1 的胜者。 */
export function knockout(teams: Team[], third = false): Match[] {
  const sorted = [...teams].sort((a, b) => a.seed - b.seed);
  let size = 1; while (size < sorted.length) size *= 2;
  const slots = seedOrder(size).map((s) => sorted[s - 1]?.name ?? "");
  const out: Match[] = [];
  let prev: string[] = [], k = 0;
  for (let i = 0; i < size; i += 2) { const id = `M${++k}`; out.push({ id, round: 1, home: slots[i], away: slots[i + 1] }); prev.push(id); }
  let round = 2;
  while (prev.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) { const id = `M${++k}`; out.push({ id, round, home: `W:${prev[i]}`, away: `W:${prev[i + 1]}` }); next.push(id); }
    if (next.length === 1 && third && prev.length === 2) out.push({ id: `M${++k}`, round, home: `L:${prev[0]}`, away: `L:${prev[1]}` });
    prev = next; round++;
  }
  return out;
}

/** “21”“2(4)”“3:1” 中的一边 → {goals, pens}；空 → undefined；非法 → NaN。 */
export function parseSide(v: unknown): { g: number; p?: number } | undefined | null {
  const t = String(v ?? "").trim();
  if (!t) return undefined;
  const m = /^(\d+)\s*(?:[(（]\s*(\d+)\s*[)）])?$/.exec(t);
  return m ? { g: +m[1], p: m[2] !== undefined ? +m[2] : undefined } : null;
}

export interface Line { team: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }

export function standings(teams: string[], results: { home: string; away: string; hg: number; ag: number }[], pts: [number, number, number]) {
  const T = new Map(teams.map((t) => [t, { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 } as Line]));
  for (const r of results) {
    const h = T.get(r.home), a = T.get(r.away);
    if (!h || !a) continue;
    h.p++; a.p++; h.gf += r.hg; h.ga += r.ag; a.gf += r.ag; a.ga += r.hg;
    if (r.hg > r.ag) { h.w++; a.l++; h.pts += pts[0]; a.pts += pts[2]; }
    else if (r.hg < r.ag) { a.w++; h.l++; a.pts += pts[0]; h.pts += pts[2]; }
    else { h.d++; a.d++; h.pts += pts[1]; a.pts += pts[1]; }
  }
  const lines = [...T.values()];
  // 同分先看相互间战绩，再看净胜、总得分
  const h2h = (group: Line[]) => {
    const names = new Set(group.map((x) => x.team)), m = new Map(group.map((x) => [x.team, 0]));
    for (const r of results) if (names.has(r.home) && names.has(r.away)) {
      if (r.hg > r.ag) m.set(r.home, m.get(r.home)! + pts[0]); else if (r.hg < r.ag) m.set(r.away, m.get(r.away)! + pts[0]); else { m.set(r.home, m.get(r.home)! + pts[1]); m.set(r.away, m.get(r.away)! + pts[1]); }
    }
    return m;
  };
  const byPts = new Map<number, Line[]>(); for (const l of lines) byPts.set(l.pts, [...(byPts.get(l.pts) ?? []), l]);
  const hh = new Map<string, number>(); for (const g of byPts.values()) if (g.length > 1) for (const [k, v] of h2h(g)) hh.set(k, v);
  const tie: string[] = [];
  lines.sort((a, b) => b.pts - a.pts || (hh.get(b.team) ?? 0) - (hh.get(a.team) ?? 0) || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team, "zh-CN"));
  for (let i = 1; i < lines.length; i++) { const a = lines[i - 1], b = lines[i]; if (a.p && a.pts === b.pts && (hh.get(a.team) ?? 0) === (hh.get(b.team) ?? 0) && a.gf - a.ga === b.gf - b.ga && a.gf === b.gf) tie.push(`${a.team} / ${b.team}`); }
  return { lines, tie };
}
