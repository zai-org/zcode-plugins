import QRCode from "qrcode";
import { createRaster, decodeImage, drawOver, encodePng, resize, type Raster } from "./kit/raster.ts";
import { KitError } from "./kit/workspace.ts";

export type Kind = "url" | "text" | "wifi" | "vcard" | "email" | "phone" | "sms";
export const KINDS: Kind[] = ["url", "text", "wifi", "vcard", "email", "phone", "sms"];
const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
const vEsc = (s: string) => s.replace(/([\\;,])/g, "\\$1");

/** 把一行内容转成二维码里的文字（WiFi/名片等按通用格式）。 */
export function payload(kindIn: string, content: string): { text: string; warn?: string } {
  const kind = (KINDS.includes(kindIn as Kind) ? kindIn : guess(content)) as Kind;
  const c = content.trim();
  const parts = c.split(/\s*[;；]\s*/);
  switch (kind) {
    case "url": {
      if (/^[a-z][a-z0-9+.-]*:/i.test(c)) return { text: c };
      return { text: `https://${c}`, warn: `No http(s):// — added https:// / 已自动补上 https://` };
    }
    case "wifi": {
      const [ssid, pass = "", sec = pass ? "WPA" : "nopass", hidden = ""] = parts;
      if (!ssid) return { text: "", warn: "WiFi needs “network;password;WPA” / WiFi 格式：名称;密码;WPA" };
      return { text: `WIFI:T:${/^(wep)$/i.test(sec) ? "WEP" : /nopass|none|open|无/i.test(sec) ? "nopass" : "WPA"};S:${wifiEsc(ssid)};${pass ? `P:${wifiEsc(pass)};` : ""}${/^(true|hidden|隐藏)$/i.test(hidden) ? "H:true;" : ""};` };
    }
    case "vcard": {
      const [name = "", tel = "", email = "", org = "", title = "", url = ""] = parts;
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vEsc(name)}`, `N:${vEsc(name)};;;;`];
      if (org) lines.push(`ORG:${vEsc(org)}`);
      if (title) lines.push(`TITLE:${vEsc(title)}`);
      if (tel) lines.push(`TEL;TYPE=CELL:${tel.replace(/[^\d+]/g, "")}`);
      if (email) lines.push(`EMAIL:${email}`);
      if (url) lines.push(`URL:${url}`);
      lines.push("END:VCARD");
      return { text: lines.join("\r\n"), warn: name ? undefined : "Card needs “name;phone;email;company” / 名片格式：姓名;电话;邮箱;公司" };
    }
    case "email": return { text: c.startsWith("mailto:") ? c : `mailto:${c}` };
    case "phone": return { text: `tel:${c.replace(/[^\d+]/g, "")}` };
    case "sms": { const [num = "", body = ""] = parts; return { text: `SMSTO:${num.replace(/[^\d+]/g, "")}:${body}` }; }
    default: return { text: c };
  }
}

export function guess(c: string): Kind {
  if (/^(https?:\/\/|www\.)/i.test(c) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(c)) return "url";
  if (/^[^@\s]+@[^@\s]+\.\w+$/.test(c)) return "email";
  if (/^\+?[\d\s()-]{6,}$/.test(c)) return "phone";
  return "text";
}

export interface Style { ecc: "L" | "M" | "Q" | "H"; fg: string; bg: string; margin: number; size: number }

export function matrix(text: string, ecc: Style["ecc"]) {
  try {
    const q = QRCode.create(text, { errorCorrectionLevel: ecc });
    return { size: q.modules.size, data: q.modules.data as unknown as Uint8Array, version: q.version };
  } catch (e) {
    throw new KitError("too_long", `Content too long for a QR code at level ${ecc} (${text.length} chars): ${(e as Error).message}`);
  }
}

export function svg(text: string, s: Style, label?: string) {
  const m = matrix(text, s.ecc);
  const n = m.size + s.margin * 2;
  let d = "";
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.data[y * m.size + x]) d += `M${x + s.margin} ${y + s.margin}h1v1h-1z`;
  const lh = label ? 3 : 0;
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n + lh}" shape-rendering="crispEdges"><rect width="${n}" height="${n + lh}" fill="${s.bg}"/><path d="${d}" fill="${s.fg}"/>${label ? `<text x="${n / 2}" y="${n + 1.2}" font-size="1.8" text-anchor="middle" fill="${s.fg}" font-family="sans-serif">${esc(label)}</text>` : ""}</svg>`;
}

const rgb = (hex: string): [number, number, number] => { const v = parseInt(hex.replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

export function png(text: string, s: Style, logo?: Raster): Buffer {
  const m = matrix(text, s.ecc);
  const n = m.size + s.margin * 2;
  const scale = Math.max(1, Math.floor(s.size / n));
  const px = n * scale;
  const [br, bgc, bb] = rgb(s.bg), [fr, fgc, fb] = rgb(s.fg);
  const img = createRaster(px, px, [br, bgc, bb, 255]);
  for (let y = 0; y < m.size; y++)
    for (let x = 0; x < m.size; x++)
      if (m.data[y * m.size + x])
        for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
          const o = (((y + s.margin) * scale + yy) * px + (x + s.margin) * scale + xx) * 4;
          img.data[o] = fr; img.data[o + 1] = fgc; img.data[o + 2] = fb; img.data[o + 3] = 255;
        }
  if (logo) {
    const box = Math.round(m.size * scale * (m.size > 40 ? 0.16 : 0.2));
    const pad = Math.max(2, Math.round(box * 0.12));
    const fitted = resize(logo, box, Math.round((box * logo.height) / logo.width));
    const ox = Math.round((px - box) / 2), oy = Math.round((px - fitted.height) / 2);
    const plate = createRaster(box + pad * 2, fitted.height + pad * 2, [br, bgc, bb, 255]);
    drawOver(img, plate, ox - pad, oy - pad);
    drawOver(img, fitted, ox, oy);
  }
  return encodePng(img);
}

export const loadLogo = (bytes: Uint8Array, name: string) => decodeImage(bytes, name);

export function luminance(hex: string) {
  const c = rgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
