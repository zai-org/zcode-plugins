import YAML from "yaml";

export type Flat = Map<string, string>;
export interface LocaleFile { code: string; file: string; format: "json" | "yaml"; nested: boolean; root?: string; indent: number; arrays: string[] }

const LOCALE_RE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;
export const looksLikeLocale = (s: string) => LOCALE_RE.test(s);

export function localeOf(file: string): string {
  const parts = file.split("/");
  const base = parts.pop()!.replace(/\.(json|ya?ml)$/i, "");
  if (looksLikeLocale(base)) return base;
  const parent = parts.pop();
  if (parent && looksLikeLocale(parent)) return parent;
  const m = /[._-]([a-z]{2}(?:[-_][A-Z]{2})?)$/.exec(base);
  return m ? m[1] : base;
}

export function flatten(obj: unknown, prefix = "", out: Flat = new Map(), arrays: string[] = []): { flat: Flat; arrays: string[]; nested: boolean } {
  let nested = false;
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) { arrays.push(path); nested = true; v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i))); }
    else if (v && typeof v === "object") { if (path) nested = true; for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k); }
    else out.set(path, v === null || v === undefined ? "" : String(v));
  };
  walk(obj, prefix);
  return { flat: out, arrays, nested };
}

export function parseLocale(file: string, text: string): { meta: LocaleFile; flat: Flat } {
  const yaml = /\.ya?ml$/i.test(file);
  let data: unknown;
  try { data = yaml ? YAML.parse(text) : JSON.parse(text.replace(/^\uFEFF/, "")); } catch (e) { throw new Error(`${file}: not valid ${yaml ? "YAML" : "JSON"} — ${(e as Error).message.split("\n")[0]}`); }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error(`${file}: the top level must be an object of keys.`);
  let code = localeOf(file);
  let root: string | undefined;
  const keys = Object.keys(data as object);
  if (keys.length === 1 && looksLikeLocale(keys[0]) && typeof (data as Record<string, unknown>)[keys[0]] === "object") { root = keys[0]; code = root; data = (data as Record<string, unknown>)[root]; }
  const { flat, arrays, nested } = flatten(data);
  const indent = /^\{\s*\n(\s+)"/.exec(text)?.[1].length ?? 2;
  return { meta: { code, file, format: yaml ? "yaml" : "json", nested, root, indent: yaml ? 2 : indent, arrays }, flat };
}

/** 按键顺序还原嵌套对象；有冲突（a 和 a.b 同时存在）时保留扁平键。 */
export function unflatten(entries: [string, string][], arrays: Set<string>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const parts = key.split(".");
    let cur: Record<string, unknown> = root;
    let ok = true;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] === undefined) cur[p] = {};
      if (typeof cur[p] !== "object") { ok = false; break; }
      cur = cur[p] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (ok && (cur[last] === undefined || typeof cur[last] !== "object")) cur[last] = value;
    else root[key] = value;
  }
  const fix = (o: Record<string, unknown>, path: string): unknown => {
    for (const [k, v] of Object.entries(o)) if (v && typeof v === "object") o[k] = fix(v as Record<string, unknown>, path ? `${path}.${k}` : k);
    const ks = Object.keys(o);
    if (arrays.has(path) && ks.length && ks.every((k, i) => k === String(i))) return ks.map((k) => o[k]);
    return o;
  };
  return fix(root, "") as Record<string, unknown>;
}

export function serialize(meta: LocaleFile, entries: [string, string][], nestedOverride?: boolean): string {
  const nested = nestedOverride ?? meta.nested;
  let obj: unknown = nested ? unflatten(entries, new Set(meta.arrays)) : Object.fromEntries(entries);
  if (meta.root) obj = { [meta.root]: obj };
  if (meta.format === "yaml") return YAML.stringify(obj, { lineWidth: 0 });
  return JSON.stringify(obj, null, meta.indent) + "\n";
}

const PH = /\{\{\s*([\w.-]+)\s*\}\}|\{([\w.-]+)(?=[,}\s])|%\{(\w+)\}|%(\d+\$)?[sdif@]|\$\{(\w+)\}/g;
export function placeholders(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(PH)) {
    if (m[1]) out.push(`{{${m[1]}}}`);
    else if (m[2]) out.push(`{${m[2]}}`);
    else if (m[3]) out.push(`%{${m[3]}}`);
    else if (m[5]) out.push(`\${${m[5]}}`);
    else out.push(m[0]);
  }
  return out.sort();
}
export const tags = (s: string) => [...s.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>/g)].map((m) => (m[0].startsWith("</") ? "/" : "") + m[1].toLowerCase()).sort();
