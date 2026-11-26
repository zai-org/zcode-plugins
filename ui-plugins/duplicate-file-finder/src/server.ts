import { createApp, htmlTable, toCsv, type AppDef, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { findGroups, hashFile, human, pickKeep } from "./dupes.ts";

export const NAME = "duplicate-file-finder";
export const VERSION = "0.1.0";

const local = (iso: string) => { const d = new Date(iso); const z = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`; };
interface Moved { from: string; to: string }
const groupsOf = (p: Project) => {
  const g = new Map<number, number[]>();
  p.rows.forEach((r, i) => g.set(Number(r.group), [...(g.get(Number(r.group)) ?? []), i]));
  return g;
};

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "dupes",
  title: ["重复文件查找", "Duplicate File Finder"],
  openDescription:
    "Find byte-identical duplicate files in workspace folders (size first, then SHA-256 — never by name). Groups duplicates, picks one file to keep per group (smart: the one without “copy/副本/(1)” in its name and with the shortest path; or oldest/newest/inside a preferred folder) and shows the space you would free. The user can change which file is kept. Export a CSV/HTML report, or move the extra copies into a review folder inside the plugin's output (nothing is deleted; “restore” moves them back).",
  inputs: { exts: [], min: 1, max: 5, folders: true, label: ["选择要查重的文件夹（可多选）", "Pick the folder(s) to scan"] },
  settings: [
    { key: "minSize", label: ["忽略小于（KB）的文件", "Ignore files smaller than (KB)"], type: "number", default: 0, min: 0, reload: true },
    { key: "skipExt", label: ["忽略这些扩展名", "Ignore extensions"], type: "text", default: ".ds_store, thumbs.db", reload: true },
    { key: "keep", label: ["每组保留哪个", "Keep in each group"], type: "select", default: "smart", options: [{ value: "smart", label: ["智能（不带“副本/(1)”、路径最短）", "Smart (no “copy/(1)”, shortest path)"] }, { value: "oldest", label: ["最早修改的", "Oldest"] }, { value: "newest", label: ["最新修改的", "Newest"] }, { value: "folder", label: ["优先保留某文件夹里的", "Prefer a folder"] }], reload: true },
    { key: "prefer", label: ["优先保留的文件夹", "Preferred folder"], type: "text", default: "", reload: true },
  ],
  columns: () => [
    { key: "group", label: ["组", "Group"], type: "number", readOnly: true },
    { key: "keep", label: ["保留", "Keep"], type: "bool" },
    { key: "path", label: ["文件", "File"], readOnly: true, wide: true },
    { key: "_size", label: ["大小", "Size"], readOnly: true },
    { key: "mtime", label: ["修改时间", "Modified"], readOnly: true },
  ],
  async load({ ws, files, settings }) {
    const min = Number(settings.minSize ?? 0) * 1024;
    const skip = String(settings.skipExt ?? "").toLowerCase().split(/[,，\s]+/).filter(Boolean);
    const seen = new Set<string>();
    const recs = [];
    for (const dir of files) {
      if (!(await ws.exists(dir))) throw new KitError("not_found", `Folder not found: ${dir}`);
      for (const f of await ws.list({ dir, limit: 20000 })) {
        if (seen.has(f.path) || f.path.startsWith(`${NAME}/`)) continue;
        seen.add(f.path);
        const lower = f.path.toLowerCase();
        if (f.size === 0 || f.size < min || skip.some((s) => lower.endsWith(s))) continue;
        recs.push({ path: f.path, size: f.size, mtime: (await ws.mtime(f.path)).toISOString() });
      }
    }
    const groups = await findGroups(recs, (f) => hashFile(ws.resolve(f.path)));
    const rule = String(settings.keep ?? "smart");
    const rows: Row[] = [];
    groups.forEach((g, gi) => {
      const k = pickKeep(g.files, rule, String(settings.prefer ?? ""));
      g.files.forEach((f, i) => rows.push({ group: gi + 1, keep: i === k, path: f.path, size: f.size, mtime: local(f.mtime), hash: g.hash }));
    });
    return { rows, meta: { scanned: recs.length } };
  },
  compute(p) {
    const issues: Issue[] = [];
    let wasted = 0, extra = 0;
    for (const [g, idx] of groupsOf(p)) {
      const kept = idx.filter((i) => p.rows[i].keep);
      if (!kept.length) issues.push({ level: "error", row: idx[0], key: "keep", message: `Group ${g}: no file is kept — tick “Keep” on at least one copy.` });
      const moving = idx.length - kept.length;
      extra += moving; wasted += moving * Number(p.rows[idx[0]].size);
    }
    const moved = (p.meta.moved as Moved[] | undefined) ?? [];
    const rows = p.rows.map((r) => ({ ...r, _size: human(Number(r.size)) }));
    const groups = groupsOf(p).size;
    const preview =
      `<p><b>${groups}</b> duplicate groups · <b>${extra}</b> extra copies · <b>${human(wasted)}</b> can be freed · ${p.meta.scanned ?? "?"} files scanned${moved.length ? ` · ${moved.length} copies already moved to review (restore available)` : ""}</p>` +
      htmlTable(["#", "Keep / 保留", "Extra copies / 多余副本", "Size"], [...groupsOf(p)].slice(0, 100).map(([g, idx]) => [g, idx.filter((i) => p.rows[i].keep).map((i) => p.rows[i].path).join("\n"), idx.filter((i) => !p.rows[i].keep).map((i) => p.rows[i].path).join("\n"), human(Number(p.rows[idx[0]].size))]));
    return { rows, issues, preview, summary: groups ? `${groups} duplicate groups, ${extra} extra copies, ${human(wasted)} to free` : "No duplicates found", stats: { groups, extra, freeable: human(wasted) } };
  },
  exports: [
    {
      id: "report", label: ["查重报告 CSV + HTML", "Report CSV + HTML"], description: "duplicates.csv (group, keep, path, size, sha256) and duplicates.html",
      async run({ project, computed, write }) {
        const csv = toCsv(["group", "keep", "path", "size_bytes", "modified", "sha256"], project.rows.map((r) => [r.group, r.keep ? "keep" : "extra", r.path, r.size, r.mtime, r.hash]));
        const html = `<!doctype html><meta charset="utf-8"><title>Duplicates</title><style>body{font:14px system-ui;margin:24px}td,th{border:1px solid #ccc;padding:4px 8px;white-space:pre-wrap;vertical-align:top}table{border-collapse:collapse}</style><h1>Duplicate files</h1>${computed.preview}`;
        return [await write("duplicates.csv", csv), await write("duplicates.html", html)];
      },
    },
    {
      id: "move", label: ["把多余副本移到待删文件夹", "Move extra copies to review"], description: "move unticked copies into duplicate-file-finder/<project>/review/ keeping their paths (no deletion; “restore” moves them back)",
      async run({ ws, project, outDir, write }) {
        for (const [g, idx] of groupsOf(project)) if (!idx.some((i) => project.rows[i].keep)) throw new KitError("has_errors", `Group ${g} has no kept file; nothing was moved.`);
        const moves = project.rows.filter((r) => !r.keep).map((r) => ({ from: String(r.path), to: `${outDir}/review/${r.path}` }));
        if (!moves.length) return { files: [], note: "No extra copies to move." };
        const done: Moved[] = [];
        for (const m of moves) {
          if (!(await ws.exists(m.from))) continue;
          await ws.move(m.from, m.to);
          done.push(m);
        }
        project.meta.moved = [...((project.meta.moved as Moved[]) ?? []), ...done];
        const gone = new Set(done.map((m) => m.from));
        project.rows = project.rows.filter((r) => !gone.has(String(r.path)));
        const counts = groupsOf(project);
        project.rows = project.rows.filter((r) => (counts.get(Number(r.group))?.length ?? 0) > 1);
        const log = await write("moved.csv", toCsv(["from", "to"], (project.meta.moved as Moved[]).map((m) => [m.from, m.to])));
        return { files: [log], note: `Moved ${done.length} extra copies to ${outDir}/review/. Check them, then delete that folder yourself — or use “restore”.` };
      },
    },
    {
      id: "restore", manual: true, label: ["把移走的副本放回原处", "Restore moved copies"], description: "move everything from review/ back to where it was",
      async run({ ws, project, write }) {
        const moved = (project.meta.moved as Moved[] | undefined) ?? [];
        if (!moved.length) throw new KitError("nothing_to_restore", "Nothing has been moved in this project.");
        const back: Moved[] = [];
        for (const m of moved) {
          if (!(await ws.exists(m.to))) continue;
          if (await ws.exists(m.from)) throw new KitError("exists", `${m.from} exists again; move it away first.`);
          await ws.move(m.to, m.from);
          back.push(m);
        }
        project.meta.moved = [];
        return { files: [await write("restored.csv", toCsv(["path"], back.map((m) => [m.from])))], note: `Restored ${back.length} file(s). Reopen the folder to scan again.` };
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
