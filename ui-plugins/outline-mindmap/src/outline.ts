/** Markdown / 缩进文本 / OPML 大纲 → 节点列表（level 0 = 中心主题）。 */
export interface Item { level: number; text: string; note?: string }
export interface MNode { text: string; level: number; kids: MNode[]; color: string; idx: number; x: number; y: number; w: number; h: number; side: 1 | -1 }

const decode = (x: string) => x.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const clean = (x: string) => x.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

export function parseOutline(text: string, fallbackTitle: string): Item[] {
  if (/^\s*<\?xml|<opml/i.test(text)) return parseOpml(text, fallbackTitle);
  const items: Item[] = [];
  let head = 0, inCode = false;
  const lines = text.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  const indents: number[] = [];
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode || !raw.trim()) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) { head = h[1].length; items.push({ level: head, text: clean(h[2]) }); indents.length = 0; continue; }
    const b = /^(\s*)(?:[-*+]|\d+[.)、]|[•·])\s+(.*)$/.exec(raw);
    const ind = (b ? b[1] : /^(\s*)/.exec(raw)![1]).replace(/\t/g, "    ").length;
    const body = clean(b ? b[2] : raw);
    if (!b && !ind && !head && !items.length) { items.push({ level: 1, text: body }); continue; }
    while (indents.length && indents.at(-1)! > ind) indents.pop();
    if (!indents.length || indents.at(-1)! < ind) indents.push(ind);
    items.push({ level: head + indents.length, text: body });
  }
  return normalise(items, fallbackTitle);
}

function parseOpml(xml: string, fallback: string): Item[] {
  const items: Item[] = [];
  const title = /<title>([^<]*)<\/title>/i.exec(xml)?.[1];
  let depth = 0;
  for (const m of xml.matchAll(/<outline\b([^>]*?)(\/?)>|<\/outline>/gi)) {
    if (m[0].startsWith("</")) { depth--; continue; }
    const t = /\btext="([^"]*)"/i.exec(m[1])?.[1] ?? "";
    depth++;
    items.push({ level: depth, text: decode(t) });
    if (m[2] === "/") depth--;
  }
  if (title && !(items.length && items.filter((x) => x.level === 1).length === 1)) items.unshift({ level: 0, text: decode(title) });
  return normalise(items, fallback);
}

/** 只有一个最上层节点时把它当中心主题；否则用标题/文件名做中心主题。层级跳跃会被拉平。 */
function normalise(items: Item[], fallback: string): Item[] {
  if (!items.length) return [{ level: 0, text: fallback }];
  const min = Math.min(...items.map((x) => x.level));
  let out = items.map((x) => ({ ...x, level: x.level - min }));
  if (out.filter((x) => x.level === 0).length === 1 && out[0].level === 0) { /* 已有中心 */ }
  else out = [{ level: 0, text: fallback }, ...out.map((x) => ({ ...x, level: x.level + 1 }))];
  for (let i = 1; i < out.length; i++) if (out[i].level > out[i - 1].level + 1) out[i].level = out[i - 1].level + 1;
  for (let i = 1; i < out.length; i++) if (out[i].level < 1) out[i].level = 1;
  return out;
}

export function toTree(items: Item[], palette: string[]): MNode {
  const mk = (it: Item, idx: number): MNode => ({ text: it.text, level: it.level, kids: [], color: "", idx, x: 0, y: 0, w: 0, h: 0, side: 1 });
  const root = mk(items[0] ?? { level: 0, text: "" }, 0);
  const stack: MNode[] = [root];
  items.slice(1).forEach((it, k) => {
    const n = mk(it, k + 1);
    while (stack.length > it.level) stack.pop();
    stack.at(-1)!.kids.push(n);
    stack.push(n);
  });
  root.kids.forEach((b, i) => { const paint = (n: MNode) => { n.color = palette[i % palette.length]; n.kids.forEach(paint); }; paint(b); });
  return root;
}

export const BIN = (t: string, size: number) => [...t].reduce((a, ch) => a + (/[\u2e80-\uffff]/.test(ch) ? size : size * 0.58), 0);

/** 左右（或只向右）展开的树形布局。 */
export function layoutMap(root: MNode, o: { both: boolean; gapY: number; gapX: number }) {
  const fs = (n: MNode) => (n.level === 0 ? 20 : n.level === 1 ? 15 : 13);
  const measure = (n: MNode) => { n.w = Math.min(320, BIN(n.text, fs(n))) + (n.level <= 1 ? 28 : 8); n.h = n.level === 0 ? 48 : n.level === 1 ? 34 : 24; n.kids.forEach(measure); };
  measure(root);
  const span = (n: MNode): number => Math.max(n.h, n.kids.reduce((a, k) => a + span(k), 0) + o.gapY * Math.max(0, n.kids.length - 1));
  const place = (n: MNode, x: number, top: number, side: 1 | -1) => {
    const sp = span(n);
    n.side = side; n.y = top + sp / 2; n.x = x;
    let t = top + (sp - (n.kids.reduce((a, k) => a + span(k), 0) + o.gapY * Math.max(0, n.kids.length - 1))) / 2;
    for (const k of n.kids) { place(k, side === 1 ? x + n.w + o.gapX : x - n.w - o.gapX, t, side); t += span(k) + o.gapY; }
  };
  const right: MNode[] = [], left: MNode[] = [];
  if (o.both) {
    const total = root.kids.reduce((a, k) => a + span(k), 0);
    let acc = 0;
    for (const k of root.kids) { (acc < total / 2 ? right : left).push(k); acc += span(k); }
  } else right.push(...root.kids);
  const colH = (xs: MNode[]) => xs.reduce((a, k) => a + span(k), 0) + o.gapY * Math.max(0, xs.length - 1);
  const H = Math.max(root.h, colH(right), colH(left));
  root.x = 0; root.y = H / 2; root.side = 1;
  let t = (H - colH(right)) / 2;
  for (const k of right) { place(k, root.w / 2 + o.gapX, t, 1); t += span(k) + o.gapY; }
  t = (H - colH(left)) / 2;
  for (const k of left) { place(k, -root.w / 2 - o.gapX, t, -1); t += span(k) + o.gapY; }
  return H;
}
