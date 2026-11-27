/** 座位分配：网格（考场/教室）或圆桌（宴会），按规则贪心安排，可固定座位。 */
export interface Person { i: number; name: string; group: string; front: boolean; apart: string[]; together: string[]; fixed: string }
export interface Seat { id: string; r: number; c: number; table?: number; k?: number }
export type Layout = { kind: "grid"; rows: number; cols: number } | { kind: "tables"; tables: number; size: number };

export function seatsOf(l: Layout): Seat[] {
  const out: Seat[] = [];
  if (l.kind === "grid") for (let r = 1; r <= l.rows; r++) for (let c = 1; c <= l.cols; c++) out.push({ id: `R${r}C${c}`, r, c });
  else for (let t = 1; t <= l.tables; t++) for (let k = 1; k <= l.size; k++) out.push({ id: `T${t}-${k}`, r: t, c: k, table: t, k });
  return out;
}

export function neighbours(a: Seat, b: Seat, l: Layout) {
  if (l.kind === "grid") return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  if (a.table !== b.table) return false;
  const d = Math.abs(a.k! - b.k!);
  return d === 1 || d === l.size - 1;
}
export const sameTable = (a: Seat, b: Seat) => a.table !== undefined && a.table === b.table;

export function normSeat(x: string, kind: Layout["kind"] = "grid") {
  const t = x.trim().toUpperCase().replace(/\s+/g, "");
  const nums = t.match(/\d+/g);
  if (!nums || nums.length < 2) return t;
  const [a, b] = nums.map(Number);
  return kind === "tables" || /^T|桌/.test(t) ? `T${a}-${b}` : `R${a}C${b}`;
}

function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed: string) { let a = hash(seed) || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export interface Plan { seat: Map<number, string>; conflicts: { a: string; b: string; why: string }[]; unseated: number[]; badFixed: { i: number; seat: string; why: string }[] }

export function assign(people: Person[], l: Layout, o: { seed: string; separateGroups: boolean; groupTables: boolean }): Plan {
  const seats = seatsOf(l), byId = new Map(seats.map((x) => [x.id, x]));
  const taken = new Map<string, number>(), seat = new Map<number, string>(), badFixed: Plan["badFixed"] = [];
  const byName = new Map(people.map((p) => [p.name, p]));
  for (const p of people) {
    if (!p.fixed) continue;
    const id = normSeat(p.fixed, l.kind);
    if (!byId.has(id)) badFixed.push({ i: p.i, seat: p.fixed, why: "no such seat" });
    else if (taken.has(id)) badFixed.push({ i: p.i, seat: p.fixed, why: `already taken by ${people.find((x) => x.i === taken.get(id))?.name}` });
    else { taken.set(id, p.i); seat.set(p.i, id); }
  }
  const rand = rng(o.seed || "seat");
  const rest = people.filter((p) => !seat.has(p.i)).map((p) => ({ p, k: rand() }));
  rest.sort((a, b) => Number(b.p.front) - Number(a.p.front) || b.p.apart.length + b.p.together.length - (a.p.apart.length + a.p.together.length) || a.k - b.k);
  const near = (x: Seat) => seats.filter((y) => y !== x && neighbours(x, y, l));
  const linked = (a: Person, b: Person) => a.together.includes(b.name) || b.together.includes(a.name);
  const apart = (a: Person, b: Person) => a.apart.includes(b.name) || b.apart.includes(a.name);
  const groupSize = new Map<string, number>(); for (const p of people) groupSize.set(p.group, (groupSize.get(p.group) ?? 0) + 1);
  const queue = rest.map((x) => x.p);
  while (queue.length) {
    const p = queue.shift()!;
    let best: Seat | undefined, bestCost = Infinity;
    for (const x of seats) {
      if (taken.has(x.id)) continue;
      let cost = p.front ? (x.r - 1) * 10 : 0;
      for (const y of near(x)) {
        const q = taken.has(y.id) ? people.find((z) => z.i === taken.get(y.id))! : undefined;
        if (!q) continue;
        if (apart(p, q)) cost += 100;
        if (o.separateGroups && p.group && p.group === q.group) cost += 20;
        if (linked(p, q)) cost -= 50;
      }
      if (l.kind === "tables") {
        const mates = seats.filter((y) => sameTable(x, y) && taken.has(y.id)).map((y) => people.find((z) => z.i === taken.get(y.id))!);
        for (const q of mates) { if (apart(p, q)) cost += 60; if (linked(p, q)) cost -= 30; if (o.groupTables && p.group && q.group === p.group) cost -= 8; if (o.groupTables && p.group && q.group && q.group !== p.group) cost += 4; }
        if (o.groupTables && !mates.length) {
          const other = seats.filter((y) => taken.has(y.id) && people.find((z) => z.i === taken.get(y.id))!.group === p.group && p.group);
          if (other.length) cost += 6;
        }
      }
      const partner = p.together.map((n) => byName.get(n)).find((q) => q && seat.has(q.i));
      if (partner) { const ps = byId.get(seat.get(partner.i)!)!; if (!neighbours(x, ps, l) && !sameTable(x, ps)) cost += 40; }
      if (cost < bestCost) { bestCost = cost; best = x; }
    }
    if (!best) break;
    taken.set(best.id, p.i); seat.set(p.i, best.id);
    // 刚坐下的人，把要和他坐一起的人马上排到队首，趁旁边还有空位
    for (let j = queue.length - 1; j >= 0; j--) if (linked(p, queue[j])) queue.unshift(...queue.splice(j, 1));
  }
  const unseated = people.filter((p) => !seat.has(p.i)).map((p) => p.i);
  const conflicts: Plan["conflicts"] = [];
  const seen = new Set<string>();
  for (const p of people) for (const q of people) {
    if (p.i >= q.i || !seat.has(p.i) || !seat.has(q.i)) continue;
    const a = byId.get(seat.get(p.i)!)!, b = byId.get(seat.get(q.i)!)!;
    const adj = neighbours(a, b, l), table = sameTable(a, b);
    const key = `${p.i}-${q.i}`;
    if (apart(p, q) && (adj || table)) { conflicts.push({ a: p.name, b: q.name, why: "keep apart" }); seen.add(key); }
    else if (o.separateGroups && l.kind === "grid" && adj && p.group && p.group === q.group) conflicts.push({ a: p.name, b: q.name, why: `same group ${p.group}` });
    if (linked(p, q) && !adj && !table) conflicts.push({ a: p.name, b: q.name, why: "should sit together" });
  }
  return { seat, conflicts, unseated, badFixed };
}
