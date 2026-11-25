import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { generate } from "./codegen.ts";
import { type Api, type Op, loadApi, parseSpec, pascal } from "./openapi.ts";
import { type Verify, compile, examplesFile, runAgainstMock } from "./verify.ts";

export const NAME = "api-to-sdk";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STORE = ".api-to-sdk/sdks.json";
const SPEC_EXT = [".yaml", ".yml", ".json"];

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface Saved { spec: string; out: string; packageName: string; className: string; title: string; version: string; ops: number; generatedAt: string; verify?: Verify; warnings: string[] }

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 50) || "api";
const opSummary = (o: Op) => ({ id: o.id, method: o.method, path: o.path, tag: o.tag, summary: o.summary, params: o.params.map((p) => `${p.in}:${p.name}${p.required ? "*" : ""}`), body: o.body ? `${o.body.contentType}${o.body.required ? "*" : ""}` : null, success: o.success?.status ?? null, errors: o.errors.map((r) => r.status), auth: o.security.map((a) => a.join("+") || "none").join(" | ") || "none", derivedId: o.derivedId });

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const libDir = join(options.assetRoot, "types/ts-lib");
  const runtime = join(options.assetRoot, "runtime");
  const load = async (): Promise<Record<string, Saved>> => ((await ws.exists(STORE)) ? JSON.parse(await ws.readText(STORE)).sdks ?? {} : {});
  const save = async (all: Record<string, Saved>) => ws.write(STORE, JSON.stringify({ version: 1, sdks: all }, null, 1) + "\n");

  async function readApi(spec: string): Promise<Api> {
    if (!SPEC_EXT.some((e) => spec.toLowerCase().endsWith(e))) throw new KitError("unsupported", `Use an OpenAPI 3 file (${SPEC_EXT.join(", ")}).`);
    if (!(await ws.exists(spec))) throw new KitError("not_found", `${spec} not found.`);
    try { return loadApi(parseSpec(await ws.readText(spec), spec)); } catch (e) { throw new KitError("bad_spec", (e as Error).message); }
  }
  const describeTest = (v: Verify) => [
    `TypeScript (strict): ${v.compiled ? "compiled with no errors" : `${v.diagnostics.length} error(s)`}${v.exampleWarnings.length ? `; ${v.exampleWarnings.length} spec example(s) don't match their schema (see examples/all-operations.ts)` : ""}.`,
    ...v.diagnostics.slice(0, 15).map((d) => `  ✗ ${d.file}${d.line ? `:${d.line}` : ""} ${d.message}`),
    ...v.exampleWarnings.slice(0, 10).map((d) => `  ! ${d.file}${d.line ? `:${d.line}` : ""} ${d.message.split("\n")[0]}`),
    v.ops.length ? `Mock-server calls: ${v.passed}/${v.ops.length} operation(s) passed in ${(v.ms / 1000).toFixed(1)} s.` : "Mock-server calls skipped (compile failed).",
    ...v.ops.filter((o) => !o.ok).map((o) => `  ✗ ${o.op} (${o.method} ${o.path}): ${o.problems.join("; ")}`),
  ].join("\n");

  async function verify(api: Api, s: Saved, files: Record<string, string>): Promise<Verify> {
    const t0 = Date.now();
    const src = Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("src/")));
    const { diags, dist } = compile(src, libDir, true);
    const ex = diags.length ? { diags: [] } : compile({ ...src, "examples/all-operations.ts": files["examples/all-operations.ts"] }, libDir, false);
    const exampleWarnings = ex.diags.filter((d) => d.file.startsWith("examples/"));
    for (const [p, c] of Object.entries(dist)) await ws.write(`${s.out}/${p}`, c);
    const ops = diags.length ? [] : await runAgainstMock(api, dist, s.className);
    const passed = ops.filter((o) => o.ok).length;
    return { compiled: !diags.length, diagnostics: diags, exampleWarnings, ops, passed, failed: ops.length - passed + (diags.length ? 1 : 0), ms: Date.now() - t0 };
  }

  tool("sdk_inspect", {
    description: "Read an OpenAPI 3.0/3.1 spec (YAML or JSON) without writing anything: operations (method, path, parameters, body, responses, auth), schemas, security schemes and problems such as external or broken $refs, missing operationIds and duplicate ids.",
    input: { spec: z.string().describe("Workspace path of the OpenAPI file") }, readOnly: true, openPanel: true,
  }, async (i) => {
    const api = await readApi(i.spec);
    const all = await load();
    const saved = Object.values(all).find((x) => x.spec === i.spec) ?? null;
    return {
      text: [`${api.title} ${api.version} (OpenAPI ${api.openapi})${api.server ? ` — ${api.server}` : ""}: ${api.ops.length} operation(s), ${api.schemas.length} schema(s), auth: ${api.schemes.map((s) => `${s.name}=${s.type}`).join(", ") || "none"}.`, ...api.ops.map((o) => `  ${o.method.padEnd(6)} ${o.path} → ${o.id}${o.derivedId ? " (no operationId; derived)" : ""}`), api.warnings.length ? `Warnings:\n${api.warnings.map((w) => `  ! ${w}`).join("\n")}` : "No warnings."].join("\n"),
      structured: { kind: "api", spec: i.spec, api: { title: api.title, version: api.version, openapi: api.openapi, server: api.server, schemes: api.schemes, schemas: api.schemas, warnings: api.warnings, ops: api.ops.map(opSummary) }, saved },
    };
  });

  tool("sdk_generate", {
    description: "Generate a typed TypeScript SDK package from an OpenAPI 3 spec: types for every schema, a fetch-based client class with one method per operation (path/query/header parameters, JSON / multipart / form bodies, bearer / API key / basic auth, timeouts, ApiError with the parsed error body), README with an operation table, an example calling every operation, and a dependency-free mock server built from the spec's examples. Then verifies it: compiles with TypeScript strict, and calls every operation against the mock (checking the request matched the spec and the response was parsed, plus one documented error status).",
    input: {
      spec: z.string().describe("Workspace path of the OpenAPI file"),
      out: z.string().optional().describe("Output folder (default sdk/<api-name>)"),
      packageName: z.string().optional().describe("npm package name (default <api-name>-sdk)"),
      className: z.string().optional().describe("Client class name (default <ApiName>Client)"),
    },
    openPanel: true, timeoutMs: 180_000,
  }, async (i) => {
    const api = await readApi(i.spec);
    const all = await load();
    const prev = Object.values(all).find((x) => x.spec === i.spec && (!i.out || x.out === i.out));
    const base = slug(api.title.replace(/\b(api|openapi|rest)\b/gi, "")) || slug(basename(i.spec, extname(i.spec)));
    const className = i.className ?? prev?.className ?? `${pascal(api.title.replace(/\b(api|openapi|rest)\b/gi, "")) || "Api"}Client`;
    if (!/^[A-Z][A-Za-z0-9_]*$/.test(className)) throw new KitError("bad_name", `className must be a PascalCase identifier (got ${className}).`);
    const packageName = i.packageName ?? prev?.packageName ?? `${base}-sdk`;
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(packageName)) throw new KitError("bad_name", `Invalid npm package name: ${packageName}`);
    const out = (i.out ?? prev?.out ?? `sdk/${base}`).replace(/\\/g, "/").replace(/\/+$/, "");
    if (out === "." || out.startsWith("..") || out.startsWith("/")) throw new KitError("bad_out", "Choose an output folder inside the workspace.");
    const files: Record<string, string> = { ...generate(api, { className, packageName }) };
    files["examples/all-operations.ts"] = examplesFile(api, className, packageName);
    files["mock/mock.mjs"] = await readFile(join(runtime, "mock.mjs"), "utf8");
    files["mock/server.mjs"] = `#!/usr/bin/env node\n// Mock of ${api.title} built from mock/openapi.json. Usage: node mock/server.mjs [port]\nimport { readFileSync } from "node:fs";\nimport { startMock } from "./mock.mjs";\nconst spec = JSON.parse(readFileSync(new URL("./openapi.json", import.meta.url), "utf8"));\nconst m = await startMock(spec, Number(process.argv[2] ?? process.env.PORT ?? 4010), process.env.HOST ?? "127.0.0.1", { log: (l) => console.log(l) });\nconsole.log(\`Mock ${api.title.replace(/[`$\\]/g, "")} on http://127.0.0.1:\${m.port} (\${m.routes.length} operations). Use "Prefer: code=404" to get a documented error.\`);\n`;
    files["mock/openapi.json"] = JSON.stringify(api.root, null, 1) + "\n";
    files["package.json"] = JSON.stringify({ name: packageName, version: api.version.replace(/^v/, "").match(/^\d+\.\d+\.\d+/) ? api.version.replace(/^v/, "") : "0.1.0", description: `TypeScript client for ${api.title}`, type: "module", main: "dist/index.js", types: "dist/index.d.ts", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }, files: ["dist", "src"], scripts: { build: "tsc -p .", mock: "node mock/server.mjs", example: "npx tsx examples/all-operations.ts" }, engines: { node: ">=20" }, devDependencies: { typescript: "^6.0.2" } }, null, 2) + "\n";
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM", "DOM.Iterable"], declaration: true, outDir: "dist", rootDir: "src", skipLibCheck: true, types: [] }, include: ["src"] }, null, 2) + "\n";
    files["README.md"] = readme(api, className, packageName);
    for (const [p, c] of Object.entries(files)) await ws.write(`${out}/${p}`, c);
    const s: Saved = { spec: i.spec, out, packageName, className, title: api.title, version: api.version, ops: api.ops.length, generatedAt: new Date().toISOString(), warnings: api.warnings };
    s.verify = await verify(api, s, files);
    for (const k of Object.keys(all)) if (all[k].spec === i.spec && all[k].out !== out && prev && k === prev.out) delete all[k];
    all[out] = s; await save(all);
    return {
      text: [`Generated ${out}/ — ${packageName} (${className}) for ${api.title} ${api.version}: ${api.ops.length} method(s), ${api.schemas.length} type(s).`, describeTest(s.verify), api.warnings.length ? `Spec warnings:\n${api.warnings.map((w) => `  ! ${w}`).join("\n")}` : "", `Use it: import { ${className} } from "./${out}/dist/index.js" (or npm install ./${out}); mock: node ${out}/mock/server.mjs.`].filter(Boolean).join("\n"),
      structured: { kind: "sdk", saved: s, files: Object.keys(files).concat(Object.keys(s.verify.ops.length ? { "dist/": 1 } : {})), preview: files["src/client.ts"].slice(0, 12000) },
    };
  });

  tool("sdk_test", {
    description: "Re-verify a generated SDK: strict TypeScript compile and calls of every operation against a mock server built from the spec (for example after editing the spec or the generated code).",
    input: { out: z.string().describe("Generated SDK folder") }, readOnly: true, timeoutMs: 180_000,
  }, async (i) => {
    const all = await load();
    const s = all[i.out.replace(/\/+$/, "")];
    if (!s) throw new KitError("not_found", `No SDK generated at ${i.out}. Known: ${Object.keys(all).join(", ") || "none"}`);
    const api = await readApi(s.spec);
    const files: Record<string, string> = {};
    for (const p of ["src/types.ts", "src/client.ts", "src/index.ts", "examples/all-operations.ts"]) files[p] = await ws.readText(`${s.out}/${p}`);
    s.verify = await verify(api, s, files);
    await save(all);
    return { text: describeTest(s.verify), structured: { kind: "sdk", saved: s } };
  });

  tool("sdk_state", { description: "Panel state.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const all = Object.values(await load()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    const files = (await ws.list({ exts: SPEC_EXT })).map((f) => f.path).filter((f) => !/(^|\/)(package|tsconfig|package-lock)\.json$|\/mock\/openapi\.json$|^\.api-to-sdk\//.test(f));
    return { text: "", structured: { kind: all[0] ? "sdk" : "none", saved: all[0] ?? null, files } };
  });
  return server;
}

