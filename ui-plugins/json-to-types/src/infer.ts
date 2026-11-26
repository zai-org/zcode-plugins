export type Kind = "string" | "integer" | "number" | "boolean" | "null" | "object" | "array";
export interface Shape { kinds: Set<Kind>; fields: Map<string, { shape: Shape; count: number }>; objects: number; items?: Shape; formats: Set<string>; samples: string[] }

const empty = (): Shape => ({ kinds: new Set(), fields: new Map(), objects: 0, formats: new Set(), samples: [] });

function fmt(s: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) return "date-time";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "email";
  if (/^https?:\/\//.test(s)) return "uri";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "uuid";
  return "";
}

export function add(sh: Shape, v: unknown) {
  if (v === null) { sh.kinds.add("null"); return; }
  if (Array.isArray(v)) { sh.kinds.add("array"); sh.items ??= empty(); for (const x of v) add(sh.items, x); return; }
  if (typeof v === "object") {
    sh.kinds.add("object"); sh.objects++;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (!sh.fields.has(k)) sh.fields.set(k, { shape: empty(), count: 0 });
      const f = sh.fields.get(k)!; f.count++; add(f.shape, x);
    }
    return;
  }
  if (typeof v === "number") sh.kinds.add(Number.isInteger(v) ? "integer" : "number");
  else if (typeof v === "boolean") sh.kinds.add("boolean");
  else { sh.kinds.add("string"); const f = fmt(String(v)); sh.formats.add(f); }
  if (sh.samples.length < 3 && !sh.samples.includes(String(v))) sh.samples.push(String(v).slice(0, 40));
}

export function infer(samples: unknown[]): Shape { const s = empty(); for (const x of samples) add(s, x); return s; }

export const pascal = (s: string) => {
  const w = s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1));
  const r = w.join("") || "Item";
  return /^\d/.test(r) ? `T${r}` : r;
};
export const singular = (s: string) => (/ies$/i.test(s) ? s.slice(0, -3) + "y" : /(ss|us)$/i.test(s) ? s : /s$/i.test(s) ? s.slice(0, -1) : s + "Item");

export interface Field { path: string; key: string; owner: string; kind: string; optional: boolean; nullable: boolean; typeName: string; format: string; sample: string; description: string; emptyArray?: boolean }
/** 给所有对象类型起名并列出字段。 */
export function fields(root: Shape, rootName: string, names: Record<string, string> = {}): { types: Map<string, Shape>; list: Field[]; nameOf: Map<Shape, string> } {
  const types = new Map<string, Shape>();
  const nameOf = new Map<Shape, string>();
  const list: Field[] = [];
  const reserve = (want: string) => { let n = want, i = 2; while (types.has(n)) n = `${want}${i++}`; return n; };
  const visit = (sh: Shape, want: string, path: string) => {
    const obj = sh.kinds.has("object") ? sh : sh.items?.kinds.has("object") ? sh.items : sh.items?.items?.kinds.has("object") ? sh.items.items : undefined;
    if (!obj || nameOf.has(obj)) return;
    const name = reserve(names[path] || want);
    types.set(name, obj); nameOf.set(obj, name);
    for (const [k, f] of obj.fields) {
      const p = `${path}.${k}`;
      const childWant = f.shape.kinds.has("array") ? pascal(singular(k)) : pascal(k);
      const kinds = [...f.shape.kinds].filter((x) => x !== "null");
      list.push({ path: p.replace(/^\$\./, ""), key: k, owner: name, kind: kinds.join(" | ") || "null", optional: f.count < obj.objects, nullable: f.shape.kinds.has("null"), typeName: "", format: [...f.shape.formats].filter(Boolean).join(","), sample: f.shape.samples.join(" · "), description: "", emptyArray: f.shape.kinds.has("array") && !f.shape.items?.kinds.size });
      visit(f.shape, childWant, f.shape.kinds.has("array") ? `${p}[]` : p);
    }
  };
  visit(root, rootName, "$");
  return { types, list, nameOf };
}
