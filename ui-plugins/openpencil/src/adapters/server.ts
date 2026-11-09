import { extname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "@open-pencil/mcp";
import { z } from "zod";
import {
  BRIDGE_COMMANDS,
  DESIGN_FORMATS,
  DesignError,
  MAX_ASSET_BYTES,
  MAX_DESIGN_BYTES,
  PANEL_URI,
  PLUGIN_NAME,
  SURFACE_ID,
  designRef,
} from "#openpencil/contract.ts";
import { registerDesignResources } from "#openpencil/adapters/resources.ts";
import type { DesignRegistry } from "#openpencil/adapters/registry.ts";
import type { UpstreamBridge } from "#openpencil/adapters/upstream.ts";
import { describeFig, penToFig } from "#openpencil/adapters/headless.ts";
import {
  listWorkspaceFiles,
  readWorkspaceBytes,
  workspaceRelative,
  writeWorkspaceBytes,
} from "#openpencil/adapters/files.ts";

export interface DesignServerOptions {
  registry: DesignRegistry;
  bridge: UpstreamBridge;
  workspaceRoot: string;
  assetRoot: string;
  enableEval: boolean;
}
/** 上游里与本插件文件流重复的工具：文档打开/保存统一走 open_design / new_design / 面板自动保存。 */
const HIDDEN_UPSTREAM_TOOLS = new Set(["open_file", "save_file", "new_document", "list_documents"]);
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(png|jpg|jpeg|webp|gif|svg)$/i;
const documentId = z.string().regex(/^d[0-9a-f]{12}$/);
const toolMeta = (name: string, visibility: Array<"model" | "app">) => {
  // 原先所有工具都绑定面板，连查询/导出也会触发 UI 和替代占位；执行依赖桥，不依赖展示声明。
  const opensPanel = name === "open_design" || name === "new_design";
  return {
    ui: { visibility, ...(opensPanel ? { resourceUri: PANEL_URI, surface: SURFACE_ID } : {}) },
    ...(opensPanel ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } } : {}),
  };
};

