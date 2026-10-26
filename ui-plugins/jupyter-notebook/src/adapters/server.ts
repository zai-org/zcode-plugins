import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  JupyterError,
  LIMITS,
  NOTEBOOK_URI_PREFIX,
  PANEL_URI,
  PLUGIN_VERSION,
  SERVER_NAME,
  STATE_URI,
  SURFACE_ID,
  notebookUri,
  type NotebookDoc,
  type NotebookRef,
  type Output,
  type ServerInfo,
  type SessionState,
} from "#nb/contract.ts";
import type { NotebookOwner } from "#nb/app/notebooks.ts";
import type { ServerRegistry } from "#nb/servers/registry.ts";
import {
  collectImages,
  notebookHeader,
  renderCell,
  renderNotebook,
  type ImageRef,
} from "#nb/domain/summary.ts";

const HTML_MIME = "text/html;profile=mcp-app";
const JSON_MIME = "application/json";
type Visibility = ("model" | "app")[];
const BOTH: Visibility = ["model", "app"];

interface ToolOutput {
  text: string;
  images?: ImageRef[];
  structured?: Record<string, unknown>;
}

const refOf = (doc: NotebookDoc): NotebookRef => ({
  notebookId: doc.id,
  serverId: doc.serverId,
  path: doc.path,
  revision: doc.revision,
});

function describeServer(server: ServerInfo): string {
  const root = server.rootDir ? `, root ${server.rootDir}` : "";
  const version = server.version ? `, Jupyter Server ${server.version}` : "";
  const python = server.python ? `, Python ${server.python}` : "";
  const error = server.error ? ` — ${server.error.split("\n")[0]}` : "";
  return `- ${server.id} (${server.kind === "launched" ? "started by this plugin" : "attached"}, ${server.status}${version}${root}${python})${error}`;
}

/** 一行一个 cell 的目录，编辑后给模型确认位置。 */
function outline(doc: NotebookDoc, limit = 200): string {
  const lines = doc.cells.slice(0, limit).map((cell, index) => {
    const first = cell.source.split("\n").find((line) => line.trim()) ?? "";
    return `[${index}] ${cell.type} id=${cell.id} rev=${cell.revision}: ${first.slice(0, 80)}`;
  });
  if (doc.cells.length > limit) lines.push(`… ${doc.cells.length - limit} more cells`);
  return lines.join("\n") || "(no cells)";
}

/** 页面资源：超出上限时依次省略最大的输出（文件里仍保留）。 */
export function docForPage(doc: NotebookDoc): NotebookDoc {
  const placeholder = (size: number): Output => ({
    output_type: "stream",
    name: "stderr",
    text: `[This output (${(size / 1024 / 1024).toFixed(1)} MB) is too large to show in the panel. It is kept in the notebook file.]`,
  });
  let omitted = 0;
  const sizes: { cell: number; output: number; size: number }[] = [];
  const cells = doc.cells.map((cell, cellIndex) => ({
    ...cell,
    outputs: cell.outputs.map((output, outputIndex) => {
      const size = JSON.stringify(output).length;
      if (size > LIMITS.mimeBytes) {
        omitted += 1;
        return placeholder(size);
      }
      sizes.push({ cell: cellIndex, output: outputIndex, size });
      return output;
    }),
  }));
  let total = JSON.stringify({ ...doc, cells }).length;
  sizes.sort((a, b) => b.size - a.size);
  for (const item of sizes) {
    if (total <= LIMITS.resourceBytes) break;
    cells[item.cell]!.outputs[item.output] = placeholder(item.size);
    total -= item.size;
    omitted += 1;
  }
  return omitted ? { ...doc, cells, omittedOutputs: omitted } : { ...doc, cells };
}

