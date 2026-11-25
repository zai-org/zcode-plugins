// 生成 Electron 外壳 + electron-builder.yml。生成结果放在项目的 desktop/ 目录，用户可以自己继续改。
export const ELECTRON_VERSION = "45.5.0";
export const BUILDER_VERSION = "26.18.0";
export type Target = "dmg" | "nsis" | "appimage" | "dir";
export const TARGETS: Target[] = ["dmg", "nsis", "appimage", "dir"];

export interface AppConfig {
  name: string;
  appId: string;
  version: string;
  description?: string;
  author?: string;
  mode: "static" | "server";
  /** static：网页目录（相对项目）；server：入口 JS（相对项目） */
  webDir?: string;
  entry?: string;
  /** server：服务读取 PORT 环境变量就用空闲端口，否则用固定端口 */
  usesPortEnv?: boolean;
  port?: number;
  width: number;
  height: number;
  /** 项目里的 PNG（≥512，正方形）；没有就用生成的默认图标 */
  icon?: string;
  iconColor?: string;
  targets: Target[];
  signing?: {
    /** macOS：钥匙串里 “Developer ID Application: …” 证书的名字 */
    macIdentity?: string;
    /** Windows：.pfx / .p12 证书文件（相对项目或绝对路径）；密码只从环境变量 WIN_CSC_KEY_PASSWORD 读取 */
    winCertificateFile?: string;
  };
}
export interface Issue { severity: "error" | "warning" | "info"; field: string; message: string }

const y = (s: string) => JSON.stringify(s); // JSON 字符串就是合法的 YAML 标量
export const pkgName = (name: string) => name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";

export function validate(c: AppConfig, has: { web?: boolean; entry?: boolean; icon?: { width: number; height: number } | null; cert?: boolean }): Issue[] {
  const out: Issue[] = [];
  const e = (field: string, message: string) => out.push({ severity: "error", field, message });
  const w = (field: string, message: string) => out.push({ severity: "warning", field, message });
  if (!c.name.trim()) e("name", "App name is empty.");
  if (/[\\/:*?"<>|]/.test(c.name)) e("name", "App name cannot contain \\ / : * ? \" < > |.");
  if (!/^[a-zA-Z][\w-]*(\.[a-zA-Z][\w-]*){2,}$/.test(c.appId)) e("appId", `appId “${c.appId}” must be reverse-DNS, e.g. com.yourcompany.${pkgName(c.name).replace(/-/g, "")}.`);
  if (/^com\.example\./.test(c.appId)) w("appId", "appId still uses com.example; change it to your own domain before shipping (it identifies the app and its settings folder).");
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(c.version)) e("version", `Version “${c.version}” must be semver like 1.2.0.`);
  if (c.mode === "static") {
    if (!c.webDir) e("webDir", "Choose the folder with index.html.");
    else if (has.web === false) e("webDir", `${c.webDir}/index.html not found. Build the site first (e.g. npm run build).`);
  } else {
    if (!c.entry) e("entry", "Choose the server entry file (e.g. server.js).");
    else if (has.entry === false) e("entry", `${c.entry} not found.`);
    if (!c.usesPortEnv && !c.port) e("port", "The server does not read process.env.PORT; enter the port it listens on.");
    if (!c.usesPortEnv && c.port) w("port", `Fixed port ${c.port}: the app fails to start if another program uses it. Prefer reading process.env.PORT.`);
  }
  if (c.icon) {
    if (has.icon === null) e("icon", `${c.icon} is not a PNG.`);
    else if (has.icon && (has.icon.width !== has.icon.height || has.icon.width < 512)) e("icon", `Icon is ${has.icon.width}×${has.icon.height}; use a square PNG of at least 512×512 (1024×1024 is best).`);
  }
  if (!c.targets.length) e("targets", "Pick at least one target.");
  if (c.width < 320 || c.height < 240) e("window", "Window must be at least 320×240.");
  if (!c.signing?.macIdentity && c.targets.includes("dmg")) out.push({ severity: "info", field: "signing", message: "macOS build is unsigned: users must right-click → Open (or allow it in System Settings → Privacy & Security) the first time." });
  if (!c.signing?.winCertificateFile && c.targets.includes("nsis")) out.push({ severity: "info", field: "signing", message: "Windows installer is unsigned: SmartScreen shows “Windows protected your PC” → More info → Run anyway." });
  if (c.signing?.winCertificateFile && has.cert === false) e("signing", `Certificate ${c.signing.winCertificateFile} not found.`);
  if (c.signing?.macIdentity && !/^(Developer ID Application|Apple Development|Mac Developer):|^[0-9A-F]{40}$/.test(c.signing.macIdentity)) w("signing", "macIdentity is usually “Developer ID Application: Name (TEAMID)”.");
  return out;
}

