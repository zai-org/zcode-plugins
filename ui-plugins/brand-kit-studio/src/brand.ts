import { Resvg } from "@resvg/resvg-wasm";
import { extractPalette, mix, readableOn, toHex, contrast, type RGB } from "./kit/color.ts";
import { decodeImage, parseColor, type Raster } from "./kit/raster.ts";
import { escapeXml, fitTextBlock, renderSvg, textSvg, type FontSet } from "./kit/render.ts";
import { KitError } from "./kit/workspace.ts";

export type Layout = "hero" | "split" | "minimal";
export type Tone = "auto" | "original" | "white" | "dark";

export interface AssetDef {
  id: string;
  label: string;
  label_zh: string;
  group: "icon" | "social" | "cover";
  width: number;
  height: number;
  /** 平台会遮挡/裁切的部分之外的安全区（比例）。 */
  safe?: { x: number; y: number; w: number; h: number };
  layout?: Layout;
  file: string;
}

export const ASSETS: AssetDef[] = [
  { id: "favicon", label: "Favicon (ICO 16/32/48 + PNG)", label_zh: "网站图标 favicon", group: "icon", width: 48, height: 48, file: "favicon/favicon.ico" },
  { id: "apple-touch-icon", label: "Apple touch icon 180", label_zh: "苹果触屏图标 180", group: "icon", width: 180, height: 180, file: "favicon/apple-touch-icon.png" },
  { id: "android-chrome-192", label: "Android / PWA 192", label_zh: "安卓 / PWA 192", group: "icon", width: 192, height: 192, file: "favicon/android-chrome-192x192.png" },
  { id: "android-chrome-512", label: "Android / PWA 512", label_zh: "安卓 / PWA 512", group: "icon", width: 512, height: 512, file: "favicon/android-chrome-512x512.png" },
  { id: "maskable-512", label: "PWA maskable 512", label_zh: "PWA 自适应图标 512", group: "icon", width: 512, height: 512, safe: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, file: "favicon/maskable-512x512.png" },
  { id: "avatar", label: "Social avatar 400", label_zh: "社媒头像 400", group: "social", width: 400, height: 400, safe: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, file: "social/avatar-400x400.png" },
  { id: "og-image", label: "Open Graph 1200×630", label_zh: "链接分享图 1200×630", group: "social", width: 1200, height: 630, layout: "hero", file: "social/og-image-1200x630.png" },
  { id: "x-post", label: "X / Twitter post 1200×675", label_zh: "X 帖子配图 1200×675", group: "social", width: 1200, height: 675, layout: "split", file: "social/x-post-1200x675.png" },
  { id: "xiaohongshu", label: "Xiaohongshu cover 1080×1440", label_zh: "小红书封面 1080×1440", group: "social", width: 1080, height: 1440, layout: "minimal", file: "social/xiaohongshu-1080x1440.png" },
  { id: "wechat-cover", label: "WeChat article cover 900×383", label_zh: "公众号封面 900×383", group: "cover", width: 900, height: 383, layout: "split", file: "covers/wechat-cover-900x383.png" },
  { id: "x-header", label: "X / Twitter header 1500×500", label_zh: "X 主页横幅 1500×500", group: "cover", width: 1500, height: 500, safe: { x: 0.22, y: 0.1, w: 0.72, h: 0.72 }, layout: "split", file: "covers/x-header-1500x500.png" },
  { id: "linkedin-banner", label: "LinkedIn banner 1584×396", label_zh: "LinkedIn 横幅 1584×396", group: "cover", width: 1584, height: 396, safe: { x: 0.3, y: 0.1, w: 0.64, h: 0.8 }, layout: "split", file: "covers/linkedin-banner-1584x396.png" },
  { id: "youtube-banner", label: "YouTube banner 2560×1440", label_zh: "YouTube 频道横幅 2560×1440", group: "cover", width: 2560, height: 1440, safe: { x: 0.198, y: 0.353, w: 0.604, h: 0.294 }, layout: "hero", file: "covers/youtube-banner-2560x1440.png" },
];

