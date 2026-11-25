import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { initRenderer, loadFonts, renderSvg, escapeXml, type FontSet } from "./kit/render.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { ASSETS, analyseLogo, assetSvg, encodeIco, headSnippet, normalizeBrand, webManifest, type AssetOptions, type Brand, type LogoInfo } from "./brand.ts";

export const NAME = "brand-kit-studio";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const LOGO_EXTS = [".svg", ".png", ".jpg", ".jpeg"];
const LAYOUTS = ["hero", "split", "minimal"] as const;

export interface Project {
  version: 1;
  brand: Brand;
  logo?: string;
  mark?: string;
  assets: Record<string, AssetOptions>;
  outputDir: string;
}

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
  });
  initRenderer(join(options.assetRoot, "resvg.wasm")).catch(() => undefined);
  let fontsPromise: Promise<FontSet> | undefined;
  const fonts = () => (fontsPromise ??= loadFonts(options.fontPath).catch((error) => {
    fontsPromise = undefined;
    throw error;
  }));

  const logoCache = new Map<string, LogoInfo>();
  async function logoOf(path: string | undefined): Promise<LogoInfo | undefined> {
    if (!path) return undefined;
    if (!LOGO_EXTS.some((ext) => path.toLowerCase().endsWith(ext))) throw new KitError("bad_logo", `${path}: logo must be SVG, PNG or JPG.`);
    const info = await stat(ws.resolve(path)).catch(() => {
      throw new KitError("not_found", `File not found: ${path}`);
    });
    const key = `${path}|${info.mtimeMs}`;
    const hit = logoCache.get(key);
    if (hit) return hit;
    await initRenderer(join(options.assetRoot, "resvg.wasm"));
    const logo = await analyseLogo(path, await ws.read(path, 30 * 1024 * 1024), await fonts());
    logoCache.set(key, logo);
    return logo;
  }

  function normalizeAssets(value: unknown): Record<string, AssetOptions> {
    const out: Record<string, AssetOptions> = {};
    const source = value && typeof value === "object" ? (value as Record<string, AssetOptions>) : {};
    for (const def of ASSETS) {
      const v = source[def.id] ?? {};
      const item: AssetOptions = {};
      if (v.enabled === false) item.enabled = false;
      if (typeof v.layout === "string" && (LAYOUTS as readonly string[]).includes(v.layout)) item.layout = v.layout;
      if (typeof v.title === "string") item.title = v.title.slice(0, 120);
      if (typeof v.subtitle === "string") item.subtitle = v.subtitle.slice(0, 240);
      out[def.id] = item;
    }
    return out;
  }

  async function normalizeProject(value: unknown) {
    if (!value || typeof value !== "object") throw new KitError("bad_project", "Project must be an object.");
    const p = value as Partial<Project> & { name?: string; tagline?: string; colors?: Brand["colors"] };
    const logoPath = typeof p.logo === "string" && p.logo.trim() ? p.logo.trim() : undefined;
    const markPath = typeof p.mark === "string" && p.mark.trim() ? p.mark.trim() : undefined;
    const [logo, mark] = [await logoOf(logoPath), await logoOf(markPath)];
    const brandInput = { ...p.brand, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.tagline !== undefined ? { tagline: p.tagline } : {}) } as Partial<Brand>;
    if (p.colors) brandInput.colors = { ...p.brand?.colors, ...p.colors } as Brand["colors"];
    const brand = normalizeBrand(brandInput, logo ?? mark);
    if (!brand.name && !logo && !mark) throw new KitError("missing_brand", "Give a brand `name`, a `logo`, or both.");
    const project: Project = {
      version: 1,
      brand,
      ...(logoPath ? { logo: logoPath } : {}),
      ...(markPath ? { mark: markPath } : {}),
      assets: normalizeAssets(p.assets),
      outputDir: typeof p.outputDir === "string" && p.outputDir.trim() ? p.outputDir.trim() : "brand-kit",
    };
    return { project, logo, mark };
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
      return { ...(await normalizeProject(parsed)), path: value };
    }
    return { ...(await normalizeProject(value)), path: undefined };
  }

  const defOf = (id: string) => {
    const def = ASSETS.find((a) => a.id === id);
    if (!def) throw new KitError("bad_asset", `Unknown asset "${id}". Available: ${ASSETS.map((a) => a.id).join(", ")}`);
    return def;
  };

  const projectInput = z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Project object, or the workspace path of a saved .brandkit.json project.");
  const colorsInput = z
    .object({ primary: z.string().optional(), secondary: z.string().optional(), background: z.string().optional(), text: z.string().optional() })
    .optional()
    .describe("Brand colours as #rrggbb. Missing ones are suggested from the logo.");

  tool(
    "brand_open",
    {
      description:
        "Open Brand Kit Studio. From a brand name, tagline, logo (SVG/PNG/JPG in the workspace) and optional square mark, it prepares favicons (ICO + PNG + webmanifest), app icons, a social avatar, link-share (Open Graph), X/Xiaohongshu images, and WeChat/X/LinkedIn/YouTube covers in one consistent style. Brand colours are suggested from the logo when not given. Pass the fields, or a saved `project` (.brandkit.json). Opens the side panel where the user previews and tweaks each asset.",
      input: {
        name: z.string().optional().describe("Brand or product name."),
        tagline: z.string().optional().describe("One-line slogan / description."),
        logo: z.string().optional().describe("Workspace path of the main logo (SVG preferred; PNG with transparency or JPG)."),
        mark: z.string().optional().describe("Optional square icon/mark for favicons and avatars (otherwise taken from the logo, or the first letter of the name)."),
        colors: colorsInput,
        project: z.string().optional().describe("Workspace path of a saved .brandkit.json project."),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 300_000,
    },
    async ({ name, tagline, logo, mark, colors, project: projectPath }) => {
      const loaded = projectPath ? await loadProject(projectPath) : await loadProject({ name, tagline, logo, mark, colors });
      const { project } = loaded;
      const f = await fonts();
      const warnings: string[] = [];
      for (const def of ASSETS) if (project.assets[def.id]?.enabled !== false) warnings.push(...assetSvg({ brand: project.brand, logo: loaded.logo, mark: loaded.mark, fonts: f }, def, project.assets[def.id]).warnings);
      const c = project.brand.colors;
      const lines = [
        `Brand "${project.brand.name || "(no name)"}"${loaded.logo ? `, logo ${project.logo}` : ", no logo (letter mark)"}${loaded.mark ? `, mark ${project.mark}` : ""}.`,
        `Colours: primary ${c.primary}, secondary ${c.secondary}, background ${c.background}, text ${c.text}${colors ? "" : " (suggested from the logo — confirm with the user)"}.`,
        `${ASSETS.length} assets → ${project.outputDir}/ (favicon/, social/, covers/, templates/).`,
        ...(warnings.length ? ["Layout warnings:", ...warnings.map((w) => `- ${w}`)] : []),
        "Next: let the user review in the panel, then call brand_export.",
      ];
      return { text: lines.join("\n"), structured: { kind: "project", project, projectPath: loaded.path, assets: ASSETS, warnings, font: f.path } };
    },
  );

  tool(
    "brand_preview",
    {
      description: "Render one brand asset for the panel preview (PNG, base64).",
      input: { project: projectInput, asset: z.string(), width: z.number().int().min(32).max(1600).optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ project: value, asset, width }) => {
      const loaded = await loadProject(value);
      const def = defOf(asset);
      const { svg, warnings } = assetSvg({ brand: loaded.project.brand, logo: loaded.logo, mark: loaded.mark, fonts: await fonts() }, def, loaded.project.assets[asset]);
      const target = Math.min(def.width, width ?? 480);
      const png = await renderSvg(svg, await fonts(), def.width > target ? target : undefined);
      return { text: `${asset} preview`, structured: { image: Buffer.from(png.png).toString("base64"), mime: "image/png", warnings, asset } };
    },
  );

  tool(
    "project_save",
    {
      description:
        'Save the brand as a .brandkit.json project in the workspace for later updates. Shape: {brand:{name, tagline, colors:{primary, secondary, background, text}, logoTone:"auto"|"original"|"white"|"dark"}, logo?, mark?, assets:{<asset id>:{enabled?, layout?:"hero"|"split"|"minimal", title?, subtitle?}}, outputDir}.',
      input: { path: z.string(), project: z.record(z.string(), z.unknown()) },
    },
    async ({ path, project: value }) => {
      const { project } = await normalizeProject(value);
      const target = /\.json$/i.test(path) ? path : `${path}.brandkit.json`;
      const written = await ws.write(target, JSON.stringify(project, null, 2) + "\n");
      return { text: `Saved ${written}.`, structured: { kind: "saved", path: written, project } };
    },
  );

  tool(
    "brand_export",
    {
      description:
        "Write the brand kit: favicon/ (favicon.ico 16/32/48, favicon-16x16.png, favicon-32x32.png, apple-touch-icon.png, android-chrome 192/512, maskable 512, site.webmanifest, head-snippet.html), social/, covers/, templates/<asset>.svg (editable), brand.json and index.html overview. Pass `assets` (ids) to export only some.",
      input: { project: projectInput, assets: z.array(z.string()).optional() },
      timeoutMs: 600_000,
    },
    async ({ project: value, assets }) => {
      const loaded = await loadProject(value);
      const { project } = loaded;
      const f = await fonts();
      const out = project.outputDir.replace(/\/+$/, "");
      const files: string[] = [];
      const warnings: string[] = [];
      const chosen = ASSETS.filter((d) => (assets?.length ? assets.includes(d.id) : project.assets[d.id]?.enabled !== false));
      if (assets) for (const id of assets) defOf(id);
      const input = { brand: project.brand, logo: loaded.logo, mark: loaded.mark, fonts: f };
      for (const def of chosen) {
        const { svg, warnings: w } = assetSvg(input, def, project.assets[def.id]);
        warnings.push(...w);
        if (def.id === "favicon") {
          const sizes = [16, 32, 48];
          const pngs = [];
          for (const size of sizes) pngs.push({ size, png: (await renderSvg(svg, f, size)).png });
          files.push(await ws.write(`${out}/favicon/favicon.ico`, encodeIco(pngs)));
          files.push(await ws.write(`${out}/favicon/favicon-16x16.png`, pngs[0].png));
          files.push(await ws.write(`${out}/favicon/favicon-32x32.png`, pngs[1].png));
          files.push(await ws.write(`${out}/favicon/site.webmanifest`, webManifest(project.brand) + "\n"));
          files.push(await ws.write(`${out}/favicon/head-snippet.html`, headSnippet(project.brand)));
        } else {
          files.push(await ws.write(`${out}/${def.file}`, (await renderSvg(svg, f)).png));
        }
        files.push(await ws.write(`${out}/templates/${def.id}.svg`, svg));
      }
      files.push(await ws.write(`${out}/brand.json`, JSON.stringify(project, null, 2) + "\n"));
      files.push(await ws.write(`${out}/index.html`, overviewHtml(project, chosen.map((d) => d.id))));
      return {
        text: [`Wrote ${files.length} file(s) to ${out}/.`, ...(warnings.length ? ["Layout warnings:", ...warnings.map((w) => `- ${w}`)] : [])].join("\n"),
        structured: { kind: "exported", files, warnings, outputDir: out },
      };
    },
  );

  tool(
    "workspace_images",
    { description: "List SVG/PNG/JPG files in the workspace for the panel's logo picker.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = await ws.list({ exts: LOGO_EXTS, limit: 1000 });
      return { text: `${files.length} image(s)`, structured: { files: files.map((f) => f.path).filter((p) => !p.startsWith("brand-kit/")) } };
    },
  );

  return server;
}

