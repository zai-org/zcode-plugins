// Hermetic checks that need neither KiCad, uv, Chrome nor a network: what CI runs as `pnpm test` after `pnpm build`.
// The full workflow (real KiCad, headless Chrome) is `pnpm test:e2e`; the real desktop sandbox is `pnpm test:desktop` (ZCode checkout required).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const INSTALL = (await Promise.all(["../../external_plugins/kicad", "../../plugins/kicad"].map((p) => join(ROOT, p)).map((d) => stat(d).then(() => d, () => null)))).find(Boolean);
const manifest = JSON.parse(await readFile(join(INSTALL, ".zcode-plugin/plugin.json"), "utf8"));
const read = (...p) => readFile(join(...p), "utf8");
const walk = async (d) => (await Promise.all((await readdir(d, { withFileTypes: true })).map((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])))).flat();

test("build output exists and matches what the manifest points at", async () => {
  for (const f of ["panel.html", "server.mjs", "py/kicad_server.py", "py/kicad_launch.py", "py/kicad_views.py", "py/kicad_live.py", "py/kicad/config.py", "py/kicad/service.py", "THIRD_PARTY_NOTICES.txt"])
    assert.ok((await stat(join(DIST, f))).isFile(), `dist/${f} missing: run pnpm build`);
  for (const server of Object.values(manifest.mcpServers)) for (const arg of server.args) if (arg.includes("${ZCODE_PLUGIN_ROOT}/dist/"))
    assert.ok((await stat(join(DIST, arg.split("${ZCODE_PLUGIN_ROOT}/dist/")[1]))).isFile(), arg);
  assert.ok((await stat(join(DIST, "panel.html"))).size < 4 * 1024 * 1024, "HTML resource limit of the host is 4 MiB");
});

test("manifest, server source and page agree on the surface", async () => {
  const [surface] = manifest.ui.surfaces;
  assert.ok(manifest.mcpServers[surface.server], "surface.server must be a declared MCP server");
  assert.equal(surface.availability, "session");
  const server = await read(DIST, "py/kicad_server.py");
  assert.ok(server.includes(`UI_URI = "${surface.resourceUri}"`), "resource URI differs between manifest and server");
  assert.ok(server.includes(`"surface": "${surface.id}"`), "tool _meta.ui.surface differs from the manifest surface id");
  const page = await read(DIST, "panel.html");
  for (const tool of ["kicad_board_view", "kicad_board_image", "kicad_edit_status", "kicad_open_in_kicad", "kicad_sync_edits", "kicad_live_status", "kicad_live_snapshot", "kicad_layers", "kicad_layer_svg", "kicad_3d_image", "kicad_schematic", "kicad_checks", "kicad_library_preview"]) {
    assert.match(server, new RegExp(`def ${tool}\\(`), `server lacks ${tool}`);
    assert.ok(page.includes(tool), `the page never calls ${tool}`);
  }
  assert.match(page, /ui\/set-widget-state/);
  for (const tool of ["pcb_search_parts", "pcb_part_info"]) assert.ok(page.includes(tool) && (await read(DIST, "py/kicad/mcp_server.py")).includes(`def ${tool}(`), `the Library tab calls the worker tool ${tool}`);
});

