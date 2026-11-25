import { statSync } from "node:fs";
import { dirname as fitDirname } from "node:path";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { GMAIL_CLIP, compile, fill, plainText, starter, type Issue } from "./email.ts";

export const NAME = "email-template-builder";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PROJECT = ".email-builder/project.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface Email { slug: string; name: string; dir: string; design: string[] }
interface Project { version: 1; emails: Email[]; current: string }
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "email";

/** 从目标目录往上找：第一个已存在的路径如果是文件，返回它（相对工作区）。 */
function fileInTheWay(ws: Workspace, rel: string): string | null {
  let p = ws.resolve(rel);
  while (p !== ws.root && p.startsWith(ws.root)) {
    const st = statSync(p, { throwIfNoEntry: false });
    if (st) return st.isDirectory() ? null : ws.rel(p);
    p = fitDirname(p);
  }
  return null;
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });

  const loadProject = async (): Promise<Project | undefined> => ((await ws.exists(PROJECT)) ? JSON.parse(await ws.readText(PROJECT)) : undefined);
  const save = (p: Project) => ws.write(PROJECT, JSON.stringify(p, null, 1) + "\n");
  async function pick(slug?: string) {
    const p = await loadProject();
    if (!p?.emails.length) throw new KitError("no_email", "No email template yet; call email_new first.");
    const e = p.emails.find((x) => x.slug === (slug ?? p.current));
    if (!e) throw new KitError("unknown_email", `No template “${slug}”. Templates: ${p.emails.map((x) => x.slug).join(", ")}`);
    if (slug && p.current !== slug) { p.current = slug; await save(p); }
    return { p, e };
  }
  const mjmlPath = (e: Email) => `${e.dir}/${e.slug}.mjml`;
  const dataPath = (e: Email) => `${e.dir}/data.json`;
  async function state(e: Email) {
    const source = await ws.readText(mjmlPath(e));
    let data: Record<string, unknown> = {};
    const issues: Issue[] = [];
    if (await ws.exists(dataPath(e))) { try { data = JSON.parse(await ws.readText(dataPath(e))); } catch (err) { issues.push({ severity: "error", check: "data", message: `data.json is not valid JSON: ${(err as Error).message}` }); } }
    const c = await compile(source);
    issues.push(...c.issues);
    const filled = fill(c.html, data);
    const unused = Object.keys(data).filter((k) => !c.vars.includes(k) && !c.vars.some((v) => v.startsWith(`${k}.`)));
    if (filled.missing.length) issues.push({ severity: "warning", check: "variables", message: `No sample value for ${filled.missing.map((v) => `{{${v}}}`).join(", ")} (add them to data.json for the preview).` });
    if (unused.length) issues.push({ severity: "info", check: "variables", message: `Sample values not used in the template: ${unused.join(", ")}.` });
    const order = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0));
    return { source, data, c, filled, issues };
  }
  type State = Awaited<ReturnType<typeof state>>;
  const view = (p: Project, e: Email, s: State) => ({
    kind: "email", project: p, email: e, source: s.source, data: s.data, vars: s.c.vars, issues: s.issues, bytes: s.c.bytes, limit: GMAIL_CLIP, width: s.c.width,
    preheader: s.c.preview ? fill(s.c.preview, s.data).html : undefined, title: s.c.title, html: s.filled.html,
  });
  const line = (i: Issue) => `${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} ${i.line ? `line ${i.line}: ` : ""}[${i.check}] ${i.message}`;
  const brief = (e: Email, s: State) => {
    const errs = s.issues.filter((i) => i.severity === "error").length;
    return `${e.slug}: ${(s.c.bytes / 1024).toFixed(1)} KB (Gmail clips at 102 KB), ${s.c.width}px wide, ${s.c.vars.length} variable(s): ${s.c.vars.map((v) => `{{${v}}}`).join(", ") || "none"}. ${errs} error(s), ${s.issues.length - errs} warning(s)/note(s).${s.issues.map((i) => `\n${line(i)}`).join("")}`;
  };

  tool(
    "email_new",
    {
      description: "Start an email template (MJML) in emails/<name>/ with a sample data.json, and link the design screenshot(s) so the panel shows them next to the preview. Then rewrite the MJML with email_write to match the design. MJML compiles to table-based HTML with inline styles that works in Gmail, Outlook, Apple Mail and others.",
      input: { name: z.string().min(1), design: z.array(z.string()).optional().describe("Screenshot / design images in the workspace"), accent: z.string().optional(), background: z.string().optional(), text: z.string().optional(), dir: z.string().optional() },
      openPanel: true,
    },
    async ({ name, design, accent, background, text, dir }) => {
      const p: Project = (await loadProject()) ?? { version: 1, emails: [], current: "" };
      let slug = slugify(name);
      if (p.emails.some((x) => x.slug === slug)) throw new KitError("exists", `A template called ${slug} already exists; use email_write, or another name.`);
      for (const d of design ?? []) if (!(await ws.exists(d))) throw new KitError("not_found", `${d} not found.`);
      const e: Email = { slug, name, dir: (dir ?? `emails/${slug}`).replace(/^\/+|\/+$/g, ""), design: design ?? [] };
      // 输出目录（或它的某一级上级）是个已存在的文件时给出可读错误，而不是 mkdir 的 EEXIST（TEST-FINDINGS #6）
      { const f = fileInTheWay(ws, e.dir); if (f) throw new KitError("not_a_folder", `${f} is a file, so ${e.dir} cannot be a folder. Pass another dir.`); }
      if (await ws.exists(mjmlPath(e))) throw new KitError("exists", `${mjmlPath(e)} already exists.`);
      await ws.write(mjmlPath(e), starter(name, { ...(accent ? { accent } : {}), ...(background ? { background } : {}), ...(text ? { text } : {}) }));
      await ws.write(dataPath(e), JSON.stringify({ preheader: "A short preview line", first_name: "Alex", cta_url: "https://example.com", unsubscribe_url: "https://example.com/unsubscribe" }, null, 2) + "\n");
      p.emails.push(e); p.current = slug;
      await save(p);
      const s = await state(e);
      slug = e.slug;
      return { text: `Created ${mjmlPath(e)} and ${dataPath(e)}.\n${brief(e, s)}\nNext: look at the design, rewrite the MJML (mj-section / mj-column / mj-text / mj-image / mj-button / mj-table …) with email_write, and put sample values for every {{variable}} in data.json.`, structured: view(p, e, s) };
    },
  );

  tool(
    "email_write",
    {
      description: "Save the MJML source and/or the sample data (data.json) of a template, compile it and run the checks: MJML errors, body width (≤600px), images (alt text; hosted at https URLs, not local paths), links (no empty or # hrefs), preheader (mj-preview), dark-mode styles, text contrast, unsubscribe link, size (Gmail clips over 102 KB) and {{variables}} without sample values. Use {{name}} placeholders for personalised values.",
      input: { mjml: z.string().optional(), data: z.record(z.string(), z.unknown()).optional().describe("Sample values for the preview, e.g. { first_name: 'Mia' }; replaces data.json"), email: z.string().optional() },
      openPanel: true,
    },
    async ({ mjml, data, email }) => {
      const { p, e } = await pick(email);
      if (mjml === undefined && data === undefined) throw new KitError("nothing", "Pass mjml and/or data.");
      if (mjml !== undefined) await ws.write(mjmlPath(e), mjml);
      if (data !== undefined) await ws.write(dataPath(e), JSON.stringify(data, null, 2) + "\n");
      const s = await state(e);
      return { text: brief(e, s), structured: view(p, e, s) };
    },
  );

  tool(
    "email_check",
    { description: "Compile the template and list every problem (see email_write) with line numbers, plus size and variables.", input: { email: z.string().optional() }, openPanel: true, readOnly: true },
    async ({ email }) => {
      const { p, e } = await pick(email);
      const s = await state(e);
      return { text: brief(e, s), structured: view(p, e, s) };
    },
  );

  tool(
    "email_export",
    {
      description: "Write the email-ready HTML (variables kept as {{…}} for your email service), a plain-text version, and a preview HTML with the sample data, into emails/<name>/export/. Refuses when there are errors unless force is true. Nothing is sent.",
      input: { email: z.string().optional(), force: z.boolean().optional() },
    },
    async ({ email, force }) => {
      const { e } = await pick(email);
      const s = await state(e);
      const errs = s.issues.filter((i) => i.severity === "error");
      if (errs.length && !force) throw new KitError("has_errors", `Fix these first (or pass force: true):\n${errs.map(line).join("\n")}`);
      const out = `${e.dir}/export`;
      const files = [
        await ws.write(`${out}/${e.slug}.html`, s.c.html),
        await ws.write(`${out}/${e.slug}.txt`, plainText(s.c.html)),
        await ws.write(`${out}/${e.slug}.preview.html`, s.filled.html),
      ];
      return { text: `Wrote ${files.join(", ")} (${(s.c.bytes / 1024).toFixed(1)} KB HTML; variables: ${s.c.vars.map((v) => `{{${v}}}`).join(", ") || "none"}). Paste the HTML into your email service and map the variables to its merge tags.${s.issues.filter((i) => i.severity === "warning").length ? `\nWarnings:\n${s.issues.filter((i) => i.severity === "warning").map(line).join("\n")}` : ""}`, structured: { kind: "exported", files, bytes: s.c.bytes } };
    },
  );

  tool("email_state", { description: "Current template for the panel.", input: { email: z.string().optional() }, visibility: ["app"], readOnly: true }, async ({ email }) => {
    const p = await loadProject();
    if (!p?.emails.length) return { text: "", structured: { kind: "empty" } };
    const { e } = await pick(email);
    return { text: "", structured: view(p, e, await state(e)) };
  });
  tool("email_text", { description: "Plain-text version for the panel.", input: { email: z.string().optional() }, visibility: ["app"], readOnly: true }, async ({ email }) => {
    const { e } = await pick(email);
    const s = await state(e);
    return { text: "", structured: { text: fill(plainText(s.c.html), s.data).html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"") } };
  });
  tool("email_design", { description: "Design image for the panel.", input: { path: z.string() }, visibility: ["app"], readOnly: true }, async ({ path }) => {
    const p = await loadProject();
    if (!p?.emails.some((x) => x.design.includes(path))) throw new KitError("not_design", "Not a design image of a template.");
    const ext = posix.extname(path).toLowerCase();
    return { text: "", structured: { dataUrl: `data:${ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"};base64,${(await ws.read(path)).toString("base64")}` } };
  });
  tool("workspace_images", { description: "Design images for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => ({
    text: "", structured: { files: (await ws.list({ exts: [".png", ".jpg", ".jpeg", ".webp"], limit: 3000 })).map((f) => f.path).filter((f) => !/^(emails\/[^/]+\/export|node_modules)\//.test(f)) },
  }));
  return server;
}