function readme(api: Api, cls: string, pkg: string) {
  const auth = api.schemes.map((s) => s.type === "bearer" || s.type === "oauth2" || s.type === "other" ? "`token`" : s.type === "apiKey" ? "`apiKey`" : "`basic`");
  return `# ${pkg}

TypeScript client for **${api.title}** ${api.version}, generated by API To SDK from the OpenAPI ${api.openapi} spec. No runtime dependencies (uses \`fetch\`; Node 20+, Deno, Bun, browsers).

## Build

\`\`\`bash
npm install && npm run build      # → dist/ (already built once by the generator)
\`\`\`

## Use

\`\`\`ts
import { ${cls}, ApiError } from "${pkg}";

const api = new ${cls}({${api.server ? "" : ' baseUrl: "https://…",'}${[...new Set(auth)].map((a) => ` ${a.slice(1, -1)}: ${a === "`basic`" ? '{ username: "…", password: "…" }' : '"…"'}`).join(",")} });
try {
  ${api.ops[0] ? `const result = await api.${api.ops[0].id}(${api.ops[0].params.some((p) => p.required) || api.ops[0].body?.required ? "{ /* … */ }" : ""});` : ""}
} catch (e) {
  if (e instanceof ApiError) console.error(e.status, e.body);
}
\`\`\`

Options: \`baseUrl\`${api.server ? ` (default \`${api.server}\`)` : ""}, ${[...new Set(auth)].join(", ")}${auth.length ? ", " : ""}\`headers\`, \`fetch\`, \`timeoutMs\`. Every method also takes \`{ headers, signal }\` as its last argument.

## Operations

| Method | HTTP | Summary |
|---|---|---|
${api.ops.map((o) => `| \`${o.id}\` | \`${o.method} ${o.path}\` | ${(o.summary ?? "").replace(/\|/g, "\\|")} |`).join("\n")}

## Mock server

\`\`\`bash
npm run mock        # http://127.0.0.1:4010, answers from the spec's examples and checks requests against the spec
\`\`\`

Send \`Prefer: code=404\` to get a documented error response. \`examples/all-operations.ts\` calls every operation with the spec's example values.
`;
}
