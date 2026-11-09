import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DiagramError,
  PANEL_URI,
  DOCUMENT_PREFIX,
  type Diagram,
  type DocumentStore,
  type Operation,
} from "#excalidraw/contract.ts";
import { makeScene, validateScene, selectionContext, validId } from "#excalidraw/domain/scene.ts";
import { readWorkspaceFile, writeWorkspaceFile } from "#excalidraw/adapters/files.ts";

export const diagramRef = (doc: Diagram) => ({
  id: doc.id,
  title: doc.title,
  revision: doc.revision,
  uri: `${DOCUMENT_PREFIX}${doc.id}`,
  elementCount: doc.scene.elements.filter((e) => !e.isDeleted).length,
});
export function createExcalidrawServer({
  store,
  workspaceRoot,
  assetRoot,
}: {
  store: DocumentStore;
  workspaceRoot: string;
  assetRoot: string;
}) {
  const server = new McpServer({ name: "excalidraw", version: "0.3.4" });
  const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
  const object = z.record(z.string(), z.unknown());
  const version = { id, expectedRevision: z.number().int().positive(), operationId: id };
  const register = (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    appOnly: boolean,
    execute: (input: any) => Promise<Record<string, unknown>>,
  ) => {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        _meta: {
          ui: {
            resourceUri: PANEL_URI,
            surface: "excalidraw",
            visibility: appOnly ? ["app"] : ["model", "app"],
          },
          "openai/ui": { preferredModelDisplayMode: "fullscreen" },
        },
      },
      async (input) => {
        try {
          const result = await execute(input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (error) {
          const code = error instanceof DiagramError ? error.code : "operation_failed";
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
  register(
    "create_diagram",
    "Create an editable Excalidraw diagram. Use stable element ids. Shapes accept label:{text}; supply x/y/width/height. Returns document id and revision.",
    {
      title: z.string().min(1).max(200),
      elements: z.array(object).max(5000),
      id: id.optional(),
    },
    false,
    async ({ title, elements, id }) => ({
      document: diagramRef(await store.create(title, makeScene(elements), id)),
    }),
  );
  register(
    "open_diagram",
    "Open a saved document by id, or import a workspace .excalidraw file by path as a new document.",
    {
      id: id.optional(),
      path: z.string().optional(),
    },
    false,
    async (input) => {
      if (!!input.id === !!input.path)
        throw new DiagramError("invalid_input", "Provide exactly one of id or path");
      const doc = input.id
        ? await store.read(input.id)
        : await store.create(
            input.path,
            validateScene(JSON.parse(await readWorkspaceFile(workspaceRoot, input.path))),
          );
      return { document: diagramRef(doc) };
    },
  );
  register(
    "read_scene",
    "Read the current revision before editing. Optional elementIds includes bound labels/arrows; inspect stable ids rather than replacing the whole diagram.",
    {
      id,
      elementIds: z.array(id).optional(),
    },
    false,
    async (input) => {
      const doc = await store.read(input.id);
      const elements = input.elementIds
        ? selectionContext(doc.scene, input.elementIds)
        : doc.scene.elements.filter((e) => !e.isDeleted);
      const summary = elements.map(
        ({
          id,
          type,
          x,
          y,
          width,
          height,
          text,
          containerId,
          startBinding,
          endBinding,
          backgroundColor,
          strokeColor,
        }) => ({
          id,
          type,
          x,
          y,
          width,
          height,
          text,
          containerId,
          startBinding,
          endBinding,
          backgroundColor,
          strokeColor,
        }),
      );
      if (JSON.stringify(summary).length > 24000)
        throw new DiagramError("selection_too_large", "Read fewer elementIds");
      return { document: diagramRef(doc), elements: summary };
    },
  );
  register(
    "apply_operations",
    "Atomically edit existing elements by stable id. Re-read on revision_conflict; retry identical requests with the same operationId. Preserve user layout.",
    {
      ...version,
      operations: z
        .array(
          z.discriminatedUnion("type", [
            z.object({ type: z.literal("add"), element: object }),
            z.object({ type: z.literal("update"), id, changes: object }),
            z.object({ type: z.literal("delete"), id }),
          ]),
        )
        .min(1)
        .max(500),
    },
    false,
    async (input) => ({
      document: diagramRef(
        await store.apply(
          input as {
            id: string;
            expectedRevision: number;
            operationId: string;
            operations: Operation[];
          },
        ),
      ),
    }),
  );
  register(
    "commit_scene",
    "Save the editor draft and optional title with revision checking.",
    { ...version, scene: object, title: z.string().trim().min(1).max(200).optional() },
    true,
    async (input) => ({
      document: diagramRef(await store.commit({ ...input, scene: validateScene(input.scene) })),
    }),
  );
  register("list_diagrams", "List this workspace's saved diagrams.", {}, true, async () => ({
    documents: await store.list(),
  }));
  register(
    "save_copy",
    "Save an editor draft or imported scene as a separate diagram.",
    { title: z.string().max(200), scene: object },
    true,
    async (input) => ({
      document: diagramRef(await store.create(input.title, validateScene(input.scene))),
    }),
  );
  register(
    "export_diagram",
    "Export native .excalidraw to a workspace path. PNG/SVG export is available from the editor. Existing files require overwrite:true.",
    {
      id,
      expectedRevision: z.number().int().positive(),
      path: z.string(),
      overwrite: z.boolean().default(false),
    },
    false,
    async (input) => {
      if (extname(input.path).toLowerCase() !== ".excalidraw")
        throw new DiagramError("invalid_format", "Use a .excalidraw path");
      const doc = await store.read(input.id);
      if (doc.revision !== input.expectedRevision)
        throw new DiagramError("revision_conflict", "Document changed before export");
      const json = JSON.stringify(
        { type: "excalidraw", version: 2, source: "excalidraw", ...doc.scene },
        null,
        2,
      );
      return {
        path: await writeWorkspaceFile(
          workspaceRoot,
          input.path,
          Buffer.from(json),
          input.overwrite,
        ),
        revision: doc.revision,
        // 导出也可能成为会话最后一份结果；冷启动需用文档引用恢复画板，不能依赖内存 widgetState。
        document: diagramRef(doc),
      };
    },
  );
  register(
    "save_image",
    "Save a rendered PNG or SVG to a workspace path.",
    {
      id,
      expectedRevision: z.number().int().positive(),
      path: z.string(),
      data: z.string().max(16 * 1024 * 1024),
      format: z.enum(["png", "svg"]),
      overwrite: z.boolean().default(false),
    },
    true,
    async (input) => {
      const doc = await store.read(input.id);
      if (doc.revision !== input.expectedRevision)
        throw new DiagramError("revision_conflict", "Document changed before export");
      if (extname(input.path).toLowerCase() !== `.${input.format}`)
        throw new DiagramError("invalid_format", "Output extension must match format");
      const bytes = Buffer.from(input.data, input.format === "png" ? "base64" : "utf8");
      if (input.format === "png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
        throw new DiagramError("invalid_image", "Invalid PNG");
      if (
        input.format === "svg" &&
        (!input.data.includes("<svg") || /<script[\s>]|\son\w+=/i.test(input.data))
      )
        throw new DiagramError("invalid_image", "Invalid SVG");
      return {
        path: await writeWorkspaceFile(workspaceRoot, input.path, bytes, input.overwrite),
        revision: doc.revision,
        document: diagramRef(doc),
      };
    },
  );
  server.registerResource(
    "panel",
    PANEL_URI,
    { mimeType: "text/html;profile=mcp-app" },
    async () => ({
      contents: [
        {
          uri: PANEL_URI,
          mimeType: "text/html;profile=mcp-app",
          text: await readFile(join(assetRoot, "panel.html"), "utf8"),
        },
      ],
    }),
  );
  server.registerResource(
    "assets",
    new ResourceTemplate("ui://excalidraw/assets/{name}", { list: undefined }),
    {},
    async (uri, { name }) => {
      if (typeof name !== "string" || !/^(panel\.css|bundle-\d+\.txt|assets\.json)$/.test(name))
        throw new DiagramError("invalid_resource", "Unknown UI asset");
      const text = await readFile(join(assetRoot, name), "utf8");
      if (Buffer.byteLength(text) > 8 * 1024 * 1024)
        throw new DiagramError("resource_too_large", "Asset exceeds limit");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: name.endsWith(".json") ? "application/json" : "text/plain",
            text,
          },
        ],
      };
    },
  );
  server.registerResource(
    "document",
    new ResourceTemplate(`${DOCUMENT_PREFIX}{id}`, { list: undefined }),
    {},
    async (uri, params) => {
      validId(params.id);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await store.read(params.id)),
          },
        ],
      };
    },
  );
  return server;
}
