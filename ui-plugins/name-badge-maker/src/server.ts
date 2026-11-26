import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { assignRoleColors, badgesPdf, layoutOf, SIZES, tentsPdf, type Attendee, type BadgeOpts } from "./badge.ts";

export const NAME = "name-badge-maker";
export const VERSION = "0.1.0";

const IMG = /\.(png|jpe?g)$/i;
const s = (v: unknown) => String(v ?? "").trim();
function listOf(p: Project): Attendee[] {
  const l = p.rows.filter((r) => r.include !== false).map((r) => ({ name: s(r.name), nameEn: s(r.nameEn), org: s(r.org), title: s(r.title), role: s(r.role), table: s(r.table), code: s(r.code) }));
  const sort = s(p.settings.sort);
  if (sort === "role") { const order = [...new Set(l.map((a) => a.role))]; return l.map((a, i) => ({ a, i })).sort((x, y) => order.indexOf(x.a.role) - order.indexOf(y.a.role) || x.i - y.i).map((x) => x.a); }
  if (sort === "table") return [...l].sort((a, b) => a.table.localeCompare(b.table, "zh-CN", { numeric: true }));
  return l;
}
export function parseRoleColors(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(text ?? "").split(/[\n,，;；]+/)) {
    const m = /^\s*(.+?)\s*[=:：]\s*(#[0-9a-f]{6})\s*$/i.exec(part);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
async function optsOf(p: Project, ws?: ExportCtx["ws"]): Promise<BadgeOpts> {
  const st = p.settings;
  const roles = listOf(p).map((a) => a.role);
  const logoPath = s(p.meta?.logo);
  const logo = logoPath && ws && (await ws.exists(logoPath)) ? { bytes: new Uint8Array(await ws.read(logoPath)), png: /\.png$/i.test(logoPath) } : undefined;
  const size = (s(st.size) in SIZES ? s(st.size) : "100x70") as BadgeOpts["size"];
  return { event: s(st.event), eventSub: s(st.eventSub), size, accent: s(st.accent) || "#1e3a8a", bilingual: st.bilingual !== false, qr: s(st.qr) === "code" ? "code" : "none", roleColors: assignRoleColors(roles, parseRoleColors(s(st.roleColors))), logo, tentOrg: st.tentOrg !== false };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "badge",
  title: ["胸牌桌签制作", "Badge & Tent Card Maker"],
  openDescription:
    "Turn an attendee list (CSV/XLSX with columns such as 姓名/name, 英文名/English name, 单位/organisation, 职位/title, 身份/role, 桌号/table, 编号/code) plus an optional logo into printable event name badges (100×70, 90×120, 4×3 in, card 85.6×54 or A6, laid out on A4 with corner cut marks; event header, name auto-sized to fit, organisation, a colour band per role such as 嘉宾/讲师/工作人员, optional QR code of the attendee code) and fold-in-half table tent cards (A4 landscape, upside-down top half so the name reads from both sides). Chinese and English supported.",
  inputs: { exts: [".csv", ".xlsx", ".tsv", ".png", ".jpg", ".jpeg"], min: 1, max: 2, label: ["选择参会名单（可再选一个 logo 图片）", "Pick the attendee list (and optionally a logo image)"] },
  settings: [
    { key: "event", label: ["活动名称", "Event name"], type: "text", default: "" },
    { key: "eventSub", label: ["日期 / 地点", "Date / venue"], type: "text", default: "" },
    { key: "size", label: ["胸牌尺寸", "Badge size"], type: "select", default: "100x70", options: Object.entries(SIZES).map(([v, x]) => ({ value: v, label: [x.label, x.label] as [string, string] })) },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#1e3a8a" },
    { key: "roleColors", label: ["身份颜色（如 嘉宾=#b45309, 讲师=#7c3aed）", "Role colours (e.g. Guest=#b45309, Speaker=#7c3aed)"], type: "text", default: "" },
    { key: "qr", label: ["二维码", "QR code"], type: "select", default: "none", options: [{ value: "none", label: ["不印", "None"] }, { value: "code", label: ["印编号二维码", "Attendee code"] }] },
    { key: "sort", label: ["排序", "Order"], type: "select", default: "sheet", options: [{ value: "sheet", label: ["按表格顺序", "Sheet order"] }, { value: "role", label: ["按身份", "By role"] }, { value: "table", label: ["按桌号", "By table"] }] },
    { key: "tentOrg", label: ["桌签显示单位和职位", "Tent cards show organisation and title"], type: "bool", default: true },
    { key: "bilingual", label: ["显示英文名", "Show English names"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "include", label: ["制作", "Make"], type: "bool" },
    { key: "name", label: ["姓名", "Name"] },
    { key: "nameEn", label: ["英文名", "English name"] },
    { key: "org", label: ["单位", "Organisation"] },
    { key: "title", label: ["职位", "Title"] },
    { key: "role", label: ["身份", "Role"] },
    { key: "table", label: ["桌号", "Table"] },
    { key: "code", label: ["编号", "Code"] },
  ],
  newRow: () => ({ include: true, name: "", nameEn: "", org: "", title: "", role: "", table: "", code: "" }),
  async load({ ws, files }) {
    const table = files.find((f) => !IMG.test(f));
    if (!table) throw new KitError("no_table", "Pick the attendee list (CSV/XLSX) — only an image was picked.");
    const t = await readTable(ws, table);
    const m = mapHeaders(t.columns, { name: ["姓名", "名字", "name", "full name", "attendee"], nameEn: ["英文名", "english name", "拼音"], org: ["单位", "公司", "机构", "organisation", "organization", "company", "affiliation"], title: ["职位", "职务", "title", "position"], role: ["身份", "类别", "角色", "role", "type", "category"], table: ["桌号", "座位", "table", "seat"], code: ["编号", "票号", "code", "id", "ticket"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const g = (r: Record<string, unknown>, k?: string) => (k ? s(r[k]) : "");
    const rows: Row[] = t.rows.filter((r) => g(r, m.name)).map((r) => ({ include: true, name: g(r, m.name), nameEn: g(r, m.nameEn), org: g(r, m.org), title: g(r, m.title), role: g(r, m.role), table: g(r, m.table), code: g(r, m.code) }));
    return { rows, meta: { logo: files.find((f) => IMG.test(f)) ?? "" } };
  },
  async compute(p, ctx) {
    const issues: Issue[] = [];
    const o = await optsOf(p, ctx?.ws);
    const codes = new Map<string, number>();
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!s(r.name)) { issues.push({ level: "error", row: i, key: "name", message: `Row ${i + 1}: no name.` }); return; }
      if (s(r.name).length > 12 && /[\u4e00-\u9fff]/.test(s(r.name))) issues.push({ level: "info", row: i, key: "name", message: `${r.name}: long name, it will be printed smaller.` });
      const c = s(r.code);
      if (o.qr === "code" && !c) issues.push({ level: "warn", row: i, key: "code", message: `${r.name}: no code, so no QR code on the badge.` });
      if (c && codes.has(c)) issues.push({ level: "warn", row: i, key: "code", message: `Code ${c} is used twice (rows ${codes.get(c)! + 1} and ${i + 1}).` });
      if (c) codes.set(c, i);
    });
    if (!o.event) issues.push({ level: "warn", message: "No event name set (settings → event)." });
    const list = listOf(p);
    const L = layoutOf(o.size);
    const roles = Object.entries(o.roleColors).map(([r, c]) => ({ r, c, n: list.filter((a) => a.role === r).length }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:14px;background:#f3f4f6;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}.g{display:flex;flex-wrap:wrap;gap:12px}.b{background:#fff;box-shadow:0 1px 4px #0002;display:flex;flex-direction:column;overflow:hidden}.h{background:${o.accent};color:#fff;padding:6px 10px;font-weight:700;font-size:13px}.h small{display:block;font-weight:400;font-size:10px;opacity:.85}.m{flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 12px}.n{font-size:26px;font-weight:800;color:#111827}.e{color:#4b5563;font-size:12px}.t{font-size:11px;color:#374151}.o{font-size:12px;font-weight:700;color:${o.accent}}.r{color:#fff;text-align:center;font-weight:700;padding:5px;font-size:13px}.leg{margin:0 0 12px;font-size:12px;color:#374151}.leg span{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;margin-right:6px}</style></head><body>
<div class="leg">${roles.map((x) => `<span style="background:${x.c}">${esc(x.r)} · ${x.n}</span>`).join("")}</div><div class="g">${list.slice(0, 12).map((a) => `<div class="b" style="width:${SIZES[o.size].w * 2.6}px;height:${SIZES[o.size].h * 2.6}px"><div class="h">${esc(o.event)}${o.eventSub ? `<small>${esc(o.eventSub)}</small>` : ""}</div><div class="m"><div class="n">${esc(a.name)}</div>${o.bilingual && a.nameEn ? `<div class="e">${esc(a.nameEn)}</div>` : ""}${a.title ? `<div class="t">${esc(a.title)}</div>` : ""}${a.org ? `<div class="o">${esc(a.org)}</div>` : ""}</div>${a.role ? `<div class="r" style="background:${o.roleColors[a.role]}">${esc(a.role)}</div>` : ""}</div>`).join("")}</div>${list.length > 12 ? `<p style="color:#6b7280;font-size:12px">… +${list.length - 12}</p>` : ""}</body></html>`;
    const preview = `<iframe sandbox="" style="width:100%;height:560px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>`;
    return { rows: p.rows, issues, preview, summary: `${list.length} badges · ${SIZES[o.size].label} · ${L.per} per A4 · ${roles.length} roles`, stats: { badges: list.length, perPage: L.per, pages: Math.ceil(list.length / L.per), roles: roles.length } };
  },
  exports: [
    {
      id: "badges", label: ["胸牌 PDF", "Badges PDF"], description: "badges.pdf — badges laid out on A4 with cut marks",
      async run({ project, write, computed, ws }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("badges.pdf", await badgesPdf(listOf(project), await optsOf(project, ws)))];
      },
    },
    {
      id: "tents", label: ["桌签 PDF", "Tent cards PDF"], description: "tent-cards.pdf — one A4 landscape page per person, fold along the dashed line",
      async run({ project, write, ws }: ExportCtx) {
        return [await write("tent-cards.pdf", await tentsPdf(listOf(project), await optsOf(project, ws)))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
