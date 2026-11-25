import { readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { type Report, pack } from "./pack.ts";

export const NAME = "offline-site-packer";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const LAST = ".offline-site-packer/last.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  let umd: string | undefined;
  const minisearch = async () => (umd ??= await readFile(join(options.assetRoot, "vendor/minisearch.umd.js"), "utf8"));
  const norm = (d: string) => posix.normalize(d.replace(/\\/g, "/")).replace(/^\.\/|\/+$/g, "") || ".";

  const summary = (r: Report, wrote: boolean) => {
    const lines = [
      `${wrote ? `Packed ${r.source} → ${r.output}/` : `Checked ${r.source} (nothing written)`}: ${r.pages.length} page(s), ${r.assets} asset(s), ${r.rewritten} link(s) rewritten to relative paths${wrote ? `, ${(r.bytes / 1048576).toFixed(2)} MB` : ""}${r.zip ? `; zip ${r.zip}` : ""}. Offline search: ${r.search ? "on" : "off"}.`,
      `Broken links (${r.broken.length}):${r.broken.map((b) => `\n  ✗ ${b.from} → ${b.href}${b.kind === "asset" ? " (missing file)" : ""}`).join("") || " none"}`,
      `External links (${r.external.length}, need internet): ${r.external.map((e) => e.href).join(", ") || "none"}`,
    ];
    if (r.orphans.length) lines.push(`Pages nothing links to (${r.orphans.length}, not included${r.orphans.length ? "; pass includeUnlinked to keep them" : ""}): ${r.orphans.join(", ")}`);
    if (r.unused.length) lines.push(`Unused files left out: ${r.unused.length}`);
    for (const w of r.warnings) lines.push(`! ${w}`);
    if (wrote) lines.push(`Open ${r.output}/index.html directly in a browser (no server needed); search with ⌘K / Ctrl+K.`);
    return lines.join("\n");
  };
  async function run(input: { dir: string; out?: string; baseUrl?: string; search?: boolean; zip?: boolean; includeUnlinked?: boolean }, dryRun: boolean) {
    const dir = norm(input.dir);
    const srcAbs = ws.resolve(dir);
    if (!(await stat(srcAbs).then((s) => s.isDirectory(), () => false))) throw new KitError("not_found", `${dir} is not a folder.`);
    const out = norm(input.out ?? `${dir === "." ? "site" : dir.replace(/\/(dist|public|build|out|_site|site|www)$/, "")}-offline`);
    const outAbs = ws.resolve(out);
    if (!dryRun && (dir === "." || out === dir || out.startsWith(`${dir}/`))) throw new KitError("bad_output", "The output folder must be outside the site folder (and the site cannot be the workspace root when writing).");
    if (input.baseUrl) { try { new URL(input.baseUrl); } catch { throw new KitError("bad_url", `baseUrl “${input.baseUrl}” is not a URL.`); } }
    let r: Report & { zipData?: Uint8Array };
    try { r = await pack(srcAbs, outAbs, { source: dir, output: out }, { baseUrl: input.baseUrl, search: input.search, includeUnlinked: input.includeUnlinked, minisearchUmd: await minisearch(), dryRun }); }
    catch (e) { throw new KitError("pack_failed", (e as Error).message); }
    if (!dryRun && input.zip !== false && r.zipData) { r.zip = `${out}.zip`; await ws.write(r.zip, r.zipData); }
    delete r.zipData;
    const settings = { dir, out, baseUrl: input.baseUrl ?? "", search: input.search !== false, zip: input.zip !== false, includeUnlinked: !!input.includeUnlinked };
    await ws.write(LAST, JSON.stringify({ settings, report: r, wrote: !dryRun, at: new Date().toISOString() }, null, 1) + "\n");
    return { text: summary(r, !dryRun), structured: { kind: "report", settings, report: r, wrote: !dryRun } };
  }
  const input = {
    dir: z.string().describe("Folder with the built static site (contains index.html), e.g. dist or public"),
    out: z.string().optional().describe("Output folder (default <site>-offline next to it)"),
    baseUrl: z.string().optional().describe("The site's public URL; absolute links to it are treated as internal"),
    search: z.boolean().optional().describe("Add offline full-text search (default true)"),
    zip: z.boolean().optional().describe("Also write <out>.zip (default true)"),
    includeUnlinked: z.boolean().optional().describe("Also include pages and files nothing links to"),
  };
  tool("site_check", { description: "Crawl a static website folder from index.html without writing anything: lists pages, broken links and missing files, external links, pages nothing links to, and scripts that won't work from file://.", input, readOnly: true, openPanel: true }, (i) => run(i, true));
  tool("site_pack", {
    description: "Make an offline copy of a static website that works by double-clicking index.html (file://): crawls every internal page from index.html, rewrites root-relative / pretty / extension-less links to relative file paths (dir/ → dir/index.html), rewrites CSS url()/@import and srcset, copies only the files used, adds a MiniSearch full-text search box (⌘K) to every page, reports broken and external links, and writes a folder + zip. Dynamic sites (server code, SPA routing that needs a server) are out of scope.",
    input, openPanel: true, timeoutMs: 300_000,
  }, (i) => run(i, false));
  tool("site_state", { description: "Panel state.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    if (!(await ws.exists(LAST))) return { text: "", structured: { kind: "none" } };
    const l = JSON.parse(await ws.readText(LAST));
    return { text: "", structured: { kind: "report", ...l } };
  });
  tool("site_dirs", { description: "Folders with an index.html.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const found = new Set<string>();
    const { readdir } = await import("node:fs/promises");
    const go = async (rel: string, depth: number) => {
      if (depth > 4) return;
      for (const e of await readdir(ws.resolve(rel), { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || e.name.endsWith("-offline")) continue;
        const p = rel === "." ? e.name : `${rel}/${e.name}`;
        if (await ws.exists(`${p}/index.html`)) found.add(p); else await go(p, depth + 1);
      }
    };
    await go(".", 0);
    return { text: "", structured: { dirs: [...found].sort() } };
  });
  return server;
}
