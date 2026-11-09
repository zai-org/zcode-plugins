import type { Editor, EditorState } from "@open-pencil/core/editor";
import { FigmaAPI } from "@open-pencil/core/figma-api";
import { ALL_TOOLS, wrapEvalCode } from "@open-pencil/core/tools";
import { computeAllLayouts } from "@open-pencil/core/layout";
import { renderTreeNode } from "@open-pencil/core/design-jsx";
import {
  renderNodesToImage,
  selectionToJSX,
  sceneNodeToJSX,
  type RasterExportFormat,
} from "@open-pencil/core/io";
import { encodeBase64 } from "@open-pencil/core/bytes";
import { nodeToXPath } from "@open-pencil/core/xpath";
import { executeRPCCommand } from "@open-pencil/core/rpc";
import { fontManager } from "@open-pencil/core/text";
import { BRIDGE_COMMANDS, type BridgeEndpoint } from "#openpencil/contract.ts";
import type { DocumentController } from "#ui/document.ts";
import { ensureGraphFonts } from "#ui/fonts.ts";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord =>
  !!v && typeof v === "object" && !Array.isArray(v);

interface Target {
  documentId: string;
  documentName: string;
  path: string;
  pageId: string;
  pageName: string;
}
export interface BridgeSession {
  editor: Editor;
  state: EditorState;
  documents: DocumentController;
}
export interface BridgeOptions {
  getSession: (documentId?: string) => BridgeSession;
  listSessions: () => BridgeSession[];
  openDocument: (target: { id: string }) => Promise<void>;
  endpoint: BridgeEndpoint;
  onConnection: (connected: boolean) => void;
}

/**
 * 上游自动化桥的浏览器端（移植自 open-pencil v0.14.0 `src/app/automation/bridge/*`，MIT）：
 * 主动连 server 进程里的 WebSocket，register 后收 `{type:"request", id, command, args}`，
 * 对活文档执行并回 `{type:"response", id, ...}`。每个请求固定 document_id 对应的标签页 editor，命令串行执行。
 */
