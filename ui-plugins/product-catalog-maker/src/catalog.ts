import { createHash } from "node:crypto";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { pdfFontkit } from "./kit/pdf-fontkit.ts";
import { decodeImage, encodeJpeg, parseColor, resize } from "./kit/raster.ts";
import type { TableData } from "./kit/table.ts";

export type Field = "sku" | "name" | "spec" | "desc" | "price" | "originalPrice" | "image" | "category" | "unit";
export const FIELDS: Field[] = ["sku", "name", "spec", "desc", "price", "originalPrice", "image", "category", "unit"];
const ALIASES: Record<Field, RegExp> = {
  sku: /^(编号|货号|款号|sku|商品编码|编码|code|item ?(no|number|code)|型号编码|id)$/i,
  name: /^(名称|品名|商品名称?|产品名称?|name|title|product( name)?)$/i,
  spec: /^(规格|型号|规格型号|尺寸|spec(ification)?s?|size|variant)$/i,
  desc: /^(描述|说明|卖点|简介|description|desc|details?)$/i,
  price: /^(价格|售价|单价|零售价|现价|批发价|price|unit price|sale price)$/i,
  originalPrice: /^(原价|市场价|划线价|吊牌价|was|msrp|list price|original price)$/i,
  image: /^(图片|图片文件|图片文件名|主图|照片|image|images?|photo|picture|img|image file)$/i,
  category: /^(分类|类别|品类|系列|类目|category|collection|group|type)$/i,
  unit: /^(单位|计量单位|unit|uom)$/i,
};

export type Mapping = Partial<Record<Field, string>>;

export function detectMapping(columns: string[]): Mapping {
  const mapping: Mapping = {};
  for (const field of FIELDS) {
    const hit = columns.find((c) => ALIASES[field].test(c.trim()) && !Object.values(mapping).includes(c));
    if (hit) mapping[field] = hit;
  }
  return mapping;
}

export interface Product {
  row: number;
  sku: string;
  name: string;
  spec: string;
  desc: string;
  price: number | null;
  priceText: string;
  originalPrice: number | null;
  imageName: string;
  image?: string;
  category: string;
  unit: string;
}

export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/[¥￥$€£,，\s元]|RMB|CNY|USD/gi, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

export function readProducts(table: TableData, mapping: Mapping): { products: Product[]; problems: string[] } {
  const problems: string[] = [];
  const products: Product[] = [];
  const get = (row: Record<string, string>, f: Field) => (mapping[f] ? String(row[mapping[f]!] ?? "").trim() : "");
  if (!mapping.name) problems.push("No product name column found — map the `name` column.");
  const seen = new Map<string, number>();
  table.rows.forEach((row, i) => {
    const line = i + 2;
    const name = get(row, "name");
    if (!name && !get(row, "sku")) return; // 空行
    const priceText = get(row, "price");
    const price = parsePrice(priceText);
    const originalText = get(row, "originalPrice");
    const original = parsePrice(originalText);
    const p: Product = {
      row: line,
      sku: get(row, "sku"),
      name,
      spec: get(row, "spec"),
      desc: get(row, "desc"),
      price: Number.isNaN(price) ? null : price,
      priceText,
      originalPrice: original === null || Number.isNaN(original) ? null : original,
      imageName: get(row, "image"),
      category: get(row, "category") || "",
      unit: get(row, "unit"),
    };
    if (!name) problems.push(`row ${line}: missing product name`);
    if (mapping.price && !priceText) problems.push(`row ${line} ${p.sku || name}: missing price`);
    if (Number.isNaN(price)) problems.push(`row ${line} ${p.sku || name}: price "${priceText}" is not a number`);
    if (p.sku) {
      const prev = seen.get(p.sku);
      if (prev) problems.push(`row ${line}: SKU ${p.sku} duplicates row ${prev}`);
      else seen.set(p.sku, line);
    }
    products.push(p);
  });
  return { products, problems };
}

export interface Style {
  title: string;
  subtitle: string;
  logo?: string;
  primary: string;
  grid: "2x2" | "2x3" | "3x3" | "3x4";
  currency: string;
  footer: string;
  cover: boolean;
  showSku: boolean;
  /** 分类排序：表格顺序或名称。 */
  categoryOrder: "table" | "name";
}

