import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, parseDate } from "./kit/columns.ts";
import { hexRgb, MM, newPdf, PAGE, type PdfKit } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError, safeFileName } from "./kit/workspace.ts";
import { amountOf, compute, parseSpecial, parseTiers, type PersonResult, type Sale, type Tier } from "./commission.ts";

export const NAME = "sales-commission";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const REFUND = /退|refund|return|cancel|取消|撤销|作废|chargeback|void/i;
const fmtMoney = (n: number, cur: string) => `${n < 0 ? "-" : ""}${cur}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctText = (r: number) => `${(Math.round(r * 10000) / 100).toString()}%`;
const tierText = (t: Tier, cur: string) => `${cur}${t.from.toLocaleString("en-US")} – ${t.to === Infinity ? "∞" : cur + t.to.toLocaleString("en-US")}`;

export function analyse(p: Project) {
  const issues: Issue[] = [];
  const tiers = parseTiers(s(p.settings.tiers));
  if (tiers.error) issues.push({ level: "error", message: `Tiers: ${tiers.error}` });
  const special = parseSpecial(s(p.settings.special));
  if (special.error) issues.push({ level: "error", message: `Product rates: ${special.error}` });
  const period = s(p.settings.period).replace(/[/.年]/g, "-").replace(/月$/, "");
  const mode = p.settings.mode === "whole" ? "whole" : "progressive";
  const sales: Sale[] = [];
  const skipped = new Set<number>();
  const orders = new Map<string, number>();
  p.rows.forEach((r, row) => {
    const amount = amountOf(r.amount);
    const person = s(r.person);
    const date = parseDate(r.date) || s(r.date);
    if (!person) { issues.push({ level: "error", row, key: "person", message: "No salesperson / 没有销售员" }); return; }
    if (!Number.isFinite(amount)) { issues.push({ level: "error", row, key: "amount", message: `Amount “${s(r.amount)}” is not a number / 金额不是数字` }); return; }
    if (period && !date.startsWith(period)) { skipped.add(row); return; }
    const refund = REFUND.test(s(r.status)) || amount < 0;
    const order = s(r.order);
    if (order && !refund) {
      if (orders.has(order)) issues.push({ level: "warn", row, key: "order", message: `Order ${order} is listed twice (also row ${orders.get(order)}) — counted twice / 订单号重复` });
      else orders.set(order, row);
    }
    sales.push({ row, date, person, order, product: s(r.product), category: s(r.category), amount, refund });
  });
  for (const x of sales.filter((y) => y.refund && y.order)) {
    const o = orders.get(x.order);
    if (o !== undefined && s(p.rows[o].person) !== x.person) issues.push({ level: "warn", row: x.row, key: "person", message: `Refund for order ${x.order} is under ${x.person}, but the sale was ${s(p.rows[o].person)}'s / 退货记在了别人名下` });
  }
  const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  const names = [...new Set(sales.map((x) => x.person))];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (norm(names[i]) === norm(names[j])) issues.push({ level: "warn", message: `“${names[i]}” and “${names[j]}” look like the same person / 名字写法不一致` });
  const ok = !tiers.error && !special.error;
  const res = ok ? compute(sales, tiers.tiers, special.rates, mode) : { results: [] as PersonResult[], lines: new Map() };
  for (const r of res.results) if (r.total < 0) issues.push({ level: "warn", message: `${r.person}: refunds are larger than sales — the statement shows ${r.total.toFixed(2)} to claw back / 退货大于销售，提成为负` });
  if (period && skipped.size) issues.push({ level: "info", message: `${skipped.size} row(s) outside ${period} are not counted / ${skipped.size} 行不在 ${period}，未计入` });
  return { issues, tiers: tiers.tiers, mode, period, sales, skipped, ...res };
}

