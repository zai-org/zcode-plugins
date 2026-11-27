import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project } from "./kit/app.ts";
import { readTable } from "./kit/table.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { KitError } from "./kit/workspace.ts";
import { chartHtml, chartSvg, EN, fmtCell, isPlain, isWeight, parseCell, ZH, type ChartSpec } from "./chart.ts";
import { fontsFor, svgToPng } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "size-chart-maker";
export const VERSION = "0.1.0";

const measuresOf = (p: Project) => ((p.meta.measures as string[] | undefined) ?? []);
const label = (name: string, lang: string) => (lang === "en" ? EN[name] ?? name : lang === "zh" ? ZH[name.toLowerCase()] ?? name : EN[name] && EN[name] !== name ? `${name} ${EN[name]}` : name);

function spec(p: Project, family?: string): ChartSpec {
  const ms = measuresOf(p), lang = s(p.settings.lang) || "zh";
  const from = (s(p.settings.inputUnit) || "cm") as "cm" | "in", show = (s(p.settings.unit) || "cm") as "cm" | "in" | "both";
  const unitTxt = show === "both" ? "cm / inch" : show === "in" ? "inch" : "cm";
  const rows = p.rows.filter((r) => r.include !== false && s(r.size));
  const sizeHead = lang === "en" ? "Size" : lang === "zh" ? "尺码" : "尺码 Size";
  return {
    title: s(p.settings.title),
    note: s(p.settings.note) || (lang === "en" ? `Unit: ${unitTxt}. Measured flat by hand; allow 1–3 cm difference.` : `单位：${unitTxt}。平铺手工测量，存在 1-3cm 误差属正常。`),
    headers: [sizeHead, ...ms.map((m) => label(m, lang))],
    rows: rows.map((r) => [s(r.size), ...ms.map((m, i) => fmtCell(s(r[`m${i}`]), m, from, show, Number(p.settings.decimals ?? 1)))]),
    hi: rows.map((r) => yes(r.highlight)),
    style: s(p.settings.style) || "clean",
    accent: s(p.settings.accent) || "#111827",
    family,
  };
}

