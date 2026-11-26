type J = unknown;
const isObj = (v: J): v is Record<string, J> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 找出“记录数组”：对象元素最多的数组，返回路径。 */
export function findRecords(root: J): string {
  let best = { path: "", n: -1 };
  const walk = (v: J, path: string, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) {
      const n = v.filter(isObj).length;
      if (n > best.n) best = { path, n };
      return;
    }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(root, "", 0);
  return best.n >= 0 ? best.path : "";
}

export function getPath(root: J, path: string): J {
  if (!path) return root;
  let v: J = root;
  for (const k of path.split(".")) { if (isObj(v)) v = v[k]; else if (Array.isArray(v) && /^\d+$/.test(k)) v = v[Number(k)]; else return undefined; }
  return v;
}

export interface FlatOpts { arrays: "join" | "json"; explode: string; sep: string }

/** 把一条记录压平成 {a.b.c: 值}；explode 指定的对象数组会展开成多行。 */
export function flatten(rec: J, o: FlatOpts, arrayCols: Set<string>): Record<string, string>[] {
  const base: Record<string, string> = {};
  let exploded: Record<string, string>[] | undefined;
  const put = (v: J, key: string) => {
    if (key === o.explode && Array.isArray(v) && v.some(isObj)) {
      exploded = v.map((item) => { const r: Record<string, string> = {}; const inner = (x: J, k: string) => { if (isObj(x)) for (const [a, b] of Object.entries(x)) inner(b, `${k}.${a}`); else r[k] = scalar(x, k); }; inner(item, key); return r; });
      return;
    }
    if (isObj(v)) { const e = Object.entries(v); if (!e.length) base[key] = ""; for (const [k, x] of e) put(x, key ? `${key}.${k}` : k); return; }
    base[key] = scalar(v, key);
  };
  const scalar = (v: J, key: string): string => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) {
      if (o.arrays === "join" && v.every((x) => !isObj(x) && !Array.isArray(x))) { arrayCols.add(key); return v.map(String).join(o.sep); }
      return JSON.stringify(v);
    }
    if (isObj(v)) return JSON.stringify(v);
    return String(v);
  };
  if (isObj(rec)) put(rec, ""); else base.value = scalar(rec, "value");
  if (!exploded?.length) return [base];
  return exploded.map((e) => ({ ...base, ...e }));
}

export interface JsonOpts { nest: boolean; types: boolean; empty: "omit" | "null" | "string"; arrayCols: Set<string>; sep: string }

export function typed(v: string, o: JsonOpts): J {
  if (!o.types) return v;
  const s = v.trim();
  if (/^-?(0|[1-9]\d{0,9})(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (s === "null") return null;
  if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) { try { return JSON.parse(s); } catch { /* 当字符串 */ } }
  return v;
}

/** 表格一行 → JSON 对象（点号表头还原成嵌套）。 */
export function toObject(headers: string[], cells: string[], o: JsonOpts): Record<string, J> {
  const out: Record<string, J> = {};
  headers.forEach((h, i) => {
    const raw = cells[i] ?? "";
    let v: J;
    if (raw === "") { if (o.empty === "omit") return; v = o.empty === "null" ? null : ""; }
    else if (o.arrayCols.has(h)) v = raw.split(o.sep.trim() || ";").map((x) => typed(x.trim(), o)).filter((x) => x !== "");
    else v = typed(raw, o);
    if (!o.nest || !h.includes(".")) { out[h] = v; return; }
    const parts = h.split(".");
    let cur = out;
    for (const p of parts.slice(0, -1)) { if (!isObj(cur[p])) cur[p] = {}; cur = cur[p] as Record<string, J>; }
    cur[parts[parts.length - 1]] = v;
  });
  return out;
}
