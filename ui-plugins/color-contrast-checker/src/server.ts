import { createApp, esc, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { blend, contrast, nearestPassing, parseColor, required, toHex, type RGB, type RGBA } from "./wcag.ts";
import { guessPairs, parseCss, parseJson, resolveAll, type Decl, type Parsed } from "./tokens.ts";

export const NAME = "color-contrast-checker";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
const EXTS = [".css", ".scss", ".less", ".json"];
type Meta = { files: { path: string; text: string }[] };

function parseAll(meta: Meta): Parsed {
  const out: Parsed = { decls: [], rules: [] };
  for (const f of meta.files) {
    const p = /\.json$/i.test(f.path) ? parseJson(f.path, f.text) : parseCss(f.path, f.text);
    out.decls.push(...p.decls); out.rules.push(...p.rules);
  }
  return out;
}
const declKey = (d: Decl) => `${d.file}|${d.scope}|${d.name}`;
const usageFor = (fg: string) => (/border|outline|icon|divider|focus|ring/i.test(fg) ? "ui" : /heading|title|display|hero/i.test(fg) ? "large" : "normal");
const fmtRatio = (r: number) => `${(Math.floor(r * 100) / 100).toFixed(2)}:1`;

type Eval = { fg: RGBA | null; bg: RGBA | null; fgDecl: Decl | null; bgDecl: Decl | null };
/** 某一行在给定改动（decl → 新颜色）下的颜色 */
function evalRow(r: Row, parsed: Parsed, patch: Map<string, RGB>): Eval {
  const { resolveExpr } = resolveAll(parsed.decls);
  const scope = s(r.scope) || ":root";
  const one = (expr: string) => {
    const x = resolveExpr(scope, expr);
    const k = x.origin ? declKey(x.origin) : "";
    const c = k && patch.has(k) ? ([...patch.get(k)!, x.color?.[3] ?? 1] as RGBA) : x.color;
    return { c, d: x.origin };
  };
  const f = one(s(r._fgExpr) || s(r.fg)), b = one(s(r._bgExpr) || s(r.bg));
  return { fg: f.c, bg: b.c, fgDecl: f.d, bgDecl: b.d };
}
function ratioOf(e: Eval) {
  if (!e.fg || !e.bg) return null;
  const bg: RGB = e.bg[3] < 1 ? blend(e.bg, [255, 255, 255]) : [e.bg[0], e.bg[1], e.bg[2]];
  const fg: RGB = e.fg[3] < 1 ? blend(e.fg, bg) : [e.fg[0], e.fg[1], e.fg[2]];
  return { ratio: contrast(fg, bg), fg, bg };
}

/** 所有接受的修正：每个变量只改一次，冲突时取改动最大（最严格）的那个 */
function fixes(p: Pick<Project, "rows" | "settings" | "meta">, parsed: Parsed) {
  const level = s(p.settings.level) || "AA";
  const patch = new Map<string, RGB>(), why = new Map<string, number>();
  // 按要求从高到低处理，先满足最严格的
  const order = p.rows.map((r, i) => ({ r, i })).sort((a, b) => required(s(b.r.usage), level) - required(s(a.r.usage), level));
  for (let pass = 0; pass < 3; pass++) for (const { r, i } of order) {
    const side = s(r.fix);
    if (side !== "fg" && side !== "bg") continue;
    const e = evalRow(r, parsed, patch), x = ratioOf(e);
    if (!x) continue;
    const need = required(s(r.usage), level);
    if (x.ratio >= need) continue;
    const decl = side === "fg" ? e.fgDecl : e.bgDecl;
    if (!decl) continue;
    const manual = parseColor(s(r.custom));
    const next = manual ? ([manual[0], manual[1], manual[2]] as RGB) : nearestPassing(side === "fg" ? x.fg : x.bg, side === "fg" ? x.bg : x.fg, need + 0.005);
    if (!next) continue;
    patch.set(declKey(decl), next); why.set(declKey(decl), i);
  }
  return { patch, why };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "contrast",
  title: ["配色无障碍检查", "Contrast Checker"],
  openDescription:
    "Check colour pairs in design tokens against WCAG 2 contrast and fix the ones that fail. Reads CSS/SCSS/LESS (custom properties --x, $x, @x, and rules that set both color and background) and JSON tokens (nested or W3C $value), resolving var()/{ref} chains and theme scopes like .dark. Pairs come from CSS rules, from names (button-text ↔ button-bg, on-primary ↔ primary, every text colour on the main background) and from settings.pairs (lines 'fg on bg [large|ui]'). Settings: level (AA/AAA), pairs, auto (use guessed pairs). Each pair is a row: usage (normal 4.5, large 3, ui 3 for AA; AAA 7/4.5), ratio, result, fix (none / fg / bg — which token to change), custom (your own replacement colour) and the suggestion (nearest passing colour, same hue, only lightness changed). Fixes are applied to the variable that really holds the colour; every pair is re-checked with all fixes. Exports fixed copies of the token files, contrast-report.md and contrast-report.csv.",
  inputs: { exts: EXTS, min: 1, max: 50, folders: true, label: ["选择样式或令牌文件（CSS / SCSS / JSON）", "Pick token files (CSS / SCSS / JSON)"] },
  settings: [
    { key: "level", label: ["标准", "Level"], type: "select", default: "AA", reload: false, options: [{ value: "AA", label: ["AA（常用）", "AA (common)"] }, { value: "AAA", label: ["AAA（更严格）", "AAA (strict)"] }] },
    { key: "pairs", label: ["要检查的组合（每行 文字色 on 背景色 [large|ui]）", "Pairs (one 'fg on bg [large|ui]' per line)"], type: "textarea", default: "", reload: true },
    { key: "auto", label: ["自动按名字和 CSS 规则找组合", "Find pairs from names and CSS rules"], type: "bool", default: true, reload: true },
  ],
  columns: () => [
    { key: "scope", label: ["作用域", "Scope"], readOnly: true },
    { key: "fg", label: ["文字/前景", "Foreground"], readOnly: true },
    { key: "bg", label: ["背景", "Background"], readOnly: true },
    { key: "usage", label: ["用途", "Usage"], type: "select", options: ["normal", "large", "ui"] },
    { key: "ratio", label: ["对比度", "Ratio"], readOnly: true },
    { key: "result", label: ["结果", "Result"], readOnly: true },
    { key: "fix", label: ["修正", "Fix"], type: "select", options: ["none", "fg", "bg"] },
    { key: "custom", label: ["自定颜色", "Custom colour"] },
    { key: "after", label: ["修正后", "After fixes"], readOnly: true },
    { key: "source", label: ["来源", "From"], readOnly: true },
  ] as Column[],
  async load({ ws, files, settings, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (EXTS.some((e) => f.toLowerCase().endsWith(e))) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: EXTS, limit: 500 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME && !/package(-lock)?\.json$|tsconfig/i.test(f)).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", "No CSS/SCSS/LESS/JSON files found.");
    const meta: Meta = { files: [] };
    for (const f of uniq) meta.files.push({ path: f, text: (await ws.read(f, 10 * 1024 * 1024)).toString("utf8") });
    let parsed: Parsed;
    try { parsed = parseAll(meta); } catch (e) { throw new KitError("bad_file", (e as Error).message); }
    if (!parsed.decls.length && !parsed.rules.length) throw new KitError("no_colors", "No colour variables or color/background rules found.");
    const { resolveExpr } = resolveAll(parsed.decls);
    const rows: Row[] = [];
    const seen = new Set<string>();
    const add = (scope: string, fg: string, bg: string, source: string, usage?: string, fgExpr?: string, bgExpr?: string) => {
      const k = `${scope}|${fg}|${bg}`;
      if (seen.has(k)) return;
      if (!resolveExpr(scope, fgExpr ?? fg).color || !resolveExpr(scope, bgExpr ?? bg).color) return;
      seen.add(k);
      rows.push({ scope, fg, bg, usage: usage ?? usageFor(fg), fix: "", custom: "", source, _fgExpr: fgExpr ?? "", _bgExpr: bgExpr ?? "" });
    };
    const ref = (n: string) => (n.startsWith("--") ? `var(${n})` : n.includes(".") && !n.startsWith("$") && !n.startsWith("@") ? `{${n}}` : n);
    const scopes = [...new Set(parsed.decls.map((d) => d.scope))];
    // 手写的组合
    for (const line of String(settings.pairs ?? "").split(/\r?\n/)) {
      const m = line.trim().match(/^(\S+)\s+(?:on|\/|vs|on\s+top\s+of)\s+(\S+)(?:\s+(normal|large|ui))?$/i);
      if (!m) continue;
      for (const sc of scopes.length ? scopes : [":root"]) add(sc, m[1], m[2], "manual 手写", m[3]?.toLowerCase(), ref(m[1]), ref(m[2]));
    }
    if (settings.auto !== false) {
      for (const r of parsed.rules) add(r.scope, r.fg, r.bg, `rule ${r.selector}`, usageFor(r.selector + r.fg), r.fg, r.bg);
      for (const sc of scopes) {
        // JSON 令牌和 CSS 变量分开配对；CSS 主题作用域继承 :root
        const names = [...new Set(parsed.decls.filter((d) => (sc === "tokens" ? d.scope === "tokens" : d.scope === sc || d.scope === ":root")).map((d) => d.name))];
        // 非 root 作用域只检查它改写过的变量涉及的组合
        const own = new Set(parsed.decls.filter((d) => d.scope === sc).map((d) => d.name));
        for (const [f, b] of guessPairs(names)) if (sc === ":root" || sc === "tokens" || own.has(f) || own.has(b)) add(sc, f, b, "name 按名字", undefined, ref(f), ref(b));
      }
    }
    const prev = new Map((previous ?? []).map((r) => [`${s(r.scope)}|${s(r.fg)}|${s(r.bg)}`, r]));
    for (const r of rows) { const o = prev.get(`${s(r.scope)}|${s(r.fg)}|${s(r.bg)}`); if (o) { r.usage = o.usage; r.fix = o.fix; r.custom = o.custom; } }
    // 默认：不达标的行建议改前景色
    for (const r of rows) if (!s(r.fix)) {
      const x = ratioOf(evalRow(r, parsed, new Map()));
      r.fix = x && x.ratio < required(s(r.usage), "AA") ? (/(^|[-._])on[-._]|button-text|btn-text/i.test(s(r.fg)) ? "bg" : "fg") : "none";
    }
    return { rows, meta };
  },
  compute(p): Computed {
    const meta = p.meta as Meta;
    const parsed = parseAll(meta);
    const level = s(p.settings.level) || "AA";
    const issues: Issue[] = [];
    const { patch } = fixes(p, parsed);
    let fail = 0, failAfter = 0;
    const swatches: string[] = [];
    const rows = p.rows.map((r, i) => {
      const need = required(s(r.usage), level);
      const e0 = evalRow(r, parsed, new Map()), x0 = ratioOf(e0), x1 = ratioOf(evalRow(r, parsed, patch));
      if (!x0 || !x1) { issues.push({ level: "warn", row: i, message: `${s(r.fg)} on ${s(r.bg)}: colour can't be resolved / 颜色无法解析` }); return { ...r, ratio: "", result: "?", after: "" }; }
      const ok0 = x0.ratio >= need, ok1 = x1.ratio >= need;
      if (!ok0) fail++;
      if (!ok1) failAfter++;
      if (s(r.custom) && !parseColor(s(r.custom))) issues.push({ level: "error", row: i, key: "custom", message: `Row ${i}: “${s(r.custom)}” is not a colour (#RRGGBB, rgb(), hsl()) / 颜色格式不对` });
      if (!ok1 && !ok0 && (s(r.fix) === "none" || !s(r.fix))) issues.push({ level: "warn", row: i, key: "fix", message: `${s(r.scope)} ${s(r.fg)} on ${s(r.bg)} is ${fmtRatio(x0.ratio)}, needs ${need}:1 for ${level} ${s(r.usage)} — choose fg or bg to fix / 对比度不足` });
      else if (!ok1 && !(s(r.fix) === "fg" ? e0.fgDecl : e0.bgDecl)) issues.push({ level: "warn", row: i, key: "fix", message: `${s(r.scope)} ${s(r.fix) === "fg" ? s(r.fg) : s(r.bg)} is written directly in ${s(r.source).replace(/^rule /, "")}, not in a variable, so it can't be patched — edit it by hand, use a custom colour on the other side, or switch fix to ${s(r.fix) === "fg" ? "bg" : "fg"} / 该颜色直接写在规则里，无法自动修改` });
      else if (!ok1) issues.push({ level: "warn", row: i, key: "fix", message: `${s(r.fg)} on ${s(r.bg)} ${ok0 ? "passes now but fails" : "still fails"} after fixes (${fmtRatio(x1.ratio)}) — another pair (often another theme) uses the same colour; fix the other side or give that theme its own value / 修正后仍不达标（同一颜色被其他组合或主题使用）` });
      const changed = toHex(x1.fg) !== toHex(x0.fg) || toHex(x1.bg) !== toHex(x0.bg);
      if (swatches.length < 14) swatches.push(`<tr><td style="padding:2px 6px;font-size:11px" class="muted">${esc(s(r.fg))}<br>on ${esc(s(r.bg))}</td><td style="background:${toHex(x0.bg)};color:${toHex(x0.fg)};padding:4px 8px;font-weight:600">Aa 文字 ${fmtRatio(x0.ratio)}</td><td style="padding:2px 4px">${changed ? "→" : ""}</td><td style="${changed ? `background:${toHex(x1.bg)};color:${toHex(x1.fg)};` : ""}padding:4px 8px;font-weight:600">${changed ? `Aa 文字 ${fmtRatio(x1.ratio)}` : ""}</td><td>${ok1 ? "✅" : "❌"}</td></tr>`);
      return {
        ...r,
        ratio: fmtRatio(x0.ratio),
        result: ok0 ? `✓ ${level}` : `✗ < ${need}:1`,
        after: changed ? `${toHex(x1.fg)} / ${toHex(x1.bg)} → ${fmtRatio(x1.ratio)} ${ok1 ? "✓" : "✗"}` : ok0 ? "" : "（未修正）",
      };
    });
    const changes = [...patch.keys()].length;
    if (!p.rows.length) issues.push({ level: "info", message: "No colour pairs found — add lines to settings.pairs like “--text on --bg” / 没有找到颜色组合，请在 pairs 里手写" });
    return {
      rows,
      issues,
      summary: `${p.rows.length} pair(s) checked against WCAG ${level}: ${fail} fail now, ${failAfter} after ${changes} colour change(s). 共 ${p.rows.length} 组，${fail} 组不达标，修正后剩 ${failAfter} 组。`,
      stats: { pairs: p.rows.length, failing: fail, afterFixes: failAfter, colorChanges: changes },
      preview: `<table style="border-collapse:collapse;font-size:13px">${swatches.join("")}</table>`,
    };
  },
  exports: [
    {
      id: "tokens", label: ["修正后的令牌文件", "Fixed token files"], description: "fixed/<path> — copies of the token files with the accepted colour fixes written in",
      async run({ project, write }: ExportCtx) {
        const meta = project.meta as Meta, parsed = parseAll(meta);
        const bad = project.rows.find((r) => s(r.custom) && !parseColor(s(r.custom)));
        if (bad) throw new KitError("bad_colour", `“${s(bad.custom)}” is not a colour.`);
        const { patch } = fixes(project, parsed);
        if (!patch.size) throw new KitError("nothing", "No fixes to write — every pair passes or no row has fix = fg/bg.");
        const out: string[] = [];
        for (const f of meta.files) {
          const edits = parsed.decls.filter((d) => d.file === f.path && patch.has(declKey(d)) && d.start >= 0);
          if (!edits.length) continue;
          let text = f.text;
          for (const d of edits.sort((a, b) => b.start - a.start)) {
            const old = parseColor(d.raw);
            const hex = toHex(patch.get(declKey(d))!);
            const alpha = old && old[3] < 1 ? Math.round(old[3] * 255).toString(16).padStart(2, "0") : "";
            const keepUpper = /^#[0-9A-F]+$/.test(d.raw);
            const v = (hex + alpha)[keepUpper ? "toUpperCase" : "toLowerCase"]();
            text = text.slice(0, d.start) + v + text.slice(d.end);
          }
          out.push(await write(`fixed/${f.path.replace(/^\.?\/*/, "")}`, text));
        }
        return out;
      },
    },
    {
      id: "report", label: ["检查报告", "Report"], description: "contrast-report.md and contrast-report.csv — every pair with ratio, result, fix and the colour changes",
      async run({ project, write, computed }: ExportCtx) {
        const meta = project.meta as Meta, parsed = parseAll(meta), level = s(project.settings.level) || "AA";
        const { patch } = fixes(project, parsed);
        const rows = computed.rows ?? project.rows;
        const byKey = new Map(parsed.decls.map((d) => [declKey(d), d]));
        const md = [
          `# Contrast report — WCAG ${level}`, "", computed.summary, "",
          "| Scope | Foreground | Background | Usage | Ratio | Result | After fixes |", "|---|---|---|---|---|---|---|",
          ...rows.map((r) => `| ${s(r.scope)} | \`${s(r.fg)}\` | \`${s(r.bg)}\` | ${s(r.usage)} | ${s(r.ratio)} | ${s(r.result)} | ${s(r.after)} |`),
          "", "## Colour changes 修改的颜色", "",
          ...(patch.size ? [...patch].map(([k, c]) => { const d = byKey.get(k)!; return `- \`${d.name}\` (${d.scope}, ${d.file}): ${d.raw} → **${toHex(c)}**`; }) : ["- none"]),
          "",
        ].join("\n");
        return [
          await write("contrast-report.md", md),
          await write("contrast-report.csv", toCsv(["scope", "foreground", "background", "usage", "ratio", "result", "fix", "after", "from"], rows.map((r) => [s(r.scope), s(r.fg), s(r.bg), s(r.usage), s(r.ratio), s(r.result), s(r.fix), s(r.after), s(r.source)]))),
        ];
      },
    },
  ],
  describeRow: (r, i) => `#${i} [${s(r.scope)}] ${s(r.fg)} on ${s(r.bg)} (${s(r.usage)}) ${s(r.ratio)} ${s(r.result)} fix=${s(r.fix) || "none"}${s(r.custom) ? ` custom ${s(r.custom)}` : ""} ${s(r.after)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