/** 本机能不能打这个目标。 */
export function buildableHere(t: Target, platform: NodeJS.Platform, wine: boolean): { ok: boolean; why?: string } {
  if (t === "dir") return { ok: true };
  if (t === "dmg") return platform === "darwin" ? { ok: true } : { ok: false, why: "dmg can only be built on macOS" };
  if (t === "appimage") return platform === "linux" ? { ok: true } : { ok: false, why: "AppImage is built on Linux" };
  if (platform === "win32") return { ok: true };
  return wine ? { ok: true } : { ok: false, why: platform === "darwin" ? "nsis on macOS needs Wine (brew install --cask wine-stable), or build on Windows" : "nsis on Linux needs Wine, or build on Windows" };
}

export function builderArgs(t: Target, platform: NodeJS.Platform): string[] {
  if (t === "dmg") return ["--mac", "dmg"];
  if (t === "nsis") return ["--win", "nsis"];
  if (t === "appimage") return ["--linux", "AppImage"];
  return [platform === "darwin" ? "--mac" : platform === "win32" ? "--win" : "--linux", "dir"];
}

export function builderYml(c: AppConfig): string {
  const L: string[] = [
    "# Generated by App Installer Builder (ZCode). Edit freely; re-generating overwrites this file.",
    `appId: ${y(c.appId)}`, `productName: ${y(c.name)}`, `copyright: ${y(`Copyright © ${new Date().getFullYear()} ${c.author || c.name}`)}`,
    "directories:", "  output: release", "  buildResources: build",
    "files:", "  - main.cjs", "  - package.json",
    "extraResources:",
  ];
  if (c.mode === "static") L.push(`  - from: ${y(`../${c.webDir === "." ? "" : c.webDir}`.replace(/\/$/, "") || "..")}`, "    to: web", "    filter: [\"**/*\", \"!desktop{,/**}\", \"!node_modules{,/**}\", \"!.git{,/**}\"]");
  else L.push("  - from: ..", "    to: server", "    filter: [\"**/*\", \"!desktop{,/**}\", \"!.git{,/**}\", \"!release{,/**}\"]");
  L.push("asar: true", "mac:", "  target: [dmg]", "  category: public.app-category.productivity", "  icon: build/icon.png");
  if (c.signing?.macIdentity) L.push(`  identity: ${y(c.signing.macIdentity)}`, "  hardenedRuntime: true", "  notarize: false");
  else L.push("  identity: null   # unsigned: no certificate was provided");
  L.push("dmg:", "  writeUpdateInfo: false", "win:", "  target: [nsis]", "  icon: build/icon.png");
  if (c.signing?.winCertificateFile) L.push("  signtoolOptions:", `    certificateFile: ${y(c.signing.winCertificateFile.startsWith("/") ? c.signing.winCertificateFile : `../${c.signing.winCertificateFile}`)}`, "    # password: set the WIN_CSC_KEY_PASSWORD environment variable; it is never written here");
  else L.push("  # unsigned: no certificate was provided");
  L.push("nsis:", "  oneClick: false", "  perMachine: false", "  allowToChangeInstallationDirectory: true", "  createDesktopShortcut: true", "  createStartMenuShortcut: true", `  shortcutName: ${y(c.name)}`, "  differentialPackage: false",
    "linux:", "  target: [AppImage]", "  category: Utility", "  icon: build/icon.png", `  maintainer: ${y(c.author || c.name)}`, "publish: null", "");
  return L.join("\n");
}

export function packageJson(c: AppConfig): string {
  return JSON.stringify({
    name: pkgName(c.name), productName: c.name, version: c.version, description: c.description || c.name, author: c.author || c.name, private: true, main: "main.cjs", desktopName: `${pkgName(c.name)}.desktop`,
    scripts: { start: "electron .", dist: "electron-builder" },
    devDependencies: { electron: ELECTRON_VERSION, "electron-builder": BUILDER_VERSION },
  }, null, 2) + "\n";
}