function createSessionHandlers({ editor, state, documents }: BridgeSession) {
  function resolveTarget(args: UnknownRecord | undefined): Target {
    const doc = documents.current.value;
    if (!doc) throw new Error("No design is open in the panel. Call open_design first.");
    const requested = typeof args?.document_id === "string" ? args.document_id : undefined;
    if (requested && requested !== doc.id)
      throw new Error(
        `Document "${requested}" is not open; the panel holds "${doc.id}" (${doc.path})`,
      );
    const pageId = typeof args?.page_id === "string" ? args.page_id : state.currentPageId;
    const page = editor.graph.getNode(pageId);
    if (page?.type !== "CANVAS") throw new Error(`Page "${pageId}" not found`);
    return {
      documentId: doc.id,
      documentName: doc.name,
      path: doc.path,
      pageId,
      pageName: page.name,
    };
  }
  function makeFigma(pageId: string): FigmaAPI {
    const api = new FigmaAPI(editor.graph);
    api.setRenderer(editor.renderer ?? null);
    api.currentPage = api.wrapNode(pageId);
    api.currentPage.selection = [...state.selectedIds]
      .map((id) => api.getNodeById(id))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    api.viewport = {
      center: {
        x: (-state.panX + window.innerWidth / 2) / state.zoom,
        y: (-state.panY + window.innerHeight / 2) / state.zoom,
      },
      zoom: state.zoom,
    };
    api.exportImage = async (nodeIds, opts) =>
      renderImage(nodeIds, opts.scale ?? 1, (opts.format ?? "PNG") as RasterExportFormat, pageId);
    api.listAvailableFontsAsync = async () =>
      (await fontManager.listFamilyOptions()).map(({ family }) => ({
        fontName: { family, style: "Regular" },
      }));
    return api;
  }
  function renderImage(
    nodeIds: string[],
    scale: number,
    format: RasterExportFormat,
    pageId = state.currentPageId,
  ) {
    const renderer = editor.renderer;
    if (!renderer) return null;
    const ids = nodeIds.length > 0 ? nodeIds : editor.graph.getChildren(pageId).map((n) => n.id);
    if (ids.length === 0) return null;
    return renderNodesToImage(renderer.ck, renderer, editor.graph, pageId, ids, { scale, format });
  }
  function flash(ids: string[]) {
    const renderer = editor.renderer as { flashNode?: (id: string) => void } | null;
    if (!renderer?.flashNode) return;
    for (const id of ids) renderer.flashNode(id);
    state.renderVersion++;
  }
  function extractNodeIds(result: unknown): string[] {
    if (!isRecord(result) || typeof result.deleted === "string") return [];
    const ids: string[] = [];
    if (typeof result.id === "string") ids.push(result.id);
    if (Array.isArray(result.results))
      for (const item of result.results)
        if (isRecord(item) && typeof item.id === "string") ids.push(item.id);
    return ids;
  }
  async function afterMutation(pageId: string, touched: string[]) {
    const page = editor.graph.getNode(pageId);
    if (page) await ensureGraphFonts(editor.graph, page.childIds, editor.renderer);
    computeAllLayouts(editor.graph, pageId);
    editor.requestRender();
    flash(touched);
    // Agent 的每一步都尽快落盘（用户手改才用 1.5 s 去抖）。
    documents.scheduleSave(200);
  }

  const handlers: Record<string, (target: Target, args: UnknownRecord) => Promise<unknown>> = {
    async tool(target, args) {
      const name = args.name as string | undefined;
      const toolArgs = isRecord(args.args) ? args.args : {};
      if (!name) throw new Error('Missing "name" in args');
      if (name === "render" && toolArgs.tree) {
        const result = await (renderTreeNode as any)(editor.graph, toolArgs.tree, {
          parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
          x: toolArgs.x as number | undefined,
          y: toolArgs.y as number | undefined,
        });
        await afterMutation(target.pageId, [result.id]);
        return {
          ok: true,
          result: {
            id: result.id,
            name: result.name,
            type: result.type,
            children: result.childIds,
          },
        };
      }
      const def = ALL_TOOLS.find((t) => t.name === name);
      if (!def) throw new Error(`Unknown tool: ${name}`);
      const figma = makeFigma(target.pageId);
      const result = await def.execute(figma, toolArgs);
      if (def.mutates) await afterMutation(figma.currentPageId, extractNodeIds(result));
      return { ok: true, result };
    },
    async eval(target, args) {
      const code = args.code as string | undefined;
      if (!code) throw new Error('Missing "code" in args');
      const figma = makeFigma(target.pageId);
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...a: string[]
      ) => (figma: FigmaAPI) => Promise<unknown>;
      const result = await new AsyncFunction("figma", wrapEvalCode(code))(figma);
      await afterMutation(target.pageId, []);
      return { ok: true, result: result ?? null };
    },
    async export(target, args) {
      const nodeIds = (args.nodeIds as string[] | undefined) ?? [...state.selectedIds];
      const format = (
        (args.format as string | undefined) ?? "PNG"
      ).toUpperCase() as RasterExportFormat;
      const data = renderImage(
        nodeIds,
        (args.scale as number | undefined) ?? 1,
        format,
        target.pageId,
      );
      if (!data) throw new Error("Export failed: nothing to render");
      return {
        ok: true,
        result: { base64: encodeBase64(data), mimeType: `image/${format.toLowerCase()}` },
      };
    },
    async export_jsx(target, args) {
      const style = ((args.style as string | undefined) ?? "openpencil") as
        | "openpencil"
        | "tailwind";
      const page = editor.graph.getNode(target.pageId);
      const nodeIds = (args.nodeIds as string[] | undefined) ?? page?.childIds ?? [];
      const jsx =
        nodeIds.length === 1
          ? sceneNodeToJSX(nodeIds[0], editor.graph, style)
          : selectionToJSX(nodeIds, editor.graph, style);
      return { ok: true, result: { jsx } };
    },
    async selection() {
      return { ok: true, result: selectionSummary() };
    },
  };
  function selectionSummary() {
    return [...state.selectedIds]
      .map((id) => editor.graph.getNode(id))
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => ({
        id: node.id,
        name: node.name,
        type: node.type,
        width: Math.round(node.width),
        height: Math.round(node.height),
        xpath: nodeToXPath(editor.graph, node.id),
      }));
  }
  async function handleRequest(command: string, rawArgs: unknown): Promise<unknown> {
    const args = isRecord(rawArgs) ? rawArgs : {};
    if (command === BRIDGE_COMMANDS.openDocument) {
      await documents.load({ id: String(args.documentId) });
      return { ok: true, result: { opened: true } };
    }
    if (command === BRIDGE_COMMANDS.externalChange) {
      await documents.onExternalChange(Number(args.revision));
      return { ok: true, result: { acknowledged: true } };
    }
    if (command === "list_documents") {
      const doc = documents.current.value;
      const pages = editor.graph.getPages().map((p) => ({ id: p.id, name: p.name }));
      const page = editor.graph.getNode(state.currentPageId);
      return {
        ok: true,
        result: {
          documents: doc
            ? [
                {
                  id: doc.id,
                  name: doc.name,
                  path: doc.path,
                  active: args.active === true,
                  current_page_id: state.currentPageId,
                  current_page_name: page?.name ?? "",
                  pages,
                },
              ]
            : [],
        },
      };
    }
    const target = resolveTarget(args);
    const { document_id: _d, page_id: _p, ...rest } = args;
    const handler = handlers[command];
    const body = handler
      ? await handler(target, rest)
      : { ok: true, result: executeRPCCommand(editor.graph, command, rest) };
    const { documentId, documentName, path, pageId, pageName } = target;
    return isRecord(body)
      ? { ...body, target: { documentId, documentName, path, pageId, pageName } }
      : { ok: true, result: body, target: { documentId, documentName, path, pageId, pageName } };
  }

  return { handleRequest, selectionSummary };
}

