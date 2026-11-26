export interface El { name: string; attrs: Record<string, string>; children: (El | string)[] }

const ent = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]));

/** 极简 XML 解析：够读 OOXML（无 DTD）。 */
export function parseXml(xml: string): El {
  const root: El = { name: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = ent(a[2] ?? a[3] ?? "");
      const el: El = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(ent(m[6]));
  }
  return root;
}
export const kids = (e: El | undefined, name?: string) => (e?.children.filter((c): c is El => typeof c !== "string" && (!name || c.name === name)) ?? []);
export const kid = (e: El | undefined, name: string) => kids(e, name)[0];
export function find(e: El | undefined, name: string): El | undefined {
  for (const c of kids(e)) { if (c.name === name) return c; const f = find(c, name); if (f) return f; }
  return undefined;
}
export function findAll(e: El | undefined, name: string, out: El[] = []): El[] {
  for (const c of kids(e)) { if (c.name === name) out.push(c); findAll(c, name, out); }
  return out;
}
export const text = (e: El): string => e.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