function previewHtml(a: ReturnType<typeof analyse>, cur: string) {
  if (!a.results.length) return "";
  const rows = a.results.map((r) => `<tr><td>${esc(r.person)}</td><td class="num">${esc(fmtMoney(r.sales, cur))}</td><td class="num">${r.refunds ? esc(fmtMoney(-r.refunds, cur)) : "—"}</td><td class="num">${esc(pctText(r.topRate))}</td><td class="num">${esc(fmtMoney(r.tierCommission + r.specialCommission, cur))}</td><td class="num" style="color:#dc2626">${r.clawback ? esc(fmtMoney(r.clawback, cur)) : "—"}</td><td class="num"><b>${esc(fmtMoney(r.total, cur))}</b></td></tr>`).join("");
  const tiers = a.tiers.map((t) => `<li>${esc(tierText(t, cur))}: <b>${esc(pctText(t.rate))}</b></li>`).join("");
  return `<div style="font-size:13px"><table class="data"><thead><tr><th>销售 Person</th><th>销售额 Sales</th><th>退货 Refunds</th><th>达到档位 Tier</th><th>提成 Commission</th><th>扣回 Clawback</th><th>应发 Total</th></tr></thead><tbody>${rows}</tbody></table><p class="muted" style="margin:10px 0 2px">${a.mode === "whole" ? "全额阶梯（达到哪档全部按哪档）Whole-tier" : "超额累进（每档只算该档内的部分）Progressive"}${a.period ? ` · ${esc(a.period)}` : ""}</p><ul style="margin:0;padding-left:18px">${tiers}</ul></div>`;
}

