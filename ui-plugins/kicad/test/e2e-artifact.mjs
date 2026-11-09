// Artifact + page test for the KiCad plugin, the way UI_PLUGIN.md layers it ("独立安装产物" and "官方 App/AppBridge 页面通信"):
//   1. the installable package (manifest + skills + dist/) is copied OUT of the source tree into a temp directory and started from there with a minimal environment;
//   2. over real MCP stdio it must list the tools/resource the manifest promises, run the whole design workflow on a real KiCad install and export files into the workspace;
//      (ZT_TEST_SERVER_PATH=/usr/bin:/bin reproduces a sandboxed host: only macOS's python3 3.9 on PATH, no uv on PATH)
//   3. the built panel is loaded in headless Chrome, inside the official App <-> AppBridge handshake, against that same server: one handshake, host theme, image, DRC
//      badge, view state saved through ui/set-widget-state, "ask agent" sent through ui/message, no console errors.
// Run through test/e2e.mjs (pnpm test:e2e).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SRC = resolve(process.env.ZT_KICAD_UI_PLUGIN);                  // .../ui-plugins/kicad
const INSTALL_SRC = (await Promise.all(["../../external_plugins/kicad", "../../plugins/kicad"].map((p) => resolve(SRC, p)).map((d) => stat(d).then(() => d, () => null)))).find(Boolean);
const SHOTS = process.env.ZT_KICAD_SHOTS ? resolve(process.env.ZT_KICAD_SHOTS) : join(tmpdir(), "kicad-plugin-shots"); // screenshots are not part of the repository
const manifest = JSON.parse(await readFile(join(INSTALL_SRC, ".zcode-plugin/plugin.json"), "utf8"));
const log = (m) => console.log(m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. copy the installable package out of the tree ---------------------------------------------------------------------------------------------------------
const tmp = await realpath(await mkdtemp(join(tmpdir(), "kicad-plugin-artifact-"))); // macOS: /var -> /private/var, the server reports resolved paths
const installed = join(tmp, "plugins/kicad");
await cp(INSTALL_SRC, installed, { recursive: true });
await cp(join(SRC, "dist"), join(installed, "dist"), { recursive: true });
const workspace = join(tmp, "workspace");
await mkdir(workspace);
const pluginData = join(tmp, "plugin-data");
for (const arg of manifest.mcpServers.kicad.args) if (arg.includes("${ZCODE_PLUGIN_ROOT}")) await stat(arg.replace("${ZCODE_PLUGIN_ROOT}", installed));
log(`ok   package copied to ${installed} (manifest paths exist)`);

// The live link talks KiCad's IPC API through kipy. The test never goes near a real KiCad: KICAD_API_SOCKET points at a socket of our own, where test/fake_kicad_server.py
// (the real wire protocol, a board model, a log of every request) stands in for the PCB Editor, and the "Enable KiCad API" preference it reads is a temp file saying false.
const fakeSock = join(tmp, "fake-kicad.sock");
const prefsDir = join(tmp, "kicad-prefs");
await mkdir(join(prefsDir, "10.0"), { recursive: true });
await writeFile(join(prefsDir, "10.0/kicad_common.json"), JSON.stringify({ api: { enable_server: false } }));
const UV = existsSync(join(userInfo().homedir, ".local/bin/uv")) ? join(userInfo().homedir, ".local/bin/uv") : "uv";
let fake = null;
const startFake = async (boardPath, parts) => {
  const modelFile = join(tmp, "fake-model.json");
  await writeFile(modelFile, JSON.stringify({ origin_mm: [50, 50], footprints: parts.map((p) => ({ ref: p.ref, value: p.value || "", lib: p.symbol, x_mm: p.x_mm, y_mm: p.y_mm })),
    nets: ["", "GND", "VCC"], tracks: ["GND", "GND", "VCC"], vias: ["GND"], pads: [["GND", "1"], ["VCC", "8"]], zones: 2 }));
  const child = spawn(UV, ["run", "--quiet", "--no-project", "--python", ">=3.11", "--with", "kicad-python>=0.8,<0.9", "python", join(SRC, "test/fake_kicad_server.py"), "--socket", fakeSock, "--board", boardPath, "--model", modelFile],
    { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  let buf = "", err = "";
  const waiters = [];
  child.stdout.on("data", (d) => { buf += d; for (let i; (i = buf.indexOf("\n")) >= 0;) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()?.(JSON.parse(line)); } });
  child.stderr.on("data", (d) => { err += d; });
  const cmd = (o) => new Promise((ok, bad) => { waiters.push(ok); child.stdin.write(`${JSON.stringify(o)}\n`); setTimeout(() => bad(new Error(`the fake KiCad did not answer ${JSON.stringify(o)}: ${err}`)), 90000).unref(); });
  await cmd({ cmd: "ready" });
  return { cmd, child, stop: async () => { await cmd({ cmd: "quit" }).catch(() => {}); child.kill(); } };
};
const client = new Client({ name: "kicad-artifact-test", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath, args: [join(installed, "dist/server.mjs")], cwd: workspace, stderr: "pipe",
  env: { PATH: process.env.ZT_TEST_SERVER_PATH ?? process.env.PATH ?? "", HOME: tmp, ZCODE_WORKSPACE_ROOT: workspace, ZCODE_PLUGIN_DATA: pluginData, ZCODE_KICAD_PYTHON: process.env.ZT_KICAD_PYTHON ?? "", ZCODE_KICAD_APP: "", KICAD_PLUGIN_NO_LAUNCH: "1", KICAD_API_SOCKET: `ipc://${fakeSock}`, KICAD_PLUGIN_PREFS_DIR: prefsDir,
    },
});
let stderr = "";
transport.stderr?.on("data", (d) => { stderr += d; });
const KICAD_PY = "/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3";
// What a user does in the KiCad GUI, done with KiCad's own Python (pcbnew): nudge J1 and save the board file.
const editBoard = (pcb, dx) => execFileSync(KICAD_PY, ["-c", `import pcbnew; b = pcbnew.LoadBoard(${JSON.stringify(pcb)}); fp = b.FindFootprintByReference("J1"); p = fp.GetPosition(); fp.SetPosition(pcbnew.VECTOR2I(p.x + pcbnew.FromMM(${dx}), p.y)); b.Save(${JSON.stringify(pcb)})`],
  { env: { HOME: tmp, KICAD_CONFIG_HOME: join(tmp, "kc"), KICAD_DOCUMENTS_HOME: join(tmp, "kd") }, stdio: "pipe" });
const text = (r) => r.content.find((c) => c.type === "text")?.text;
const data = (r) => { assert.ok(!r.isError, `tool error: ${text(r)}`); return r.structuredContent && Object.keys(r.structuredContent).length ? r.structuredContent : JSON.parse(text(r)); };

try {
  await client.connect(transport);

  // ---- 2. protocol surface the manifest promises ---------------------------------------------------------------------------------------------------------
  const tools = (await client.listTools()).tools;
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const n of ["pcb_search_parts", "pcb_part_info", "pcb_spec_example", "pcb_check_spec", "pcb_build", "pcb_render", "pcb_export_fab",
    "kicad_check_spec_file", "kicad_export_files", "kicad_info", "kicad_board_view", "kicad_board_image", "kicad_open_in_kicad", "kicad_sync_edits", "kicad_edit_status",
    "pcb_export_glb", "kicad_checks", "kicad_layers", "kicad_layer_svg", "kicad_3d_image", "kicad_schematic", "kicad_library_preview"]) assert.ok(byName[n], `missing tool ${n}`);
  assert.ok(!("project_id" in (byName.pcb_build.inputSchema.properties || {})), "project_id must be hidden from the model");
  const surface = manifest.ui.surfaces[0];
  const view = byName.kicad_board_view._meta.ui;
  assert.equal(view.resourceUri, surface.resourceUri);
  assert.equal(view.surface, surface.id);
  assert.deepEqual(view.visibility.sort(), ["app", "model"]);
  assert.deepEqual(byName.kicad_board_image._meta.ui.visibility, ["app"]);
  assert.deepEqual(byName.kicad_edit_status._meta.ui.visibility, ["app"]);
  for (const n of ["kicad_layers", "kicad_layer_svg", "kicad_3d_image", "kicad_schematic", "kicad_library_preview"]) assert.deepEqual(byName[n]._meta.ui.visibility, ["app"], `${n} is for the panel only`);
  for (const n of ["pcb_export_glb", "kicad_checks"]) assert.ok(!byName[n]._meta?.ui, `${n} is a model tool`);
  const resources = (await client.listResources()).resources;
  assert.ok(resources.some((r) => r.uri === surface.resourceUri && r.mimeType === "text/html;profile=mcp-app"), "ui resource not listed with the MCP App mime type");
  const panel = await client.readResource({ uri: surface.resourceUri });
  const html = panel.contents[0].text;
  assert.ok(Buffer.byteLength(html) < 4 * 1024 * 1024, "HTML resource must stay under the host's 4 MiB limit");
  assert.match(html, /<script>/);
  log(`ok   tools=${tools.length} surface "${surface.id}" -> ${surface.resourceUri} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB, visibility honoured)`);

  // ---- design workflow on a real KiCad ---------------------------------------------------------------------------------------------------------------------
  const info = data(await client.callTool({ name: "kicad_info", arguments: {} }));
  assert.match(info.kicad_version, /^10\./, "KiCad 10 expected");
  assert.ok(info.store.startsWith(pluginData), "artifact store must live in the plugin data directory");
  const empty = data(await client.callTool({ name: "kicad_board_view", arguments: {} }));
  assert.equal(empty.ok, false, "before any build the panel tool must say so");
  const ref = data(await client.callTool({ name: "pcb_spec_example", arguments: {} })); // default: the NE555 LED blinker, written into the workspace
  assert.equal(ref.name, "ne555_blinker");
  assert.ok((await stat(ref.path)).isFile() && ref.path.startsWith(workspace));
  const checked = data(await client.callTool({ name: "kicad_check_spec_file", arguments: { spec_path: ref.path } }));
  assert.equal(checked.ok, true, JSON.stringify(checked.issues ?? checked).slice(0, 500));
  const built = data(await client.callTool({ name: "pcb_build", arguments: { spec_artifact_id: checked.spec_artifact_id } }));
  assert.equal(built.ok, true, built.error);
  assert.equal(built.drc.passed, true);
  const rendered = data(await client.callTool({ name: "pcb_render", arguments: { artifact_id: built.pcb_artifact_id, side: "top" } }));
  assert.equal(rendered.ok, true);
  const fab = data(await client.callTool({ name: "pcb_export_fab", arguments: { artifact_id: built.pcb_artifact_id } }));
  assert.equal(fab.ok, true, fab.error);
  const boardResult = await client.callTool({ name: "kicad_board_view", arguments: {} });
  const board = data(boardResult);
  // the host omits an initial result field that is larger than its limit (UI_PLUGIN.md: structuredContent 64 KiB, content 32 KiB, page metadata 16 KiB), and the panel would then have to reread it
  const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
  assert.ok(size(boardResult.structuredContent) < 64 * 1024 && size(boardResult.content) < 32 * 1024 && size(boardResult._meta) < 16 * 1024,
    `initial tool result over the host's limits: structuredContent ${size(boardResult.structuredContent)}, content ${size(boardResult.content)}, _meta ${size(boardResult._meta)}`);
  log(`ok   kicad_board_view initial result: structuredContent ${size(boardResult.structuredContent)} B, content ${size(boardResult.content)} B, _meta ${size(boardResult._meta)} B (host limits 64 KiB / 32 KiB / 16 KiB)`);
  assert.equal(board.ok, true);
  assert.equal(board.drc_passed, true);
  assert.equal(board.parts.length, 9);
  assert.equal(board.name, "ne555_blinker");
  const img = await client.callTool({ name: "kicad_board_image", arguments: { side: "top" } });
  const image = img.content.find((c) => c.type === "image");
  assert.ok(image && image.mimeType === "image/png" && image.data.length > 20000, "panel image");
  const exported = data(await client.callTool({ name: "kicad_export_files", arguments: { artifact_ids: fab.artifacts.map((a) => a.artifact_id).concat(built.pcb_artifact_id) } }));
  for (const w of exported.written) assert.ok((await stat(w.path)).size > 0 && w.path.startsWith(workspace));
  log(`ok   workflow: spec ${checked.spec_artifact_id} -> board ${built.pcb_artifact_id} DRC ${built.drc.errors} errors / ${built.drc.unconnected} unconnected -> ${exported.written.length} files exported into the workspace`);

  // ---- the file tools stay inside the workspace, and never silently replace what is there
  const outside = join(tmpdir(), `kicad-outside-${process.pid}.json`), outsideDir = join(tmpdir(), `kicad-outside-dir-${process.pid}`);
  for (const [tool, args] of [["pcb_spec_example", { write_to: outside }], ["pcb_spec_example", { write_to: "../escape.json" }], ["kicad_check_spec_file", { spec_path: "/etc/hosts" }],
    ["kicad_export_files", { artifact_ids: [built.pcb_artifact_id], dest_dir: outsideDir }], ["kicad_export_files", { artifact_ids: [built.pcb_artifact_id], dest_dir: "../escape-out" }]]) {
    const r = data(await client.callTool({ name: tool, arguments: args }));
    assert.equal(r.ok, false, `${tool} ${JSON.stringify(args)} must be refused`);
    assert.match(r.error, /outside the workspace/);
  }
  assert.ok(!existsSync(outside) && !existsSync(outsideDir) && !existsSync(join(workspace, "..", "escape.json")) && !existsSync(join(workspace, "..", "escape-out")), "nothing was written outside the workspace");
  await mkdir(join(workspace, "kicad"), { recursive: true });
  await symlink(tmpdir(), join(workspace, "kicad", "escape-link"));          // a symlink inside the workspace that leads out is refused as well
  const viaLink = data(await client.callTool({ name: "kicad_export_files", arguments: { artifact_ids: [built.pcb_artifact_id], dest_dir: "kicad/escape-link" } }));
  assert.equal(viaLink.ok, false); assert.match(viaLink.error, /outside the workspace/);
  await rm(join(workspace, "kicad", "escape-link"));
  const original = await readFile(ref.path, "utf8");
  await writeFile(ref.path, `${original.trimEnd()}\n`.replace(/\n$/, "\n\n"));    // the user (or the agent) edited the spec
  const kept = data(await client.callTool({ name: "pcb_spec_example", arguments: {} }));
  assert.equal(kept.ok, false); assert.match(kept.error, /already exists and differs.*overwrite=true/s);
  assert.equal(await readFile(ref.path, "utf8"), `${original.trimEnd()}\n\n`, "the edited spec is untouched");
  assert.equal(data(await client.callTool({ name: "pcb_spec_example", arguments: { overwrite: true } })).ok, true);
  assert.equal(await readFile(ref.path, "utf8"), original, "overwrite=true restores the example");
  assert.equal(data(await client.callTool({ name: "pcb_spec_example", arguments: {} })).ok, true, "an identical file is simply left as it is");
  log("ok   file tools: paths outside the workspace (absolute, ../, symlink) refused and nothing written there; an edited spec is kept unless overwrite=true");

  // ---- KiCad runs on the plugin's private config (the user's ~/Library/Preferences/kicad is never loaded, so never rewritten)
  assert.ok((await stat(join(pluginData, "kicad-env/kicad_config/10.0/kicad_common.json"))).isFile(), "kicad-cli version must have run on the private config");
  assert.ok((await stat(join(pluginData, "kicad-env/kicad_config/10.0/sym-lib-table"))).isFile(), "the private config holds KiCad's stock library tables (ERC needs them)");

  // ---- GLB export for other agents: a real KiCad GLB plus a part table that must agree with the circuit spec
  const glb = data(await client.callTool({ name: "pcb_export_glb", arguments: {} }));
  assert.equal(glb.ok, true, glb.error);
  assert.equal(glb.part_count, 9);
  assert.deepEqual(glb.parts_without_model, [], "every part of the example has a 3D model");
  assert.deepEqual(glb.parts.map((p) => p.ref).sort(), board.parts.map((p) => p.ref).sort(), "one entry per designator");
  for (const want of board.parts) {
    const got = glb.parts.find((p) => p.ref === want.ref);
    assert.ok(Math.abs(got.x_mm - glb.origin_mm[0] - want.x_mm) < 0.01 && Math.abs(got.y_mm - glb.origin_mm[1] - want.y_mm) < 0.01, `${want.ref}: GLB position ${got.x_mm},${got.y_mm} vs spec ${want.x_mm},${want.y_mm} (+origin ${glb.origin_mm})`);
    assert.ok([0, 90, 180, 270].includes(got.rotation_deg), `${want.ref} rotation ${got.rotation_deg}`);
    assert.ok(got.size_mm.every((v) => v > 0.1) && got.bbox_mm.z_max > got.bbox_mm.z_min, `${want.ref} has a body`);
  }
  assert.ok(glb.board.mesh.endsWith("_PCB") && Math.abs(glb.board.x_max - glb.board.x_min - board.width_mm) < 0.2, "board body spans the outline");
  assert.ok(glb.contains.length >= 2 && glb.caveats.length >= 3 && glb.axes.board_y.includes("+Z"), "the answer says what the file contains");
  const glbFile = await readFile(glb.workspace_path);
  assert.equal(glbFile.subarray(0, 4).toString(), "glTF", "a real binary glTF in the workspace");
  assert.ok(glb.workspace_path.startsWith(join(workspace, "kicad/out")) && glbFile.length === glb.size);
  assert.equal(data(await client.callTool({ name: "pcb_export_glb", arguments: {} })).artifact_id, glb.artifact_id, "the same board gives the same stored GLB");
  const fat = data(await client.callTool({ name: "pcb_export_glb", arguments: { include_copper: true, copy_to_workspace: false } }));
  assert.ok(fat.size > glb.size * 2 && fat.part_count === 9 && !("workspace_path" in fat) && fat.contains.length > glb.contains.length, "include_copper adds flat faces, not parts");
  log(`ok   pcb_export_glb: ${glb.size} B, ${glb.part_count} parts joined to the spec by designator (positions agree), include_copper ${fat.size} B`);

  // ---- views the panel tabs show (all app-only tools: kicad-cli, no GUI)
  const lay = data(await client.callTool({ name: "kicad_layers", arguments: {} }));
  assert.equal(lay.layers.length, 13);
  assert.deepEqual(lay.layers.filter((l) => l.default).map((l) => l.id), ["B.Cu", "F.Cu", "F.SilkS", "Edge.Cuts"]);
  const frames = new Set();
  for (const id of ["F.Cu", "B.Cu", "Edge.Cuts", "F.SilkS"]) {
    const svg = await client.callTool({ name: "kicad_layer_svg", arguments: { layer: id } });
    assert.match(text(svg), /<svg[\s\S]*viewBox/);
    frames.add(`${data(svg).width_mm}x${data(svg).height_mm}`);
  }
  assert.equal(frames.size, 1, "every layer has the same frame, so the layers stack exactly");
  assert.equal(data(await client.callTool({ name: "kicad_layer_svg", arguments: { layer: "../../x" } })).ok, false);
  for (const v of ["iso", "bottom"]) {
    const png = (await client.callTool({ name: "kicad_3d_image", arguments: { view: v } })).content.find((c) => c.type === "image");
    assert.ok(png && png.mimeType === "image/png" && png.data.length > 20000, `3D view ${v}`);
  }
  assert.equal(data(await client.callTool({ name: "kicad_3d_image", arguments: { view: "orbit" } })).ok, false);
  const noSch = data(await client.callTool({ name: "kicad_schematic", arguments: {} }));
  assert.equal(noSch.ok, true);
  assert.equal(noSch.exists, false, "the worker builds no schematic");
  assert.match(noSch.message, /no schematic/i);
  const checks0 = data(await client.callTool({ name: "kicad_checks", arguments: {} }));
  assert.equal(checks0.ok, true);
  assert.equal(checks0.drc.passed, true);
  assert.equal(checks0.schematic.exists, false);
  assert.match(checks0.schematic.note, /nothing to run ERC on/);
  const sym = await client.callTool({ name: "kicad_library_preview", arguments: { kind: "symbol", lib_id: "Timer:NE555D" } });
  assert.match(text(sym), /<svg/);
  assert.match(text(await client.callTool({ name: "kicad_library_preview", arguments: { kind: "footprint", lib_id: "Resistor_SMD:R_0603_1608Metric" } })), /<svg/);
  assert.equal(data(await client.callTool({ name: "kicad_library_preview", arguments: { kind: "symbol", lib_id: "../../etc:passwd" } })).ok, false, "library ids with path parts are refused");
  log("ok   tabs data: 13 layers (same frame), 3D views, no-schematic empty state, DRC report, library drawings, bad ids refused");

  // ---- real KiCad GUI round trip (launch disabled here; the GUI itself is exercised by hand / in ZCode Dev)
  const opened = data(await client.callTool({ name: "kicad_open_in_kicad", arguments: {} }));
  assert.equal(opened.ok, true);
  assert.equal(opened.launched, false, "tests never start a GUI");
  assert.ok(opened.pcb.startsWith(join(workspace, "kicad/edit")), "board exported into the workspace");
  assert.ok((await stat(opened.pcb)).isFile() && (await stat(opened.project)).isFile(), "kicad_pcb and kicad_pro written");

  // ---- live link to the running PCB Editor, over the REAL wire protocol (kipy <-> fake_kicad_server.py); nothing here touches a real KiCad
  const FORBIDDEN_REQUESTS = ["SaveDocument", "SaveCopyOfDocument", "RevertDocument", "RunAction", "ClearSelection", "AddToSelection", "RemoveFromSelection", "CreateItems", "DeleteItems", "RefreshEditor", "ParseAndCreateItemsFromString", "SetBoardOrigin", "SetVisibleLayers"];
  const noLeak = (o, what) => assert.ok(!/\.sock|ipc:\/\/|fake-kicad|token/i.test(JSON.stringify(o).replace(/Enable KiCad API/g, "")), `${what} leaks the socket path or a token`);
  const off = data(await client.callTool({ name: "kicad_live_status", arguments: {} }));
  assert.deepEqual([off.ok, off.available, off.reachable, off.api_enabled_in_preferences], [true, false, false, false]);
  assert.match(off.reason, /The KiCad API is off.*Enable KiCad API/s, "a precise one-sentence reason that names the setting");
  const refusedOff = data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "R3", x_mm: 1, y_mm: 1 } }));
  assert.deepEqual([refusedOff.ok, refusedOff.nothing_changed], [false, true]);
  fake = await startFake(opened.pcb, board.parts);
  const on = data(await client.callTool({ name: "kicad_live_status", arguments: {} }));
  assert.deepEqual([on.available, on.reachable, on.board.matches_session, on.board.name, on.kipy], [true, true, true, "ne555_blinker.kicad_pcb", true]);
  assert.match(on.kicad_version, /^10\.0\.6/);
  assert.equal(on.board.path, "kicad/edit/ne555_blinker/ne555_blinker.kicad_pcb", "shown relative to the workspace");
  noLeak(on, "status");
  const snap = data(await client.callTool({ name: "kicad_live_snapshot", arguments: {} }));
  assert.equal(snap.live, true);
  assert.equal(snap.counts.footprints, 9);
  assert.deepEqual(snap.parts.map((p) => p.ref).sort(), board.parts.map((p) => p.ref).sort());
  for (const want of board.parts) {
    const got = snap.parts.find((p) => p.ref === want.ref);
    assert.ok(Math.abs(got.x_mm - want.x_mm) < 0.001 && Math.abs(got.y_mm - want.y_mm) < 0.001, `${want.ref}: live ${got.x_mm},${got.y_mm} vs spec ${want.x_mm},${want.y_mm}`);
  }
  noLeak(snap, "snapshot");
  assert.equal(data(await client.callTool({ name: "kicad_live_snapshot", arguments: { since: snap.signature } })).unchanged, true, "an unchanged board answers with its signature only");
  await fake.cmd({ cmd: "select", refs: ["R3"] });
  assert.deepEqual(data(await client.callTool({ name: "kicad_live_snapshot", arguments: {} })).selection, [{ kind: "footprint", ref: "R3" }], "what the user selected in KiCad");
  await fake.cmd({ cmd: "drag", ref: "R2", x_mm: 61.5, y_mm: 62 });
  assert.deepEqual(data(await client.callTool({ name: "kicad_live_snapshot", arguments: {} })).parts.filter((p) => p.ref === "R2").map((p) => [p.x_mm, p.y_mm]), [[11.5, 12]], "an unsaved move in KiCad shows up at once (file coordinates minus the 50, 50 origin)");
  const mv = data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "R3", x_mm: 12.5, y_mm: 14, rotation_deg: 90 } }));
  assert.deepEqual([mv.ok, mv.saved, mv.read_back_matches_request], [true, false, true]);
  assert.deepEqual(mv.after_read_back, { x_mm: 12.5, y_mm: 14, rotation_deg: 90 });
  assert.match(mv.note, /NOTHING WAS SAVED/);
  noLeak(mv, "move");
  const st1 = await fake.cmd({ cmd: "state" });
  assert.deepEqual([st1.commits, st1.drops, st1.commit_messages, st1.pending_open], [1, 0, ["ZCode: move R3"], false], "one undoable commit, no half-open transaction");
  assert.deepEqual(st1.footprints.R3, [62.5, 64, 90]);
  assert.deepEqual(FORBIDDEN_REQUESTS.filter((n) => n in st1.requests), [], `the plugin sent only reads and the commit trio: ${JSON.stringify(st1.requests)}`);
  assert.deepEqual(data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "R99", x_mm: 1, y_mm: 1 } })).ok, false);
  assert.equal(data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "R3", x_mm: 1e9, y_mm: 1 } })).ok, false);
  await fake.cmd({ cmd: "board", path: join(tmp, "someone-elses", "board.kicad_pcb") });
  const other = data(await client.callTool({ name: "kicad_live_status", arguments: {} }));
  assert.deepEqual([other.available, other.reachable, other.board.matches_session], [false, true, false]);
  assert.match(other.reason, /is not this session's board/);
  assert.equal(data(await client.callTool({ name: "kicad_live_snapshot", arguments: {} })).live, false, "a different board is not shown as the session's");
  const refused = data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "R3", x_mm: 1, y_mm: 1 } }));
  assert.deepEqual([refused.ok, refused.refused, refused.nothing_changed], [false, true, true]);
  assert.equal((await fake.cmd({ cmd: "state" })).commits, 1, "the refused write never reached the editor");
  await fake.cmd({ cmd: "board", path: opened.pcb });
  log(`ok   live link (real kipy wire protocol against the fake editor): status off/on/other-board, snapshot = spec, user edits visible unsaved, one undoable commit with read-back, refusals change nothing, requests sent: ${JSON.stringify(st1.requests)}`);
  assert.equal(data(await client.callTool({ name: "kicad_sync_edits", arguments: {} })).changed, false, "nothing saved yet");
  // a schematic the user drew in KiCad lands next to the board: the Schematic tab shows it and Checks runs ERC on it (fixture: one dangling label and wire = 2 errors, 2 warnings)
  await cp(join(SRC, "test/fixtures/minimal_dangling.kicad_sch"), join(dirname(opened.pcb), "minimal_dangling.kicad_sch"));
  const sch = await client.callTool({ name: "kicad_schematic", arguments: {} });
  assert.equal(data(sch).exists, true);
  assert.match(text(sch), /<svg/);
  assert.equal(data(sch).path, "kicad/edit/ne555_blinker/minimal_dangling.kicad_sch");
  const checks1 = data(await client.callTool({ name: "kicad_checks", arguments: {} }));
  assert.deepEqual([checks1.schematic.erc.errors, checks1.schematic.erc.warnings], [2, 2]);
  assert.ok(["label_dangling", "wire_dangling"].every((t) => t in checks1.schematic.erc.by_type), JSON.stringify(checks1.schematic.erc.by_type));
  assert.ok(checks1.schematic.erc.violations[0].severity === "error" && checks1.schematic.erc.violations[0].items.length > 0, "errors first, with positions");
  assert.ok(checks1.schematic.erc.violations.some((v) => v.items.some((i) => i.x_mm === 50.8 && i.y_mm === 50.8)), "ERC positions are real mm (the label sits at 50.8, 50.8)");
  assert.equal(data(await client.callTool({ name: "kicad_edit_status", arguments: {} })).changed, false);
  editBoard(opened.pcb, 0.3);
  const synced = data(await client.callTool({ name: "kicad_sync_edits", arguments: {} }));
  assert.equal(synced.changed, true, "a save in KiCad must be imported");
  assert.notEqual(synced.artifact_id, built.pcb_artifact_id);
  assert.equal(synced.from_artifact_id, built.pcb_artifact_id);
  assert.equal(typeof synced.drc_passed, "boolean");
  assert.equal(data(await client.callTool({ name: "kicad_sync_edits", arguments: {} })).changed, false, "an import is not repeated");
  const edited = data(await client.callTool({ name: "kicad_board_view", arguments: {} }));
  assert.equal(edited.edited, true);
  assert.equal(edited.pcb_artifact_id, synced.artifact_id);
  assert.equal(edited.edit.active, true);
  const reopened = data(await client.callTool({ name: "kicad_open_in_kicad", arguments: {} }));
  assert.equal(reopened.imported_pending_edits, false);
  assert.equal(await readFile(reopened.pcb, "utf8").then((t) => t.length > 1000), true, "re-opening keeps the user's saved board");
  const exportedEdit = data(await client.callTool({ name: "pcb_export_fab", arguments: { artifact_id: synced.artifact_id } }));
  assert.ok(exportedEdit.warnings.some((w) => /edited in KiCad/.test(w)), "export of an edited board must say BOM/pos come from the spec");
  log(`ok   KiCad GUI round trip: exported to kicad/edit, save imported as ${synced.artifact_id} (DRC ${synced.drc_passed ? "pass" : "FAIL: " + synced.drc.errors + " errors / " + synced.drc.unconnected + " unconnected"}), no repeat import, export warns`);

  // ---- 3. panel inside the official App <-> AppBridge handshake -------------------------------------------------------------------------------------------
  const host = await build({
    stdin: { sourcefile: "host.mjs", resolveDir: process.cwd(), contents: `
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { z } from "zod";
const rpc = async (method, args) => { const r = await fetch('/rpc', { method: 'POST', body: JSON.stringify({ method, args }) }); const j = await r.json(); if (!r.ok) throw Error(j.error); return j; };
const mode = new URLSearchParams(location.search).get('mode') || 'fullscreen';
const frame = document.querySelector('iframe');
if (mode === 'inline') frame.style.height = '400px';
const bridge = new AppBridge(null, { name: 'kicad-page-test', version: '1' }, { serverTools: {}, serverResources: {}, updateModelContext: {}, message: {}, experimental: { 'zcode/widgetState': {} } },
  { hostContext: { theme: new URLSearchParams(location.search).get('theme') || 'light', locale: new URLSearchParams(location.search).get('locale') || 'en-US', displayMode: mode } });
window.bridge = bridge; window.initializations = 0; window.toolCalls = []; window.widgetStates = []; window.messages = [];
bridge.onreadresource = (a) => rpc('readResource', a);
bridge.oncalltool = (a) => { window.toolCalls.push(a.name); return rpc('callTool', a); };
bridge.onupdatemodelcontext = async (p) => { window.modelContext = p; return {}; };
bridge.onmessage = async (p) => { window.messages.push(p); return {}; };
bridge.onsizechange = ({ height }) => { if (mode === 'inline' && height) frame.style.height = Math.ceil(height) + 'px'; };   // an inline card is as tall as the page says: the way the real host sizes it
bridge.setRequestHandler('ui/set-widget-state', { params: z.object({ widgetState: z.unknown() }), result: EmptyResultSchema }, async (p) => { window.widgetStates.push(p.widgetState); return {}; });
bridge.oninitialized = async () => { window.initializations++; await bridge.sendToolInput({ arguments: {} }); await bridge.sendToolResult(await rpc('initial', {})); };
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/panel';` },
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  const initial = await client.callTool({ name: "kicad_board_view", arguments: {} });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://x");
      if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end('<iframe sandbox="allow-scripts" style="border:0;width:100%;height:900px"></iframe><script type="module" src="/host.js"></script>'); }
      else if (url.pathname === "/host.js") { response.setHeader("Content-Type", "text/javascript"); response.end(host.outputFiles[0].text); }
      else if (url.pathname === "/panel") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
      else if (url.pathname === "/favicon.ico") { response.statusCode = 204; response.end(); }
      else if (url.pathname === "/rpc" && request.method === "POST") {
        let body = ""; for await (const chunk of request) body += chunk;
        const { method, args } = JSON.parse(body);
        const result = method === "initial" ? initial : method === "readResource" ? await client.readResource(args) : await client.callTool(args);
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
      } else { response.statusCode = 404; response.end(); }
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error?.message || error) })); }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
  try {
    for (const [theme, locale] of [["light", "en-US"], ["dark", "zh-CN"]]) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(`${base}/?theme=${theme}&locale=${locale}`);
      await page.waitForFunction(() => window.initializations >= 1);
      const f = page.frames()[1];
      await f.waitForSelector("img.board", { timeout: 60000 });
      const body = await f.locator("body").innerText();
      assert.match(body, /DRC/);
      const mark = await f.locator(".logo svg").boundingBox();
      assert.ok(mark && mark.width >= 28 && mark.width <= 40 && Math.abs(mark.width - mark.height) < 1, "the plugin logo is shown in the header as a small square mark");
      assert.equal(await f.locator(".logo title").count(), 0, "no tooltip title inside the inlined logo");
      assert.match(body, locale === "zh-CN" ? /元件/ : /PARTS/i);
      assert.equal(await f.evaluate(() => document.documentElement.dataset.theme), theme);
      assert.ok(await f.locator("img.board").evaluate((img) => img.naturalWidth > 100), "board image decoded");
      assert.equal(await page.evaluate(() => window.initializations), 1, "exactly one handshake");
      // view state: switch to the bottom side -> saved through the host, image reloaded for that side
      await f.getByRole("button", { name: locale === "zh-CN" ? "底层" : "bottom" }).click();
      await page.waitForFunction(() => window.widgetStates.length >= 1);
      assert.deepEqual(await page.evaluate(() => window.widgetStates.at(-1)), { side: "bottom", tab: "board" });
      assert.equal(await f.getByRole("button", { name: locale === "zh-CN" ? "底层" : "bottom" }).getAttribute("aria-pressed"), "true", "active side must be exposed as aria-pressed=true");
      await page.waitForFunction(() => window.toolCalls.filter((n) => n === "kicad_board_image").length >= 2);
      // the edit session from above is active: banner + edited badge are visible; "Open in KiCad" goes through the host; a second save syncs by itself
      assert.match(await f.locator("body").innerText(), locale === "zh-CN" ? /已在 KiCad 中编辑/ : /edited in KiCad/);
      assert.match(await f.locator(".banner").innerText(), locale === "zh-CN" ? /⌘S/ : /⌘S/);
      await f.getByRole("button", { name: locale === "zh-CN" ? "在 KiCad 中编辑" : "Open in KiCad" }).click();
      await page.waitForFunction(() => window.toolCalls.includes("kicad_open_in_kicad"));
      const tab = (name) => f.getByRole("tab", { name, exact: true });
      const label = (en, zh) => (locale === "zh-CN" ? zh : en);
      await tab(label("Artifacts", "产物")).click();
      const before = await f.locator("tr", { hasText: "kicad_pcb" }).count();
      editBoard(opened.pcb, locale === "zh-CN" ? -0.2 : 0.2);
      await page.waitForFunction(() => window.toolCalls.includes("kicad_edit_status"), null, { timeout: 15000 });
      await f.waitForFunction((n) => [...document.querySelectorAll("tr")].filter((r) => r.textContent.includes("kicad_pcb")).length > n, before, { timeout: 30000 });
      log(`ok   panel auto-synced a second save (${before} -> ${await f.locator("tr", { hasText: "kicad_pcb" }).count()} board artifacts)`);
      // ---- the tabs next to the real KiCad windows: each loads through app-only tools and shows real content from kicad-cli
      await tab(label("Layers", "图层")).click();
      await f.waitForFunction(() => document.querySelectorAll(".stack img.layer").length >= 4, null, { timeout: 60000 });
      await f.waitForFunction(() => [...document.querySelectorAll(".stack img.layer")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 });
      assert.equal(await f.locator(".stack img.layer:visible").count(), 4, "B.Cu, F.Cu, F.SilkS and Edge.Cuts are on by default");
      await f.getByRole("checkbox", { name: "F.Fab", exact: true }).check();
      await f.waitForFunction(() => document.querySelectorAll(".stack img.layer").length >= 5, null, { timeout: 30000 });
      assert.equal(await f.locator(".stack img.layer:visible").count(), 5);
      await f.getByRole("checkbox", { name: "F.Cu", exact: true }).uncheck();
      assert.equal(await f.locator(".stack img.layer:visible").count(), 4);
      await f.getByRole("checkbox", { name: "mirror", exact: true }).check();
      assert.match(await f.locator(".stack").evaluate((el) => getComputedStyle(el).transform), /^matrix\(-1/, "bottom view mirrors the stack");
      await page.screenshot({ path: join(SHOTS, `panel-layers-${theme}-${locale}.png`) });
      await tab(label("3D", "3D")).click();
      await f.waitForFunction(() => document.querySelector("img.board")?.complete && document.querySelector("img.board").naturalWidth > 500, null, { timeout: 60000 });
      await f.getByRole("button", { name: label("Front", "正视"), exact: true }).click();
      await f.waitForFunction(() => document.querySelector("img.board")?.alt === "3D front" && document.querySelector("img.board").complete, null, { timeout: 60000 });
      await page.screenshot({ path: join(SHOTS, `panel-3d-${theme}-${locale}.png`) });
      await tab(label("Schematic", "原理图")).click();
      await f.waitForFunction(() => document.querySelector("img.sch")?.complete && document.querySelector("img.sch").naturalWidth > 50, null, { timeout: 60000 });
      assert.match(await f.locator("body").innerText(), /minimal_dangling\.kicad_sch/);
      await page.screenshot({ path: join(SHOTS, `panel-schematic-${theme}-${locale}.png`) });
      await tab(label("Checks", "检查")).click();
      await f.waitForFunction(() => /label_dangling/.test(document.body.innerText), null, { timeout: 60000 });
      assert.match(await f.locator("body").innerText(), label(/DRC[\s\S]*(passed|failed) · \d+ errors[\s\S]*ERC[\s\S]*2 errors · 2 warnings[\s\S]*Label 'FLOATING' \(50\.8, 50\.8\)/, /DRC[\s\S]*(通过|未通过) · \d+ 错误[\s\S]*ERC[\s\S]*2 错误 · 2 警告[\s\S]*Label 'FLOATING' \(50\.8, 50\.8\)/)); // 50.8 mm: the text report is used because the JSON ERC report of 10.0.6 is 100x too small
      await page.screenshot({ path: join(SHOTS, `panel-checks-${theme}-${locale}.png`) });
      await tab(label("Library", "元件库")).click();
      await f.getByRole("searchbox").fill("ne555");
      await f.getByRole("searchbox").press("Enter");
      await f.waitForSelector("tr.pick", { timeout: 60000 }).catch(async (e) => { throw new Error(`${e.message}\npanel: ${(await f.locator("body").innerText()).slice(0, 800)}\nbrowser errors: ${JSON.stringify(errors)}\ntool calls: ${JSON.stringify(await page.evaluate(() => window.toolCalls))}`); });
      await f.locator("tr.pick", { hasText: "Timer:NE555D" }).first().click();
      await f.waitForFunction(() => document.querySelector(".paper img.sch")?.complete && document.querySelector(".paper img.sch").naturalWidth > 20 && /Timer:NE555D/.test(document.body.innerText), null, { timeout: 60000 });
      await f.waitForFunction(() => [...document.querySelectorAll("th")].some((th) => /^(Pins|引脚)$/.test(th.textContent)) && document.querySelectorAll("tr").length > 8, null, { timeout: 30000 }); // the pin table of pcb_part_info
      await page.screenshot({ path: join(SHOTS, `panel-library-${theme}-${locale}.png`) });
      // ---- Live: the header indicator, the live parts view, the user's selection and unsaved edits, an agent move, and the "other board" state
      const liveText = label("Live", "实时");
      await f.waitForFunction((t) => [...document.querySelectorAll("button.badge.live")].some((b) => b.textContent.trim() === t), liveText, { timeout: 30000 });
      await tab(liveText).click();
      await f.waitForFunction(() => document.querySelectorAll(".scroll.tall tr").length >= 10, null, { timeout: 30000 }); // header + 9 parts
      await fake.cmd({ cmd: "select", refs: ["R3"] });
      await f.waitForFunction(() => /(Selected in KiCad|KiCad 中选中的对象): R3/.test(document.body.innerText), null, { timeout: 15000 });
      const j1 = data(await client.callTool({ name: "kicad_live_snapshot", arguments: {} })).parts.find((p) => p.ref === "J1");
      assert.equal(data(await client.callTool({ name: "kicad_live_move_footprint", arguments: { ref: "J1", x_mm: j1.x_mm + 2, y_mm: j1.y_mm } })).ok, true);
      await f.waitForFunction(() => [...document.querySelectorAll("tr.moved")].some((r) => r.textContent.startsWith("J1") && /\+2, \+?0 mm/.test(r.textContent)), null, { timeout: 15000 });
      await page.screenshot({ path: join(SHOTS, `panel-live-${theme}-${locale}.png`) });
      await fake.cmd({ cmd: "board", path: join(tmp, "someone-elses", "board.kicad_pcb") });
      await f.waitForFunction((t) => [...document.querySelectorAll("button.badge.live")].some((b) => b.textContent.trim() !== t), liveText, { timeout: 15000 });
      await f.waitForFunction(() => /is not this session's board/.test(document.body.innerText), null, { timeout: 15000 });
      await fake.cmd({ cmd: "board", path: opened.pcb });
      await f.waitForFunction((t) => [...document.querySelectorAll("button.badge.live")].some((b) => b.textContent.trim() === t), liveText, { timeout: 15000 });
      for (const name of ["kicad_live_status", "kicad_live_snapshot"]) assert.ok(await page.evaluate((n) => window.toolCalls.includes(n), name), `the panel called ${name}`);
      assert.ok(!(await page.evaluate(() => window.toolCalls.includes("kicad_live_move_footprint"))), "the panel never writes to KiCad");
      log(`ok   panel Live (${theme}, ${locale}): indicator, live parts, selection, unsaved agent move with delta, other-board state`);
      await tab(label("Board", "电路板")).click();
      assert.ok(await f.locator("img.board").evaluate((img) => img.naturalWidth > 100), "back on the Board tab");
      await page.waitForFunction(() => window.widgetStates.at(-1)?.tab === "board"); // saved through the host, asynchronously
      assert.deepEqual(await page.evaluate(() => window.widgetStates.at(-1)), { side: "bottom", tab: "board" });
      for (const name of ["kicad_layers", "kicad_layer_svg", "kicad_3d_image", "kicad_schematic", "kicad_checks", "pcb_search_parts", "kicad_library_preview", "pcb_part_info"])
        assert.ok(await page.evaluate((n) => window.toolCalls.includes(n), name), `the panel called ${name}`);
      log(`ok   panel tabs (${theme}, ${locale}): layers stack + toggles + mirror, 3D views, schematic, checks (DRC + ERC), library search + drawing + pins`);
      // ask the agent: arrives as a user message through the hos
      await f.getByRole("button", { name: locale === "zh-CN" ? "让 Agent 评审" : "Ask agent to review" }).click();
      await page.waitForFunction(() => window.messages.length >= 1);
      assert.match(await page.evaluate(() => window.messages[0].content[0].text), /ne555_blinker/);
      await page.screenshot({ path: join(SHOTS, `panel-${theme}-${locale}.png`) });
      assert.deepEqual(errors, [], "no browser errors");
      log(`ok   panel (${theme}, ${locale}): handshake=1, image, DRC badge, widgetState=${JSON.stringify(await page.evaluate(() => window.widgetStates.at(-1)))}, message sent, toolCalls=${JSON.stringify(await page.evaluate(() => window.toolCalls))}`);
      await page.close();
    }
    // inline: the host sizes the iframe from the height the page reports; that must settle instead of feeding back through the page's own height (UI_PLUGIN.md, sendSizeChanged)
    {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      await page.goto(`${base}/?theme=light&locale=en-US&mode=inline`);
      await page.waitForFunction(() => window.initializations >= 1);
      await page.frames()[1].waitForSelector("img.board", { timeout: 60000 });
      await sleep(1500);
      const heights = [];
      for (let i = 0; i < 8; i++) { heights.push(await page.evaluate(() => Math.round(document.querySelector("iframe").getBoundingClientRect().height))); await sleep(300); }
      assert.ok(Math.max(...heights) - Math.min(...heights) <= 4, `the inline height keeps changing: ${heights}`);
      assert.ok(heights[0] > 400, `the inline card must be tall enough to show the board and the tabs, got ${heights[0]} px`);
      log(`ok   inline card: the height the host gives the iframe settles at ${heights[0]} px (no feedback loop)`);
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  // ---- what the user saved in KiCad is never overwritten, and only boards can be opened (run last: it moves the edit session to a new folder)
  const before = await readFile(reopened.pcb);
  const notABoard = data(await client.callTool({ name: "kicad_open_in_kicad", arguments: { artifact_id: fab.artifacts[0].artifact_id } }));
  assert.equal(notABoard.ok, false); assert.match(notABoard.error, /not a board/);
  const otherBoard = data(await client.callTool({ name: "kicad_open_in_kicad", arguments: { artifact_id: built.pcb_artifact_id } }));   // another artifact than the one being edited
  assert.equal(otherBoard.ok, true);
  assert.match(otherBoard.pcb, /ne555_blinker-r2[\\/]ne555_blinker-r2\.kicad_pcb$/, "a new folder, next to the user's");
  assert.ok((await readFile(reopened.pcb)).equals(before), "the board the user saved is byte for byte what it was");
  log("ok   kicad_open_in_kicad: a non-board artifact is refused; another board goes to ne555_blinker-r2 and the saved one is untouched");
  assert.ok(!/Traceback|Error/.test(stderr.replace(/\[kicad-plugin\][^\n]*\n/g, "")), `server stderr:\n${stderr}`);
  log(`ok   server stderr clean; launcher said: ${stderr.split("\n").find((l) => l.includes("starting with"))?.trim()}`);
} finally {
  await fake?.stop().catch(() => {});
  await client.close().catch(() => {});
  await rm(tmp, { recursive: true, force: true });
}
