import YAML from "yaml";
// @ts-expect-error plain JS runtime
import { deref, mediaExample, mediaKind, synth } from "./runtime/mock.mjs";

export type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Param { name: string; in: "path" | "query" | "header" | "cookie"; required: boolean; schema: Json; description?: string; example?: Json; ident: string; deprecated?: boolean }
export interface Body { required: boolean; contentType: string; kind: "json" | "multipart" | "form" | "text" | "binary"; schema?: Json; example?: Json }
export interface Resp { status: string; description?: string; contentType?: string; kind?: "json" | "text" | "binary" | "multipart" | "form"; schema?: Json; example?: Json }
export interface Op { id: string; method: string; path: string; tag?: string; summary?: string; description?: string; deprecated?: boolean; params: Param[]; body?: Body; responses: Resp[]; success?: Resp; errors: Resp[]; security: string[][]; derivedId: boolean }
export interface Scheme { name: string; type: "bearer" | "basic" | "apiKey" | "oauth2" | "other"; in?: "header" | "query" | "cookie"; param?: string }
export interface Api { root: Json; title: string; version: string; description?: string; server?: string; ops: Op[]; schemes: Scheme[]; schemas: string[]; warnings: string[]; openapi: string }

export function parseSpec(text: string, file = "spec"): Json {
  const t = text.replace(/^\uFEFF/, "");
  try { return /^\s*[{[]/.test(t) ? JSON.parse(t) : YAML.parse(t, { maxAliasCount: 1000 }); }
  catch (e) { throw new Error(`${file} is not valid ${/^\s*[{[]/.test(t) ? "JSON" : "YAML"}: ${(e as Error).message.split("\n")[0]}`); }
}

export const camel = (s: string) => {
  const parts = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  const c = parts.map((p, i) => (i === 0 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join("") || "x";
  return /^\d/.test(c) ? `_${c}` : c;
};
/** operationId → method name: keep camelCase ids as written, normalise others. */
export const methodName = (id: string) => (/^[a-z][A-Za-z0-9]*$/.test(id) ? id : camel(id));
export const pascal = (s: string) => { const c = camel(s); return c[0].toUpperCase() + c.slice(1); };
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(" "));
export const safeIdent = (s: string) => (RESERVED.has(s) ? `${s}_` : s);

export function loadApi(doc: Json): Api {
  if (!doc || typeof doc !== "object") throw new Error("The file does not contain an OpenAPI document.");
  if (doc.swagger) throw new Error(`This is a Swagger ${doc.swagger} (OpenAPI 2) document. Convert it to OpenAPI 3 first (for example with swagger2openapi or editor.swagger.io).`);
  if (!/^3\.[01]\./.test(String(doc.openapi ?? ""))) throw new Error(`Unsupported OpenAPI version “${doc.openapi ?? "(missing)"}”. Use OpenAPI 3.0 or 3.1.`);
  const root = doc, warnings: string[] = [];
  const d = (x: Json) => { try { return deref(root, x); } catch (e) { warnings.push((e as Error).message); return undefined; } };
  // every $ref must be local and resolvable
  const walk = (n: Json, path: string) => { if (!n || typeof n !== "object") return; if (typeof n.$ref === "string") { if (!n.$ref.startsWith("#/")) warnings.push(`External $ref not supported (treated as unknown): ${n.$ref} at ${path}`); else { try { deref(root, n); } catch { warnings.push(`Unresolvable $ref ${n.$ref} at ${path}`); } } return; } for (const [k, v] of Object.entries(n)) walk(v, `${path}/${k}`); };
  walk(doc.paths, "#/paths");
  const schemes: Scheme[] = Object.entries(doc.components?.securitySchemes ?? {}).map(([name, raw]) => {
    const s = d(raw) ?? {};
    if (s.type === "http" && /^bearer$/i.test(s.scheme)) return { name, type: "bearer" as const };
    if (s.type === "http" && /^basic$/i.test(s.scheme)) return { name, type: "basic" as const };
    if (s.type === "apiKey") return { name, type: "apiKey" as const, in: s.in, param: s.name };
    if (s.type === "oauth2" || s.type === "openIdConnect") return { name, type: "oauth2" as const };
    return { name, type: "other" as const };
  });
  const ops: Op[] = [];
  const used = new Map<string, number>();
  for (const [p, item0] of Object.entries<Json>(doc.paths ?? {})) {
    const item = d(item0) ?? {};
    for (const method of ["get", "put", "post", "delete", "patch", "head", "options", "trace"]) {
      const o = item[method];
      if (!o) continue;
      const derived = !o.operationId;
      let id = methodName(o.operationId ?? `${method} ${p.replace(/\{([^}]+)\}/g, "by $1")}`);
      const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) { warnings.push(`Duplicate operationId ${id}; renamed to ${id}${n + 1}`); id = `${id}${n + 1}`; }
      const merged = new Map<string, Json>();
      for (const raw of [...(item.parameters ?? []), ...(o.parameters ?? [])]) { const prm = d(raw); if (prm?.name && prm.in) merged.set(`${prm.in}:${prm.name}`, prm); }
      const idents = new Set<string>();
      const params: Param[] = [...merged.values()].filter((x) => x.in !== "cookie" || (warnings.push(`${id}: cookie parameter ${x.name} is not supported; skipped`), false)).map((x) => {
        let ident = safeIdent(camel(x.name)); while (idents.has(ident) || ident === "body") ident = `${ident}_`; idents.add(ident);
        const ex = x.example !== undefined ? x.example : x.examples ? d(Object.values(x.examples)[0])?.value : undefined;
        return { name: x.name, in: x.in, required: x.in === "path" ? true : !!x.required, schema: x.schema ?? (x.content ? Object.values<Json>(x.content)[0]?.schema : { type: "string" }) ?? {}, description: x.description, example: ex, ident, deprecated: x.deprecated };
      });
      for (const m of p.matchAll(/\{([^}]+)\}/g)) if (!params.find((x) => x.in === "path" && x.name === m[1])) { warnings.push(`${id}: path parameter {${m[1]}} is not declared; added as string`); params.push({ name: m[1], in: "path", required: true, schema: { type: "string" }, ident: safeIdent(camel(m[1])) }); }
      let body: Body | undefined;
      const rb = d(o.requestBody);
      if (rb?.content) {
        const entries = Object.entries<Json>(rb.content);
        const pick = entries.find(([k]) => mediaKind(k) === "json") ?? entries.find(([k]) => mediaKind(k) === "multipart") ?? entries.find(([k]) => mediaKind(k) === "form") ?? entries[0];
        if (pick) body = { required: !!rb.required, contentType: pick[0], kind: mediaKind(pick[0]), schema: pick[1]?.schema, example: mediaExample(root, pick[1]) };
      }
      const responses: Resp[] = Object.entries<Json>(o.responses ?? {}).map(([status, raw]) => {
        const r = d(raw) ?? {};
        const entries = Object.entries<Json>(r.content ?? {});
        const pick = entries.find(([k]) => mediaKind(k) === "json") ?? entries[0];
        return { status, description: r.description, contentType: pick?.[0], kind: pick ? mediaKind(pick[0]) : undefined, schema: pick?.[1]?.schema, example: pick ? mediaExample(root, pick[1]) : undefined };
      });
      const success = responses.find((r) => /^2\d\d$/.test(r.status)) ?? responses.find((r) => /^2XX$/i.test(r.status)) ?? responses.find((r) => r.status === "default");
      const sec = (o.security ?? doc.security ?? []) as Json[];
      ops.push({ id, method: method.toUpperCase(), path: p, tag: o.tags?.[0], summary: o.summary, description: o.description, deprecated: o.deprecated, params, body, responses, success, errors: responses.filter((r) => /^[45]\d\d$/.test(r.status) || /^[45]XX$/i.test(r.status) || (r.status === "default" && r !== success)), security: sec.map((s: Json) => Object.keys(s ?? {})), derivedId: derived });
    }
  }
  if (!ops.length) throw new Error("The spec has no operations under paths.");
  for (const op of ops) for (const alt of op.security) for (const s of alt) if (!schemes.find((x) => x.name === s)) warnings.push(`${op.id}: unknown security scheme ${s}`);
  for (const s of schemes) if (s.type === "oauth2" || s.type === "other") warnings.push(`Security scheme ${s.name} (${s.type}): pass an access token with the token option; the OAuth flow itself is not generated.`);
  const server = doc.servers?.[0]?.url ? String(doc.servers[0].url).replace(/\{(\w+)\}/g, (_: string, v: string) => doc.servers[0].variables?.[v]?.default ?? v) : undefined;
  return { root, title: doc.info?.title ?? "API", version: String(doc.info?.version ?? "0.0.0"), description: doc.info?.description, server, ops, schemes, schemas: Object.keys(doc.components?.schemas ?? {}), warnings, openapi: String(doc.openapi) };
}

/** Example arguments for an operation: from parameter/body examples, else synthesised. */
export function exampleArgs(api: Api, op: Op): Record<string, Json> {
  const args: Record<string, Json> = {};
  for (const p of op.params) {
    if (!p.required && p.example === undefined && p.in !== "path") continue;
    let v = p.example !== undefined ? p.example : synth(api.root, p.schema, 0, p.name);
    if (p.in === "path" && (v === null || v === undefined)) v = "1";
    args[p.ident] = v;
  }
  if (op.body) args.body = op.body.example !== undefined ? op.body.example : synth(api.root, op.body.schema ?? {}, 0);
  return args;
}