export interface Brand {
  name: string;
  tagline: string;
  colors: { primary: string; secondary: string; background: string; text: string };
  logoTone: Tone;
}

export interface AssetOptions {
  enabled?: boolean;
  layout?: Layout;
  title?: string;
  subtitle?: string;
}

export interface LogoInfo {
  path: string;
  href: string;
  /** SVG logo 内联（嵌套 <image> 里的文字不会用到插件字体）。 */
  inline?: { viewBox: string; body: string };
  width: number;
  height: number;
  crop: { x: number; y: number; w: number; h: number };
  hasAlpha: boolean;
  average: RGB;
  palette: RGB[];
}

const mimeOf = (path: string) => (/\.svg$/i.test(path) ? "image/svg+xml" : /\.png$/i.test(path) ? "image/png" : "image/jpeg");

/** 内容边界（透明边或与四角同色的边去掉）。 */
function contentBox(image: Raster, hasAlpha: boolean) {
  const { width, height, data } = image;
  const corner = [data[0], data[1], data[2]];
  const isContent = (i: number) =>
    hasAlpha ? data[i + 3] > 24 : Math.abs(data[i] - corner[0]) + Math.abs(data[i + 1] - corner[1]) + Math.abs(data[i + 2] - corner[2]) > 36;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (isContent((y * width + x) * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export async function analyseLogo(path: string, bytes: Uint8Array, fonts: FontSet): Promise<LogoInfo> {
  const mime = mimeOf(path);
  let raster: Raster;
  let width: number;
  let height: number;
  let scale = 1;
  let inline: LogoInfo["inline"];
  if (mime === "image/svg+xml") {
    const text = new TextDecoder().decode(bytes);
    if (!/<svg[\s>]/i.test(text)) throw new KitError("bad_logo", `${path} is not an SVG file.`);
    try {
      const probe = new Resvg(text, { font: { fontBuffers: fonts.buffers, defaultFontFamily: fonts.family } });
      width = probe.width;
      height = probe.height;
      probe.free();
    } catch (error) {
      throw new KitError("bad_logo", `Cannot read SVG ${path}: ${error instanceof Error ? error.message : error}`);
    }
    const target = Math.min(1024, Math.max(256, Math.round(width)));
    inline = inlineSvg(text, width, height);
    const rendered = await renderSvg(text, fonts, target);
    raster = { width: rendered.width, height: rendered.height, data: rendered.pixels };
    scale = width / rendered.width;
  } else {
    raster = decodeImage(bytes, path);
    width = raster.width;
    height = raster.height;
  }
  const { colors, average, hasAlpha } = extractPalette(raster);
  const box = contentBox(raster, hasAlpha);
  const pad = Math.max(box.w, box.h) * 0.01;
  return {
    path,
    href: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    width,
    height,
    crop: { x: (box.x - pad) * scale, y: (box.y - pad) * scale, w: (box.w + pad * 2) * scale, h: (box.h + pad * 2) * scale },
    inline,
    hasAlpha: mime === "image/svg+xml" || hasAlpha,
    average,
    palette: colors,
  };
}

let inlineSeq = 0;
/** 取出 SVG 根元素的内容，给 id 加前缀避免与其他图形冲突。 */
function inlineSvg(text: string, width: number, height: number): LogoInfo["inline"] {
  const cleaned = text.replace(/<\?xml[^>]*>/g, "").replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const open = /<svg\b[^>]*>/i.exec(cleaned);
  const close = cleaned.lastIndexOf("</svg>");
  if (!open || close < 0) return undefined;
  const viewBox = /viewBox\s*=\s*["']([^"']+)["']/i.exec(open[0])?.[1] ?? `0 0 ${width} ${height}`;
  const prefix = `logo${++inlineSeq}-`;
  const body = cleaned
    .slice(open.index + open[0].length, close)
    .replace(/\bid\s*=\s*(["'])([^"']+)\1/g, (_m, q, id) => `id=${q}${prefix}${id}${q}`)
    .replace(/url\(\s*#([^)\s]+)\s*\)/g, (_m, id) => `url(#${prefix}${id})`)
    .replace(/(xlink:href|href)\s*=\s*(["'])#([^"']+)\2/g, (_m, attr, q, id) => `${attr}=${q}#${prefix}${id}${q}`);
  return { viewBox, body };
}

/** 从 logo 推荐品牌色。 */
export function suggestColors(logo?: LogoInfo): Brand["colors"] {
  const primary = logo?.palette[0] ?? (logo && contrast(logo.average, [255, 255, 255]) > 3 ? logo.average : ([37, 99, 235] as RGB));
  const secondary = logo?.palette[1] ?? mix(primary, [0, 0, 0], 0.35);
  return { primary: toHex(primary), secondary: toHex(secondary), background: "#ffffff", text: "#111827" };
}

export function normalizeBrand(value: Partial<Brand> | undefined, logo?: LogoInfo): Brand {
  const suggested = suggestColors(logo);
  const userPrimary = value?.colors?.primary;
  if (typeof userPrimary === "string" && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(userPrimary.trim()) && !logo?.palette[1]) suggested.secondary = toHex(mix(parseColor(userPrimary), [0, 0, 0], 0.35));
  const colors = { ...suggested };
  for (const key of Object.keys(colors) as (keyof Brand["colors"])[]) {
    const v = value?.colors?.[key];
    if (typeof v === "string" && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) colors[key] = toHex(parseColor(v));
  }
  const tone = value?.logoTone;
  return {
    name: String(value?.name ?? "").trim().slice(0, 80),
    tagline: String(value?.tagline ?? "").trim().slice(0, 200),
    colors,
    logoTone: tone === "original" || tone === "white" || tone === "dark" ? tone : "auto",
  };
}

const firstChar = (name: string) => {
  const ch = [...name.trim()][0] ?? "B";
  return /[a-z]/.test(ch) ? ch.toUpperCase() : ch;
};

interface Ctx {
  brand: Brand;
  logo?: LogoInfo;
  mark?: LogoInfo;
  fonts: FontSet;
  warnings: string[];
}

const DEFS = `<defs><filter id="tone-white" color-interpolation-filters="sRGB"><feFlood flood-color="#ffffff"/><feComposite in2="SourceAlpha" operator="in"/></filter><filter id="tone-dark" color-interpolation-filters="sRGB"><feFlood flood-color="#111827"/><feComposite in2="SourceAlpha" operator="in"/></filter></defs>`;

/** 把 logo 放进框里（保持比例，居中或靠左）。背景对比不足时可转成单色；无透明背景的 logo 放在白色圆角底上。 */
function placeLogo(ctx: Ctx, logo: LogoInfo, box: { x: number; y: number; w: number; h: number }, bg: RGB, align: "center" | "left" = "center") {
  const k = Math.min(box.w / logo.crop.w, box.h / logo.crop.h);
  const w = logo.crop.w * k;
  const h = logo.crop.h * k;
  const x = align === "left" ? box.x : box.x + (box.w - w) / 2;
  const y = box.y + (box.h - h) / 2;
  let tone = ctx.brand.logoTone;
  let badge = "";
  const lowContrast = contrast(logo.average, bg) < 1.8;
  // 单色 logo 对比不足时转成白/深色；多色 logo 放在白底圆角卡片上，保留原色。
  if (tone === "auto") tone = logo.hasAlpha && lowContrast && logo.palette.length <= 1 ? (readableOn(bg) === "#ffffff" ? "white" : "dark") : "original";
  if (!logo.hasAlpha && tone !== "original") tone = "original";
  const needsBadge = tone === "original" && contrast(bg, [255, 255, 255]) > 1.3 && (!logo.hasAlpha || (lowContrast && ctx.brand.logoTone === "auto"));
  if (needsBadge) {
    const p = Math.min(w, h) * 0.12;
    badge = `<rect x="${(x - p).toFixed(1)}" y="${(y - p).toFixed(1)}" width="${(w + p * 2).toFixed(1)}" height="${(h + p * 2).toFixed(1)}" rx="${(p * 1.2).toFixed(1)}" fill="#ffffff"/>`;
  }
  const filter = tone === "white" ? ` filter="url(#tone-white)"` : tone === "dark" ? ` filter="url(#tone-dark)"` : "";
  const c = logo.crop;
  const content = logo.inline
    ? `<g${filter}><svg width="${logo.width}" height="${logo.height}" viewBox="${logo.inline.viewBox}">${logo.inline.body}</svg></g>`
    : `<image href="${logo.href}" width="${logo.width}" height="${logo.height}"${filter}/>`;
  return `${badge}<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" viewBox="${c.x.toFixed(2)} ${c.y.toFixed(2)} ${c.w.toFixed(2)} ${c.h.toFixed(2)}" overflow="hidden">${content}</svg>`;
}

/** 方形图标的标志：专门的 mark → 接近方形的 logo → 品牌名首字。 */
function iconMark(ctx: Ctx, box: { x: number; y: number; w: number; h: number }, bg: RGB | null) {
  const source = ctx.mark ?? (ctx.logo && ctx.logo.crop.w / ctx.logo.crop.h < 1.8 ? ctx.logo : undefined);
  if (source) return placeLogo(ctx, source, box, bg ?? [255, 255, 255]);
  const color = bg ? readableOn(bg) : ctx.brand.colors.primary;
  const size = box.h * 0.78;
  return `<text x="${(box.x + box.w / 2).toFixed(1)}" y="${(box.y + box.h / 2).toFixed(1)}" font-family="${escapeXml(ctx.fonts.boldFamily ?? ctx.fonts.family)}" font-weight="700" font-size="${size.toFixed(1)}" fill="${color}" text-anchor="middle" dominant-baseline="central">${escapeXml(firstChar(ctx.brand.name))}</text>`;
}

function iconSvg(ctx: Ctx, def: AssetDef) {
  const { width: W, height: H } = def;
  const { primary } = ctx.brand.colors;
  const primaryRgb = parseColor(primary);
  const source = ctx.mark ?? (ctx.logo && ctx.logo.crop.w / ctx.logo.crop.h < 1.8 ? ctx.logo : undefined);
  const hasMark = !!source;
  // 标志本身和品牌色对比不足（例如绿色圆形标志配绿色主色）时，图标底色用背景色。
  const tile = source && (contrast(source.average, primaryRgb) < 1.8 || !source.hasAlpha) ? ctx.brand.colors.background : primary;
  if (def.id === "favicon" || def.id === "android-chrome-192" || def.id === "android-chrome-512") {
    if (hasMark && (def.id === "favicon" || tile !== primary)) return [DEFS, iconMark(ctx, { x: 0, y: 0, w: W, h: H }, null)];
    // 首字图标和安卓图标用圆角品牌色底。
    const r = W * 0.22;
    const pad = W * (hasMark ? 0.16 : 0.12);
    return [DEFS, `<rect width="${W}" height="${H}" rx="${r}" fill="${primary}"/>`, iconMark(ctx, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 }, primaryRgb)];
  }
  // apple-touch / maskable / avatar：满版不透明底。
  const safe = def.safe ?? { x: 0.14, y: 0.14, w: 0.72, h: 0.72 };
  const bg = !hasMark ? primary : def.id === "avatar" ? tile : ctx.brand.colors.background;
  return [DEFS, `<rect width="${W}" height="${H}" fill="${bg}"/>`, iconMark(ctx, { x: W * safe.x, y: H * safe.y, w: W * safe.w, h: H * safe.h }, parseColor(bg))];
}

function textBlock(ctx: Ctx, def: AssetDef, text: string, box: { x: number; y: number; w: number; h: number }, opts: { size: number; minSize: number; bold?: boolean; color: string; anchor: "start" | "middle"; maxLines: number; label: string }) {
  if (!text) return { svg: "", height: 0 };
  const fit = fitTextBlock(text, { width: box.w, height: box.h }, { size: opts.size, minSize: opts.minSize, maxLines: opts.maxLines }, (t, s) => ctx.fonts.measure(t, s, opts.bold));
  if (fit.overflow) ctx.warnings.push(`${def.id}: ${opts.label} is too long and was shortened`);
  const x = opts.anchor === "middle" ? box.x + box.w / 2 : box.x;
  const family = opts.bold ? (ctx.fonts.boldFamily ?? ctx.fonts.family) : ctx.fonts.family;
  return {
    svg: textSvg(fit.lines, { x, y: box.y, size: fit.size, color: opts.color, family, weight: opts.bold ? 700 : 400, anchor: opts.anchor, boldStroke: opts.bold && !ctx.fonts.boldFamily }),
    height: fit.lines.length * fit.size * 1.25,
    size: fit.size,
  };
}

function cardSvg(ctx: Ctx, def: AssetDef, options: AssetOptions) {
  const { width: W, height: H } = def;
  const { colors } = ctx.brand;
  const wordmark = !!ctx.logo && ctx.logo.crop.w / ctx.logo.crop.h >= 2;
  let layout = options.layout ?? def.layout ?? "hero";
  // 横版文字 logo 已经写着品牌名，居中版式默认不再重复标题。
  const title = (options.title ?? (layout === "hero" && wordmark ? "" : ctx.brand.name)).trim();
  const subtitle = (options.subtitle ?? ctx.brand.tagline).trim();
  const portrait = H > W * 1.05;
  if (layout === "split" && portrait) layout = "minimal";
  const safe = def.safe ?? { x: 0, y: 0, w: 1, h: 1 };
  const pad = Math.min(W * safe.w, H * safe.h) * 0.09;
  const S = { x: W * safe.x + pad, y: H * safe.y + pad, w: W * safe.w - pad * 2, h: H * safe.h - pad * 2 };
  const base = portraitBase(S, H > W * 1.05);
  const parts: string[] = [DEFS];

  if (layout === "hero") {
    const bgA = parseColor(colors.primary);
    const bgB = parseColor(colors.secondary);
    const ink = readableOn(mix(bgA, bgB, 0.5));
    parts.push(
      `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.primary}"/><stop offset="1" stop-color="${colors.secondary}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`,
    );
    const logoH = ctx.logo ? base * (portrait ? 0.3 : 0.36) : 0;
    const gap = base * 0.08;
    const t = textBlock(ctx, def, title, { x: S.x, y: 0, w: S.w, h: base * 0.3 }, { size: Math.round(base * 0.17), minSize: Math.max(12, Math.round(base * 0.07)), bold: true, color: ink, anchor: "middle", maxLines: 2, label: "title" });
    const s = textBlock(ctx, def, subtitle, { x: S.x, y: 0, w: S.w * 0.9, h: base * 0.22 }, { size: Math.round(base * 0.075), minSize: Math.max(10, Math.round(base * 0.045)), color: ink, anchor: "middle", maxLines: 2, label: "subtitle" });
    const total = logoH + (t.height ? gap + t.height : 0) + (s.height ? gap * 0.6 + s.height : 0);
    let y = S.y + (S.h - total) / 2;
    if (ctx.logo) parts.push(placeLogo(ctx, ctx.logo, { x: S.x, y, w: S.w, h: logoH }, mix(bgA, bgB, 0.4)));
    y += logoH + (logoH && t.height ? gap : 0);
    if (t.height) parts.push(textBlock(ctx, def, title, { x: S.x, y, w: S.w, h: base * 0.3 }, { size: Math.round(base * 0.17), minSize: Math.max(12, Math.round(base * 0.07)), bold: true, color: ink, anchor: "middle", maxLines: 2, label: "title" }).svg);
    y += t.height + gap * 0.6;
    if (s.height) parts.push(textBlock(ctx, def, subtitle, { x: S.x + S.w * 0.05, y, w: S.w * 0.9, h: base * 0.22 }, { size: Math.round(base * 0.075), minSize: Math.max(10, Math.round(base * 0.045)), color: ink, anchor: "middle", maxLines: 2, label: "subtitle" }).svg);
  } else if (layout === "split") {
    const panelX = W * safe.x + W * safe.w * 0.62;
    parts.push(`<rect width="${W}" height="${H}" fill="${colors.background}"/>`);
    parts.push(`<rect x="${panelX.toFixed(1)}" width="${(W - panelX).toFixed(1)}" height="${H}" fill="${colors.primary}"/>`);
    const panelBox = { x: panelX + pad, y: S.y, w: W * safe.x + W * safe.w - panelX - pad * 2 + (safe.x + safe.w >= 1 ? 0 : 0), h: S.h };
    if (ctx.logo || ctx.mark) parts.push(placeLogo(ctx, (ctx.logo ?? ctx.mark)!, { x: panelBox.x, y: S.y + S.h * 0.15, w: panelBox.w, h: S.h * 0.7 }, parseColor(colors.primary)));
    else parts.push(iconMark(ctx, { x: panelBox.x, y: S.y + S.h * 0.15, w: panelBox.w, h: S.h * 0.7 }, parseColor(colors.primary)));
    const textW = panelX - S.x - pad;
    const accent = `<rect x="${S.x.toFixed(1)}" y="${(S.y + S.h * 0.08).toFixed(1)}" width="${(base * 0.12).toFixed(1)}" height="${(base * 0.025).toFixed(1)}" rx="${(base * 0.0125).toFixed(1)}" fill="${colors.primary}"/>`;
    parts.push(accent);
    const tOpts = { size: Math.round(base * 0.2), minSize: Math.max(12, Math.round(base * 0.08)), bold: true, color: colors.text, anchor: "start" as const, maxLines: 2, label: "title" };
    const sOpts = { size: Math.round(base * 0.085), minSize: Math.max(10, Math.round(base * 0.05)), color: mixHex(colors.text, colors.background, 0.25), anchor: "start" as const, maxLines: 3, label: "subtitle" };
    const t = textBlock(ctx, def, title, { x: S.x, y: 0, w: textW, h: S.h * 0.5 }, tOpts);
    const s = textBlock(ctx, def, subtitle, { x: S.x, y: 0, w: textW, h: S.h * 0.36 }, sOpts);
    const total = t.height + (s.height ? base * 0.06 + s.height : 0);
    const y = S.y + S.h * 0.14 + (S.h * 0.86 - total) / 2;
    parts.push(textBlock(ctx, def, title, { x: S.x, y, w: textW, h: S.h * 0.5 }, tOpts).svg);
    if (s.height) parts.push(textBlock(ctx, def, subtitle, { x: S.x, y: y + t.height + base * 0.06, w: textW, h: S.h * 0.36 }, sOpts).svg);
  } else {
    parts.push(`<rect width="${W}" height="${H}" fill="${colors.background}"/>`);
    parts.push(`<rect y="${(H - H * 0.025).toFixed(1)}" width="${W}" height="${(H * 0.025).toFixed(1)}" fill="${colors.primary}"/>`);
    const logoH = base * (portrait ? 0.12 : 0.2);
    if (ctx.logo) parts.push(placeLogo(ctx, ctx.logo, { x: S.x, y: S.y, w: S.w * 0.5, h: logoH }, parseColor(colors.background), "left"));
    else parts.push(`<svg x="${S.x}" y="${S.y}" width="${logoH}" height="${logoH}"><rect width="${logoH}" height="${logoH}" rx="${logoH * 0.22}" fill="${colors.primary}"/>${iconMark(ctx, { x: logoH * 0.12, y: logoH * 0.12, w: logoH * 0.76, h: logoH * 0.76 }, parseColor(colors.primary))}</svg>`);
    const tOpts = { size: Math.round(base * (portrait ? 0.22 : 0.2)), minSize: Math.max(12, Math.round(base * 0.07)), bold: true, color: colors.text, anchor: "start" as const, maxLines: portrait ? 4 : 2, label: "title" };
    const sOpts = { size: Math.round(base * (portrait ? 0.075 : 0.08)), minSize: Math.max(10, Math.round(base * 0.04)), color: mixHex(colors.text, colors.background, 0.25), anchor: "start" as const, maxLines: 4, label: "subtitle" };
    const areaY = S.y + logoH + base * 0.1;
    const areaH = S.h - logoH - base * 0.1;
    const t = textBlock(ctx, def, title, { x: S.x, y: 0, w: S.w, h: areaH * 0.6 }, tOpts);
    const s = textBlock(ctx, def, subtitle, { x: S.x, y: 0, w: S.w, h: areaH * 0.35 }, sOpts);
    const total = t.height + (s.height ? base * 0.05 + s.height : 0);
    const y = areaY + (areaH - total) * (portrait ? 0.4 : 0.5);
    parts.push(`<rect x="${S.x}" y="${(y - base * 0.05).toFixed(1)}" width="${(base * 0.1).toFixed(1)}" height="${(base * 0.018).toFixed(1)}" fill="${colors.primary}"/>`);
    parts.push(textBlock(ctx, def, title, { x: S.x, y, w: S.w, h: areaH * 0.6 }, tOpts).svg);
    if (s.height) parts.push(textBlock(ctx, def, subtitle, { x: S.x, y: y + t.height + base * 0.05, w: S.w, h: areaH * 0.35 }, sOpts).svg);
  }
  return parts;
}

const portraitBase = (S: { w: number; h: number }, portrait: boolean) => (portrait ? S.w * 0.8 : Math.min(S.h, S.w * 0.6));

const mixHex = (a: string, b: string, t: number) => toHex(mix(parseColor(a), parseColor(b), t));

export interface BrandAssets {
  brand: Brand;
  logo?: LogoInfo;
  mark?: LogoInfo;
  fonts: FontSet;
}

/** 生成一个素材的 SVG（可编辑的模板），并返回排版警告。 */
export function assetSvg(input: BrandAssets, def: AssetDef, options: AssetOptions = {}) {
  const ctx: Ctx = { ...input, warnings: [] };
  if (!input.brand.name && !input.logo && !input.mark) throw new KitError("missing_brand", "Give the brand a name or a logo first.");
  const parts = def.group === "icon" || def.id === "avatar" ? iconSvg(ctx, def) : cardSvg(ctx, def, options);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${def.width}" height="${def.height}" viewBox="0 0 ${def.width} ${def.height}">${parts.join("")}</svg>`;
  return { svg, warnings: [...new Set(ctx.warnings)] };
}

/** ICO（PNG 内嵌），每个尺寸一张。 */
export function encodeIco(images: { size: number; png: Uint8Array }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, o);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, o + 1);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(image.png.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, ...images.map((i) => Buffer.from(i.png))]);
}

export function webManifest(brand: Brand) {
  const short = [...brand.name].length > 12 ? [...brand.name].slice(0, 12).join("") : brand.name;
  return JSON.stringify(
    {
      name: brand.name || "App",
      short_name: short || "App",
      icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
        { src: "/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      theme_color: brand.colors.primary,
      background_color: brand.colors.background,
      display: "standalone",
    },
    null,
    2,
  );
}

export function headSnippet(brand: Brand) {
  return [
    `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    `<link rel="manifest" href="/site.webmanifest">`,
    `<meta name="theme-color" content="${brand.colors.primary}">`,
    `<meta property="og:image" content="/og-image-1200x630.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    "",
  ].join("\n");
}