async function png(p: Project, assetRoot: string) {
  const f = await fontsFor(assetRoot, "SIZE_CHART_FONT");
  const svg = chartSvg(spec(p, f.family));
  return svgToPng(assetRoot, svg, Number(/width="(\d+)/.exec(svg)![1]) * 2, "SIZE_CHART_FONT");
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "sizechart",
    title: ["尺码表制作", "Size Chart Maker"],
    openDescription:
      "Turn a measurement sheet (CSV/XLSX: first column the size — S/M/L, 160/84A, 36… — then one column per measurement such as 胸围/衣长/肩宽/袖长, numbers or ranges like 88-92) into a size-chart image for product pages. Rows are sizes; columns are the measurements named after the file's headers (edit with the header name as key). Untick a size to hide it, tick highlight to mark the best-seller/recommended size. Shows cm, inches or both (converted from the input unit), headers in Chinese, English or both, three styles. Errors: values that are not numbers; warnings: measurements that do not grow with size. Exports PNG, SVG, an HTML table to paste into a shop page and a cleaned XLSX.",
    inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 0, max: 1, label: ["选择尺寸表", "Pick the measurement sheet"] },
    settings: [
      { key: "title", label: ["标题", "Title"], type: "text", default: "尺码表" },
      { key: "inputUnit", label: ["表格里的单位", "Unit in the sheet"], type: "select", default: "cm", options: [{ value: "cm", label: ["厘米", "cm"] }, { value: "in", label: ["英寸", "inch"] }] },
      { key: "unit", label: ["显示单位", "Show"], type: "select", default: "cm", options: [{ value: "cm", label: ["厘米", "cm"] }, { value: "in", label: ["英寸", "inch"] }, { value: "both", label: ["厘米 + 英寸", "cm + inch"] }] },
      { key: "decimals", label: ["英寸小数位", "Inch decimals"], type: "number", default: 1, min: 0, max: 2 },
      { key: "lang", label: ["表头语言", "Header language"], type: "select", default: "zh", options: [{ value: "zh", label: ["中文", "Chinese"] }, { value: "en", label: ["英文", "English"] }, { value: "both", label: ["中英", "Both"] }] },
      { key: "style", label: ["样式", "Style"], type: "select", default: "clean", options: [{ value: "clean", label: ["简洁", "Clean"] }, { value: "bold", label: ["醒目", "Bold"] }, { value: "boutique", label: ["精品", "Boutique"] }] },
      { key: "accent", label: ["主色", "Accent colour"], type: "color", default: "#111827" },
      { key: "note", label: ["底部说明（留空用默认）", "Footnote (blank = default)"], type: "text", default: "" },
    ],
    columns: (p) => [
      { key: "include", label: ["显示", "Show"], type: "bool" },
      { key: "size", label: ["尺码", "Size"] },
      ...measuresOf(p).map((m, i): Column => ({ key: `m${i}`, label: [m, EN[m] ?? m] })),
      { key: "highlight", label: ["高亮", "Highlight"], type: "bool" },
    ],
    newRow: (p) => ({ include: true, size: "", highlight: false, ...Object.fromEntries(measuresOf(p).map((_, i) => [`m${i}`, ""])) }),
    async load({ ws, files }) {
      if (!files.length) {
        const measures = ["胸围", "衣长", "肩宽", "袖长"];
        return { rows: ["S", "M", "L"].map((size) => ({ include: true, size, highlight: false, m0: "", m1: "", m2: "", m3: "" })), meta: { measures } };
      }
      const t = await readTable(ws, files[0]);
      if (t.columns.length < 2) throw new KitError("no_measures", "Need a size column followed by at least one measurement column.");
      const [sizeCol, ...ms] = t.columns;
      const measures = ms.filter((c) => t.rows.some((r) => s(r[c])));
      return { rows: t.rows.filter((r) => s(r[sizeCol])).map((r) => ({ include: true, size: s(r[sizeCol]), highlight: false, ...Object.fromEntries(measures.map((m, i) => [`m${i}`, s(r[m])])) })), meta: { measures } };
    },
    compute(p): Computed {
      const ms = measuresOf(p), issues: Issue[] = [];
      const shown = p.rows.map((r, i) => ({ r, i })).filter((x) => x.r.include !== false && s(x.r.size));
      const seen = new Map<string, number>();
      for (const { r, i } of shown) {
        const k = s(r.size).toUpperCase();
        if (seen.has(k)) issues.push({ level: "error", row: i, key: "size", message: `Size “${s(r.size)}” appears twice (rows ${seen.get(k)} and ${i}).` });
        seen.set(k, i);
        ms.forEach((m, j) => {
          const v = s(r[`m${j}`]);
          if (!v) issues.push({ level: "warn", row: i, key: `m${j}`, message: `${s(r.size)}: ${m} is empty.` });
          else if (!isWeight(m) && !isPlain(m) && parseCell(v) === null) issues.push({ level: "error", row: i, key: `m${j}`, message: `${s(r.size)}: ${m} “${v}” is not a number or range (e.g. 98 or 88-92).` });
        });
      }
      ms.forEach((m, j) => {
        if (isWeight(m) || isPlain(m)) return;
        let prev: { v: number; size: string } | null = null;
        for (const { r, i } of shown) {
          const n = parseCell(s(r[`m${j}`]));
          if (!n || !n.length) continue;
          if (prev && n[0] < prev.v) issues.push({ level: "warn", row: i, key: `m${j}`, message: `${m} gets smaller from ${prev.size} (${prev.v}) to ${s(r.size)} (${n[0]}) — check for a typo.` });
          prev = { v: n[0], size: s(r.size) };
        }
      });
      const sp = spec(p);
      return { issues, summary: `${shown.length} size(s) × ${ms.length} measurement(s): ${ms.join(", ")}; showing ${s(p.settings.unit) || "cm"}.`, stats: { sizes: shown.length, measures: ms.length, highlighted: sp.hi.filter(Boolean).length }, preview: chartSvg(sp).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `) };
    },
    exports: [
      { id: "png", label: ["尺码表 PNG", "Chart (PNG)"], description: "size-chart.png (2× for product pages)", async run({ project, write }: ExportCtx) { return [await write("size-chart.png", await png(project, assetRoot))]; } },
      { id: "svg", label: ["尺码表 SVG", "Chart (SVG)"], description: "size-chart.svg", async run({ project, write }: ExportCtx) { return [await write("size-chart.svg", chartSvg(spec(project)))]; } },
      { id: "html", label: ["HTML 表格", "HTML table"], description: "size-chart.html — a styled <table> to paste into a shop page", async run({ project, write }: ExportCtx) { return [await write("size-chart.html", chartHtml(spec(project)))]; } },
      {
        id: "xlsx", label: ["整理后的表格", "Clean XLSX"], description: "size-chart.xlsx — the converted values",
        async run({ project, write }: ExportCtx) {
          const sp = spec(project);
          return [await write("size-chart.xlsx", await writeXlsx([{ name: "Size chart", headers: sp.headers, rows: sp.rows, marks: sp.hi.flatMap((h, row) => (h ? [{ row, col: 0, color: "FFF3C4" }] : [])) }]))];
        },
      },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [hidden]" : ""}${yes(r.highlight) ? " [highlight]" : ""} ${s(r.size)}: ${Object.keys(r).filter((k) => /^m\d+$/.test(k)).map((k) => s(r[k])).join(" | ")}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
