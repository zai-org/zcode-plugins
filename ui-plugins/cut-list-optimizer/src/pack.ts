/** 断头锯（guillotine）排版：最佳短边适配 + 较短轴切分；尺寸含锯缝。 */
export interface Part { id: number; w: number; h: number; canRotate: boolean }
export interface Placed { id: number; x: number; y: number; w: number; h: number; rotated: boolean }
export interface Sheet { placed: Placed[]; free: { x: number; y: number; w: number; h: number }[] }

export function pack(parts: Part[], W: number, H: number, kerf: number): { sheets: Sheet[]; failed: number[] } {
  const sheets: Sheet[] = [], failed: number[] = [];
  const order = [...parts].sort((a, b) => b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h));
  const fits = (r: { w: number; h: number }, w: number, h: number) => w <= r.w + 1e-9 && h <= r.h + 1e-9;
  const tryPlace = (sh: Sheet, p: Part) => {
    let best: { k: number; rot: boolean; score: number } | null = null;
    sh.free.forEach((r, k) => {
      for (const rot of p.canRotate ? [false, true] : [false]) {
        const w = (rot ? p.h : p.w) + kerf, h = (rot ? p.w : p.h) + kerf;
        if (!fits(r, w, h)) continue;
        const score = Math.min(r.w - w, r.h - h) * 1e6 + Math.max(r.w - w, r.h - h);
        if (!best || score < best.score) best = { k, rot, score };
      }
    });
    if (!best) return false;
    const { k, rot } = best as { k: number; rot: boolean }, r = sh.free[k];
    const w = (rot ? p.h : p.w) + kerf, h = (rot ? p.w : p.h) + kerf;
    sh.placed.push({ id: p.id, x: r.x, y: r.y, w: rot ? p.h : p.w, h: rot ? p.w : p.h, rotated: rot });
    sh.free.splice(k, 1);
    const rw = r.w - w, rh = r.h - h;
    // 沿较短的剩余边切：保留较大的整块
    if (rw < rh) { if (rw > 0) sh.free.push({ x: r.x + w, y: r.y, w: rw, h }); if (rh > 0) sh.free.push({ x: r.x, y: r.y + h, w: r.w, h: rh }); }
    else { if (rw > 0) sh.free.push({ x: r.x + w, y: r.y, w: rw, h: r.h }); if (rh > 0) sh.free.push({ x: r.x, y: r.y + h, w, h: rh }); }
    return true;
  };
  for (const p of order) {
    if (!fits({ w: W, h: H }, p.w + kerf, p.h + kerf) && !(p.canRotate && fits({ w: W, h: H }, p.h + kerf, p.w + kerf))) { failed.push(p.id); continue; }
    if (sheets.some((sh) => tryPlace(sh, p))) continue;
    const sh: Sheet = { placed: [], free: [{ x: 0, y: 0, w: W, h: H }] };
    sheets.push(sh); tryPlace(sh, p);
  }
  return { sheets, failed };
}

/** 封边写法：“四边”“全封”“2长1短”“L2W1”“长边”“1L” → {l, w} 条数。 */
export function edgeOf(v: string): { l: number; w: number } | null {
  const t = v.trim().toUpperCase();
  if (!t || /^(无|不封|NONE|-|0)$/.test(t)) return { l: 0, w: 0 };
  if (/四边|全封|ALL|4边/.test(t)) return { l: 2, w: 2 };
  let l = 0, w = 0, ok = false;
  for (const m of t.matchAll(/([LW])(\d)?/g)) { ok = true; if (m[1] === "L") l += Number(m[2] ?? 1); else w += Number(m[2] ?? 1); }
  for (const m of t.matchAll(/(\d)?\s*(长|短|宽)边?/g)) { ok = true; if (m[2] === "长") l += Number(m[1] ?? 1); else w += Number(m[1] ?? 1); }
  return ok && l <= 2 && w <= 2 ? { l, w } : null;
}
