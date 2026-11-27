import { createApp, esc, toCsv, type AppDef, type Computed, type ExportCtx, type Column, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { applyAction, charm, matchRule, parseRules, ROUNDINGS, type Rounding } from "./pricing.ts";

export const NAME = "price-list-updater";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => num(v);
const c2 = (x: number) => Math.round(x * 100) / 100;
const DEFAULT_RULES = "分类=饮料: +5%\n供应商=绿源: +1\n全部: +3%";

type Meta = { columns: string[]; priceCol: string; costCol?: string; skuCol?: string; file: string; sheet?: string };

const ROUND_LABEL: Record<Rounding, [string, string]> = {
  none: ["不取整（保留两位小数）", "No rounding (cents)"], "0.01": ["到分", "To 0.01"], "0.1": ["到角（0.1）", "To 0.10"], "1": ["到元（整数）", "Whole numbers"], "0.5": ["到 0.5", "To 0.50"],
  "0.99": ["尾数 .99（如 12.99）", "End in .99"], "0.9": ["尾数 .9（如 12.9）", "End in .90"], "0.8": ["尾数 .8（如 12.8）", "End in .80"], "9": ["个位是 9（如 19、29）", "End in 9 (19, 29…)"],
};

function priceFor(row: Row, settings: Record<string, unknown>) {
  const { rules } = parseRules(s(settings.rules));
  const old = n(row.old), cost = n(row.cost);
  const item = { sku: s(row.sku), name: s(row.name), category: s(row.category), supplier: s(row.supplier), cost, price: old };
  const rule = matchRule(rules, item);
  if (!rule || !Number.isFinite(old)) return { price: Number.isFinite(old) ? old : NaN, rule: "" };
  if (rule.action.kind === "markup" && !Number.isFinite(cost)) return { price: old, rule: `#${rule.line} (no cost)` };
  const raw = applyAction(rule.action, old, cost);
  return { price: charm(raw, (s(settings.rounding) || "0.9") as Rounding, (s(settings.direction) || "up") as "up" | "down" | "nearest"), rule: `#${rule.line} ${rule.text}` };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "prices",
  title: ["批量调价", "Price List Updater"],
  openDescription:
    "Bulk-change a price list (.xlsx/.csv with a price column — 售价/价格/price — and optionally SKU, name, category/分类, supplier/供应商, cost/进价) by rules and round to charm prices. settings.rules has one rule per line, first match wins: “分类=饮料,零食: +5%”, “供应商=绿源: +1”, “SKU=A001: =12.9”, “名称=有机: x1.1”, “全部: 成本+40%” (price from cost plus markup). Rounding: none, 0.01, 0.1, 1, 0.5, 0.99, 0.9, 0.8, 9; direction up/down/nearest. Override single prices with set: [{row, values: {new: 12.5}}]; overrides stay when rules change. Exports the updated sheet (all original columns kept) and a before/after CSV.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 1, max: 1, label: ["选择价目表", "Pick a price list"] },
  settings: [
    { key: "rules", label: ["调价规则", "Price rules"], type: "textarea", default: DEFAULT_RULES, reload: true, help: ["每行一条，从上往下第一条匹配的生效：分类=饮料: +5% ／ 供应商=绿源: +1 ／ SKU=A001: =12.9 ／ 全部: 成本+40%", "One per line, first match wins: 分类=饮料: +5% / supplier=X: +1 / SKU=A001: =12.9 / all: cost+40%"] },
    { key: "rounding", label: ["尾数取整", "Charm rounding"], type: "select", default: "0.9", reload: true, options: ROUNDINGS.map((v) => ({ value: v, label: ROUND_LABEL[v] })) },
    { key: "direction", label: ["取整方向", "Round"], type: "select", default: "up", reload: true, options: [{ value: "up", label: ["向上", "Up"] }, { value: "nearest", label: ["就近", "Nearest"] }, { value: "down", label: ["向下", "Down"] }] },
    { key: "minMargin", label: ["最低毛利率 %", "Minimum margin %"], type: "number", default: 20, min: 0, max: 99, help: ["低于这个毛利率会提醒（需要进价列）", "Warn below this margin (needs a cost column)"] },
    { key: "maxChange", label: ["涨跌幅提醒 %", "Flag changes over %"], type: "number", default: 30, min: 0 },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
  ],
  columns: () => [
    { key: "sku", label: ["SKU", "SKU"], readOnly: true },
    { key: "name", label: ["商品", "Product"], readOnly: true, wide: true },
    { key: "category", label: ["分类", "Category"], readOnly: true },
    { key: "supplier", label: ["供应商", "Supplier"], readOnly: true },
    { key: "cost", label: ["进价", "Cost"], type: "number", readOnly: true },
    { key: "old", label: ["原价", "Old price"], type: "number", readOnly: true },
    { key: "new", label: ["新价", "New price"], type: "number" },
    { key: "change", label: ["涨跌", "Change"], readOnly: true },
    { key: "margin", label: ["毛利率", "Margin"], readOnly: true },
    { key: "rule", label: ["规则", "Rule"], readOnly: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, {
      cost: ["进价", "成本", "成本价", "采购价", "cost", "unit cost", "cost price"],
      sku: ["sku", "编码", "货号", "商品编码", "条码", "code", "item code", "item"],
      category: ["分类", "类别", "品类", "category", "type"],
      supplier: ["供应商", "厂家", "厂商", "supplier", "vendor"],
      price: ["售价", "零售价", "价格", "单价", "原价", "现价", "price", "retail price", "sale price"],
      name: ["商品名称", "名称", "品名", "商品", "name", "product", "title", "description"],
    });
    if (!m.price) throw new KitError("columns_not_found", `No price column found (售价 / 价格 / price). Columns: ${t.columns.join(", ")}`);
    const prev = new Map((previous ?? []).map((r) => [s(r._key), r]));
    const rows: Row[] = t.rows.map((r, i) => {
      const sku = m.sku ? s(r[m.sku]) : "";
      const row: Row = {
        _key: sku || `#${i}`, _raw: r, sku, name: m.name ? s(r[m.name]) : "", category: m.category ? s(r[m.category]) : "", supplier: m.supplier ? s(r[m.supplier]) : "",
        cost: m.cost && Number.isFinite(n(r[m.cost])) ? n(r[m.cost]) : "", old: Number.isFinite(n(r[m.price!])) ? n(r[m.price!]) : s(r[m.price!]),
      };
      const { price, rule } = priceFor(row, settings);
      row.new = Number.isFinite(price) ? price : ""; row._auto = row.new; row.rule = rule;
      const old = prev.get(s(row._key));
      if (old && s(old.new) !== s(old._auto)) { row.new = old.new; row.rule = "✎ 手动 / manual"; }
      return row;
    });
    const meta: Meta = { columns: t.columns, priceCol: m.price, costCol: m.cost, skuCol: m.sku, file: files[0] };
    return { rows, meta };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const { rules, errors } = parseRules(s(p.settings.rules));
    for (const e of errors) issues.push({ level: "error", message: e });
    const cur = s(p.settings.currency) || "¥";
    const minMargin = n(p.settings.minMargin), maxChange = n(p.settings.maxChange);
    const used = new Set<number>();
    let changed = 0, up = 0, down = 0, oldSum = 0, newSum = 0;
    const rows: Row[] = p.rows.map((r, i): Row => {
      const isManual = s(r.new) !== s(r._auto);
      if (isManual) r = { ...r, rule: "✎ 手动 / manual" };
      const old = n(r.old), nw = n(r.new), cost = n(r.cost);
      const m = s(r.rule).match(/^#(\d+)/); if (m) used.add(Number(m[1]));
      if (!Number.isFinite(old)) issues.push({ level: "warn", row: i, key: "old", message: `No old price (“${s(r.old)}”) — row left as is / 原价不是数字` });
      if (!Number.isFinite(nw) || nw <= 0) { if (Number.isFinite(old)) issues.push({ level: "error", row: i, key: "new", message: `New price “${s(r.new)}” must be a number above 0 / 新价无效` }); return { ...r, change: "", margin: "" }; }
      const d = c2(nw - old), pct = old > 0 ? (d / old) * 100 : 0;
      if (Number.isFinite(old)) { oldSum += old; newSum += nw; if (d !== 0) { changed++; if (d > 0) up++; else down++; } }
      const margin = Number.isFinite(cost) ? ((nw - cost) / nw) * 100 : NaN;
      if (Number.isFinite(cost) && nw < cost) issues.push({ level: "warn", row: i, key: "new", message: `${cur}${nw} is below cost ${cur}${cost} / 低于进价` });
      else if (Number.isFinite(margin) && minMargin > 0 && margin < minMargin) issues.push({ level: "warn", row: i, key: "new", message: `Margin ${margin.toFixed(1)}% is under ${minMargin}% / 毛利率低于 ${minMargin}%` });
      if (maxChange > 0 && Math.abs(pct) > maxChange) issues.push({ level: "warn", row: i, key: "new", message: `Price changes ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% (over ${maxChange}%) / 涨跌幅过大` });
      return { ...r, change: d === 0 ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(2)} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`, margin: Number.isFinite(margin) ? `${margin.toFixed(1)}%` : "" };
    });
    for (const r of rules) if (!used.has(r.line)) issues.push({ level: "warn", message: `Rule #${r.line} “${r.text}” matched no item (check the spelling, or an earlier rule already caught them) / 规则 #${r.line} 没有匹配到商品` });
    const manual = rows.filter((r) => s(r.rule).startsWith("✎")).length;
    const avg = oldSum > 0 ? ((newSum - oldSum) / oldSum) * 100 : 0;
    const top = rows.filter((r) => s(r.change) && s(r.change) !== "—").slice(0, 8);
    return {
      rows,
      issues,
      summary: `${changed} of ${p.rows.length} price(s) change (${up} up, ${down} down${manual ? `, ${manual} by hand` : ""}); list total ${cur}${c2(oldSum)} → ${cur}${c2(newSum)} (${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%). 改价 ${changed} 个。`,
      stats: { items: p.rows.length, changed, up, down, manual, oldTotal: c2(oldSum), newTotal: c2(newSum) },
      preview: `<div style="font-size:12px"><table class="data"><thead><tr><th>SKU</th><th>商品</th><th>原价</th><th>新价</th><th>涨跌</th></tr></thead><tbody>${top.map((r) => `<tr><td>${esc(s(r.sku))}</td><td>${esc(s(r.name))}</td><td style="text-decoration:line-through;color:#6b7280">${esc(cur + s(r.old))}</td><td><b>${esc(cur + s(r.new))}</b></td><td style="color:${s(r.change).startsWith("-") ? "#15803d" : "#b91c1c"}">${esc(s(r.change))}</td></tr>`).join("")}</tbody></table>${changed > top.length ? `<p class="muted">… ${changed - top.length} more</p>` : ""}</div>`,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["新价目表 Excel", "Updated price list (Excel)"], description: "updated-prices.xlsx — the original sheet with new prices (changed cells highlighted, old price in a note) plus a 改价对照 / Changes sheet",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const meta = project.meta as Meta;
        const pc = meta.columns.indexOf(meta.priceCol);
        const cell = (v: unknown) => { const t = s(v); return /^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t) ? Number(t) : t; };
        const marks: { row: number; col: number; color: string; note: string }[] = [];
        const rows = project.rows.map((r, i) => {
          const raw = (r._raw ?? {}) as Record<string, unknown>;
          const nw = n(r.new), old = n(r.old);
          if (Number.isFinite(nw) && nw !== old) marks.push({ row: i, col: pc, color: nw > old ? "#FECACA" : "#BBF7D0", note: `原价 / was ${s(r.old)}` });
          return meta.columns.map((c, j) => (j === pc && Number.isFinite(nw) ? nw : cell(raw[c])));
        });
        const ch = (computed.rows ?? project.rows) as Row[];
        const xlsx = await writeXlsx([
          { name: "价目表 Prices", headers: meta.columns, rows, marks, numberFormat: { [pc]: "0.00" } },
          { name: "改价对照 Changes", headers: ["SKU", "商品 Product", "分类 Category", "供应商 Supplier", "进价 Cost", "原价 Old", "新价 New", "差额 Change", "涨跌 %", "毛利率 Margin", "规则 Rule"], rows: ch.map((r) => { const old = n(r.old), nw = n(r.new); return [s(r.sku), s(r.name), s(r.category), s(r.supplier), r.cost === "" ? "" : n(r.cost), Number.isFinite(old) ? old : s(r.old), Number.isFinite(nw) ? nw : "", Number.isFinite(old) && Number.isFinite(nw) ? c2(nw - old) : "", Number.isFinite(old) && old > 0 && Number.isFinite(nw) ? c2(((nw - old) / old) * 100) : "", s(r.margin), s(r.rule)]; }), numberFormat: { 4: "0.00", 5: "0.00", 6: "0.00", 7: "+0.00;-0.00;0" } },
        ]);
        return [await write("updated-prices.xlsx", xlsx)];
      },
    },
    {
      id: "csv", label: ["改价对照 CSV", "Before/after (CSV)"], description: "price-changes.csv — only the items whose price changes",
      async run({ project, write }: ExportCtx) {
        const rows = project.rows.filter((r) => Number.isFinite(n(r.new)) && n(r.new) !== n(r.old));
        return [await write("price-changes.csv", toCsv(["sku", "name", "category", "supplier", "old_price", "new_price", "change", "change_pct", "rule"], rows.map((r) => { const old = n(r.old), nw = n(r.new); return [s(r.sku), s(r.name), s(r.category), s(r.supplier), old, nw, c2(nw - old), old > 0 ? c2(((nw - old) / old) * 100) : "", s(r.new) !== s(r._auto) ? "manual" : s(r.rule)]; })))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${s(r.sku)} ${s(r.name)} · ${s(r.old)} → ${s(r.new)} ${s(r.rule)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
export type { Project };
