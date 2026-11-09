import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { ensureJupyterPython } from "./jupyter-env.mjs";

// 参数可传安装目录（plugins/jupyter-notebook），默认测源码包的 dist。
const root = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = await ensureJupyterPython();
const workspace = await mkdtemp(join(tmpdir(), "jupyter-nb-smoke-"));
const client = new Client({ name: "jupyter-notebook-smoke", version: "1" });
const updated = [];
client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
  updated.push(notification.params.uri);
});
const call = (name, args = {}) => client.callTool({ name, arguments: args });
const ok = async (name, args) => {
  const result = await call(name, args);
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return result;
};
const text = (result) => result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
const readJson = async (uri) => JSON.parse((await client.readResource({ uri })).contents[0].text);

// 1×1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist/server.mjs")],
      cwd: workspace,
      env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspace, JUPYTER_NOTEBOOK_PYTHON: python },
      stderr: "pipe",
    }),
  );
  const { tools } = await client.listTools();
  const meta = Object.fromEntries(tools.map((tool) => [tool.name, tool._meta]));
  for (const toolMeta of Object.values(meta)) {
    assert.equal(toolMeta.ui.resourceUri, "ui://jupyter-notebook/panel.html");
    assert.equal(toolMeta.ui.surface, "jupyter-notebook");
  }
  assert.deepEqual(meta.close_notebook.ui.visibility, ["app"]);
  assert.deepEqual(meta.execute_cells.ui.visibility, ["model", "app"]);
  assert.equal(meta.open_notebook["openai/ui"].preferredModelDisplayMode, "fullscreen");
  assert.equal(meta.execute_cells["openai/ui"], undefined);
  assert.ok(meta.execute_cells.timeoutMs > 1_700_000);

  const panel = await client.readResource({ uri: "ui://jupyter-notebook/panel.html" });
  const html = panel.contents[0].text;
  assert.equal(panel.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.ok(html.includes('<div id="root">') && !html.includes("__PANEL_JS__") && !html.includes("__PANEL_CSS__"));
  assert.equal(html.match(/<\/script/gi).length, 1, "bundle must not close its script tag early");
  assert.ok(html.includes("data:font/woff2;base64,"), "KaTeX fonts are inlined");

  await client.subscribeResource({ uri: "ui://jupyter-notebook/state.json" });
  const empty = await readJson("ui://jupyter-notebook/state.json");
  assert.deepEqual(empty.servers, []);
  const noServer = await call("open_notebook", { path: "a.ipynb", create: true });
  assert.ok(noServer.isError);
  assert.equal(noServer.structuredContent.error.code, "no_server");

  const started = await ok("start_server", {});
  assert.equal(started.structuredContent.server.kind, "launched");
  assert.ok(!JSON.stringify(started).match(/token=/));

  const opened = await ok("open_notebook", { path: "smoke/demo.ipynb", create: true });
  const ref = opened.structuredContent.notebook;
  assert.equal(ref.path, "smoke/demo.ipynb");
  assert.match(text(opened), /Created a new notebook/);
  const uri = `ui://jupyter-notebook/notebooks/${ref.notebookId}.json`;
  await client.subscribeResource({ uri });

  const edited = await ok("edit_notebook", {
    operations: [
      { op: "insert", type: "markdown", source: "# Smoke" },
      { op: "insert", source: "print('hi')\n21 * 2" },
      {
        op: "insert",
        source: `import base64\nfrom IPython.display import Image, display\ndisplay(Image(data=base64.b64decode("${PNG}")))`,
      },
      { op: "insert", source: "raise ValueError('boom')" },
    ],
  });
  assert.equal(edited.structuredContent.inserted.length, 4);
  assert.match(text(edited), /\[1\] code id=\S+ rev=1: print\('hi'\)/);
  const [, codeId, imageId, errorId] = edited.structuredContent.inserted;

  const progress = [];
  const ran = await client.callTool(
    { name: "execute_cells", arguments: { all: true } },
    undefined,
    { onprogress: (value) => progress.push(value) },
  );
  assert.ok(!ran.isError, JSON.stringify(ran.content));
  const ranText = text(ran);
  assert.match(ranText, /Ran 3 cell\(s\)/);
  assert.match(ranText, /\[stdout\]\nhi/);
  assert.match(ranText, /\[Out\[1\]\] 42/);
  assert.match(ranText, /\[error\] ValueError: boom/);
  assert.ok(ran.content.some((block) => block.type === "image" && block.mimeType === "image/png"), "plot images reach the model");
  assert.ok(progress.length >= 1, "progress notifications are sent");

  const doc = await readJson(uri);
  assert.equal(doc.cells.find((cell) => cell.id === codeId).run.state, "ok");
  assert.equal(doc.cells.find((cell) => cell.id === imageId).outputs[0].output_type, "display_data");
  assert.equal(doc.cells.find((cell) => cell.id === errorId).run.state, "error");
  assert.ok(updated.includes(uri), "notebook subscribers are notified");
  assert.ok(updated.includes("ui://jupyter-notebook/state.json"), "state subscribers are notified");

  const read = await ok("read_notebook", { cellIds: [imageId], includeImages: true });
  assert.ok(read.content.some((block) => block.type === "image"));
  const conflict = await call("edit_notebook", { operations: [{ op: "update", cellId: codeId, source: "x", expectedRevision: 7 }] });
  assert.equal(conflict.structuredContent.error.code, "revision_conflict");

  const queued = await ok("execute_cells", { cellIds: [codeId], wait: false });
  assert.match(text(queued), /Queued 1 cell/);
  const state = await readJson("ui://jupyter-notebook/state.json");
  assert.equal(state.notebooks.length, 1);
  assert.equal(state.current, ref.notebookId);
  assert.ok(!JSON.stringify(state).includes("token"));

  const listed = await ok("list_notebooks", { path: "smoke" });
  assert.match(text(listed), /smoke\/demo\.ipynb/);
  const specs = await ok("list_kernelspecs", {});
  assert.match(text(specs), /python3/);

  await ok("close_notebook", { notebook: ref.notebookId });
  const closed = await client.readResource({ uri }).catch((error) => error);
  assert.ok(closed instanceof Error, "closed notebooks are no longer readable");
  await ok("stop_server", { server: started.structuredContent.server.id });
  process.stdout.write("jupyter-notebook smoke: ok\n");
} finally {
  await client.close();
  await rm(workspace, { recursive: true, force: true });
}
