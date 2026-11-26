import YAML from "yaml";
import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { createRaster, decodeImage, encodeJpeg, resize } from "./kit/raster.ts";
import { KitError } from "./kit/workspace.ts";
import { normalizeUrl, qrPng, qrSvg, renderPage, THEMES } from "./page.ts";

export const NAME = "link-page-builder";
export const VERSION = "0.1.0";

const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "");
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function avatarData(ws: { read: (p: string, m?: number) => Promise<Buffer> }, path: string): Promise<string> {
  const img = decodeImage(new Uint8Array(await ws.read(path, 30 * 1024 * 1024)), path);
  const s = Math.min(img.width, img.height), ox = Math.floor((img.width - s) / 2), oy = Math.floor((img.height - s) / 2);
  const sq = createRaster(s, s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const a = ((y + oy) * img.width + x + ox) * 4, b = (y * s + x) * 4; for (let k = 0; k < 4; k++) sq.data[b + k] = img.data[a + k]; }
  return `data:image/jpeg;base64,${encodeJpeg(s > 320 ? resize(sq, 320, 320) : sq, 85).toString("base64")}`;
}

function opts(p: Project, withQr: boolean) {
  const links = p.rows.filter((r) => r.include !== false && String(r.title ?? "").trim()).map((r) => ({ title: String(r.title), url: normalizeUrl(String(r.url ?? "")).url, icon: String(r.icon ?? ""), subtitle: String(r.subtitle ?? ""), highlight: Boolean(r.highlight) })).filter((l) => l.url);
  const pageUrl = String(p.settings.pageUrl ?? "").trim();
  return { name: String(p.settings.name || "My links"), bio: String(p.settings.bio ?? ""), avatar: p.meta.avatar as string | undefined, theme: String(p.settings.theme ?? "light"), shape: (String(p.settings.shape ?? "rounded")) as "rounded" | "pill" | "square", footer: String(p.settings.footer ?? ""), lang: String(p.settings.lang || "zh-CN"), pageUrl, qrSvg: withQr && pageUrl && p.settings.showQr !== false ? qrSvg(pageUrl) : undefined, links };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "linkpage",
  title: ["个人链接主页", "Link Page Builder"],
  openDescription:
    "Make a single-file personal “link in bio” page: profile name, bio, round avatar (cropped and embedded, no external files), a list of link buttons (title, URL, optional emoji icon and subtitle, highlight), 6 themes (light, dark, sunset, forest, ocean, mono) and 3 button shapes. Start from a links.yaml/.json (name, bio, avatar, theme, links: [{title, url, icon, subtitle, highlight, hidden}]) or a CSV with title,url columns. URLs are checked and fixed (adds https://, mailto: for emails, tel: for phones; javascript: is refused). Exports index.html (no scripts, no external requests — upload anywhere) and a QR code PNG/SVG of the page address.",
  inputs: { exts: [".yaml", ".yml", ".json", ".csv"], min: 1, max: 1, label: ["选择链接清单（links.yaml / .json / .csv）", "Pick the links file (links.yaml / .json / .csv)"] },
  settings: [
    { key: "name", label: ["名字", "Name"], type: "text", default: "" },
    { key: "bio", label: ["简介", "Bio"], type: "textarea", default: "" },
    { key: "theme", label: ["主题", "Theme"], type: "select", default: "light", options: Object.entries(THEMES).map(([value, t]) => ({ value, label: t.label })) },
    { key: "shape", label: ["按钮形状", "Button shape"], type: "select", default: "rounded", options: [{ value: "rounded", label: ["圆角", "Rounded"] }, { value: "pill", label: ["胶囊", "Pill"] }, { value: "square", label: ["方角", "Square"] }] },
    { key: "avatar", label: ["头像图片（工作区路径）", "Avatar image (workspace path)"], type: "text", default: "", reload: true },
    { key: "pageUrl", label: ["主页上线后的网址（用于二维码）", "Page address once online (for the QR code)"], type: "text", default: "" },
    { key: "showQr", label: ["页面底部显示二维码", "Show QR code on the page"], type: "bool", default: false },
    { key: "footer", label: ["页脚文字", "Footer text"], type: "text", default: "" },
    { key: "lang", label: ["页面语言", "Page language"], type: "text", default: "zh-CN" },
  ],
  columns: () => [
    { key: "include", label: ["显示", "Show"], type: "bool" },
    { key: "icon", label: ["图标（表情）", "Icon (emoji)"] },
    { key: "title", label: ["按钮文字", "Button text"], wide: true },
    { key: "url", label: ["链接", "Link"], wide: true },
    { key: "subtitle", label: ["小字说明", "Subtitle"] },
    { key: "highlight", label: ["突出", "Highlight"], type: "bool" },
  ],
  newRow: () => ({ include: true, icon: "", title: "", url: "", subtitle: "", highlight: false }),
  async load({ ws, files, settings, previous }) {
    const f = files[0];
    const text = (await ws.read(f, 5 * 1024 * 1024)).toString("utf8").replace(/^\uFEFF/, "");
    let data: Record<string, unknown> = {};
    let list: Record<string, unknown>[] = [];
    if (/\.csv$/i.test(f)) {
      const [head, ...rest] = parseCsv(text);
      const idx = (re: RegExp) => head.findIndex((h) => re.test(h.trim()));
      const ti = idx(/^(title|name|标题|名称|文字)$/i), ui = idx(/^(url|link|链接|网址)$/i);
      if (ui < 0) throw new KitError("bad_csv", "The CSV needs a url (链接) column.");
      list = rest.map((r) => ({ title: r[ti >= 0 ? ti : ui], url: r[ui], icon: r[idx(/^(icon|图标)$/i)] ?? "", subtitle: r[idx(/^(subtitle|说明)$/i)] ?? "" }));
    } else {
      try { data = (/\.json$/i.test(f) ? JSON.parse(text) : YAML.parse(text)) ?? {}; } catch (e) { throw new KitError("bad_file", `${f}: ${(e as Error).message.split("\n")[0]}`); }
      if (Array.isArray(data)) { list = data as Record<string, unknown>[]; data = {}; } else list = (data.links as Record<string, unknown>[]) ?? [];
    }
    for (const k of ["name", "bio", "avatar", "footer", "pageUrl"]) if (!settings[k] && data[k] !== undefined) settings[k] = String(data[k]);
    if (data.theme && (!settings.theme || settings.theme === "light") && !previous) settings.theme = String(data.theme);
    if (!THEMES[String(settings.theme)]) settings.theme = "light";
    const rows: Row[] = previous?.length ? previous : list.map((l) => ({ include: !(l.hidden === true), icon: String(l.icon ?? ""), title: String(l.title ?? l.name ?? ""), url: String(l.url ?? l.link ?? ""), subtitle: String(l.subtitle ?? l.description ?? ""), highlight: l.highlight === true }));
    let avatar: string | undefined;
    const av = String(settings.avatar ?? "").trim();
    if (av) {
      const path = av.includes("/") || !dirOf(f) ? av : dirOf(f) + av;
      try { avatar = await avatarData(ws, (await ws.exists(path)) ? path : av); } catch (e) { throw new KitError("bad_avatar", `Avatar ${av}: ${(e as Error).message}`); }
    }
    return { rows, meta: { avatar } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const rows = p.rows.map((r, i) => {
      if (r.include === false) return r;
      if (!String(r.title ?? "").trim()) issues.push({ level: "warn", row: i, key: "title", message: `Row ${i + 1}: no button text — it will be left out.` });
      const n = normalizeUrl(String(r.url ?? ""));
      if (n.bad) issues.push({ level: "error", row: i, key: "url", message: `${r.title || `Row ${i + 1}`}: “${r.url}” is not a usable link.` });
      else if (n.fixed) issues.push({ level: "info", row: i, key: "url", message: `${r.title}: will link to ${n.url}.` });
      return r;
    });
    if (!String(p.settings.name ?? "").trim()) issues.push({ level: "warn", key: "name", message: "Add your name — it's the page title." });
    if (p.settings.showQr && !String(p.settings.pageUrl ?? "").trim()) issues.push({ level: "warn", key: "pageUrl", message: "Set the page address to show a QR code." });
    const o = opts(p, true);
    const html = renderPage(o);
    const preview = `<iframe sandbox="" style="width:100%;height:640px;border:1px solid #e5e7eb;border-radius:12px" srcdoc="${esc(html)}"></iframe>`;
    return { rows, issues, preview, summary: `${o.links.length} link(s) · theme ${p.settings.theme}`, stats: { links: o.links.length } };
  },
  exports: [
    {
      id: "page", label: ["主页 index.html", "Page (index.html)"], description: "index.html — one self-contained file (avatar embedded, no scripts or external requests)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        return [await write("index.html", renderPage(opts(project, true)))];
      },
    },
    {
      id: "qr", label: ["主页二维码", "QR code"], description: "qr.png and qr.svg of the page address (needs the page address setting)",
      async run({ project, write }: ExportCtx) {
        const url = String(project.settings.pageUrl ?? "").trim();
        if (!url) return { files: [], note: "No page address set — skipped the QR code." };
        return [await write("qr.png", qrPng(url)), await write("qr.svg", qrSvg(url))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