function overviewHtml(project: Project, ids: string[]) {
  const c = project.brand.colors;
  const swatch = (label: string, color: string) => `<div class="sw"><span style="background:${color}"></span>${label}<code>${color}</code></div>`;
  const cards = ASSETS.filter((d) => ids.includes(d.id))
    .map((d) => {
      const src = d.id === "favicon" ? "favicon/favicon-32x32.png" : d.file;
      return `<figure><img src="${escapeXml(src)}" alt="${escapeXml(d.label)}"><figcaption>${escapeXml(d.label_zh)} · ${d.width}×${d.height}<br><code>${escapeXml(d.id === "favicon" ? "favicon/favicon.ico" : d.file)}</code></figcaption></figure>`;
    })
    .join("\n");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeXml(project.brand.name)} brand kit</title><style>
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:32px;color:#111827;background:#f8fafc}
h1{margin:0 0 4px}p{color:#475569;margin:0 0 20px}.sws{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap}
.sw{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px}.sw span{width:28px;height:28px;border-radius:6px;border:1px solid #0001}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}figure{margin:0;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px}
img{max-width:100%;max-height:220px;display:block;margin:0 auto 8px;background:repeating-conic-gradient(#eee 0 25%,#fff 0 50%) 0 0/16px 16px}figcaption{font-size:13px;color:#334155}code{font-size:12px;color:#64748b}
</style></head><body><h1>${escapeXml(project.brand.name)}</h1><p>${escapeXml(project.brand.tagline)}</p>
<div class="sws">${swatch("Primary", c.primary)}${swatch("Secondary", c.secondary)}${swatch("Background", c.background)}${swatch("Text", c.text)}</div>
<div class="grid">${cards}</div></body></html>
`;
}
