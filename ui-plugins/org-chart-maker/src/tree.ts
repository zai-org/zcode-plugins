/** 由“上级”列建树，并做自上而下的整齐布局。 */
export interface Person { i: number; name: string; title: string; dept: string; manager: string; collapsed: boolean }
export interface Node { p: Person; kids: Node[]; hidden: number; x: number; y: number; w: number; stack: boolean }

export function buildTree(people: Person[]) {
  const byName = new Map<string, Person>();
  const dup: number[] = [];
  for (const p of people) { if (byName.has(p.name)) dup.push(p.i); else byName.set(p.name, p); }
  const unknown: number[] = [], cycles: number[] = [];
  const parent = new Map<number, Person | undefined>();
  for (const p of people) {
    const m = p.manager ? byName.get(p.manager) : undefined;
    if (p.manager && !m) unknown.push(p.i);
    parent.set(p.i, m && m !== p ? m : undefined);
  }
  for (const p of people) {
    const seen = new Set<number>([p.i]);
    let q = parent.get(p.i);
    while (q) { if (seen.has(q.i)) { cycles.push(p.i); parent.set(p.i, undefined); break; } seen.add(q.i); q = parent.get(q.i); }
  }
  const nodes = new Map<number, Node>(people.filter((p) => !dup.includes(p.i)).map((p) => [p.i, { p, kids: [], hidden: 0, x: 0, y: 0, w: 0, stack: false }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) { const m = parent.get(n.p.i); const pn = m && nodes.get(m.i); if (pn) pn.kids.push(n); else roots.push(n); }
  return { roots, unknown, cycles, dup, count: nodes.size };
}

export const size = (n: Node): number => 1 + n.kids.reduce((a, k) => a + size(k), 0);

export interface Box { n: Node; x: number; y: number; level: number }
/** 返回每个可见方框的位置；collapsed 或超过 maxDepth 的子树折叠成“+N”。 */
export function layout(roots: Node[], o: { boxW: number; boxH: number; gapX: number; gapY: number; maxDepth: number; stackOver: number }) {
  const boxes: Box[] = [];
  const visible = (n: Node, level: number) => !(n.p.collapsed || level + 1 >= o.maxDepth);
  const width = (n: Node, level: number): number => {
    n.hidden = visible(n, level) ? 0 : size(n) - 1;
    const kids = visible(n, level) ? n.kids : [];
    n.stack = kids.length > o.stackOver && kids.every((k) => !k.kids.length);
    if (!kids.length) return (n.w = o.boxW);
    if (n.stack) return (n.w = o.boxW + 30);
    return (n.w = Math.max(o.boxW, kids.reduce((a, k) => a + width(k, level + 1), 0) + o.gapX * (kids.length - 1)));
  };
  const place = (n: Node, left: number, level: number) => {
    const y = level * (o.boxH + o.gapY);
    n.x = n.stack ? left : left + n.w / 2 - o.boxW / 2; n.y = y;
    boxes.push({ n, x: n.x, y, level });
    const kids = n.hidden || !visible(n, level) ? [] : n.kids;
    if (n.stack) kids.forEach((k, j) => { k.x = n.x + 30; k.y = y + (o.boxH + 14) * (j + 1) + o.gapY / 2; k.w = o.boxW; boxes.push({ n: k, x: k.x, y: k.y, level: level + 1 }); });
    else { let x = left + (n.w - (kids.reduce((a, k) => a + k.w, 0) + o.gapX * Math.max(0, kids.length - 1))) / 2; for (const k of kids) { place(k, x, level + 1); x += k.w + o.gapX; } }
  };
  let left = 0;
  for (const r of roots) { width(r, 0); place(r, left, 0); left += r.w + o.gapX * 2; }
  return boxes;
}
