/** 简单排课：先排固定课和连堂，再按难度贪心放置，放不下时尝试挪走一节同班的课。 */
export interface Req { id: number; cls: string; subject: string; teacher: string; hours: number; room: string; fixed: number[]; double: boolean }
export interface Grid { days: number; periods: number; lunchAfter: number }
export interface Placed { req: number; slot: number }
export interface Result { placed: Placed[]; unplaced: { req: number; n: number; why: string }[]; fixedFail: { req: number; slot: number; why: string }[] }

export const DAY_ZH = ["一", "二", "三", "四", "五", "六", "日"];
export const slotName = (s: number, g: Grid) => `周${DAY_ZH[Math.floor(s / g.periods)]}第${(s % g.periods) + 1}节`;
export const slotShort = (s: number, g: Grid) => `${DAY_ZH[Math.floor(s / g.periods)]}${(s % g.periods) + 1}`;

/** “周一1”“周三下午”“周五6-7”“周二”“Mon 3” → 节次列表。 */
export function parseSlots(text: string, g: Grid): { slots: number[]; bad: string[] } {
  const slots: number[] = [], bad: string[] = [];
  const EN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (const part of text.split(/[,，;；、\s]+(?=周|星期|mon|tue|wed|thu|fri|sat|sun)/i).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(?:周|星期)([一二三四五六日天])\s*(.*)$/.exec(part) ?? /^(mon|tue|wed|thu|fri|sat|sun)\w*\s*(.*)$/i.exec(part);
    if (!m) { bad.push(part); continue; }
    const d = /[一二三四五六日天]/.test(m[1]) ? "一二三四五六日".indexOf(m[1] === "天" ? "日" : m[1]) : EN.indexOf(m[1].toLowerCase().slice(0, 3));
    if (d < 0 || d >= g.days) { bad.push(part); continue; }
    const rest = m[2].replace(/[第节]/g, "").trim();
    let ps: number[] = [];
    if (!rest || /全天|all/i.test(rest)) ps = Array.from({ length: g.periods }, (_, i) => i);
    else if (/上午|am|morning/i.test(rest)) ps = Array.from({ length: g.lunchAfter }, (_, i) => i);
    else if (/下午|pm|afternoon/i.test(rest)) ps = Array.from({ length: g.periods - g.lunchAfter }, (_, i) => i + g.lunchAfter);
    else for (const seg of rest.split(/[,，、]/)) {
      const r = /^(\d+)\s*(?:[-–~至到]\s*(\d+))?$/.exec(seg.trim());
      if (!r) { bad.push(part); ps = []; break; }
      for (let p = +r[1]; p <= +(r[2] ?? r[1]); p++) if (p >= 1 && p <= g.periods) ps.push(p - 1); else bad.push(part);
    }
    for (const p of ps) slots.push(d * g.periods + p);
  }
  return { slots: [...new Set(slots)], bad };
}

