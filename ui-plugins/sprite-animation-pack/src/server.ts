import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { z } from "zod";
import { asepriteJson, godotTres, phaserSnippet, unityNotes } from "./export.ts";
import { decodeImage, encodePng, type Raster } from "./kit/raster.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { compose, crop, groupFiles, keyBackground, layout, normalizeProject, sliceSheet, upscale, type Frame, type Project } from "./sprites.ts";

export const NAME = "sprite-animation-pack";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const IMAGE_EXTS = [".png"];

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
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

  const images = new Map<string, { mtime: number; img: Raster }>();
  async function image(path: string) {
    if (!IMAGE_EXTS.includes(extname(path).toLowerCase())) throw new KitError("bad_image", `${path}: frames must be PNG (with transparency).`);
    const st = await stat(ws.resolve(path)).catch(() => {
      throw new KitError("not_found", `File not found: ${path}`);
    });
    const hit = images.get(path);
    if (hit && hit.mtime === st.mtimeMs) return hit.img;
    if (st.size > 64 * 1024 * 1024) throw new KitError("too_large", `${path} is too large.`);
    const img = decodeImage(await ws.read(path, 64 * 1024 * 1024), path);
    if (img.width * img.height > 64e6) throw new KitError("too_large", `${path} is too large.`);
    images.set(path, { mtime: st.mtimeMs, img });
    return img;
  }
  async function prepare(raw: unknown) {
    const { project, warnings } = normalizeProject(raw);
    for (const a of project.actions) for (const f of a.frames) await image(f.source);
    const load = (f: Frame) => keyBackground(f.region ? crop(images.get(f.source)!.img, f.region) : images.get(f.source)!.img, project.background);
    const l = layout(project, load);
    for (const n of l.empty) warnings.push(`Frame ${n} is empty (fully transparent).`);
    if (l.width * project.scale > 8192 || l.height * project.scale > 8192) warnings.push(`The atlas is ${l.width * project.scale}×${l.height * project.scale}; some engines and GPUs limit textures to 4096 or 8192 px.`);
    return { project, warnings, l };
  }
  const projectPath = (p: Project) => `${p.output}/${p.name}/${p.name}.sprites.json`;
  function summary(p: Project, l: ReturnType<typeof layout>) {
    return [
      `${p.name}: ${p.actions.length} action(s) — ${p.actions.map((a) => `${a.name} ${a.frames.length}f ${Math.round(1000 / a.frames[0].duration)}fps ${a.loop ? "loop" : "once"} anchor=${l.modes[a.name]}${a.anchor === "auto" ? " (auto)" : ""}`).join("; ")}.`,
      `Cell ${l.cellW}×${l.cellH} px, pivot (${l.pivot[0]}, ${l.pivot[1]}); atlas ${l.width * p.scale}×${l.height * p.scale} px at scale ${p.scale}×.`,
    ].join("\n");
  }
  const result = (kind: string, p: Project, l: ReturnType<typeof layout>, warnings: string[], extra: Record<string, unknown> = {}) => ({
    kind,
    project: p,
    warnings,
    cell: [l.cellW, l.cellH],
    pivot: l.pivot,
    modes: l.modes,
    ...extra,
  });

  const projectSchema = z
    .record(z.string(), z.unknown())
    .describe('{name, actions: [{name, loop, anchor "auto"|"feet"|"center"|"keep", frames: [{source, region?: {x,y,w,h}, duration (ms), dx, dy}]}], scale (1–8, nearest neighbour), padding, background "auto"|"none"|"#rrggbb", output}');

  tool(
    "sprite_open",
    {
      description:
        "Open Sprite Animation Pack with a character's animation frames: a folder (or list) of PNG frames — grouped into actions by sub-folder or by file name without its frame number (run_01.png, run_02.png…) — or a whole sprite sheet sliced by a grid, one action per row (or column). Lines up every frame on a common anchor (feet), and opens the panel to preview and fix each action. Or pass an existing .sprites.json project.",
      input: {
        frames: z.union([z.string(), z.array(z.string())]).optional().describe("Folder of PNG frames, or a list of PNG files."),
        sheet: z.string().optional().describe("A sprite sheet PNG."),
        grid: z.object({ cols: z.number().int().positive().optional(), rows: z.number().int().positive().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() }).optional().describe("Sheet cell size (px) or cols/rows."),
        by: z.enum(["row", "column"]).optional().describe("Sheet: one action per row (default) or per column."),
        actions: z.array(z.string()).optional().describe("Sheet: action names in order (e.g. [\"idle\",\"run\",\"jump\"])."),
        name: z.string().optional(),
        fps: z.number().positive().optional().describe("Default 10."),
        project: z.string().optional(),
      },
      openPanel: true,
      timeoutMs: 120_000,
    },
    async ({ frames, sheet, grid, by = "row", actions: names, name, fps = 10, project: path }) => {
      let raw: any;
      const notes: string[] = [];
      if (path) {
        try {
          raw = JSON.parse(await ws.readText(path));
        } catch {
          throw new KitError("bad_project", `Cannot read project ${path}.`);
        }
      } else if (sheet) {
        const s = sliceSheet(await image(sheet), sheet, grid ?? {}, by, names ?? [], "auto", fps);
        if (!s.actions.length) throw new KitError("empty_sheet", `${sheet}: every cell is empty with that grid.`);
        notes.push(`Sliced ${sheet} into ${s.cols}×${s.rows} cells of ${s.cell[0]}×${s.cell[1]} px; ${by === "row" ? "rows" : "columns"} → actions.`);
        if (names && names.length !== s.actions.length) notes.push(`! ${names.length} action names given for ${s.actions.length} non-empty ${by}s.`);
        raw = { name: name ?? sheet.split("/").pop()!.replace(/\.[^.]+$/, ""), actions: s.actions };
      } else if (frames) {
        let files: string[];
        if (Array.isArray(frames)) files = frames;
        else files = (await ws.list({ dir: frames, exts: IMAGE_EXTS, limit: 2000 })).map((f) => f.path);
        if (!files.length) throw new KitError("no_frames", `No PNG frames found in ${String(frames)}.`);
        const grouped = groupFiles(files, fps);
        raw = { name: name ?? (Array.isArray(frames) ? grouped[0].name : frames.split("/").filter(Boolean).pop()), actions: grouped };
      } else throw new KitError("no_input", "Pass `frames` (folder or files), `sheet` (+ grid), or `project`.");
      const { project, warnings, l } = await prepare(raw);
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      return {
        text: [...notes, summary(project, l), ...warnings.map((w) => `! ${w}`), `Saved ${projectPath(project)}. Rename actions, set fps/loop with sprite_save, then sprite_export. "keep" = frames already share a canvas (good for jumps); "feet" = align feet on one baseline.`].join("\n"),
        structured: result("project", project, l, warnings),
      };
    },
  );

  tool(
    "sprite_save",
    { description: "Validate and save the project: rename/reorder actions, frame order and durations, loop, anchor mode, per-frame nudges (dx, dy), scale, padding, background keying.", input: { project: projectSchema } },
    async ({ project: raw }) => {
      const { project, warnings, l } = await prepare(raw);
      await ws.write(projectPath(project), JSON.stringify(project, null, 1) + "\n");
      return { text: [summary(project, l), ...warnings.map((w) => `! ${w}`), `Saved ${projectPath(project)}.`].join("\n"), structured: result("project", project, l, warnings) };
    },
  );

  tool(
    "sprite_export",
    {
      description:
        "Export the animation pack to <output>/<name>/: atlas PNG (uniform cells, one row per action), Aseprite-format JSON with frame tags (Phaser 3: load.aseprite + createFromAseprite), Godot 4 SpriteFrames .tres, Unity slicing notes, a Phaser snippet and the project file.",
      input: { project: projectSchema },
    },
    async ({ project: raw }) => {
      const { project: p, warnings, l } = await prepare(raw);
      const dir = `${p.output}/${p.name}`;
      const png = `${p.name}.png`;
      const atlas = upscale(compose(l), p.scale);
      const files = [
        await ws.write(`${dir}/${png}`, encodePng(atlas)),
        await ws.write(`${dir}/${p.name}.json`, asepriteJson(p, l, png)),
        await ws.write(`${dir}/${p.name}.tres`, godotTres(p, l, png)),
        await ws.write(`${dir}/${p.name}.unity.md`, unityNotes(p, l, png)),
        await ws.write(`${dir}/${p.name}.phaser.js`, phaserSnippet(p, l, `${p.name}.json`, png)),
        await ws.write(projectPath(p), JSON.stringify(p, null, 1) + "\n"),
      ];
      return {
        text: [`Exported ${files.join(", ")}.`, summary(p, l), ...warnings.map((w) => `! ${w}`)].join("\n"),
        structured: result("exported", p, l, warnings, { files }),
      };
    },
  );

  tool(
    "atlas_preview",
    { description: "Atlas (scale 1) and frame rectangles for the panel.", input: { project: projectSchema }, visibility: ["app"], readOnly: true },
    async ({ project: raw }) => {
      const { project, warnings, l } = await prepare(raw);
      return {
        text: `${l.width}×${l.height}`,
        structured: { ...result("preview", project, l, warnings), data: encodePng(compose(l)).toString("base64"), frames: l.frames.map((f) => ({ action: f.action, index: f.index, name: f.name, x: f.x, y: f.y, duration: f.duration })) },
      };
    },
  );

  tool(
    "workspace_files",
    { description: "PNG files, folders with PNGs and projects for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const all = (await ws.list({ exts: [".png", ".json"], limit: 4000 })).map((f) => f.path);
      const pngs = all.filter((f) => f.endsWith(".png"));
      const folders = [...new Set(pngs.map((f) => f.split("/").slice(0, -1).join("/")).filter(Boolean))];
      return { text: `${pngs.length}`, structured: { pngs, folders, projects: all.filter((f) => f.endsWith(".sprites.json")) } };
    },
  );

  return server;
}
