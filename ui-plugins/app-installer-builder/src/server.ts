import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { type Job, hasWine, listOutputs, runBuild } from "./build.ts";
import { type AppConfig, type Issue, TARGETS, type Target, buildableHere, builderYml, desktopReadme, mainCjs, packageJson, pkgName, validate } from "./config.ts";
import { type Detected, detect } from "./detect.ts";
import { defaultIcon, pngSize } from "./png.ts";

export const NAME = "app-installer-builder";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const STATE = ".app-installer/state.json";
const WAIT = 45_000;

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void; platform?: NodeJS.Platform; wine?: boolean }

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const platform = options.platform ?? process.platform;
  const wine = options.wine ?? hasWine();
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });
  const jobs = new Map<string, Job>();
  let jobSeq = 0;

  const norm = (d: string) => posix.normalize(d.replace(/\\/g, "/")).replace(/^\.\/|\/+$/g, "") || ".";
  const cfgPath = (dir: string) => posix.join(dir, "desktop/app-installer.json");
  async function current(dir?: string): Promise<string> {
    if (dir) { const d = norm(dir); ws.resolve(d); await ws.write(STATE, JSON.stringify({ current: d }) + "\n"); return d; }
    if (await ws.exists(STATE)) return JSON.parse(await ws.readText(STATE)).current;
    throw new KitError("no_project", "No project chosen yet; call app_setup with dir (use app_scan to inspect a folder first).");
  }
  const loadCfg = async (dir: string): Promise<AppConfig | undefined> => ((await ws.exists(cfgPath(dir))) ? JSON.parse(await ws.readText(cfgPath(dir))) : undefined);
  const inProject = (dir: string, p: string) => (p.startsWith("/") ? p : posix.join(dir, p));
  async function facts(dir: string, c: AppConfig) {
    const icon = c.icon ? ((await ws.exists(inProject(dir, c.icon))) ? pngSize(await ws.read(inProject(dir, c.icon))) ?? null : null) : undefined;
    return {
      web: c.webDir ? existsSync(ws.resolve(posix.join(dir, c.webDir, "index.html"))) : undefined,
      entry: c.entry ? existsSync(ws.resolve(posix.join(dir, c.entry))) : undefined,
      icon, cert: c.signing?.winCertificateFile ? existsSync(c.signing.winCertificateFile.startsWith("/") ? c.signing.winCertificateFile : ws.resolve(posix.join(dir, c.signing.winCertificateFile))) : undefined,
    };
  }
  const envInfo = (c?: AppConfig) => ({
    platform, wine,
    targets: Object.fromEntries(TARGETS.map((t) => [t, buildableHere(t, platform, wine)])) as Record<Target, { ok: boolean; why?: string }>,
    wanted: c?.targets ?? [],
  });
  async function view(dir: string, extra: Record<string, unknown> = {}) {
    const c = await loadCfg(dir);
    const d = await detect(ws.resolve(dir), dir);
    const issues = c ? validate(c, await facts(dir, c)) : [];
    const generated = ["package.json", "main.cjs", "electron-builder.yml", "build/icon.png", "README.md"].filter((f) => existsSync(ws.resolve(posix.join(dir, "desktop", f))));
    const job = jobs.get(dir);
    return {
      kind: "app", dir, detected: d, config: c ?? null, issues, generated, env: envInfo(c),
      job: job ? { ...job, log: job.log.slice(-400) } : null, outputs: existsSync(ws.resolve(posix.join(dir, "desktop"))) ? listOutputs(ws.resolve(posix.join(dir, "desktop"))) : [], ...extra,
    };
  }
  const issueLine = (i: Issue) => `${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} [${i.field}] ${i.message}`;
  const envLine = (c: AppConfig) => c.targets.map((t) => { const b = buildableHere(t, platform, wine); return `${t}: ${b.ok ? "can build here" : `not here — ${b.why}`}`; }).join("; ");

  tool("app_scan", {
    description: "Inspect a project folder before packaging it as a desktop app: detects a static website (a folder with index.html, e.g. dist/) or a Node server (start script / entry that calls listen()), whether it reads process.env.PORT, the name/version from package.json, and square PNG icon candidates.",
    input: { dir: z.string().default(".").describe("Project folder in the workspace") }, readOnly: true,
  }, async ({ dir }) => {
    const d = await detect(ws.resolve(norm(dir)), norm(dir));
    return { text: `${d.dir}: ${d.kind}${d.webDir ? ` (web folder ${d.webDir})` : ""}${d.entry ? ` (entry ${d.entry}, ${d.usesPortEnv ? "reads PORT" : `fixed port ${d.port ?? "?"}`})` : ""}; name “${d.name}” v${d.version}; icons: ${d.icons.map((i) => `${i.path} ${i.width}px`).join(", ") || "none (a default icon will be generated)"}.${d.needsBuild ? ` No built site found — run \`${d.needsBuild}\` first.` : ""}${d.notes.map((n) => `\n! ${n}`).join("")}`, structured: { kind: "scan", detected: d } };
  });

  tool("app_setup", {
    description: "Create or update the desktop wrapper for a project: writes <project>/desktop/ with an Electron shell (main.cjs: static sites served at app://local/ with SPA fallback; Node servers started with Electron's own Node on a free port), package.json (electron + electron-builder), electron-builder.yml (macOS dmg, Windows nsis, Linux AppImage), build/icon.png and a README. Unspecified fields come from the detected project / the previous config. Signing is optional and only uses a certificate the user provides: macIdentity (keychain certificate name) and/or winCertificateFile (.pfx path; the password must be in the WIN_CSC_KEY_PASSWORD environment variable, never passed here). Without them the builds are unsigned.",
    input: {
      dir: z.string().optional().describe("Project folder (default: the current one)"),
      name: z.string().optional(), appId: z.string().optional().describe("Reverse-DNS id, e.g. com.acme.notes"), version: z.string().optional(), description: z.string().optional(), author: z.string().optional(),
      mode: z.enum(["static", "server"]).optional(), webDir: z.string().optional(), entry: z.string().optional(), port: z.number().int().min(1).max(65535).optional(), usesPortEnv: z.boolean().optional(),
      width: z.number().int().optional(), height: z.number().int().optional(), icon: z.string().optional().describe("Square PNG ≥512 px, relative to the project; empty string = generated icon"), iconColor: z.string().optional(),
      targets: z.array(z.enum(["dmg", "nsis", "appimage", "dir"])).optional(),
      signing: z.object({ macIdentity: z.string().optional(), winCertificateFile: z.string().optional() }).optional(),
    },
    openPanel: true,
  }, async (input) => {
    const dir = await current(input.dir);
    const d: Detected = await detect(ws.resolve(dir), dir);
    const prev = await loadCfg(dir);
    const pick = <K extends keyof AppConfig>(k: K, fallback: AppConfig[K]): AppConfig[K] => (input[k as string] !== undefined ? input[k as string] : prev?.[k] !== undefined ? prev[k] : fallback);
    const authorSlug = (d.author ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const c: AppConfig = {
      name: pick("name", d.name), appId: pick("appId", `com.${authorSlug || "example"}.${pkgName(input.name ?? prev?.name ?? d.name).replace(/-/g, "")}`), version: pick("version", d.version),
      description: pick("description", d.description), author: pick("author", d.author), mode: pick("mode", d.kind === "server" ? "server" : "static"),
      webDir: pick("webDir", d.webDir), entry: pick("entry", d.entry), usesPortEnv: pick("usesPortEnv", d.usesPortEnv ?? true), port: pick("port", d.port),
      width: pick("width", 1200), height: pick("height", 800), icon: pick("icon", d.icons.find((i) => i.width >= 512)?.path ?? ""), iconColor: pick("iconColor", "#2563eb"),
      targets: pick("targets", ["dmg", "nsis"]), signing: pick("signing", undefined),
    };
    if (c.signing && !c.signing.macIdentity && !c.signing.winCertificateFile) c.signing = undefined;
    const issues = validate(c, await facts(dir, c));
    await ws.write(cfgPath(dir), JSON.stringify(c, null, 2) + "\n");
    const errors = issues.filter((i) => i.severity === "error");
    if (!errors.length) {
      const base = posix.join(dir, "desktop");
      await ws.write(`${base}/package.json`, packageJson(c));
      await ws.write(`${base}/main.cjs`, mainCjs(c));
      await ws.write(`${base}/electron-builder.yml`, builderYml(c));
      await ws.write(`${base}/README.md`, desktopReadme(c));
      await ws.write(`${base}/build/icon.png`, c.icon ? await ws.read(inProject(dir, c.icon)) : defaultIcon(c.iconColor));
      const gi = posix.join(base, ".gitignore");
      if (!(await ws.exists(gi))) await ws.write(gi, "node_modules/\nrelease/\n");
    }
    const v = await view(dir);
    return {
      text: errors.length
        ? `Config saved to ${cfgPath(dir)} but files were NOT generated — fix these:\n${issues.map(issueLine).join("\n")}`
        : `Generated ${dir}/desktop/ (package.json, main.cjs, electron-builder.yml, build/icon.png${c.icon ? ` from ${c.icon}` : " (generated)"}, README.md) for “${c.name}” ${c.version} (${c.mode}${c.mode === "static" ? ` from ${c.webDir}` : ` ${c.entry}`}). Signing: macOS ${c.signing?.macIdentity ? "with the provided identity" : "unsigned"}, Windows ${c.signing?.winCertificateFile ? "with the provided certificate" : "unsigned"}. Targets — ${envLine(c)}.${issues.length ? `\n${issues.map(issueLine).join("\n")}` : ""}`,
      structured: v,
    };
  });

  tool("app_check", {
    description: "Re-check the desktop config and this computer: which targets can be built here (dmg needs macOS; nsis needs Windows or Wine; AppImage needs Linux; dir = unpacked app for this OS, works everywhere).",
    input: { dir: z.string().optional() }, readOnly: true,
  }, async ({ dir: d0 }) => {
    const dir = await current(d0);
    const c = await loadCfg(dir);
    if (!c) throw new KitError("no_config", `${dir} has no desktop config yet; call app_setup.`);
    const v = await view(dir);
    return { text: `${dir}: ${v.issues.filter((i) => i.severity === "error").length} error(s). This computer: ${platform}${wine ? " + Wine" : ""}. ${envLine(c)}.${v.issues.length ? `\n${v.issues.map(issueLine).join("\n")}` : ""}`, structured: v };
  });

  const status = (job: Job) => job.state === "running"
    ? `Building ${job.target} (${job.step}) — ${Math.round((Date.now() - job.started) / 1000)} s so far. Call app_status to wait for it.\n${job.log.slice(-8).join("\n")}`
    : job.state === "done" ? `Built ${job.target} in ${Math.round(((job.ended ?? 0) - job.started) / 1000)} s:\n${job.outputs.map((o) => `- desktop/${o.path} (${(o.size / 1048576).toFixed(1)} MB)`).join("\n")}`
    : `Build failed: ${job.error}\n${job.log.slice(-25).join("\n")}`;
  const waitJob = (job: Job, ms: number) => new Promise<void>((resolve) => { const end = Date.now() + ms; const tick = () => (job.state !== "running" || Date.now() > end ? resolve() : setTimeout(tick, 300)); tick(); });

  tool("app_build", {
    description: "Build an installer with electron-builder on this computer: runs npm install in desktop/ the first time (downloads Electron, ~150 MB), then electron-builder. Output in <project>/desktop/release/. Refuses targets this computer cannot build (dmg needs macOS, nsis needs Windows or Wine). Waits up to ~45 s, then keep calling app_status until it finishes.",
    input: { target: z.enum(["dmg", "nsis", "appimage", "dir"]), dir: z.string().optional() }, timeoutMs: 120_000,
  }, async ({ target, dir: d0 }) => {
    const dir = await current(d0);
    const c = await loadCfg(dir);
    if (!c) throw new KitError("no_config", "No desktop config yet; call app_setup first.");
    const errors = validate(c, await facts(dir, c)).filter((i) => i.severity === "error");
    if (errors.length) throw new KitError("invalid_config", `Fix the config first:\n${errors.map(issueLine).join("\n")}`);
    if (!existsSync(ws.resolve(posix.join(dir, "desktop/electron-builder.yml")))) throw new KitError("not_generated", "desktop/ files are missing; call app_setup.");
    const b = buildableHere(target, platform, wine);
    if (!b.ok) throw new KitError("wrong_platform", `${b.why}. Generate the config here and run \`npx electron-builder ${target === "dmg" ? "--mac dmg" : "--win nsis"}\` in desktop/ on that computer.`);
    if (jobs.get(dir)?.state === "running") throw new KitError("busy", "A build is already running; call app_status.");
    const env: Record<string, string> = {};
    if (!c.signing?.macIdentity) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    const job = runBuild(++jobSeq, ws.resolve(posix.join(dir, "desktop")), target, env, (j) => options.log?.(`build ${j.target} ${j.state}`));
    jobs.set(dir, job);
    await waitJob(job, WAIT);
    return { text: status(job), structured: await view(dir) };
  });

  tool("app_status", {
    description: "Status and log of the current build; waits up to ~45 s for it to finish (wait=false returns at once).",
    input: { dir: z.string().optional(), wait: z.boolean().default(true) }, readOnly: true, timeoutMs: 120_000,
  }, async ({ dir: d0, wait }) => {
    const dir = await current(d0);
    const job = jobs.get(dir);
    if (job && wait) await waitJob(job, WAIT);
    return { text: job ? status(job) : "No build has run in this session.", structured: await view(dir) };
  });

  // —— 面板专用 ——
  tool("app_state", { description: "Panel state.", input: { dir: z.string().optional() }, visibility: ["app"], readOnly: true }, async ({ dir }) => {
    try { return { text: "", structured: await view(await current(dir)) }; } catch { return { text: "", structured: { kind: "none" } }; }
  });
  tool("app_projects", { description: "Folders that look like projects.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const files = await ws.list({ exts: [".json", ".html"], limit: 4000 });
    const dirs = new Set<string>();
    for (const f of files) if (/(^|\/)(package\.json|index\.html)$/.test(f.path) && !/(^|\/)(desktop|release)\//.test(f.path)) { const p = posix.dirname(f.path); dirs.add(/\/(public|www|site|docs|_site)$/.test(p) ? posix.dirname(p) : p); }
    // 子目录（例如 src/、public/）已被上层项目包含时不单独列出
    const list = [...dirs].filter((d) => ![...dirs].some((p) => p !== d && (p === "." ? d !== "." : d.startsWith(`${p}/`))));
    return { text: "", structured: { dirs: list.sort().slice(0, 100) } };
  });
  tool("app_file", { description: "A generated file.", input: { dir: z.string(), file: z.enum(["package.json", "main.cjs", "electron-builder.yml", "README.md"]) }, visibility: ["app"], readOnly: true }, async ({ dir, file }) => ({
    text: "", structured: { text: await ws.readText(posix.join(norm(dir), "desktop", file)) },
  }));
  tool("app_icon", { description: "The icon for the panel.", input: { dir: z.string() }, visibility: ["app"], readOnly: true }, async ({ dir }) => {
    const p = posix.join(norm(dir), "desktop/build/icon.png");
    if (!(await ws.exists(p))) return { text: "", structured: { dataUrl: null } };
    return { text: "", structured: { dataUrl: `data:image/png;base64,${(await ws.read(p)).toString("base64")}` } };
  });
  return server;
}
