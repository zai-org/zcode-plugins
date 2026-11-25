import { stat, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { decodeImage, encodeJpeg, encodePng, fitWithin, parseColor } from "./kit/raster.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { DEFAULT_SETTINGS, PRESETS, compose, cutout, mergeSettings, type Cutout, type Preset, type Settings } from "./studio.ts";

export const NAME = "product-photo-studio";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];
const MAX_IMAGES = 300;

export interface Project {
  version: 1;
  images: { path: string; overrides?: Partial<Settings> }[];
  settings: Settings;
  presets: string[];
  customPresets?: Preset[];
  outputDir: string;
}

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

const WARNING_TEXT: Record<string, string> = {
  background_not_uniform: "background is not a plain colour — removal may be inaccurate",
  little_background_removed: "almost no background was removed — raise the tolerance or check the photo",
  subject_touches_edge: "the product touches the photo edge — it may be cut off in the original",
  empty_subject: "nothing left after background removal — lower the tolerance",
};

/**
 * 保存前检查项目引用的文件：不存在、0 字节、或内容不像所写的格式时给出提示（仍然保存，TEST-FINDINGS #9）。
 */
async function checkRefs(ws: Workspace, refs: [string, unknown][]): Promise<string[]> {
  const out: string[] = [];
  const sniff = (b: Buffer, ext: string) => {
    if (ext === "pdf") return b.toString("latin1", 0, 1024).includes("%PDF-");
    if (ext === "png") return b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG";
    if (ext === "jpg" || ext === "jpeg") return b[0] === 0xff && b[1] === 0xd8;
    if (ext === "webp") return b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
    if (ext === "xlsx") return b[0] === 0x50 && b[1] === 0x4b;
    if (ext === "csv" || ext === "tsv" || ext === "txt") return !b.subarray(0, 8192).includes(0);
    return true;
  };
  for (const [label, ref] of refs) {
    if (typeof ref !== "string" || !ref) continue;
    let b: Buffer;
    try { b = await ws.read(ref, 300 * 1024 * 1024); } catch { out.push(`${label} ${ref} not found`); continue; }
    if (!b.length) { out.push(`${label} ${ref} is empty (0 bytes)`); continue; }
    const ext = ref.toLowerCase().split(".").pop() ?? "";
    if (!sniff(b, ext)) out.push(`${label} ${ref} does not look like a .${ext} file`);
  }
  return out;
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

  const cache = new Map<string, Cutout>();
  async function getCutout(path: string, settings: Settings): Promise<Cutout> {
    const info = await stat(ws.resolve(path)).catch(() => {
      throw new KitError("not_found", `File not found: ${path}`);
    });
    const key = `${path}|${info.mtimeMs}|${settings.removeBackground}|${settings.tolerance}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const result = cutout(decodeImage(await ws.read(path, 80 * 1024 * 1024), path), settings);
    cache.set(key, result);
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
    return result;
  }

  function presetsOf(project: Project): Preset[] {
    const all = [...PRESETS, ...(project.customPresets ?? [])];
    const chosen = project.presets.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Preset[];
    if (!chosen.length) throw new KitError("no_preset", `Choose at least one output size. Available: ${all.map((p) => p.id).join(", ")}`);
    return chosen;
  }

  function normalizeProject(value: unknown): Project {
    if (!value || typeof value !== "object") throw new KitError("bad_project", "Project must be an object.");
    const p = value as Partial<Project>;
    const images = (Array.isArray(p.images) ? p.images : [])
      .map((item) => (typeof item === "string" ? { path: item } : item))
      .filter((item): item is { path: string; overrides?: Partial<Settings> } => !!item && typeof item.path === "string");
    for (const image of images) ws.resolve(image.path);
    if (images.length > MAX_IMAGES) throw new KitError("too_many_images", `At most ${MAX_IMAGES} images per batch.`);
    const custom = (Array.isArray(p.customPresets) ? p.customPresets : []).map((c) => {
      const width = Math.round(Number(c.width));
      const height = Math.round(Number(c.height));
      if (!(width >= 16 && width <= 6000 && height >= 16 && height <= 6000)) throw new KitError("bad_preset", "Custom sizes must be between 16 and 6000 px.");
      return { id: c.id || `custom-${width}x${height}`, label: c.label || `${width}×${height}`, width, height, format: c.format === "png" ? "png" : "jpg", transparent: !!c.transparent, quality: c.quality } as Preset;
    });
    return {
      version: 1,
      images,
      settings: mergeSettings(DEFAULT_SETTINGS, p.settings),
      presets: Array.isArray(p.presets) && p.presets.length ? p.presets.map(String) : ["white-800", "transparent-png"],
      customPresets: custom,
      outputDir: typeof p.outputDir === "string" && p.outputDir.trim() ? p.outputDir.trim() : "product-photos-output",
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

  async function analyse(project: Project) {
    const items = [];
    for (const image of project.images) {
      const settings = mergeSettings(project.settings, image.overrides);
      try {
        const result = await getCutout(image.path, settings);
        items.push({ path: image.path, report: result.report, subject: { width: result.subject.width, height: result.subject.height } });
      } catch (error) {
        items.push({ path: image.path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return items;
  }

  const projectInput = z.union([z.string(), z.record(z.string(), z.unknown())]).describe("Project object, or the workspace path of a saved .photostudio.json project.");

  tool(
    "photos_open",
    {
      description:
        "Open Product Photo Studio with a batch of product photos (JPG/PNG in the workspace). Removes plain studio backgrounds, crops to the product, and reports per-photo warnings (busy background, product touching the edge). Pass `paths` and/or `folder`, or a saved `project` (.photostudio.json). Opens the side panel where the user tunes each photo.",
      input: {
        paths: z.array(z.string()).max(MAX_IMAGES).optional().describe("Workspace paths of photos."),
        folder: z.string().optional().describe("Workspace folder: every JPG/PNG directly inside it."),
        project: z.string().optional().describe("Workspace path of a saved .photostudio.json project."),
        presets: z.array(z.string()).optional().describe(`Output sizes. Built-in: ${PRESETS.map((p) => p.id).join(", ")}.`),
      },
      openPanel: true,
      readOnly: true,
      timeoutMs: 600_000,
    },
    async ({ paths, folder, project: projectPath, presets }) => {
      let project: Project;
      let saved: string | undefined;
      if (projectPath) ({ project, path: saved } = await loadProject(projectPath));
      else {
        const list = [...(paths ?? [])];
        if (folder) list.push(...(await ws.list({ dir: folder, exts: IMAGE_EXTS, recursive: false, limit: MAX_IMAGES })).map((f) => f.path));
        if (!list.length) throw new KitError("missing_input", "Pass photo `paths`, a `folder`, or a saved `project`.");
        project = normalizeProject({ images: [...new Set(list)].map((path) => ({ path })), presets });
      }
      if (presets?.length && projectPath) project.presets = presets;
      const items = await analyse(project);
      const flagged = items.filter((i) => ("error" in i && i.error) || (i.report?.warnings.length ?? 0));
      const lines = [
        `${items.length} photo(s). Output sizes: ${presetsOf(project).map((p) => p.id).join(", ")}. Output folder: ${project.outputDir}/`,
        flagged.length ? `${flagged.length} photo(s) need a look:` : "All photos look clean.",
        ...flagged.slice(0, 30).map((i) => `- ${i.path}: ${"error" in i && i.error ? i.error : i.report!.warnings.map((w) => WARNING_TEXT[w] ?? w).join("; ")}`),
        "Next: let the user review in the panel, then call photos_export.",
      ];
      return { text: lines.join("\n"), structured: { kind: "project", project, projectPath: saved, items, presets: PRESETS } };
    },
  );

  tool(
    "photos_preview",
    {
      description: "Render one photo of the project with its settings for the panel preview (small JPEG/PNG, base64).",
      input: { project: projectInput, index: z.number().int().min(0), preset: z.string().optional(), size: z.number().int().min(64).max(1200).optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ project: value, index, preset: presetId, size }) => {
      const { project } = await loadProject(value);
      const image = project.images[index];
      if (!image) throw new KitError("bad_index", `No photo #${index}.`);
      const settings = mergeSettings(project.settings, image.overrides);
      const presets = presetsOf(project);
      const preset = presets.find((p) => p.id === presetId) ?? presets[0];
      const k = Math.min(1, (size ?? 480) / Math.max(preset.width, preset.height));
      const result = await getCutout(image.path, settings);
      const canvas = compose(result.subject, { width: Math.round(preset.width * k), height: Math.round(preset.height * k), transparent: preset.transparent }, settings);
      const bytes = preset.transparent ? encodePng(canvas) : encodeJpeg(canvas, 85, parseColor(settings.background));
      return {
        text: `${image.path} → ${preset.id}`,
        structured: { image: bytes.toString("base64"), mime: preset.transparent ? "image/png" : "image/jpeg", report: result.report, preset: preset.id },
      };
    },
  );

  tool(
    "photo_thumbs",
    {
      description: "Small thumbnails of original photos for the panel.",
      input: { paths: z.array(z.string()).max(60), size: z.number().int().min(32).max(400).optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async ({ paths, size }) => {
      const thumbs: Record<string, string> = {};
      for (const path of paths) {
        try {
          thumbs[path] = encodeJpeg(fitWithin(decodeImage(await ws.read(path, 80 * 1024 * 1024), path), size ?? 160), 75).toString("base64");
        } catch {
          // 无法解码的图片在面板里显示占位。
        }
      }
      return { text: `${Object.keys(thumbs).length} thumbnail(s)`, structured: { thumbs } };
    },
  );

  tool(
    "project_save",
    {
      description:
        'Save the batch settings as a .photostudio.json project in the workspace so the same look can be applied to the next batch. Shape: {images:[{path, overrides?}], settings:{removeBackground:"auto"|"off", tolerance:1-100, fill:0.2-0.99, offsetY:-0.4..0.4, align:"center"|"bottom", shadow:"none"|"ground"|"drop", shadowOpacity:0-1, background:"#ffffff"}, presets:[ids], customPresets?:[{id,label,width,height,format:"jpg"|"png",transparent?}], outputDir}.',
      input: { path: z.string(), project: z.record(z.string(), z.unknown()) },
    },
    async ({ path, project: value }) => {
      const project = normalizeProject(value);
      const target = /\.json$/i.test(path) ? path : `${path}.photostudio.json`;
      const written = await ws.write(target, JSON.stringify(project, null, 2) + "\n");
      const warnings = await checkRefs(ws, project.images.map((i: { path: string }) => ["Photo", i.path] as [string, unknown]));
      return { text: `Saved ${written}.${warnings.length ? `\nCheck:\n${warnings.map((w) => `- ${w}`).join("\n")}` : ""}`, structured: { kind: "saved", path: written, project, warnings } };
    },
  );

  tool(
    "photos_export",
    {
      description:
        "Export every photo (or only `indices`, 0-based) in every chosen output size: <outputDir>/<size id>/<photo name>.jpg|png. White-background sizes are JPEG, transparent sizes PNG. Per-photo overrides in the project (tolerance, fill, offset, shadow, background) are applied.",
      input: { project: projectInput, indices: z.array(z.number().int().min(0)).optional() },
      timeoutMs: 900_000,
    },
    async ({ project: value, indices }) => {
      const { project } = await loadProject(value);
      const presets = presetsOf(project);
      const files: string[] = [];
      const problems: string[] = [];
      const used = new Map<string, number>();
      for (const [index, image] of project.images.entries()) {
        if (indices && !indices.includes(index)) continue;
        const settings = mergeSettings(project.settings, image.overrides);
        let result: Cutout;
        try {
          result = await getCutout(image.path, settings);
        } catch (error) {
          problems.push(`${image.path}: ${error instanceof Error ? error.message : error}`);
          continue;
        }
        if (result.report.warnings.length) problems.push(`${image.path}: ${result.report.warnings.map((w) => WARNING_TEXT[w] ?? w).join("; ")}`);
        let stem = safeFileName(basename(image.path, extname(image.path)), `photo-${index + 1}`);
        const seen = used.get(stem.toLowerCase()) ?? 0;
        used.set(stem.toLowerCase(), seen + 1);
        if (seen) stem = `${stem}-${seen + 1}`;
        for (const preset of presets) {
          const canvas = compose(result.subject, preset, settings);
          const bytes = preset.format === "png" ? encodePng(canvas) : encodeJpeg(canvas, preset.quality ?? 90, parseColor(settings.background));
          files.push(await ws.write(`${project.outputDir}/${preset.id}/${stem}.${preset.format}`, bytes));
        }
      }
      return {
        text: [`Wrote ${files.length} file(s) to ${project.outputDir}/ (${presets.map((p) => p.id).join(", ")}).`, ...(problems.length ? ["Check these photos:", ...problems.map((p) => `- ${p}`)] : [])].join("\n"),
        structured: { kind: "exported", files, problems, outputDir: project.outputDir },
      };
    },
  );

  tool(
    "workspace_images",
    { description: "List JPG/PNG files in the workspace for the panel picker.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = await ws.list({ exts: IMAGE_EXTS, limit: 1000 });
      return { text: `${files.length} image(s)`, structured: { files: files.map((f) => f.path) } };
    },
  );

  return server;
}
