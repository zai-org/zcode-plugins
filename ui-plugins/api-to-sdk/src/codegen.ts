import { type Api, type Json, type Op, type Resp, pascal } from "./openapi.ts";

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const prop = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));
const doc = (lines: (string | undefined)[], pad = "") => { const l = lines.filter(Boolean).flatMap((x) => String(x).replace(/\*\//g, "*\\/").split("\n")); return l.length ? `${pad}/**\n${l.map((x) => `${pad} * ${x}`.trimEnd()).join("\n")}\n${pad} */\n` : ""; };
const lit = (v: Json) => (typeof v === "string" ? JSON.stringify(v) : v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : "unknown");

export class TypeNamer {
  names = new Map<string, string>();
  constructor(schemas: string[]) {
    const used = new Set<string>(["ApiError", "ClientOptions", "RequestOptions"]);
    for (const s of schemas) { let n = pascal(s); if (/^\d/.test(n)) n = `T${n}`; let k = n, i = 2; while (used.has(k)) k = `${n}${i++}`; used.add(k); this.names.set(s, k); }
  }
  ref(ref: string) { const m = /^#\/components\/schemas\/(.+)$/.exec(ref); return m ? this.names.get(decodeURIComponent(m[1]).replace(/~1/g, "/").replace(/~0/g, "~")) : undefined; }
}

/** OpenAPI schema → TypeScript type expression. `ns` prefixes named types (e.g. "T."). */
export function tsType(root: Json, s: Json, namer: TypeNamer, ns = "", pad = "", depth = 0): string {
  if (s === true || s === undefined || s === null || (typeof s === "object" && !Object.keys(s).length)) return "unknown";
  if (s === false) return "never";
  if (depth > 12) return "unknown";
  if (typeof s.$ref === "string") {
    const n = namer.ref(s.$ref);
    if (n) return ns + n;
    try { let node: Json = root; for (const k of s.$ref.slice(2).split("/")) node = node[decodeURIComponent(k).replace(/~1/g, "/").replace(/~0/g, "~")]; return tsType(root, node, namer, ns, pad, depth + 1); } catch { return "unknown"; }
  }
  const nullable = s.nullable === true || (Array.isArray(s.type) && s.type.includes("null"));
  const withNull = (t: string) => (nullable && t !== "unknown" && !/\bnull$/.test(t) ? `${t} | null` : t);
  if (s.const !== undefined) return withNull(lit(s.const));
  if (Array.isArray(s.enum)) return withNull(s.enum.map(lit).join(" | ") || "never");
  const paren = (t: string) => (/[|&]/.test(t) && !/^\{[\s\S]*\}$/.test(t) ? `(${t})` : t);
  if (s.oneOf || s.anyOf) { const alts = [...new Set((s.oneOf || s.anyOf).map((x: Json) => tsType(root, x, namer, ns, pad, depth + 1)))] as string[]; const base = Object.keys(s).some((k) => k === "properties") ? ` & ${objectType(root, s, namer, ns, pad, depth)}` : ""; return withNull(alts.length > 1 ? (base ? `(${alts.join(" | ")})${base}` : alts.join(" | ")) : `${alts[0]}${base}`); }
  if (s.allOf) { const parts = s.allOf.map((x: Json) => paren(tsType(root, x, namer, ns, pad, depth + 1))); if (s.properties) parts.push(objectType(root, s, namer, ns, pad, depth)); return withNull(parts.join(" & ")); }
  const types: string[] = (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []).filter((t: string) => t !== "null");
  if (!types.length) { if (s.properties || s.additionalProperties !== undefined) types.push("object"); else if (s.items) types.push("array"); else return nullable ? "unknown" : "unknown"; }
  const one = (t: string): string => {
    switch (t) {
      case "string": return s.format === "binary" ? "Blob" : "string";
      case "integer": case "number": return "number";
      case "boolean": return "boolean";
      case "array": { const it = tsType(root, s.items ?? {}, namer, ns, pad, depth + 1); return /[|&\s]/.test(it) && !/^\{/.test(it) ? `Array<${it}>` : `${it}[]`; }
      case "object": return objectType(root, s, namer, ns, pad, depth);
      default: return "unknown";
    }
  };
  return withNull(types.map(one).join(" | "));
}

function objectType(root: Json, s: Json, namer: TypeNamer, ns: string, pad: string, depth: number): string {
  const props = Object.entries<Json>(s.properties ?? {});
  const req = new Set<string>(s.required ?? []);
  const inner = pad + "  ";
  const lines = props.map(([k, v]) => `${doc([v?.description, v?.deprecated ? "@deprecated" : undefined, v?.format && !["binary"].includes(v.format) ? `Format: ${v.format}` : undefined], inner)}${inner}${prop(k)}${req.has(k) ? "" : "?"}: ${tsType(root, v, namer, ns, inner, depth + 1)};`);
  const ap = s.additionalProperties;
  if (ap === true || (ap && typeof ap === "object")) lines.push(`${inner}[key: string]: ${ap === true ? "unknown" : props.length ? "unknown" : tsType(root, ap, namer, ns, inner, depth + 1)};`);
  if (!lines.length) return ap === false ? "Record<string, never>" : "Record<string, unknown>";
  return `{\n${lines.join("\n")}\n${pad}}`;
}

const respType = (api: Api, r: Resp | undefined, namer: TypeNamer, ns: string) => {
  if (!r || !r.contentType || r.status === "204") return "void";
  if (r.kind === "json") return r.schema ? tsType(api.root, r.schema, namer, ns) : "unknown";
  if (r.kind === "text") return "string";
  return "Blob";
};

export interface Files { [path: string]: string }

export function generate(api: Api, o: { className: string; packageName: string; mockPort?: number }): Files {
  const namer = new TypeNamer(api.schemas);
  const comps = api.root.components?.schemas ?? {};
  const types = [`// Generated by API To SDK from “${api.title}” ${api.version} (OpenAPI ${api.openapi}). Do not edit by hand; regenerate instead.\n`];
  for (const [name, s] of Object.entries<Json>(comps)) types.push(`${doc([s?.title && s.title !== name ? s.title : undefined, s?.description, s?.deprecated ? "@deprecated" : undefined])}export type ${namer.names.get(name)} = ${tsType(api.root, s, namer)};\n`);
  if (!Object.keys(comps).length) types.push("export {};\n");

  const bearer = api.schemes.some((s) => s.type === "bearer" || s.type === "oauth2" || s.type === "other");
  const apiKeys = api.schemes.filter((s) => s.type === "apiKey");
  const basic = api.schemes.some((s) => s.type === "basic");
  const opBlocks: string[] = [], argTypes: string[] = [];
  for (const op of api.ops) {
    const P = pascal(op.id);
    const fields = op.params.map((p) => `${doc([p.description, p.deprecated ? "@deprecated" : undefined, `${p.in} parameter \`${p.name}\``], "  ")}  ${p.ident}${p.required ? "" : "?"}: ${tsType(api.root, p.schema, namer, "T.", "  ")};`);
    if (op.body) {
      const bt = op.body.kind === "json" ? (op.body.schema ? tsType(api.root, op.body.schema, namer, "T.", "  ") : "unknown") : op.body.kind === "multipart" ? (op.body.schema ? `${tsType(api.root, op.body.schema, namer, "T.", "  ")} | FormData` : "FormData") : op.body.kind === "form" ? (op.body.schema ? `${tsType(api.root, op.body.schema, namer, "T.", "  ")} | URLSearchParams` : "URLSearchParams") : op.body.kind === "text" ? "string" : "Blob | ArrayBuffer | Uint8Array";
      fields.push(`${doc([`Request body (${op.body.contentType})`], "  ")}  body${op.body.required ? "" : "?"}: ${bt};`);
    }
    const hasArgs = fields.length > 0, argsOptional = !op.params.some((p) => p.required) && !op.body?.required;
    if (hasArgs) argTypes.push(`/** Arguments of {@link ${o.className}.${op.id}}. */\nexport interface ${P}Args {\n${fields.join("\n")}\n}\n`);
    argTypes.push(`/** Successful response of {@link ${o.className}.${op.id}} (${op.success?.status ?? "none"}). */\nexport type ${P}Response = ${respType(api, op.success, namer, "T.")};\n`);
    const errs = op.errors.filter((r) => r.kind === "json" && r.schema).map((r) => tsType(api.root, r.schema, namer, "T."));
    argTypes.push(`/** Error response bodies documented for ${op.id} (${op.errors.map((r) => r.status).join(", ") || "none"}); available as \`ApiError.body\`. */\nexport type ${P}ErrorBody = ${[...new Set(errs)].join(" | ") || "unknown"};\n`);
    const q = op.params.filter((p) => p.in === "query"), hdr = op.params.filter((p) => p.in === "header");
    const pathExpr = "`" + op.path.replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\{([^}]+)\}/g, (_, n) => `\${encodeURIComponent(String(args.${op.params.find((p) => p.in === "path" && p.name === n)!.ident}))}`) + "`";
    const sig = hasArgs ? `args: ${P}Args${argsOptional ? " = {}" : ""}, options: RequestOptions = {}` : "options: RequestOptions = {}";
    opBlocks.push(`${doc([op.summary, op.description && op.description !== op.summary ? op.description : undefined, `\`${op.method} ${op.path}\``, op.deprecated ? "@deprecated" : undefined, `@throws {ApiError} on a non-2xx response${op.errors.length ? ` (documented: ${op.errors.map((r) => r.status).join(", ")})` : ""}`], "  ")}  async ${op.id}(${sig}): Promise<${P}Response> {
    return this.request<${P}Response>({
      operation: ${JSON.stringify(op.id)}, method: ${JSON.stringify(op.method)}, path: ${hasArgs ? pathExpr : JSON.stringify(op.path)},${q.length ? `\n      query: { ${q.map((p) => `${JSON.stringify(p.name)}: args.${p.ident}`).join(", ")} },` : ""}${hdr.length ? `\n      headers: { ${hdr.map((p) => `${JSON.stringify(p.name)}: args.${p.ident}`).join(", ")} },` : ""}${op.body ? `\n      body: args.body, bodyType: ${JSON.stringify(op.body.kind)}, contentType: ${JSON.stringify(op.body.contentType)},` : ""}
      security: ${JSON.stringify(op.security)}, response: ${JSON.stringify(op.success?.status === "204" || !op.success?.contentType ? "none" : op.success.kind === "json" ? "json" : op.success.kind === "text" ? "text" : "blob")},
    }, options);
  }`);
  }
  const schemeMap = Object.fromEntries(api.schemes.map((s) => [s.name, s.type === "apiKey" ? { type: "apiKey", in: s.in, name: s.param } : { type: s.type }]));
  const client = `// Generated by API To SDK from “${api.title}” ${api.version}. Do not edit by hand; regenerate instead.
import type * as T from "./types.js";

export interface ClientOptions {
  /** Base URL of the API${api.server ? ` (default ${api.server})` : ""}. */
  baseUrl?: string;
${bearer ? `  /** Bearer / access token, or a function returning one (called per request). */\n  token?: string | (() => string | undefined | Promise<string | undefined>);\n` : ""}${apiKeys.length ? `  /** API key (${apiKeys.map((s) => `${s.in} \`${s.param}\``).join(", ")}). */\n  apiKey?: string;\n` : ""}${basic ? "  /** HTTP basic credentials. */\n  basic?: { username: string; password: string };\n" : ""}  /** Headers sent with every request. */
  headers?: Record<string, string>;
  /** Custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
  /** Abort requests after this many milliseconds. */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Extra headers for this request. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Thrown for every non-2xx response. \`body\` is the parsed JSON (or text) of the error response. */
export class ApiError<TBody = unknown> extends Error {
  constructor(readonly status: number, readonly body: TBody, readonly operation: string, readonly response: Response) {
    super(\`\${operation} failed with HTTP \${status}\${body && typeof body === "object" && "message" in body ? \`: \${String((body as { message: unknown }).message)}\` : ""}\`);
    this.name = "ApiError";
  }
}

interface Call {
  operation: string; method: string; path: string;
  query?: Record<string, unknown>; headers?: Record<string, unknown>;
  body?: unknown; bodyType?: "json" | "multipart" | "form" | "text" | "binary"; contentType?: string;
  security: string[][]; response: "json" | "text" | "blob" | "none";
}

const SCHEMES: Record<string, { type: string; in?: string; name?: string }> = ${JSON.stringify(schemeMap)};

${doc([`Client for ${api.title} ${api.version}.`, api.description?.split("\n")[0], "", "@example", "```ts", `const api = new ${o.className}({ ${bearer ? 'token: process.env.API_TOKEN' : apiKeys.length ? "apiKey: process.env.API_KEY" : `baseUrl: "${api.server ?? "https://api.example.com"}"`} });`, api.ops[0] ? `const result = await api.${api.ops[0].id}(${api.ops[0].params.some((p) => p.required) || api.ops[0].body?.required ? "{ /* … */ }" : ""});` : "", "```"])}export class ${o.className} {
  readonly baseUrl: string;
  constructor(private readonly options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? ${JSON.stringify(api.server ?? "")}).replace(/\\/+$/, "");
  }

${opBlocks.join("\n\n")}

  private async request<R>(c: Call, o: RequestOptions): Promise<R> {
    const url = new URL(this.baseUrl + c.path, this.baseUrl ? undefined : "http://localhost");
    for (const [k, v] of Object.entries(c.query ?? {})) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, String(x));
      else url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    const headers: Record<string, string> = { Accept: c.response === "json" ? "application/json" : "*/*", ...this.options.headers };
    for (const [k, v] of Object.entries(c.headers ?? {})) if (v !== undefined && v !== null) headers[k] = String(v);
    await this.authorize(c.security, headers, url);
    let body: BodyInit | undefined;
    if (c.body !== undefined) {
      if (c.bodyType === "json") { body = JSON.stringify(c.body); headers["Content-Type"] = c.contentType ?? "application/json"; }
      else if (c.bodyType === "multipart") body = c.body instanceof FormData ? c.body : toFormData(c.body as Record<string, unknown>);
      else if (c.bodyType === "form") { body = c.body instanceof URLSearchParams ? c.body : new URLSearchParams(Object.entries(c.body as Record<string, unknown>).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])); }
      else { body = c.body as BodyInit; if (c.contentType) headers["Content-Type"] = c.contentType; }
    }
    Object.assign(headers, o.headers);
    const signals = [o.signal, this.options.timeoutMs ? AbortSignal.timeout(this.options.timeoutMs) : undefined].filter((s): s is AbortSignal => !!s);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const res = await (this.options.fetch ?? globalThis.fetch)(url, { method: c.method, headers, body, signal });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = text ? JSON.parse(text) : undefined; } catch { /* keep text */ }
      throw new ApiError(res.status, parsed, c.operation, res);
    }
    if (c.response === "none" || res.status === 204) return undefined as R;
    if (c.response === "json") { const text = await res.text(); if (!text) return undefined as R; if (!/json/i.test(res.headers.get("content-type") ?? "json")) return text as R; return JSON.parse(text) as R; }
    if (c.response === "text") return (await res.text()) as R;
    return (await res.blob()) as R;
  }

  private async authorize(security: string[][], headers: Record<string, string>, url: URL) {
    for (const alternative of security) {
      const parts: (() => void)[] = [];
      let ok = true;
      for (const name of alternative) {
        const s = SCHEMES[name];
        if (!s) { ok = false; break; }
${bearer ? `        if (s.type === "bearer" || s.type === "oauth2" || s.type === "other") {
          const t = typeof this.options.token === "function" ? await this.options.token() : this.options.token;
          if (!t) { ok = false; break; }
          parts.push(() => { headers.Authorization = \`Bearer \${t}\`; });
        }
` : ""}${apiKeys.length ? `        if (s.type === "apiKey") {
          const k = this.options.apiKey;
          if (!k) { ok = false; break; }
          parts.push(() => { if (s.in === "query") url.searchParams.set(s.name!, k); else if (s.in === "cookie") headers.Cookie = \`\${s.name}=\${encodeURIComponent(k)}\`; else headers[s.name!] = k; });
        }
` : ""}${basic ? `        if (s.type === "basic") {
          const b = this.options.basic;
          if (!b) { ok = false; break; }
          parts.push(() => { headers.Authorization = \`Basic \${btoa(\`\${b.username}:\${b.password}\`)}\`; });
        }
` : ""}      }
      if (ok) { for (const p of parts) p(); return; }
    }
    void headers; void url;
  }
}

function toFormData(o: Record<string, unknown>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v === undefined || v === null) continue;
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x instanceof Blob ? x : typeof x === "object" ? JSON.stringify(x) : String(x));
  }
  return f;
}

${argTypes.join("\n")}`;
  const index = `export * from "./client.js";\nexport type * from "./types.js";\n`;
  return { "src/types.ts": types.join("\n"), "src/client.ts": client, "src/index.ts": index };
}
