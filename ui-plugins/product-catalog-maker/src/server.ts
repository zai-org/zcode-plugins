import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { findPdfFonts } from "./kit/pdf-fonts.ts";
import { readTable } from "./kit/table.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { DEFAULT_STYLE, FIELDS, buildPdf, detectMapping, plan, prepareImage, readProducts, type Mapping, type PreparedImage, type Product, type Style } from "./catalog.ts";
import { buildHtml, changesMarkdown, diff, type Snapshot } from "./html.ts";

export const NAME = "product-catalog-maker";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PDFJS_URI = `ui://${NAME}/pdfjs/{kind}/{file}`;
const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];
const TABLE_EXTS = [".csv", ".tsv", ".txt", ".xlsx"];

export interface Project {
  version: 1;
  table: string;
  sheet?: string;
  imageDir: string;
  mapping: Mapping;
  style: Style;
  outputDir: string;
}

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
    panelMeta: { "zcode/csp": { wasmUnsafeEval: true } },
  });

  const imageCache = new Map<string, PreparedImage>();
  async function imageOf(path: string, maxSide: number) {
    const info = await stat(ws.resolve(path));
    const key = `${path}|${info.mtimeMs}|${maxSide}`;
    let hit = imageCache.get(key);
    if (!hit) {
      hit = prepareImage(await ws.read(path, 60 * 1024 * 1024), path, maxSide);
      imageCache.set(key, hit);
      if (imageCache.size > 400) imageCache.delete(imageCache.keys().next().value!);
    }
    return hit;
  }

  function normalizeStyle(value: Partial<Style> | undefined): Style {
    const s = { ...DEFAULT_STYLE };
    if (!value) return s;
    for (const key of ["title", "subtitle", "footer", "currency"] as const) if (typeof value[key] === "string") s[key] = value[key]!.slice(0, 300);
    if (typeof value.logo === "string" && value.logo.trim()) s.logo = value.logo.trim();
    if (typeof value.primary === "string" && /^#?[0-9a-f]{6}$/i.test(value.primary)) s.primary = value.primary.startsWith("#") ? value.primary : `#${value.primary}`;
    if (value.grid && ["2x2", "2x3", "3x3", "3x4"].includes(value.grid)) s.grid = value.grid;
    for (const key of ["cover", "showSku"] as const) if (typeof value[key] === "boolean") s[key] = value[key]!;
    if (value.categoryOrder === "name") s.categoryOrder = "name";
    return s;
  }

  async function normalizeProject(value: unknown): Promise<Project> {
    if (!value || typeof value !== "object") throw new KitError("bad_project", "Project must be an object.");
    const p = value as Partial<Project>;
    if (typeof p.table !== "string" || !p.table) throw new KitError("missing_table", "Pass the product `table` (CSV or XLSX in the workspace).");
    ws.resolve(p.table);
    const imageDir = typeof p.imageDir === "string" && p.imageDir.trim() ? p.imageDir.trim().replace(/\/+$/, "") : p.table.includes("/") ? p.table.slice(0, p.table.lastIndexOf("/")) : ".";
    ws.resolve(imageDir);
    const style = normalizeStyle(p.style);
    if (style.logo) {
      ws.resolve(style.logo);
      if (!IMAGE_EXTS.includes(extname(style.logo).toLowerCase())) throw new KitError("bad_logo", "Logo must be PNG or JPG (SVG: export it as PNG first).");
    }
    const mapping: Mapping = {};
    if (p.mapping && typeof p.mapping === "object") for (const f of FIELDS) if (typeof p.mapping[f] === "string" && p.mapping[f]) mapping[f] = p.mapping[f];
    return { version: 1, table: p.table, ...(p.sheet ? { sheet: String(p.sheet) } : {}), imageDir, mapping, style, outputDir: typeof p.outputDir === "string" && p.outputDir.trim() ? p.outputDir.trim().replace(/\/+$/, "") : "catalog" };
  }

  async function loadProject(value: unknown) {
    if (typeof value === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await ws.readText(value));
      } catch (error) {
        if (error instanceof KitError) throw error;
        throw new KitError("bad_project", `${value} is not valid JSON.`);
      }
      return { project: await normalizeProject(parsed), path: value as string | undefined };
    }
    return { project: await normalizeProject(value), path: undefined };
  }

  /** 读表格、对应列、找图片。 */
  async function gather(project: Project) {
    const table = await readTable(ws, project.table, project.sheet);
    const detected = detectMapping(table.columns);
    const mapping = { ...detected, ...project.mapping };
    for (const [field, column] of Object.entries(mapping)) if (column && !table.columns.includes(column)) throw new KitError("bad_mapping", `Column "${column}" (for ${field}) is not in the table. Columns: ${table.columns.join(", ")}`);
    const { products, problems } = readProducts(table, mapping);
    const files = await ws.list({ dir: project.imageDir, exts: IMAGE_EXTS, recursive: true, limit: 5000 }).catch(() => []);
    const byName = new Map<string, string>();
    const byStem = new Map<string, string>();
    for (const f of files) {
      const name = basename(f.path).toLowerCase();
      if (!byName.has(name)) byName.set(name, f.path);
      const stem = name.slice(0, name.length - extname(name).length);
      if (!byStem.has(stem)) byStem.set(stem, f.path);
    }
    for (const p of products) {
      const wanted = p.imageName.toLowerCase();
      let found = wanted ? byName.get(basename(wanted)) ?? byStem.get(basename(wanted)) : p.sku ? byStem.get(p.sku.toLowerCase()) : undefined;
      if (!found && wanted.includes("/")) {
        try {
          ws.resolve(p.imageName);
          await stat(ws.resolve(p.imageName));
          found = p.imageName;
        } catch {
          // 不存在
        }
      }
      if (found) p.image = found;
      else if (p.imageName) problems.push(`row ${p.row} ${p.sku || p.name}: image "${p.imageName}" not found in ${project.imageDir}/`);
      else problems.push(`row ${p.row} ${p.sku || p.name}: no image`);
    }
    const lang: "zh" | "en" = products.some((p) => /\p{Script=Han}/u.test(p.name + p.category)) || /\p{Script=Han}/u.test(project.style.title) ? "zh" : "en";
    return { table, mapping, products, problems, lang };
  }

  async function build(project: Project, products: Product[], lang: "zh" | "en", maxSide: number, problems: string[]) {
    const images = new Map<string, PreparedImage>();
    for (const p of products) {
      if (!p.image || images.has(p.image)) continue;
      try {
        const img = await imageOf(p.image, maxSide);
        images.set(p.image, img);
        if (img.sourceWidth < 300) problems.push(`row ${p.row} ${p.sku || p.name}: image is only ${img.sourceWidth}px wide — it will look blurry`);
      } catch (error) {
        problems.push(`row ${p.row} ${p.sku || p.name}: ${error instanceof Error ? error.message : error}`);
        p.image = undefined;
      }
    }
    const logo = project.style.logo ? await imageOf(project.style.logo, 600) : undefined;
    const fonts = await findPdfFonts(options.fontPath);
    const result = await buildPdf({ products, style: project.style, images, logo, fonts, date: today(), lang });
    return { ...result, images, logo };
  }

  const projectInput = z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Project object, or the workspace path of a saved .catalogmaker.json project.");
  const styleInput = z
    .record(z.string(), z.unknown())
    .optional()
    .describe('{title, subtitle, logo (PNG/JPG path), primary "#hex", grid "2x2"|"2x3"|"3x3"|"3x4", currency "¥", footer (contact line), cover true/false, showSku, categoryOrder "table"|"name"}');

  tool(
    "catalog_open",
    {
      description:
        "Open Product Catalog Maker: read a product spreadsheet (CSV/XLSX: SKU, name, spec, price, original price, image file name, category…), match product photos in an image folder, check for missing images/prices and duplicates, and plan an A4 catalog (cover with contents, one section per category, 2×2–3×4 grid, page numbers). Opens the side panel with a live PDF preview.",
      input: {
        table: z.string().optional().describe("Workspace path of the product table."),
        sheet: z.string().optional().describe("XLSX sheet name (default: first)."),
        imageDir: z.string().optional().describe("Folder with product photos (default: the table's folder; searched recursively). Images match the image column, else the SKU as file name."),
        mapping: z.record(z.string(), z.string()).optional().describe(`Column for each field when auto-detection fails: ${FIELDS.join(", ")}.`),
        style: styleInput,
        project: z.string().optional().describe("Workspace path of a saved .catalogmaker.json project."),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 300_000,
    },
    async ({ table, sheet, imageDir, mapping, style, project: projectPath }) => {
      const loaded = projectPath ? await loadProject(projectPath) : await loadProject({ table, sheet, imageDir, mapping, style });
      const { project } = loaded;
      const g = await gather(project);
      project.mapping = g.mapping;
      const layout = plan(g.products, project.style, g.lang === "zh" ? "未分类" : "Other");
      const lines = [
        `${g.products.length} product(s) from ${project.table}${g.table.sheet ? ` [${g.table.sheet}]` : ""}; columns: ${Object.entries(g.mapping).map(([f, c]) => `${f}=${c}`).join(", ")}.`,
        `${layout.toc.length} categor${layout.toc.length === 1 ? "y" : "ies"}: ${layout.toc.map((t) => `${t.name} (${t.count})`).join(", ")}. ${layout.total} A4 page(s) with a ${project.style.grid} grid.`,
        `${g.products.filter((p) => p.image).length}/${g.products.length} products have photos.`,
        ...(g.problems.length ? ["Check:", ...g.problems.slice(0, 50).map((p) => `- ${p}`)] : ["No problems found."]),
        "Next: review in the panel, then call catalog_build.",
      ];
      return {
        text: lines.join("\n"),
        structured: { kind: "project", project, projectPath: loaded.path, columns: g.table.columns, problems: g.problems, products: g.products.length, pages: layout.total, toc: layout.toc, lang: g.lang },
      };
    },
  );

  tool(
    "catalog_preview",
    {
      description: "Build a low-resolution preview PDF of the catalog for the panel (base64).",
      input: { project: projectInput },
      visibility: ["app"],
      readOnly: true,
      timeoutMs: 300_000,
    },
    async ({ project: value }) => {
      const { project } = await loadProject(value);
      const g = await gather(project);
      const result = await build(project, g.products, g.lang, 360, g.problems);
      const bytes = await result.doc.save({ useObjectStreams: false });
      return { text: `${result.pages} page(s)`, structured: { pdf: Buffer.from(bytes).toString("base64"), pages: result.pages, problems: [...g.problems, ...result.warnings] } };
    },
  );

  tool(
    "catalog_build",
    {
      description:
        "Generate the catalog into outputDir (default catalog/): catalog.pdf (A4, searchable text), catalog.html (self-contained, editable in the browser, printable), catalog.json (snapshot) and — when a previous catalog.json exists there — changes.md / changes.csv listing added, removed and re-priced products.",
      input: { project: projectInput },
      timeoutMs: 900_000,
    },
    async ({ project: value }) => {
      const { project } = await loadProject(value);
      const g = await gather(project);
      const problems = [...g.problems];
      const result = await build(project, g.products, g.lang, 1000, problems);
      const out = project.outputDir;
      const files: string[] = [];
      files.push(await ws.write(`${out}/catalog.pdf`, await result.doc.save({ useObjectStreams: false })));
      const htmlImages = new Map<string, PreparedImage>();
      for (const p of g.products) if (p.image && result.images.has(p.image)) htmlImages.set(p.image, await imageOf(p.image, 600));
      files.push(await ws.write(`${out}/catalog.html`, buildHtml(g.products, project.style, htmlImages, result.logo, today(), g.lang)));
      const snapshot: Snapshot = {
        version: 1,
        date: today(),
        products: g.products.map((p) => ({ sku: p.sku, name: p.name, price: p.price, priceText: p.priceText, category: p.category, ...(p.image ? { image: p.image, imageHash: result.images.get(p.image)?.hash } : {}) })),
      };
      let previous: Snapshot | undefined;
      try {
        previous = JSON.parse(await ws.readText(`${out}/catalog.json`)) as Snapshot;
        if (!Array.isArray(previous.products)) previous = undefined;
      } catch {
        previous = undefined;
      }
      const changes = diff(previous, snapshot);
      if (changes) {
        files.push(await ws.write(`${out}/changes.md`, changesMarkdown(changes, g.lang)));
        const rows = [["type", "sku", "name", "field", "from", "to"], ...changes.added.map((p) => ["added", p.sku, p.name, "", "", ""]), ...changes.removed.map((p) => ["removed", p.sku, p.name, "", "", ""]), ...changes.changed.map((c) => ["changed", c.sku, c.name, c.field, c.from, c.to])];
        files.push(await ws.write(`${out}/changes.csv`, "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n"));
      }
      files.push(await ws.write(`${out}/catalog.json`, JSON.stringify(snapshot, null, 2) + "\n"));
      const all = [...problems, ...result.warnings];
      const summary = changes ? `Changes since ${changes.since}: ${changes.added.length} added, ${changes.removed.length} removed, ${changes.changed.length} changed (see ${out}/changes.md).` : "First version — next time changes.md will list what changed.";
      return {
        text: [`Wrote ${result.pages}-page catalog: ${files.join(", ")}.`, summary, ...(all.length ? ["Check:", ...all.slice(0, 50).map((p) => `- ${p}`)] : [])].join("\n"),
        structured: { kind: "built", files, pages: result.pages, problems: all, changes: changes ?? null, outputDir: out },
      };
    },
  );

  tool(
    "project_save",
    {
      description: 'Save the catalog settings as a .catalogmaker.json project. Shape: {table, sheet?, imageDir, mapping:{field: column}, style:{title, subtitle, logo, primary, grid, currency, footer, cover, showSku, categoryOrder}, outputDir}.',
      input: { path: z.string(), project: z.record(z.string(), z.unknown()) },
    },
    async ({ path, project: value }) => {
      const project = await normalizeProject(value);
      const target = /\.json$/i.test(path) ? path : `${path}.catalogmaker.json`;
      const written = await ws.write(target, JSON.stringify(project, null, 2) + "\n");
      return { text: `Saved ${written}.`, structured: { kind: "saved", path: written, project } };
    },
  );

  tool(
    "workspace_files",
    { description: "List tables, images and folders in the workspace for the panel pickers.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = await ws.list({ exts: [...TABLE_EXTS, ...IMAGE_EXTS], limit: 3000 });
      const tables = files.filter((f) => TABLE_EXTS.includes(extname(f.path).toLowerCase())).map((f) => f.path);
      const images = files.filter((f) => IMAGE_EXTS.includes(extname(f.path).toLowerCase())).map((f) => f.path);
      const dirs = [...new Set(images.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ".")))];
      return { text: `${tables.length} table(s), ${images.length} image(s)`, structured: { tables, images, dirs } };
    },
  );

  // pdf.js 的 CMap 与标准字体：面板没有网络，经资源读取。
  server.registerResource("pdfjs-data", new ResourceTemplate(PDFJS_URI, { list: undefined }), { mimeType: "application/octet-stream" }, async (uri, { kind, file }) => {
    const folder = ({ cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>)[String(kind)];
    const name = String(file);
    if (!folder || !/^[\w.-]+$/.test(name)) throw new KitError("bad_resource", uri.href);
    const data = await readFile(join(options.assetRoot, "pdfjs", folder, name));
    return { contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: data.toString("base64") }] };
  });

  return server;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
