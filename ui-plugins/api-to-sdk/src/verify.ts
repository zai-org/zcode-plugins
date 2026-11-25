import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { type Api, type Json, exampleArgs } from "./openapi.ts";
// @ts-expect-error plain JS runtime
import { startMock } from "./runtime/mock.mjs";

export interface Diag { file: string; line?: number; message: string }
export interface OpResult { op: string; method: string; path: string; ok: boolean; checks: string[]; problems: string[] }
export interface Verify { compiled: boolean; diagnostics: Diag[]; exampleWarnings: Diag[]; ops: OpResult[]; passed: number; failed: number; ms: number }

const OPTIONS: ts.CompilerOptions = {
  strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.esnext.disposable.d.ts"], types: [], declaration: true, sourceMap: false, outDir: "/pkg/dist", rootDir: "/pkg/src",
  skipLibCheck: true, noUnusedLocals: false, isolatedModules: true, verbatimModuleSyntax: false,
};

/** Compile files (paths relative to the package) in memory. Returns emitted dist files and diagnostics for each root group. */
export function compile(files: Record<string, string>, libDir: string, emit: boolean) {
  const vfs = new Map<string, string>(Object.entries(files).map(([p, s]) => [`/pkg/${p}`, s]));
  vfs.set("/pkg/package.json", JSON.stringify({ type: "module" }));
  const read = (f: string) => vfs.get(f) ?? (f.startsWith("/lib/") ? (() => { try { return readFileSync(join(libDir, f.slice(5)), "utf8"); } catch { return undefined; } })() : undefined);
  const out: Record<string, string> = {};
  const host: ts.CompilerHost = {
    getSourceFile: (f, v) => { const s = read(f); return s === undefined ? undefined : ts.createSourceFile(f, s, v, true); },
    getDefaultLibFileName: () => "/lib/lib.d.ts", getDefaultLibLocation: () => "/lib",
    writeFile: (f, data) => { if (f.startsWith("/pkg/dist/")) out[f.slice(5)] = data; },
    getCurrentDirectory: () => "/pkg", getCanonicalFileName: (f) => f, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    fileExists: (f) => read(f) !== undefined, readFile: read,
    directoryExists: (d) => d === "/lib" || [...vfs.keys()].some((k) => k.startsWith(d.endsWith("/") ? d : `${d}/`)), getDirectories: () => [],
  };
  const roots = [...vfs.keys()].filter((f) => /\.ts$/.test(f));
  const program = ts.createProgram(roots, { ...OPTIONS, rootDir: "/pkg", outDir: "/pkg/dist", noEmit: !emit }, host);
  const diags = ts.getPreEmitDiagnostics(program).map((d) => ({ file: d.file ? d.file.fileName.replace(/^\/pkg\//, "") : "", line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : undefined, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }));
  if (emit && !diags.length) program.emit();
  // dist/src/* → dist/*
  const dist: Record<string, string> = {};
  for (const [p, s] of Object.entries(out)) dist[p.replace(/^dist\/src\//, "dist/")] = s;
  return { diags, dist };
}

/** TS literal for a JSON example; {__blob:true} becomes a Blob. */
export function tsLiteral(v: Json, pad = ""): string {
  if (v && typeof v === "object" && v.__blob) return 'new Blob(["example"], { type: "application/octet-stream" })';
  if (Array.isArray(v)) return v.length ? `[${v.map((x) => tsLiteral(x, pad)).join(", ")}]` : "[]";
  if (v && typeof v === "object") { const e = Object.entries(v); if (!e.length) return "{}"; const inner = pad + "  "; return `{\n${e.map(([k, x]) => `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${tsLiteral(x, inner)}`).join(",\n")},\n${pad}}`; }
  return JSON.stringify(v ?? null);
}
const toRuntime = (v: Json): Json => (v && typeof v === "object" && v.__blob ? new Blob(["example"], { type: "application/octet-stream" }) : Array.isArray(v) ? v.map(toRuntime) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toRuntime(x)])) : v);

export function examplesFile(api: Api, className: string, pkg: string) {
  const lines = [`// Calls every operation once with the example values from the spec. Run against the bundled mock:`, `//   npm run mock   (in another terminal)   then   npx tsx examples/all-operations.ts`, `import { ${className}, ApiError } from "../src/index.js";`, "", `const api = new ${className}({ baseUrl: process.env.API_URL ?? "http://127.0.0.1:4010"${api.schemes.some((s) => s.type !== "apiKey" && s.type !== "basic") ? ', token: "test-token"' : ""}${api.schemes.some((s) => s.type === "apiKey") ? ', apiKey: "test-key"' : ""}${api.schemes.some((s) => s.type === "basic") ? ', basic: { username: "test", password: "test" }' : ""} });`, "", "export async function main() {"];
  for (const op of api.ops) {
    const args = exampleArgs(api, op);
    const has = op.params.length || op.body;
    lines.push(`  // ${op.method} ${op.path}`, `  console.log(${JSON.stringify(op.id)}, await api.${op.id}(${has ? tsLiteral(args, "  ") : ""}));`);
  }
  lines.push("}", "", "declare const process: { env: Record<string, string | undefined> };", `main().catch((e) => { console.error(e instanceof ApiError ? \`\${e.message} \${JSON.stringify(e.body)}\` : e); });`, `void ${JSON.stringify(pkg)};`, "");
  return lines.join("\n");
}

const eq = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

/** Load the emitted JS client and call every operation against a mock server built from the spec. */
export async function runAgainstMock(api: Api, dist: Record<string, string>, className: string): Promise<OpResult[]> {
  const mock = await startMock(api.root, 0);
  // fresh folder per run: ESM caches modules by URL, so a re-test must not import stale files
  const dir = mkdtempSync(join(tmpdir(), "api-to-sdk-run-"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  for (const [p, c] of Object.entries(dist)) if (p.endsWith(".js")) writeFileSync(join(dir, p.replace(/^dist\//, "")), c);
  try {
    const mod = await import(pathToFileURL(join(dir, "index.js")).href);
    const Client = mod[className], ApiError = mod.ApiError;
    const client = new Client({ baseUrl: `http://127.0.0.1:${mock.port}${new URL(api.server ?? "http://x/", "http://x").pathname.replace(/\/$/, "")}`, token: "test-token", apiKey: "test-key", basic: { username: "u", password: "p" } });
    const results: OpResult[] = [];
    for (const op of api.ops) {
      const r: OpResult = { op: op.id, method: op.method, path: op.path, ok: true, checks: [], problems: [] };
      const fail = (m: string) => { r.ok = false; r.problems.push(m); };
      const args = toRuntime(exampleArgs(api, op));
      const has = op.params.length || op.body;
      const before = mock.calls.length;
      try {
        const res = await (has ? client[op.id](args) : client[op.id]());
        const call = mock.calls[before];
        if (!call) fail("the request never reached the mock");
        else {
          if (call.method !== op.method) fail(`sent ${call.method}, expected ${op.method}`);
          if (call.errors.length) fail(`mock rejected the request: ${call.errors.join("; ")}`);
          for (const p of op.params.filter((x) => x.in === "path")) if (String(call.pathParams[p.name]) !== String(args[p.ident])) fail(`path parameter ${p.name} = ${call.pathParams[p.name]}`);
          for (const p of op.params.filter((x) => x.in === "query" && args[x.ident] !== undefined)) if (!eq(call.query[p.name], args[p.ident])) fail(`query ${p.name} = ${JSON.stringify(call.query[p.name])}, expected ${JSON.stringify(args[p.ident])}`);
          for (const p of op.params.filter((x) => x.in === "header" && args[x.ident] !== undefined)) if (call.headers[p.name.toLowerCase()] !== String(args[p.ident])) fail(`header ${p.name} missing`);
          if (op.body?.kind === "json" && !eq(call.body, args.body)) fail("JSON body differs from what was passed");
          const needs = op.security.length && !op.security.some((alt) => alt.length === 0);
          if (needs) { const auth = call.headers.authorization || api.schemes.filter((s) => s.type === "apiKey").some((s) => s.in === "header" ? call.headers[String(s.param).toLowerCase()] : s.in === "query" ? call.query !== undefined : false); if (!auth) fail("no credentials sent"); }
          if (!r.problems.length) r.checks.push(`request: ${op.method} ${call.path}${Object.keys(call.query).length ? ` ?${Object.keys(call.query).join("&")}` : ""}${op.body ? ` + ${op.body.kind} body` : ""} matched the spec`);
          if (op.success?.status === "204" || !op.success?.contentType) { if (res !== undefined) fail("expected no body"); else r.checks.push("response: empty (204)"); }
          else if (op.success.kind === "json" || op.success.kind === "text") { if (!eq(res, call.response)) fail(`response differs: got ${JSON.stringify(res)?.slice(0, 120)}`); else r.checks.push(`response: ${op.success.status} ${op.success.kind} parsed`); }
          else r.checks.push(`response: ${op.success.status} blob`);
        }
      } catch (e) { fail(`threw: ${(e as Error).message}`); }
      const err = op.errors.find((x) => /^[45]\d\d$/.test(x.status));
      if (err) {
        try { await (has ? client[op.id](args, { headers: { Prefer: `code=${err.status}` } }) : client[op.id]({ headers: { Prefer: `code=${err.status}` } })); fail(`expected ApiError for ${err.status}`); }
        catch (e) {
          const x = e as { status?: number; body?: unknown };
          if (!(e instanceof ApiError) || x.status !== Number(err.status)) fail(`error ${err.status}: got ${(e as Error).message}`);
          else if (err.kind === "json" && err.example !== undefined && !eq(x.body, mock.calls[mock.calls.length - 1]?.response)) fail(`error ${err.status}: body not parsed`);
          else r.checks.push(`error: ${err.status} → ApiError with parsed body`);
        }
      }
      results.push(r);
    }
    return results;
  } finally { await mock.close(); rmSync(dir, { recursive: true, force: true }); }
}
