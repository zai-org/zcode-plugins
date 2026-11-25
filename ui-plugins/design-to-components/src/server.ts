import { statSync } from "node:fs";
import { dirname as fitDirname } from "node:path";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import vm from "node:vm";
import * as React from "react";
import * as JSXRT from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { bundleCatalog, bundleSsr } from "./bundle.ts";
import { type CodeIssue, typecheck } from "./compile.ts";
import { DEFAULT_TOKENS, GROUPS, type Tokens, tokensCss, tokensTs, validateTokens } from "./tokens.ts";

export const NAME = "design-to-components";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PROJECT = ".design-to-components/project.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface PlanItem { name: string; description?: string; states: string[] }
interface Kit { slug: string; name: string; dir: string; design: string[]; plan: PlanItem[] }
interface Project { version: 1; kits: Kit[]; current: string }
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ui-kit";
const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

export const CATALOG_CSS = `.dc-catalog{font-family:var(--font-body,system-ui,sans-serif);color:var(--color-text,#111);background:#fff;padding:24px;min-height:100vh;box-sizing:border-box}
.dc-catalog.dc-dark{background:#1f2023;color:#eee}.dc-head{display:flex;justify-content:space-between;align-items:center}.dc-head h1{font-size:22px;margin:0}
.dc-nav{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 8px;font-size:13px}.dc-comp{margin:22px 0}.dc-comp h2{font-size:15px;margin:0 0 10px;font-family:ui-monospace,monospace}
.dc-examples{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start}.dc-examples figure{margin:0;border:1px dashed #d0d5dd;border-radius:8px;padding:16px;min-width:180px;max-width:100%}
.dc-examples figcaption{font-size:11px;color:#667085;margin-top:10px;font-family:system-ui,sans-serif}.dc-stage{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dc-error{color:#b42318;font:12px ui-monospace,monospace;white-space:pre-wrap}`;

/** 从目标目录往上找：第一个已存在的路径如果是文件，返回它（相对工作区）。 */
function fileInTheWay(ws: Workspace, rel: string): string | null {
  let p = ws.resolve(rel);
  while (p !== ws.root && p.startsWith(ws.root)) {
    const st = statSync(p, { throwIfNoEntry: false });
    if (st) return st.isDirectory() ? null : ws.rel(p);
    p = fitDirname(p);
  }
  return null;
}

/**
 * 组件文件都平铺在 src/。常见的嵌套写法 src/components/Button/Button.tsx、src/Button/Button.css、
 * components/Button.tsx 会被平铺成 src/Button.tsx；其它嵌套（例如 src/a/b/index.ts）仍然拒绝。
 */
