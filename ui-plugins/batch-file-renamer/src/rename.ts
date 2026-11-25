import { extname } from "node:path";

export interface Rules {
  find: string; replace: string; regex: boolean; template: string; start: number; pad: number;
  case: "keep" | "lower" | "upper" | "title"; extCase: "keep" | "lower"; spaces: "keep" | "dash" | "underscore" | "remove"; sort: "name" | "mtime";
}
export interface FileInfo { path: string; mtime: string; override?: string }

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;
const title = (s: string) => s.replace(/(^|[\s_-])(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** 按规则算出新文件名（不含目录）。 */
export function newName(f: FileInfo, index: number, r: Rules): { name: string; error?: string } {
  const base = f.path.split("/").pop()!;
  const ext = extname(base);
  let stem = base.slice(0, base.length - ext.length);
  if (r.find) {
    if (r.regex) {
      let re: RegExp;
      try { re = new RegExp(r.find, "g"); } catch (e) { return { name: base, error: `Bad regular expression: ${(e as Error).message}` }; }
      stem = stem.replace(re, r.replace);
    } else stem = stem.split(r.find).join(r.replace);
  }
  const parent = f.path.split("/").slice(-2, -1)[0] ?? "";
  const n = String(r.start + index).padStart(r.pad, "0");
  let out = (r.template || "{name}").replace(/\{name\}/g, stem).replace(/\{n\}/g, n).replace(/\{date\}/g, f.mtime.slice(0, 10)).replace(/\{parent\}/g, parent).replace(/\{ext\}/g, ext.slice(1));
  if (r.spaces === "dash") out = out.replace(/\s+/g, "-");
  else if (r.spaces === "underscore") out = out.replace(/\s+/g, "_");
  else if (r.spaces === "remove") out = out.replace(/\s+/g, "");
  else out = out.replace(/\s{2,}/g, " ");
  if (r.case === "lower") out = out.toLowerCase();
  else if (r.case === "upper") out = out.toUpperCase();
  else if (r.case === "title") out = title(out.toLowerCase());
  out = out.replace(ILLEGAL, "_").trim().replace(/^\.+/, "");
  if (f.override?.trim()) {
    const o = f.override.trim().replace(ILLEGAL, "_");
    return { name: extname(o) ? o : o + (r.extCase === "lower" ? ext.toLowerCase() : ext) };
  }
  if (!out) return { name: base, error: "The rules produce an empty name" };
  return { name: out + (r.extCase === "lower" ? ext.toLowerCase() : ext) };
}

export interface Planned { from: string; to: string; changed: boolean; error?: string }

export function plan(files: FileInfo[], r: Rules, exists: (p: string) => boolean): Planned[] {
  const order = files.map((f, i) => ({ f, i })).sort((a, b) => (r.sort === "mtime" ? a.f.mtime.localeCompare(b.f.mtime) : 0) || a.f.path.localeCompare(b.f.path, "en", { numeric: true }));
  const rank = new Map(order.map((o, k) => [o.i, k]));
  const out = files.map((f, i) => {
    const { name, error } = newName(f, rank.get(i)!, r);
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    return { from: f.path, to: dir + name, changed: dir + name !== f.path, error };
  });
  const sources = new Set(files.map((f) => f.path.toLowerCase()));
  const count = new Map<string, number>();
  for (const p of out) count.set(p.to.toLowerCase(), (count.get(p.to.toLowerCase()) ?? 0) + 1);
  for (const p of out) {
    if (p.error) continue;
    if ((count.get(p.to.toLowerCase()) ?? 0) > 1) p.error = `Two files would get the same name: ${p.to.split("/").pop()} (add {n})`;
    else if (p.changed && !sources.has(p.to.toLowerCase()) && exists(p.to)) p.error = `A different file already has this name: ${p.to}`;
  }
  return out;
}
