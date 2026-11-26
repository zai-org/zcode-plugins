import { type Field, type Kind, type Shape } from "./infer.ts";

export interface Model { types: Map<string, Shape>; nameOf: Map<Shape, string>; over: Map<string, Field>; rootArray: boolean; rootName: string }

const IDENT = /^[A-Za-z_$][\w$]*$/;
const fieldOf = (m: Model, owner: string, key: string) => [...m.over.values()].find((f) => f.owner === owner && f.key === key);
const kindsOf = (sh: Shape, nullable?: boolean) => { const k = [...sh.kinds].filter((x) => x !== "null"); if (k.includes("integer") && k.includes("number")) k.splice(k.indexOf("integer"), 1); return { k: k as Kind[], nul: nullable ?? sh.kinds.has("null") }; };
const order = (m: Model) => [...m.types.keys()].reverse();
const comment = (d: string, pre: string, open = "/** ", close = " */") => (d ? `${pre}${open}${d}${close}\n` : "");

export function ts(m: Model): string {
  const t = (sh: Shape | undefined, nullable?: boolean): string => {
    if (!sh) return "unknown";
    const { k, nul } = kindsOf(sh, nullable);
    const parts = k.map((x) => x === "object" ? m.nameOf.get(sh)! : x === "array" ? (() => { const e = t(sh.items); return /[|]/.test(e) ? `(${e})[]` : `${e}[]`; })() : x === "integer" ? "number" : x);
    if (nul) parts.push("null");
    return parts.join(" | ") || (nul ? "null" : "unknown");
  };
  const out = [...m.types].map(([name, sh]) => `export interface ${name} {\n${[...sh.fields].map(([k, f]) => { const o = fieldOf(m, name, k); return `${comment(o?.description ?? "", "  ")}  ${IDENT.test(k) ? k : JSON.stringify(k)}${o?.optional ? "?" : ""}: ${t(f.shape, o?.nullable)};`; }).join("\n")}\n}`);
  if (m.rootArray) out.push(`export type ${m.rootName}List = ${m.rootName}[];`);
  return out.join("\n\n") + "\n";
}

export function zod(m: Model): string {
  const z = (sh: Shape | undefined, nullable?: boolean): string => {
    if (!sh) return "z.unknown()";
    const { k, nul } = kindsOf(sh, nullable);
    const f = [...sh.formats].filter(Boolean);
    const one = (x: Kind) => x === "string" ? `z.string()${f.length === 1 ? ({ "date-time": ".datetime({ offset: true })", date: ".date()", email: ".email()", uri: ".url()", uuid: ".uuid()" } as Record<string, string>)[f[0]] ?? "" : ""}` : x === "integer" ? "z.number().int()" : x === "number" ? "z.number()" : x === "boolean" ? "z.boolean()" : x === "object" ? m.nameOf.get(sh)! : x === "array" ? `z.array(${z(sh.items)})` : "z.unknown()";
    let s = k.length === 0 ? (nul ? "z.null()" : "z.unknown()") : k.length === 1 ? one(k[0]) : `z.union([${k.map(one).join(", ")}])`;
    if (nul && k.length) s += ".nullable()";
    return s;
  };
  const out = ['import { z } from "zod";'];
  for (const name of order(m)) {
    const sh = m.types.get(name)!;
    out.push(`export const ${name} = z.object({\n${[...sh.fields].map(([k, f]) => { const o = fieldOf(m, name, k); let s = z(f.shape, o?.nullable); if (o?.optional) s += ".optional()"; if (o?.description) s += `.describe(${JSON.stringify(o.description)})`; return `  ${IDENT.test(k) ? k : JSON.stringify(k)}: ${s},`; }).join("\n")}\n});\nexport type ${name} = z.infer<typeof ${name}>;`);
  }
  if (m.rootArray) out.push(`export const ${m.rootName}List = z.array(${m.rootName});`);
  return out.join("\n\n") + "\n";
}

export function jsonSchema(m: Model): string {
  const s = (sh: Shape | undefined, nullable?: boolean): Record<string, unknown> => {
    if (!sh) return {};
    const { k, nul } = kindsOf(sh, nullable);
    const one = (x: Kind): Record<string, unknown> => {
      if (x === "object") return { $ref: `#/$defs/${m.nameOf.get(sh)}` };
      if (x === "array") return { type: "array", items: s(sh.items) };
      const f = [...sh.formats].filter(Boolean);
      return x === "string" && f.length === 1 ? { type: "string", format: f[0] } : { type: x };
    };
    const list = k.map(one);
    if (nul) list.push({ type: "null" });
    return list.length === 1 ? list[0] : list.length ? { anyOf: list } : {};
  };
  const defs: Record<string, unknown> = {};
  for (const [name, sh] of m.types) {
    const props: Record<string, unknown> = {};
    const req: string[] = [];
    for (const [k, f] of sh.fields) { const o = fieldOf(m, name, k); props[k] = { ...s(f.shape, o?.nullable), ...(o?.description ? { description: o.description } : {}) }; if (!o?.optional) req.push(k); }
    defs[name] = { type: "object", properties: props, required: req, additionalProperties: true };
  }
  const root = m.rootArray ? { type: "array", items: { $ref: `#/$defs/${m.rootName}` } } : { $ref: `#/$defs/${m.rootName}` };
  return JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: m.rootName, ...root, $defs: defs }, null, 2) + "\n";
}

