/** 解析常见的 CREATE TABLE / ALTER TABLE（MySQL、PostgreSQL、SQLite 写法）。 */
export interface Col { table: string; name: string; type: string; pk: boolean; nullable: boolean; unique: boolean; fk: string; comment: string; def: string }
export interface Table { name: string; comment: string; cols: Col[] }

const unq = (x: string) => x.trim().replace(/^[`"[]|[`"\]]$/g, "").replace(/^[`"[]|[`"\]]$/g, "");
const qname = (x: string) => unq(x.split(".").pop()!);
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const lit = (x?: string) => (x ?? "").replace(/^'|'$/g, "").replace(/''/g, "'");

/** 按顶层逗号切分（忽略括号和引号里的逗号）。 */
export function splitTop(body: string): string[] {
  const out: string[] = [];
  let depth = 0, q = "", cur = "";
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { q = ch; cur += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function matchParen(sql: string, open: number) {
  let depth = 0, q = "";
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (q) { if (ch === q) q = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { q = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
}

const IDENT = "(`[^`]+`|\"[^\"]+\"|\\[[^\\]]+\\]|[\\w.$\\u4e00-\\u9fff]+)";

export function parseDdl(input: string): { tables: Table[]; warnings: string[] } {
  const sql = strip(input);
  const fks: { table: string; col: string; ref: string }[] = [];
  const uniques: string[] = [];
  const tables: Table[] = [];
  const warnings: string[] = [];
  const re = new RegExp(`create\\s+(?:temporary\\s+|temp\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${IDENT}\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    const open = m.index + m[0].length - 1, close = matchParen(sql, open);
    if (close < 0) { warnings.push(`Unclosed CREATE TABLE ${qname(m[1])}`); break; }
    const t: Table = { name: qname(m[1]), comment: "", cols: [] };
    const tail = sql.slice(close + 1, sql.indexOf(";", close) < 0 ? undefined : sql.indexOf(";", close));
    t.comment = lit(/comment\s*=?\s*('(?:[^']|'')*')/i.exec(tail)?.[1]);
    const pks: string[] = [];
    for (const part of splitTop(sql.slice(open + 1, close))) {
      const head = part.replace(/^constraint\s+\S+\s+/i, "");
      let k: RegExpExecArray | null;
      if ((k = /^primary\s+key\s*\(([^)]*)\)/i.exec(head))) { pks.push(...k[1].split(",").map(qname)); continue; }
      if ((k = /^foreign\s+key\s*\(([^)]*)\)\s*references\s+(\S+?)\s*\(([^)]*)\)/i.exec(head))) {
        const cs = k[1].split(",").map(qname), rs = k[3].split(",").map(qname);
        cs.forEach((c, i) => fks.push({ table: t.name, col: c, ref: `${qname(k![2])}.${rs[i] ?? rs[0]}` }));
        continue;
      }
      if (/^(unique|key|index|check|fulltext|spatial|exclude)\b/i.test(head)) {
        const u = /^unique\s*(?:key|index)?\s*(?:\S+\s*)?\(([^)]*)\)/i.exec(head);
        if (u && !u[1].includes(",")) uniques.push(`${t.name}.${qname(u[1])}`);
        continue;
      }
      const cm = new RegExp(`^${IDENT}\\s+(.*)$`, "s").exec(part);
      if (!cm) continue;
      const rest = cm[2];
      const type = (/^([\w ]+?(?:\([^)]*\))?)(?=\s|$)/.exec(rest)?.[1] ?? rest.split(/\s/)[0]).replace(/\s+(not|null|primary|default|references|comment|unique|auto_increment|generated|check|collate|character)\b.*$/i, "").trim();
      const col: Col = { table: t.name, name: qname(cm[1]), type, pk: /primary\s+key/i.test(rest), nullable: !/not\s+null/i.test(rest) && !/primary\s+key/i.test(rest), unique: /\bunique\b/i.test(rest), fk: "", comment: lit(/comment\s+('(?:[^']|'')*')/i.exec(rest)?.[1]), def: (/default\s+('(?:[^']|'')*'|\S+)/i.exec(rest)?.[1] ?? "") };
      const r = /references\s+(\S+?)\s*\(([^)]*)\)/i.exec(rest);
      if (r) col.fk = `${qname(r[1])}.${qname(r[2])}`;
      t.cols.push(col);
    }
    for (const c of t.cols) if (pks.includes(c.name)) { c.pk = true; c.nullable = false; }
    tables.push(t);
    re.lastIndex = close;
  }
  const alter = new RegExp(`alter\\s+table\\s+(?:only\\s+)?${IDENT}\\s+add\\s+(?:constraint\\s+\\S+\\s+)?foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+${IDENT}\\s*\\(([^)]*)\\)`, "gi");
  while ((m = alter.exec(sql))) fks.push({ table: qname(m[1]), col: qname(m[2]), ref: `${qname(m[3])}.${qname(m[4])}` });
  const cmt = new RegExp(`comment\\s+on\\s+(table|column)\\s+${IDENT}\\s+is\\s+('(?:[^']|'')*')`, "gi");
  while ((m = cmt.exec(sql))) {
    const parts = m[2].split(".").map(unq);
    if (m[1].toLowerCase() === "table") { const t = tables.find((x) => x.name === parts.at(-1)); if (t) t.comment = lit(m[3]); }
    else { const t = tables.find((x) => x.name === parts.at(-2)); const c = t?.cols.find((x) => x.name === parts.at(-1)); if (c) c.comment = lit(m[3]); }
  }
  for (const f of fks.splice(0)) {
    const c = tables.find((t) => t.name === f.table)?.cols.find((x) => x.name === f.col);
    if (c) c.fk = f.ref; else warnings.push(`Foreign key on unknown column ${f.table}.${f.col}`);
  }
  for (const u of uniques.splice(0)) { const [t, c] = u.split("."); const col = tables.find((x) => x.name === t)?.cols.find((x) => x.name === c); if (col) col.unique = true; }
  return { tables, warnings };
}
export interface Box { name: string; x: number; y: number; w: number; h: number; col: number; row: number }
export interface Grid { boxes: Box[]; colX: number[]; colW: number[]; rowY: number[]; rowH: number[]; gapX: number; gapY: number }
export const ROW_H = 22, HEAD_H = 30;

const edgesOf = (tables: Table[]) => tables.flatMap((t) => t.cols.filter((c) => c.fk).map((c) => [t.name, c.fk.split(".")[0]] as [string, string])).filter(([a, b]) => a !== b && tables.some((t) => t.name === b));

/** 网格布局：先按连接数排，再两两交换位置，让有外键关系的表尽量相邻。 */
export function layout(tables: Table[], perRow: number, widthOf: (t: Table) => number): Grid {
  const deg = new Map(tables.map((t) => [t.name, 0]));
  const edges = edgesOf(tables);
  for (const [a, b] of edges) { deg.set(a, deg.get(a)! + 1); deg.set(b, deg.get(b)! + 1); }
  const order = [...tables].sort((a, b) => (deg.get(b.name)! - deg.get(a.name)!) || a.name.localeCompare(b.name));
  const pos = (i: number) => [i % perRow, Math.floor(i / perRow)];
  const cost = (ord: Table[]) => {
    const at = new Map(ord.map((t, i) => [t.name, pos(i)]));
    return edges.reduce((sum, [a, b]) => { const [ca, ra] = at.get(a)!, [cb, rb] = at.get(b)!; const dc = Math.abs(ca - cb), dr = Math.abs(ra - rb); return sum + dc + dr * 1.3 + (dc > 1 ? 3 : 0) + (dr > 1 ? 3 : 0) + (dc === 0 && dr === 0 ? 0 : dc && dr ? 0.6 : 0); }, 0);
  };
  let best = cost(order);
  for (let pass = 0; pass < 6 && order.length <= 60; pass++) {
    let improved = false;
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      [order[i], order[j]] = [order[j], order[i]];
      const c = cost(order);
      if (c < best - 1e-9) { best = c; improved = true; } else [order[i], order[j]] = [order[j], order[i]];
    }
    if (!improved) break;
  }
  const gapX = 90, gapY = 64;
  const colW: number[] = [], rowH: number[] = [];
  order.forEach((t, i) => { const [c, r] = pos(i); colW[c] = Math.max(colW[c] ?? 0, widthOf(t)); rowH[r] = Math.max(rowH[r] ?? 0, HEAD_H + t.cols.length * ROW_H); });
  const colX = colW.map((_, c) => 50 + colW.slice(0, c).reduce((a, b) => a + b + gapX, 0));
  const rowY = rowH.map((_, r) => 74 + rowH.slice(0, r).reduce((a, b) => a + b + gapY, 0));
  const boxes = order.map((t, i) => { const [c, r] = pos(i); return { name: t.name, x: colX[c], y: rowY[r], w: colW[c], h: HEAD_H + t.cols.length * ROW_H, col: c, row: r }; });
  return { boxes, colX, colW, rowY, rowH, gapX, gapY };
}