export function mainCjs(c: AppConfig): string {
  const cfg = { name: c.name, mode: c.mode, width: c.width, height: c.height, webDir: c.webDir ?? ".", entry: c.entry ?? "server.js", usesPortEnv: !!c.usesPortEnv, port: c.port ?? 0 };
  return `// Electron shell generated by App Installer Builder (ZCode). Edit freely.
"use strict";
const { app, BrowserWindow, protocol, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const CONFIG = ${JSON.stringify(cfg, null, 2)};
const SMOKE = process.env.APP_INSTALLER_SMOKE === "1"; // used by the plugin's self-test: print the page title and quit
let server = null;

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

/** Static site: served from app://local/ so absolute paths (/assets/…) and client-side routes work. */
function serveStatic() {
  const root = app.isPackaged ? path.join(process.resourcesPath, "web") : path.resolve(__dirname, "..", CONFIG.webDir);
  protocol.handle("app", (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) return new Response("Forbidden", { status: 403 });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) file = path.extname(rel) ? "" : path.join(root, "index.html"); // SPA fallback
    if (!file) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  return "app://local/";
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = require("node:net").createServer();
    s.unref(); s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
function waitFor(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryOnce = () => http.get(url, (res) => { res.resume(); resolve(); }).on("error", () => (Date.now() > end ? reject(new Error("Server did not start: " + url)) : setTimeout(tryOnce, 200)));
    tryOnce();
  });
}

/** Node server: started with Electron's own Node (no separate Node install needed). */
async function startServer() {
  const root = app.isPackaged ? path.join(process.resourcesPath, "server") : path.resolve(__dirname, "..");
  const port = CONFIG.usesPortEnv ? await freePort() : CONFIG.port;
  const logFile = path.join(app.getPath("userData"), "server.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const log = fs.openSync(logFile, "a");
  server = spawn(process.execPath, [path.join(root, CONFIG.entry)], {
    cwd: root, stdio: ["ignore", log, log],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "production", APP_DATA_DIR: app.getPath("userData") },
  });
  server.on("exit", (code) => { if (code && !app.isQuitting) console.error("server exited with code " + code + "; see " + logFile); });
  const url = "http://127.0.0.1:" + port + "/";
  await waitFor(url, 20000);
  return url;
}

async function createWindow() {
  const url = CONFIG.mode === "server" ? await startServer() : serveStatic();
  const win = new BrowserWindow({ width: CONFIG.width, height: CONFIG.height, title: CONFIG.name, show: !SMOKE, autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/.test(target)) shell.openExternal(target); return { action: "deny" }; });
  if (SMOKE) win.webContents.once("did-finish-load", async () => {
    const title = await win.webContents.executeJavaScript("document.title");
    const text = await win.webContents.executeJavaScript("document.body.innerText.slice(0, 400)");
    console.log("APP_INSTALLER_SMOKE " + JSON.stringify({ title, url: win.webContents.getURL(), text }));
    app.quit();
  });
  const extra = SMOKE ? (process.env.APP_INSTALLER_SMOKE_PATH || "") : "";
  await win.loadURL(url + (extra.startsWith("/") ? extra.slice(1) : extra));
}

app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on("before-quit", () => { app.isQuitting = true; if (server) server.kill(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin" || SMOKE) app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.whenReady().then(createWindow).catch((error) => { console.error(error); app.exit(1); });
`;
}

export function desktopReadme(c: AppConfig): string {
  const unsignedMac = !c.signing?.macIdentity, unsignedWin = !c.signing?.winCertificateFile;
  return `# ${c.name} — desktop app

Generated by App Installer Builder. This folder wraps the project in Electron and packages it with electron-builder.

- Mode: ${c.mode === "static" ? `static site from \`${c.webDir}\` (served at app://local/)` : `Node server \`${c.entry}\` started with Electron's Node (${c.usesPortEnv ? "free port via PORT" : `fixed port ${c.port}`})`}
- Targets: ${c.targets.join(", ")}
- Signing: macOS ${unsignedMac ? "**unsigned**" : `signed as “${c.signing!.macIdentity}” (not notarized)`}, Windows ${unsignedWin ? "**unsigned**" : "signed with the provided certificate (password from WIN_CSC_KEY_PASSWORD)"}

## Build

\`\`\`sh
cd desktop
npm install
npx electron-builder --mac dmg     # on macOS
npx electron-builder --win nsis    # on Windows (or macOS/Linux with Wine)
npx electron-builder --linux AppImage
\`\`\`

Output goes to \`desktop/release/\`. ${c.mode === "static" ? "Rebuild the website first if it changed." : "Run npm install in the project first so node_modules is packaged."}
${unsignedMac ? "\nUnsigned macOS apps: the first time, right-click the app → Open, or allow it in System Settings → Privacy & Security.\n" : ""}${unsignedWin ? "\nUnsigned Windows installers: SmartScreen shows “Windows protected your PC” → More info → Run anyway.\n" : ""}`;
}