export function connectBridge(options: BridgeOptions) {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pending = Promise.resolve();
  async function handleRequest(command: string, args: unknown) {
    const values = isRecord(args) ? args : {};
    if (command === BRIDGE_COMMANDS.openDocument) {
      await options.openDocument({ id: String(values.documentId) });
      return { ok: true, result: { opened: true } };
    }
    if (command === "list_documents") {
      // 多标签不能沿用旧单文档的 active:true，否则客户端无法判断当前文档。
      const activeEditor = options.getSession().editor;
      const documents = await Promise.all(
        options.listSessions().map(async (session) => {
          const response = await createSessionHandlers(session).handleRequest(command, {
            active: session.editor === activeEditor,
          });
          return (response as { result: { documents: unknown[] } }).result.documents;
        }),
      );
      return { ok: true, result: { documents: documents.flat() } };
    }
    // 在命令开始时固定 editor，异步字体/导出期间切标签不会改变写入目标。
    const id = values.document_id ?? values.documentId;
    const session = options.getSession(typeof id === "string" ? id : undefined);
    return createSessionHandlers(session).handleRequest(command, args);
  }
  function connect() {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(options.endpoint.url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "register", token: options.endpoint.token }));
      options.onConnection(true);
    };
    socket.onmessage = (event) => {
      let msg: { type?: string; id?: string; command?: string; args?: unknown };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.type !== "request" || !msg.id || !msg.command) return;
      pending = pending.then(async () => {
        try {
          const result = await handleRequest(msg.command!, msg.args);
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ type: "response", id: msg.id, ...(result as object) }));
        } catch (e) {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                type: "response",
                id: msg.id,
                ok: false,
                error: e instanceof Error ? e.message : String(e),
              }),
            );
        }
      });
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      options.onConnection(false);
      scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }
  function scheduleReconnect() {
    if (closed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2000);
  }
  connect();
  return {
    selectionSummary: () => createSessionHandlers(options.getSession()).selectionSummary(),
    disconnect() {
      closed = true;
      clearTimeout(reconnectTimer);
      ws?.close(1000);
      ws = null;
    },
  };
}
export type Bridge = ReturnType<typeof connectBridge>;
