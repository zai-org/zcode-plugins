import QRCode from "qrcode";
import { createRaster, encodePng } from "./kit/raster.ts";

export const THEMES: Record<string, { label: [string, string]; bg: string; fg: string; sub: string; btn: string; btnFg: string; btnBorder: string; accent: string }> = {
  light: { label: ["简洁白", "Light"], bg: "#f8fafc", fg: "#0f172a", sub: "#475569", btn: "#ffffff", btnFg: "#0f172a", btnBorder: "#e2e8f0", accent: "#2563eb" },
  dark: { label: ["深色", "Dark"], bg: "#0b1120", fg: "#f1f5f9", sub: "#94a3b8", btn: "#1e293b", btnFg: "#f1f5f9", btnBorder: "#334155", accent: "#38bdf8" },
  sunset: { label: ["日落", "Sunset"], bg: "linear-gradient(160deg,#fde68a 0%,#fb923c 45%,#db2777 100%)", fg: "#ffffff", sub: "#fff7ed", btn: "rgba(255,255,255,.92)", btnFg: "#7c2d12", btnBorder: "transparent", accent: "#be185d" },
  forest: { label: ["森林", "Forest"], bg: "linear-gradient(180deg,#ecfdf5 0%,#d1fae5 100%)", fg: "#064e3b", sub: "#047857", btn: "#ffffff", btnFg: "#064e3b", btnBorder: "#a7f3d0", accent: "#059669" },
  ocean: { label: ["海洋", "Ocean"], bg: "linear-gradient(160deg,#0ea5e9 0%,#1e3a8a 100%)", fg: "#ffffff", sub: "#e0f2fe", btn: "rgba(255,255,255,.14)", btnFg: "#ffffff", btnBorder: "rgba(255,255,255,.45)", accent: "#fde047" },
  mono: { label: ["黑白", "Mono"], bg: "#ffffff", fg: "#111111", sub: "#555555", btn: "#111111", btnFg: "#ffffff", btnBorder: "#111111", accent: "#111111" },
};

const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function normalizeUrl(u: string): { url: string; fixed: boolean; bad: boolean } {
  const s = u.trim();
  if (!s) return { url: "", fixed: false, bad: true };
  if (/^(javascript|data|vbscript):/i.test(s)) return { url: "", fixed: false, bad: true };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return { url: s, fixed: false, bad: false };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { url: `mailto:${s}`, fixed: true, bad: false };
  if (/^\+?[\d\s-]{6,}$/.test(s)) return { url: `tel:${s.replace(/[\s-]/g, "")}`, fixed: true, bad: false };
  if (/^[\w-]+(\.[\w-]+)+/.test(s)) return { url: `https://${s}`, fixed: true, bad: false };
  return { url: s, fixed: false, bad: true };
}

export interface PageOpts { name: string; bio: string; avatar?: string; theme: string; shape: "rounded" | "pill" | "square"; footer: string; lang: string; pageUrl: string; qrSvg?: string; links: { title: string; url: string; icon: string; subtitle: string; highlight: boolean }[] }

export function renderPage(o: PageOpts): string {
  const t = THEMES[o.theme] ?? THEMES.light;
  const radius = o.shape === "pill" ? "999px" : o.shape === "square" ? "4px" : "14px";
  const links = o.links.map((l) => `<a class="link${l.highlight ? " hi" : ""}" href="${h(l.url)}"${/^https?:/i.test(l.url) ? ' target="_blank" rel="noopener"' : ""}>${l.icon ? `<span class="ic">${h(l.icon)}</span>` : ""}<span class="tx"><span class="t">${h(l.title)}</span>${l.subtitle ? `<span class="s">${h(l.subtitle)}</span>` : ""}</span></a>`).join("\n    ");
  return `<!doctype html>
<html lang="${h(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(o.name)}</title>
<meta name="description" content="${h(o.bio)}">
<meta property="og:title" content="${h(o.name)}">
<meta property="og:description" content="${h(o.bio)}">
${o.pageUrl ? `<meta property="og:url" content="${h(o.pageUrl)}">\n` : ""}<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:${t.bg};background-attachment:fixed;color:${t.fg};font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;padding:48px 16px}
main{width:100%;max-width:520px;text-align:center}
.av{width:104px;height:104px;border-radius:50%;object-fit:cover;border:3px solid ${t.btn};box-shadow:0 6px 20px rgba(0,0,0,.15)}
h1{font-size:24px;margin:14px 0 6px}.bio{color:${t.sub};margin:0 0 26px;line-height:1.5}
.link{display:flex;align-items:center;gap:12px;background:${t.btn};color:${t.btnFg};border:1.5px solid ${t.btnBorder};border-radius:${radius};padding:15px 18px;margin:0 0 12px;text-decoration:none;font-weight:600;transition:transform .15s,box-shadow .15s;text-align:left}
.link:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.12)}
.link.hi{border-color:${t.accent};box-shadow:0 0 0 3px ${t.accent}33}
.ic{font-size:20px;width:26px;text-align:center}.tx{flex:1;display:flex;flex-direction:column;align-items:center;margin-right:26px}.s{font-weight:400;font-size:13px;opacity:.75;margin-top:2px}
.qr{margin:28px auto 6px;width:120px;background:#fff;padding:8px;border-radius:10px}.qr svg{display:block;width:100%;height:auto}
footer{color:${t.sub};font-size:12px;margin-top:22px}
</style>
</head>
<body>
<main>
    ${o.avatar ? `<img class="av" src="${o.avatar}" alt="${h(o.name)}">` : ""}
    <h1>${h(o.name)}</h1>
    ${o.bio ? `<p class="bio">${h(o.bio)}</p>` : ""}
    ${links}
    ${o.qrSvg ? `<div class="qr" title="${h(o.pageUrl)}">${o.qrSvg}</div>` : ""}
    ${o.footer ? `<footer>${h(o.footer)}</footer>` : ""}
</main>
</body>
</html>
`;
}

export function qrSvg(text: string, dark = "#111111") {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = 2;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.modules.get(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="${dark}" d="${d}"/></svg>`;
}
export function qrPng(text: string, size = 600) {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size + 8;
  const scale = Math.max(1, Math.floor(size / n));
  const img = createRaster(n * scale, n * scale, [255, 255, 255, 255]);
  for (let y = 0; y < q.modules.size; y++) for (let x = 0; x < q.modules.size; x++) if (q.modules.get(y, x)) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + 4) * scale + dy) * img.width + (x + 4) * scale + dx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 17; }
  }
  return encodePng(img);
}