export function flatName(f: string): string | null {
  const n = posix.normalize(f.replace(/^\.?\//, "")).replace(/^src\//, "");
  if (!/\.(tsx|ts|css)$/.test(n) || n.startsWith("..")) return null;
  const parts = n.split("/");
  const file = parts.at(-1)!, stem = file.replace(/\.(tsx|ts|css)$/, "");
  const dirs = parts.slice(0, -1);
  if (dirs[0] === "components") dirs.shift();
  if (dirs.length === 0) return file;
  if (dirs.length === 1 && dirs[0] === stem && stem !== "index") return file;
  return null;
}
/** 平铺后修正相对导入：../../tokens → ../tokens，./components/X/X 或 ../X/X → ./X。 */
export function fixImports(src: string): string {
  return src
    .replace(/(["'])(?:\.\.\/)+tokens(["'])/g, "$1../tokens$2")
    .replace(/(["'])(?:\.\/|\.\.\/)+(?:components\/)?([A-Za-z0-9_]+)\/\2(\.css)?(["'])/g, "$1./$2$3$4");
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const typesRoot = join(options.assetRoot, "types");
  let vendor: string | undefined;

  const load = async (): Promise<Project | undefined> => ((await ws.exists(PROJECT)) ? JSON.parse(await ws.readText(PROJECT)) : undefined);
  const save = (p: Project) => ws.write(PROJECT, JSON.stringify(p, null, 1) + "\n");
  async function pick(slug?: string) {
    const p = await load();
    if (!p?.kits.length) throw new KitError("no_kit", "No component kit yet; call dc_new first.");
    const k = p.kits.find((x) => x.slug === (slug ?? p.current));
    if (!k) throw new KitError("unknown_kit", `No kit “${slug}”. Kits: ${p.kits.map((x) => x.slug).join(", ")}`);
    if (slug && p.current !== slug) { p.current = slug; await save(p); }
    return { p, k };
  }
  const tokensOf = async (k: Kit): Promise<Tokens> => JSON.parse(await ws.readText(`${k.dir}/tokens.json`));
  async function writeTokens(k: Kit, t: Tokens) {
    await ws.write(`${k.dir}/tokens.json`, JSON.stringify(t, null, 2) + "\n");
    await ws.write(`${k.dir}/tokens.css`, tokensCss(t));
    await ws.write(`${k.dir}/tokens.ts`, tokensTs(t));
  }
  async function sources(k: Kit) {
    const files: Record<string, string> = {};
    for (const f of await ws.list({ dir: `${k.dir}/src`, exts: [".tsx", ".ts", ".css"], limit: 500 })) files[posix.relative(k.dir, f.path)] = await ws.readText(f.path);
    files["tokens.ts"] = await ws.readText(`${k.dir}/tokens.ts`);
    return files;
  }

  type Comp = { name: string; file: string; examples: { name: string; html?: string; error?: string }[] };
  /** 类型检查 + 约定检查 + 服务端渲染每个示例 + 打包浏览器目录页。 */
  async function build(k: Kit) {
    const t = await tokensOf(k);
    const tokenIssues = validateTokens(t);
    const files = await sources(k);
    const names = Object.keys(files).filter((f) => /^src\/[A-Z][A-Za-z0-9]*\.tsx$/.test(f)).map((f) => posix.basename(f, ".tsx")).sort();
    const issues: CodeIssue[] = names.length ? typecheck(files, typesRoot) : [];
    // 约定：颜色等写死的值应该用设计变量
    for (const [f, s] of Object.entries(files)) if (/\.(css|tsx)$/.test(f)) s.split("\n").forEach((line, i) => {
      const m = line.replace(/var\([^)]*\)/g, "").match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)/);
      if (m && !/^\s*(\/\/|\/\*|\*)/.test(line)) issues.push({ file: f, line: i + 1, message: `Hard-coded colour ${m[0]}; use a token such as var(--color-primary).`, severity: "warning", source: "check" });
    });
    const comps: Comp[] = [];
    let css = "";
    if (names.length) {
      const ssr = await bundleSsr(files, names);
      issues.push(...ssr.issues);
      if (ssr.js) {
        const require = (id: string) => { if (id === "react") return React; if (id === "react/jsx-runtime") return JSXRT; if (id === "react-dom") return ReactDOM; throw new Error(`Cannot require ${id}`); };
        const ctx = vm.createContext({ require, module: { exports: {} as Record<string, unknown> }, renderToStaticMarkup, console: { log() {}, warn() {}, error() {} } });
        try {
          vm.runInContext(`(function(module, exports){${ssr.js}\n})(module, module.exports);`, ctx, { timeout: 5000, filename: "components.js" });
          const mods = (ctx.module.exports as { mods: Record<string, Record<string, unknown>> }).mods;
          for (const n of names) {
            const mod = mods[n] ?? {};
            const c: Comp = { name: n, file: `src/${n}.tsx`, examples: [] };
            if (typeof mod[n] !== "function" && typeof mod[n] !== "object") issues.push({ file: c.file, message: `src/${n}.tsx must export a component named ${n} (export function ${n}(props) …).`, severity: "error", source: "check" });
            const ex = mod.examples as { name: string; render: () => unknown }[] | undefined;
            if (!Array.isArray(ex) || !ex.length) issues.push({ file: c.file, message: `Add \`export const examples = [{ name: "Default", render: () => <${n} /> }, …]\` — one example per state.`, severity: "warning", source: "check" });
            else for (const [i, e] of ex.entries()) {
              ctx.__e = e;
              try { c.examples.push({ name: String(e.name ?? `Example ${i + 1}`), html: vm.runInContext("renderToStaticMarkup(__e.render())", ctx, { timeout: 3000 }) as string }); }
              catch (err) { const msg = (err as Error).message; c.examples.push({ name: String(e.name ?? i), error: msg }); issues.push({ file: c.file, message: `Example “${e.name}” failed to render: ${msg}`, severity: "error", source: "render" }); }
            }
            const plan = k.plan.find((x) => x.name === n);
            for (const st of plan?.states ?? []) if (!c.examples.some((e) => e.name.toLowerCase().includes(st.toLowerCase()))) issues.push({ file: c.file, message: `No example for the planned state “${st}”.`, severity: "warning", source: "check" });
            comps.push(c);
          }
        } catch (err) { issues.push({ file: "", message: `Loading the components failed: ${(err as Error).message}`, severity: "error", source: "render" }); }
      }
      const cat = await bundleCatalog(files, names, k.name);
      issues.push(...cat.issues.filter((i) => !ssr.issues.some((s) => s.message === i.message)));
      css = cat.css;
      if (cat.js) {
        vendor ??= await readFile(join(options.assetRoot, "vendor/react.js"), "utf8");
        const safe = (s: string) => s.replace(/<\/(script|style)/gi, "<\\/$1");
        await ws.write(`${k.dir}/catalog/index.html`, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${k.name.replace(/</g, "&lt;")} — components</title>\n<style>${safe(tokensCss(t))}\n${CATALOG_CSS}\n${safe(css)}</style></head>\n<body style="margin:0"><div id="root"></div>\n<script>${safe(vendor)}</script>\n<script>${safe(cat.js)}</script></body></html>\n`);
      }
      await ws.write(`${k.dir}/index.ts`, `// Generated by Design To Components.\n${names.map((n) => `export { ${n} } from "./src/${n}";`).join("\n")}\nexport { tokens } from "./tokens";\n`);
    }
    const planned = k.plan.map((pl) => {
      const c = comps.find((x) => x.name === pl.name);
      const errs = issues.filter((i) => i.severity === "error" && i.file === `src/${pl.name}.tsx`).length;
      return { ...pl, status: !names.includes(pl.name) ? "todo" : errs ? "error" : "done", examples: c?.examples.length ?? 0 };
    });
    const preview = `<!doctype html><html><head><meta charset="utf-8"><style>${tokensCss(t)}\n${CATALOG_CSS}\n${css}</style></head><body style="margin:0"><div class="dc-catalog">${comps.map((c) => `<section class="dc-comp" id="c-${c.name}"><h2>${c.name}</h2><div class="dc-examples">${c.examples.map((e) => `<figure><div class="dc-stage">${e.html ?? `<div class="dc-error">${(e.error ?? "").replace(/</g, "&lt;")}</div>`}</div><figcaption>${e.name.replace(/</g, "&lt;")}</figcaption></figure>`).join("")}</div></section>`).join("") || '<p style="color:#667085">No components yet.</p>'}</div></body></html>`;
    const order = { error: 0, warning: 1 };
    issues.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
    return { tokens: t, tokenIssues, comps, issues, planned, preview, names, files: Object.keys(files).filter((f) => f.startsWith("src/")) };
  }
  type Built = Awaited<ReturnType<typeof build>>;
  const view = (p: Project, k: Kit, b: Built) => ({ kind: "kit", project: p, kit: k, tokens: b.tokens, tokenIssues: b.tokenIssues, plan: b.planned, components: b.comps.map((c) => ({ name: c.name, examples: c.examples.map((e) => e.name) })), issues: b.issues, preview: b.preview, files: b.files, catalog: b.names.length ? `${k.dir}/catalog/index.html` : null });
  const line = (i: CodeIssue) => `${i.severity === "error" ? "✗" : "!"} ${i.file}${i.line ? `:${i.line}` : ""} [${i.source}] ${i.message}`;
  const brief = (k: Kit, b: Built) => {
    const errs = b.issues.filter((i) => i.severity === "error").length;
    return `${k.dir}: ${b.names.length} component(s) (${b.comps.map((c) => `${c.name} ×${c.examples.length}`).join(", ") || "none"}), ${errs} error(s), ${b.issues.length - errs} warning(s).${b.planned.length ? ` Plan: ${b.planned.map((x) => `${x.name} ${x.status}`).join(", ")}.` : ""}${b.names.length ? ` Catalog: ${k.dir}/catalog/index.html.` : ""}${[...b.tokenIssues.map((t) => `\n✗ tokens.${t.group}.${t.key}: ${t.message}`), ...b.issues.slice(0, 40).map((i) => `\n${line(i)}`)].join("")}`;
  };
  const respond = async (p: Project, k: Kit) => { const b = await build(k); return { text: brief(k, b), structured: view(p, k, b) }; };

  const tokenShape = z.object(Object.fromEntries(GROUPS.map((g) => [g, z.record(z.string(), z.string()).optional()]))).partial();
  tool("dc_new", {
    description: "Start a React component kit from design images: creates ui-kit/<name>/ with tokens.json (colours, fonts, font sizes, radii, spacing, shadows) → generated tokens.css (CSS variables) and tokens.ts, and links the design images for the panel. Then set the tokens from the design (dc_tokens), list the components (dc_plan) and write them (dc_write).",
    input: { name: z.string().min(1), design: z.array(z.string()).optional(), tokens: tokenShape.optional(), dir: z.string().optional() }, openPanel: true,
  }, async ({ name, design, tokens, dir }) => {
    const p: Project = (await load()) ?? { version: 1, kits: [], current: "" };
    const slug = slugify(name);
    if (p.kits.some((x) => x.slug === slug)) throw new KitError("exists", `Kit ${slug} already exists.`);
    for (const d of design ?? []) if (!(await ws.exists(d))) throw new KitError("not_found", `${d} not found.`);
    const k: Kit = { slug, name, dir: (dir ?? `ui-kit/${slug}`).replace(/^\/+|\/+$/g, ""), design: design ?? [], plan: [] };
    // 输出目录（或它的某一级上级）是个已存在的文件时给出可读错误，而不是 mkdir 的 EEXIST（TEST-FINDINGS #6）
    { const f = fileInTheWay(ws, k.dir); if (f) throw new KitError("not_a_folder", `${f} is a file, so ${k.dir} cannot be a folder. Pass another dir.`); }
    if (await ws.exists(`${k.dir}/tokens.json`)) throw new KitError("exists", `${k.dir} already has a kit.`);
    const t = structuredClone(DEFAULT_TOKENS) as Tokens;
    for (const g of GROUPS) if (tokens?.[g]) t[g] = { ...tokens[g] } as Record<string, string>;
    await writeTokens(k, t);
    await ws.write(`${k.dir}/README.md`, `# ${name}\n\nReact components generated with Design To Components.\n\n- \`tokens.json\` → \`tokens.css\` (CSS variables) and \`tokens.ts\`\n- \`src/<Component>.tsx\` + \`src/<Component>.css\`; each file exports the component and \`examples\` (one per state)\n- \`index.ts\` re-exports all components\n- \`catalog/index.html\` — open in a browser to see every component and state\n\nUse in a React 18/19 project: copy \`src/\`, \`tokens.css\`, \`tokens.ts\` and \`index.ts\`, import \`tokens.css\` once, and let your bundler handle the CSS imports.\n`);
    p.kits.push(k); p.current = slug; await save(p);
    return respond(p, k);
  });
  tool("dc_tokens", {
    description: "Set design tokens taken from the design (merged per group; use remove: [\"colors.old-name\"] to delete). Regenerates tokens.css / tokens.ts and re-checks the components. Components should use var(--color-<name>), var(--font-<name>), var(--font-size-<name>), var(--radius-<name>), var(--space-<name>), var(--shadow-<name>).",
    input: { tokens: tokenShape.optional(), remove: z.array(z.string()).optional(), kit: z.string().optional() },
  }, async ({ tokens, remove, kit }) => {
    const { p, k } = await pick(kit);
    const t = await tokensOf(k);
    for (const g of GROUPS) if (tokens?.[g]) Object.assign(t[g], tokens[g]);
    for (const r of remove ?? []) { const [g, ...rest] = r.split("."); if ((GROUPS as readonly string[]).includes(g)) delete (t as unknown as Record<string, Record<string, string>>)[g][rest.join(".")]; }
    const bad = validateTokens(t);
    if (bad.length) throw new KitError("bad_tokens", bad.map((b) => `${b.group}.${b.key}: ${b.message}`).join("\n"));
    await writeTokens(k, t);
    return respond(p, k);
  });
  tool("dc_plan", {
    description: "Set the component list from the design: name (PascalCase), what it is, and the states/variants each needs an example for (e.g. Button: primary, secondary, disabled, loading). The panel tracks which are written and compiled.",
    input: { components: z.array(z.object({ name: z.string(), description: z.string().optional(), states: z.array(z.string()).default([]) })), kit: z.string().optional() },
  }, async ({ components, kit }) => {
    const { p, k } = await pick(kit);
    for (const c of components) if (!PASCAL.test(c.name)) throw new KitError("bad_name", `Component name “${c.name}” must be PascalCase, e.g. PriceTag.`);
    k.plan = components; await save(p);
    return respond(p, k);
  });
  tool("dc_write", {
    description: "Write component files into src/ (flat: src/Button.tsx; src/components/Button/Button.tsx is accepted and flattened) and rebuild: <Name>.tsx (export function <Name>(props) and export const examples = [{ name: \"Primary\", render: () => <Name …/> }, …] — one example per planned state) and optional <Name>.css (import \"./<Name>.css\"; use token CSS variables, no hard-coded colours). Only react / react-dom and files in the kit can be imported (tokens: \"../tokens\"). Returns TypeScript errors, render errors and convention warnings.",
    input: { files: z.record(z.string(), z.string()).default({}), delete: z.array(z.string()).optional(), kit: z.string().optional() },
  }, async ({ files, delete: del, kit }) => {
    const { p, k } = await pick(kit);
    const notes: string[] = [];
    const clean = (f: string) => {
      const n = flatName(f);
      if (!n) throw new KitError("bad_path", `“${f}”: write files directly in src/ (or src/components/<Name>/<Name>.tsx, which is flattened) with .tsx, .ts or .css.`);
      return `${k.dir}/src/${n}`;
    };
    for (const [f, s] of Object.entries(files)) {
      const n = flatName(f)!;
      const flat = posix.normalize(f.replace(/^\.?\//, "")) !== `src/${n}` && posix.normalize(f) !== n;
      if (flat) notes.push(`${f} → src/${n}`);
      await ws.write(clean(f), flat ? fixImports(s as string) : (s as string));
    }
    for (const f of del ?? []) { const path = clean(f); if (await ws.exists(path)) await (await import("node:fs/promises")).rm(ws.resolve(path)); }
    const r = await respond(p, k);
    if (notes.length) r.text = `Flattened nested paths (the kit keeps every component directly in src/): ${notes.join(", ")}.\n${r.text}`;
    return r;
  });
  tool("dc_build", { description: "Type-check (TypeScript strict), render every example, and rebuild catalog/index.html and index.ts.", input: { kit: z.string().optional() } }, async ({ kit }) => { const { p, k } = await pick(kit); return respond(p, k); });

  tool("dc_state", { description: "Panel state.", input: { kit: z.string().optional() }, visibility: ["app"], readOnly: true }, async ({ kit }) => {
    try { const { p, k } = await pick(kit); return { text: "", structured: view(p, k, await build(k)) }; } catch { return { text: "", structured: { kind: "none" } }; }
  });
  tool("dc_file", { description: "A kit file.", input: { path: z.string() }, visibility: ["app"], readOnly: true }, async ({ path }) => { const { k } = await pick(); return { text: "", structured: { text: await ws.readText(`${k.dir}/${posix.normalize(path)}`) } }; });
  tool("dc_design", { description: "Design image.", input: { path: z.string() }, visibility: ["app"], readOnly: true }, async ({ path }) => {
    const p = await load();
    if (!p?.kits.some((x) => x.design.includes(path))) throw new KitError("not_design", "Not a design image of a kit.");
    const ext = posix.extname(path).toLowerCase();
    return { text: "", structured: { dataUrl: `data:${ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"};base64,${(await ws.read(path)).toString("base64")}` } };
  });
  tool("workspace_images", { description: "Images.", input: {}, visibility: ["app"], readOnly: true }, async () => ({ text: "", structured: { files: (await ws.list({ exts: [".png", ".jpg", ".jpeg", ".webp"], limit: 3000 })).map((f) => f.path) } }));
  return server;
}
