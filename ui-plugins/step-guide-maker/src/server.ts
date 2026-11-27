import { createHash } from "node:crypto";
import { createApp, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { MM, newPdf, PAGE } from "./kit/pdf.ts";
import { decodeImage, encodePng, resize, type Raster } from "./kit/raster.ts";
import { escapeXml, renderSvg } from "./kit/render.ts";
import { KitError, type Workspace } from "./kit/workspace.ts";
import { changedRegion, crop, parseRects, parseSteps, pixelate, rectOk, type Rect } from "./guide.ts";
import { fontsFor } from "./png.ts";
import { s, yes } from "./util.ts";

export const NAME = "step-guide-maker";
export const VERSION = "0.1.0";
const IMG = [".png", ".jpg", ".jpeg"];
const TXT = [".md", ".txt", ".markdown"];
const has = (f: string, e: string[]) => e.some((x) => f.toLowerCase().endsWith(x));
const base = (f: string) => f.split("/").pop()!;

interface Meta { title?: string; stepsFile?: string; stepCount?: number; hashes?: Record<string, string>; sizes?: Record<string, [number, number]>; auto?: Record<string, string>; whole?: Record<string, boolean>; bad?: Record<string, string> }

const imgCache = new Map<string, { key: string; img: Raster }>();
async function loadImg(ws: Workspace, f: string): Promise<Raster> {
  const key = `${await ws.size(f)}:${(await ws.mtime(f)).getTime()}`, hit = imgCache.get(f);
  if (hit?.key === key) return hit.img;
  const img = decodeImage(new Uint8Array(await ws.read(f, 100 * 1024 * 1024)), f);
  imgCache.set(f, { key, img });
  return img;
}
const copyRaster = (r: Raster): Raster => ({ width: r.width, height: r.height, data: new Uint8ClampedArray(r.data) });
const fmtRect = (r: Rect) => r.join(",");

/** 这一行最终用的框：手填优先；留空且开了自动框时用“和上一张相比变化的区域”。 */
function boxesFor(p: Project, r: Row): { rects: Rect[]; auto: boolean } {
  const v = s(r.box);
  if (v) return { rects: parseRects(v) ?? [], auto: false };
  const a = s((p.meta as Meta).auto?.[s(r.file)]);
  return yes(p.settings.autoBox ?? true) && a ? { rects: parseRects(a) ?? [], auto: true } : { rects: [], auto: false };
}

/** 标注后的截图（PNG）。 */
async function annotate(ws: Workspace, assetRoot: string, p: Project, r: Row, n: number) {
  const src = await loadImg(ws, s(r.file)), img = copyRaster(src);
  for (const b of parseRects(s(r.blur)) ?? []) pixelate(img, b);
  let view = img, off = { x: 0, y: 0 };
  const c = (parseRects(s(r.crop)) ?? [])[0];
  if (c) { view = crop(img, c); off = { x: (c[0] / 100) * img.width, y: (c[1] / 100) * img.height }; }
  const maxW = Math.max(320, Math.min(2400, Number(p.settings.width) || 1000));
  const k = Math.min(1, maxW / view.width), W = Math.round(view.width * k), H = Math.round(view.height * k);
  const shown = k < 1 ? resize(view, W, H) : view;
  const color = /^#[0-9a-f]{6}$/i.test(s(p.settings.color)) ? s(p.settings.color) : "#ef4444";
  const sw = Math.max(3, Math.round(W / 260)), parts: string[] = [];
  const { rects } = boxesFor(p, r);
  rects.forEach((b, i) => {
    const x = ((b[0] / 100) * img.width - off.x) * k, y = ((b[1] / 100) * img.height - off.y) * k, w = (b[2] / 100) * img.width * k, h = (b[3] / 100) * img.height * k;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${sw * 2}" fill="none" stroke="${color}" stroke-width="${sw}"/>`);
    if (yes(p.settings.badges ?? true) && i === 0) {
      const R = Math.max(14, Math.round(W / 55)), cx = Math.max(R + 2, Math.min(W - R - 2, x)), cy = Math.max(R + 2, Math.min(H - R - 2, y));
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}" stroke="#fff" stroke-width="${Math.max(2, sw / 1.5)}"/><text x="${cx}" y="${cy + R * 0.38}" font-size="${R * 1.1}" font-weight="bold" fill="#fff" text-anchor="middle">${n}</text>`);
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image width="${W}" height="${H}" xlink:href="data:image/png;base64,${encodePng(shown).toString("base64")}"/>${parts.join("")}</svg>`;
  const fonts = await fontsFor(assetRoot);
  return { png: (await renderSvg(svg, fonts, W)).png, W, H };
}

const used = (p: Project) => p.rows.filter((r) => yes(r.include) && !(p.meta as Meta).bad?.[s(r.file)]);
const guideTitle = (p: Project) => s(p.settings.title) || s((p.meta as Meta).title) || p.name;

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "steps",
    title: ["步骤教程生成", "Step Guide Maker"],
    openDescription:
      "Turn a folder of screenshots into a step-by-step guide (HTML, Markdown + images, PDF). Pick the folder (screenshots .png/.jpg, sorted by file name, plus an optional steps file .md/.txt). In the steps file each step starts with a `## title`, `1.` or `第1步` line, followed by its text; optional lines `框: x,y,w,h` (highlight box), `打码: x,y,w,h` (pixelate) and `裁剪: x,y,w,h` (crop) — all in percent of the screenshot, several separated by `;`. Steps are matched to screenshots in order. Each row is one step: include, file, title, text, box (blank = automatic: the area that changed since the previous screenshot; `none` = no box), blur, crop. Settings: title, intro, width (image width px), color (box colour), autoBox, badges (step number on the box), page (A4/Letter). Checks: duplicate screenshots, step text vs screenshot count, steps without a title, bad or out-of-range boxes, login-looking steps with nothing blurred, tiny screenshots. Exports guide.html (self-contained), guide.md + images/, guide.pdf.",
    inputs: { exts: [...IMG, ...TXT], min: 1, max: 300, folders: true, label: ["选择截图文件夹（可附步骤说明 .md）", "Pick the screenshots folder (optional steps .md)"] },
    settings: [
      { key: "title", label: ["教程标题（留空=步骤文件里的 # 标题）", "Guide title"], type: "text", default: "" },
      { key: "intro", label: ["开头说明", "Intro"], type: "text", default: "" },
      { key: "width", label: ["图片宽度（像素）", "Image width (px)"], type: "number", default: 1000, min: 320, max: 2400 },
      { key: "color", label: ["框的颜色", "Box colour"], type: "color", default: "#ef4444" },
      { key: "autoBox", label: ["没填框时自动框出变化的区域", "Auto box: what changed since the previous shot"], type: "bool", default: true },
      { key: "badges", label: ["框上显示步骤号", "Step number on the box"], type: "bool", default: true },
      { key: "page", label: ["PDF 纸张", "PDF page"], type: "select", default: "A4", options: [{ value: "A4", label: ["A4", "A4"] }, { value: "Letter", label: ["Letter", "Letter"] }] },
    ],
    columns: () => [
      { key: "include", label: ["导出", "Export"], type: "bool" },
      { key: "file", label: ["截图", "Screenshot"], readOnly: true },
      { key: "title", label: ["步骤标题", "Step title"] },
      { key: "text", label: ["说明", "Text"] },
      { key: "box", label: ["框 x,y,w,h %", "Box x,y,w,h %"] },
      { key: "blur", label: ["打码 x,y,w,h %", "Blur x,y,w,h %"] },
      { key: "crop", label: ["裁剪 x,y,w,h %", "Crop x,y,w,h %"] },
      { key: "_auto", label: ["自动框", "Auto box"], readOnly: true },
    ] as Column[],
    async load({ ws, files, previous }) {
      const imgs: string[] = [], txts: string[] = [];
      for (const f of files) {
        if (has(f, IMG)) imgs.push(f); else if (has(f, TXT)) txts.push(f);
        else for (const x of await ws.list({ dir: f, exts: [...IMG, ...TXT], limit: 2000 })) (has(x.path, IMG) ? imgs : txts).push(x.path);
      }
      // “xxx copy.png / xxx 副本.png / xxx (1).png” 排在原图后面
      const COPY = /( copy( \d+)?| 副本( ?\d+)?| \(\d+\))(?=\.[^.]+$)/i;
      const key = (f: string) => [f.replace(COPY, ""), COPY.test(f) ? 1 : 0] as const;
      const list = [...new Set(imgs)].filter((f) => !f.startsWith(NAME + "/")).sort((a, b) => { const x = key(a), y = key(b); return x[0] === y[0] ? x[1] - y[1] : x[0].localeCompare(y[0], "en", { numeric: true }); });
      if (!list.length) throw new KitError("no_images", "No screenshots found (.png/.jpg).");
      const stepsFile = txts.filter((f) => !f.startsWith(NAME + "/") && !/readme|license/i.test(base(f)))[0];
      const parsed = stepsFile ? parseSteps(await ws.readText(stepsFile)) : { title: "", steps: [] };
      const hashes: Record<string, string> = {}, sizes: Record<string, [number, number]> = {}, auto: Record<string, string> = {}, whole: Record<string, boolean> = {}, bad: Record<string, string> = {};
      const ok: { f: string; img: Raster }[] = [];
      for (const f of list) {
        hashes[f] = createHash("md5").update(await ws.read(f, 100 * 1024 * 1024)).digest("hex");
        try {
          const img = await loadImg(ws, f);
          sizes[f] = [img.width, img.height];
          // 和前两张里更像的那张比（弹窗关掉后回到列表时更准）
          const cands = ok.slice(-2).filter((x) => hashes[x.f] !== hashes[f]).map((x) => changedRegion(x.img, img));
          const best = cands.filter((c) => c.rect).sort((a, b) => a.rect![2] * a.rect![3] - b.rect![2] * b.rect![3])[0];
          if (best?.rect) auto[f] = fmtRect(best.rect); else if (cands.length) whole[f] = cands.some((c) => c.share > 0);
          ok.push({ f, img });
        } catch (e) { bad[f] = (e as Error).message; }
      }
      const rows: Row[] = list.map((f, i) => {
        const prev = previous?.find((r) => s(r.file) === f);
        if (prev) return prev;
        const st = parsed.steps[i];
        return { include: true, file: f, title: st?.title ?? "", text: st?.text ?? "", box: st?.box ?? "", blur: st?.blur ?? "", crop: st?.crop ?? "" };
      });
      return { rows, meta: { title: parsed.title, stepsFile: stepsFile ?? "", stepCount: parsed.steps.length, hashes, sizes, auto, whole, bad } satisfies Meta };
    },
    compute(p): Computed {
      const m = p.meta as Meta, issues: Issue[] = [];
      const seen = new Map<string, number>();
      let n = 0, boxes = 0;
      const rows = p.rows.map((r, i) => {
        const f = s(r.file);
        if (m.bad?.[f]) { issues.push({ level: "error", row: i, key: "file", message: `${base(f)} could not be read: ${m.bad[f]}` }); return { ...r, _auto: "" }; }
        if (!yes(r.include)) return { ...r, _auto: s(m.auto?.[f]) };
        n++;
        const h = m.hashes?.[f];
        if (h && seen.has(h)) issues.push({ level: "warn", row: i, key: "include", message: `${base(f)} is identical to step ${seen.get(h)} (${base(s(p.rows.find((x) => m.hashes?.[s(x.file)] === h)?.file))}). Turn it off unless you mean to repeat it.` });
        else if (h) seen.set(h, n);
        for (const k of ["box", "blur", "crop"] as const) {
          const v = s(r[k]);
          if (!v || /^(none|无)$/i.test(v)) continue;
          const rs = parseRects(v);
          if (!rs) issues.push({ level: "error", row: i, key: k, message: `${k} “${v}” is not x,y,w,h in percent (e.g. 10,20,30,8; several separated by ;).` });
          else if (rs.some((x) => !rectOk(x))) issues.push({ level: "error", row: i, key: k, message: `${k} “${v}” goes outside the screenshot (x+w and y+h must be ≤ 100).` });
          else if (k === "crop" && rs.length > 1) issues.push({ level: "error", row: i, key: k, message: "Only one crop area per step." });
        }
        if (!s(r.title)) issues.push({ level: "warn", row: i, key: "title", message: `Step ${n} (${base(f)}) has no title.` });
        const b = boxesFor(p, r);
        if (b.rects.length) boxes++;
        if (b.auto) issues.push({ level: "info", row: i, key: "box", message: `Step ${n}: box placed automatically around what changed (${s(m.auto?.[f])}); set box to adjust or “none” to remove.` });
        else if (!s(r.box) && yes(p.settings.autoBox ?? true) && m.whole?.[f]) issues.push({ level: "info", row: i, key: "box", message: `Step ${n}: most of the screen changed, so no automatic box; set box if something should be pointed out.` });
        if (/登录|登陆|密码|login|sign in|password/i.test(s(r.title) + s(r.text)) && !s(r.blur)) issues.push({ level: "warn", row: i, key: "blur", message: `Step ${n} looks like a login screen. Check that no account, phone or password is visible, and set blur over it.` });
        const sz = m.sizes?.[f];
        if (sz && sz[0] < 480) issues.push({ level: "warn", row: i, key: "file", message: `${base(f)} is only ${sz[0]}×${sz[1]} px; text may be hard to read.` });
        return { ...r, _auto: s(m.auto?.[f]) };
      });
      if (m.stepsFile && m.stepCount !== p.rows.length) issues.push({ level: "warn", message: `${base(m.stepsFile)} has ${m.stepCount} step(s) but there are ${p.rows.length} screenshot(s); steps are matched in file-name order, so check the ones without text.` });
      if (!m.stepsFile) issues.push({ level: "info", message: "No steps file (.md/.txt) found — fill in title and text per row, or add one next to the screenshots." });
      if (!n) issues.push({ level: "error", message: "No step is included." });
      return {
        rows,
        issues,
        summary: `“${guideTitle(p)}”: ${n} step(s) from ${p.rows.length} screenshot(s)${m.stepsFile ? ` and ${base(m.stepsFile)}` : ""}; ${boxes} with a highlight box.`,
        stats: { steps: n, screenshots: p.rows.length, boxes },
      };
    },
    exports: [
      { id: "html", label: ["网页 HTML", "HTML"], description: "guide.html (images embedded)", async run(ctx: ExportCtx) {
        const p = ctx.project, list = used(p), parts: string[] = [];
        for (const [i, r] of list.entries()) {
          const a = await annotate(ctx.ws, ctx.assetRoot, p, r, i + 1);
          parts.push(`<section><h2><span class="n">${i + 1}</span>${escapeXml(s(r.title) || `Step ${i + 1}`)}</h2>${s(r.text) ? `<p>${escapeXml(s(r.text)).replace(/\n/g, "<br>")}</p>` : ""}<img src="data:image/png;base64,${Buffer.from(a.png).toString("base64")}" width="${a.W}" alt="${escapeXml(s(r.title))}"></section>`);
        }
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(guideTitle(p))}</title><style>body{font:16px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:1040px;margin:32px auto;padding:0 20px;color:#1f2937}h1{font-size:28px}h2{font-size:20px;margin:36px 0 8px;display:flex;align-items:center;gap:10px}.n{display:inline-flex;width:30px;height:30px;border-radius:50%;background:${s(p.settings.color) || "#ef4444"};color:#fff;font-size:16px;align-items:center;justify-content:center}img{max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 2px 8px #0001}.intro{color:#4b5563}</style></head><body><h1>${escapeXml(guideTitle(p))}</h1>${s(p.settings.intro) ? `<p class="intro">${escapeXml(s(p.settings.intro))}</p>` : ""}${parts.join("\n")}</body></html>`;
        return [await ctx.write("guide.html", html)];
      } },
      { id: "md", label: ["Markdown + 图片", "Markdown + images"], description: "guide.md and images/step-NN.png", async run(ctx: ExportCtx) {
        const p = ctx.project, list = used(p), files: string[] = [], md: string[] = [`# ${guideTitle(p)}`, ""];
        if (s(p.settings.intro)) md.push(s(p.settings.intro), "");
        for (const [i, r] of list.entries()) {
          const a = await annotate(ctx.ws, ctx.assetRoot, p, r, i + 1), name = `step-${String(i + 1).padStart(2, "0")}.png`;
          files.push(await ctx.write(`images/${name}`, a.png));
          md.push(`## ${i + 1}. ${s(r.title) || `Step ${i + 1}`}`, "");
          if (s(r.text)) md.push(s(r.text).split("\n").join("  \n"), "");
          md.push(`![${s(r.title)}](images/${name})`, "");
        }
        files.unshift(await ctx.write("guide.md", md.join("\n")));
        return files;
      } },
      { id: "pdf", label: ["PDF", "PDF"], description: "guide.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, list = used(p), kit = await newPdf();
        const [PW, PH] = PAGE[(s(p.settings.page) as "A4" | "Letter")] ?? PAGE.A4, M = 18 * MM, CW = PW - 2 * M;
        let page = kit.doc.addPage([PW, PH]), y = PH - M;
        const need = (h: number) => { if (y - h < M) { page = kit.doc.addPage([PW, PH]); y = PH - M; } };
        kit.text(page, guideTitle(p), M, y - 20, { size: 20, bold: true }); y -= 34;
        if (s(p.settings.intro)) for (const l of kit.wrap(s(p.settings.intro), 11, CW)) { kit.text(page, l, M, y - 12, { size: 11, color: "#4b5563" }); y -= 16; }
        for (const [i, r] of list.entries()) {
          const a = await annotate(ctx.ws, ctx.assetRoot, p, r, i + 1), img = await kit.doc.embedPng(a.png);
          const tl = s(r.text) ? kit.wrap(s(r.text), 10.5, CW) : [];
          let w = CW, h = (a.H / a.W) * w;
          const maxH = PH * 0.36; if (h > maxH) { h = maxH; w = (a.W / a.H) * h; }
          need(28 + tl.length * 15 + h + 18);
          y -= 10; kit.text(page, `${i + 1}. ${s(r.title) || `Step ${i + 1}`}`, M, y - 14, { size: 14, bold: true }); y -= 24;
          for (const l of tl) { kit.text(page, l, M, y - 11, { size: 10.5, color: "#374151" }); y -= 15; }
          y -= 4; page.drawImage(img, { x: M, y: y - h, width: w, height: h }); y -= h + 14;
        }
        return [await ctx.write("guide.pdf", await kit.doc.save())];
      } },
    ],
    describeRow: (r, i) => `#${i} ${yes(r.include) ? "" : "(off) "}${base(s(r.file))} “${s(r.title)}”${s(r.box) ? ` box=${s(r.box)}` : ""}${s(r.blur) ? ` blur=${s(r.blur)}` : ""}${s(r.crop) ? ` crop=${s(r.crop)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
