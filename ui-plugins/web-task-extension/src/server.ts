import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { type Check, type Files, generate, popupPreview, validate, zip } from "./generate.ts";
import { type Permission, SettingSchema, StepSchema, type Task, checkTask, permissions, slug } from "./task.ts";

export const NAME = "web-task-extension";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STORE = ".web-task-extension/extensions.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
export interface Saved { out: string; name: string; version: string; zip: string | null; zipBytes: number; generatedAt: string; checks: Check[]; errors: number; warnings: number; permissions: Permission[]; steps: number }

const taskFields = {
  description: z.string().max(132).optional().describe("One line (≤132 chars) shown in Chrome and the popup"),
  steps: z.array(StepSchema).min(1).max(60).describe("Steps in order: open, click, fill, wait, extract, download"),
  settings: z.array(SettingSchema).max(30).optional().describe("Values the user sets on the options page and steps use as {{key}} (e.g. a search term). Never passwords."),
  sites: z.array(z.string().max(200)).max(20).optional().describe("Extra sites the steps reach by clicking (domains or match patterns); Open URLs are added automatically"),
  timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Default wait per step (15000)"),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe("Icon colour, e.g. #2f6fde"),
};

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const runtime = join(options.assetRoot, "runtime");
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const load = async (): Promise<Record<string, Saved>> => ((await ws.exists(STORE)) ? JSON.parse(await ws.readText(STORE)).extensions ?? {} : {});
  const save = async (all: Record<string, Saved>) => ws.write(STORE, JSON.stringify({ version: 1, extensions: all }, null, 1) + "\n");
  const normOut = (o: string) => { const out = o.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, ""); if (!out || out === "." || out.startsWith("..") || out.startsWith("/")) throw new KitError("bad_out", "Choose an output folder inside the workspace."); ws.resolve(out); return out; };
  const readTask = async (out: string): Promise<Task> => {
    if (!(await ws.exists(`${out}/task.json`))) throw new KitError("not_found", `No generated extension in ${out}/ (task.json missing).`);
    const t = JSON.parse(await ws.readText(`${out}/task.json`));
    return { name: t.name, description: t.description ?? "", version: t.version, steps: z.array(StepSchema).parse(t.steps), settings: z.array(SettingSchema).parse(t.settings ?? []), sites: t.sites ?? [], timeoutMs: t.timeoutMs, color: t.color };
  };
  const report = (s: Saved, files?: string[]) => [
    s.errors ? `✗ ${s.out}/ has ${s.errors} problem(s); no zip was written.` : `Extension “${s.name}” ${s.version} → ${s.out}/ and ${s.zip} (${Math.round(s.zipBytes / 1024)} KiB).`,
    ...s.checks.filter((c) => !c.ok).map((c) => `  ${c.level === "error" ? "✗" : "!"} ${c.id}: ${c.message}`),
    `Checks: ${s.checks.filter((c) => c.ok).length}/${s.checks.length} passed${s.warnings ? `, ${s.warnings} warning(s)` : ""}.`,
    `Permissions (minimal): ${s.permissions.map((p) => `${p.name} — ${p.en}`).join("\n  ")}`,
    s.errors ? "" : `Try it: chrome://extensions → Developer mode → Load unpacked → ${s.out}/ (Edge: edge://extensions). Sign in to the site yourself first if it needs a login.`,
    files ? `Files: ${files.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  async function build(task: Task, out: string, all: Record<string, Saved>) {
    const tp = checkTask(task);
    const errs = tp.filter((p) => p.level === "error");
    if (errs.length) throw new KitError("bad_task", errs.map((p) => `${p.where}: ${p.message}`).join("\n"));
    const files = await generate(task, runtime);
    return finish(task, out, files, all, true);
  }
  async function finish(task: Task, out: string, files: Files, all: Record<string, Saved>, write: boolean) {
    if (write) for (const [p, c] of Object.entries(files)) await ws.write(`${out}/${p}`, c);
    const checks = validate(files, task);
    const errors = checks.filter((c) => !c.ok && c.level === "error").length;
    const zipPath = `${out}-${task.version}.zip`;
    let zipBytes = 0;
    if (!errors) { const z2 = zip(files); zipBytes = z2.length; await ws.write(zipPath, z2); }
    const s: Saved = { out, name: task.name, version: task.version, zip: errors ? null : zipPath, zipBytes, generatedAt: new Date().toISOString(), checks, errors, warnings: checks.filter((c) => !c.ok && c.level === "warn").length, permissions: permissions(task), steps: task.steps.length };
    all[out] = s;
    await save(all);
    return { text: report(s, Object.keys(files)), structured: { kind: "ext", saved: s, task, preview: { en: popupPreview(files, "en"), zh: popupPreview(files, "zh") } } };
  }
  const bump = (v: string, how: "patch" | "minor" | "none") => { if (how === "none") return v; const p = v.split(".").map(Number); while (p.length < 3) p.push(0); if (how === "minor") { p[1]++; p[2] = 0; } else p[2]++; return p.slice(0, 3).join("."); };

  tool("ext_new", {
    description: "Turn a repeated browser chore into a Chrome/Edge Manifest V3 extension. Give the steps (open URL, click, fill, wait, extract rows with fields, download CSV/JSON or linked files) and any user settings ({{key}} placeholders). Writes the unpacked extension (popup with a Run button, options page, minimal permissions + PERMISSIONS.md), validates the manifest and code, and zips it. No login automation.",
    input: { name: z.string().min(1).max(75).describe("Extension name (≤75 chars)"), ...taskFields, out: z.string().optional().describe("Output folder (default extensions/<slug>)"), version: z.string().optional().describe("Default 1.0.0") },
    openPanel: true, timeoutMs: 60_000,
  }, async (i) => {
    const all = await load();
    const out = normOut(i.out ?? `extensions/${slug(i.name)}`);
    if (all[out] || (await ws.exists(`${out}/manifest.json`))) throw new KitError("exists", `${out}/ already has an extension; use ext_update to change it or pick another out.`);
    const task: Task = { name: i.name.trim(), description: (i.description ?? "").trim(), version: i.version ?? "1.0.0", steps: i.steps, settings: i.settings ?? [], sites: i.sites ?? [], timeoutMs: i.timeoutMs, color: i.color };
    return build(task, out, all);
  });

  tool("ext_update", {
    description: "Change a generated extension (name, description, steps, settings, sites, timeout, colour), regenerate it, bump the version (patch by default), re-validate and re-zip. Reload it on chrome://extensions afterwards.",
    input: { out: z.string().describe("Extension folder"), name: z.string().min(1).max(75).optional(), ...taskFields, steps: taskFields.steps.optional(), bump: z.enum(["patch", "minor", "none"]).optional() },
    openPanel: true, timeoutMs: 60_000,
  }, async (i) => {
    const all = await load();
    const out = normOut(i.out);
    const t = await readTask(out);
    const task: Task = { ...t, ...(i.name ? { name: i.name.trim() } : {}), ...(i.description != null ? { description: i.description.trim() } : {}), ...(i.steps ? { steps: i.steps } : {}), ...(i.settings ? { settings: i.settings } : {}), ...(i.sites ? { sites: i.sites } : {}), ...(i.timeoutMs ? { timeoutMs: i.timeoutMs } : {}), ...(i.color ? { color: i.color } : {}) };
    task.version = bump(t.version, i.bump ?? "patch");
    return build(task, out, all);
  });

  tool("ext_check", {
    description: "Re-validate an extension folder as it is on disk (for example after hand edits): manifest, referenced files, icons, permissions vs. steps, MV3 CSP, JS syntax, locales. Re-zips it when there are no errors.",
    input: { out: z.string() }, timeoutMs: 60_000,
  }, async (i) => {
    const all = await load();
    const out = normOut(i.out);
    const task = await readTask(out);
    const files: Files = {};
    for (const f of await ws.list({ dir: out, limit: 500 })) files[f.path.slice(out.length + 1)] = await ws.read(f.path);
    for (const [k, v] of Object.entries(files)) if (/\.(json|js|html|css|md)$/.test(k)) files[k] = Buffer.from(v as Uint8Array).toString("utf8");
    const r = await finish(task, out, files, all, false);
    return { ...r, text: r.text.replace(/\nFiles: .*$/s, "") };
  });

  tool("ext_list", { description: "List the extensions generated in this workspace with their version, check results and zip.", input: {}, readOnly: true }, async () => {
    const all = Object.values(await load());
    return { text: all.length ? all.map((s) => `${s.out}/ — “${s.name}” ${s.version}, ${s.steps} steps, ${s.errors ? `${s.errors} error(s)` : `ok → ${s.zip}`}`).join("\n") : "No extensions yet.", structured: { kind: "list", extensions: all } };
  });

  tool("ext_state", { description: "Panel state: generated extensions and the selected one's task and popup preview.", input: { out: z.string().optional() }, readOnly: true, visibility: ["app"] }, async (i) => {
    const all = await load();
    const list = Object.values(all).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    const pick = i.out ? all[i.out] : list[0];
    if (!pick) return { text: "No extensions yet.", structured: { kind: "state", extensions: list } };
    const task = await readTask(pick.out).catch(() => null);
    const files: Files = {};
    if (task) for (const p of ["task.json", "ui.css", "icons/icon32.png", "_locales/en/messages.json", "_locales/zh_CN/messages.json"]) if (await ws.exists(`${pick.out}/${p}`)) files[p] = p.endsWith(".png") ? await ws.read(`${pick.out}/${p}`) : await ws.readText(`${pick.out}/${p}`);
    return { text: report(pick), structured: { kind: "state", extensions: list, saved: pick, task, preview: task ? { en: popupPreview(files, "en"), zh: popupPreview(files, "zh") } : null } };
  });

  return server;
}
