import QRCode from "qrcode";
import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { createRaster, encodePng } from "./kit/raster.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { menuHtml, menuPdf, priceText, sections, type Dish, type MenuOpts } from "./menu.ts";

export const NAME = "menu-maker";
export const VERSION = "0.1.0";

const yes = (v: unknown) => /^(1|y|yes|true|是|√|✓|v|x|推荐|素)$/i.test(String(v ?? "").trim());
function spicy(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Math.min(3, Number(s));
  if (/特|超|重|hot/i.test(s)) return 3;
  if (/中|medium/i.test(s)) return 2;
  if (/微|小|mild|辣/i.test(s)) return 1;
  return (s.match(/🌶/gu) ?? []).length;
}
const dishesOf = (p: Project): Dish[] => p.rows.filter((r) => r.include !== false).map((r) => ({ section: String(r.section || "菜单"), name: String(r.name ?? ""), nameEn: String(r.nameEn ?? ""), price: String(r.price ?? ""), desc: String(r.desc ?? ""), allergens: String(r.allergens ?? ""), spicy: Math.max(0, Math.min(3, Math.round(Number(r.spicy) || 0))), star: Boolean(r.star), veg: Boolean(r.veg) }));
function qr(text: string) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size + 8, sc = 10;
  const img = createRaster(n * sc, n * sc, [255, 255, 255, 255]);
  for (let y = 0; y < q.modules.size; y++) for (let x = 0; x < q.modules.size; x++) if (q.modules.get(y, x)) for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((y + 4) * sc + dy) * img.width + (x + 4) * sc + dx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; }
  return encodePng(img);
}
const optsOf = (p: Project, withQr = true): MenuOpts => {
  const url = String(p.settings.menuUrl ?? "").trim();
  return { title: String(p.settings.title || "菜单"), subtitle: String(p.settings.subtitle ?? ""), currency: String(p.settings.currency ?? "¥"), layout: (String(p.settings.layout || "classic")) as MenuOpts["layout"], page: (String(p.settings.page || "A4")) as MenuOpts["page"], bilingual: p.settings.bilingual !== false, accent: String(p.settings.accent || "#9a3412"), footer: String(p.settings.footer ?? ""), qrPng: withQr && url ? new Uint8Array(qr(url)) : undefined, legend: true };
};

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "menu",
  title: ["餐厅菜单制作", "Menu Maker"],
  openDescription:
    "Turn a dish sheet (CSV/XLSX with columns such as 分类/section, 菜名/name, 英文名/English name, 价格/price, 描述/description, 过敏原/allergens, 辣度/spicy 0–3 or 微辣/中辣/特辣, 推荐/recommended, 素食/vegetarian) into a printable menu PDF (A4/A5/Letter; classic, two-column or compact layout; dotted price leaders, chef's-pick badges, spice dots, vegetarian and allergen tags; optional Chinese + English) and a mobile web menu (menu.html with sticky section tabs, no scripts). Sections keep the sheet's order. With a web-menu address, a QR code is printed on the menu and exported as PNG. Prices can be numbers or text like 12/18 (small/large).",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择菜品表", "Pick the dish sheet"] },
  settings: [
    { key: "title", label: ["店名", "Restaurant name"], type: "text", default: "" },
    { key: "subtitle", label: ["副标题（地址 / 营业时间）", "Subtitle (address / hours)"], type: "text", default: "" },
    { key: "layout", label: ["版式", "Layout"], type: "select", default: "classic", options: [{ value: "classic", label: ["经典单栏", "Classic"] }, { value: "twocol", label: ["双栏", "Two columns"] }, { value: "compact", label: ["紧凑", "Compact"] }] },
    { key: "page", label: ["纸张", "Paper"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "A5", label: ["A5", "A5"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
    { key: "bilingual", label: ["中英双语", "Chinese + English"], type: "bool", default: true },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#9a3412" },
    { key: "footer", label: ["页脚说明", "Footer note"], type: "text", default: "" },
    { key: "menuUrl", label: ["电子菜单网址（用于二维码）", "Web menu address (for the QR code)"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["上菜单", "Show"], type: "bool" },
    { key: "section", label: ["分类", "Section"] },
    { key: "name", label: ["菜名", "Dish"] },
    { key: "nameEn", label: ["英文名", "English name"] },
    { key: "price", label: ["价格", "Price"] },
    { key: "desc", label: ["描述", "Description"], wide: true },
    { key: "allergens", label: ["过敏原", "Allergens"] },
    { key: "spicy", label: ["辣度 0–3", "Spicy 0–3"], type: "number" },
    { key: "star", label: ["推荐", "Chef's pick"], type: "bool" },
    { key: "veg", label: ["素食", "Vegetarian"], type: "bool" },
  ],
  newRow: () => ({ include: true, section: "", name: "", nameEn: "", price: "", desc: "", allergens: "", spicy: 0, star: false, veg: false }),
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { section: ["分类", "类别", "category", "type", "栏目"], name: ["菜名", "名称", "品名", "dish", "item"], nameEn: ["英文名", "english", "英文", "name en", "en"], price: ["价格", "售价", "单价", "cost"], desc: ["描述", "说明", "介绍", "description", "备注"], allergens: ["过敏原", "allergen", "allergy"], spicy: ["辣度", "辣", "spice", "spicy"], star: ["推荐", "招牌", "recommended", "chef", "star"], veg: ["素食", "素", "vegetarian", "vegan", "veg"], hidden: ["售罄", "停售", "sold out", "hidden"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a dish name column (菜名/name). Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.filter((r) => String(r[m.name!] ?? "").trim()).map((r) => ({ include: !yes(m.hidden ? r[m.hidden] : ""), section: m.section ? String(r[m.section] ?? "") : "", name: String(r[m.name!]).trim(), nameEn: m.nameEn ? String(r[m.nameEn] ?? "") : "", price: m.price ? String(r[m.price] ?? "") : "", desc: m.desc ? String(r[m.desc] ?? "") : "", allergens: m.allergens ? String(r[m.allergens] ?? "").replace(/[、，;；]/g, ",").replace(/,\s*/g, "、") : "", spicy: spicy(m.spicy ? r[m.spicy] : ""), star: yes(m.star ? r[m.star] : ""), veg: yes(m.veg ? r[m.veg] : "") }));
    let last: string = "";
    for (const r of rows) { if (r.section) last = String(r.section); else r.section = last; }
    if (!settings.title) settings.title = files[0].split("/").pop()!.replace(/\.[^.]+$/, "");
    return { rows };
  },
  compute(p) {
    const issues: Issue[] = [];
    p.rows.forEach((r, i) => {
      if (r.include === false) return;
      if (!String(r.name ?? "").trim()) issues.push({ level: "error", row: i, key: "name", message: `Row ${i + 1}: no dish name.` });
      const pr = String(r.price ?? "").trim();
      if (!pr) issues.push({ level: "warn", row: i, key: "price", message: `${r.name}: no price.` });
      else if (!/\d/.test(pr) || (/^[\d.,\s¥$€£]+$/.test(pr) && isNaN(num(pr)))) issues.push({ level: "warn", row: i, key: "price", message: `${r.name}: price “${pr}” doesn't look like a number.` });
      if (p.settings.bilingual !== false && !String(r.nameEn ?? "").trim()) issues.push({ level: "info", row: i, key: "nameEn", message: `${r.name}: no English name.` });
      if (Number(r.spicy) > 3 || Number(r.spicy) < 0) issues.push({ level: "warn", row: i, key: "spicy", message: `${r.name}: spicy should be 0–3.` });
    });
    const o = optsOf(p, false);
    const d = dishesOf(p);
    const html = menuHtml(d, o);
    const preview = `<iframe sandbox="" style="width:100%;height:620px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>`;
    return { rows: p.rows, issues, preview, summary: `${d.length} dishes in ${sections(d).length} sections · ${o.layout} · ${o.page}`, stats: { dishes: d.length, sections: sections(d).length } };
  },
  exports: [
    {
      id: "pdf", label: ["打印菜单 PDF", "Print menu (PDF)"], description: "menu.pdf — the printable menu",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("menu.pdf", await menuPdf(dishesOf(project), optsOf(project)))];
      },
    },
    {
      id: "html", label: ["电子菜单网页", "Web menu"], description: "menu.html — mobile web menu (one file, no scripts); qr.png if a web menu address is set",
      async run({ project, write }: ExportCtx) {
        const out = [await write("menu.html", menuHtml(dishesOf(project), optsOf(project, false)))];
        const url = String(project.settings.menuUrl ?? "").trim();
        if (url) out.push(await write("qr.png", qr(url)));
        return out;
      },
    },
  ],
};
void priceText;

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
