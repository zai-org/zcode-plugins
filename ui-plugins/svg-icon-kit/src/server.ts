import { createApp, esc, htmlPage, toCsv, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { KitError } from "./kit/workspace.ts";
import { cleanSvg, component, componentName, kebab, normColor, prefixIds, serialize, sprite, validName, type Cleaned, type Mode } from "./svg.ts";

export const NAME = "svg-icon-kit";
export const VERSION = "0.1.0";
const s = (v: unknown) => String(v ?? "").trim();
type Meta = { files: { path: string; text: string }[] };
const MODES = ["auto", "currentColor", "keep", "recolor"];
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

type Item = { i: number; row: Row; name: string; id: string; file: string; before: number; out?: Cleaned; svgText?: string; error?: string };

function build(p: Pick<Project, "rows" | "settings" | "meta">): Item[] {
  const meta = p.meta as Meta;
  const text = new Map(meta.files.map((f) => [f.path, f.text]));
  const prefix = s(p.settings.idPrefix);
  const precision = Math.max(0, Math.min(5, Number(p.settings.precision ?? 2)));
  return p.rows.map((row, i) => {
    const file = s(row.file), name = s(row.name);
    const src = text.get(file) ?? "";
    const it: Item = { i, row, name, id: prefix + name, file, before: Buffer.byteLength(src) };
    let mode = (s(row.mode) || "auto") as Mode;
    if (s(row.recolor) && mode === "auto") mode = "recolor";
    try {
      it.out = cleanSvg(src, { mode, recolor: s(row.recolor), precision, square: p.settings.square !== false, keepTitle: p.settings.keepTitle === true, title: name.replace(/-/g, " ") });
      it.svgText = serialize(it.out.svg) + "\n";
    } catch (e) { it.error = (e as Error).message; }
    return it;
  });
}

function check(items: Item[], settings: Record<string, unknown>) {
  const issues: Issue[] = [];
  const seen = new Map<string, number>(), comps = new Map<string, number>();
  for (const it of items) {
    if (it.error) { issues.push({ level: "error", row: it.i, message: `${it.file}: can't read SVG (${it.error}) / 无法解析` }); continue; }
    if (it.row.include === false) continue;
    if (!validName(it.name)) issues.push({ level: "error", row: it.i, key: "name", message: `${it.file}: name “${it.name}” must be lowercase letters, digits and dashes (e.g. arrow-left) / 名字只能用小写字母、数字和连字符` });
    else {
      if (seen.has(it.name)) issues.push({ level: "error", row: it.i, key: "name", message: `Name “${it.name}” is used twice (rows ${seen.get(it.name)} and ${it.i}) / 名字重复` });
      seen.set(it.name, it.i);
      const c = componentName(it.name);
      if (comps.has(c) && seen.get(it.name) === it.i) issues.push({ level: "error", row: it.i, key: "name", message: `“${it.name}” and row ${comps.get(c)} both become ${c} / 组件名重复` });
      comps.set(c, it.i);
    }
    if (s(it.row.mode) === "recolor" && !normColor(s(it.row.recolor))) issues.push({ level: "error", row: it.i, key: "recolor", message: `${it.name}: recolor needs a colour such as #2563EB / 请填写颜色` });
    else if (s(it.row.recolor) && !normColor(s(it.row.recolor))) issues.push({ level: "error", row: it.i, key: "recolor", message: `${it.name}: “${s(it.row.recolor)}” is not a colour / 颜色格式不对` });
    for (const n of it.out!.notes) if (/bitmap|fonts|assumed/.test(n)) issues.push({ level: "warn", row: it.i, message: `${it.name}: ${n}` });
    if (!it.out!.notes.some((n) => /square/.test(n)) && Math.abs(it.out!.w - it.out!.h) > 1e-6 && settings.square === false) issues.push({ level: "info", row: it.i, message: `${it.name}: viewBox is ${it.out!.w}×${it.out!.h}, not square / 非正方形` });
  }
  return issues;
}

const included = (items: Item[]) => items.filter((it) => it.row.include !== false && it.out && it.svgText);
function assertReady(items: Item[], settings: Record<string, unknown>) {
  const errs = check(items, settings).filter((i) => i.level === "error");
  if (errs.length) throw new KitError("has_errors", `Fix first: ${errs.map((e) => e.message).join("; ")}`);
  if (!included(items).length) throw new KitError("nothing", "No icons included.");
}

function previewHtml(items: Item[], color: string) {
  const cells = included(items).map((it) => {
    const sv = serialize(prefixIds(it.out!.svg, `pv${it.i}`)).replace("<svg ", `<svg width="32" height="32" `);
    return `<div style="width:96px;text-align:center;padding:8px 4px;border:1px solid #e5e7eb;border-radius:8px;background:#fff"><div style="color:${esc(color)};height:36px">${sv}</div><div style="font-size:11px;font-family:ui-monospace,monospace;word-break:break-all">${esc(it.name)}</div><div class="muted" style="font-size:10px">${it.out!.applied === "currentColor" ? "currentColor" : it.out!.applied === "recolor" ? "recolor" : "keep"} · ${kb(Buffer.byteLength(it.svgText!))}</div></div>`;
  });
  return `<div style="display:flex;flex-wrap:wrap;gap:8px">${cells.join("")}</div>`;
}

function indexHtml(items: Item[], settings: Record<string, unknown>) {
  const list = included(items);
  const spr = sprite(list.map((it) => ({ id: it.id, svg: it.out!.svg })));
  const cards = list.map((it) => `<button class="ic" data-id="${esc(it.id)}" data-comp="${esc(componentName(it.name))}" title="${esc(it.file)}"><svg><use href="#${esc(it.id)}"/></svg><span>${esc(it.name)}</span></button>`).join("\n");
  const css = `body{font-family:system-ui,sans-serif;margin:24px;color:#111}header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}.ic{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;color:var(--c,#111)}.ic:hover{border-color:#94a3b8}.ic svg{width:var(--s,32px);height:var(--s,32px)}.ic span{font:12px ui-monospace,monospace;color:#374151}#msg{color:#16a34a;font-size:13px}code{background:#f3f4f6;padding:1px 4px;border-radius:4px}`;
  const body = `${spr}<h1 style="font-size:20px">Icons · 图标 (${list.length})</h1>
<header><label>Colour 颜色 <input type="color" id="c" value="#111111"></label><label>Size 尺寸 <input type="range" id="s" min="16" max="64" value="32"></label><label><input type="checkbox" id="dark"> Dark 深色背景</label><span id="msg"></span></header>
<p style="font-size:13px;color:#555">Click an icon to copy its <code>&lt;use&gt;</code> snippet, shift-click for the React component. 点击复制 sprite 用法，按住 Shift 点击复制 React 组件名。</p>
<div class="grid">${cards}</div>
<script>
const root=document.documentElement;
document.getElementById("c").oninput=e=>root.style.setProperty("--c",e.target.value);
document.getElementById("s").oninput=e=>root.style.setProperty("--s",e.target.value+"px");
document.getElementById("dark").onchange=e=>{document.body.style.background=e.target.checked?"#111827":"";};
for(const b of document.querySelectorAll(".ic"))b.onclick=ev=>{const t=ev.shiftKey?"<"+b.dataset.comp+" size={${Number(settings.size ?? 24)}} />":'<svg width="${Number(settings.size ?? 24)}" height="${Number(settings.size ?? 24)}"><use href="sprite.svg#'+b.dataset.id+'"/></svg>';navigator.clipboard?.writeText(t);document.getElementById("msg").textContent="Copied 已复制: "+t;};
</script>`;
  return htmlPage("Icons", body, css);
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "svgkit",
  title: ["SVG 图标库整理", "SVG Icon Kit"],
  openDescription:
    "Clean up a folder of SVG icons and package them: removes editor junk (Inkscape/Sketch/Figma attributes, metadata, comments, unused ids, empty groups), unsafe content (scripts, on* handlers, foreignObject), inlines style= presentation properties, rounds numbers, adds a missing viewBox from width/height, optionally pads it to a square, and turns single-colour icons into currentColor so they follow the text colour. One row per icon: include, name (lowercase-dash, used for the sprite id and the React component Icon<Name>), mode (auto = currentColor when the icon has one colour, otherwise keep; currentColor; keep; recolor with the colour in 'recolor'), colours found, viewBox, size before → after, notes. Settings: idPrefix (sprite id prefix, default 'icon-'), size (component default size), format (tsx/jsx), precision (decimals), square, keepTitle (adds <title> from the name), previewColor. Exports optimised SVGs, sprite.svg, React components with an index, index.html preview and icons.csv.",
  inputs: { exts: [".svg"], min: 1, max: 2000, folders: true, label: ["选择 SVG 图标或文件夹", "Pick SVG icons or a folder"] },
  settings: [
    { key: "idPrefix", label: ["雪碧图 id 前缀", "Sprite id prefix"], type: "text", default: "icon-" },
    { key: "size", label: ["组件默认尺寸", "Component default size"], type: "number", default: 24, min: 8, max: 512 },
    { key: "format", label: ["组件格式", "Component format"], type: "select", default: "tsx", options: [{ value: "tsx", label: ["TypeScript（.tsx）", "TypeScript (.tsx)"] }, { value: "jsx", label: ["JavaScript（.jsx）", "JavaScript (.jsx)"] }] },
    { key: "precision", label: ["小数位数", "Decimals"], type: "number", default: 2, min: 0, max: 5 },
    { key: "square", label: ["viewBox 补成正方形", "Pad viewBox to a square"], type: "bool", default: true },
    { key: "keepTitle", label: ["加 <title>（读屏用）", "Add <title> for screen readers"], type: "bool", default: false },
    { key: "previewColor", label: ["预览颜色", "Preview colour"], type: "color", default: "#2563eb" },
  ],
  columns: () => [
    { key: "include", label: ["包含", "Include"], type: "bool" },
    { key: "file", label: ["文件", "File"], readOnly: true },
    { key: "name", label: ["名字", "Name"] },
    { key: "mode", label: ["颜色处理", "Colour"], type: "select", options: MODES },
    { key: "recolor", label: ["改成颜色", "Recolor to"] },
    { key: "colors", label: ["原有颜色", "Colours found"], readOnly: true },
    { key: "viewBox", label: ["viewBox", "viewBox"], readOnly: true },
    { key: "bytes", label: ["大小", "Size"], readOnly: true },
    { key: "notes", label: ["说明", "Notes"], readOnly: true, wide: true },
  ] as Column[],
  async load({ ws, files, previous }) {
    const list: string[] = [];
    for (const f of files) {
      if (f.toLowerCase().endsWith(".svg")) list.push(f);
      else for (const x of await ws.list({ dir: f, exts: [".svg"], limit: 5000 })) list.push(x.path);
    }
    const uniq = [...new Set(list)].filter((f) => f.replace(/^\.?\/+/, "").split("/")[0] !== NAME).sort((a, b) => a.localeCompare(b, "en"));
    if (!uniq.length) throw new KitError("no_files", "No .svg files found.");
    const meta: Meta = { files: [] };
    const prev = new Map((previous ?? []).map((r) => [s(r.file), r]));
    const rows: Row[] = [];
    const used = new Set<string>();
    for (const f of uniq) {
      meta.files.push({ path: f, text: (await ws.read(f, 5 * 1024 * 1024)).toString("utf8") });
      let name = kebab(f) || `icon-${rows.length + 1}`;
      for (let k = 2; used.has(name); k++) name = `${kebab(f) || "icon"}-${k}`;
      used.add(name);
      const o = prev.get(f);
      rows.push(o ? { include: o.include, file: f, name: o.name, mode: o.mode, recolor: o.recolor } : { include: true, file: f, name, mode: "auto", recolor: "" });
    }
    return { rows, meta };
  },
  compute(p): Computed {
    const items = build(p);
    const issues = check(items, p.settings);
    const inc = included(items);
    const before = inc.reduce((a, it) => a + it.before, 0), after = inc.reduce((a, it) => a + Buffer.byteLength(it.svgText!), 0);
    const cc = inc.filter((it) => it.out!.applied === "currentColor").length;
    const rows = items.map((it) => ({
      ...it.row,
      colors: it.out ? it.out.colors.join(" ") || "—" : "",
      viewBox: it.out?.viewBox ?? "",
      bytes: it.out ? `${kb(it.before)} → ${kb(Buffer.byteLength(it.svgText!))}` : "",
      notes: it.out ? [it.out.applied === "currentColor" ? "→ currentColor" : it.out.applied === "recolor" ? `→ ${s(it.row.recolor)}` : "colours kept", ...it.out.notes, ...(it.out.removed.length ? [`removed ${it.out.removed.join(", ")}`] : [])].join("; ") : it.error ?? "",
    }));
    const saved = before ? Math.round((1 - after / before) * 100) : 0;
    return {
      rows,
      issues,
      summary: `${inc.length} icon(s): ${kb(before)} → ${kb(after)} (−${saved}%), ${cc} follow currentColor. ${inc.length} 个图标，体积减少 ${saved}%，${cc} 个改为 currentColor。`,
      stats: { icons: inc.length, before, after, savedPercent: saved, currentColor: cc, kept: inc.filter((it) => it.out!.applied === "keep").length },
      preview: previewHtml(items, s(p.settings.previewColor) || "#2563eb"),
    };
  },
  exports: [
    {
      id: "svg", label: ["优化后的 SVG", "Optimised SVGs"], description: "optimized/<name>.svg — one cleaned file per icon",
      async run({ project, write }: ExportCtx) {
        const items = build(project); assertReady(items, project.settings);
        const out: string[] = [];
        for (const it of included(items)) out.push(await write(`optimized/${it.name}.svg`, it.svgText!));
        return out;
      },
    },
    {
      id: "sprite", label: ["雪碧图", "Sprite"], description: "sprite.svg — all icons as <symbol id=\"<prefix><name>\">, use with <svg><use href=\"sprite.svg#icon-name\"/></svg>",
      async run({ project, write }: ExportCtx) {
        const items = build(project); assertReady(items, project.settings);
        return [await write("sprite.svg", sprite(included(items).map((it) => ({ id: it.id, svg: it.out!.svg }))))];
      },
    },
    {
      id: "react", label: ["React 组件", "React components"], description: "components/Icon<Name>.tsx (or .jsx) and components/index — each accepts size and any SVG props",
      async run({ project, write }: ExportCtx) {
        const items = build(project); assertReady(items, project.settings);
        const ts = s(project.settings.format) !== "jsx", ext = ts ? "tsx" : "jsx", size = Number(project.settings.size ?? 24) || 24;
        const out: string[] = [];
        const list = included(items);
        for (const it of list) out.push(await write(`components/${componentName(it.name)}.${ext}`, component(it.name, it.out!.svg, ts, size)));
        out.push(await write(`components/index.${ts ? "ts" : "js"}`, list.map((it) => `export { ${componentName(it.name)} } from "./${componentName(it.name)}${ts ? "" : ".jsx"}";`).join("\n") + "\n"));
        return out;
      },
    },
    {
      id: "preview", label: ["预览页", "Preview page"], description: "index.html — every icon with colour/size controls; click copies the snippet",
      async run({ project, write }: ExportCtx) {
        const items = build(project); assertReady(items, project.settings);
        return [await write("index.html", indexHtml(items, project.settings))];
      },
    },
    {
      id: "csv", label: ["清单 CSV", "List (CSV)"], description: "icons.csv — name, sprite id, component, file, colour mode, viewBox, bytes before/after, notes",
      async run({ project, write }: ExportCtx) {
        const items = build(project);
        return [await write("icons.csv", toCsv(["name", "sprite_id", "component", "file", "colour", "viewBox", "bytes_before", "bytes_after", "notes"], included(items).map((it) => [it.name, it.id, componentName(it.name), it.file, it.out!.applied, it.out!.viewBox, it.before, Buffer.byteLength(it.svgText!), it.out!.notes.join("; ")])))];
      },
    },
  ],
  describeRow: (r, i) => `#${i}${r.include === false ? " [excluded]" : ""} ${s(r.name)} (${s(r.file)}) mode=${s(r.mode)}${s(r.recolor) ? ` recolor=${s(r.recolor)}` : ""} ${s(r.colors)} ${s(r.bytes)}`,
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
