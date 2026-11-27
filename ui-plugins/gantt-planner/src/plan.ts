/** 工作日排期、依赖推算与关键路径。 */
export interface Task { i: number; id: string; name: string; start: string; dur: number; deps: string[]; progress: number; owner: string }
export interface Sched { i: number; start: string; end: string; es: number; ef: number; slack: number; critical: boolean; moved: boolean }

const D = (x: string) => new Date(`${x}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function cal(holidays: Set<string>, weekends: boolean) {
  const work = (x: string) => !holidays.has(x) && (weekends || ![0, 6].includes(D(x).getUTCDay()));
  const next = (x: string, k = 1) => { const d = D(x); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
  const snap = (x: string) => { let y = x; while (!work(y)) y = next(y); return y; };
  /** 从 x 开始的第 n 个工作日（n=1 即 x 本身，x 不是工作日时先顺延）。 */
  const nth = (x: string, n: number) => { let y = snap(x); for (let k = 1; k < n; k++) { y = next(y); while (!work(y)) y = next(y); } return y; };
  const after = (x: string) => { let y = next(x); while (!work(y)) y = next(y); return y; };
  /** x 到 y（含）之间的工作日数。 */
  const between = (x: string, y: string) => { let n = 0; for (let z = x; z <= y; z = next(z)) if (work(z)) n++; return n; };
  return { work, nth, after, snap, between };
}

export function schedule(tasks: Task[], o: { projectStart: string; holidays: Set<string>; weekends: boolean }) {
  const c = cal(o.holidays, o.weekends);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const errors: { i: number; msg: string }[] = [];
  const order: Task[] = [], state = new Map<string, number>();
  const visit = (t: Task, path: string[]): void => {
    const st = state.get(t.id);
    if (st === 2) return;
    if (st === 1) { errors.push({ i: t.i, msg: `circular dependency: ${[...path, t.id].join(" → ")}` }); return; }
    state.set(t.id, 1);
    for (const d of t.deps) { const p = byId.get(d); if (p) visit(p, [...path, t.id]); }
    state.set(t.id, 2); order.push(t);
  };
  for (const t of tasks) visit(t, []);
  for (const t of tasks) for (const d of t.deps) if (!byId.has(d)) errors.push({ i: t.i, msg: `depends on unknown task “${d}”` });
  const s = new Map<string, Sched>();
  for (const t of order) {
    let start = t.start || o.projectStart, moved = false;
    for (const d of t.deps) { const p = s.get(d); if (!p) continue; const earliest = t.dur === 0 || byId.get(d)!.dur === 0 ? c.snap(p.end) : c.after(p.end); if (earliest > start) { if (t.start) moved = true; start = earliest; } }
    start = c.snap(start);
    const end = t.dur <= 0 ? start : c.nth(start, t.dur);
    s.set(t.id, { i: t.i, start, end, es: 0, ef: 0, slack: 0, critical: false, moved });
  }
  // 关键路径：以工作日为单位做正推/逆推
  const base = [...s.values()].reduce((a, x) => (x.start < a ? x.start : a), o.projectStart);
  const idx = (x: string) => c.between(base, x) - (c.work(x) ? 1 : 0);
  for (const t of order) { const x = s.get(t.id)!; x.es = Math.max(idx(x.start), ...t.deps.map((d) => s.get(d)?.ef ?? 0)); x.ef = x.es + Math.max(t.dur, 0); }
  const finish = Math.max(0, ...[...s.values()].map((x) => x.ef));
  const lf = new Map<string, number>();
  for (const t of [...order].reverse()) {
    const succ = tasks.filter((u) => u.deps.includes(t.id) && s.has(u.id));
    const own = s.get(t.id)!;
    const late = succ.length ? Math.min(...succ.map((u) => (lf.get(u.id) ?? finish) - Math.max(u.dur, 0))) : finish;
    lf.set(t.id, late);
    own.slack = Math.max(0, late - own.ef);
    own.critical = own.slack === 0;
  }
  const end = [...s.values()].reduce((a, x) => (x.end > a ? x.end : a), "");
  return { s, errors, end, start: base, workdays: end ? c.between(base, end) : 0 };
}
