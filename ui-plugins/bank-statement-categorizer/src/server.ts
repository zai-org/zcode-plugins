import { createApp, esc, htmlPage, htmlTable, toCsv, type AppDef, type Issue, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { classify, DEFAULT_RULES, duplicates, pivot, UNCATEGORIZED, type Txn } from "./categorize.ts";

export const NAME = "bank-statement-categorizer";
export const VERSION = "0.1.0";

const ALIASES = {
  date: ["交易日期", "交易时间", "记账日期", "日期", "时间", "date", "posting date", "transaction date", "posted"],
  payee: ["交易对方", "对方户名", "对方", "商户", "payee", "merchant"],
  description: ["摘要", "商品说明", "商品", "备注", "交易摘要", "用途", "description", "memo", "details", "narrative"],
  amount: ["交易金额", "金额", "金额(元)", "amount", "amt"],
  debit: ["支出", "支出金额", "借方", "借方金额", "debit", "withdrawal", "withdrawals", "paid out"],
  credit: ["收入", "存入", "收入金额", "贷方", "贷方金额", "credit", "deposit", "deposits", "paid in"],
  direction: ["收/支", "收支", "收支类型", "资金流向", "type", "direction", "dr/cr"],
};
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "?");
const looksLikeHeader = (cells: string[]) => {
  const m = mapHeaders(cells.filter(Boolean), ALIASES);
  return !!m.date && !!(m.amount || m.debit || m.credit);
};

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "statement",
  title: ["账单自动分类", "Statement Categorizer"],
  openDescription:
    "Read one or more bank / card / payment-app statement exports (.csv/.xlsx; header rows above the table are skipped; Chinese or English columns such as 交易时间/date, 交易对方/payee, 摘要/description, 金额/amount, 收/支, debit/credit). Every transaction gets a category from editable keyword rules (first matching rule wins); manual categories override rules. Returns totals per category and month, uncategorised rows and transactions that appear in two files.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 20, label: ["选择账单导出文件（可多选）", "Pick statement exports (several allowed)"] },
  settings: [
    { key: "rules", label: ["分类规则（关键词 => 分类）", "Rules (keyword => category)"], type: "textarea", default: DEFAULT_RULES },
    { key: "sign", label: ["金额正负", "Amount sign"], type: "select", default: "auto", reload: true, options: [{ value: "auto", label: ["自动（负数或“支出”为花费）", "Auto (negative or ‘支出’ = spending)"] }, { value: "positive", label: ["正数是花费（信用卡账单）", "Positive = spending (card statements)"] }] },
    { key: "currency", label: ["币种标注", "Currency label"], type: "text", default: "" },
  ],
  columns: (p) => {
    const { categories } = classify([], String(p.settings.rules ?? ""));
    const used = [...new Set(p.rows.map((r) => String(r.category ?? "")).filter(Boolean))];
    return [
      { key: "date", label: ["日期", "Date"], type: "date" },
      { key: "description", label: ["说明", "Description"], wide: true },
      { key: "amount", label: ["金额", "Amount"], type: "number" },
      { key: "category", label: ["分类（可改）", "Category (editable)"], type: "select", options: ["", ...new Set([...categories, ...used])] },
      { key: "_how", label: ["依据", "Matched by"], readOnly: true },
      { key: "source", label: ["来源文件", "File"], readOnly: true },
    ];
  },
  newRow: () => ({ date: "", description: "", amount: 0, category: "", source: "manual" }),
  async load({ ws, files, settings }) {
    const rows: Row[] = [];
    for (const file of files) {
      const t = await readTable(ws, file, undefined, { findHeader: looksLikeHeader });
      const m = mapHeaders(t.columns, ALIASES);
      if (!m.date || !(m.amount || m.debit || m.credit)) throw new KitError("columns_not_found", `${file}: could not find a date column and an amount (or debit/credit) column. Columns: ${t.columns.join(", ")}`);
      for (const r of t.rows) {
        let amount: number;
        if (m.amount) {
          amount = num(r[m.amount]);
          const dir = m.direction ? r[m.direction] ?? "" : "";
          if (/支出|支|debit|dr|out|withdraw/i.test(dir) && !/收入/.test(dir)) amount = -Math.abs(amount);
          else if (/收入|收|credit|cr|in|deposit/i.test(dir)) amount = Math.abs(amount);
          else if (/不计收支|neutral/i.test(dir)) amount = 0;
        } else amount = (m.credit ? num(r[m.credit]) || 0 : 0) - (m.debit ? num(r[m.debit]) || 0 : 0);
        if (settings.sign === "positive" && m.amount && !m.direction) amount = -amount;
        const description = [m.payee ? r[m.payee] : "", m.description ? r[m.description] : ""].filter(Boolean).join(" · ");
        if (!r[m.date] && !description) continue;
        rows.push({ date: r[m.date], description, amount: Number.isFinite(amount) ? amount : r[m.amount ?? m.debit ?? m.credit!] ?? "", category: "", source: file });
      }
    }
    return { rows };
  },
  compute(project) {
    const c = classify(project.rows as unknown as Txn[], String(project.settings.rules ?? ""));
    const issues: Issue[] = [];
    for (const b of c.bad) issues.push({ level: "error", key: "rules", message: `Rule line not understood (use “keyword => category”): ${b}` });
    c.rows.forEach((r, i) => {
      if (!r.ok) issues.push({ level: "error", row: i, message: `Date or amount not readable / 日期或金额无法识别: ${project.rows[i].date} · ${project.rows[i].amount}` });
      else if (r.category === UNCATEGORIZED) issues.push({ level: "warn", row: i, key: "category", message: `Uncategorised / 未分类: ${r.description}` });
    });
    for (const [a, b] of duplicates(c.rows)) issues.push({ level: "warn", row: b, message: `Same date, amount and description as row #${a} in another file — possibly counted twice / 可能重复计入` });
    const p = pivot(c.rows);
    const income = c.rows.filter((r) => r.ok && r.amount > 0).reduce((a, r) => a + r.amount, 0);
    const spend = c.rows.filter((r) => r.ok && r.amount < 0).reduce((a, r) => a + r.amount, 0);
    const cur = String(project.settings.currency ?? "");
    const unc = c.rows.filter((r) => r.category === UNCATEGORIZED).length;
    const max = Math.max(1, ...p.cats.map((k) => Math.abs(p.total(k))));
    const bars = p.cats.map((k) => { const v = p.total(k); return `<div style="display:flex;gap:6px;align-items:center;margin:2px 0"><span style="width:150px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k)}</span><span style="height:12px;border-radius:3px;background:${v < 0 ? "#f87171" : "#4ade80"};width:${Math.round((Math.abs(v) / max) * 160)}px"></span><span>${fmt(v)}</span></div>`; }).join("");
    const table = htmlTable([`分类 Category`, ...p.months, "合计 Total"], p.cats.map((k) => [k, ...p.months.map((m) => fmt(p.get(k, m))), fmt(p.total(k))]));
    return {
      rows: project.rows.map((r, i) => ({ ...r, category: c.rows[i].category === UNCATEGORIZED && !r.category ? "" : c.rows[i].category, _how: c.rows[i].how })),
      issues,
      summary: `${c.rows.length} transaction(s) in ${project.inputs.length} file(s): income ${fmt(income)}${cur ? " " + cur : ""}, spending ${fmt(-spend)}${cur ? " " + cur : ""}; ${unc} uncategorised. 共 ${c.rows.length} 笔，收入 ${fmt(income)}，支出 ${fmt(-spend)}，未分类 ${unc} 笔。`,
      stats: { 收入: fmt(income), 支出: fmt(-spend), 未分类: unc, 分类: p.cats.length },
      preview: `<h3 style="margin:0 0 6px">按分类 By category</h3>${bars}<h3>按月 By month</h3>${table}`,
    };
  },
  exports: [
    {
      id: "xlsx",
      label: ["分类结果 Excel", "Categorised Excel"],
      description: "categorised.xlsx: Transactions, Month × Category summary and Rules sheets",
      async run(ctx) {
        const c = classify(ctx.project.rows as unknown as Txn[], String(ctx.project.settings.rules ?? ""));
        const p = pivot(c.rows);
        const xlsx = await writeXlsx([
          { name: "Transactions", headers: ["Date", "Description", "Amount", "Category", "Matched by", "File"], rows: c.rows.map((r) => [r.date, r.description, Number.isFinite(r.amount) ? r.amount : "", r.category, r.how, r.source]), marks: c.rows.flatMap((r, i) => (r.category === UNCATEGORIZED ? [{ row: i, col: 3 }] : [])), numberFormat: { 2: "#,##0.00" } },
          { name: "Summary", headers: ["Category", ...p.months, "Total"], rows: p.cats.map((k) => [k, ...p.months.map((m) => p.get(k, m)), p.total(k)]) },
          { name: "Rules", headers: ["Keyword", "Category"], rows: c.rules.map((r) => [r.keyword, r.category]) },
        ]);
        return [await ctx.write("categorised.xlsx", xlsx)];
      },
    },
    {
      id: "csv",
      label: ["CSV", "CSV"],
      description: "categorised.csv (one row per transaction)",
      async run(ctx) {
        const c = classify(ctx.project.rows as unknown as Txn[], String(ctx.project.settings.rules ?? ""));
        return [await ctx.write("categorised.csv", toCsv(["Date", "Description", "Amount", "Category", "File"], c.rows.map((r) => [r.date, r.description, r.amount, r.category, r.source])))];
      },
    },
    {
      id: "report",
      label: ["月度报告 HTML", "Monthly report (HTML)"],
      description: "report.html with category totals and a month × category table",
      async run(ctx) {
        const v = ctx.computed;
        return [await ctx.write("report.html", htmlPage("Spending report", `<h1>${esc(ctx.project.name)}</h1><p>${esc(v.summary)}</p>${v.preview}`))];
      },
    },
    {
      id: "rules",
      label: ["保存规则", "Save rules"],
      description: "rules.txt — reuse next month by pasting into settings",
      async run(ctx) {
        return [await ctx.write("rules.txt", String(ctx.project.settings.rules ?? ""))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${r.date} · ${r.description} · ${r.amount} → ${r.category || "?"} (${r._how})`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