export function createDesignServer(options: DesignServerOptions) {
  const { registry, bridge, workspaceRoot, assetRoot } = options;
  const server = new McpServer({ name: PLUGIN_NAME, version: "0.3.2" });
  const register = (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    visibility: Array<"model" | "app">,
    execute: (input: any) => Promise<Record<string, unknown>>,
  ) => {
    server.registerTool(
      name,
      { description, inputSchema, _meta: toolMeta(name, visibility) },
      async (input) => {
        try {
          const result = await execute(input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          const code = error instanceof DesignError ? error.code : "operation_failed";
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: { error: { code, message } },
          };
        }
      },
    );
  };
  /** 面板在线时把"当前文档"推给它；离线时面板启动会自己查 get_design_status。 */
  async function pushActiveDocument() {
    const doc = registry.active();
    if (!doc || !(await bridge.isConnected())) return;
    await bridge
      .sendRPC({
        command: BRIDGE_COMMANDS.openDocument,
        args: { documentId: doc.id, path: doc.path, revision: doc.revision },
      })
      .catch(() => undefined);
  }
  async function activeOrRequired(id?: string) {
    if (id) return registry.get(id);
    const doc = registry.active();
    if (!doc)
      throw new DesignError(
        "no_active_document",
        "还没有打开设计稿，先调用 open_design 或 new_design",
      );
    return doc;
  }

  register(
    "list_designs",
    "List .fig / .pen design files in this workspace, with revision and owner for already-opened ones.",
    {},
    ["model", "app"],
    async () => {
      const files = await listWorkspaceFiles(workspaceRoot, DESIGN_FORMATS);
      const opened = new Map(registry.list().map((doc) => [doc.path, doc]));
      return {
        active: registry.active()?.id ?? null,
        documents: files.map((path) => {
          const doc = opened.get(path);
          return doc ? { ...designRef(doc), dirty: doc.dirty } : { path };
        }),
      };
    },
  );
  register(
    "open_design",
    "Open a workspace .fig (or read-only .pen) design as the active document and show it in the side panel. Call this before any design tool.",
    { path: z.string().min(1).max(1024) },
    ["model", "app"],
    async ({ path }) => {
      const doc = await registry.open(path);
      registry.setActive(doc.id);
      await pushActiveDocument();
      return { document: designRef(doc) };
    },
  );
  register(
    "new_design",
    "Create an empty .fig design at a workspace path (e.g. designs/landing.fig), open it and show the panel.",
    { path: z.string().min(1).max(1024), open: z.boolean().default(true) },
    ["model", "app"],
    async ({ path, open }) => {
      const doc = await registry.create(path);
      if (open) {
        registry.setActive(doc.id);
        await pushActiveDocument();
      }
      return { document: designRef(doc) };
    },
  );
  register(
    "get_design_status",
    "Panel-only: active document, revision, owner, pending external changes and the bridge endpoint.",
    { documentId: documentId.optional() },
    ["app"],
    async ({ documentId: id }) => {
      const doc = id ? registry.get(id) : registry.active();
      return {
        document: doc
          ? { ...designRef(doc), dirty: doc.dirty, externalChange: doc.externalChange }
          : null,
        bridge: bridge.endpoint,
        live: await bridge.isConnected(),
      };
    },
  );
  register(
    "save_design",
    "Panel-only: write the serialized .fig with revision checking (revision_conflict keeps the draft in the panel).",
    {
      documentId,
      expectedRevision: z.number().int().positive(),
      base64: z.string().max(Math.ceil((MAX_DESIGN_BYTES * 4) / 3) + 4),
    },
    ["app"],
    async ({ documentId: id, expectedRevision, base64 }) => {
      const bytes = Buffer.from(base64, "base64");
      // OpenPencil 的 .fig 是 ZIP 容器，魔数 PK；拒绝把空串或损坏内容写进用户文件。
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        throw new DesignError("invalid_fig", "不是有效的 .fig 内容");
      const doc = await registry.save(id, expectedRevision, bytes);
      return { document: designRef(doc) };
    },
  );
  register(
    "report_panel_state",
    "Panel-only: declare whether the panel holds the live document and whether it has unsaved edits.",
    {
      documentId,
      live: z.boolean(),
      dirty: z.boolean().default(false),
      active: z.boolean().default(false),
    },
    ["app"],
    async ({ documentId: id, live, dirty, active }) => {
      if (active) registry.setActive(id);
      return { document: designRef(registry.setOwner(id, live ? "live" : "file", dirty)) };
    },
  );
  register(
    "resolve_conflict",
    "Panel-only: after an external change, keep-mine (panel re-saves with the current revision) or reload from disk.",
    { documentId, strategy: z.enum(["keep-mine", "reload"]) },
    ["app"],
    async ({ documentId: id, strategy }) => ({
      document: designRef(registry.resolveConflict(id, strategy)),
    }),
  );
  register(
    "import_asset",
    "Panel-only: store an image next to the design (images/<name>) and return the relative URL for an image fill.",
    {
      documentId,
      name: z.string().regex(ASSET_NAME),
      base64: z.string().max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 4),
    },
    ["app"],
    async ({ documentId: id, name, base64 }) => {
      const doc = registry.get(id);
      const bytes = Buffer.from(base64, "base64");
      const dir = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : "";
      const target = `${dir ? `${dir}/` : ""}images/${name}`;
      const absolute = await writeWorkspaceBytes(workspaceRoot, target, bytes, false);
      return { path: await workspaceRelative(workspaceRoot, absolute), url: `./images/${name}` };
    },
  );
  register(
    "write_export",
    "Panel-only: save a Web editor export in the workspace without overwriting an existing file.",
    {
      path: z.string().min(1).max(1024),
      mime: z.string().max(120),
      base64: z.string().max(Math.ceil((MAX_DESIGN_BYTES * 4) / 3) + 4),
    },
    ["app"],
    async ({ path, base64 }) => {
      if (!/\.(png|jpe?g|webp|svg|pdf|pptx|fig)$/i.test(path))
        throw new DesignError("invalid_format", "不支持的导出格式");
      const absolute = await writeWorkspaceBytes(
        workspaceRoot,
        path,
        Buffer.from(base64, "base64"),
        false,
      );
      return { path: await workspaceRelative(workspaceRoot, absolute) };
    },
  );
  register(
    "export_design",
    "Export nodes (default: selection, else whole page) of the live document to the workspace: png/jpg/webp images or JSX code. Returns the written path.",
    {
      documentId: documentId.optional(),
      nodeIds: z.array(z.string()).max(200).optional(),
      scale: z.number().min(0.25).max(4).default(1),
      format: z.enum(["png", "jpg", "webp", "jsx"]),
      path: z.string().max(1024).optional(),
      overwrite: z.boolean().default(false),
    },
    ["model", "app"],
    async ({ documentId: id, nodeIds, scale, format, path, overwrite }) => {
      const doc = await activeOrRequired(id);
      const target =
        path ??
        `exports/${doc.name}/${doc.name}${nodeIds?.length ? `-${nodeIds.length}-nodes` : ""}.${format}`;
      if (extname(target).toLowerCase() !== `.${format}`)
        throw new DesignError("invalid_format", "导出路径的扩展名必须与 format 一致");
      if (format === "jsx") {
        const response = (await bridge.sendRPC({
          command: "export_jsx",
          args: { document_id: doc.id, nodeIds, style: "tailwind" },
        })) as { result?: { jsx?: string } };
        const jsx = response.result?.jsx;
        if (typeof jsx !== "string") throw new DesignError("export_failed", "面板没有返回 JSX");
        const absolute = await writeWorkspaceBytes(
          workspaceRoot,
          target,
          Buffer.from(jsx, "utf8"),
          overwrite,
        );
        return {
          path: await workspaceRelative(workspaceRoot, absolute),
          bytes: Buffer.byteLength(jsx),
        };
      }
      const response = (await bridge.sendRPC({
        command: "export",
        args: { document_id: doc.id, nodeIds, scale, format: format.toUpperCase() },
      })) as { result?: { base64?: string } };
      const base64 = response.result?.base64;
      if (typeof base64 !== "string") throw new DesignError("export_failed", "面板没有返回图片");
      const bytes = Buffer.from(base64, "base64");
      const absolute = await writeWorkspaceBytes(workspaceRoot, target, bytes, overwrite);
      return { path: await workspaceRelative(workspaceRoot, absolute), bytes: bytes.length };
    },
  );
  register(
    "describe_design",
    "Headless: summarize pages and top-level nodes of a .fig without opening the panel.",
    {
      path: z.string().min(1).max(1024),
      maxTopLevel: z.number().int().min(1).max(200).default(60),
    },
    ["model"],
    async ({ path, maxTopLevel }) => {
      if (extname(path).toLowerCase() !== ".fig")
        throw new DesignError("invalid_format", "describe_design 只支持 .fig");
      const { bytes } = await readWorkspaceBytes(workspaceRoot, path, MAX_DESIGN_BYTES);
      return { path, ...(await describeFig(bytes, maxTopLevel)) };
    },
  );
  register(
    "convert_pen_to_fig",
    "Import a pencil.dev .pen file (read-only format) and save it as an editable .fig.",
    {
      penPath: z.string().min(1).max(1024),
      figPath: z.string().min(1).max(1024),
      overwrite: z.boolean().default(false),
    },
    ["model", "app"],
    async ({ penPath, figPath, overwrite }) => {
      if (extname(penPath).toLowerCase() !== ".pen" || extname(figPath).toLowerCase() !== ".fig")
        throw new DesignError("invalid_format", "需要 .pen 输入与 .fig 输出路径");
      const { bytes } = await readWorkspaceBytes(workspaceRoot, penPath, MAX_DESIGN_BYTES);
      const fig = await penToFig(bytes.toString("utf8"));
      const absolute = await writeWorkspaceBytes(workspaceRoot, figPath, fig, overwrite);
      const doc = await registry.open(await workspaceRelative(workspaceRoot, absolute));
      return { document: designRef(doc) };
    },
  );

  // 上游 100+ 设计工具：只声明调用可见性，查询/修改经既有桥在已打开的面板中执行，
  // 并隐藏与本插件文件流重复的四个工具。注册函数只认 McpServer.registerTool，这里临时包一层。
  const originalRegisterTool = server.registerTool.bind(server);
  (server as { registerTool: typeof server.registerTool }).registerTool = ((
    name: string,
    config: Record<string, unknown>,
    cb: unknown,
  ) => {
    if (HIDDEN_UPSTREAM_TOOLS.has(name)) return undefined;
    const meta = (config._meta ?? {}) as Record<string, unknown>;
    return (originalRegisterTool as any)(
      name,
      { ...config, _meta: { ...meta, ...toolMeta(name, ["model", "app"]) } },
      cb,
    );
  }) as typeof server.registerTool;
  registerTools(server, {
    enableEval: options.enableEval,
    mcpRoot: workspaceRoot,
    sendRPC: bridge.sendRPC,
  });
  server.registerTool = originalRegisterTool;

  registerDesignResources(server, { registry, bridge, assetRoot });
  return server;
}
