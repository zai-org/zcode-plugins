import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { escapeXml, renderSvg, type FontSet } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";
import { findSecrets, highlight, langFor, LANG_NAMES, parseRanges, THEMES, type Tok } from "./highlight.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "code-snippet-image";
export const VERSION = "0.1.0";
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".cs", ".sql", ".sh", ".css", ".scss", ".html", ".xml", ".vue", ".json", ".yaml", ".yml", ".toml", ".md", ".txt"];
const FONT_ENV = "CODE_IMAGE_FONT";
const MONO: [string, string][] = [["/System/Library/Fonts/Menlo.ttc", "Menlo"], ["/System/Library/Fonts/SFNSMono.ttf", "SF Mono"], ["C:\\Windows\\Fonts\\consola.ttf", "Consolas"], ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "DejaVu Sans Mono"], ["/usr/share/fonts/dejavu/DejaVuSansMono.ttf", "DejaVu Sans Mono"]];
const BGS: Record<string, [string, string] | undefined> = { sunset: ["#f97316", "#db2777"], ocean: ["#0ea5e9", "#6366f1"], grape: ["#8b5cf6", "#ec4899"], mint: ["#10b981", "#06b6d4"], slate: ["#334155", "#0f172a"], none: undefined };

let mono: Promise<{ family: string; buf?: Uint8Array }> | undefined;
function monoFont() {
  mono ??= (async () => { for (const [p, fam] of MONO) if (existsSync(p)) return { family: fam, buf: new Uint8Array(await readFile(p)) }; return { family: "monospace" }; })();
  return mono;
}
async function fonts(assetRoot: string) {
  const f = await fontsFor(assetRoot, FONT_ENV), m = await monoFont();
  return { f: { ...f, buffers: m.buf ? [m.buf, ...f.buffers] : f.buffers } as FontSet, mono: m.family };
}

