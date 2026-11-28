import QRCode from "qrcode";
import { rgb, type PDFPage } from "pdf-lib";
import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { byCalendarYear, METHOD_ZH, methodOf, monthly, monthsElapsed, r2, type Method } from "./depr.ts";
import { fmt2, s } from "./util.ts";

export const NAME = "asset-register";
export const VERSION = "0.1.0";

const HEAD = {
  id: ["资产编号", "编号", "资产编码", "资产号", "asset id", "asset no", "asset tag", "id", "tag"],
  name: ["资产名称", "名称", "品名", "name", "asset", "description"],
  category: ["类别", "资产类别", "分类", "category", "class", "type"],
  bought: ["购置日期", "购入日期", "购买日期", "入账日期", "取得日期", "purchase date", "bought", "date acquired", "in service"],
  cost: ["原值", "购置金额", "价格", "金额", "原价", "cost", "price", "amount"],
  residual: ["残值", "残值率", "预计净残值", "净残值率", "residual", "salvage"],
  life: ["使用年限", "折旧年限", "年限", "life", "useful life", "years"],
  method: ["折旧方法", "方法", "method", "depreciation method"],
  location: ["存放地点", "地点", "位置", "部门", "location", "site", "room"],
  holder: ["使用人", "保管人", "责任人", "领用人", "holder", "user", "assigned to", "custodian"],
  status: ["状态", "使用状态", "status"],
  due: ["应还日期", "归还日期", "借出到期", "due", "return by", "due date"],
  serial: ["序列号", "SN", "s/n", "serial", "serial number"],
  note: ["备注", "说明", "note", "notes"],
};
const STATUS = ["在用", "闲置", "借出", "维修", "报废"];
const statusOf = (v: string) => { const t = v.trim().toLowerCase(); if (!t || /在用|使用|in use|active/.test(t)) return "在用"; if (/闲置|库存|idle|spare|stock/.test(t)) return "闲置"; if (/借|外借|checked|loan/.test(t)) return "借出"; if (/修|repair/.test(t)) return "维修"; if (/报废|处置|disposed|scrap|retired/.test(t)) return "报废"; return v.trim(); };

const dateOf = (v: unknown): string | null => {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const t = s(v); if (!t) return null;
  const m = /^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/.exec(t);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1, dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};
const today = () => new Date().toISOString().slice(0, 10);
const asOfOf = (p: Project) => dateOf(p.settings.asOf) ?? today();

function lives(p: Project) {
  const m = new Map<string, number>();
  for (const part of s(p.settings.lives).split(/[,，;；\n]+/)) { const x = /^(.+?)\s*[=：:]\s*(\d+(?:\.\d+)?)/.exec(part.trim()); if (x) m.set(x[1].trim(), Number(x[2])); }
  return m;
}

interface A { i: number; r: Row; id: string; status: string; bought: string | null; cost: number; residual: number; life: number; method: Method | null; months: number[]; done: number; acc: number; nbv: number; ok: boolean }

