import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { decodeImage, encodeJpeg, encodePng, encodePngOpaque, fitWithin, parseColor, resize } from "./kit/raster.ts";
import { initRenderer, loadFonts, renderSvg, type FontSet } from "./kit/render.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { PRESETS, WARNING_TEXT, normalizeTheme, slideSvg, type Preset, type ScreenImage, type Slide, type Theme } from "./shots.ts";

export const NAME = "store-screenshot-studio";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg"];
const MAX_SLIDES = 10;

export interface Project {
  version: 1;
  locales: string[];
  slides: Slide[];
  theme: Theme;
  presets: string[];
  outputDir: string;
}

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  fontPath?: string;
  log?: (line: string) => void;
}

const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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
  const wasm = join(options.assetRoot, "resvg.wasm");
  let fontsPromise: Promise<FontSet> | undefined;
  const fonts = async () => {
    await initRenderer(wasm);
    return (fontsPromise ??= loadFonts(options.fontPath).catch((error) => {
      fontsPromise = undefined;
      throw error;
    }));
  };

  const screenCache = new Map<string, ScreenImage>();
  /** 截图转成 data URI；预览时缩小以加快渲染。 */
  async function screenOf(path: string, maxWidth?: number): Promise<ScreenImage> {
    const info = await stat(ws.resolve(path)).catch(() => {
      throw new KitError("not_found", `Screenshot not found: ${path}`);
    });
    const key = `${path}|${info.mtimeMs}|${maxWidth ?? 0}`;
    const hit = screenCache.get(key);
    if (hit) return hit;
    const bytes = await ws.read(path, 60 * 1024 * 1024);
    const image = decodeImage(bytes, path);
    let screen: ScreenImage;
    if (maxWidth && image.width > maxWidth) {
      const small = resize(image, maxWidth, Math.round((image.height * maxWidth) / image.width));
      screen = { href: `data:image/jpeg;base64,${encodeJpeg(small, 85).toString("base64")}`, width: small.width, height: small.height, sourceWidth: image.width };
    } else {
      const isPng = bytes[0] === 0x89;
      // EXIF 旋转过的 JPEG 重新编码，保证方向正确。
      const href = isPng ? `data:image/png;base64,${Buffer.from(bytes).toString("base64")}` : `data:image/png;base64,${encodePng(image).toString("base64")}`;
      screen = { href, width: image.width, height: image.height, sourceWidth: image.width };
    }
    screenCache.set(key, screen);
    if (screenCache.size > 40) screenCache.delete(screenCache.keys().next().value!);
    return screen;
  }

  function normalizeProject(value: unknown): Project {
    if (!value || typeof value !== "object") throw new KitError("bad_project", "Project must be an object.");
    const p = value as Partial<Project>;
    const locales = (Array.isArray(p.locales) ? p.locales : []).map(String).filter((l) => LOCALE_RE.test(l));
    if (!locales.length) locales.push("zh-Hans");
    const slides: Slide[] = (Array.isArray(p.slides) ? p.slides : [])
      .map((s) => (typeof s === "string" ? { image: s, text: {} } : s))
      .filter((s): s is Slide => !!s && typeof s.image === "string")
      .map((s) => {
        ws.resolve(s.image);
        if (s.tabletImage) ws.resolve(s.tabletImage);
        const text: Slide["text"] = {};
        for (const [locale, t] of Object.entries(s.text && typeof s.text === "object" ? s.text : {})) {
          if (!t || typeof t !== "object") continue;
          text[locale] = {
            ...(typeof t.title === "string" ? { title: t.title.slice(0, 160) } : {}),
            ...(typeof t.subtitle === "string" ? { subtitle: t.subtitle.slice(0, 240) } : {}),
          };
        }
        return {
          image: s.image,
          ...(typeof s.tabletImage === "string" && s.tabletImage ? { tabletImage: s.tabletImage } : {}),
          text,
          ...(typeof s.background === "string" && s.background ? { background: s.background } : {}),
          ...(typeof s.background2 === "string" && s.background2 ? { background2: s.background2 } : {}),
        };
      });
    if (slides.length > MAX_SLIDES) throw new KitError("too_many_slides", `At most ${MAX_SLIDES} screenshots (the App Store limit).`);
    const presets = (Array.isArray(p.presets) && p.presets.length ? p.presets.map(String) : ["ios-6.9", "ios-6.5", "play-phone"]).filter((id) => PRESETS.some((x) => x.id === id));
    if (!presets.length) throw new KitError("no_preset", `Choose at least one size: ${PRESETS.map((x) => x.id).join(", ")}`);
    return {
      version: 1,
      locales: [...new Set(locales)],
      slides,
      theme: normalizeTheme(p.theme),
      presets,
      outputDir: typeof p.outputDir === "string" && p.outputDir.trim() ? p.outputDir.trim() : "store-screenshots",
    };
  }

  async function loadProject(value: unknown): Promise<{ project: Project; path?: string }> {
    if (typeof value === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await ws.readText(value));
      } catch (error) {
        if (error instanceof KitError) throw error;
        throw new KitError("bad_project", `${value} is not valid JSON.`);
      }
      return { project: normalizeProject(parsed), path: value };
    }
    return { project: normalizeProject(value) };
  }

  const presetOf = (id: string): Preset => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) throw new KitError("bad_preset", `Unknown size "${id}". Available: ${PRESETS.map((p) => p.id).join(", ")}`);
    return preset;
  };

  async function render(project: Project, index: number, preset: Preset, locale: string, width?: number) {
    const slide = project.slides[index];
    if (!slide) throw new KitError("bad_index", `No screenshot #${index}.`);
    const tablet = preset.device === "tablet";
    const path = tablet && slide.tabletImage ? slide.tabletImage : slide.image;
    const screen = await screenOf(path, width ? Math.min(1400, Math.round(width * 1.2)) : undefined);
    const f = await fonts();
    const { svg, warnings, background } = slideSvg({ preset, theme: project.theme, slide, locale, locales: project.locales, screen, fonts: f, usingPhoneOnTablet: tablet && !slide.tabletImage && screen.height / screen.width > 1.6 });
    const rendered = await renderSvg(svg, f, width && width < preset.width ? width : undefined);
    return { rendered, warnings, background };
  }

  /** 不渲染，只检查文字长度、翻译和截图清晰度。 */
  async function check(project: Project) {
    const problems: string[] = [];
    for (const [index, slide] of project.slides.entries()) {
      let screen: ScreenImage;
      try {
        screen = await screenOf(slide.image, 64);
      } catch (error) {
        problems.push(`#${index + 1} ${slide.image}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      for (const preset of project.presets.map(presetOf)) {
        for (const locale of project.locales) {
          const { warnings } = slideSvg({ preset, theme: project.theme, slide, locale, locales: project.locales, screen: { ...screen, sourceWidth: screen.sourceWidth }, fonts: await fonts(), usingPhoneOnTablet: preset.device === "tablet" && !slide.tabletImage && screen.height / screen.width > 1.6 });
          for (const w of warnings) {
            const line = `#${index + 1} ${slide.image} [${w === "missing_translation" || w.endsWith("too_long") ? locale : preset.id}]: ${WARNING_TEXT[w] ?? w}`;
            if (!problems.includes(line)) problems.push(line);
          }
        }
      }
    }
    return problems;
  }

  const projectInput = z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Project object, or the workspace path of a saved .storeshots.json project.");

  tool(
    "shots_open",
    {
      description:
        "Open Store Screenshot Studio: turn raw app screenshots (PNG/JPG in the workspace) into App Store / Google Play listing images with a headline, subheadline, device frame and background, in several languages and store sizes. Pass `paths` or `folder` (sorted by name) plus optional `locales` and per-slide `texts`, or a saved `project` (.storeshots.json). Opens the side panel.",
      input: {
        paths: z.array(z.string()).max(MAX_SLIDES).optional().describe("Screenshot paths in slide order."),
        folder: z.string().optional().describe("Folder of screenshots (sorted by file name)."),
        locales: z.array(z.string()).optional().describe('Listing languages, e.g. ["zh-Hans", "en-US"]. The first one is the fallback.'),
        texts: z
          .array(z.record(z.string(), z.object({ title: z.string().optional(), subtitle: z.string().optional() })))
          .optional()
          .describe('Per slide: {"<locale>": {title, subtitle}}. Keep titles short (2–6 words / ≤ 12 Chinese characters).'),
        presets: z.array(z.string()).optional().describe(`Sizes. Built-in: ${PRESETS.map((p) => p.id).join(", ")}.`),
        theme: z.record(z.string(), z.unknown()).optional().describe('{background, background2?, textColor:"auto"|#hex, frame:"auto"|"iphone"|"android"|"none", frameColor, textPosition:"top"|"bottom", deviceScale 0.5–0.95, bleed, titleScale}'),
        project: z.string().optional().describe("Workspace path of a saved .storeshots.json project."),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 300_000,
    },
    async ({ paths, folder, locales, texts, presets, theme, project: projectPath }) => {
      let loaded: { project: Project; path?: string };
      if (projectPath) loaded = await loadProject(projectPath);
      else {
        const list = [...(paths ?? [])];
        if (folder) list.push(...(await ws.list({ dir: folder, exts: IMAGE_EXTS, recursive: false, limit: 200 })).map((f) => f.path).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
        if (!list.length) throw new KitError("missing_input", "Pass screenshot `paths`, a `folder`, or a saved `project`.");
        if (list.length > MAX_SLIDES) throw new KitError("too_many_slides", `${list.length} screenshots given; the App Store allows at most ${MAX_SLIDES}. Pick the best ones.`);
        loaded = { project: normalizeProject({ slides: [...new Set(list)].map((image, i) => ({ image, text: texts?.[i] ?? {} })), locales, presets, theme }) };
      }
      const { project } = loaded;
      const problems = await check(project);
      const play = project.presets.some((id) => presetOf(id).store === "google-play") && project.slides.length > 8;
      const lines = [
        `${project.slides.length} screenshot(s), languages ${project.locales.join(", ")}, sizes ${project.presets.join(", ")} → ${project.outputDir}/<language>/<size>/`,
        ...(project.slides.some((s) => !Object.keys(s.text).length) ? ["Some slides have no headline yet — write short marketing headlines per language (texts) based on what each screenshot shows, then confirm with the user."] : []),
        ...(play ? ["Google Play shows at most 8 phone screenshots; only the first 8 will be used there."] : []),
        ...(problems.length ? ["Check:", ...problems.slice(0, 40).map((p) => `- ${p}`)] : ["No layout problems found."]),
        "Next: let the user review in the panel, then call shots_export.",
      ];
      return { text: lines.join("\n"), structured: { kind: "project", project, projectPath: loaded.path, presets: PRESETS, problems } };
    },
  );

  tool(
    "shots_preview",
    {
      description: "Render one listing image for the panel preview (PNG, base64).",
      input: { project: projectInput, index: z.number().int().min(0), preset: z.string().optional(), locale: z.string().optional(), width: z.number().int().min(64).max(1400).optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ project: value, index, preset: presetId, locale, width }) => {
      const { project } = await loadProject(value);
      const preset = presetOf(presetId ?? project.presets[0]);
      const { rendered, warnings } = await render(project, index, preset, locale ?? project.locales[0], width ?? 360);
      return { text: `#${index + 1} ${preset.id}`, structured: { image: Buffer.from(rendered.png).toString("base64"), mime: "image/png", warnings: warnings.map((w) => WARNING_TEXT[w] ?? w), codes: warnings } };
    },
  );

  tool(
    "project_save",
    {
      description:
        'Save as a .storeshots.json project. Shape: {locales:[...], slides:[{image, tabletImage?, text:{<locale>:{title?, subtitle?}}, background?, background2?}], theme:{background, background2?, textColor, frame, frameColor, textPosition, deviceScale, bleed, titleScale}, presets:[ids], outputDir}.',
      input: { path: z.string(), project: z.record(z.string(), z.unknown()) },
    },
    async ({ path, project: value }) => {
      const project = normalizeProject(value);
      const target = /\.json$/i.test(path) ? path : `${path}.storeshots.json`;
      const written = await ws.write(target, JSON.stringify(project, null, 2) + "\n");
      return { text: `Saved ${written}.`, structured: { kind: "saved", path: written, project } };
    },
  );

  tool(
    "shots_export",
    {
      description:
        "Export listing images: <outputDir>/<locale>/<size id>/<NN>-<name>.png (opaque PNG, exact store pixel size). Optional filters: `locales`, `presets`, `indices` (0-based slides).",
      input: { project: projectInput, locales: z.array(z.string()).optional(), presets: z.array(z.string()).optional(), indices: z.array(z.number().int().min(0)).optional() },
      timeoutMs: 900_000,
    },
    async ({ project: value, locales, presets, indices }) => {
      const { project } = await loadProject(value);
      const files: string[] = [];
      const problems: string[] = [];
      const out = project.outputDir.replace(/\/+$/, "");
      for (const locale of locales?.length ? locales : project.locales) {
        if (!LOCALE_RE.test(locale)) throw new KitError("bad_locale", `Invalid language code "${locale}".`);
        for (const presetId of presets?.length ? presets : project.presets) {
          const preset = presetOf(presetId);
          for (const [index, slide] of project.slides.entries()) {
            if (indices && !indices.includes(index)) continue;
            if (preset.store === "google-play" && index >= 8) continue;
            const { rendered, warnings, background } = await render(project, index, preset, locale);
            for (const w of warnings) problems.push(`${locale}/${preset.id} #${index + 1}: ${WARNING_TEXT[w] ?? w}`);
            const stem = safeFileName(basename(slide.image, extname(slide.image)), "screen");
            const png = encodePngOpaque({ width: rendered.width, height: rendered.height, data: rendered.pixels }, parseColor(background));
            files.push(await ws.write(`${out}/${safeFileName(locale)}/${preset.id}/${String(index + 1).padStart(2, "0")}-${stem}.png`, png));
          }
        }
      }
      const unique = [...new Set(problems)];
      return {
        text: [`Wrote ${files.length} image(s) to ${out}/.`, ...(unique.length ? ["Check:", ...unique.slice(0, 60).map((p) => `- ${p}`)] : [])].join("\n"),
        structured: { kind: "exported", files, problems: unique, outputDir: out },
      };
    },
  );

  tool(
    "screen_thumbs",
    {
      description: "Small thumbnails of raw screenshots for the panel.",
      input: { paths: z.array(z.string()).max(60) },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ paths }) => {
      const thumbs: Record<string, string> = {};
      for (const path of paths) {
        try {
          thumbs[path] = encodeJpeg(fitWithin(decodeImage(await ws.read(path, 60 * 1024 * 1024), path), 200), 75).toString("base64");
        } catch {
          // 无法解码的图片显示占位
        }
      }
      return { text: `${Object.keys(thumbs).length} thumbnail(s)`, structured: { thumbs } };
    },
  );

  tool(
    "workspace_images",
    { description: "List PNG/JPG files in the workspace for the panel picker.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = await ws.list({ exts: IMAGE_EXTS, limit: 1000 });
      return { text: `${files.length} image(s)`, structured: { files: files.map((f) => f.path).filter((p) => !p.startsWith("store-screenshots/")) } };
    },
  );

  return server;
}
