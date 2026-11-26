import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { blame, CODE_EXTS, scanText } from "./scan.ts";
const decodeText = (b: Uint8Array) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^\uFEFF/, ""); } catch { return new TextDecoder("gb18030").decode(b); } };

export const NAME = "todo-collector";
export const VERSION = "0.1.0";

const PRI = ["high", "normal", "low"];
const tagsOf = (s: Record<string, unknown>) => String(s.tags || "TODO,FIXME,HACK,XXX,BUG").split(/[,\s，]+/).map((t) => t.trim()).filter(Boolean);
const defaultPriority = (tag: string, urgent: boolean) => (urgent || tag === "FIXME" || tag === "BUG" ? "high" : tag === "HACK" || tag === "XXX" || tag === "NOTE" ? "low" : "normal");
const ageDays = (d: string, now = Date.now()) => (d ? Math.floor((now - Date.parse(`${d}T00:00:00Z`)) / 86400000) : undefined);
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const sel = (p: Project) => p.rows.filter((r) => r.include !== false);

function sorted(p: Project): Row[] {
  const by = String(p.settings.groupBy ?? "priority");
  return [...sel(p)].sort((a, b) => (by === "priority" ? PRI.indexOf(String(a.priority)) - PRI.indexOf(String(b.priority)) : 0) || (by === "owner" ? String(a.owner || "~").localeCompare(String(b.owner || "~")) : 0) || String(a.file).localeCompare(String(b.file)) || Number(a.line) - Number(b.line));
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "todos",
  title: ["代码待办汇总", "TODO Collector"],
  openDescription:
    "Collect TODO / FIXME / HACK / XXX / BUG comments (tags configurable, e.g. add NOTE or 待办) from source files in a workspace folder — 50+ languages (// # /* * -- <!-- ; comments; strings are ignored; markdown only inside HTML comments or code fences). Picks up an owner from TODO(name) or @name, marks !!!/urgent/紧急 as high priority, and — if the folder is in a git repo and git is installed — adds the author and date of each line via git blame, so old items stand out. Each item is a row: set priority, owner, reword, or leave it out. Exports todos.csv (importable as issues) and TODO.md grouped by priority, owner or file with file:line links.",
  inputs: { exts: [], min: 1, max: 1, folders: true, label: ["选择代码文件夹", "Pick the code folder"] },
  settings: [
    { key: "tags", label: ["要收集的标记", "Tags to collect"], type: "text", default: "TODO,FIXME,HACK,XXX,BUG", reload: true },
    { key: "blame", label: ["用 git blame 读作者和日期", "Author & date via git blame"], type: "bool", default: true, reload: true },
    { key: "groupBy", label: ["TODO.md 分组", "Group TODO.md by"], type: "select", default: "priority", options: [{ value: "priority", label: ["优先级", "Priority"] }, { value: "owner", label: ["负责人", "Owner"] }, { value: "file", label: ["文件", "File"] }] },
    { key: "staleDays", label: ["超过多少天算陈旧", "Stale after (days)"], type: "number", default: 180, min: 1, max: 5000 },
  ],
  columns: () => [
    { key: "include", label: ["收录", "Include"], type: "bool" },
    { key: "tag", label: ["标记", "Tag"], readOnly: true },
    { key: "priority", label: ["优先级", "Priority"], type: "select", options: PRI },
    { key: "owner", label: ["负责人", "Owner"] },
    { key: "text", label: ["内容", "Text"], wide: true },
    { key: "_where", label: ["位置", "Location"], readOnly: true },
    { key: "author", label: ["写的人", "Written by"], readOnly: true },
    { key: "date", label: ["日期", "Date"], readOnly: true },
    { key: "_age", label: ["天数", "Age (days)"], readOnly: true },
  ],
  async load({ ws, files, settings, previous }) {
    const dir = files[0] || ".";
    const list = await ws.list({ dir, exts: CODE_EXTS, limit: 20000 });
    const tags = tagsOf(settings);
    if (!tags.length) throw new KitError("no_tags", "Set at least one tag to collect.");
    const rows: Row[] = [];
    let blamed = 0;
    for (const f of list) {
      if (f.size > 2 * 1024 * 1024) continue;
      const buf = await ws.read(f.path);
      if (buf.subarray(0, 8000).includes(0)) continue;
      const hits = scanText(f.path, decodeText(buf), tags, /\.md$/i.test(f.path));
      if (!hits.length) continue;
      const bl = settings.blame !== false ? await blame(ws.resolve("."), f.path) : new Map();
      if (bl.size) blamed++;
      for (const h of hits) {
        const b = bl.get(h.line);
        const date = b ? new Date(b.time * 1000).toISOString().slice(0, 10) : "";
        const old = previous?.find((r) => r.file === h.file && r.text === h.text);
        rows.push({ include: old?.include ?? true, tag: h.tag, priority: old?.priority ?? defaultPriority(h.tag, h.urgent), owner: old?.owner ?? h.owner, text: h.text, file: h.file, line: h.line, author: b?.author ?? "", date });
      }
    }
    return { rows, meta: { scanned: list.length, blamed } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const stale = Number(p.settings.staleDays ?? 180);
    const rows = p.rows.map((r, i) => {
      const age = ageDays(String(r.date ?? ""));
      if (r.include !== false && age !== undefined && age > stale && r.priority !== "low") issues.push({ level: "info", row: i, message: `${r.file}:${r.line} has been there ${age} days.` });
      if (r.include !== false && !String(r.text ?? "").trim()) issues.push({ level: "warn", row: i, key: "text", message: `${r.file}:${r.line}: ${r.tag} has no description.` });
      return { ...r, _where: `${r.file}:${r.line}`, _age: age ?? "" };
    });
    if (p.settings.blame !== false && !p.meta.blamed && p.rows.length) issues.unshift({ level: "info", message: "No git history found (not a git repo, or git not installed) — author and date are empty." });
    const s = sel(p);
    const count = (pr: string) => s.filter((r) => r.priority === pr).length;
    const owners = new Map<string, number>();
    for (const r of s) owners.set(String(r.owner || "—"), (owners.get(String(r.owner || "—")) ?? 0) + 1);
    const preview = `<p>${p.meta.scanned} files scanned · <b>${s.length}</b> items · <span style="color:#dc2626">high ${count("high")}</span> · normal ${count("normal")} · low ${count("low")}</p><p style="font-size:13px">${[...owners].map(([o, n]) => `${esc(o)} <b>${n}</b>`).join(" · ")}</p><pre style="white-space:pre-wrap;font-size:12px;max-height:480px;overflow:auto">${esc(markdown(p).slice(0, 5000))}</pre>`;
    return { rows, issues, preview, summary: `${s.length} item(s) in ${new Set(s.map((r) => r.file)).size} file(s) · ${count("high")} high`, stats: { items: s.length, high: count("high"), files: Number(p.meta.scanned ?? 0) } };
  },
  exports: [
    {
      id: "csv", label: ["CSV 清单", "CSV list"], description: "todos.csv — title, priority, owner, tag, file, line, author, date (import into an issue tracker or spreadsheet)",
      async run({ project, write }: ExportCtx) {
        const head = ["title", "priority", "owner", "tag", "file", "line", "author", "date", "age_days"];
        const lines = sorted(project).map((r) => [r.text, r.priority, r.owner, r.tag, r.file, r.line, r.author, r.date, ageDays(String(r.date ?? "")) ?? ""].map(csvCell).join(","));
        return [await write("todos.csv", "\uFEFF" + [head.join(","), ...lines].join("\r\n") + "\r\n")];
      },
    },
    {
      id: "md", label: ["TODO.md", "TODO.md"], description: "TODO.md — checklist grouped by priority, owner or file, with file:line links",
      async run({ project, write }: ExportCtx) {
        return [await write("TODO.md", markdown(project))];
      },
    },
  ],
};

function markdown(p: Project): string {
  const by = String(p.settings.groupBy ?? "priority");
  const rows = sorted(p);
  const label = (r: Row) => (by === "priority" ? ({ high: "🔴 High", normal: "🟡 Normal", low: "⚪ Low" } as Record<string, string>)[String(r.priority)] : by === "owner" ? String(r.owner || "Unassigned") : String(r.file));
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const g = label(r); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); }
  const out = [`# TODO\n`, `${rows.length} item(s)\n`];
  for (const [g, rs] of groups) {
    out.push(`## ${g} (${rs.length})\n`);
    for (const r of rs) out.push(`- [ ] **${r.tag}** ${String(r.text || "(no description)")}${by !== "owner" && r.owner ? ` — @${r.owner}` : ""} ([${r.file}:${r.line}](${encodeURI(String(r.file))}#L${r.line}))${r.date ? ` · ${r.date}` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
