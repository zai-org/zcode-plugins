export interface Table { headers: string[]; rows: string[][] }
export interface Opts { keys: string[]; ignoreCase: boolean; ignoreSpace: boolean; tolerance: number }
export interface Change { key: string; kind: "added" | "removed" | "changed"; column: string; old: string; new: string; oldRow?: number; newRow?: number }
export interface Result { changes: Change[]; addedCols: string[]; removedCols: string[]; keys: string[]; dupKeys: string[]; same: number }

/** 自动挑选关键列：两边都非空且不重复的第一列。 */
export function autoKey(a: Table, b: Table): string[] {
  for (const h of a.headers) {
    if (!b.headers.includes(h)) continue;
    const ok = (t: Table) => { const i = t.headers.indexOf(h); const v = t.rows.map((r) => (r[i] ?? "").trim()); return v.every(Boolean) && new Set(v).size === v.length; };
    if (ok(a) && ok(b)) return [h];
  }
  return [];
}

export function diff(a: Table, b: Table, o: Opts): Result {
  const cols = a.headers.filter((h) => b.headers.includes(h));
  const addedCols = b.headers.filter((h) => !a.headers.includes(h));
  const removedCols = a.headers.filter((h) => !b.headers.includes(h));
  const norm = (v: string) => { let s = v ?? ""; if (o.ignoreSpace) s = s.replace(/\s+/g, " ").trim(); if (o.ignoreCase) s = s.toLowerCase(); return s; };
  const equal = (x: string, y: string) => {
    if (norm(x) === norm(y)) return true;
    const nx = Number(String(x).replace(/,/g, "")), ny = Number(String(y).replace(/,/g, ""));
    return String(x).trim() !== "" && String(y).trim() !== "" && !isNaN(nx) && !isNaN(ny) && Math.abs(nx - ny) <= o.tolerance;
  };
  const keyOf = (t: Table, r: string[], i: number) => (o.keys.length ? o.keys.map((k) => (r[t.headers.indexOf(k)] ?? "").trim()).join(" | ") : `#${i + 1}`);
  const index = (t: Table) => { const m = new Map<string, number>(); const dups: string[] = []; t.rows.forEach((r, i) => { const k = keyOf(t, r, i); if (m.has(k)) dups.push(k); else m.set(k, i); }); return { m, dups }; };
  const A = index(a), B = index(b);
  const changes: Change[] = [];
  let same = 0;
  const show = (t: Table, r: string[]) => t.headers.map((h, i) => `${h}=${r[i] ?? ""}`).filter((x) => !x.endsWith("=")).join("; ");
  for (const [k, ai] of A.m) {
    const bi = B.m.get(k);
    if (bi === undefined) { changes.push({ key: k, kind: "removed", column: "", old: show(a, a.rows[ai]), new: "", oldRow: ai }); continue; }
    let changed = false;
    for (const h of cols) {
      const x = a.rows[ai][a.headers.indexOf(h)] ?? "", y = b.rows[bi][b.headers.indexOf(h)] ?? "";
      if (!equal(x, y)) { changes.push({ key: k, kind: "changed", column: h, old: x, new: y, oldRow: ai, newRow: bi }); changed = true; }
    }
    if (!changed) same++;
  }
  for (const [k, bi] of B.m) if (!A.m.has(k)) changes.push({ key: k, kind: "added", column: "", old: "", new: show(b, b.rows[bi]), newRow: bi });
  return { changes, addedCols, removedCols, keys: o.keys, dupKeys: [...new Set([...A.dups, ...B.dups])], same };
}
