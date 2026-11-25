// MJML → 邮件 HTML、检查、纯文本、变量。
import mjml2html, { type MjmlNode } from "mjml";
import { convert } from "html-to-text";

export interface Issue { severity: "error" | "warning" | "info"; check: string; message: string; line?: number }
export const GMAIL_CLIP = 102 * 1024;

const VAR = /\{\{\s*([A-Za-z_][\w.]*)\s*\}\}/g;
export const varsOf = (s: string) => [...new Set([...s.matchAll(VAR)].map((m) => m[1]))];

function hex(c: string | undefined): [number, number, number] | undefined {
  if (!c) return undefined;
  const s = c.trim().toLowerCase();
  const named: Record<string, string> = { white: "#ffffff", black: "#000000", red: "#ff0000", gray: "#808080", grey: "#808080" };
  const v = named[s] ?? s;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\((\d+)\D+(\d+)\D+(\d+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return undefined;
}
const lum = ([r, g, b]: [number, number, number]) => { const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export function contrast(a: string, b: string) { const x = hex(a), y = hex(b); if (!x || !y) return undefined; const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p); return (l1 + 0.05) / (l2 + 0.05); }

export interface Compiled { html: string; issues: Issue[]; vars: string[]; bytes: number; width: number; preview?: string; title?: string; json?: MjmlNode }

export async function compile(source: string): Promise<Compiled> {
  const issues: Issue[] = [];
  if (!/<mjml[\s>]/.test(source)) return { html: "", issues: [{ severity: "error", check: "mjml", message: "Not an MJML document: it must start with <mjml>." }], vars: [], bytes: 0, width: 600 };
  let r: Awaited<ReturnType<typeof mjml2html>>;
  try { r = await mjml2html(source, { validationLevel: "soft", keepComments: false }); } catch (e) {
    return { html: "", issues: [{ severity: "error", check: "mjml", message: (e as Error).message.split("\n")[0] }], vars: varsOf(source), bytes: 0, width: 600 };
  }
  for (const e of r.errors) issues.push({ severity: "error", check: "mjml", message: e.message, line: e.line });
  const root = r.json;
  const find = (n: MjmlNode | undefined, tag: string): MjmlNode | undefined => !n ? undefined : n.tagName === tag ? n : (n.children ?? []).map((c) => find(c, tag)).find(Boolean);
  const head = find(root, "mj-head"), body = find(root, "mj-body");
  const width = parseInt(body?.attributes?.width ?? "600", 10) || 600;
  if (width > 600) issues.push({ severity: "warning", check: "width", message: `Body is ${width}px wide; keep emails at 600px or less — wider layouts get cut off or scaled in Outlook and Gmail.`, line: body?.line });
  const preview = find(head, "mj-preview")?.content?.trim();
  if (!preview) issues.push({ severity: "warning", check: "preheader", message: "No <mj-preview>: inboxes will show the first text of the email as the preview line." });
  const title = find(head, "mj-title")?.content?.trim();
  // mj-attributes 默认值
  const defaults: Record<string, Record<string, string>> = {};
  for (const c of find(head, "mj-attributes")?.children ?? []) defaults[c.tagName] = { ...(defaults[c.tagName] ?? {}), ...c.attributes };
  const attr = (n: MjmlNode, k: string, fallback?: string) => n.attributes?.[k] ?? defaults[n.tagName]?.[k] ?? defaults["mj-all"]?.[k] ?? fallback;
  const styles = (find(head, "mj-style")?.content ?? "") + [...(head?.children ?? [])].filter((c) => c.tagName === "mj-style").map((c) => c.content ?? "").join("\n");
  if (!/prefers-color-scheme\s*:\s*dark/.test(styles)) issues.push({ severity: "warning", check: "dark-mode", message: "No dark-mode styles (@media (prefers-color-scheme: dark) in <mj-style>). Apple Mail and Outlook will invert colours on their own; check the dark preview." });
  let unsub = false;
  const walk = (n: MjmlNode, bg: string) => {
    const nbg = n.attributes?.["background-color"] && n.tagName !== "mj-button" ? n.attributes["background-color"] : bg;
    if (n.tagName === "mj-image") {
      const src = n.attributes.src ?? "";
      if (n.attributes.alt === undefined) issues.push({ severity: "warning", check: "alt", message: `Image ${src || "(no src)"} has no alt text; many clients block images by default.`, line: n.line });
      checkSrc(src, n.line);
      const w = parseInt(n.attributes.width ?? "", 10);
      if (w > width) issues.push({ severity: "warning", check: "width", message: `Image ${src} is ${w}px wide, wider than the ${width}px body.`, line: n.line });
    }
    if (n.tagName === "mj-button") {
      const href = n.attributes.href;
      checkHref(href, n.line, "Button");
      const c = contrast(attr(n, "color", "#ffffff")!, attr(n, "background-color", "#414141")!);
      if (c !== undefined && c < 4.5) issues.push({ severity: "warning", check: "contrast", message: `Button text contrast is ${c.toFixed(1)}:1 (aim for 4.5:1).`, line: n.line });
    }
    if (n.tagName === "mj-text" || n.tagName === "mj-table") {
      const c = contrast(attr(n, "color", "#000000")!, nbg);
      if (c !== undefined && c < 4.5) issues.push({ severity: "warning", check: "contrast", message: `Text colour ${attr(n, "color", "#000000")} on ${nbg} has contrast ${c.toFixed(1)}:1 (aim for 4.5:1).`, line: n.line });
    }
    if (n.content) {
      for (const m of n.content.matchAll(/<img\b[^>]*>/gi)) {
        const src = (/\ssrc="([^"]*)"/.exec(m[0]) ?? [])[1] ?? "";
        if (!/\salt=/.test(m[0])) issues.push({ severity: "warning", check: "alt", message: `Image ${src} has no alt text.`, line: n.line });
        checkSrc(src, n.line);
      }
      for (const m of n.content.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
        checkHref((/\shref="([^"]*)"/.exec(m[0]) ?? [])[1], n.line, "Link");
        if (/unsubscribe|退订|取消订阅/i.test(m[0])) unsub = true;
      }
      if (/unsubscribe|退订|取消订阅/i.test(n.content)) unsub = true;
    }
    for (const c of n.children ?? []) walk(c, nbg);
  };
  function checkSrc(src: string, line?: number) {
    if (!src) issues.push({ severity: "error", check: "image", message: "Image without src.", line });
    else if (/^\{\{/.test(src)) return;
    else if (/^http:\/\//.test(src)) issues.push({ severity: "warning", check: "image", message: `${src} uses http://; use https:// or the image may be blocked.`, line });
    else if (!/^https:\/\//.test(src) && !/^cid:/.test(src)) issues.push({ severity: "error", check: "image", message: `${src} is a local path. Email images must be hosted at a public https URL (upload them to your email service or CDN).`, line });
  }
  function checkHref(href: string | undefined, line: number | undefined, what: string) {
    if (!href || href === "#" || /^javascript:/i.test(href)) issues.push({ severity: "warning", check: "link", message: `${what} has no real link (href="${href ?? ""}").`, line });
    else if (/^http:\/\//.test(href)) issues.push({ severity: "warning", check: "link", message: `${what} link ${href} uses http://.`, line });
  }
  if (body) walk(body, body.attributes?.["background-color"] ?? "#ffffff");
  if (!unsub) issues.push({ severity: "info", check: "unsubscribe", message: "No unsubscribe link found. Marketing emails need one (e.g. {{unsubscribe_url}}); transactional emails may skip it." });

  let html = r.html;
  if (/prefers-color-scheme/.test(html) && !/name="color-scheme"/.test(html)) html = html.replace(/<head>/i, '<head>\n<meta name="color-scheme" content="light dark">\n<meta name="supported-color-schemes" content="light dark">');
  const bytes = Buffer.byteLength(html);
  if (bytes > GMAIL_CLIP) issues.push({ severity: "error", check: "size", message: `HTML is ${(bytes / 1024).toFixed(1)} KB; Gmail clips messages over 102 KB ("[Message clipped]").` });
  else if (bytes > 80 * 1024) issues.push({ severity: "warning", check: "size", message: `HTML is ${(bytes / 1024).toFixed(1)} KB, close to Gmail's 102 KB clipping limit.` });
  return { html, issues, vars: varsOf(source), bytes, width, ...(preview ? { preview } : {}), ...(title ? { title } : {}), json: root };
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]!);
/** 用样例数据替换 {{变量}}；缺的保留原样并返回列表。 */
export function fill(html: string, data: Record<string, unknown>) {
  const missing = new Set<string>();
  const get = (k: string) => k.split(".").reduce<unknown>((o, p) => (o && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined), data);
  const out = html.replace(VAR, (m, k: string) => { const v = get(k); if (v === undefined || v === null) { missing.add(k); return m; } return escHtml(String(v)); });
  return { html: out, missing: [...missing] };
}

/** 纯文本版：去掉预览行和隐藏内容，链接写成 文字 [网址]。 */
export function plainText(html: string) {
  const clean = html.replace(/<div style="display:none;font-size:1px[^"]*"[^>]*>[\s\S]*?<\/div>/i, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<\/td>/gi, "&nbsp;&nbsp;</td>");
  return convert(clean, {
    wordwrap: 78,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true, linkBrackets: ["[", "]"] } },
      { selector: "table", format: "block" }, { selector: "tr", format: "block" }, { selector: "td", format: "inline" },
      { selector: "h1", options: { uppercase: false } }, { selector: "h2", options: { uppercase: false } },
    ],
  }).replace(/[ \t\u00a0]+\n/g, "\n").replace(/^[^\S\n\u200a-\u200d\u00a0]*[\u200a-\u200d\u00a0][^\S\n\u200a-\u200d\u00a0]*$/gm, "").replace(/^[^\S\n]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function starter(name: string, brand: { accent?: string; background?: string; text?: string } = {}) {
  const accent = brand.accent ?? "#2563eb", bg = brand.background ?? "#f3f4f6", text = brand.text ?? "#1f2937";
  return `<mjml>
  <mj-head>
    <mj-title>${escHtml(name)}</mj-title>
    <mj-preview>{{preheader}}</mj-preview>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="16px" line-height="1.6" color="${text}" />
    </mj-attributes>
    <mj-style>
      @media (prefers-color-scheme: dark) {
        .dark-bg { background-color: #111827 !important; }
        .dark-text div { color: #f3f4f6 !important; }
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="${bg}" width="600px">
    <mj-section padding="24px">
      <mj-column>
        <mj-text align="center" font-size="22px" font-weight="bold">${escHtml(name)}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="32px 32px 24px" css-class="dark-bg">
      <mj-column>
        <mj-text font-size="24px" font-weight="bold" css-class="dark-text">Hi {{first_name}},</mj-text>
        <mj-text css-class="dark-text">Write the main message here.</mj-text>
        <mj-button href="{{cta_url}}" background-color="${accent}" color="#ffffff" border-radius="6px">Call to action</mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="24px">
      <mj-column>
        <mj-text align="center" font-size="12px" color="#4b5563">You are receiving this email because you signed up.<br /><a href="{{unsubscribe_url}}" style="color:#4b5563;">Unsubscribe</a></mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;
}
