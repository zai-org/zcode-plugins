import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { category, normalize, type Category } from "./licenses.ts";
import { scan } from "./scan.ts";

export const NAME = "license-report";
export const VERSION = "0.1.0";

const CAT_LABEL: Record<Category, string> = { "public-domain": "public domain", permissive: "permissive", "weak-copyleft": "weak copyleft", "strong-copyleft": "strong copyleft", proprietary: "proprietary", unknown: "unknown" };
const catOf = (r: Row) => category(normalize(String(r.license ?? "")));
const visible = (p: Project) => p.rows.filter((r) => p.settings.dev || r.kind === undefined || !String(r.kind).includes("dev"));
const texts = (p: Project) => (p.meta.texts as Record<string, string>) ?? {};

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "licenses",
  title: ["依赖许可证清单", "License Report"],
  openDescription:
    "List the licence of every installed dependency of a Node.js project folder (reads node_modules — npm, yarn and pnpm layouts — or falls back to package-lock.json), including transitive ones. Licences come from package.json (license/licenses), else the LICENSE file text, normalised to SPDX (\"Apache 2.0\" → Apache-2.0, SPDX OR/AND expressions). Each package is classed permissive, public domain, weak copyleft (LGPL, MPL, EPL), strong copyleft (GPL, AGPL, SSPL), proprietary or unknown, and direct/transitive and prod/dev are shown. Copyleft and unknown licences are flagged until marked reviewed; the licence can be corrected by hand with a note. Exports an Excel report with a summary and a THIRD_PARTY_NOTICES.txt with copyright lines and full licence texts.",
  inputs: { exts: [".json"], min: 1, max: 1, folders: true, label: ["选择项目文件夹（有 package.json 的那一层）", "Pick the project folder (with package.json)"] },
  settings: [
    { key: "dev", label: ["包含开发依赖", "Include dev dependencies"], type: "bool", default: false },
    { key: "weak", label: ["提醒弱 copyleft（LGPL/MPL）", "Flag weak copyleft (LGPL/MPL)"], type: "bool", default: true },
    { key: "fullText", label: ["声明文件包含许可证全文", "Full licence texts in notices"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "name", label: ["包名", "Package"], readOnly: true },
    { key: "version", label: ["版本", "Version"], readOnly: true },
    { key: "license", label: ["许可证", "License"] },
    { key: "_category", label: ["类别", "Category"], readOnly: true },
    { key: "kind", label: ["依赖类型", "Dependency"], readOnly: true },
    { key: "source", label: ["来源", "Found in"], readOnly: true },
    { key: "reviewed", label: ["已审核", "Reviewed"], type: "bool" },
    { key: "note", label: ["备注", "Note"], wide: true },
  ],
  onCellEdit: (row, key) => { if (key === "license") row.source = "edited"; },
  async load({ ws, files }) {
    const folder = files[0].endsWith("package.json") ? files[0].replace(/\/?package\.json$/, "") || "." : files[0];
    let res;
    try { res = await scan(ws.resolve(folder)); } catch (e) { throw new KitError("scan_failed", (e as Error).message); }
    if (!res.packages.length) throw new KitError("no_dependencies", "No installed dependencies found — run npm/pnpm/yarn install first (or keep package-lock.json next to package.json).");
    const textsMap: Record<string, string> = {};
    const rows = res.packages.map((p) => {
      if (p.licenseText) textsMap[`${p.name}@${p.version}`] = p.licenseText.slice(0, 40000);
      return { name: p.name, version: p.version, license: p.license, kind: `${p.direct ? "direct" : "transitive"}${p.dev ? " · dev" : ""}`, source: p.source, reviewed: false, note: "", path: p.path, homepage: p.homepage, copyright: p.copyright };
    });
    return { rows, meta: { project: res.project, texts: textsMap } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const rows = p.rows.map((r, i) => {
      const c = catOf(r);
      const shown = p.settings.dev || !String(r.kind).includes("dev");
      if (shown && !r.reviewed) {
        const who = `${r.name}@${r.version}`;
        if (c === "strong-copyleft") issues.push({ level: "warn", row: i, key: "license", message: `${who}: ${r.license} is strong copyleft — distributing your app may require releasing your source. Review, then tick Reviewed.` });
        else if (c === "unknown") issues.push({ level: "warn", row: i, key: "license", message: `${who}: licence ${r.license ? `“${r.license}” not recognised` : "not declared"} — check the package and enter it.` });
        else if (c === "proprietary") issues.push({ level: "warn", row: i, key: "license", message: `${who}: ${r.license} — not open source; check you are allowed to ship it.` });
        else if (c === "weak-copyleft" && p.settings.weak !== false) issues.push({ level: "info", row: i, key: "license", message: `${who}: ${r.license} is weak copyleft — changes to this package itself must stay open.` });
      }
      return { ...r, license: r.license, _category: CAT_LABEL[c] };
    });
    const vis = visible(p);
    const by = new Map<string, number>();
    for (const r of vis) { const c = CAT_LABEL[catOf(r)]; by.set(c, (by.get(c) ?? 0) + 1); }
    const lic = new Map<string, number>();
    for (const r of vis) { const l = normalize(String(r.license || "")) || "(none)"; lic.set(l, (lic.get(l) ?? 0) + 1); }
    const color: Record<string, string> = { permissive: "#16a34a", "public domain": "#0ea5e9", "weak copyleft": "#f59e0b", "strong copyleft": "#dc2626", proprietary: "#7c3aed", unknown: "#6b7280" };
    const preview = `<p><b>${esc(String(p.meta.project))}</b> · ${vis.length} packages${p.settings.dev ? " (incl. dev)" : ""}</p><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${[...by].map(([c, n]) => `<span style="border:1px solid ${color[c]};color:${color[c]};border-radius:999px;padding:2px 10px;font-size:13px">${esc(c)} ${n}</span>`).join("")}</div><table style="font-size:13px;border-collapse:collapse">${[...lic].sort((a, b) => b[1] - a[1]).map(([l, n]) => `<tr><td style="padding:2px 12px 2px 0">${esc(l)}</td><td>${n}</td></tr>`).join("")}</table>`;
    const flagged = issues.filter((x) => x.level === "warn").length;
    return { rows, issues, preview, summary: `${vis.length} packages · ${flagged} to review`, stats: { packages: vis.length, review: flagged, copyleft: vis.filter((r) => catOf(r) === "strong-copyleft").length, unknown: vis.filter((r) => catOf(r) === "unknown").length } };
  },
  exports: [
    {
      id: "xlsx", label: ["Excel 报告", "Excel report"], description: "license-report.xlsx — every package with licence, category, dependency type and review notes, plus a summary by licence",
      async run({ project, write }: ExportCtx) {
        const vis = visible(project);
        const colors: Partial<Record<Category, string>> = { "strong-copyleft": "#FCA5A5", unknown: "#E5E7EB", proprietary: "#DDD6FE", "weak-copyleft": "#FDE68A" };
        const marks = vis.flatMap((r, i) => (colors[catOf(r)] ? [{ row: i, col: 3, color: colors[catOf(r)] }] : []));
        const lic = new Map<string, { n: number; cat: string }>();
        for (const r of vis) { const l = normalize(String(r.license || "")) || "(none)"; const x = lic.get(l) ?? { n: 0, cat: CAT_LABEL[catOf(r)] }; x.n++; lic.set(l, x); }
        return [await write("license-report.xlsx", await writeXlsx([
          { name: "Packages", headers: ["Package", "Version", "License", "Category", "Dependency", "Found in", "Reviewed", "Note", "Homepage", "Path"], rows: vis.map((r) => [r.name, r.version, r.license || "(none)", CAT_LABEL[catOf(r)], r.kind, r.source, r.reviewed ? "yes" : "", r.note, r.homepage, r.path]), marks },
          { name: "Summary", headers: ["License", "Category", "Packages"], rows: [...lic].sort((a, b) => b[1].n - a[1].n).map(([l, x]) => [l, x.cat, x.n]) },
        ]))];
      },
    },
    {
      id: "notices", label: ["第三方声明", "Third-party notices"], description: "THIRD_PARTY_NOTICES.txt — name, version, licence, copyright and licence text for each package (to ship with your app)",
      async run({ project, write }: ExportCtx) {
        const vis = visible(project).filter((r) => !String(r.kind).includes("dev"));
        const t = texts(project);
        const parts = vis.map((r) => {
          const head = `${r.name} ${r.version}\nLicense: ${r.license || "(not declared)"}${r.copyright ? `\n${r.copyright}` : ""}${r.homepage ? `\n${r.homepage}` : ""}`;
          const body = project.settings.fullText !== false && t[`${r.name}@${r.version}`] ? `\n\n${t[`${r.name}@${r.version}`].trim()}` : "";
          return head + body;
        });
        const sep = `\n\n${"-".repeat(72)}\n\n`;
        return [await write("THIRD_PARTY_NOTICES.txt", `THIRD-PARTY SOFTWARE NOTICES\n${String(project.meta.project)}\n\nThis product includes the following third-party packages.${sep}${parts.join(sep)}\n`)];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