const pyName = (k: string) => { let s = k.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^\p{L}\p{N}_]+/gu, "_").toLowerCase(); if (!s || /^\d/.test(s)) s = `f_${s}`; return ["class", "from", "import", "def", "global", "lambda", "pass", "type", "id", "list", "dict"].includes(s) ? `${s}_` : s; };
export function python(m: Model): string {
  const t = (sh: Shape | undefined, nullable?: boolean): string => {
    if (!sh) return "Any";
    const { k, nul } = kindsOf(sh, nullable);
    const parts = k.map((x) => x === "object" ? `"${m.nameOf.get(sh)}"` : x === "array" ? `List[${t(sh.items)}]` : ({ string: "str", integer: "int", number: "float", boolean: "bool" } as Record<string, string>)[x] ?? "Any");
    let s = parts.length > 1 ? `Union[${parts.join(", ")}]` : parts[0] ?? "None";
    if (nul && parts.length) s = `Optional[${s}]`;
    return s;
  };
  const out = ["from __future__ import annotations\n\nfrom dataclasses import dataclass\nfrom typing import Any, List, Optional, Union"];
  for (const name of order(m)) {
    const sh = m.types.get(name)!;
    const rows = [...sh.fields].map(([k, f]) => ({ k, f, o: fieldOf(m, name, k) }));
    const lines = [...rows.filter((r) => !r.o?.optional), ...rows.filter((r) => r.o?.optional)].map(({ k, f, o }) => {
      const n = pyName(k);
      const ty = t(f.shape, o?.nullable);
      const note = [n !== k ? `JSON key: ${JSON.stringify(k)}` : "", o?.description ?? ""].filter(Boolean).join(" — ");
      return `    ${n}: ${o?.optional ? (ty.startsWith("Optional[") ? ty : `Optional[${ty}]`) + " = None" : ty}${note ? `  # ${note}` : ""}`;
    });
    out.push(`@dataclass\nclass ${name}:\n${lines.join("\n") || "    pass"}`);
  }
  return out.join("\n\n\n") + "\n";
}

export function go(m: Model, pkg = "models"): string {
  const exported = (k: string) => { const s = k.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => (w.toLowerCase() === "id" ? "ID" : w.toLowerCase() === "url" ? "URL" : w[0].toUpperCase() + w.slice(1))).join(""); return /^[A-Z]/.test(s) ? s : `F${s}`; };
  const t = (sh: Shape | undefined, nullable?: boolean, optional?: boolean): string => {
    if (!sh) return "any";
    const { k, nul } = kindsOf(sh, nullable);
    if (k.length !== 1) return "any";
    const x = k[0];
    const base = x === "object" ? m.nameOf.get(sh)! : x === "array" ? `[]${t(sh.items)}` : ({ string: [...sh.formats].includes("date-time") && sh.formats.size === 1 ? "time.Time" : "string", integer: "int64", number: "float64", boolean: "bool" } as Record<string, string>)[x] ?? "any";
    return (nul || optional) && x !== "array" ? `*${base}` : base;
  };
  const body = [...m.types].map(([name, sh]) => {
    const cols = [...sh.fields].map(([k, f]) => { const o = fieldOf(m, name, k); return [exported(k), t(f.shape, o?.nullable, o?.optional), `\`json:"${k}${o?.optional ? ",omitempty" : ""}"\``, o?.description ?? ""]; });
    const w0 = Math.max(0, ...cols.map((c) => c[0].length)), w1 = Math.max(0, ...cols.map((c) => c[1].length));
    const lines = cols.map((c) => `\t${c[0].padEnd(w0)} ${c[1].padEnd(w1)} ${c[2]}${c[3] ? ` // ${c[3]}` : ""}`);
    return `type ${name} struct {\n${lines.join("\n")}\n}`;
  }).join("\n\n");
  return `package ${pkg}\n\n${body.includes("time.Time") ? 'import "time"\n\n' : ""}${body}\n`;
}
