import { open as openFile } from "node:fs/promises";
import { createApp, htmlTable, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { dateFromName, fill, fmtLocal, normalizeDate } from "./dates.ts";
import { mp4Created, readExif } from "./exif.ts";

export const NAME = "photo-date-organizer";
export const VERSION = "0.1.0";
const MEDIA = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif", ".tif", ".tiff", ".dng", ".mp4", ".mov", ".m4v", ".3gp"];
const SOURCES: Record<string, [string, string]> = { exif: ["EXIF 拍摄时间", "EXIF taken"], video: ["视频创建时间", "Video created"], name: ["文件名", "File name"], file: ["文件修改时间", "File time"], manual: ["手动", "Manual"] };

async function head(ws: Workspace, path: string, size: number) {
  const fh = await openFile(ws.resolve(path), "r");
  try {
    const n = Math.min(size, 2 * 1024 * 1024);
    const a = Buffer.alloc(n);
    await fh.read(a, 0, n, 0);
    if (size <= n) return a;
    const t = Math.min(size - n, 2 * 1024 * 1024);
    const b = Buffer.alloc(t);
    await fh.read(b, 0, t, size - t);
    return Buffer.concat([a, b]);
  } finally { await fh.close(); }
}

interface Move { from: string; to: string }
const base = (p: string) => p.split("/").pop()!;
const extOf = (p: string) => (base(p).match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
const rootOf = (p: Project) => (p.settings.mode === "copy" ? `${NAME}/${p.name}/sorted` : p.inputs[0].replace(/\/$/, ""));

function plan(p: Project, taken: Set<string>) {
  const pattern = String(p.settings.folders ?? "yyyy/yyyy-MM");
  const naming = String(p.settings.naming ?? "keep");
  const used = new Set<string>();
  const sources = new Set(p.rows.map((r) => String(r.path).toLowerCase()));
  return p.rows.map((r) => {
    const date = normalizeDate(String(r.date ?? ""));
    if (!date) return { from: String(r.path), to: "", error: `Date “${r.date}” is not a date (use 2026-10-02 09:15:00)` };
    const dir = [rootOf(p), pattern === "none" ? "" : fill(pattern, date)].filter(Boolean).join("/");
    const ext = base(String(r.path)).match(/\.[^.]+$/)?.[0] ?? "";
    const stem = base(String(r.path)).replace(/\.[^.]+$/, "");
    let name = naming === "date" ? fill("yyyyMMdd_HHmmss", date) : naming === "date-name" ? `${fill("yyyyMMdd_HHmmss", date)}_${stem}` : stem;
    let to = `${dir}/${name}${ext}`;
    for (let k = 2; used.has(to.toLowerCase()) || (taken.has(to.toLowerCase()) && !sources.has(to.toLowerCase())); k++) to = `${dir}/${name}-${k}${ext}`;
    used.add(to.toLowerCase());
    return { from: String(r.path), to };
  });
}

async function takenPaths(ws: Workspace, p: Project) {
  const root = rootOf(p);
  if (!(await ws.exists(root))) return new Set<string>();
  return new Set((await ws.list({ dir: root, limit: 20000 })).map((f) => f.path.toLowerCase()));
}

async function moveAll(ws: Workspace, moves: Move[], copy: boolean) {
  const done: Move[] = [];
  try {
    for (const m of moves) {
      if (copy) await ws.write(m.to, await ws.read(m.from, 4 * 1024 ** 3));
      else await ws.move(m.from, m.to);
      done.push(m);
    }
  } catch (e) {
    if (!copy) for (const m of done.reverse()) await ws.move(m.to, m.from).catch(() => undefined);
    throw e;
  }
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "photos",
  title: ["照片按日期整理", "Photo Date Organizer"],
  openDescription:
    "Sort photos and videos in a workspace folder into date folders (yyyy/yyyy-MM, yyyy-MM, yyyy/MM, yyyy-MM-dd) and optionally rename them to their date (20261002_091500.jpg). The date comes from EXIF DateTimeOriginal (JPEG, HEIC, TIFF/DNG), the video creation time (MP4/MOV), a date in the file name (IMG_20261103_101522, Screenshot 2026-11-05 at 10.22.31, WeChat/mmexport timestamps) or, last, the file time — every row shows which. Dates can be corrected in the table. Mode “move” (undo available) or “copy” into the plugin's output.",
  inputs: { exts: MEDIA, min: 1, max: 1, folders: true, label: ["选择照片文件夹", "Pick the photo folder"] },
  settings: [
    { key: "folders", label: ["文件夹结构", "Folder layout"], type: "select", default: "yyyy/yyyy-MM", options: [{ value: "yyyy/yyyy-MM", label: ["2026/2026-10", "2026/2026-10"] }, { value: "yyyy-MM", label: ["2026-10", "2026-10"] }, { value: "yyyy/MM", label: ["2026/10", "2026/10"] }, { value: "yyyy/yyyy-MM-dd", label: ["2026/2026-10-02", "2026/2026-10-02"] }, { value: "yyyy-MM-dd", label: ["2026-10-02", "2026-10-02"] }, { value: "none", label: ["不分文件夹", "No folders"] }] },
    { key: "naming", label: ["文件名", "File names"], type: "select", default: "keep", options: [{ value: "keep", label: ["保留原名", "Keep"] }, { value: "date", label: ["改成日期 20261002_091500", "Date 20261002_091500"] }, { value: "date-name", label: ["日期 + 原名", "Date + original"] }] },
    { key: "mode", label: ["方式", "Mode"], type: "select", default: "move", options: [{ value: "move", label: ["移动（可撤销）", "Move (undo available)"] }, { value: "copy", label: ["复制到插件输出文件夹", "Copy to the plugin output"] }] },
    { key: "recursive", label: ["包含子文件夹", "Include subfolders"], type: "bool", default: true, reload: true },
    { key: "useFileTime", label: ["没有其他日期时用文件修改时间", "Fall back to file time"], type: "bool", default: true, reload: true },
  ],
  columns: () => [
    { key: "path", label: ["文件", "File"], readOnly: true, wide: true },
    { key: "date", label: ["日期", "Date"] },
    { key: "_source", label: ["日期来源", "Date from"], readOnly: true },
    { key: "camera", label: ["相机", "Camera"], readOnly: true },
    { key: "_to", label: ["整理到", "Goes to"], readOnly: true, wide: true },
  ],
  async load({ ws, files, settings }) {
    const dir = files[0];
    if (!(await ws.exists(dir))) throw new KitError("not_found", `Folder not found: ${dir}`);
    const list = (await ws.list({ dir, exts: MEDIA, recursive: Boolean(settings.recursive ?? true), limit: 20000 })).filter((f) => !f.path.startsWith(`${NAME}/`));
    if (!list.length) throw new KitError("empty", "No photos or videos in that folder.");
    const rows = [];
    for (const f of list) {
      const buf = await head(ws, f.path, f.size);
      let date: string | undefined, source = "";
      let camera = "";
      if ([".mp4", ".mov", ".m4v", ".3gp"].includes(extOf(f.path))) {
        const d = mp4Created(buf);
        if (d) { date = fmtLocal(d); source = "video"; }
      } else {
        const ex = readExif(buf);
        camera = [ex.make, ex.model].filter(Boolean).join(" ");
        date = ex.dateTaken ?? ex.created;
        if (date) source = "exif";
      }
      if (!date) { date = dateFromName(base(f.path)); if (date) source = "name"; }
      if (!date && settings.useFileTime !== false) { date = fmtLocal(await ws.mtime(f.path)); source = "file"; }
      rows.push({ path: f.path, date: date ?? "", source: source || "none", camera });
    }
    return { rows };
  },
  async compute(p, { ws }) {
    const planned = plan(p, await takenPaths(ws, p));
    const issues: Issue[] = [];
    const counts: Record<string, number> = {};
    p.rows.forEach((r, i) => {
      counts[String(r.source)] = (counts[String(r.source)] ?? 0) + 1;
      if (planned[i].error) issues.push({ level: "error", row: i, key: "date", message: planned[i].error! });
      else if (r.source === "file") issues.push({ level: "warn", row: i, key: "date", message: `${base(String(r.path))}: no date inside the file or its name — using the file time, which may be when it was copied. Check it.` });
      else if (r.source === "none") issues.push({ level: "error", row: i, key: "date", message: `${base(String(r.path))}: no date found; type one in.` });
    });
    const renamed = planned.filter((x) => x.to && x.to !== x.from).length;
    const rows = p.rows.map((r, i) => {
      const s = SOURCES[String(r.source)];
      return { ...r, _source: s ? `${s[0]} / ${s[1]}` : "—", _to: planned[i].to ? planned[i].to.slice(rootOf(p).length + 1) : "" };
    });
    const byFolder = new Map<string, number>();
    for (const x of planned) if (x.to) { const f = x.to.slice(rootOf(p).length + 1).split("/").slice(0, -1).join("/") || "."; byFolder.set(f, (byFolder.get(f) ?? 0) + 1); }
    const last = p.meta.lastMove as Move[] | undefined;
    const preview = `<p>${p.rows.length} files → <b>${byFolder.size}</b> folders under <code>${rootOf(p)}</code>${last?.length ? ` · last run moved ${last.length} files (undo available)` : ""}</p>` + htmlTable(["Folder / 文件夹", "Files / 张数"], [...byFolder].sort()) + `<p class="muted">EXIF ${counts.exif ?? 0} · video ${counts.video ?? 0} · name ${counts.name ?? 0} · file time ${counts.file ?? 0}</p>`;
    return { rows, issues, preview, summary: `${p.rows.length} files into ${byFolder.size} folders, ${renamed} to ${p.settings.mode === "copy" ? "copy" : "move"}`, stats: { files: p.rows.length, folders: byFolder.size, moves: renamed, exif: counts.exif ?? 0, fileTime: counts.file ?? 0 } };
  },
  onCellEdit: (row, key) => { if (key === "date") row.source = "manual"; },
  exports: [
    {
      id: "plan", label: ["整理清单 CSV", "Plan CSV"], description: "organize-plan.csv with each file, its date, where it came from and where it goes (changes nothing)",
      async run({ ws, project, write }) {
        const planned = plan(project, await takenPaths(ws, project));
        return [await write("organize-plan.csv", toCsv(["file", "date", "date_source", "camera", "to"], project.rows.map((r, i) => [r.path, r.date, r.source, r.camera, planned[i].to])))];
      },
    },
    {
      id: "organize", label: ["开始整理", "Organize"], description: "move (or copy) the files into the date folders and write organize-log.csv",
      async run({ ws, project, write }) {
        const planned = plan(project, await takenPaths(ws, project));
        const bad = planned.find((x) => x.error);
        if (bad) throw new KitError("has_errors", `Fix the dates first: ${bad.from}: ${bad.error}`);
        if (project.rows.some((r) => r.source === "none")) throw new KitError("has_errors", "Some files have no date; type one in first.");
        const moves = planned.filter((x) => x.to !== x.from).map((x) => ({ from: x.from, to: x.to }));
        if (!moves.length) return { files: [], note: "Everything is already in place." };
        const copy = project.settings.mode === "copy";
        await moveAll(ws, moves, copy);
        if (!copy) {
          const to = new Map(moves.map((m) => [m.from, m.to]));
          project.rows = project.rows.map((r) => ({ ...r, path: to.get(String(r.path)) ?? r.path }));
          project.meta.lastMove = moves;
        }
        const log = await write("organize-log.csv", toCsv(["from", "to"], moves.map((m) => [m.from, m.to])));
        return { files: [log], note: `${copy ? "Copied" : "Moved"} ${moves.length} file(s) into ${rootOf(project)}.` };
      },
    },
    {
      id: "undo", manual: true, label: ["撤销上次整理", "Undo last move"], description: "move the files from the last “organize” back where they were",
      async run({ ws, project, write }) {
        const last = project.meta.lastMove as Move[] | undefined;
        if (!last?.length) throw new KitError("nothing_to_undo", "Nothing to undo (copies are never undone — delete the copy folder instead).");
        const back = last.map((m) => ({ from: m.to, to: m.from })).reverse();
        for (const m of back) if (!(await ws.exists(m.from))) throw new KitError("not_found", `Can't undo: ${m.from} is gone.`);
        await moveAll(ws, back, false);
        const to = new Map(back.map((m) => [m.from, m.to]));
        project.rows = project.rows.map((r) => ({ ...r, path: to.get(String(r.path)) ?? r.path }));
        delete project.meta.lastMove;
        return { files: [await write("undo-log.csv", toCsv(["from", "to"], back.map((m) => [m.from, m.to])))], note: `Moved ${back.length} file(s) back.` };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
