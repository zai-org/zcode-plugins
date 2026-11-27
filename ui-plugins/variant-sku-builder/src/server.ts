import { createApp, esc, toCsv, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { build, optionsTextFromRows, parseExcludes, parseOptions } from "./variants.ts";

export const NAME = "variant-sku-builder";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const n0 = (v: unknown, d = 0) => { const x = num(v); return Number.isFinite(x) ? x : d; };
const DEFAULT_OPTIONS = "颜色: 黑色=BK, 白色=WH, 燕麦=OT\n尺码: S, M, L, XL(+10), XXL(+20)";

async function optionsText(ws: Parameters<AppDef["load"]>[0]["ws"], files: string[], settings: Record<string, unknown>) {
  if (s(settings.options)) return { text: s(settings.options), from: "settings" };
  if (!files.length) return { text: DEFAULT_OPTIONS, from: "example" };
  const t = await readTable(ws, files[0]);
  const m = mapHeaders(t.columns, { name: ["规格名", "规格", "选项", "属性", "option", "option name", "attribute"], value: ["规格值", "值", "选项值", "value", "option value"], code: ["编码", "代码", "缩写", "code", "sku code"], delta: ["加价", "价格调整", "差价", "price +", "price delta", "surcharge"], stock: ["库存", "stock", "qty"] });
  if (!m.name || !m.value) throw new KitError("columns_not_found", `The options sheet needs option name and value columns (规格名, 规格值 / option, value). Columns: ${t.columns.join(", ")}`);
  return { text: optionsTextFromRows(t.rows.map((r) => ({ name: s(r[m.name!]), value: s(r[m.value!]), code: m.code ? s(r[m.code]) : "", delta: m.delta ? s(r[m.delta]) : "", stock: m.stock ? s(r[m.stock]) : "" }))), from: files[0] };
}

function generate(settings: Record<string, unknown>, text: string) {
  const parsed = parseOptions(text);
  const variants = parsed.error ? [] : build(parsed.options, { base: s(settings.base) || "SKU", pattern: s(settings.pattern) || "{base}-{1}-{2}-{3}", price: n0(settings.price), stock: n0(settings.stock), upper: settings.upper !== false, excludes: parseExcludes(s(settings.exclude)) });
  return { parsed, variants };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "variants",
  title: ["规格 SKU 生成", "Variant & SKU Builder"],
  openDescription:
    "Build every variant of a product from its options. Options come from settings.options (“颜色: 黑色=BK, 白色=WH; 尺码: S, M, L, XL(+10)” — value=code, (+10) or (+5%) price change, [20] stock) or from an options sheet (.xlsx/.csv with 规格名/option, 规格值/value, 编码/code, 加价/price +, 库存/stock); with no file and no options it starts from an example. Up to 3 options. SKU pattern tokens: {base}, {1} {2} {3} (option codes by position), {option name}, {n} (running number). Exclude combinations with settings.exclude (“白色+XXL; 燕麦+S”). Per-variant edits (enabled, sku, price, stock, barcode, weight) survive option and pattern changes.",
  inputs: { exts: [".xlsx", ".csv", ".tsv"], min: 0, max: 1, label: ["选择规格表（可选）", "Pick an options sheet (optional)"] },
  settings: [
    { key: "product", label: ["商品名称", "Product name"], type: "text", default: "", reload: true },
    { key: "base", label: ["SKU 前缀（款号）", "Base SKU"], type: "text", default: "TEE01", reload: true },
    { key: "pattern", label: ["SKU 模式", "SKU pattern"], type: "text", default: "{base}-{1}-{2}", reload: true, help: ["{base} 款号，{1}{2}{3} 第几个规格的编码，{颜色} 按规格名，{n} 序号", "{base}, {1}{2}{3} option codes, {option name}, {n} number"] },
    { key: "price", label: ["基础价格", "Base price"], type: "number", default: 99, min: 0, reload: true },
    { key: "stock", label: ["默认库存", "Default stock"], type: "number", default: 0, min: 0, reload: true },
    { key: "options", label: ["规格（覆盖规格表）", "Options (overrides the sheet)"], type: "textarea", default: "", reload: true, help: ["每行一个：名称: 值=编码(+加价)[库存], …", "One per line: name: value=code(+price)[stock], …"] },
    { key: "exclude", label: ["不要的组合", "Combinations to skip"], type: "textarea", default: "", reload: true, help: ["如“白色+XXL; 燕麦+S”", "e.g. “白色+XXL; 燕麦+S”"] },
    { key: "upper", label: ["SKU 大写", "Upper-case SKUs"], type: "bool", default: true, reload: true },
    { key: "currency", label: ["货币符号", "Currency symbol"], type: "text", default: "¥" },
  ],
  columns: (p) => {
    const names = ((p.meta as { optionNames?: string[] }).optionNames ?? []).slice(0, 3);
    return [
      { key: "enabled", label: ["启用", "On"], type: "bool" },
      ...names.map((n, i) => ({ key: `opt${i + 1}`, label: [n, n] as [string, string], readOnly: true })),
      { key: "sku", label: ["SKU", "SKU"] },
      { key: "name", label: ["变体名称", "Variant name"], wide: true },
      { key: "price", label: ["价格", "Price"], type: "number" },
      { key: "stock", label: ["库存", "Stock"], type: "number" },
      { key: "barcode", label: ["条码", "Barcode"] },
      { key: "weight", label: ["重量", "Weight"], type: "number" },
    ];
  },
  async load({ ws, files, settings, previous }) {
    const { text, from } = await optionsText(ws, files, settings);
    const { parsed, variants } = generate(settings, text);
    if (parsed.error) throw new KitError("bad_options", `Options: ${parsed.error}`);
    const prev = new Map((previous ?? []).map((r) => [s(r._key), r]));
    const product = s(settings.product);
    const rows: Row[] = variants.map((v) => {
      const name = [product, ...v.values].filter(Boolean).join(" ");
      const row: Row = { _key: v.key, enabled: !v.excluded, opt1: v.values[0] ?? "", opt2: v.values[1] ?? "", opt3: v.values[2] ?? "", sku: v.sku, name, price: v.price, stock: v.stock, barcode: "", weight: "", _autoSku: v.sku, _autoPrice: v.price, _autoStock: v.stock, _autoName: name, _autoEnabled: !v.excluded };
      const old = prev.get(v.key);
      if (old) {
        // 用户手动改过的保留；没改过的跟着新规则走
        if (s(old.sku) !== s(old._autoSku)) row.sku = old.sku;
        if (n0(old.price, NaN) !== n0(old._autoPrice, NaN)) row.price = old.price;
        if (n0(old.stock, NaN) !== n0(old._autoStock, NaN)) row.stock = old.stock;
        if (s(old.name) !== s(old._autoName)) row.name = old.name;
        if (old.enabled !== old._autoEnabled) row.enabled = old.enabled;
        row.barcode = old.barcode ?? ""; row.weight = old.weight ?? "";
      }
      return row;
    });
    return { rows, meta: { optionNames: parsed.options.map((o) => o.name), optionsText: text, from } };
  },
  compute(p): Computed {
    const issues: Issue[] = [];
    const cur = s(p.settings.currency) || "¥";
    const seen = new Map<string, number>();
    const on = p.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.enabled !== false);
    for (const { r, i } of on) {
      const sku = s(r.sku);
      if (!sku) issues.push({ level: "error", row: i, key: "sku", message: "Empty SKU / SKU 为空" });
      else if (seen.has(sku.toUpperCase())) issues.push({ level: "error", row: i, key: "sku", message: `SKU ${sku} is the same as row ${seen.get(sku.toUpperCase())} — give the options different codes / SKU 重复` });
      else seen.set(sku.toUpperCase(), i);
      if (/[^\x21-\x7e]/.test(sku)) issues.push({ level: "warn", row: i, key: "sku", message: `SKU “${sku}” has spaces or non-ASCII characters; most stores and scanners need A–Z, 0–9 and - _ . / SKU 含中文或空格，建议给规格值加编码` });
      if (sku.length > 40) issues.push({ level: "warn", row: i, key: "sku", message: `SKU is ${sku.length} characters; keep it under 40 / SKU 太长` });
      if (/\{[^}]*\}/.test(sku)) issues.push({ level: "error", row: i, key: "sku", message: `Unknown token in the pattern: ${sku.match(/\{[^}]*\}/)![0]} / SKU 模式里有不认识的占位符` });
      if (!(n0(r.price, NaN) > 0)) issues.push({ level: "error", row: i, key: "price", message: `Price “${s(r.price)}” must be above 0 / 价格无效` });
      if (s(r.barcode) && !/^\d{8}$|^\d{12,14}$/.test(s(r.barcode))) issues.push({ level: "warn", row: i, key: "barcode", message: `Barcode ${s(r.barcode)} is not 8, 12, 13 or 14 digits / 条码位数不对` });
    }
    const off = p.rows.length - on.length;
    if (off) issues.push({ level: "info", message: `${off} combination(s) switched off / ${off} 个组合未启用` });
    const meta = p.meta as { optionNames?: string[]; optionsText?: string };
    const prices = on.map(({ r }) => n0(r.price)).filter((x) => x > 0);
    const stock = on.reduce((a, { r }) => a + n0(r.stock), 0);
    const grid = (() => {
      const names = meta.optionNames ?? [];
      if (names.length !== 2) return "";
      const a = [...new Set(p.rows.map((r) => s(r.opt1)))], b = [...new Set(p.rows.map((r) => s(r.opt2)))];
      const cell = (x: string, y: string) => { const r = p.rows.find((q) => s(q.opt1) === x && s(q.opt2) === y); return r ? `<td style="${r.enabled === false ? "color:#9ca3af;text-decoration:line-through" : ""}"><code>${esc(s(r.sku))}</code><br><span class="muted">${esc(cur)}${esc(s(r.price))} · ${esc(s(r.stock))}</span></td>` : "<td></td>"; };
      return `<table class="data"><thead><tr><th>${esc(names[0])} \\ ${esc(names[1])}</th>${b.map((y) => `<th>${esc(y)}</th>`).join("")}</tr></thead><tbody>${a.map((x) => `<tr><th>${esc(x)}</th>${b.map((y) => cell(x, y)).join("")}</tr>`).join("")}</tbody></table>`;
    })();
    return {
      rows: p.rows,
      issues,
      summary: `${on.length} variant(s) on (of ${p.rows.length} combinations); price ${prices.length ? `${cur}${Math.min(...prices)}–${cur}${Math.max(...prices)}` : "—"}; total stock ${stock}. 启用 ${on.length} 个变体。`,
      stats: { combinations: p.rows.length, variants: on.length, minPrice: prices.length ? Math.min(...prices) : 0, maxPrice: prices.length ? Math.max(...prices) : 0, stock },
      preview: `<div style="font-size:12px"><pre style="white-space:pre-wrap;background:#f9fafb;padding:6px 8px;border-radius:6px;margin:0 0 8px">${esc(meta.optionsText ?? "")}</pre>${grid}</div>`,
    };
  },
  exports: [
    {
      id: "xlsx", label: ["变体表 Excel", "Variants (Excel)"], description: "variants.xlsx — enabled variants with SKU, options, price, stock, barcode, weight, plus the options",
      async run({ project, write, computed }: ExportCtx) {
        if ((computed.issues ?? []).some((i) => i.level === "error")) throw new KitError("has_errors", "Fix the errors first (see the issue list).");
        const names = (project.meta as { optionNames?: string[] }).optionNames ?? [];
        const on = project.rows.filter((r) => r.enabled !== false);
        const opts = parseOptions(s((project.meta as { optionsText?: string }).optionsText)).options;
        const xlsx = await writeXlsx([
          { name: "变体 Variants", headers: ["SKU", "商品 Product", ...names, "变体名称 Name", "价格 Price", "库存 Stock", "条码 Barcode", "重量 Weight"], rows: on.map((r) => [s(r.sku), s(project.settings.product), ...names.map((_, i) => s(r[`opt${i + 1}`])), s(r.name), n0(r.price), n0(r.stock), s(r.barcode), s(r.weight) === "" ? "" : n0(r.weight)]), numberFormat: { [names.length + 3]: "#,##0.00" } },
          { name: "规格 Options", headers: ["规格名 Option", "值 Value", "编码 Code", "加价 Price +", "加价% Price %", "库存 Stock"], rows: opts.flatMap((o) => o.values.map((v) => [o.name, v.value, v.code, v.delta || "", v.pct || "", v.stock ?? ""])) },
        ]);
        return [await write("variants.xlsx", xlsx)];
      },
    },
    {
      id: "csv", label: ["变体 CSV", "Variants (CSV)"], description: "variants.csv — one row per enabled variant",
      async run({ project, write }: ExportCtx) {
        const names = (project.meta as { optionNames?: string[] }).optionNames ?? [];
        const on = project.rows.filter((r) => r.enabled !== false);
        return [await write("variants.csv", toCsv(["sku", "group", "title", ...names, "name", "price", "stock", "barcode", "weight"], on.map((r) => [s(r.sku), s(project.settings.base), s(project.settings.product), ...names.map((_, i) => s(r[`opt${i + 1}`])), s(r.name), n0(r.price), n0(r.stock), s(r.barcode), s(r.weight)])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i} ${r.enabled === false ? "[off] " : ""}${s(r.sku)} · ${[s(r.opt1), s(r.opt2), s(r.opt3)].filter(Boolean).join(" / ")} · ${s(r.price)} · stock ${s(r.stock)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
