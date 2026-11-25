import { mix, readableOn } from "./kit/color.ts";
import { parseColor } from "./kit/raster.ts";
import { escapeXml, fitTextBlock, textSvg, type FontSet } from "./kit/render.ts";

export type Frame = "auto" | "iphone" | "android" | "none";

export interface Preset {
  id: string;
  label: string;
  width: number;
  height: number;
  device: "phone" | "tablet";
  store: "app-store" | "google-play";
}

export const PRESETS: Preset[] = [
  { id: "ios-6.9", label: "iPhone 6.9″ 1320×2868", width: 1320, height: 2868, device: "phone", store: "app-store" },
  { id: "ios-6.5", label: "iPhone 6.5″ 1284×2778", width: 1284, height: 2778, device: "phone", store: "app-store" },
  { id: "ios-5.5", label: "iPhone 5.5″ 1242×2208", width: 1242, height: 2208, device: "phone", store: "app-store" },
  { id: "ipad-13", label: "iPad 13″ 2064×2752", width: 2064, height: 2752, device: "tablet", store: "app-store" },
  { id: "play-phone", label: "Google Play phone 1080×1920", width: 1080, height: 1920, device: "phone", store: "google-play" },
  { id: "play-tablet", label: "Google Play 10″ tablet 1600×2560", width: 1600, height: 2560, device: "tablet", store: "google-play" },
];

export interface Theme {
  background: string;
  /** 设置后为上下渐变。 */
  background2?: string;
  textColor: string;
  frame: Frame;
  frameColor: string;
  textPosition: "top" | "bottom";
  deviceScale: number;
  /** 设备超出画布底部（或顶部），更有冲击力。 */
  bleed: boolean;
  titleScale: number;
}

export const DEFAULT_THEME: Theme = {
  background: "#eef2ff",
  background2: "#c7d2fe",
  textColor: "auto",
  frame: "auto",
  frameColor: "#111111",
  textPosition: "top",
  deviceScale: 0.78,
  bleed: false,
  titleScale: 1,
};

export interface SlideText {
  title?: string;
  subtitle?: string;
}

export interface Slide {
  image: string;
  /** 平板尺寸使用的截图（可选）。 */
  tabletImage?: string;
  text: Record<string, SlideText>;
  background?: string;
  background2?: string;
}

export interface ScreenImage {
  href: string;
  width: number;
  height: number;
  /** 原始截图像素宽度（判断清晰度）。 */
  sourceWidth: number;
}

const isHex = (v: unknown): v is string => typeof v === "string" && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const hex = (v: string) => (v.startsWith("#") ? v : `#${v}`).toLowerCase();

export function normalizeTheme(value: Partial<Theme> | undefined): Theme {
  const t = { ...DEFAULT_THEME };
  if (!value) return t;
  if (isHex(value.background)) t.background = hex(value.background);
  if (value.background2 === "" || value.background2 === null) t.background2 = undefined;
  else if (isHex(value.background2)) t.background2 = hex(value.background2);
  if (isHex(value.textColor)) t.textColor = hex(value.textColor);
  if (isHex(value.frameColor)) t.frameColor = hex(value.frameColor);
  if (value.frame && ["auto", "iphone", "android", "none"].includes(value.frame)) t.frame = value.frame;
  if (value.textPosition === "bottom") t.textPosition = "bottom";
  if (typeof value.deviceScale === "number") t.deviceScale = Math.min(0.95, Math.max(0.5, value.deviceScale));
  if (typeof value.bleed === "boolean") t.bleed = value.bleed;
  if (typeof value.titleScale === "number") t.titleScale = Math.min(1.6, Math.max(0.6, value.titleScale));
  return t;
}