export const DEFAULT_STYLE: Style = { title: "产品目录", subtitle: "", primary: "#1d4ed8", grid: "2x3", currency: "¥", footer: "", cover: true, showSku: true, categoryOrder: "table" };

export function groupByCategory(products: Product[], order: Style["categoryOrder"], fallback: string) {
  const groups = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.category || fallback;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const list = [...groups].map(([name, items]) => ({ name, items }));
  if (order === "name") list.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  return list;
}

export function formatPrice(value: number | null, currency: string, text = "") {
  if (value === null) return text || "";
  const fixed = Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency}${fixed}`;
}

// ---------------------------------------------------------------- 图片

export interface PreparedImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
  sourceWidth: number;
  hash: string;
}

export function prepareImage(bytes: Uint8Array, name: string, maxSide: number): PreparedImage {
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  const image = decodeImage(bytes, name);
  const k = Math.min(1, maxSide / Math.max(image.width, image.height));
  const small = k < 1 ? resize(image, Math.max(1, Math.round(image.width * k)), Math.max(1, Math.round(image.height * k))) : image;
  return { jpeg: new Uint8Array(encodeJpeg(small, 85)), width: small.width, height: small.height, sourceWidth: image.width, hash };
}

// ---------------------------------------------------------------- 排版

const A4 = { w: 595.28, h: 841.89 };
const M = 36;

export function wrap(text: string, maxWidth: number, measure: (t: string) => number, maxLines: number) {
  const lines: string[] = [];
  const tokens = text.replace(/\s+/g, " ").trim().match(/[A-Za-z0-9@._%+\-'’!?,;:)/]+\s*|\s+|./gu) ?? [];
  let line = "";
  for (const token of tokens) {
    if (line && measure((line + token).trimEnd()) > maxWidth) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line += token;
    while (measure(line) > maxWidth && line.length > 1) {
      // 超长单词硬断。
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length <= maxLines) return { lines, cut: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return { lines: kept, cut: true };
}

export interface BuildInput {
  products: Product[];
  style: Style;
  images: Map<string, PreparedImage>;
  logo?: PreparedImage;
  fonts: { regular: Uint8Array; bold?: Uint8Array };
  date: string;
  lang: "zh" | "en";
}

export interface PagePlan {
  category: string;
  items: Product[];
  first: boolean;
}

export function plan(products: Product[], style: Style, uncategorised: string) {
  const [cols, rows] = style.grid.split("x").map(Number);
  const per = cols * rows;
  const pages: PagePlan[] = [];
  const toc: { name: string; page: number; count: number }[] = [];
  const offset = style.cover ? 1 : 0;
  for (const group of groupByCategory(products, style.categoryOrder, uncategorised)) {
    toc.push({ name: group.name, page: pages.length + offset + 1, count: group.items.length });
    for (let i = 0; i < group.items.length; i += per) pages.push({ category: group.name, items: group.items.slice(i, i + per), first: i === 0 });
  }
  return { cols, rows, pages, toc, total: pages.length + offset };
}

const hexRgb = (hex: string) => {
  const [r, g, b] = parseColor(hex, [29, 78, 216]);
  return rgb(r / 255, g / 255, b / 255);
};
const GRAY = rgb(0.42, 0.45, 0.5);
const INK = rgb(0.07, 0.09, 0.15);
const LINE = rgb(0.89, 0.9, 0.92);

export async function buildPdf(input: BuildInput) {
  const { style } = input;
  const L = input.lang === "zh" ? { none: "未分类", items: "件商品", updated: "更新于", contents: "目录", noImage: "暂无图片", page: "" } : { none: "Other", items: "products", updated: "Updated", contents: "Contents", noImage: "No image", page: "" };
  const doc = await PDFDocument.create();
  doc.registerFontkit(pdfFontkit as never);
  const regular = await doc.embedFont(input.fonts.regular, { subset: true });
  const bold = input.fonts.bold ? await doc.embedFont(input.fonts.bold, { subset: true }) : regular;
  doc.setTitle(style.title || "Catalog");
  doc.setCreator("Product Catalog Maker (ZCode plugin)");
  doc.setProducer("pdf-lib");
  const primary = hexRgb(style.primary);
  const [pr, pg, pb] = parseColor(style.primary, [29, 78, 216]);
  const light = rgb((pr + (255 - pr) * 0.9) / 255, (pg + (255 - pg) * 0.9) / 255, (pb + (255 - pb) * 0.9) / 255);
  const embedded = new Map<string, PDFImage>();
  const embed = async (img: PreparedImage) => {
    let e = embedded.get(img.hash);
    if (!e) {
      e = await doc.embedJpg(img.jpeg);
      embedded.set(img.hash, e);
    }
    return e;
  };
  const logo = input.logo ? await embed(input.logo) : undefined;
  for (const p of input.products) if (p.image && input.images.has(p.image)) await embed(input.images.get(p.image)!);
  const layout = plan(input.products, style, L.none);
  const warnings: string[] = [];
  const text = (page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = INK) => page.drawText(s, { x, y, size, font, color });

  if (style.cover) {
    const page = doc.addPage([A4.w, A4.h]);
    const bandH = A4.h * 0.5;
    page.drawRectangle({ x: 0, y: A4.h - bandH, width: A4.w, height: bandH, color: primary });
    let y = A4.h - 110;
    if (logo) {
      const h = 56;
      const w = Math.min(220, (logo.width / logo.height) * h);
      const hh = (w / (logo.width / logo.height));
      page.drawRectangle({ x: M + 14, y: y - hh - 6, width: w + 20, height: hh + 20, color: rgb(1, 1, 1) });
      page.drawImage(logo, { x: M + 24, y: y - hh + 4, width: w, height: hh });
      y -= hh + 50;
    }
    const titleLines = wrap(style.title || "Catalog", A4.w - 2 * M - 28, (t) => bold.widthOfTextAtSize(t, 34), 2).lines;
    for (const line of titleLines) {
      y -= 40;
      text(page, line, M + 14, y, 34, bold, rgb(1, 1, 1));
    }
    if (style.subtitle) for (const line of wrap(style.subtitle, A4.w - 2 * M - 28, (t) => regular.widthOfTextAtSize(t, 14), 3).lines) {
      y -= 24;
      text(page, line, M + 14, y, 14, regular, rgb(1, 1, 1));
    }
    text(page, `${input.products.length} ${L.items} · ${L.updated} ${input.date}`, M + 14, A4.h - bandH + 24, 11, regular, rgb(1, 1, 1));
    let ty = A4.h - bandH - 50;
    text(page, L.contents, M, ty, 15, bold);
    ty -= 10;
    for (const entry of layout.toc) {
      ty -= 22;
      if (ty < 70) break;
      const label = `${entry.name}（${entry.count}）`;
      const num = String(entry.page);
      text(page, label, M, ty, 12, regular);
      const numW = regular.widthOfTextAtSize(num, 12);
      const start = M + regular.widthOfTextAtSize(label, 12) + 8;
      const end = A4.w - M - numW - 8;
      for (let x = start; x < end; x += 5) page.drawCircle({ x, y: ty + 3, size: 0.6, color: GRAY });
      text(page, num, A4.w - M - numW, ty, 12, regular);
    }
    if (style.footer) text(page, style.footer, M, 30, 9, regular, GRAY);
  }

  const { cols, rows } = layout;
  const headerH = 34;
  const footerH = 26;
  const gap = 10;
  layout.pages.forEach((planned, index) => {
    const page = doc.addPage([A4.w, A4.h]);
    const pageNo = index + (style.cover ? 2 : 1);
    // 页眉
    let top = A4.h - M + 6;
    if (logo) {
      const h = 16;
      const w = Math.min(90, (logo.width / logo.height) * h);
      page.drawImage(logo, { x: M, y: top - 14, width: w, height: w / (logo.width / logo.height) });
    }
    const headTitle = style.title || "";
    const titleX = logo ? M + 98 : M;
    text(page, headTitle, titleX, top - 11, 10, bold);
    const catW = regular.widthOfTextAtSize(planned.category, 10);
    text(page, planned.category, A4.w - M - catW, top - 11, 10, regular, GRAY);
    page.drawLine({ start: { x: M, y: top - 20 }, end: { x: A4.w - M, y: top - 20 }, thickness: 1.2, color: primary });
    top -= headerH;
    if (planned.first) {
      page.drawRectangle({ x: M, y: top - 32, width: A4.w - 2 * M, height: 32, color: light });
      page.drawRectangle({ x: M, y: top - 32, width: 4, height: 32, color: primary });
      text(page, planned.category, M + 14, top - 22, 15, bold, primary);
      top -= 44;
    }
    // 页脚
    if (style.footer) text(page, style.footer, M, M - 14, 8.5, regular, GRAY);
    const pn = `${pageNo} / ${layout.total}`;
    text(page, pn, A4.w - M - regular.widthOfTextAtSize(pn, 8.5), M - 14, 8.5, regular, GRAY);
    // 网格：所有页格子大小一致（按有分类标题的页面计算），无标题的页面把网格略下移居中。
    const gridBottom = M + footerH - 14;
    const areaTop = A4.h - M + 6 - headerH - 44;
    const cellW = (A4.w - 2 * M - gap * (cols - 1)) / cols;
    const cellH = (areaTop - gridBottom - gap * (rows - 1)) / rows;
    const k = Math.min(1.25, cellW / 250, cellH / 230);
    const startTop = planned.first ? top : top - 22;
    planned.items.forEach((p, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      drawCell(page, p, M + c * (cellW + gap), startTop - r * (cellH + gap), cellW, cellH, k);
    });
  });

  function drawCell(page: PDFPage, p: Product, x: number, topY: number, w: number, h: number, k: number) {
    page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
    const pad = 8 * k;
    const textBlock = (style.showSku && p.sku ? 12 : 0) * k + 64 * k;
    const imgBoxH = Math.max(30, h - pad * 2 - textBlock);
    const imgBoxW = w - pad * 2;
    const img = p.image ? input.images.get(p.image) : undefined;
    if (img) {
      const e = embedded.get(img.hash)!;
      const s = Math.min(imgBoxW / img.width, imgBoxH / img.height);
      const iw = img.width * s;
      const ih = img.height * s;
      page.drawImage(e, { x: x + pad + (imgBoxW - iw) / 2, y: topY - pad - imgBoxH + (imgBoxH - ih) / 2, width: iw, height: ih });
    } else {
      page.drawRectangle({ x: x + pad, y: topY - pad - imgBoxH, width: imgBoxW, height: imgBoxH, color: rgb(0.96, 0.96, 0.97) });
      const tw = regular.widthOfTextAtSize(L.noImage, 9 * k);
      text(page, L.noImage, x + pad + (imgBoxW - tw) / 2, topY - pad - imgBoxH / 2 - 3, 9 * k, regular, GRAY);
    }
    let y = topY - pad - imgBoxH - 6 * k;
    const tw = w - pad * 2;
    const nameSize = 10.5 * k;
    const name = wrap(p.name || p.sku, tw, (t) => bold.widthOfTextAtSize(t, nameSize), 2);
    if (name.cut) warnings.push(`${p.sku || p.name}: name shortened to fit`);
    for (const line of name.lines) {
      y -= nameSize * 1.15;
      text(page, line, x + pad, y, nameSize, bold);
    }
    const specText = [p.spec, p.desc].filter(Boolean).join(" · ");
    if (specText) {
      const specSize = 8.2 * k;
      for (const line of wrap(specText, tw, (t) => regular.widthOfTextAtSize(t, specSize), name.lines.length > 1 ? 1 : 2).lines) {
        y -= specSize * 1.3;
        text(page, line, x + pad, y, specSize, regular, GRAY);
      }
    }
    const bottom = topY - h + pad;
    const priceSize = 13 * k;
    const price = formatPrice(p.price, style.currency, p.priceText) + (p.unit && p.price !== null ? ` /${p.unit}` : "");
    if (price) text(page, price, x + pad, bottom + 1, priceSize, bold, primary);
    if (p.originalPrice !== null && p.price !== null && p.originalPrice > p.price) {
      const ow = formatPrice(p.originalPrice, style.currency);
      const px = x + pad + bold.widthOfTextAtSize(price, priceSize) + 6;
      const os = 8.5 * k;
      text(page, ow, px, bottom + 2, os, regular, GRAY);
      page.drawLine({ start: { x: px, y: bottom + 2 + os * 0.35 }, end: { x: px + regular.widthOfTextAtSize(ow, os), y: bottom + 2 + os * 0.35 }, thickness: 0.6, color: GRAY });
    }
    if (style.showSku && p.sku) {
      const ss = 7.5 * k;
      const sw = regular.widthOfTextAtSize(p.sku, ss);
      text(page, p.sku, x + w - pad - sw, bottom + 2, ss, regular, GRAY);
    }
  }

  return { doc, pages: layout.total, warnings: [...new Set(warnings)], toc: layout.toc };
}