test("page tools exist in the server and are visible to the app", async () => {
  const server = await read(DIST, "py/kicad_server.py");
  assert.match(server, /@mcp\.tool\(app=\{"visibility": \["app"\]\}\)\s+def kicad_board_image/);
  assert.match(server, /@mcp\.tool\(app=\{"visibility": \["app"\]\}\)\s+def kicad_edit_status/);
  for (const tool of ["kicad_layers", "kicad_layer_svg", "kicad_3d_image", "kicad_schematic", "kicad_library_preview"]) assert.match(server, new RegExp(`@mcp\\.tool\\(app=\\{"visibility": \\["app"\\]\\}\\)\\s+def ${tool}\\(`), `${tool} must be app-only`);
  assert.match(server, /@mcp\.tool\(app=\{"visibility": \["app"\]\}\)\s+def kicad_live_snapshot\(/, "the live snapshot is for the panel");
  assert.match(server, /@mcp\.tool\(app=\{"visibility": \["model"\]\}[^)]*\)\s+def kicad_live_move_footprint\(/, "the only write tool is for the model, never for the page");
  assert.ok(!/kicad_live_move_footprint/.test(await read(DIST, "panel.html")), "the panel page must never call the write tool");
  for (const tool of ["pcb_export_glb", "kicad_checks"]) assert.match(server, new RegExp(`@mcp\\.tool\\s+def ${tool}\\(`), `${tool} must be visible to the model`);
});

test("both READMEs and the skill describe the same tools", async () => {
  const names = (text) => new Set(text.match(/`(kicad_[a-z_]+|pcb_[a-z_]+)`/g)?.map((s) => s.slice(1, -1)) ?? []);
  const en = names(await read(INSTALL, "README.md")), cn = names(await read(INSTALL, "README_CN.md"));
  assert.deepEqual([...en].sort(), [...cn].sort(), "README.md and README_CN.md must mention the same tools");
  const skill = await read(INSTALL, "skills/kicad-board/SKILL.md");
  assert.match(skill, /^---\nname: kicad-board\ndescription: .+\n---/s);
  for (const tool of ["kicad_open_in_kicad", "kicad_sync_edits", "pcb_build", "kicad_board_view"]) assert.ok(skill.includes(tool), `skill does not mention ${tool}`);
  assert.deepEqual(Object.keys(manifest.description_i18n).sort(), ["en", "zh-CN"]);
});

test("python sources compile", { skip: spawnSync("python3", ["--version"]).status !== 0 && "python3 not available" }, async () => {
  const files = (await walk(join(DIST, "py"))).filter((f) => f.endsWith(".py"));
  assert.ok(files.length > 15);
  const r = spawnSync("python3", ["-c", "import ast, sys\nfor f in sys.argv[1:]: ast.parse(open(f).read(), f)", ...files], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("the vendored worker never reads .env files and the repo has no machine-specific paths", async () => {
  const config = await read(DIST, "py/kicad/config.py");
  assert.ok(!/dotenv|read_text\(|\bopen\(/.test(config), "config shim must not read any file");
  for (const f of [...(await walk(join(ROOT, "src"))), ...(await walk(join(ROOT, "scripts"))), ...(await walk(join(ROOT, "test"))).filter((f) => !f.endsWith("static.test.mjs") && !/[\\/](desktop-sandbox|shots)[\\/]/.test(f)),   // desktop-sandbox and shots are dev-only and not exported
    join(ROOT, "server/kicad_server.py"), join(ROOT, "server/kicad_launch.py"), join(ROOT, "server/kicad_views.py"), join(ROOT, "server/kicad_live.py"), ...(await walk(join(ROOT, "ui/src"))), join(INSTALL, ".zcode-plugin/plugin.json")]) {
    const text = await read(f);
    assert.ok(!/\/Users\/[a-z]|Workspace\/zcode-ui-dev|\.zcode-ui-plugin-dev/.test(text), `${f} contains a machine-specific path`);
  }
});

test("a failed GUI launch is reported as one: pcbnew must stay up, the quarantine fix is named but never run", { skip: spawnSync("python3", ["--version"]).status !== 0 && "python3 not available" }, async () => {
  const server = await read(DIST, "py/kicad_server.py");
  const launch = server.slice(server.indexOf("def _launch("), server.indexOf("def _sync_locked("));
  assert.match(launch, /if NO_LAUNCH:\s+return False, "launch disabled \(KICAD_PLUGIN_NO_LAUNCH=1\)"/, "KICAD_PLUGIN_NO_LAUNCH must still short-circuit before anything is started");
  assert.match(launch, /sys\.platform != "darwin"/);
  assert.match(launch, /return launch_editor\(/, "_launch must delegate to the checked launch");
  assert.ok(!/subprocess|xattr/.test(launch), "_launch itself starts and changes nothing");
  const helper = await read(DIST, "py/kicad_launch.py");
  const xattrCalls = helper.match(/\["xattr"[^\]]*\]/g) ?? [];
  assert.ok(xattrCalls.length > 0 && xattrCalls.every((c) => c.startsWith('["xattr", "-p",')), `the plugin may only read the quarantine attribute (xattr -p), found ${xattrCalls}`);
  const r = spawnSync("python3", [join(ROOT, "test/test_launch.py")], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

test("KiCad runs on a private config: the plugin never lets any KiCad program rewrite the user's ~/Library/Preferences/kicad", async () => {
  const server = await read(DIST, "py/kicad_server.py");
  const set = server.indexOf('"KICAD_CONFIG_HOME"');
  assert.ok(set > 0 && set < server.indexOf("from fastmcp import"), "KICAD_CONFIG_HOME must be set before anything can start a KiCad program");
  assert.ok(server.includes('"KICAD_DOCUMENTS_HOME"'));
  assert.ok(!/KICAD_CONFIG_HOME["']\]\s*=\s*["']?[^\n]*Preferences/.test(server), "no path into the user's preferences");
  assert.ok(/os\.environ\[_var\] = /.test(server) && !/os\.environ\.setdefault\(_var/.test(server), "assigned unconditionally: a KICAD_CONFIG_HOME exported by the user must not win");
  const launcher = await read(DIST, "server.mjs");
  assert.ok(launcher.includes('UV_NO_CONFIG: "1"'), "uv must not read a uv.toml / pyproject.toml from the workspace");
});

test("the GLB tool and the panel tabs are documented the same way in both READMEs and the skill", async () => {
  for (const f of ["README.md", "README_CN.md", "skills/kicad-board/SKILL.md"]) assert.ok((await read(INSTALL, f)).includes("pcb_export_glb"), `${f} does not mention pcb_export_glb`);
  for (const f of ["README.md", "README_CN.md"]) assert.ok((await read(INSTALL, f)).includes("kicad_checks"), `${f} does not mention kicad_checks`);
});

test("the views module: GLB part table, board text helpers, id validation", { skip: spawnSync("python3", ["--version"]).status !== 0 && "python3 not available" }, async () => {
  const r = spawnSync("python3", [join(ROOT, "test/test_views.py")], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});

test("the live link: stub-kipy tests, and the module can only read the board plus open/push/drop one commit", { skip: spawnSync("python3", ["--version"]).status !== 0 && "python3 not available" }, async () => {
  const r = spawnSync("python3", [join(ROOT, "test/test_live.py")], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const source = await read(DIST, "py/kicad_live.py");
  for (const m of ["save", "save_as", "revert", "remove_items", "run_action", "clear_selection", "add_to_selection", "create_items", "refill_zones", "interactive_move"]) assert.ok(!new RegExp(`\\.${m}\\(`).test(source), `kicad_live.py must never call .${m}(`);
  assert.ok(!/(subprocess|Popen|os\.system|os\.kill|signal\.|\.terminate\()/.test(source), "the live link never starts or stops a process");
  const server = await read(DIST, "py/kicad_server.py");
  assert.ok(!/socket_paths|KICAD_API_SOCKET|api\.sock/.test(server), "the server module never touches the socket itself");
});

test("the launcher adds kicad-python as an optional dependency (the plugin still starts without it)", async () => {
  const launcher = await read(DIST, "server.mjs");
  assert.match(launcher, /kicad-python>=0\.8,<0\.9/);
  assert.match(launcher, /starting without the live link/);
});


// A machine without uv (or a usable Python) must not get a plugin that silently fails to connect: the launcher then answers the MCP handshake itself, serves the panel and
// one tool that says what to install. CI separately requires a prepared real runtime.
test("without a Python runner the launcher still answers the MCP handshake, serves the panel and explains what is missing", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [join(DIST, "server.mjs")], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", KICAD_PLUGIN_NO_RUNNER: "1" } });
  let buf = "", err = "";
  const waiting = new Map();
  child.stdout.on("data", (d) => { buf += d; for (let i; (i = buf.indexOf("\n")) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); } });
  child.stderr.on("data", (d) => { err += d; });
  let next = 0;
  const rpc = (method, params = {}) => new Promise((ok, bad) => { const id = ++next; const t = setTimeout(() => bad(new Error(`no answer to ${method}: ${err}`)), 10000); waiting.set(id, (m) => { clearTimeout(t); ok(m); }); child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); });
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(init.result.serverInfo.version, manifest.version, "serverInfo.version equals the manifest version");
    assert.equal(init.result.protocolVersion, "2025-06-18");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const tools = (await rpc("tools/list")).result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), ["kicad_board_view", "kicad_setup_help"]);
    const view = tools.find((t) => t.name === "kicad_board_view")._meta.ui;
    assert.deepEqual([view.resourceUri, view.surface, view.visibility.slice().sort()], [manifest.ui.surfaces[0].resourceUri, manifest.ui.surfaces[0].id, ["app", "model"]]);
    const resources = (await rpc("resources/list")).result.resources;
    assert.ok(resources.some((r) => r.uri === manifest.ui.surfaces[0].resourceUri && r.mimeType === "text/html;profile=mcp-app"));
    const page = (await rpc("resources/read", { uri: manifest.ui.surfaces[0].resourceUri })).result.contents[0];
    assert.equal(page.mimeType, "text/html;profile=mcp-app");
    assert.ok(page.text.includes("<html") && !page.text.includes("/*__JS__*/"));
    const board = (await rpc("tools/call", { name: "kicad_board_view", arguments: {} })).result;
    assert.equal(board.structuredContent.ok, false);
    assert.equal(board.structuredContent.runtime_missing, true);
    assert.match(board.structuredContent.error, /uv/);
    assert.match((await rpc("tools/call", { name: "kicad_setup_help", arguments: {} })).result.content[0].text, /uv .*fastmcp/s);
    assert.equal((await rpc("tools/call", { name: "pcb_build", arguments: {} })).error.code, -32602, "other tools are not there");
    assert.equal((await rpc("no/such/method")).error.code, -32601);
    assert.ok(err.includes("kicad_setup_help") && !/Traceback|Error:/.test(err), `stderr only carries the diagnosis: ${err}`);
  } finally { child.kill(); }
});

// UI_PLUGIN.md: the host sizes an inline page from the height it reports, so a height that follows the viewport can feed back into itself. The page's caps are pixels inline and
// follow the viewport only in the side pane (displayMode "fullscreen").
test("the panel's heights do not follow the viewport while it is inline", async () => {
  const css = await read(ROOT, "ui/src/style.css");
  const withVh = css.split("\n").filter((l) => /\bvh\b|\d(vh|dvh|svh)\b/.test(l));
  assert.ok(withVh.length >= 1 && withVh.every((l) => l.trimStart().startsWith('html[data-mode="fullscreen"]') || l.trimStart().startsWith("/*") || l.startsWith("   ")), `viewport units outside the fullscreen block:\n${withVh.join("\n")}`);
  assert.match(await read(ROOT, "ui/src/dom.js"), /dataset\.mode = ctx\.displayMode === "fullscreen"/);
});


test("runtime preparation fails explicitly instead of returning the fallback server", () => {
  const result = spawnSync(process.execPath, [join(DIST, "server.mjs"), "--prepare-runtime"], {
    encoding: "utf8", env: { KICAD_PLUGIN_NO_RUNNER: "1" }, timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /No Python runner/);
});
