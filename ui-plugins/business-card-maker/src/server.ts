import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { perSheet, previewHtml, printPdf, sheetPdf, vcard, type CardOpts, type Person } from "./card.ts";

export const NAME = "business-card-maker";
export const VERSION = "0.1.0";

const IMG = /\.(png|jpe?g)$/i;
const peopleOf = (p: Project): Person[] => p.rows.filter((r) => r.include !== false).map((r) => ({ name: String(r.name ?? "").trim(), nameEn: String(r.nameEn ?? "").trim(), title: String(r.title ?? "").trim(), titleEn: String(r.titleEn ?? "").trim(), dept: String(r.dept ?? "").trim(), mobile: String(r.mobile ?? "").trim(), phone: String(r.phone ?? "").trim(), email: String(r.email ?? "").trim(), address: String(r.address ?? "").trim() }));

async function optsOf(p: Project, ws: ExportCtx["ws"] | undefined): Promise<CardOpts> {
  const s = p.settings;
  const logoPath = String(p.meta?.logo ?? "");
  let logo: CardOpts["logo"];
  if (logoPath && ws && (await ws.exists(logoPath))) logo = { bytes: new Uint8Array(await ws.read(logoPath)), png: /\.png$/i.test(logoPath) };
  return {
    company: String(s.company ?? ""), companyEn: String(s.companyEn ?? ""), website: String(s.website ?? ""), address: String(s.address ?? ""),
    size: (String(s.size || "90x54")) as CardOpts["size"], template: (String(s.template || "left")) as CardOpts["template"],
    accent: String(s.accent || "#0f766e"), back: s.back !== false, qr: (String(s.qr || "back")) as CardOpts["qr"],
    bleed: Math.max(0, Math.min(5, Number(s.bleed ?? 2) || 0)), bilingual: s.bilingual !== false, logo,
  };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "card",
  title: ["名片批量制作", "Business Card Maker"],
  openDescription:
    "Turn a team list (CSV/XLSX with columns such as 姓名/name, 英文名/English name, 职位/title, 英文职位/English title, 部门/department, 手机/mobile, 电话/phone, 邮箱/email, 地址/address) plus an optional logo (PNG/JPG) into print-ready business cards: one PDF with a page per card side (90×54, 85×55 or US 3.5×2 in; bleed, crop marks, TrimBox/BleedBox set; front + back) and an A4 sheet PDF (10 per page, backs mirrored for duplex) for office printing. Each card can carry a vCard QR code; .vcf contact files are exported per person and combined. Three front templates: left, centred, side band.",
  inputs: { exts: [".csv", ".xlsx", ".tsv", ".png", ".jpg", ".jpeg"], min: 1, max: 2, label: ["选择员工名单（可再选一个 logo 图片）", "Pick the team list (and optionally a logo image)"] },
  settings: [
    { key: "company", label: ["公司名", "Company"], type: "text", default: "" },
    { key: "companyEn", label: ["英文公司名", "Company (English)"], type: "text", default: "" },
    { key: "website", label: ["网址", "Website"], type: "text", default: "" },
    { key: "address", label: ["公司地址（个人未填时使用）", "Office address (used when a person has none)"], type: "text", default: "" },
    { key: "size", label: ["尺寸", "Card size"], type: "select", default: "90x54", options: [{ value: "90x54", label: ["90×54 mm（国内常用）", "90×54 mm (China)"] }, { value: "85x55", label: ["85×55 mm（欧洲）", "85×55 mm (Europe)"] }, { value: "89x51", label: ["3.5×2 in（美国）", "3.5×2 in (US)"] }] },
    { key: "template", label: ["正面模板", "Front template"], type: "select", default: "left", options: [{ value: "left", label: ["左对齐", "Left"] }, { value: "center", label: ["居中", "Centred"] }, { value: "band", label: ["侧边色条", "Side band"] }] },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#0f766e" },
    { key: "back", label: ["印背面", "Print a back side"], type: "bool", default: true },
    { key: "qr", label: ["名片二维码", "Contact QR code"], type: "select", default: "back", options: [{ value: "back", label: ["印在背面", "On the back"] }, { value: "front", label: ["印在正面", "On the front"] }, { value: "none", label: ["不印", "None"] }] },
    { key: "bleed", label: ["出血（毫米）", "Bleed (mm)"], type: "number", default: 2 },
    { key: "bilingual", label: ["中英双语", "Chinese + English"], type: "bool", default: true },
    { key: "fill", label: ["A4 拼版：每人一整页", "A4 sheet: one full page per person"], type: "bool", default: true },
  ],
  columns: () => [
    { key: "include", label: ["制作", "Make"], type: "bool" },
    { key: "name", label: ["姓名", "Name"] },
    { key: "nameEn", label: ["英文名", "English name"] },
    { key: "title", label: ["职位", "Title"] },
    { key: "titleEn", label: ["英文职位", "English title"] },
    { key: "dept", label: ["部门", "Department"] },
    { key: "mobile", label: ["手机", "Mobile"] },
    { key: "phone", label: ["电话", "Phone"] },
    { key: "email", label: ["邮箱", "Email"] },
    { key: "address", label: ["地址", "Address"], wide: true },
  ],
  newRow: () => ({ include: true, name: "", nameEn: "", title: "", titleEn: "", dept: "", mobile: "", phone: "", email: "", address: "" }),
  async load({ ws, files, settings }) {
    const table = files.find((f) => !IMG.test(f));
    if (!table) throw new KitError("no_table", "Pick the team list (CSV/XLSX) — only an image was picked.");
    const logo = files.find((f) => IMG.test(f)) ?? "";
    const t = await readTable(ws, table);
    const m = mapHeaders(t.columns, { name: ["姓名", "名字", "name", "full name"], nameEn: ["英文名", "english name", "英文姓名", "name en"], title: ["职位", "职务", "title", "position", "job title"], titleEn: ["英文职位", "english title", "title en", "职位英文"], dept: ["部门", "department", "dept", "team"], mobile: ["手机", "手机号", "mobile", "cell"], phone: ["电话", "座机", "phone", "tel", "office phone"], email: ["邮箱", "email", "e-mail", "电子邮件"], address: ["地址", "address", "办公地址"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const g = (r: Record<string, unknown>, k?: string) => (k ? String(r[k] ?? "").trim() : "");
    const rows: Row[] = t.rows.filter((r) => g(r, m.name)).map((r) => ({ include: true, name: g(r, m.name), nameEn: g(r, m.nameEn), title: g(r, m.title), titleEn: g(r, m.titleEn), dept: g(r, m.dept), mobile: g(r, m.mobile), phone: g(r, m.phone), email: g(r, m.email), address: g(r, m.address) }));
    if (!settings.company) settings.company = "";
    return { rows, meta: { logo } };
  },
  async compute(p, ctx) {
    const issues: Issue[] = [];
    const seen = new Map<string, number>();
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      const n = String(r.name ?? "").trim();
      if (!n) { issues.push({ level: "error", row: i, key: "name", message: `Row ${i + 1}: no name.` }); return; }
      if (seen.has(n)) issues.push({ level: "info", row: i, key: "name", message: `${n} appears twice (rows ${seen.get(n)! + 1} and ${i + 1}).` });
      seen.set(n, i);
      const e = String(r.email ?? "").trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) issues.push({ level: "warn", row: i, key: "email", message: `${n}: email “${e}” looks wrong.` });
      const mo = String(r.mobile ?? "").replace(/[\s-]/g, "");
      if (mo && !/^\+?\d{6,15}$/.test(mo)) issues.push({ level: "warn", row: i, key: "mobile", message: `${n}: mobile “${r.mobile}” looks wrong.` });
      if (!String(r.mobile ?? "").trim() && !String(r.phone ?? "").trim() && !e) issues.push({ level: "warn", row: i, key: "mobile", message: `${n}: no phone or email on the card.` });
      if (!String(r.title ?? "").trim()) issues.push({ level: "info", row: i, key: "title", message: `${n}: no title.` });
    });
    if (!String(p.settings.company ?? "").trim()) issues.push({ level: "warn", message: "No company name set (settings → company)." });
    const o = await optsOf(p, ctx?.ws);
    const people = peopleOf(p);
    const logoUri = o.logo ? `data:image/${o.logo.png ? "png" : "jpeg"};base64,${Buffer.from(o.logo.bytes).toString("base64")}` : "";
    const html = previewHtml(people, o, logoUri);
    const preview = `<iframe sandbox="" style="width:100%;height:560px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>`;
    return { rows: p.rows, issues, preview, summary: `${people.length} cards · ${o.size.replace("x", "×")} mm · ${o.template}${o.back ? " · front + back" : ""}${o.logo ? " · logo" : ""}`, stats: { cards: people.length, perSheet: perSheet(o) } };
  },
  exports: [
    {
      id: "print", label: ["印刷 PDF（含出血）", "Print PDF (with bleed)"], description: "cards-print.pdf — one page per card side with bleed and crop marks, for a print shop",
      async run({ project, write, computed, ws }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("cards-print.pdf", await printPdf(peopleOf(project), await optsOf(project, ws)))];
      },
    },
    {
      id: "sheet", label: ["A4 拼版 PDF", "A4 sheet PDF"], description: "cards-a4.pdf — cards laid out on A4 with crop marks for office printing (backs mirrored for duplex)",
      async run({ project, write, ws }: ExportCtx) {
        return [await write("cards-a4.pdf", await sheetPdf(peopleOf(project), await optsOf(project, ws), project.settings.fill !== false))];
      },
    },
    {
      id: "vcf", label: ["电子名片 vCard", "vCard contacts"], description: "contacts.vcf (everyone) + vcards/<name>.vcf per person",
      async run({ project, write, ws }: ExportCtx) {
        const o = await optsOf(project, ws);
        const people = peopleOf(project);
        const out = [await write("contacts.vcf", people.map((p) => vcard(p, o)).join(""))];
        const used = new Set<string>();
        for (const p of people) {
          let f = safeFileName(p.name, "card");
          for (let i = 2; used.has(f); i++) f = `${safeFileName(p.name, "card")}-${i}`;
          used.add(f);
          out.push(await write(`vcards/${f}.vcf`, vcard(p, o)));
        }
        return out;
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