export function solve(reqs: Req[], g: Grid, o: { avoid: Map<string, Set<number>>; rooms: Map<string, number>; morning: Set<string> }): Result {
  const N = g.days * g.periods;
  const classAt = new Map<string, (number | undefined)[]>(), teacherAt = new Map<string, number[]>(), roomAt = new Map<string, number[]>();
  const cl = (c: string) => classAt.get(c) ?? (classAt.set(c, Array(N).fill(undefined)), classAt.get(c)!);
  const te = (t: string) => teacherAt.get(t) ?? (teacherAt.set(t, Array(N).fill(0)), teacherAt.get(t)!);
  const ro = (r: string) => roomAt.get(r) ?? (roomAt.set(r, Array(N).fill(0)), roomAt.get(r)!);
  const placed: Placed[] = [], unplaced: Result["unplaced"] = [], fixedFail: Result["fixedFail"] = [];
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const free = (r: Req, s: number) => s >= 0 && s < N && cl(r.cls)[s] === undefined && (!r.teacher || te(r.teacher)[s] === 0) && !(o.avoid.get(r.teacher)?.has(s)) && (!r.room || ro(r.room)[s] < (o.rooms.get(r.room) ?? 1));
  const put = (r: Req, s: number) => { cl(r.cls)[s] = r.id; if (r.teacher) te(r.teacher)[s]++; if (r.room) ro(r.room)[s]++; placed.push({ req: r.id, slot: s }); };
  const take = (r: Req, s: number) => { cl(r.cls)[s] = undefined; if (r.teacher) te(r.teacher)[s]--; if (r.room) ro(r.room)[s]--; placed.splice(placed.findIndex((x) => x.req === r.id && x.slot === s), 1); };
  const dayCount = (r: Req, d: number) => cl(r.cls).slice(d * g.periods, (d + 1) * g.periods).filter((id) => id !== undefined && byId.get(id)!.subject === r.subject).length;
  const cost = (r: Req, s: number) => {
    const d = Math.floor(s / g.periods), p = s % g.periods, same = dayCount(r, d);
    let c = same * (r.hours <= g.days ? 20 : 6);
    if (o.morning.has(r.subject) && p >= g.lunchAfter) c += 4;
    if (!o.morning.has(r.subject) && p < 2) c += 1;
    if (r.teacher) { const load = te(r.teacher).slice(d * g.periods, (d + 1) * g.periods).reduce((a, b) => a + b, 0); c += load >= 4 ? 6 : load * 0.5; }
    if (p === g.periods - 1) c += 1;
    return c + ((s * 7 + r.id * 3) % 11) / 100;
  };
  // 固定课
  const left = new Map<number, number>();
  for (const r of reqs) {
    let n = r.hours;
    for (const s of r.fixed) { if (n <= 0) break; if (free(r, s)) { put(r, s); n--; } else fixedFail.push({ req: r.id, slot: s, why: `fixed ${slotName(s, g)} is taken (${cl(r.cls)[s] !== undefined ? "class busy" : o.avoid.get(r.teacher)?.has(s) ? "teacher unavailable" : r.teacher && te(r.teacher)[s] ? "teacher busy" : "room full"})` }); }
    left.set(r.id, n);
  }
  const load = new Map<string, number>();
  for (const r of reqs) if (r.teacher) load.set(r.teacher, (load.get(r.teacher) ?? 0) + r.hours + (o.avoid.get(r.teacher)?.size ?? 0));
  const order = [...reqs].sort((a, b) => Number(b.double) - Number(a.double) || Number(!!b.room) - Number(!!a.room) || (load.get(b.teacher) ?? 0) - (load.get(a.teacher) ?? 0) || b.hours - a.hours || a.id - b.id);
  const best = (r: Req, pair: boolean) => {
    let bs = -1, bc = Infinity;
    for (let s = 0; s < N; s++) {
      if (!free(r, s)) continue;
      if (pair) { const p = s % g.periods; if (p === g.lunchAfter - 1 || p === g.periods - 1 || !free(r, s + 1)) continue; }
      const c = cost(r, s) + (pair ? cost(r, s + 1) : 0);
      if (c < bc) { bc = c; bs = s; }
    }
    return bs;
  };
  for (const r of order) {
    let n = left.get(r.id)!;
    if (r.double) while (n >= 2) { const s = best(r, true); if (s < 0) break; put(r, s); put(r, s + 1); n -= 2; }
    while (n > 0) {
      let s = best(r, false);
      if (s < 0) {
        // 挪一节同班的课：找一个只被同班其他课占着、而那节课能挪到别处的时段
        for (let t = 0; t < N && s < 0; t++) {
          const other = cl(r.cls)[t];
          if (other === undefined || other === r.id) continue;
          const x = byId.get(other)!;
          if (x.fixed.includes(t) || x.double) continue;
          take(x, t);
          if (free(r, t)) {
            put(r, t);
            const alt = best(x, false);
            if (alt >= 0) { put(x, alt); s = t; break; }
            take(r, t);
          }
          put(x, t);
        }
        if (s >= 0) { n--; continue; }
      }
      if (s < 0) break;
      put(r, s); n--;
    }
    if (n > 0) {
      const classFree = cl(r.cls).filter((x) => x === undefined).length;
      const why = classFree === 0 ? "the class has no free periods left" : r.teacher && te(r.teacher).every((v, s2) => v > 0 || cl(r.cls)[s2] !== undefined || o.avoid.get(r.teacher)?.has(s2)) ? `${r.teacher} is busy or unavailable whenever ${r.cls} is free` : r.room ? `room ${r.room} is full whenever both are free` : "no slot satisfies all constraints";
      unplaced.push({ req: r.id, n, why });
    }
  }
  return { placed, unplaced, fixedFail };
}
