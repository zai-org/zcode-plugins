import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { ROOT, capture, diffHtml, diffParagraphs, readIndex, type Capture, type Entry } from "./archive.ts";
import { checkUrl } from "./fetch.ts";
import { findBrowser, screenshot } from "./screenshot.ts";

export const NAME = "web-archiver";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
  browserPath?: string;
}

const change = (c: Capture) => (c.change ? (c.change.unchanged ? "text unchanged" : `+${c.change.added} −${c.change.removed} ~${c.change.changed} paragraph(s) vs ${c.change.from.split("/").pop()}`) : "first capture");

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
  });
  const browser = () => findBrowser(options.browserPath ?? process.env.WEB_ARCHIVER_BROWSER);

  const findCapture = async (dir: string) => {
    const index = await readIndex(ws);
    for (const e of index.entries) for (const [i, c] of e.captures.entries()) if (c.dir === dir.replace(/\/+$/, "")) return { entry: e, capture: c, i };
    throw new KitError("not_found", `No capture at ${dir}; archive_list shows them`);
  };
  const entryFor = async (url: string): Promise<Entry> => {
    const index = await readIndex(ws);
    const u = checkUrl(url).href;
    const e = index.entries.find((x) => x.url === u || x.captures.some((c) => c.finalUrl === u));
    if (!e) throw new KitError("not_found", `${url} has not been captured`);
    return e;
  };

  tool(
    "archive_capture",
    {
      description:
        "Capture web pages the user gives (http/https only; nothing else is fetched except the images inside each article). For each URL: download the HTML, extract the article (Readability), save images locally, and write web-archive/<host>/<page>/<UTC time>/ with article.html (single offline file, images embedded, source and capture time on top), article.md (images in assets/), source.html (as downloaded), text.json and meta.json. When the URL was captured before, the text is compared and changes.html written. Optional screenshot uses a local Chrome/Edge in headless mode. Pages behind logins or infinite scrolling are not supported.",
      input: {
        urls: z.array(z.string()).min(1).max(50),
        images: z.boolean().optional().describe("Save images (default true)"),
        screenshot: z.boolean().optional().describe("Also save screenshot.png with local Chrome/Edge (default false)"),
      },
      openPanel: true,
      timeoutMs: 900_000,
    },
    async ({ urls, images, screenshot: shot }) => {
      const results: Record<string, unknown>[] = [];
      const lines: string[] = [];
      const exe = shot ? await browser() : undefined;
      if (shot && !exe) lines.push("! No Chrome/Edge/Chromium found; screenshots skipped.");
      for (const url of [...new Set((urls as string[]).map((u) => u.trim()).filter(Boolean))]) {
        try {
          const r = await capture(ws, url, { images: images !== false, screenshot: exe ? (u: string, out: string) => screenshot(exe, u, out) : undefined });
          const c = r.capture;
          results.push({ url, ok: true, capture: c, failures: r.failures.slice(0, 10) });
          lines.push(`✓ ${url}\n  “${c.title}” → ${c.dir}/article.html (${c.paragraphs} paragraphs, ${c.chars} chars, ${c.images} image(s)${c.imagesFailed ? `, ${c.imagesFailed} failed` : ""}${c.screenshot ? ", screenshot" : ""}) — ${change(c)}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ url, ok: false, error: message });
          lines.push(`✗ ${url}: ${message}`);
        }
      }
      const index = await readIndex(ws);
      return { text: lines.join("\n"), structured: { kind: "captured", results, entries: index.entries } };
    },
  );

  tool(
    "archive_list",
    {
      description: "List archived pages (newest first) with every capture: time, folder, size and change vs the previous capture. Optional text filter on URL or title.",
      input: { query: z.string().optional() },
      readOnly: true,
    },
    async ({ query }) => {
      const index = await readIndex(ws);
      const q = query?.toLowerCase().trim();
      const entries = q ? index.entries.filter((e) => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)) : index.entries;
      const text = entries.length
        ? entries.map((e) => `${e.title}\n  ${e.url}\n${e.captures.map((c) => `  - ${c.at.slice(0, 16).replace("T", " ")} UTC  ${c.dir}  (${change(c)})`).join("\n")}`).join("\n")
        : "No archived pages yet.";
      return { text, structured: { kind: "list", entries } };
    },
  );

  tool(
    "archive_read",
    {
      description: "Read the Markdown of one capture (by folder) so the agent can quote or summarise it. Long articles are cut at maxChars (default 20000).",
      input: { dir: z.string(), maxChars: z.number().int().min(500).max(200_000).optional() },
      readOnly: true,
    },
    async ({ dir, maxChars }) => {
      const { capture: c } = await findCapture(dir);
      const md = await ws.readText(posix.join(c.dir, "article.md"));
      const max = maxChars ?? 20_000;
      return { text: md.length > max ? `${md.slice(0, max)}\n\n… (${md.length - max} more characters in ${c.dir}/article.md)` : md, structured: { kind: "read", dir: c.dir } };
    },
  );

  tool(
    "archive_diff",
    {
      description: "Compare two captures of the same URL (default: the last two) paragraph by paragraph and write changes.html in the newer capture. Returns the changed paragraphs.",
      input: { url: z.string(), from: z.string().optional().describe("Older capture folder"), to: z.string().optional().describe("Newer capture folder") },
      openPanel: true,
    },
    async ({ url, from, to }) => {
      const e = await entryFor(url);
      if (e.captures.length < 2 && !(from && to)) throw new KitError("one_capture", `${url} has only one capture; capture it again first`);
      const b = to ? e.captures.find((c) => c.dir === to) : e.captures.at(-1);
      const a = from ? e.captures.find((c) => c.dir === from) : e.captures[e.captures.indexOf(b!) - 1];
      if (!a || !b) throw new KitError("not_found", "Capture folder not found for this URL");
      const read = async (c: Capture) => JSON.parse(await ws.readText(posix.join(c.dir, "text.json"))) as string[];
      const d = diffParagraphs(await read(a), await read(b));
      const path = await ws.write(posix.join(b.dir, "changes.html"), diffHtml(e.title, a, b, d.rows));
      const changes = d.rows.filter((r) => r.type !== "same");
      const text = [
        `${e.title}: ${a.at.slice(0, 16)} → ${b.at.slice(0, 16)} UTC — +${d.added} −${d.removed} ~${d.changed} paragraph(s). ${path}`,
        ...changes.slice(0, 40).map((r) => (r.type === "mod" ? `~ ${r.old!.slice(0, 160)}\n  → ${r.text.slice(0, 160)}` : `${r.type === "add" ? "+" : "−"} ${r.text.slice(0, 200)}`)),
        ...(changes.length > 40 ? [`… ${changes.length - 40} more in changes.html`] : []),
      ].join("\n");
      return { text, structured: { kind: "diff", url: e.url, from: a.dir, to: b.dir, rows: d.rows.filter((r, i, all) => r.type !== "same" || all.slice(Math.max(0, i - 1), i + 2).some((x) => x.type !== "same")), added: d.added, removed: d.removed, changed: d.changed, path } };
    },
  );

  tool(
    "capture_view",
    { description: "Offline article HTML and screenshot of a capture for the panel.", input: { dir: z.string() }, visibility: ["app"], readOnly: true },
    async ({ dir }) => {
      const { capture: c } = await findCapture(dir);
      const html = await ws.readText(posix.join(c.dir, "article.html"));
      const shot = c.screenshot && (await ws.exists(posix.join(c.dir, "screenshot.png"))) ? (await ws.read(posix.join(c.dir, "screenshot.png"))).toString("base64") : undefined;
      return { text: c.dir, structured: { html, screenshot: shot } };
    },
  );

  tool(
    "archive_index",
    { description: "Archive index for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => ({ text: "", structured: { kind: "list", entries: (await readIndex(ws)).entries, browser: !!(await browser()), root: ROOT } }),
  );

  return server;
}