function analyse(p: Project) {
  const issues: Issue[] = [], asOf = asOfOf(p), L = lives(p), out: A[] = [];
  const ids = new Map<string, number>(), serials = new Map<string, number>();
  const defRes = s(p.settings.residual || "5%"), defMethod = methodOf(s(p.settings.method)) ?? "straight";
  p.rows.forEach((r, i) => {
    if (r.include === false) return;
    const id = s(r.id), name = s(r.name) || "(no name)", tag = id || `#${i}`, status = statusOf(s(r.status));
    if (!id) issues.push({ level: "error", row: i, key: "id", message: `#${i} ${name}: no asset number — give it one (e.g. the next free number) so the tag can be printed.` });
    else if (ids.has(id)) issues.push({ level: "error", row: i, key: "id", message: `${id} is used twice (#${ids.get(id)} ${s(p.rows[ids.get(id)!].name)} and #${i} ${name}) — asset numbers must be unique.` });
    else ids.set(id, i);
    const sn = s(r.serial);
    if (sn) { if (serials.has(sn)) issues.push({ level: "warn", row: i, key: "serial", message: `${tag} ${name}: serial number ${sn} is the same as #${serials.get(sn)} ${s(p.rows[serials.get(sn)!].name)} — same item entered twice, or a typo?` }); else serials.set(sn, i); }
    if (!STATUS.includes(status)) issues.push({ level: "warn", row: i, key: "status", message: `${tag}: unknown status “${s(r.status)}” — use 在用 / 闲置 / 借出 / 维修 / 报废.` });
    const bought = dateOf(r.bought);
    if (!bought) issues.push({ level: "error", row: i, key: "bought", message: `${tag} ${name}: ${s(r.bought) ? `can't read the purchase date “${s(r.bought)}”` : "no purchase date"} — write it like 2025-03-15.` });
    else if (bought > asOf) issues.push({ level: "warn", row: i, key: "bought", message: `${tag} ${name}: bought ${bought}, after the as-of date ${asOf} — no depreciation yet.` });
    const cost = num(r.cost);
    if (!Number.isFinite(cost) || cost <= 0) issues.push({ level: "error", row: i, key: "cost", message: `${tag} ${name}: ${s(r.cost) ? `can't read the cost “${s(r.cost)}”` : "no cost (原值)"}.` });
    const resRaw = s(r.residual) || defRes, pct = /%$/.test(resRaw), rv = num(resRaw.replace(/%$/, ""));
    const residual = Number.isFinite(rv) ? (pct ? (cost * rv) / 100 : rv) : NaN;
    if (!Number.isFinite(residual) || residual < 0) issues.push({ level: "error", row: i, key: "residual", message: `${tag}: can't read the residual value “${resRaw}” — write 5% or an amount.` });
    else if (Number.isFinite(cost) && residual >= cost) issues.push({ level: "error", row: i, key: "residual", message: `${tag} ${name}: residual ${fmt2(residual)} isn't less than the cost ${fmt2(cost)} — did you mean ${resRaw}%?` });
    let life = num(r.life);
    if (!Number.isFinite(life) || life <= 0) {
      const cl = L.get(s(r.category));
      if (cl) life = cl;
      else issues.push({ level: "error", row: i, key: "life", message: `${tag} ${name}: no useful life (使用年限) and category “${s(r.category)}” has no default — fill in the years or add “${s(r.category) || "类别"}=5” to the lives setting.` });
    }
    const method = s(r.method) ? methodOf(s(r.method)) : defMethod;
    if (!method) issues.push({ level: "error", row: i, key: "method", message: `${tag}: unknown depreciation method “${s(r.method)}” — use 直线 / 双倍余额 / 年数总和.` });
    if (status === "借出") {
      if (!s(r.holder)) issues.push({ level: "warn", row: i, key: "holder", message: `${tag} ${name} is checked out but nobody is named as holder.` });
      const due = s(r.due) ? dateOf(r.due) : null;
      if (s(r.due) && !due) issues.push({ level: "error", row: i, key: "due", message: `${tag}: can't read the return date “${s(r.due)}”.` });
      else if (due && due < asOf) issues.push({ level: "warn", row: i, key: "due", message: `${tag} ${name} was due back ${due} (${Math.round((Date.parse(asOf) - Date.parse(due)) / 86400000)} days overdue) — holder: ${s(r.holder) || "?"}.` });
      else if (!due) issues.push({ level: "info", row: i, key: "due", message: `${tag} ${name} is checked out with no return date.` });
    } else if (status !== "报废" && !s(r.location)) issues.push({ level: "warn", row: i, key: "location", message: `${tag} ${name}: no location — it can't be found at stocktake.` });
    const ok = !!bought && Number.isFinite(cost) && cost > 0 && Number.isFinite(residual) && residual >= 0 && residual < cost && life > 0 && !!method;
    const months = ok ? monthly(cost, residual, life, method!) : [];
    const done = ok ? Math.min(months.length, monthsElapsed(bought!, asOf)) : 0;
    const acc = months.slice(0, done).reduce((a, b) => a + b, 0);
    const a: A = { i, r, id: tag, status, bought, cost, residual, life, method, months, done, acc: r2(acc), nbv: ok ? r2(cost - acc) : NaN, ok };
    if (ok && done >= months.length && status === "在用") issues.push({ level: "info", row: i, message: `${tag} ${name} is fully depreciated (net ${fmt2(a.nbv)}) and still in use.` });
    out.push(a);
  });
  return { list: out, issues, asOf };
}

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" }), n = q.modules.size, m = size / n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) page.drawRectangle({ x: x + c * m, y: y + size - (r + 1) * m, width: m + 0.04, height: m + 0.04, color: rgb(0, 0, 0), borderWidth: 0 });
}
const MM = 72 / 25.4;
const qrText = (p: Project, a: A) => { const mode = s(p.settings.qr) || "id"; return mode === "url" && s(p.settings.urlPrefix) ? `${s(p.settings.urlPrefix)}${encodeURIComponent(a.id)}` : mode === "full" ? [a.id, s(a.r.name), s(a.r.serial) && `SN ${s(a.r.serial)}`, s(p.settings.company)].filter(Boolean).join(" | ") : a.id; };

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "asset",
    title: ["固定资产台账", "Asset Register"],
    openDescription:
      "Keep a fixed-asset register: print QR asset tags, compute depreciation and get a stocktake sheet. Pick a .xlsx/.csv (or folder) with one row per asset: 资产编号/id, 名称/name, 类别/category, 购置日期/bought, 原值/cost, 残值/residual (5% or an amount), 使用年限/life (years), 折旧方法/method (直线 straight-line, 双倍余额 double-declining with the last two years straight-line, 年数总和 sum-of-years), 存放地点/location, 使用人/holder, 状态/status (在用 / 闲置 / 借出 / 维修 / 报废), 应还日期/due (for checked-out items), 序列号/serial, 备注/note. Settings: company, asOf (YYYY-MM-DD, blank = today), method and residual defaults, lives (default years per category, e.g. 电脑=3, 办公家具=5), qr (id / full / url with urlPrefix), tag (label size), skipScrapped (no tags for 报废). Depreciation is monthly from the month after purchase. Checks: missing or duplicate asset numbers, duplicate serials, unreadable dates and costs, residual not below cost, no useful life, unknown method or status, checked-out items with no holder or overdue, assets with no location, fully depreciated assets still in use, purchases after the as-of date. Exports asset-tags.pdf (A4 sheets of QR labels), depreciation.xlsx (register with accumulated depreciation and net book value, yearly schedule, totals by category and location, checked-out list) and stocktake.pdf (checklist by location).",
    inputs: { exts: [".xlsx", ".csv"], min: 1, max: 1, folders: true, label: ["选择资产台账", "Pick the asset list"] },
    settings: [
      { key: "company", label: ["单位名称", "Company"], type: "text", default: "" },
      { key: "asOf", label: ["截至日期（YYYY-MM-DD，空 = 今天）", "As of (blank = today)"], type: "text", default: "" },
      { key: "method", label: ["默认折旧方法", "Default method"], type: "select", default: "straight", options: [{ value: "straight", label: ["年限平均法（直线）", "Straight-line"] }, { value: "ddb", label: ["双倍余额递减法", "Double-declining"] }, { value: "syd", label: ["年数总和法", "Sum-of-years"] }] },
      { key: "residual", label: ["默认残值（5% 或金额）", "Default residual"], type: "text", default: "5%" },
      { key: "lives", label: ["各类别默认年限（类别=年）", "Default life per category"], type: "textarea", default: "电脑=3\n显示器=5\n办公家具=5\n打印机=5\n投影仪=5\n车辆=4" },
      { key: "qr", label: ["二维码内容", "QR content"], type: "select", default: "id", options: [{ value: "id", label: ["资产编号", "Asset number"] }, { value: "full", label: ["编号+名称+序列号", "Number, name, serial"] }, { value: "url", label: ["链接前缀+编号", "URL prefix + number"] }] },
      { key: "urlPrefix", label: ["链接前缀", "URL prefix"], type: "text", default: "" },
      { key: "tag", label: ["标签尺寸", "Tag size"], type: "select", default: "50x30", options: [{ value: "50x30", label: ["50×30 mm（A4 每页 24 个）", "50×30 mm"] }, { value: "70x40", label: ["70×40 mm（A4 每页 12 个）", "70×40 mm"] }] },
      { key: "skipScrapped", label: ["报废的不打标签", "No tags for scrapped"], type: "bool", default: true },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "id", label: ["资产编号", "Asset no."] },
      { key: "name", label: ["名称", "Name"], wide: true },
      { key: "category", label: ["类别", "Category"] },
      { key: "bought", label: ["购置日期", "Bought"] },
      { key: "cost", label: ["原值", "Cost"], type: "number" },
      { key: "residual", label: ["残值", "Residual"] },
      { key: "life", label: ["年限", "Life (y)"], type: "number" },
      { key: "method", label: ["折旧方法", "Method"] },
      { key: "location", label: ["存放地点", "Location"] },
      { key: "holder", label: ["使用人", "Holder"] },
      { key: "status", label: ["状态", "Status"], type: "select", options: STATUS },
      { key: "due", label: ["应还日期", "Due back"] },
      { key: "serial", label: ["序列号", "Serial"] },
      { key: "_acc", label: ["累计折旧", "Acc. depr."], readOnly: true },
      { key: "_nbv", label: ["净值", "Net value"], readOnly: true },
      { key: "_monthly", label: ["本月折旧", "This month"], readOnly: true },
      { key: "note", label: ["备注", "Note"], wide: true },
    ] as Column[],
    newRow: () => ({ include: true, id: "", name: "", category: "", bought: "", cost: "", residual: "", life: "", method: "", location: "", holder: "", status: "在用", due: "", serial: "", note: "" }),
    async load({ ws, files }) {
      let file = files[0];
      if (!/\.(xlsx|csv)$/i.test(file)) { const l = (await ws.list({ dir: file, exts: [".xlsx", ".csv"], limit: 20 })).map((x) => x.path).filter((f) => !f.startsWith(NAME + "/")); if (!l.length) throw new KitError("no_list", "No .xlsx/.csv asset list in that folder."); file = l[0]; }
      const t = await readTable(ws, file), h = mapHeaders(t.columns, HEAD);
      if (!h.name && !h.id) throw new KitError("bad_list", `The asset list needs a 资产编号/id or 名称/name column (found: ${t.columns.join(", ")}).`);
      const g = (r: Record<string, unknown>, k: keyof typeof HEAD) => { const v = h[k] ? r[h[k]!] : ""; return v instanceof Date ? v.toISOString().slice(0, 10) : s(v); };
      const rows = t.rows.filter((r) => g(r, "name") || g(r, "id")).map((r) => ({ include: true, ...Object.fromEntries((Object.keys(HEAD) as (keyof typeof HEAD)[]).map((k) => [k, g(r, k)])) }));
      if (!rows.length) throw new KitError("empty", "The asset list has no rows.");
      return { rows, meta: { file } };
    },
    compute(p): Computed {
      const { list, issues, asOf } = analyse(p), by = new Map(list.map((a) => [a.i, a]));
      const rows = p.rows.map((r, i) => { const a = by.get(i); if (!a || !a.ok) return { ...r, _acc: "", _nbv: "", _monthly: "" }; return { ...r, _acc: fmt2(a.acc), _nbv: fmt2(a.nbv), _monthly: a.done < a.months.length ? fmt2(a.months[a.done] ?? 0) : "0.00" }; });
      const ok = list.filter((a) => a.ok), cost = ok.reduce((x, a) => x + a.cost, 0), acc = ok.reduce((x, a) => x + a.acc, 0);
      const out = list.filter((a) => a.status === "借出").length, scr = list.filter((a) => a.status === "报废").length;
      const cats = new Map<string, { n: number; nbv: number }>();
      for (const a of ok) { const c = s(a.r.category) || "未分类", e = cats.get(c) ?? { n: 0, nbv: 0 }; e.n++; e.nbv += a.nbv; cats.set(c, e); }
      return {
        rows, issues,
        summary: `${list.length} asset(s) as of ${asOf}: cost ${fmt2(cost)}, accumulated depreciation ${fmt2(acc)}, net book value ${fmt2(cost - acc)}; ${out} checked out, ${scr} scrapped.`,
        stats: { assets: list.length, cost: r2(cost), nbv: r2(cost - acc) },
        preview: `<table style="font:12px system-ui,sans-serif;border-collapse:collapse"><tr><th style="text-align:left;padding:2px 8px">类别</th><th style="padding:2px 8px">数量</th><th style="text-align:right;padding:2px 8px">净值</th></tr>${[...cats].map(([c, e]) => `<tr><td style="padding:2px 8px">${esc(c)}</td><td style="text-align:center">${e.n}</td><td style="text-align:right;padding:2px 8px">${fmt2(e.nbv)}</td></tr>`).join("")}</table>`,
      };
    },
    exports: [
      { id: "tags", label: ["资产标签 PDF", "Asset tags (PDF)"], description: "asset-tags.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { list } = analyse(p), k = await newPdf(), [W, H] = PAGE.A4;
        const [tw, th] = (s(p.settings.tag) || "50x30").split("x").map((v) => Number(v) * MM), gap = 3 * MM;
        const cols = Math.floor((W - 20 * MM + gap) / (tw + gap)), rowsN = Math.floor((H - 20 * MM + gap) / (th + gap));
        const x0 = (W - (cols * tw + (cols - 1) * gap)) / 2, y0 = H - (H - (rowsN * th + (rowsN - 1) * gap)) / 2;
        const tags = list.filter((a) => !(p.settings.skipScrapped !== false && a.status === "报废") && s(a.r.id));
        let pg: PDFPage | null = null;
        tags.forEach((a, n) => {
          const slot = n % (cols * rowsN); if (!slot) pg = k.doc.addPage([W, H]);
          const c = slot % cols, rr = Math.floor(slot / cols), x = x0 + c * (tw + gap), y = y0 - (rr + 1) * th - rr * gap, page = pg!;
          page.drawRectangle({ x, y, width: tw, height: th, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.5 });
          const pad = 2.2 * MM, q = th - 2 * pad;
          drawQr(page, qrText(p, a), x + pad, y + pad, q);
          const tx = x + 2 * pad + q, mw = tw - 3 * pad - q, fs = th / MM > 35 ? 1.25 : 1;
          k.text(page, s(p.settings.company) || "固定资产", tx, y + th - pad - 6 * fs, { size: 6 * fs, color: "#6B7280", maxWidth: mw });
          k.text(page, a.id, tx, y + th - pad - 17 * fs, { size: 10 * fs, bold: true, maxWidth: mw });
          k.wrap(s(a.r.name), 7 * fs, mw).slice(0, 2).forEach((l, j) => k.text(page, l, tx, y + th - pad - (27 + j * 8.5) * fs, { size: 7 * fs, maxWidth: mw }));
          k.text(page, [s(a.r.location), a.bought?.slice(0, 7)].filter(Boolean).join(" · "), tx, y + pad + 1, { size: 6 * fs, color: "#4B5563", maxWidth: mw });
        });
        if (!tags.length) k.doc.addPage([W, H]);
        return [await ctx.write("asset-tags.pdf", await k.doc.save())];
      } },
      { id: "xlsx", label: ["折旧表 Excel", "Depreciation (Excel)"], description: "depreciation.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, { list, asOf } = analyse(p), c = ctx.computed;
        const bad = new Set((c.issues ?? []).filter((x) => x.level === "error" && x.row !== undefined).map((x) => x.row));
        const ok = list.filter((a) => a.ok), years = new Set<number>();
        const cal = new Map(ok.map((a) => { const m = byCalendarYear(a.bought!, a.months); for (const y of m.keys()) years.add(y); return [a.i, m]; }));
        const ys = [...years].sort();
        const group = (key: "category" | "location") => { const m = new Map<string, number[]>(); for (const a of ok) { const g = s(a.r[key]) || "（空）", e = m.get(g) ?? [0, 0, 0, 0]; e[0]++; e[1] += a.cost; e[2] += a.acc; e[3] += a.nbv; m.set(g, e); } return [...m].map(([g, e]) => [g, e[0], r2(e[1]), r2(e[2]), r2(e[3])]); };
        return [await ctx.write("depreciation.xlsx", await writeXlsx([
          { name: `台账（截至 ${asOf}）`, headers: ["资产编号", "名称", "类别", "存放地点", "使用人", "状态", "购置日期", "原值", "残值", "年限", "折旧方法", "已提月数", "累计折旧", "净值", "本月折旧"],
            rows: list.map((a) => [a.id, s(a.r.name), s(a.r.category), s(a.r.location), s(a.r.holder), a.status, a.bought ?? s(a.r.bought), a.ok ? a.cost : s(a.r.cost), a.ok ? r2(a.residual) : s(a.r.residual), a.life || s(a.r.life), a.method ? METHOD_ZH[a.method] : s(a.r.method), a.done, a.ok ? a.acc : "", a.ok ? a.nbv : "", a.ok && a.done < a.months.length ? r2(a.months[a.done]) : a.ok ? 0 : ""]),
            marks: list.flatMap((a, k) => (bad.has(a.i) ? [{ row: k, col: 0, color: "#FECACA" }] : [])), numberFormat: { 7: "#,##0.00", 8: "#,##0.00", 12: "#,##0.00", 13: "#,##0.00", 14: "#,##0.00" } },
          { name: "年度折旧", headers: ["资产编号", "名称", ...ys.map(String), "合计"], rows: ok.map((a) => { const m = cal.get(a.i)!; return [a.id, s(a.r.name), ...ys.map((y) => r2(m.get(y) ?? 0)), r2(a.cost - a.residual)]; }) },
          { name: "按类别", headers: ["类别", "数量", "原值", "累计折旧", "净值"], rows: group("category") },
          { name: "按地点", headers: ["存放地点", "数量", "原值", "累计折旧", "净值"], rows: group("location") },
          { name: "借出", headers: ["资产编号", "名称", "使用人", "应还日期", "逾期天数"], rows: list.filter((a) => a.status === "借出").map((a) => { const d = dateOf(a.r.due); return [a.id, s(a.r.name), s(a.r.holder), d ?? s(a.r.due), d && d < asOf ? Math.round((Date.parse(asOf) - Date.parse(d)) / 86400000) : ""]; }) },
        ]))];
      } },
      { id: "stock", label: ["盘点表 PDF", "Stocktake sheet (PDF)"], description: "stocktake.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { list, asOf } = analyse(p), k = await newPdf(), [W, H] = PAGE.A4, M = 40;
        let pg = k.doc.addPage([W, H]), y = H - 50;
        const need = (h: number) => { if (y - h < 50) { pg = k.doc.addPage([W, H]); y = H - 50; } };
        k.text(pg, `${s(p.settings.company)}固定资产盘点表`, M, y, { size: 16, bold: true }); y -= 18;
        k.text(pg, `截至 ${asOf}    盘点人：________    日期：________`, M, y, { size: 10, color: "#4B5563" }); y -= 24;
        const locs = [...new Set(list.filter((a) => a.status !== "报废").map((a) => s(a.r.location) || (a.status === "借出" ? "借出在外" : "（无地点）")))].sort((a, b) => a.localeCompare(b, "zh"));
        for (const l of locs) {
          need(50); pg.drawRectangle({ x: M - 4, y: y - 5, width: W - 2 * M + 8, height: 18, color: hexRgb("#EEF2FF") }); k.text(pg, l, M, y, { size: 11, bold: true, color: "#1D4ED8" }); y -= 22;
          for (const a of list.filter((x) => x.status !== "报废" && (s(x.r.location) || (x.status === "借出" ? "借出在外" : "（无地点）")) === l)) {
            need(18);
            pg.drawRectangle({ x: M, y: y - 2, width: 9, height: 9, borderColor: hexRgb("#6B7280"), borderWidth: 0.8 });
            k.text(pg, a.id, M + 16, y, { size: 9, bold: true }); k.text(pg, s(a.r.name), M + 90, y, { size: 9, maxWidth: 190 });
            k.text(pg, s(a.r.serial), M + 262, y, { size: 8, color: "#6B7280", maxWidth: 78 }); k.text(pg, [s(a.r.holder), a.status !== "在用" ? a.status : ""].filter(Boolean).join(" · "), M + 345, y, { size: 8, color: "#4B5563", maxWidth: 95 });
            k.text(pg, "实存 □  差异 ______", W - M, y, { size: 8, align: "right", color: "#6B7280" }); y -= 16;
          }
          y -= 6;
        }
        return [await ctx.write("stocktake.pdf", await k.doc.save())];
      } },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [dropped]" : ""} ${s(r.id) || "(no id)"} ${s(r.name)} [${s(r.category)}] bought ${s(r.bought)} cost ${s(r.cost)} life ${s(r.life) || "default"} ${s(r.status) || "在用"}${s(r.location) ? ` @ ${s(r.location)}` : ""}${s(r.holder) ? ` holder ${s(r.holder)}` : ""}${s(r.due) ? ` due ${s(r.due)}` : ""}${s(r.serial) ? ` SN ${s(r.serial)}` : ""}${s(r._nbv) ? ` net ${s(r._nbv)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
