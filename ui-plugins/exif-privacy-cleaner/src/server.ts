import { createApp, htmlTable, toCsv, type AppDef, type Issue, type Project } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { clean, inspect, kindOf, type CleanOptions } from "./clean.ts";

export const NAME = "exif-privacy-cleaner";
export const VERSION = "0.1.0";
const EXTS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"];
const opts = (p: Project): CleanOptions => ({ mode: p.settings.mode === "gps" ? "gps" : "all", keepOrientation: p.settings.keepOrientation !== false });
const base = (p: string) => p.split("/").pop()!;
function target(p: Project, path: string) {
  if (p.settings.output === "beside") return path.replace(/(\.[^./]+)$/, "-clean$1");
  return `${NAME}/${p.name}/clean/${path}`;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "exifclean",
  title: ["照片隐私信息清除", "EXIF Privacy Cleaner"],
  openDescription:
    "Before sharing photos, show and remove hidden metadata: GPS location, camera make/model, date taken, software, comments, XMP/IPTC and PNG text. Works on JPEG, PNG and WebP without re-encoding (pixels untouched, ICC colour profile kept, orientation kept so photos don't turn sideways). Mode “all” removes everything, “gps” removes only the location. Writes cleaned copies (into the plugin output, or next to the originals as name-clean.jpg) and a before/after report. Originals are never changed. HEIC/TIFF are listed but not cleaned in v0.1.",
  inputs: { exts: EXTS, min: 1, max: 5, folders: true, label: ["选择要分享的照片所在文件夹", "Pick the folder with the photos to share"] },
  settings: [
    { key: "mode", label: ["清除什么", "Remove"], type: "select", default: "all", options: [{ value: "all", label: ["全部元数据（位置、相机、时间、备注…）", "All metadata (location, camera, time, notes…)"] }, { value: "gps", label: ["只清除 GPS 位置", "Only the GPS location"] }] },
    { key: "keepOrientation", label: ["保留旋转方向", "Keep orientation"], type: "bool", default: true, help: ["否则竖拍的照片可能变横", "Otherwise portrait photos may show sideways"] },
    { key: "output", label: ["保存到", "Save to"], type: "select", default: "folder", options: [{ value: "folder", label: ["插件输出文件夹（保持目录结构）", "Plugin output folder (same structure)"] }, { value: "beside", label: ["原图旁边（文件名-clean）", "Next to originals (name-clean)"] }] },
    { key: "recursive", label: ["包含子文件夹", "Include subfolders"], type: "bool", default: true, reload: true },
  ],
  columns: () => [
    { key: "clean", label: ["清除", "Clean"], type: "bool" },
    { key: "path", label: ["文件", "File"], readOnly: true, wide: true },
    { key: "_gps", label: ["位置", "Location"], readOnly: true },
    { key: "_found", label: ["发现的信息", "Found"], readOnly: true, wide: true },
  ],
  async load({ ws, files, settings }) {
    const rows = [];
    for (const dir of files) {
      if (!(await ws.exists(dir))) throw new KitError("not_found", `Not found: ${dir}`);
      const list = EXTS.some((e) => dir.toLowerCase().endsWith(e)) ? [{ path: dir }] : await ws.list({ dir, exts: EXTS, recursive: Boolean(settings.recursive ?? true), limit: 5000 });
      for (const f of list) {
        if (f.path.startsWith(`${NAME}/`) || /-clean\.[^.]+$/.test(f.path)) continue;
        const b = await ws.read(f.path);
        const x = inspect(b);
        rows.push({
          clean: true, path: f.path, kind: x.kind,
          lat: x.gps ? +x.gps.lat.toFixed(5) : "", lon: x.gps ? +x.gps.lon.toFixed(5) : "",
          camera: [x.make, x.model].filter(Boolean).join(" "), taken: x.dateTaken ?? x.modified ?? "", software: x.software ?? "",
          extra: [x.comment ? "comment" : "", x.xmp ? "XMP" : "", ...x.text].filter(Boolean).join(", "), tags: x.tags, orientation: x.orientation ?? 1,
        });
      }
    }
    if (!rows.length) throw new KitError("empty", "No JPEG/PNG/WebP/HEIC photos found.");
    return { rows };
  },
  compute(p) {
    const issues: Issue[] = [];
    const o = opts(p);
    let gps = 0, meta = 0;
    const rows = p.rows.map((r, i) => {
      const found = [r.camera && `📷 ${r.camera}`, r.taken && `🕒 ${r.taken}`, r.software && `software ${r.software}`, r.extra && `${r.extra}`, Number(r.tags) && `${r.tags} EXIF tags`].filter(Boolean).join(" · ");
      if (r.lat !== "") gps++;
      if (found || r.lat !== "") meta++;
      if (r.kind === "other") issues.push({ level: "warn", row: i, message: `${base(String(r.path))}: HEIC/TIFF can't be cleaned in v0.1 — export it as JPEG first (it will be skipped).` });
      else if (r.lat !== "" && !r.clean) issues.push({ level: "warn", row: i, key: "clean", message: `${base(String(r.path))} still contains its GPS location and is not selected for cleaning.` });
      return { ...r, _gps: r.lat !== "" ? `📍 ${r.lat}, ${r.lon}` : "—", _found: found || "—" };
    });
    const todo = p.rows.filter((r) => r.clean && r.kind !== "other").length;
    const preview = `<p><b>${gps}</b> of ${p.rows.length} photos reveal a GPS location · ${meta} carry metadata · mode: ${o.mode === "all" ? "remove all metadata" : "remove GPS only"} · ${todo} will be cleaned</p>` +
      htmlTable(["File", "Location", "Camera", "Taken", "Other"], p.rows.slice(0, 200).map((r) => [base(String(r.path)), r.lat !== "" ? `${r.lat}, ${r.lon}` : "", r.camera, r.taken, r.extra]));
    return { rows, issues, preview, summary: `${p.rows.length} photos, ${gps} with GPS location, ${todo} to clean`, stats: { photos: p.rows.length, withGps: gps, withMetadata: meta, toClean: todo } };
  },
  exports: [
    {
      id: "clean", label: ["导出清理后的照片", "Write cleaned photos"], description: "cleaned copies (originals untouched) — into the plugin output or next to the originals as name-clean.ext",
      async run({ ws, project }) {
        const o = opts(project);
        const out: string[] = [];
        const log: string[][] = [];
        for (const r of project.rows) {
          if (!r.clean || r.kind === "other") continue;
          const src = await ws.read(String(r.path));
          if (kindOf(src) === "other") continue;
          const { data, removed } = clean(src, o);
          const to = target(project, String(r.path));
          out.push(await ws.write(to, data));
          log.push([String(r.path), to, removed.join(" ") || "nothing found", String(src.length), String(data.length)]);
        }
        project.meta.log = log;
        return { files: out, note: `Cleaned ${out.length} photo(s); originals were not changed.` };
      },
    },
    {
      id: "report", label: ["清除报告 CSV", "Report CSV"], description: "privacy-report.csv: what each photo contained and what was removed",
      async run({ project, write }) {
        const log = new Map(((project.meta.log as string[][]) ?? []).map((l) => [l[0], l]));
        return [await write("privacy-report.csv", toCsv(["file", "gps_lat", "gps_lon", "camera", "taken", "software", "other", "cleaned_copy", "removed"], project.rows.map((r) => [r.path, r.lat, r.lon, r.camera, r.taken, r.software, r.extra, log.get(String(r.path))?.[1] ?? "", log.get(String(r.path))?.[2] ?? ""])))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
