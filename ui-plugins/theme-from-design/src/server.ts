import { readFile, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { zipSync } from "fflate";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { prepareThemeCheck, runThemeCheck } from "./check.ts";
import { skeleton, type Brand } from "./skeleton.ts";
import { THEME_DIRS, TEMPLATES, Theme, builtinCheck, renderPreview, type Issue } from "./theme.ts";

export const NAME = "theme-from-design";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PROJECT = ".theme-from-design/project.json";
const TEXT_EXT = /\.(liquid|json|css|js|svg|txt|md)$/i;
const BIN_EXT = /\.(png|jpe?g|gif|webp|woff2?|ttf|otf|ico)$/i;

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface Project { version: 1; dir: string; name: string; design: string[]; lastCheck?: { at: string; errors: number; warnings: number; themeCheck: boolean } }
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  prepareThemeCheck(options.assetRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });

  const loadProject = async (): Promise<Project | undefined> => ((await ws.exists(PROJECT)) ? JSON.parse(await ws.readText(PROJECT)) : undefined);
  const save = (p: Project) => ws.write(PROJECT, JSON.stringify(p, null, 1) + "\n");
  async function must() {
    const p = await loadProject();
    if (!p) throw new KitError("no_theme", "No theme yet; call theme_new first.");
    return p;
  }
  async function loadTheme(dir: string) {
    const files = new Map<string, string>(), binary = new Map<string, Uint8Array>();
    for (const f of await ws.list({ dir, limit: 5000 })) {
      const rel = posix.relative(dir, f.path);
      if (!THEME_DIRS.includes(posix.dirname(rel))) continue;
      if (TEXT_EXT.test(rel)) files.set(rel, (await ws.readText(f.path)).replace(/\r\n/g, "\n"));
      else if (BIN_EXT.test(rel)) binary.set(rel, await ws.read(f.path));
    }
    return new Theme(files, binary);
  }
  async function fullCheck(p: Project, withThemeCheck = true) {
    const theme = await loadTheme(p.dir);
    const issues: Issue[] = builtinCheck(theme);
    let themeCheck: { ran: boolean; ms?: number; error?: string } = { ran: false };
    if (withThemeCheck) {
      const r = await runThemeCheck(ws.resolve(p.dir));
      themeCheck = { ran: !r.error, ms: r.ms, ...(r.error ? { error: r.error } : {}) };
      // theme-check 和内置检查报告同一个 JSON/Liquid 语法错误时只留 theme-check 的
      const seen = new Set(r.issues.map((i) => `${i.file}:${i.line}`));
      for (const i of r.issues) issues.push(i);
      for (let k = issues.length - 1; k >= 0; k--) if (issues[k].source === "builtin" && /Syntax/.test(issues[k].check) && seen.has(`${issues[k].file}:${issues[k].line}`)) issues.splice(k, 1);
    }
    issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
    const errors = issues.filter((i) => i.severity === "error").length;
    p.lastCheck = { at: new Date().toISOString(), errors, warnings: issues.length - errors, themeCheck: themeCheck.ran };
    await save(p);
    return { theme, issues, errors, warnings: issues.length - errors, themeCheck };
  }
  const issueLine = (i: Issue) => `${i.severity === "error" ? "✗" : "!"} ${i.file}${i.line ? `:${i.line}` : ""} [${i.source === "theme-check" ? "theme-check " : ""}${i.check}] ${i.message}`;
  const fileList = (t: Theme) => [...t.files.keys(), ...t.binary.keys()].sort();
  const view = (p: Project, t: Theme, issues: Issue[], themeCheck?: unknown) => ({ kind: "theme", project: p, files: fileList(t), sections: [...t.files.keys()].filter((f) => /^sections\/.+\.liquid$/.test(f)).map((f) => f.slice(9, -7)), templates: [...t.files.keys()].filter((f) => /^templates\/[^/]+\.(json|liquid)$/.test(f)).map((f) => f.slice(10).replace(/\.(json|liquid)$/, "")), issues, themeCheck });
  const summary = (r: { errors: number; warnings: number; themeCheck: { ran: boolean; error?: string } }) => `${r.errors} error(s), ${r.warnings} warning(s)${r.themeCheck.ran ? " (built-in checks + Shopify theme-check)" : r.themeCheck.error ? ` (theme-check could not run: ${r.themeCheck.error})` : " (built-in checks)"}.`;

  tool(
    "theme_new",
    {
      description: "Start a Shopify Online Store 2.0 theme in themes/<name>/: layout/theme.liquid, header/footer section groups, JSON templates (index, product, collection, page, cart, search, 404), base sections (announcement bar, header, footer, image banner, rich text, image with text, featured collection, main-*), product-card snippet, settings_schema with the brand colours/fonts, en + zh-CN locales and base.css. Pass the design image paths so the panel can show them next to the preview. Then rewrite sections/CSS with theme_write to match the design.",
      input: {
        name: z.string().min(1).describe("Theme / brand name"),
        design: z.array(z.string()).optional().describe("Design images (PNG/JPG) in the workspace"),
        colors: z.object({ background: z.string(), text: z.string(), accent: z.string(), accentText: z.string(), muted: z.string() }).partial().optional().describe("Hex colours taken from the design"),
        fonts: z.object({ heading: z.string(), body: z.string() }).partial().optional().describe("Shopify font handles, e.g. assistant_n4, playfair_display_n7, lora_n4"),
        radius: z.number().min(0).max(20).optional(),
        width: z.number().min(1000).max(1600).optional().describe("Page width in px (multiple of 100)"),
        dir: z.string().optional().describe("Default themes/<name>"),
        overwrite: z.boolean().optional(),
      },
      openPanel: true,
    },
    async ({ name, design, colors, fonts, radius, width, dir, overwrite }) => {
      const target = (dir ?? `themes/${slug(name)}`).replace(/^\/+|\/+$/g, "");
      if ((await ws.exists(`${target}/layout/theme.liquid`)) && !overwrite) throw new KitError("exists", `${target} already has a theme. Pass overwrite: true to replace it, or another dir.`);
      for (const d of design ?? []) if (!(await ws.exists(d))) throw new KitError("not_found", `${d} not found.`);
      for (const [k, v] of Object.entries(colors ?? {})) if (!/^#[0-9a-f]{6}$/i.test(String(v))) throw new KitError("bad_color", `${k}: use #rrggbb, got ${v}`);
      if (overwrite) await rm(ws.resolve(target), { recursive: true, force: true });
      const brand: Brand = { name, ...(colors ? { colors } : {}), ...(fonts ? { fonts } : {}), ...(radius !== undefined ? { radius } : {}), ...(width ? { width: Math.round(width / 100) * 100 } : {}) };
      for (const [f, c] of Object.entries(skeleton(brand))) await ws.write(`${target}/${f}`, c);
      const p: Project = { version: 1, dir: target, name, design: design ?? [] };
      const r = await fullCheck(p);
      return { text: `Created ${target}/ (${r.theme.files.size} files). ${summary(r)}\nNext: compare the design with the preview; write or edit sections (Liquid + {% schema %}), templates/*.json and assets/base.css with theme_write; then theme_check and theme_package.`, structured: view(p, r.theme, r.issues, r.themeCheck) };
    },
  );

  tool(
    "theme_write",
    {
      description: "Write (or delete) theme files, then run the built-in checks. Paths are relative to the theme folder and must be in layout/, sections/, snippets/, templates/ (and templates/customers/), config/, locales/, assets/ or blocks/. Sections: Liquid + one {% schema %} with name ≤ 25 chars and allowed setting types only (text, textarea, richtext, inline_richtext, image_picker, url, checkbox, range, select, radio, color, number, collection, collection_list, product, product_list, link_list, page, blog, font_picker, video_url, header, paragraph …; no liquid/html settings). Reference settings as section.settings.<id> / block.settings.<id>. Use `| image_url: width: … | image_tag` for images and `'key' | t` for text, adding new keys to every locales/*.json (en.default.json and zh-CN.json). Add a section to a page by editing templates/<name>.json (sections + order).",
      input: {
        files: z.record(z.string(), z.string()).optional().describe("{ 'sections/hero.liquid': '…' }"),
        delete: z.array(z.string()).optional(),
      },
      openPanel: true,
    },
    async ({ files, delete: del }) => {
      const p = await must();
      const touched: string[] = [];
      const safe = (rel: string) => {
        const n = posix.normalize(rel.replace(/^\/+/, ""));
        if (n.startsWith("..") || !THEME_DIRS.includes(posix.dirname(n))) throw new KitError("bad_path", `${rel}: theme files live in ${THEME_DIRS.join("/, ")}/`);
        if (!TEXT_EXT.test(n)) throw new KitError("bad_path", `${rel}: only text files (.liquid, .json, .css, .js, .svg) can be written; copy images into assets/ yourself.`);
        return n;
      };
      for (const [rel, content] of Object.entries(files ?? {})) { const n = safe(rel); await ws.write(`${p.dir}/${n}`, content as string); touched.push(n); }
      for (const rel of del ?? []) { const n = posix.normalize(rel.replace(/^\/+/, "")); if (THEME_DIRS.includes(posix.dirname(n))) { await rm(ws.resolve(`${p.dir}/${n}`), { force: true }); touched.push(`-${n}`); } }
      if (!touched.length) throw new KitError("nothing", "Pass files or delete.");
      const theme = await loadTheme(p.dir);
      const issues = builtinCheck(theme);
      const mine = issues.filter((i) => touched.includes(i.file) || i.file.startsWith("templates/") || /^sections\/.+\.json$/.test(i.file));
      const errors = issues.filter((i) => i.severity === "error");
      return { text: `Wrote ${touched.join(", ")}. ${errors.length ? `${errors.length} error(s):\n${errors.map(issueLine).join("\n")}` : "Built-in checks pass."}${mine.filter((i) => i.severity === "warning").map((i) => `\n${issueLine(i)}`).join("")}\nRun theme_check for the full Shopify theme-check.`, structured: view(p, theme, issues) };
    },
  );

  tool(
    "theme_check",
    { description: "Full check: built-in checks (Liquid syntax, schema rules, setting references, JSON template references) plus Shopify theme-check (bundled, offline, recommended config). Lists every problem with file:line.", input: {}, openPanel: true, timeoutMs: 300_000 },
    async () => {
      const p = await must();
      const r = await fullCheck(p);
      return { text: `${summary(r)}${r.issues.map((i) => `\n${issueLine(i)}`).join("")}`, structured: view(p, r.theme, r.issues, r.themeCheck) };
    },
  );

  tool(
    "theme_preview",
    { description: "Render a template with fictional sample data (products, collections, menus, cart) to check that it renders and to compare it with the design. Writes .theme-from-design/preview/<template>.html and returns render errors. The panel shows the same preview at desktop and mobile widths. This is an approximation of Shopify's renderer (Liquid via liquidjs), not Shopify itself.", input: { template: z.string().optional().describe("index (default), product, collection, page, cart, search, 404 or an alternate like page.contact"), locale: z.string().optional() }, readOnly: false },
    async ({ template, locale }) => {
      const p = await must();
      const theme = await loadTheme(p.dir);
      const t = template ?? "index";
      const r = renderPreview(theme, t, locale ?? "en");
      const out = await ws.write(`.theme-from-design/preview/${t}.html`, r.html);
      return { text: `${out}: ${Math.round(r.html.length / 1024)} KB${r.errors.length ? `\nRender errors:\n${r.errors.map((e) => `✗ ${e.section}: ${e.message}`).join("\n")}` : ", no render errors."}`, structured: { kind: "preview", template: t, html: r.html, errors: r.errors, file: out } };
    },
  );

  tool(
    "theme_package",
    { description: "Run the full check and zip the theme for upload (Shopify admin → Online Store → Themes → Add theme → Upload zip file). Refuses when there are errors unless force is true. Does not upload anything.", input: { force: z.boolean().optional() }, timeoutMs: 300_000 },
    async ({ force }) => {
      const p = await must();
      const r = await fullCheck(p);
      if (r.errors && !force) throw new KitError("has_errors", `${summary(r)} Fix them first (or pass force: true):\n${r.issues.filter((i) => i.severity === "error").map(issueLine).join("\n")}`);
      const entries: Record<string, Uint8Array> = {};
      for (const [f, c] of r.theme.files) entries[f] = new TextEncoder().encode(c);
      for (const [f, b] of r.theme.binary) entries[f] = b;
      const zip = zipSync(entries, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
      const out = await ws.write(`${p.dir}.zip`, zip);
      return { text: `Wrote ${out} (${Object.keys(entries).length} files, ${Math.round(zip.length / 1024)} KB). ${summary(r)}\nUpload it in Shopify admin → Online Store → Themes → Add theme → Upload zip file (needs the store owner's login; not done by this plugin).`, structured: { kind: "packaged", file: out, files: Object.keys(entries).length, bytes: zip.length, errors: r.errors, warnings: r.warnings } };
    },
  );

  tool("theme_state", { description: "Current theme for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const p = await loadProject();
    if (!p) return { text: "", structured: { kind: "empty" } };
    const theme = await loadTheme(p.dir);
    return { text: "", structured: view(p, theme, builtinCheck(theme)) };
  });
  tool("theme_file", { description: "Read a theme file or design image for the panel.", input: { path: z.string(), design: z.boolean().optional() }, visibility: ["app"], readOnly: true }, async ({ path, design }) => {
    const p = await must();
    if (design) {
      if (!p.design.includes(path)) throw new KitError("not_design", "Not a design image of this theme.");
      const ext = posix.extname(path).toLowerCase();
      return { text: "", structured: { dataUrl: `data:${ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"};base64,${(await ws.read(path)).toString("base64")}` } };
    }
    const n = posix.normalize(path);
    if (n.startsWith("..") || !TEXT_EXT.test(n)) throw new KitError("bad_path", "Text theme files only.");
    return { text: "", structured: { path: n, content: await ws.readText(`${p.dir}/${n}`) } };
  });
  tool("theme_design", { description: "Set the design images shown in the panel.", input: { design: z.array(z.string()) }, visibility: ["app"] }, async ({ design }) => {
    const p = await must();
    p.design = design;
    await save(p);
    return { text: "", structured: { design } };
  });
  tool("workspace_images", { description: "Design images for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => ({
    text: "", structured: { files: (await ws.list({ exts: [".png", ".jpg", ".jpeg", ".webp"], limit: 3000 })).map((f) => f.path).filter((f) => !/^(themes|\.theme-from-design|node_modules)\//.test(f)) },
  }));
  void TEMPLATES;
  return server;
}