function drawStatement(k: PdfKit, p: Project, a: ReturnType<typeof analyse>, r: PersonResult) {
  const cur = s(p.settings.currency) || "¥";
  const [W, H] = PAGE.A4;
  const m = 18 * MM;
  const accent = hexRgb(s(p.settings.accent) || "#0f766e");
  let page = k.doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: accent });
  let y = H - m;
  k.text(page, s(p.settings.company) || "", m, y, { size: 11, color: "#6b7280" });
  k.text(page, "提成单 Commission statement", m, y - 24, { size: 18, bold: true });
  k.text(page, r.person, W - m, y - 4, { size: 16, bold: true, align: "right" });
  k.text(page, a.period ? `期间 Period: ${a.period}` : `${a.sales.filter((x) => x.person === r.person).map((x) => x.date).filter(Boolean).sort()[0] ?? ""} – ${a.sales.filter((x) => x.person === r.person).map((x) => x.date).filter(Boolean).sort().pop() ?? ""}`, W - m, y - 22, { size: 9.5, color: "#374151", align: "right" });
  y -= 54;
  const box = [["销售额 Sales", fmtMoney(r.sales, cur)], ["退货 Refunds", r.refunds ? fmtMoney(-r.refunds, cur) : "—"], ["提成 Commission", fmtMoney(r.tierCommission + r.specialCommission, cur)], ["扣回 Clawback", r.clawback ? fmtMoney(r.clawback, cur) : "—"], ["应发 Payable", fmtMoney(r.total, cur)]];
  const bw = (W - 2 * m) / box.length;
  box.forEach(([l, v], i) => {
    const last = i === box.length - 1;
    page.drawRectangle({ x: m + i * bw + 2, y: y - 40, width: bw - 4, height: 46, color: last ? accent : hexRgb("#f3f4f6") });
    k.text(page, l, m + i * bw + 10, y - 8, { size: 8.5, color: last ? "#ffffff" : "#6b7280" });
    let vs = 12; // shrink long amounts to fit the card instead of cutting them off
    while (vs > 8 && k.width(v, vs, true) > bw - 16) vs -= 0.5;
    k.text(page, v, m + i * bw + 10, y - 28, { size: vs, bold: true, color: last ? "#ffffff" : "#111827", maxWidth: bw - 16 });
  });
  y -= 66;
  k.text(page, a.mode === "whole" ? "阶梯（全额）Tiers — whole" : "阶梯（超额累进）Tiers — progressive", m, y, { size: 10, bold: true });
  y -= 16;
  for (const b of r.breakdown) {
    k.text(page, `${tierText(b.tier, cur)}  × ${pctText(b.tier.rate)}`, m + 8, y, { size: 9 });
    k.text(page, fmtMoney(b.amount, cur), W - m - 110, y, { size: 9, align: "right" });
    k.text(page, fmtMoney(Math.round(b.commission * 100) / 100, cur), W - m, y, { size: 9, align: "right" });
    y -= 13;
  }
  if (r.specialSales || r.specialCommission) { k.text(page, "特殊品类按各自比例 Product rates apply to their own lines (not counted in tiers)", m + 8, y, { size: 8.5, color: "#6b7280" }); y -= 13; }
  y -= 10;
  // 左对齐列的 x，以及右对齐列的右边界
  const L = { date: m + 3, order: m + 60, product: m + 122, type: m + 262 };
  const R = { amount: W - m - 128, rate: W - m - 70, comm: W - m - 4 };
  const header = () => {
    page.drawRectangle({ x: m, y: y - 5, width: W - 2 * m, height: 18, color: hexRgb("#f3f4f6") });
    k.text(page, "日期 Date", L.date, y, { size: 8.5, bold: true });
    k.text(page, "订单 Order", L.order, y, { size: 8.5, bold: true });
    k.text(page, "产品 Product", L.product, y, { size: 8.5, bold: true });
    k.text(page, "类型 Type", L.type, y, { size: 8.5, bold: true });
    k.text(page, "金额 Amount", R.amount, y, { size: 8.5, bold: true, align: "right" });
    k.text(page, "比例 Rate", R.rate, y, { size: 8.5, bold: true, align: "right" });
    k.text(page, "提成 Comm.", R.comm, y, { size: 8.5, bold: true, align: "right" });
    y -= 20;
  };
  header();
  const KIND: Record<string, string> = { tier: "阶梯", special: "特殊品类", refund: "退货扣回", "special-refund": "退货扣回" };
  for (const row of r.lines) {
    const l = a.lines.get(row);
    if (!l) continue;
    const x = a.sales.find((q) => q.row === row)!;
    if (y < 70) { page = k.doc.addPage([W, H]); y = H - m; header(); }
    const red = l.commission < 0 ? "#dc2626" : "#111827";
    k.text(page, x.date, L.date, y, { size: 8.5 });
    k.text(page, x.order, L.order, y, { size: 8.5, maxWidth: L.product - L.order - 6 });
    k.text(page, x.product || x.category, L.product, y, { size: 8.5, maxWidth: L.type - L.product - 6 });
    k.text(page, KIND[l.kind] ?? l.kind, L.type, y, { size: 8.5, color: l.kind.includes("refund") ? "#dc2626" : "#374151" });
    k.text(page, fmtMoney(x.refund ? -Math.abs(x.amount) : x.amount, cur), R.amount, y, { size: 8.5, align: "right", color: red });
    k.text(page, pctText(l.rate), R.rate, y, { size: 8.5, align: "right" });
    k.text(page, fmtMoney(l.commission, cur), R.comm, y, { size: 8.5, align: "right", color: red });
    y -= 13;
  }
  if (y < 110) { page = k.doc.addPage([W, H]); y = H - m; }
  y -= 26;
  k.text(page, `确认签字 Signature: ____________________     日期 Date: ____________`, m, y, { size: 9.5, color: "#374151" });
  const note = s(p.settings.note);
  if (note) for (const [i, line] of k.wrap(note, 8.5, W - 2 * m).slice(0, 4).entries()) k.text(page, line, m, y - 22 - i * 11, { size: 8.5, color: "#6b7280" });
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "commission",
  title: ["销售提成计算", "Sales Commission"],
  openDescription:
    "Work out sales commissions from a sales sheet (.xlsx/.csv; one row per order line; columns like 日期/date, 销售/salesperson, 订单号/order, 产品/product, 品类/category, 金额/amount, 状态/status are matched). Tiers (settings.tiers, e.g. “0-50000:3%; 50000-100000:5%; 100000+:8%”) are progressive (like tax brackets) or whole (reach a tier → that rate on everything). Product rates (settings.special, e.g. “配件:10%; 服务:15%”) give matching categories/products their own rate outside the tiers. Refunds (status 退货/refund/cancel or a negative amount) reduce the period's sales and are clawed back at the same rate. Optional period filter (YYYY-MM).",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择销售明细表", "Pick the sales sheet"] },
  settings: [
    { key: "company", label: ["公司 / 标题", "Company / title"], type: "text", default: "" },
    { key: "period", label: ["期间（YYYY-MM，可选）", "Period (YYYY-MM, optional)"], type: "text", default: "", help: ["只计算这个月的行；留空 = 全部", "Only rows in this month; empty = all rows"] },
    { key: "tiers", label: ["阶梯规则", "Tiers"], type: "textarea", default: "0-50000:3%; 50000-100000:5%; 100000+:8%", help: ["每档“起-止:比例”，用分号隔开；可写 5万", "“from-to:rate” separated by semicolons; 5万 = 50,000"] },
    { key: "mode", label: ["阶梯算法", "Tier method"], type: "select", default: "progressive", options: [{ value: "progressive", label: ["超额累进（每档只算该档部分）", "Progressive (each tier on its slice)"] }, { value: "whole", label: ["全额（达到哪档全部按哪档）", "Whole (reached tier on everything)"] }] },
    { key: "special", label: ["特殊品类提成", "Product rates"], type: "textarea", default: "", help: ["如“配件:10%; 服务:15%”，这些行不计入阶梯", "e.g. “配件:10%; 服务:15%”; these lines don't count toward tiers"] },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
    { key: "accent", label: ["主题色", "Accent colour"], type: "color", default: "#0f766e" },
    { key: "note", label: ["提成单备注", "Statement note"], type: "textarea", default: "" },
  ],
  columns: () => [
    { key: "date", label: ["日期", "Date"], type: "date" },
    { key: "person", label: ["销售", "Salesperson"] },
    { key: "order", label: ["订单号", "Order"] },
    { key: "product", label: ["产品", "Product"], wide: true },
    { key: "category", label: ["品类", "Category"] },
    { key: "amount", label: ["金额", "Amount"], type: "number" },
    { key: "status", label: ["状态", "Status"] },
    { key: "_type", label: ["类型", "Type"], readOnly: true },
    { key: "_rate", label: ["比例", "Rate"], readOnly: true },
    { key: "_commission", label: ["提成", "Commission"], type: "number", readOnly: true },
  ],
  newRow: () => ({ date: new Date().toISOString().slice(0, 10), person: "", order: "", product: "", category: "", amount: 0, status: "" }),
  async load({ ws, files }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, {
      date: ["日期", "成交日期", "下单日期", "date", "order date"],
      person: ["销售", "销售员", "业务员", "销售人员", "负责人", "salesperson", "sales rep", "rep", "seller", "owner"],
      order: ["订单号", "订单", "单号", "order", "order no", "order id", "invoice"],
      product: ["产品", "商品", "产品名称", "品名", "product", "item", "sku"],
      category: ["品类", "类别", "分类", "category", "type", "product type"],
      amount: ["金额", "销售额", "成交金额", "实收", "amount", "revenue", "sales", "total"],
      status: ["状态", "订单状态", "status", "state"],
    });
    const miss = ["person", "amount"].filter((k) => !m[k]);
    if (miss.length) throw new KitError("columns_not_found", `Couldn't find ${miss.join(" and ")} (销售/salesperson, 金额/amount). Columns: ${t.columns.join(", ")}`);
    const rows: Row[] = t.rows.filter((r) => s(r[m.person!]) || s(r[m.amount!])).map((r) => ({
      date: m.date ? parseDate(r[m.date]) || s(r[m.date]) : "", person: s(r[m.person!]), order: m.order ? s(r[m.order]) : "", product: m.product ? s(r[m.product]) : "",
      category: m.category ? s(r[m.category]) : "", amount: r[m.amount!] ?? "", status: m.status ? s(r[m.status]) : "",
    }));
    return { rows };
  },
  compute(p): Computed {
    const a = analyse(p);
    const cur = s(p.settings.currency) || "¥";
    const KIND: Record<string, string> = { tier: "阶梯 tier", special: "特殊 product", refund: "退货 refund", "special-refund": "退货 refund" };
    const rows = p.rows.map((r, i) => {
      const l = a.lines.get(i);
      return { ...r, _type: a.skipped.has(i) ? "不在期间 skipped" : l ? KIND[l.kind] : "", _rate: l ? pctText(l.rate) : "", _commission: l ? l.commission : "" };
    });
    const total = a.results.reduce((x, r) => x + r.total, 0);
    return {
      rows,
      issues: a.issues,
      summary: `${a.results.length} salesperson(s), ${a.sales.length} line(s): commission payable ${fmtMoney(total, cur)}. ${a.results.length} 位销售，应发提成合计 ${fmtMoney(total, cur)}。`,
      stats: { people: a.results.length, lines: a.sales.length, payable: Math.round(total * 100) / 100, clawback: Math.round(a.results.reduce((x, r) => x + r.clawback, 0) * 100) / 100 },
      preview: previewHtml(a, cur),
    };
  },
  exports: [
    {
      id: "xlsx", label: ["提成汇总 Excel", "Commission workbook"], description: "commission.xlsx — summary per person, every line with its rate and commission, and the rules",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const a = analyse(project);
        const cur = s(project.settings.currency) || "¥";
        const mf = "#,##0.00;[Red]-#,##0.00";
        const xlsx = await writeXlsx([
          { name: "汇总 Summary", headers: ["销售 Person", "销售额 Sales", "退货 Refunds", "计阶梯销售额 Tier sales", "达到档位 Top rate", "阶梯提成 Tier comm.", "特殊品类销售 Product-rate sales", "特殊品类提成 Product comm.", "扣回 Clawback", "应发 Payable"], rows: a.results.map((r) => [r.person, r.sales, -r.refunds, r.tierBase, pctText(r.topRate), r.tierCommission, r.specialSales, r.specialCommission, r.clawback, r.total]), numberFormat: { 1: mf, 2: mf, 3: mf, 5: mf, 6: mf, 7: mf, 8: mf, 9: mf } },
          { name: "明细 Lines", headers: ["日期", "销售", "订单号", "产品", "品类", "金额", "状态", "类型", "比例", "提成"], rows: a.sales.map((x) => { const l = a.lines.get(x.row)!; return [x.date, x.person, x.order, x.product, x.category, x.refund ? -Math.abs(x.amount) : x.amount, s(project.rows[x.row].status), l.kind, pctText(l.rate), l.commission]; }), numberFormat: { 5: mf, 9: mf } },
          { name: "规则 Rules", headers: ["项目", "内容"], rows: [["阶梯算法 Method", a.mode === "whole" ? "全额 whole" : "超额累进 progressive"], ...a.tiers.map((t) => [tierText(t, cur), pctText(t.rate)]), ["特殊品类 Product rates", s(project.settings.special) || "—"], ["期间 Period", a.period || "全部 all"]] },
        ]);
        return [await write("commission.xlsx", xlsx)];
      },
    },
    {
      id: "pdf", label: ["个人提成单 PDF", "Statements (PDF)"], description: "statements/<person>.pdf for each salesperson plus all-statements.pdf",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const a = analyse(project);
        const files: string[] = [];
        let cjk = true;
        for (const r of a.results) {
          const k = await newPdf();
          cjk &&= k.cjk;
          drawStatement(k, project, a, r);
          files.push(await write(`statements/${safeFileName(r.person, "person")}.pdf`, await k.doc.save()));
        }
        const all = await newPdf();
        for (const r of a.results) drawStatement(all, project, a, r);
        files.push(await write("all-statements.pdf", await all.doc.save()));
        return { files, note: cjk ? undefined : "No Chinese font was found on this computer; non-Latin text was replaced with ?." };
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.date)} ${s(r.person)} ${s(r.order)} ${s(r.product)} [${s(r.category)}] ${s(r.amount)} ${s(r.status)} → ${s(r._type)} ${s(r._rate)} ${s(r._commission)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
