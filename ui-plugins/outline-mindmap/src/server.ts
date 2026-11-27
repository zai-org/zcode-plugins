import { createApp, esc, type AppDef, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { layoutMap, parseOutline, toTree, type MNode } from "./outline.ts";
import { svgToPng } from "./png.ts";
import { s } from "./util.ts";

export const NAME = "outline-mindmap";
export const VERSION = "0.1.0";
const PALETTES: Record<string, string[]> = { bright: ["#2563eb", "#f97316", "#16a34a", "#db2777", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"], calm: ["#4f46e5", "#0d9488", "#b45309", "#be185d", "#4d7c0f", "#0369a1"], mono: ["#334155"] };
const xmlEsc = (x: string) => esc(x);

function treeOf(p: Project) {
  const items = p.rows.filter((r) => r.include !== false && s(r.text)).map((r) => ({ level: Math.max(0, Math.round(Number(r.level) || 0)), text: s(r.text) }));
  if (!items.length || items[0].level !== 0) items.unshift({ level: 0, text: s(p.settings.title) || p.name });
  for (let i = 1; i < items.length; i++) items[i].level = Math.max(1, Math.min(items[i].level, items[i - 1].level + 1));
  const palette = PALETTES[s(p.settings.palette)] ?? PALETTES.bright;
  const root = toTree(items, palette);
  const cols = p.rows.filter((r) => r.include !== false && s(r.text) && Number(r.level) === 1).map((r) => s(r.color));
  const paint = (n: MNode, c: string) => { n.color = c; n.kids.forEach((k) => paint(k, c)); };
  root.kids.forEach((k, i) => { if (cols[i] && /^#?[0-9a-f]{3,8}$|^[a-z]+$/i.test(cols[i])) paint(k, cols[i].startsWith("#") || /^[a-z]+$/i.test(cols[i]) ? cols[i] : `#${cols[i]}`); });
  return { root, items };
}

export function mapSvg(p: Project, family?: string) {
  const { root } = treeOf(p);
  const H = layoutMap(root, { both: s(p.settings.layout) !== "right", gapY: 10, gapX: 46 });
  const all: MNode[] = [];
  const walk = (n: MNode) => { all.push(n); n.kids.forEach(walk); };
  walk(root);
  const left = Math.min(-root.w / 2, ...all.map((n) => (n.side === -1 ? n.x - n.w : n.x))), right = Math.max(root.w / 2, ...all.map((n) => (n.side === -1 ? n.x : n.x + n.w)));
  const pad = 30, W = right - left + pad * 2, HH = H + pad * 2, ox = pad - left, oy = pad;
  const parts: string[] = [];
  const edge = (a: MNode, b: MNode) => {
    const ax = a.level === 0 ? (b.side === 1 ? a.w / 2 : -a.w / 2) : b.side === 1 ? a.x + a.w : a.x - a.w;
    const ay = a.level <= 1 ? a.y : a.y + a.h / 2 - 2, bx = b.x, by = b.level <= 1 ? b.y : b.y + b.h / 2 - 2;
    const mx = (ax + bx) / 2;
    parts.push(`<path d="M${ox + ax} ${oy + ay}C${ox + mx} ${oy + ay} ${ox + mx} ${oy + by} ${ox + bx} ${oy + by}" fill="none" stroke="${b.color}" stroke-width="${Math.max(1.2, 4 - b.level)}" stroke-linecap="round"/>`);
  };
  for (const n of all) for (const k of n.kids) edge(n, k);
  for (const n of all) {
    if (n.level === 0) { parts.push(`<rect x="${ox - n.w / 2}" y="${oy + n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.h / 2}" fill="#111827"/><text x="${ox}" y="${oy + n.y + 7}" font-size="20" font-weight="700" text-anchor="middle" fill="#fff">${xmlEsc(n.text)}</text>`); continue; }
    const x0 = n.side === 1 ? n.x : n.x - n.w;
    if (n.level === 1) parts.push(`<rect x="${ox + x0}" y="${oy + n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="10" fill="${n.color}"/><text x="${ox + x0 + n.w / 2}" y="${oy + n.y + 5}" font-size="15" font-weight="700" text-anchor="middle" fill="#fff">${xmlEsc(n.text)}</text>`);
    else parts.push(`<text x="${ox + x0 + (n.side === 1 ? 4 : n.w - 4)}" y="${oy + n.y + 3}" font-size="13" text-anchor="${n.side === 1 ? "start" : "end"}" fill="#1f2937">${xmlEsc(n.text)}</text><path d="M${ox + x0} ${oy + n.y + n.h / 2 - 2}h${n.w}" stroke="${n.color}" stroke-width="${Math.max(1.2, 4 - n.level)}"/>`);
  }
  const font = family ? ` font-family="${esc(family)}"` : ` font-family="sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(HH)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(HH)}"${font}><rect width="100%" height="100%" fill="${s(p.settings.background) || "#ffffff"}"/>${parts.join("")}</svg>`;
}

function opml(root: MNode, title: string) {
  const o = (n: MNode, d: number): string => `${"  ".repeat(d)}<outline text="${xmlEsc(n.text)}"${n.kids.length ? `>\n${n.kids.map((k) => o(k, d + 1)).join("")}${"  ".repeat(d)}</outline>\n` : "/>\n"}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>${xmlEsc(title)}</title></head>\n<body>\n${o(root, 1)}</body>\n</opml>\n`;
}
function freemind(root: MNode) {
  let id = 0;
  const o = (n: MNode, d: number): string => `${"  ".repeat(d)}<node ID="ID_${++id}" TEXT="${xmlEsc(n.text)}"${n.level === 1 ? ` COLOR="${n.color}" POSITION="${n.side === 1 ? "right" : "left"}"` : ""}${n.kids.length ? `>\n${n.kids.map((k) => o(k, d + 1)).join("")}${"  ".repeat(d)}</node>\n` : "/>\n"}`;
  return `<map version="1.0.1">\n${o(root, 0)}</map>\n`;
}
const markdown = (root: MNode) => { const out = [`# ${root.text}`, ""]; const w = (n: MNode) => { if (n.level === 1) out.push("", `## ${n.text}`); else out.push(`${"  ".repeat(n.level - 2)}- ${n.text}`); n.kids.forEach(w); }; root.kids.forEach(w); return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n"; };

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "mindmap",
    title: ["大纲转思维导图", "Outline Mind Map"],
    openDescription:
      "Turn a Markdown outline (headings and nested bullet lists), an indented text file or an OPML file into a mind map. Each row is one node with its level (0 = central topic, 1 = main branch, 2+ = sub-topics) in outline order; change text or level, untick nodes to hide them, add nodes at the end, or recolour a main branch (color on a level-1 row). Layout: branches on both sides or all on the right. Exports SVG and PNG images plus OPML, FreeMind (.mm) and a cleaned-up Markdown outline.",
    inputs: { exts: [".md", ".markdown", ".txt", ".opml"], min: 0, max: 1, label: ["选择大纲（Markdown / 文本 / OPML）", "Pick an outline (Markdown, text or OPML)"] },
    settings: [
      { key: "title", label: ["中心主题（没有时用）", "Central topic (if the outline has none)"], type: "text", default: "" },
      { key: "layout", label: ["布局", "Layout"], type: "select", default: "both", options: [{ value: "both", label: ["左右展开", "Both sides"] }, { value: "right", label: ["向右展开", "Right only"] }] },
      { key: "palette", label: ["配色", "Colours"], type: "select", default: "bright", options: [{ value: "bright", label: ["鲜艳", "Bright"] }, { value: "calm", label: ["沉稳", "Calm"] }, { value: "mono", label: ["单色", "Mono"] }] },
      { key: "background", label: ["背景色", "Background"], type: "color", default: "#ffffff" },
    ],
    columns: () => [
      { key: "include", label: ["显示", "Show"], type: "bool" },
      { key: "level", label: ["层级", "Level"], type: "number" },
      { key: "text", label: ["内容", "Text"], wide: true },
      { key: "color", label: ["分支颜色", "Branch colour"] },
    ],
    newRow: () => ({ include: true, level: 1, text: "", color: "" }),
    async load({ ws, files }) {
      if (!files.length) return { rows: [{ include: true, level: 0, text: "中心主题", color: "" }] };
      const stem = files[0].split("/").pop()!.replace(/\.[^.]+$/, "");
      const items = parseOutline(await ws.readText(files[0]), stem);
      if (items.length < 2) throw new KitError("empty_outline", "The file has no headings or list items to turn into branches.");
      return { rows: items.map((x) => ({ include: true, level: x.level, text: x.text, color: "" })) };
    },
    compute(p): Computed {
      const { items } = treeOf(p);
      const issues: Issue[] = [];
      p.rows.forEach((r, i) => { if (r.include !== false && !s(r.text)) issues.push({ level: "warn", row: i, key: "text", message: "Empty node — it is left out." }); if (s(r.color) && Number(r.level) !== 1) issues.push({ level: "info", row: i, key: "color", message: "Colours apply to main branches (level 1) only." }); });
      for (const it of items) if ([...it.text].length > 40) issues.push({ level: "info", message: `Long node text (${[...it.text].length} characters): “${it.text.slice(0, 20)}…” — consider shortening.` });
      const branches = items.filter((x) => x.level === 1).length, depth = Math.max(...items.map((x) => x.level));
      return { summary: `${items.length} node(s): ${branches} main branch(es), ${depth} level(s) deep, central topic “${items[0].text}”.`, stats: { nodes: items.length, branches, depth }, issues, preview: mapSvg(p).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `) };
    },
    exports: [
      { id: "svg", label: ["导图 SVG", "Mind map (SVG)"], description: "mindmap.svg", async run({ project, write }: ExportCtx) { return [await write("mindmap.svg", mapSvg(project))]; } },
      {
        id: "png", label: ["导图 PNG", "Mind map (PNG)"], description: "mindmap.png (2× resolution)",
        async run({ project, write }: ExportCtx) {
          const { fontsFor } = await import("./png.ts");
          const f = await fontsFor(assetRoot, "OUTLINE_MINDMAP_FONT");
          const svg = mapSvg(project, f.family);
          return [await write("mindmap.png", await svgToPng(assetRoot, svg, Math.min(8000, Number(/width="(\d+)/.exec(svg)![1]) * 2), "OUTLINE_MINDMAP_FONT"))];
        },
      },
      { id: "opml", label: ["OPML", "OPML"], description: "mindmap.opml — for outliners and mind-map apps", async run({ project, write }: ExportCtx) { const { root } = treeOf(project); layoutMap(root, { both: s(project.settings.layout) !== "right", gapY: 10, gapX: 46 }); return [await write("mindmap.opml", opml(root, root.text))]; } },
      { id: "mm", label: ["FreeMind .mm", "FreeMind (.mm)"], description: "mindmap.mm — opens in FreeMind, Freeplane, XMind import", async run({ project, write }: ExportCtx) { const { root } = treeOf(project); layoutMap(root, { both: s(project.settings.layout) !== "right", gapY: 10, gapX: 46 }); return [await write("mindmap.mm", freemind(root))]; } },
      { id: "md", label: ["Markdown 大纲", "Markdown outline"], description: "outline.md — cleaned-up outline", async run({ project, write }: ExportCtx) { return [await write("outline.md", markdown(treeOf(project).root))]; } },
    ],
    describeRow: (r, i) => `#${i}${r.include === false ? " [hidden]" : ""} ${"  ".repeat(Math.max(0, Number(r.level) || 0))}L${s(r.level)} ${s(r.text)}${s(r.color) ? ` (${s(r.color)})` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