/** 生成一张商店截图的 SVG。 */
export function slideSvg(options: { preset: Preset; theme: Theme; slide: Slide; locale: string; locales: string[]; screen: ScreenImage; fonts: FontSet; usingPhoneOnTablet?: boolean }) {
  const { preset, slide, screen, fonts } = options;
  const theme = { ...options.theme, ...(isHex(slide.background) ? { background: slide.background, background2: isHex(slide.background2) ? slide.background2 : undefined } : {}) };
  const W = preset.width;
  const H = preset.height;
  const warnings: string[] = [];
  const text = slide.text[options.locale] ?? {};
  const fallback = slide.text[options.locales[0]] ?? {};
  if (!text.title && !text.subtitle && (fallback.title || fallback.subtitle)) warnings.push("missing_translation");
  const title = (text.title ?? (text.subtitle ? "" : fallback.title) ?? "").trim();
  const subtitle = (text.subtitle ?? (text.title ? "" : fallback.subtitle) ?? "").trim();
  const bgA = parseColor(theme.background);
  const bgB = theme.background2 ? parseColor(theme.background2) : bgA;
  const ink = theme.textColor === "auto" ? readableOn(mix(bgA, bgB, theme.textPosition === "top" ? 0.15 : 0.85)) : theme.textColor;
  const parts: string[] = [];
  parts.push(
    theme.background2
      ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.background}"/><stop offset="1" stop-color="${theme.background2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>`
      : `<rect width="${W}" height="${H}" fill="${theme.background}"/>`,
  );

  // 文字区。
  const unit = Math.min(W, H * 0.62);
  const margin = H * 0.05;
  const textW = W * 0.86;
  const titleBox = { width: textW, height: H * 0.11 };
  const titleFit = title
    ? fitTextBlock(title, titleBox, { size: Math.round(unit * 0.085 * theme.titleScale), minSize: Math.round(unit * 0.045), maxLines: 2, lineHeight: 1.2 }, (t, s) => fonts.measure(t, s, true))
    : undefined;
  const subFit = subtitle
    ? fitTextBlock(subtitle, { width: textW, height: H * 0.07 }, { size: Math.round(unit * 0.05 * theme.titleScale), minSize: Math.round(unit * 0.032), maxLines: 2, lineHeight: 1.3 }, (t, s) => fonts.measure(t, s))
    : undefined;
  if (titleFit?.overflow) warnings.push("title_too_long");
  if (subFit?.overflow) warnings.push("subtitle_too_long");
  const titleH = titleFit ? titleFit.lines.length * titleFit.size * 1.2 : 0;
  const gap = titleFit && subFit ? unit * 0.025 : 0;
  const subH = subFit ? subFit.lines.length * subFit.size * 1.3 : 0;
  const textH = titleH + gap + subH;
  const textTop = theme.textPosition === "top" ? margin + Math.max(0, (H * 0.16 - textH) / 2) : H - margin - textH - Math.max(0, (H * 0.16 - textH) / 2);

  // 设备区。
  const tablet = preset.device === "tablet";
  const frame: Exclude<Frame, "auto"> = theme.frame === "auto" ? "iphone" : theme.frame;
  const aspect = screen.height / screen.width;
  const areaTop = theme.textPosition === "top" ? margin + Math.max(textH, H * 0.16) + H * 0.035 : (theme.bleed ? 0 : margin);
  const areaBottom = theme.textPosition === "top" ? (theme.bleed ? H : H - margin) : H - margin - Math.max(textH, H * 0.16) - H * 0.035;
  const bezelK = frame === "none" ? 0 : tablet ? 0.03 : 0.035;
  let screenW = (W * theme.deviceScale) / (1 + bezelK * 2);
  let screenH = screenW * aspect;
  const outerH = (h: number, w: number) => h + w * bezelK * 2;
  if (!theme.bleed && outerH(screenH, screenW) > areaBottom - areaTop) {
    screenW = (areaBottom - areaTop) / (aspect + bezelK * 2);
    screenH = screenW * aspect;
  }
  const bezel = screenW * bezelK;
  const deviceW = screenW + bezel * 2;
  const deviceH = screenH + bezel * 2;
  const dx = (W - deviceW) / 2;
  const dy = theme.textPosition === "top" ? areaTop : theme.bleed ? areaBottom - deviceH : areaTop + (areaBottom - areaTop - deviceH) / 2;
  const sx = dx + bezel;
  const sy = dy + bezel;
  const screenR = frame === "none" ? screenW * 0.045 : tablet ? screenW * 0.035 : frame === "android" ? screenW * 0.075 : screenW * 0.115;
  const outerR = screenR + bezel;
  if (screen.sourceWidth < screenW * 0.6) warnings.push("low_resolution");
  if (options.usingPhoneOnTablet) warnings.push("phone_screenshot_on_tablet");

  const shadowBlur = deviceW * 0.03;
  parts.push(
    `<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="${(shadowBlur * 0.6).toFixed(1)}" stdDeviation="${shadowBlur.toFixed(1)}" flood-color="#000000" flood-opacity="0.22"/></filter>` +
      `<clipPath id="screen"><rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${screenW.toFixed(1)}" height="${screenH.toFixed(1)}" rx="${screenR.toFixed(1)}"/></clipPath></defs>`,
  );
  if (frame !== "none") {
    parts.push(`<rect x="${dx.toFixed(1)}" y="${dy.toFixed(1)}" width="${deviceW.toFixed(1)}" height="${deviceH.toFixed(1)}" rx="${outerR.toFixed(1)}" fill="${theme.frameColor}" filter="url(#shadow)"/>`);
    // 边框高光，让深色机身在深色背景上也能看清轮廓。
    const edge = readableOn(theme.frameColor) === "#ffffff" ? "#ffffff" : "#000000";
    parts.push(`<rect x="${(dx + bezel * 0.18).toFixed(1)}" y="${(dy + bezel * 0.18).toFixed(1)}" width="${(deviceW - bezel * 0.36).toFixed(1)}" height="${(deviceH - bezel * 0.36).toFixed(1)}" rx="${(outerR - bezel * 0.18).toFixed(1)}" fill="none" stroke="${edge}" stroke-opacity="0.18" stroke-width="${(bezel * 0.12).toFixed(1)}"/>`);
  } else {
    parts.push(`<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${screenW.toFixed(1)}" height="${screenH.toFixed(1)}" rx="${screenR.toFixed(1)}" fill="#ffffff" filter="url(#shadow)"/>`);
  }
  parts.push(`<g clip-path="url(#screen)"><rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${screenW.toFixed(1)}" height="${screenH.toFixed(1)}" fill="#ffffff"/><image href="${screen.href}" x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${screenW.toFixed(1)}" height="${screenH.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/></g>`);
  if (frame === "iphone" && !tablet) {
    const iw = screenW * 0.3;
    const ih = screenW * 0.088;
    parts.push(`<rect x="${(sx + (screenW - iw) / 2).toFixed(1)}" y="${(sy + screenW * 0.03).toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}" rx="${(ih / 2).toFixed(1)}" fill="#000000"/>`);
  } else if (frame === "android" && !tablet) {
    const r = screenW * 0.022;
    parts.push(`<circle cx="${(sx + screenW / 2).toFixed(1)}" cy="${(sy + screenW * 0.045).toFixed(1)}" r="${r.toFixed(1)}" fill="#000000"/>`);
  }

  // 文字放在最上层（设备出血时不被遮住）。
  if (titleFit) parts.push(textSvg(titleFit.lines, { x: W / 2, y: textTop, size: titleFit.size, color: ink, family: fonts.boldFamily ?? fonts.family, weight: 700, anchor: "middle", lineHeight: 1.2, boldStroke: !fonts.boldFamily }));
  if (subFit) parts.push(textSvg(subFit.lines, { x: W / 2, y: textTop + titleH + gap, size: subFit.size, color: ink, family: fonts.family, anchor: "middle", lineHeight: 1.3 }));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
  return { svg, warnings, background: theme.background };
}

export const WARNING_TEXT: Record<string, string> = {
  missing_translation: "no text for this language — the first language's text is used",
  title_too_long: "headline is too long and was shortened",
  subtitle_too_long: "subheadline is too long and was shortened",
  low_resolution: "screenshot resolution is low for this size — it will look blurry",
  phone_screenshot_on_tablet: "tablet size uses a phone screenshot — add a tablet screenshot (tabletImage) for iPad / tablet listings",
};

export const xml = escapeXml;