const wide = (ch: string) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch);
const cols = (t: string) => [...t].reduce((a, c) => a + (wide(c) ? 2 : 1), 0);
const MASK = (line: string) => line
  .replace(/\b(sk-|gh[pousr]_|xox[abpr]-|AKIA)([A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g, (_m, a, b) => `${a}${b}${"•".repeat(8)}`)
  .replace(/((?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'])([^"']{6,})(["'])/gi, (_m, a, _b, c) => `${a}${"•".repeat(8)}${c}`)
  .replace(/(:\/\/[^/\s:@]+:)([^/\s@]{3,})@/g, (_m, a) => `${a}${"•".repeat(6)}@`)
  .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "eyJ••••••••");

interface Snip { row: number; r: Row; lines: string[]; first: number; lang: string; hl: Set<number>; title: string }

function snippet(p: Project, r: Row, i: number): Snip | { error: string } {
  const text = ((p.meta.texts as Record<string, string>) ?? {})[s(r.file)];
  if (text === undefined) return { error: `File ${s(r.file)} is not one of the opened files.` };
  const all = text.replace(/\r/g, "").replace(/\n+$/, "").split("\n");
  const from = Number(r.from) || 1, to = Number(r.to) || all.length;
  if (from < 1 || from > all.length) return { error: `From line ${from} is outside the file (1–${all.length}).` };
  if (to < from) return { error: `To line ${to} is before from line ${from}.` };
  const tab = " ".repeat(Number(p.settings.tabSize) || 2);
  let lines = all.slice(from - 1, Math.min(to, all.length)).map((l) => l.replace(/\t/g, tab));
  if (yes(p.settings.dedent ?? true)) {
    const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
    if (Number.isFinite(ind) && ind > 0) lines = lines.map((l) => l.slice(ind));
  }
  if (yes(p.settings.redact)) lines = lines.map(MASK);
  const hl = parseRanges(s(r.highlight)) ?? new Set<number>();
  const lang = s(r.lang) && s(r.lang) !== "auto" ? s(r.lang) : langFor(s(r.file));
  return { row: i, r, lines, first: from, lang, hl, title: s(r.title) || s(r.file).split("/").pop()! };
}

/** 一张代码图的 SVG。 */
function snippetSvg(p: Project, sn: Snip, monoFam: string, f: FontSet) {
  const th = THEMES[s(p.settings.theme)] ?? THEMES["github-dark"], size = Number(p.settings.fontSize) || 16, cw = size * 0.6, lh = Math.round(size * 1.6);
  const maxCols = Math.max(20, Number(p.settings.maxColumns) || 100), nums = yes(p.settings.lineNumbers ?? true);
  // 折行：长行按显示宽度切开，续行不显示行号。
  const toks = highlight(sn.lines.join("\n"), sn.lang);
  const vis: { n?: number; toks: Tok[]; hl: boolean }[] = [];
  toks.forEach((line, k) => {
    const n = sn.first + k, hl = sn.hl.has(n);
    let cur: Tok[] = [], w = 0, first = true;
    for (const t of line) for (const ch of [...t.t]) {
      const cwid = wide(ch) ? 2 : 1;
      if (w + cwid > maxCols) { vis.push({ n: first ? n : undefined, toks: cur, hl }); cur = []; w = 0; first = false; }
      const last = cur[cur.length - 1];
      if (last && last.k === t.k) last.t += ch; else cur.push({ t: ch, k: t.k });
      w += cwid;
    }
    vis.push({ n: first ? n : undefined, toks: cur, hl });
  });
  const widest = Math.max(20, ...vis.map((v) => v.toks.reduce((a, t) => a + cols(t.t), 0)));
  const gw = nums ? Math.ceil(String(sn.first + sn.lines.length).length * cw + size * 1.4) : 0;
  const frame = s(p.settings.frame) || "mac", barH = frame === "none" ? 0 : Math.round(size * 2.4), padIn = Math.round(size * 1.2);
  const cardW = Math.round(gw + widest * cw + padIn * 2), cardH = Math.round(barH + vis.length * lh + padIn * 2 - (barH ? size * 0.4 : 0));
  const bgk = s(p.settings.background) || "ocean", grad = BGS[bgk], pad = grad ? Math.round(Number(p.settings.padding ?? 48)) : 0;
  const W = cardW + pad * 2, H = cardH + pad * 2, fam = `${escapeXml(monoFam)}, ${escapeXml(f.family)}`;
  const parts: string[] = [];
  if (grad) parts.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${grad[0]}"/><stop offset="1" stop-color="${grad[1]}"/></linearGradient><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="${size * 0.6}" stdDeviation="${size * 1.1}" flood-color="#000" flood-opacity="0.35"/></filter></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  parts.push(`<rect x="${pad}" y="${pad}" width="${cardW}" height="${cardH}" rx="${frame === "none" ? 6 : 12}" fill="${th.bg}"${grad ? ' filter="url(#sh)"' : ""}/>`);
  if (barH) {
    if (frame === "mac") ["#ff5f57", "#febc2e", "#28c840"].forEach((c, k) => parts.push(`<circle cx="${pad + padIn + k * size * 1.25}" cy="${pad + barH / 2}" r="${size * 0.38}" fill="${c}"/>`));
    parts.push(`<text x="${pad + cardW / 2}" y="${pad + barH / 2 + size * 0.32}" font-family="${fam}" font-size="${Math.round(size * 0.85)}" fill="${th.gutter}" text-anchor="middle">${escapeXml(sn.title)}</text>`);
  }
  const y0 = pad + barH + padIn - (barH ? size * 0.4 : 0), x0 = pad + padIn + gw;
  vis.forEach((v, k) => {
    const y = y0 + k * lh;
    if (v.hl) parts.push(`<rect x="${pad}" y="${y}" width="${cardW}" height="${lh}" fill="${th.hl}"/>`);
    if (nums) parts.push(`<text x="${x0 - size * 0.9}" y="${y + lh * 0.7}" font-family="${fam}" font-size="${size}" fill="${th.gutter}" text-anchor="end">${v.n ?? "↪"}</text>`);
    let x = x0;
    const spans = v.toks.map((t) => { const sp = `<tspan x="${x.toFixed(1)}" fill="${th.c[t.k]}"${t.k === "comment" ? ' font-style="italic"' : ""}>${escapeXml(t.t)}</tspan>`; x += cols(t.t) * cw; return sp; }).join("");
    if (spans) parts.push(`<text y="${(y + lh * 0.7).toFixed(1)}" font-family="${fam}" font-size="${size}" xml:space="preserve">${spans}</text>`);
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`, W, H, wrapped: vis.length - sn.lines.length };
}

const outName = (sn: Snip, all: Snip[]) => {
  const b = s(sn.r.file).split("/").pop()!.replace(/\./g, "_");
  const same = all.filter((x) => s(x.r.file) === s(sn.r.file)).length > 1 || Number(sn.r.from) || Number(sn.r.to);
  return same ? `${b}-L${sn.first}-${sn.first + sn.lines.length - 1}` : b;
};

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "codeimg",
    title: ["代码截图美化", "Code Snippet Image"],
    openDescription:
      "Render code snippets as clean, shareable images. Pick one or more source files. Each row is one image: include, file, from/to (line range, blank = whole file), highlight (lines to highlight, e.g. \"3,5-7\" — original line numbers), title (window title, blank = file name), lang (auto or one of ts/py/go/rs/java/c/sql/sh/css/html/json/yaml/plain). Add rows to cut several snippets from one file. Settings: theme (github-dark, github-light, dracula, monokai, nord, solarized-light), fontSize, lineNumbers, frame (mac/plain/none), background (ocean/sunset/grape/mint/slate gradient, or none), padding, maxColumns (wrap longer lines), tabSize, dedent, redact (mask detected secrets), scale (PNG pixel ratio). Checks: API keys, tokens, private keys, passwords and URLs with credentials in the snippet; bad line ranges or highlight specs; very long snippets; wrapped lines. Exports one PNG (and SVG) per row.",
    inputs: { exts: EXTS, min: 1, max: 30, label: ["选择代码文件", "Pick code files"] },
    settings: [
      { key: "theme", label: ["主题", "Theme"], type: "select", default: "github-dark", options: Object.keys(THEMES).map((t) => ({ value: t, label: [t, t] as [string, string] })) },
      { key: "background", label: ["背景", "Background"], type: "select", default: "ocean", options: [["ocean", "海蓝渐变", "Ocean"], ["sunset", "日落渐变", "Sunset"], ["grape", "葡萄紫渐变", "Grape"], ["mint", "薄荷渐变", "Mint"], ["slate", "深灰", "Slate"], ["none", "无（只要代码窗口）", "None"]].map(([v, z, e]) => ({ value: v, label: [z, e] as [string, string] })) },
      { key: "frame", label: ["窗口样式", "Window frame"], type: "select", default: "mac", options: [["mac", "macOS 窗口", "macOS window"], ["plain", "只有标题栏", "Title bar only"], ["none", "无", "None"]].map(([v, z, e]) => ({ value: v, label: [z, e] as [string, string] })) },
      { key: "fontSize", label: ["字号", "Font size"], type: "number", default: 16, min: 8, max: 40 },
      { key: "lineNumbers", label: ["显示行号", "Line numbers"], type: "bool", default: true },
      { key: "maxColumns", label: ["每行最多字符（超出折行）", "Wrap at column"], type: "number", default: 100, min: 20, max: 300 },
      { key: "padding", label: ["背景留白（像素）", "Background padding (px)"], type: "number", default: 48, min: 0, max: 300 },
      { key: "tabSize", label: ["Tab 宽度", "Tab size"], type: "number", default: 2, min: 1, max: 8 },
      { key: "dedent", label: ["去掉公共缩进", "Remove common indent"], type: "bool", default: true },
      { key: "redact", label: ["遮住密钥 / 密码", "Mask secrets"], type: "bool", default: false },
      { key: "scale", label: ["PNG 倍率", "PNG scale"], type: "number", default: 2, min: 1, max: 4 },
    ],
    columns: () => [
      { key: "include", label: ["导出", "Export"], type: "bool" },
      { key: "file", label: ["文件", "File"] },
      { key: "from", label: ["起始行", "From line"], type: "number" },
      { key: "to", label: ["结束行", "To line"], type: "number" },
      { key: "highlight", label: ["高亮行", "Highlight lines"] },
      { key: "title", label: ["标题", "Title"] },
      { key: "lang", label: ["语言", "Language"], type: "select", options: ["auto", ...LANG_NAMES] },
      { key: "_lines", label: ["行数", "Lines"], readOnly: true },
    ] as Column[],
    newRow: (p) => ({ include: true, file: s(p.inputs[0]), from: "", to: "", highlight: "", title: "", lang: "auto" }),
    async load({ ws, files, previous }) {
      const texts: Record<string, string> = {};
      for (const f of files) {
        const t = await ws.readText(f);
        if (t.includes("\u0000")) throw new KitError("binary", `${f} looks like a binary file.`);
        texts[f] = t;
      }
      const rows: Row[] = previous?.length ? previous.filter((r) => texts[s(r.file)] !== undefined) : files.map((f) => ({ include: true, file: f, from: "", to: "", highlight: "", title: "", lang: "auto" }));
      return { rows, meta: { texts } };
    },
    async compute(p): Promise<Computed> {
      const issues: Issue[] = [];
      const { f, mono: fam } = await fonts(assetRoot);
      const ok: Snip[] = [];
      const out = p.rows.map((r, i) => {
        const sn = snippet(p, r, i);
        if ("error" in sn) { issues.push({ level: "error", row: i, key: /line/.test(sn.error) ? (/To line/.test(sn.error) ? "to" : "from") : "file", message: sn.error }); return { ...r, _lines: "" }; }
        if (s(r.highlight) && !parseRanges(s(r.highlight))) issues.push({ level: "error", row: i, key: "highlight", message: `Highlight “${s(r.highlight)}” is not a line list (use e.g. 3,5-7).` });
        else for (const n of sn.hl) if (n < sn.first || n >= sn.first + sn.lines.length) { issues.push({ level: "warn", row: i, key: "highlight", message: `Highlighted line ${n} is outside this snippet (lines ${sn.first}–${sn.first + sn.lines.length - 1}).` }); break; }
        if (s(r.lang) && s(r.lang) !== "auto" && !LANG_NAMES.includes(s(r.lang))) issues.push({ level: "error", row: i, key: "lang", message: `Unknown language “${s(r.lang)}”.` });
        if (yes(r.include)) {
          const raw = ((p.meta.texts as Record<string, string>)[s(r.file)] ?? "").replace(/\r/g, "").split("\n");
          const from = Number(r.from) || 1, to = Math.min(Number(r.to) || raw.length, raw.length);
          for (let n = from; n <= to; n++) {
            const what = findSecrets(raw[n - 1] ?? "");
            if (what.length) issues.push({ level: yes(p.settings.redact) ? "info" : "warn", row: i, key: "file", message: yes(p.settings.redact) ? `Line ${n} contains ${what.join(", ")} — masked in the image.` : `Line ${n} of ${s(r.file).split("/").pop()} looks like it contains ${what.join(", ")}. Don't share it as-is: turn on “Mask secrets” (redact) or cut the line out.` });
          }
          if (sn.lines.length > 60) issues.push({ level: "warn", row: i, key: "to", message: `${sn.lines.length} lines makes a very tall image; set from/to to the part you want to show.` });
          const g = snippetSvg(p, sn, fam, f);
          if (g.wrapped > 0) issues.push({ level: "info", row: i, key: "file", message: `${g.wrapped} long line(s) wrap at ${Number(p.settings.maxColumns) || 100} columns.` });
          ok.push(sn);
        }
        return { ...r, _lines: `${sn.first}–${sn.first + sn.lines.length - 1}` };
      });
      const prev = ok.slice(0, 3).map((sn) => snippetSvg(p, sn, fam, f).svg.replace("<svg ", '<svg style="max-width:100%;height:auto;margin:0 0 12px" ')).join("");
      return {
        rows: out,
        issues,
        summary: `${ok.length} snippet image(s) from ${Object.keys((p.meta.texts as object) ?? {}).length} file(s), theme ${s(p.settings.theme) || "github-dark"}${yes(p.settings.redact) ? ", secrets masked" : ""}.`,
        stats: { images: ok.length, lines: ok.reduce((a, x) => a + x.lines.length, 0) },
        preview: prev,
      };
    },
    exports: [
      { id: "png", label: ["PNG 图片", "PNG images"], description: "<file>.png per row (and .svg)", async run(ctx: ExportCtx) {
        const p = ctx.project, { f, mono: fam } = await fonts(ctx.assetRoot), files: string[] = [];
        const all = p.rows.map((r, i) => snippet(p, r, i)).filter((x): x is Snip => !("error" in x) && yes(x.r.include));
        for (const sn of all) {
          const g = snippetSvg(p, sn, fam, f), name = outName(sn, all), scale = Math.max(1, Math.min(4, Number(p.settings.scale) || 2));
          files.push(await ctx.write(`${name}.png`, (await renderSvg(g.svg, f, g.W * scale)).png));
          files.push(await ctx.write(`${name}.svg`, g.svg));
        }
        return files;
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${s(r.file)} lines ${s(r.from) || 1}–${s(r.to) || "end"}${s(r.highlight) ? ` hl ${s(r.highlight)}` : ""}${s(r.title) ? ` “${s(r.title)}”` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