export function createJupyterMcpServer({
  owner,
  registry,
  assetRoot,
  log = () => undefined,
}: {
  owner: NotebookOwner;
  registry: ServerRegistry;
  assetRoot: string;
  log?: (line: string) => void;
}) {
  const server = new McpServer(
    { name: SERVER_NAME, version: PLUGIN_VERSION },
    { capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} } },
  );

  // -------------------------------------------------------------------------
  // 订阅与通知（节流）
  // -------------------------------------------------------------------------
  const subscribed = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stateVersion = 0;
  const notify = (uri: string, delay: number) => {
    if (!subscribed.has(uri) || timers.has(uri)) return;
    const timer = setTimeout(() => {
      timers.delete(uri);
      server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    }, delay);
    timer.unref?.();
    timers.set(uri, timer);
  };
  const stateChanged = () => {
    stateVersion += 1;
    notify(STATE_URI, 150);
  };
  owner.onChange((id) => {
    if (id) notify(notebookUri(id), 100);
    stateChanged();
  });
  registry.onChange(stateChanged);

  // 面板打开、还没有可用 server 时，定时重新检查工作区的 Python：依赖装好后设置页自动前进。
  let environmentTimer: ReturnType<typeof setInterval> | null = null;
  const hasReadyServer = () => registry.list().some((info) => info.status === "ready");
  const watchEnvironment = (enabled: boolean) => {
    if (enabled && !environmentTimer) {
      void registry.checkEnvironment().catch((error) => log(`environment check failed: ${error}`));
      environmentTimer = setInterval(() => {
        if (hasReadyServer() || registry.environment().state === "ready") return;
        void registry.checkEnvironment().catch((error) => log(`environment check failed: ${error}`));
      }, LIMITS.environmentWatchMs);
      environmentTimer.unref?.();
    } else if (!enabled && environmentTimer) {
      clearInterval(environmentTimer);
      environmentTimer = null;
    }
  };

  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    subscribed.add(params.uri);
    if (params.uri === STATE_URI) watchEnvironment(true);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    subscribed.delete(params.uri);
    if (params.uri === STATE_URI) watchEnvironment(false);
    return {};
  });

  // 面板把安装交给 Agent 的时间；依赖就绪或有可用 server 后清除。
  let handoffAt: number | null = null;
  const currentHandoff = () => {
    if (handoffAt !== null && (registry.environment().state === "ready" || hasReadyServer() || Date.now() - handoffAt > LIMITS.handoffMs)) handoffAt = null;
    return handoffAt;
  };

  async function sessionState(): Promise<SessionState> {
    // 第一次读取前先检查一次，面板不会先显示“启动”再换成“缺少依赖”。
    if (registry.environment().state === "unknown" && !hasReadyServer()) await registry.checkEnvironment().catch(() => undefined);
    return {
      version: stateVersion,
      servers: registry.list(),
      discovered: await registry.discovered().catch(() => []),
      notebooks: owner.list(),
      current: owner.current,
      launchPython: registry.launchPython(),
      environment: registry.environment(),
      setup: { handoffAt: currentHandoff() },
    };
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------
  const register = (
    name: string,
    config: {
      description: string;
      input: Record<string, z.ZodType>;
      visibility?: Visibility;
      openPanel?: boolean;
      timeoutMs?: number;
      readOnly?: boolean;
    },
    run: (input: any, extra: any) => Promise<ToolOutput>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        ...(config.readOnly ? { annotations: { readOnlyHint: true } } : {}),
        _meta: {
          ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: config.visibility ?? BOTH },
          ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
          // 宿主只从这个兼容键读取“自动打开侧栏”偏好。
          ...(config.openPanel ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } } : {}),
        },
      },
      async (input: unknown, extra: unknown) => {
        try {
          const output = await run(input, extra);
          return {
            content: [
              { type: "text" as const, text: output.text },
              ...(output.images ?? []).map((image) => ({
                type: "image" as const,
                data: image.data,
                mimeType: image.mimeType,
              })),
            ],
            ...(output.structured ? { structuredContent: output.structured } : {}),
          };
        } catch (error) {
          const code = error instanceof JupyterError ? error.code : "jupyter_error";
          const message = error instanceof Error ? error.message : String(error);
          if (!(error instanceof JupyterError)) log(`${name} failed: ${error instanceof Error ? error.stack : message}`);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: {
              error: { code, message, ...(error instanceof JupyterError && error.details ? { details: error.details } : {}) },
            },
          };
        }
      },
    );
  };

  const notebookParam = z
    .string()
    .optional()
    .describe("Notebook id or path. Defaults to the notebook most recently opened or used.");
  const serverParam = z
    .string()
    .optional()
    .describe("Server id or URL from list_servers. Defaults to the most recently used connected server.");

  register(
    "list_servers",
    {
      description:
        "List Jupyter Servers: those connected to this session and the ones running on this machine that can be connected without a token. Call this first when the user wants to work with notebooks.",
      input: {},
      readOnly: true,
    },
    async () => {
      const state = await sessionState();
      const lines: string[] = [];
      lines.push(state.servers.length ? "Connected servers:" : "No server is connected.");
      lines.push(...state.servers.map(describeServer));
      const free = state.discovered.filter((item) => !item.connectedAs);
      if (free.length) {
        lines.push("", "Running on this machine (connect with connect_server and the URL; no token needed):");
        for (const item of free)
          lines.push(`- ${item.url} (pid ${item.pid}${item.rootDir ? `, root ${item.rootDir}` : ""}${item.version ? `, ${item.version}` : ""})`);
      }
      if (state.notebooks.length) {
        lines.push("", "Open notebooks:");
        for (const nb of state.notebooks)
          lines.push(`- ${nb.path} (id ${nb.id}) on ${nb.serverId}, kernel ${nb.kernelStatus}${nb.id === state.current ? ", current" : ""}`);
      }
      if (!state.servers.length)
        lines.push("", "To start one for this workspace, call start_server.");
      return { text: lines.join("\n"), structured: { servers: state.servers, discovered: state.discovered } };
    },
  );

  register(
    "connect_server",
    {
      description:
        "Connect to an existing Jupyter Server (JupyterLab, Notebook 7 or jupyter_server), local or remote. A URL copied from JupyterLab with ?token=… works as is; for servers running on this machine the token is found automatically.",
      input: {
        url: z.string().min(1).describe("Server URL, e.g. http://127.0.0.1:8888/ or a JupyterLab URL with ?token=…"),
        token: z.string().optional().describe("Token, if not part of the URL and not discoverable."),
      },
    },
    async (input) => {
      const info = await registry.attach({ url: input.url, token: input.token });
      return {
        text: `Connected to ${info.id}.\n${describeServer(info)}\nNotebook paths are relative to the server root${info.rootDir ? ` (${info.rootDir})` : ""}.`,
        structured: { server: info },
      };
    },
  );

  register(
    "start_server",
    {
      description:
        "Start a private Jupyter Server for this workspace (bound to 127.0.0.1, notebook paths relative to the workspace). Uses the first Python that has jupyter-server and ipykernel: the plugin setting, the workspace .venv/venv, the active environment, then PATH. Returns the existing one if already started. Nothing is installed unless useUv is set.",
      input: {
        python: z.string().optional().describe("Path of a Python interpreter to use instead of searching."),
        useUv: z
          .boolean()
          .optional()
          .describe("Run the server with `uv run --with jupyter-server --with ipykernel`. uv may download packages."),
      },
      timeoutMs: 240_000,
    },
    async (input) => {
      const info = await registry.launch({ python: input.python, useUv: input.useUv });
      return {
        text: `Jupyter Server ${info.id} is running.\n${describeServer(info)}\nOpen or create notebooks with open_notebook using workspace-relative paths.`,
        structured: { server: info },
      };
    },
  );

  register(
    "stop_server",
    {
      description: "Stop a Jupyter Server started by start_server, shutting down its kernels. Attached servers cannot be stopped.",
      input: { server: z.string().describe("Server id or URL.") },
    },
    async (input) => {
      const { info } = registry.resolve(input.server);
      await registry.stop(info.id);
      owner.dropServer(info.id);
      return { text: `Stopped ${info.id}.`, structured: { server: { ...info, status: "stopped" } } };
    },
  );

  register(
    "list_notebooks",
    {
      description: "List notebooks (.ipynb) and folders in a directory of a Jupyter Server.",
      input: {
        server: serverParam,
        path: z.string().optional().describe("Directory relative to the server root; empty for the root."),
      },
      readOnly: true,
    },
    async (input) => {
      const { info, client } = registry.resolve(input.server);
      const dir = (input.path ?? "").replace(/^\/+|\/+$/g, "");
      const model = await client.getContents(dir, { type: "directory" });
      const items = (Array.isArray(model.content) ? model.content : []) as {
        name: string;
        path: string;
        type: string;
        last_modified: string;
      }[];
      const entries = items
        .filter((item) => item.type === "directory" || item.type === "notebook")
        .filter((item) => !item.name.startsWith("."))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));
      const lines = entries.map((item) =>
        item.type === "directory" ? `- ${item.path}/` : `- ${item.path} (modified ${item.last_modified})`,
      );
      return {
        text: `${dir || "/"} on ${info.id}:\n${lines.join("\n") || "(no notebooks or folders)"}`,
        structured: {
          server: info.id,
          path: dir,
          entries: entries.map((item) => ({ name: item.name, path: item.path, type: item.type, lastModified: item.last_modified })),
        },
      };
    },
  );

  register(
    "open_notebook",
    {
      description:
        "Open a notebook in the Jupyter Notebook side panel and return its cells. Use create: true to create a new one. Paths are relative to the server root (for a server from start_server, the workspace); absolute paths inside the root also work.",
      input: {
        path: z.string().min(1).describe("Notebook path, e.g. analysis/eda.ipynb"),
        server: serverParam,
        create: z.boolean().optional().describe("Create the notebook if it does not exist."),
        reload: z.boolean().optional().describe("Reload from the server, discarding unsaved local changes."),
        kernel: z.string().optional().describe("Kernelspec name to use (see list_kernelspecs)."),
      },
      openPanel: true,
    },
    async (input) => {
      const { doc: opened, created, reloaded } = await owner.open({
        server: input.server,
        path: input.path,
        create: input.create,
        reload: input.reload,
      });
      const doc = input.kernel ? await owner.setKernel(opened.id, input.kernel) : opened;
      const note = created ? "Created a new notebook." : reloaded ? "Reloaded from the server." : "";
      return {
        text: [note, renderNotebook(doc)].filter(Boolean).join("\n"),
        structured: { notebook: refOf(doc) },
      };
    },
  );

  register(
    "read_notebook",
    {
      description:
        "Read an open notebook: cells in order with ids, revisions, sources and (truncated) outputs. Read before editing; use cellIds to read specific cells in full.",
      input: {
        notebook: notebookParam,
        cellIds: z.array(z.string()).optional().describe("Only these cells."),
        includeOutputs: z.boolean().optional().describe("Include outputs (default true)."),
        maxOutputChars: z.number().int().min(100).max(20_000).optional().describe("Output characters per cell (default 2000)."),
        includeImages: z.boolean().optional().describe("Attach image outputs (plots) so you can see them (default false)."),
      },
      readOnly: true,
    },
    async (input) => {
      const doc = await owner.read(input.notebook, { refresh: true });
      const cells = input.cellIds?.length ? doc.cells.filter((cell) => input.cellIds.includes(cell.id)) : doc.cells;
      return {
        text: renderNotebook(doc, {
          cellIds: input.cellIds,
          includeOutputs: input.includeOutputs ?? true,
          maxOutputChars: input.maxOutputChars,
        }),
        images: input.includeImages ? collectImages(cells) : [],
        structured: { notebook: refOf(doc) },
      };
    },
  );

  const operation = z.discriminatedUnion("op", [
    z.object({
      op: z.literal("insert"),
      type: z.enum(["code", "markdown", "raw"]).optional().describe("Default code."),
      source: z.string().optional(),
      index: z.number().int().min(0).optional(),
      after: z.string().optional().describe("Insert after this cell id."),
      before: z.string().optional().describe("Insert before this cell id."),
      id: z.string().optional().describe("Cell id to use (normally omitted)."),
    }),
    z.object({
      op: z.literal("update"),
      cellId: z.string(),
      source: z.string().describe("The complete new source of the cell."),
      expectedRevision: z.number().int().optional().describe("Cell revision you read; the edit is rejected if it changed."),
    }),
    z.object({
      op: z.literal("move"),
      cellId: z.string(),
      index: z.number().int().min(0).optional(),
      after: z.string().optional(),
      before: z.string().optional(),
    }),
    z.object({ op: z.literal("delete"), cellId: z.string() }),
    z.object({ op: z.literal("set_type"), cellId: z.string(), type: z.enum(["code", "markdown", "raw"]) }),
    z.object({ op: z.literal("clear_outputs"), cellId: z.string().optional().describe("Omit to clear all cells.") }),
  ]);

  register(
    "edit_notebook",
    {
      description:
        "Edit cells of an open notebook. Operations apply in order, all or nothing: insert (index / after / before, default append), update (replace a cell's whole source), move, delete, set_type, clear_outputs. Changes save automatically and show in the panel. Editing does not run cells; call execute_cells.",
      input: {
        notebook: notebookParam,
        operations: z.array(operation).min(1).max(LIMITS.operations),
        expectedRevision: z
          .number()
          .int()
          .optional()
          .describe("Notebook revision you read; the batch is rejected if the notebook changed since."),
      },
    },
    async (input) => {
      const result = owner.edit(input.notebook, input.operations, input.expectedRevision);
      const doc = await owner.read(result.notebookId);
      const lines = [
        `Applied ${input.operations.length} operation(s); notebook revision ${result.revision}.`,
        ...(result.inserted.length ? [`Inserted cells: ${result.inserted.join(", ")}.`] : []),
        "Cells now:",
        outline(doc),
      ];
      return { text: lines.join("\n"), structured: { notebook: refOf(doc), inserted: result.inserted } };
    },
  );

  register(
    "execute_cells",
    {
      description:
        "Run code cells in the notebook's kernel (started on first use) and return their outputs, including plots as images. Cells run in the given order; after an error the rest are skipped. By default waits up to timeoutSeconds; if cells are still running then, they keep running and you can check later with read_notebook or stop them with interrupt_kernel.",
      input: {
        notebook: notebookParam,
        cellIds: z.array(z.string()).optional().describe("Cells to run, in order."),
        all: z.boolean().optional().describe("Run all code cells from the top."),
        wait: z.boolean().optional().describe("Wait for the cells to finish (default true)."),
        timeoutSeconds: z
          .number()
          .int()
          .min(1)
          .max(LIMITS.waitSecondsMax)
          .optional()
          .describe(`How long to wait (default ${LIMITS.waitSecondsDefault}).`),
      },
      timeoutMs: LIMITS.toolTimeoutMs,
    },
    async (input, extra) => {
      const wait = input.wait ?? true;
      const progressToken = extra?._meta?.progressToken;
      const started = Date.now();
      const result = await owner.execute(
        input.notebook,
        { cellIds: input.cellIds, all: input.all },
        {
          wait,
          timeoutMs: (input.timeoutSeconds ?? LIMITS.waitSecondsDefault) * 1000,
          signal: extra?.signal,
          onProgress:
            progressToken !== undefined
              ? (done, total, message) => {
                  void extra
                    .sendNotification({
                      method: "notifications/progress",
                      params: { progressToken, progress: done, total, message },
                    })
                    .catch(() => undefined);
                }
              : undefined,
        },
      );
      const doc = await owner.read(result.notebookId);
      const ran = doc.cells.filter((cell) => result.cellIds.includes(cell.id));
      if (!wait)
        return {
          text: `Queued ${ran.length} cell(s): ${result.cellIds.join(", ") || "none"}.`,
          structured: { notebook: refOf(doc), cellIds: result.cellIds },
        };
      const indexOf = (id: string) => doc.cells.findIndex((cell) => cell.id === id);
      const seconds = Math.round((Date.now() - started) / 1000);
      const states = ran.map((cell) => cell.run?.state ?? "ok");
      const summary = result.finished
        ? `Ran ${ran.length} cell(s) in ${seconds}s: ${states.filter((state) => state === "ok").length} ok, ${states.filter((state) => state === "error").length} error, ${states.filter((state) => state === "aborted").length} skipped.`
        : `Still running after ${seconds}s. ${states.filter((state) => state === "running" || state === "queued").length} cell(s) have not finished; they keep running. Check later with read_notebook, or stop them with interrupt_kernel.`;
      const perCell = Math.max(1_000, Math.floor(LIMITS.summaryChars / Math.max(ran.length, 1)) - 200);
      const body = ran
        .map((cell) => renderCell(cell, indexOf(cell.id), { maxOutputChars: Math.min(perCell, 6_000) }))
        .join("\n\n");
      return {
        text: `${summary}\n${notebookHeader(doc)}\n\n${body}`.slice(0, LIMITS.summaryChars + 2_000),
        images: collectImages(ran),
        structured: { notebook: refOf(doc), cellIds: result.cellIds, finished: result.finished },
      };
    },
  );

  register(
    "interrupt_kernel",
    {
      description: "Interrupt the notebook's kernel (like pressing stop in Jupyter): the running cell raises KeyboardInterrupt and queued cells are skipped.",
      input: { notebook: notebookParam },
    },
    async (input) => {
      const doc = await owner.interrupt(input.notebook);
      return { text: `Interrupted the kernel of ${doc.path}.`, structured: { notebook: refOf(doc) } };
    },
  );

  register(
    "restart_kernel",
    {
      description: "Restart the notebook's kernel, clearing all variables. With runAll, then run every code cell from the top.",
      input: {
        notebook: notebookParam,
        runAll: z.boolean().optional(),
        wait: z.boolean().optional().describe("With runAll, wait for the cells (default true)."),
      },
      timeoutMs: LIMITS.toolTimeoutMs,
    },
    async (input, extra) => {
      let doc = await owner.restart(input.notebook);
      if (!input.runAll) return { text: `Restarted the kernel of ${doc.path}.`, structured: { notebook: refOf(doc) } };
      const wait = input.wait ?? true;
      const result = await owner.execute(doc.id, { all: true }, {
        wait,
        timeoutMs: LIMITS.waitSecondsDefault * 1000,
        signal: extra?.signal,
      });
      doc = await owner.read(doc.id);
      if (!wait)
        return { text: `Restarted the kernel and queued ${result.cellIds.length} cell(s).`, structured: { notebook: refOf(doc) } };
      const ran = doc.cells.filter((cell) => result.cellIds.includes(cell.id));
      const failed = ran.find((cell) => cell.run?.state === "error");
      return {
        text: [
          `Restarted the kernel and ran ${ran.length} cell(s)${result.finished ? "" : " (some are still running)"}.`,
          failed ? renderCell(failed, doc.cells.indexOf(failed)) : "No errors.",
        ].join("\n"),
        structured: { notebook: refOf(doc), finished: result.finished },
      };
    },
  );

  register(
    "list_kernelspecs",
    {
      description: "List the kernels (languages / environments) available on a Jupyter Server.",
      input: { server: serverParam },
      readOnly: true,
    },
    async (input) => {
      const specs = await owner.kernelSpecs(input.server);
      return {
        text: specs.specs
          .map((spec) => `- ${spec.name}: ${spec.displayName} (${spec.language})${spec.name === specs.default ? ", default" : ""}`)
          .join("\n"),
        structured: { default: specs.default, kernelspecs: specs.specs },
      };
    },
  );

  register(
    "set_kernel",
    {
      description: "Change the kernel of a notebook (restarts it with the chosen kernelspec).",
      input: { notebook: notebookParam, name: z.string().describe("Kernelspec name from list_kernelspecs.") },
    },
    async (input) => {
      const doc = await owner.setKernel(input.notebook, input.name);
      return { text: `${doc.path} now uses ${doc.kernel.displayName ?? doc.kernel.name}.`, structured: { notebook: refOf(doc) } };
    },
  );

  register(
    "save_notebook",
    {
      description:
        "Save the notebook now. Saving is automatic; use this with overwrite: true only to resolve a save conflict by replacing the server's version with this one.",
      input: { notebook: notebookParam, overwrite: z.boolean().optional() },
    },
    async (input) => {
      const doc = await owner.save(input.notebook, { overwrite: input.overwrite });
      return { text: `${doc.path}: ${doc.save.state}.`, structured: { notebook: refOf(doc) } };
    },
  );

  register(
    "close_notebook",
    {
      description: "Close a notebook in the panel. Saves it and shuts down the kernel this plugin started for it.",
      input: { notebook: z.string() },
      visibility: ["app"],
    },
    async (input) => {
      await owner.close(input.notebook);
      return { text: "Closed.", structured: { closed: input.notebook } };
    },
  );

  // 面板专用：与 edit_notebook / execute_cells 相同，但记为用户所做，模型看不到这两个工具。
  register(
    "panel_edit_notebook",
    {
      description: "Edit cells on behalf of the user in the panel.",
      input: { notebook: z.string(), operations: z.array(operation).min(1).max(LIMITS.operations) },
      visibility: ["app"],
    },
    async (input) => {
      const result = owner.edit(input.notebook, input.operations, undefined, "user");
      const doc = await owner.read(result.notebookId);
      return {
        text: `Applied ${input.operations.length} operation(s); notebook revision ${result.revision}.`,
        structured: { notebook: refOf(doc), inserted: result.inserted },
      };
    },
  );

  register(
    "panel_execute_cells",
    {
      description: "Run cells on behalf of the user in the panel, without waiting. With restart, restart the kernel first.",
      input: {
        notebook: z.string(),
        cellIds: z.array(z.string()).optional(),
        all: z.boolean().optional(),
        restart: z.boolean().optional(),
      },
      visibility: ["app"],
    },
    async (input) => {
      if (input.restart) await owner.restart(input.notebook);
      const result = await owner.execute(input.notebook, { cellIds: input.cellIds, all: input.all }, { by: "user", wait: false });
      const doc = await owner.read(result.notebookId);
      return { text: `Queued ${result.cellIds.length} cell(s).`, structured: { notebook: refOf(doc), cellIds: result.cellIds } };
    },
  );

  // -------------------------------------------------------------------------
  // 资源
  // -------------------------------------------------------------------------
  server.registerResource("panel", PANEL_URI, { mimeType: HTML_MIME }, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: HTML_MIME, text: await readFile(join(assetRoot, "panel.html"), "utf8") }],
  }));
  server.registerResource("state", STATE_URI, { mimeType: JSON_MIME }, async () => ({
    contents: [{ uri: STATE_URI, mimeType: JSON_MIME, text: JSON.stringify(await sessionState()) }],
  }));
  // 设置页：立即重新检查（check）或记下已交给 Agent（handoff）；返回最新状态。
  server.registerResource(
    "setup",
    new ResourceTemplate("ui://jupyter-notebook/setup/{op}/{nonce}", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      const op = String(variables.op);
      if (op === "check") await registry.checkEnvironment();
      else if (op === "handoff") {
        if (registry.environment().state !== "ready" && !hasReadyServer()) {
          handoffAt = Date.now();
          stateChanged();
        }
      } else throw new JupyterError("invalid_operation", `No setup action ${op}`);
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(await sessionState()) }] };
    },
  );
  server.registerResource(
    "notebook",
    new ResourceTemplate(`${NOTEBOOK_URI_PREFIX}{id}.json`, { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      const id = String(variables.id);
      const doc = owner.peek(id);
      if (!doc) throw new JupyterError("notebook_not_found", `Notebook ${id} is not open.`);
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(docForPage(doc)) }] };
    },
  );

  return server;
}
