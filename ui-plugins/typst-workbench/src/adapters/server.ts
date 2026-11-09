import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  LIMITS,
  PANEL_URI,
  PLUGIN_VERSION,
  SERVER_NAME,
  STATE_URI,
  SURFACE_ID,
  TypstError,
  type Diagnostic,
  type SessionState,
} from "#t/contract.ts";
import type { TypstSession } from "#t/app/session.ts";
import { diagnosticsText } from "#t/domain/format.ts";

const HTML_MIME = "text/html;profile=mcp-app";
const JSON_MIME = "application/json";
type Visibility = ("model" | "app")[];
const BOTH: Visibility = ["model", "app"];

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

interface ToolOutput {
  text: string;
  /** 文字之后的其他内容（如页面图片）。 */
  extra?: Content[];
  structured?: Record<string, unknown>;
}

/** pdf.js 运行时数据：页面经资源读取（面板没有网络）。 */
const PDFJS_KINDS = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as const;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function countOf(diagnostics: Diagnostic[]) {
  const errors = diagnostics.filter((entry) => entry.severity === "error").length;
  return { errors, warnings: diagnostics.length - errors };
}

/** 编译结果摘要（check 与 status 共用）。 */
function compileSummary(state: SessionState): string {
  const { status, snapshot, main } = state;
  const { errors, warnings } = countOf(state.diagnostics);
  const time = status.durationMs !== undefined ? ` in ${status.durationMs < 10 ? status.durationMs.toFixed(1) : Math.round(status.durationMs)} ms` : "";
  const pages = snapshot ? ` — ${plural(snapshot.pages, "page")}` : "";
  switch (status.phase) {
    case "ok":
      return `${main} compiled successfully${time}${pages}. No errors or warnings.`;
    case "warnings":
      return `${main} compiled with ${plural(warnings, "warning")}${time}${pages}.`;
    case "error":
      return `${main} failed to compile: ${plural(errors, "error")}${warnings ? ` and ${plural(warnings, "warning")}` : ""}.${
        snapshot ? ` The preview still shows the last successful version (${plural(snapshot.pages, "page")}).` : " There is no preview yet."
      }`;
    case "compiling":
    case "starting":
      return `${main} is compiling…`;
    case "crashed":
      return `typst watch stopped: ${status.error ?? "unknown error"}`;
    case "idle":
      return "Not compiling.";
  }
}

export function createTypstMcpServer({
  session,
  assetRoot,
  pdfjsDataDir,
  log = () => undefined,
}: {
  session: TypstSession;
  assetRoot: string;
  pdfjsDataDir: string | null;
  log?: (line: string) => void;
}) {
  const server = new McpServer(
    { name: SERVER_NAME, version: PLUGIN_VERSION },
    { capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} } },
  );

  // -------------------------------------------------------------------------
  // 订阅与通知
  // -------------------------------------------------------------------------
  const subscribed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  session.onChange(() => {
    if (!subscribed.has(STATE_URI) || timer) return;
    timer = setTimeout(() => {
      timer = null;
      server.server.sendResourceUpdated({ uri: STATE_URI }).catch(() => undefined);
    }, LIMITS.notifyMs);
    timer.unref?.();
  });
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params }) => {
    subscribed.add(params.uri);
    // 面板打开即开始预览；Typst 不可用时持续重新查找，装好后自动开始。
    if (params.uri === STATE_URI) {
      void session.activate().catch((error) => log(`activation failed: ${error}`));
      session.watchSetup(true);
    }
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async ({ params }) => {
    subscribed.delete(params.uri);
    if (params.uri === STATE_URI) session.watchSetup(false);
    return {};
  });

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
      destructive?: boolean;
    },
    run: (input: any) => Promise<ToolOutput>,
  ) => {
    server.registerTool(
      name,
      {
        description: config.description,
        inputSchema: config.input,
        annotations: {
          readOnlyHint: !!config.readOnly,
          ...(config.readOnly ? {} : { destructiveHint: !!config.destructive }),
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: config.visibility ?? BOTH },
          ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
          // 宿主只从这个兼容键读取“自动打开侧栏”偏好。
          ...(config.openPanel ? { "openai/ui": { preferredModelDisplayMode: "fullscreen" } } : {}),
        },
      },
      async (input: unknown) => {
        try {
          const output = await run(input);
          return {
            content: [{ type: "text" as const, text: output.text }, ...(output.extra ?? [])],
            ...(output.structured ? { structuredContent: output.structured } : {}),
          };
        } catch (error) {
          const code = error instanceof TypstError ? error.code : "typst_error";
          const message = error instanceof Error ? error.message : String(error);
          if (!(error instanceof TypstError)) log(`${name} failed: ${error instanceof Error ? error.stack : message}`);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `[${code}] ${message}` }],
            structuredContent: {
              error: { code, message, ...(error instanceof TypstError && error.details ? { details: error.details } : {}) },
            },
          };
        }
      },
    );
  };

  const pathParam = z.string().min(1).max(1024);

  register(
    "status",
    {
      description:
        "Show the Typst workbench: the Typst installation in use (version and path), the main .typ file and the other .typ files in the workspace, and the latest compile result. Opens the live preview panel. Call this first when working on a Typst document.",
      input: {},
      readOnly: true,
      openPanel: true,
    },
    async () => {
      await session.activate();
      const state = session.state();
      const { toolchain } = state;
      const lines: string[] = [];
      if (toolchain.state === "ready") lines.push(`Typst ${toolchain.version} (${toolchain.path}).`);
      else {
        try {
          session.requireReady();
        } catch (error) {
          lines.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (toolchain.state === "ready") {
        if (state.main) {
          const others = state.candidates.filter((path) => path !== state.main);
          lines.push(`Main file: ${state.main}${others.length ? ` (other .typ files: ${others.slice(0, 20).join(", ")}${others.length > 20 ? ", …" : ""})` : ""}`);
          lines.push(compileSummary(state));
          if (state.diagnostics.length) lines.push("", diagnosticsText(state.diagnostics));
        } else {
          try {
            session.requireReady();
          } catch (error) {
            lines.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
      return {
        text: lines.join("\n"),
        structured: {
          toolchain,
          main: state.main,
          candidates: state.candidates,
          phase: state.status.phase,
          pages: state.snapshot?.pages ?? null,
          ...countOf(state.diagnostics),
        },
      };
    },
  );

  register(
    "set_main",
    {
      description:
        "Choose the main .typ file of the document (the one you would pass to `typst compile`). The preview restarts with it, and the choice is remembered for this workspace.",
      input: { path: pathParam.describe("Workspace-relative path of a .typ file.") },
      openPanel: true,
    },
    async (input) => {
      const main = await session.setMain(input.path);
      await session.settle(LIMITS.checkTimeoutMs).catch(() => undefined);
      const state = session.state();
      return {
        text: `Main file set to ${main}. ${compileSummary(state)}${state.diagnostics.length ? `\n\n${diagnosticsText(state.diagnostics)}` : ""}`,
        structured: { main, phase: state.status.phase, ...countOf(state.diagnostics) },
      };
    },
  );

  register(
    "check",
    {
      description:
        "Compile the document with the user's Typst and report errors and warnings with file:line:column, the source line and Typst's hints. Waits until every change already saved to disk has been compiled, so call it right after editing. The preview panel updates by itself; this is how you see the result.",
      input: {
        timeoutMs: z.number().int().min(1_000).max(600_000).optional().describe(`How long to wait for Typst (default ${LIMITS.checkTimeoutMs / 1000} s).`),
      },
      readOnly: true,
      timeoutMs: 620_000,
    },
    async (input) => {
      await session.settle(input.timeoutMs ?? LIMITS.checkTimeoutMs);
      const state = session.state();
      const text = [compileSummary(state), ...(state.diagnostics.length ? ["", diagnosticsText(state.diagnostics)] : [])].join("\n");
      return {
        text,
        structured: {
          main: state.main,
          phase: state.status.phase,
          ...countOf(state.diagnostics),
          pages: state.snapshot?.pages ?? null,
          durationMs: state.status.durationMs ?? null,
          diagnostics: state.diagnostics,
        },
      };
    },
  );

  register(
    "render_pages",
    {
      description: `Render pages of the document to PNG images so you can look at the layout (overfull lines, figure placement, tables, title page, spacing). Compiles the files on disk with the user's Typst. At most ${LIMITS.renderPages} pages per call.`,
      input: {
        pages: z.string().min(1).max(100).describe('1-based pages, e.g. "1", "2-3", "1,5".'),
        ppi: z.number().int().min(LIMITS.ppiMin).max(LIMITS.ppiMax).optional().describe(`Resolution in pixels per inch (default ${LIMITS.ppiDefault}).`),
      },
      readOnly: true,
      timeoutMs: LIMITS.oneshotTimeoutMs + LIMITS.checkTimeoutMs + 10_000,
    },
    async (input) => {
      const result = await session.renderPages(input.pages, input.ppi ?? LIMITS.ppiDefault);
      if (!result.ok)
        throw new TypstError("compile_failed", `The document does not compile, so no pages were rendered.\n\n${diagnosticsText(result.diagnostics)}`);
      const missing = result.pages.filter((page) => !result.images.some((image) => image.page === page));
      return {
        text: `Rendered ${result.images.map((image) => `page ${image.page}`).join(", ")}${result.total ? ` of ${result.total}` : ""}.${missing.length ? ` Pages ${missing.join(", ")} do not exist.` : ""}`,
        extra: result.images.map((image) => ({ type: "image" as const, data: Buffer.from(image.png).toString("base64"), mimeType: "image/png" })),
        structured: { pages: result.images.map((image) => image.page), total: result.total ?? null },
      };
    },
  );

  register(
    "show",
    {
      description:
        "Point the user at something in the live preview: scroll to a page, or highlight rendered text with an optional comment. Give exactly one of: page; quote (words as they appear in the rendered document — markup is ignored); or file and line (and optionally endLine) to highlight what those source lines produce. Highlights follow the text as the document changes and last for this session.",
      input: {
        page: z.number().int().min(1).optional().describe("1-based page to scroll to."),
        quote: z.string().min(1).max(2_000).optional(),
        file: pathParam.optional().describe("Workspace-relative .typ file."),
        line: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
        comment: z.string().max(2_000).optional().describe("Shown with the highlight."),
      },
      openPanel: true,
    },
    async (input) => {
      const targets = [input.page !== undefined, !!input.quote, !!input.file || input.line !== undefined].filter(Boolean).length;
      if (targets !== 1) throw new TypstError("invalid_input", "Give exactly one of page, quote, or file and line.");
      if ((input.file && input.line === undefined) || (!input.file && input.line !== undefined))
        throw new TypstError("invalid_input", "file and line go together.");
      await session.settle(LIMITS.checkTimeoutMs).catch(() => undefined);
      if (input.page !== undefined) {
        session.showPage(input.page - 1);
        return { text: `Showing page ${input.page}.`, structured: { page: input.page } };
      }
      const { highlight, exact } = await session.highlight(
        input.quote ? { quote: input.quote } : { file: input.file, line: input.line, endLine: input.endLine },
        input.comment ?? "",
      );
      return {
        text: `Highlighted ${highlight.id} on page ${highlight.pageIndex + 1}: “${highlight.quote}”.${exact ? "" : " (Closest match; the rendered text differs slightly.)"}`,
        structured: { highlight: { id: highlight.id, page: highlight.pageIndex + 1, quote: highlight.quote } },
      };
    },
  );

  register(
    "clear_highlights",
    {
      description: "Remove your highlights from the preview: the given ids, or all of them.",
      input: { ids: z.array(z.string()).optional() },
    },
    async (input) => {
      const removed = session.clearHighlights(input.ids);
      return { text: `Removed ${plural(removed, "highlight")}.`, structured: { removed } };
    },
  );

  register(
    "export_pdf",
    {
      description:
        "Compile the document with the user's Typst and write a PDF into the workspace (the preview's own PDF lives outside the workspace). Optionally a PDF standard such as \"a-2b\" or \"ua-1\" (as supported by the installed Typst) and a page selection.",
      input: {
        path: pathParam.describe("Workspace-relative output path ending in .pdf."),
        pdfStandard: z
          .string()
          .regex(/^[a-z0-9.-]+$/i)
          .optional()
          .describe('A value of `typst compile --pdf-standard`, e.g. "1.7", "a-2b".'),
        pages: z
          .string()
          .regex(/^[\d,\s-]+$/)
          .optional()
          .describe('1-based pages to include, e.g. "1-3,7".'),
      },
      timeoutMs: LIMITS.oneshotTimeoutMs + 10_000,
    },
    async (input) => {
      const result = await session.exportPdf(input.path, { pdfStandard: input.pdfStandard, pages: input.pages?.replace(/\s+/g, "") });
      if (!result.ok) throw new TypstError("compile_failed", `Nothing was written to ${result.path}.\n\n${diagnosticsText(result.diagnostics)}`);
      const warnings = result.diagnostics.filter((entry) => entry.severity === "warning");
      return {
        text: `Wrote ${result.path}${"pages" in result && result.pages ? ` (${plural(result.pages, "page")}, ${Math.max(1, Math.round((result.bytes ?? 0) / 1024))} KB)` : ""}.${
          warnings.length ? `\n\n${diagnosticsText(warnings)}` : ""
        }`,
        structured: { path: result.path, pages: "pages" in result ? (result.pages ?? null) : null, bytes: "bytes" in result ? result.bytes : null },
      };
    },
  );

  // 面板专用：选中或点击的文字 → 源码位置。
  register(
    "locate_source",
    {
      description: "Find where rendered text comes from in the .typ sources.",
      input: { text: z.string().min(1).max(5_000), focus: z.string().max(2_000).optional() },
      visibility: ["app"],
      readOnly: true,
    },
    async (input) => {
      const matches = await session.locateSource(input.text, input.focus);
      return {
        text: matches.length ? matches.map((match) => `${match.file}:${match.line}`).join("\n") : "No match.",
        structured: { matches },
      };
    },
  );

  // 面板专用：主文件选择器。
  register(
    "panel_set_main",
    {
      description: "Choose the main .typ file from the panel.",
      input: { path: pathParam },
      visibility: ["app"],
    },
    async (input) => {
      const main = await session.setMain(input.path);
      return { text: main, structured: { main } };
    },
  );

  // 面板专用：重新查找 typst 并重启 watch。
  register(
    "restart",
    {
      description: "Look for Typst again and restart the live preview.",
      input: {},
      visibility: ["app"],
    },
    async () => {
      await session.restart();
      return { text: session.state().toolchain.state, structured: { toolchain: session.state().toolchain } };
    },
  );

  // -------------------------------------------------------------------------
  // 资源
  // -------------------------------------------------------------------------
  const blob = (uri: string, bytes: Uint8Array) => ({
    contents: [{ uri, mimeType: "application/octet-stream", blob: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64") }],
  });
  const panelMeta = { ui: { prefersBorder: false }, "zcode/csp": { wasmUnsafeEval: true } };

  server.registerResource("panel", PANEL_URI, { mimeType: HTML_MIME, _meta: panelMeta }, async () => ({
    contents: [{ uri: PANEL_URI, mimeType: HTML_MIME, _meta: panelMeta, text: await readFile(join(assetRoot, "panel.html"), "utf8") }],
  }));
  server.registerResource("state", STATE_URI, { mimeType: JSON_MIME }, async () => {
    await session.activate().catch((error) => log(`activation failed: ${error}`));
    await session.refreshCandidates().catch(() => undefined);
    return { contents: [{ uri: STATE_URI, mimeType: JSON_MIME, text: JSON.stringify(session.state()) }] };
  });
  // 设置页：立即重新查找（check）或记下已交给 Agent（handoff）；返回最新状态。
  server.registerResource(
    "setup",
    new ResourceTemplate("ui://typst-workbench/setup/{op}/{nonce}", { list: undefined }),
    { mimeType: JSON_MIME },
    async (uri, variables) => {
      const op = String(variables.op);
      if (op === "check") await session.recheck(true);
      else if (op === "handoff") {
        await session.activate().catch((error) => log(`activation failed: ${error}`));
        session.handoff();
      } else throw new TypstError("not_found", `No setup action ${op}`);
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(session.state()) }] };
    },
  );
  server.registerResource(
    "pdf-part",
    new ResourceTemplate("ui://typst-workbench/pdf/{seq}/{part}", { list: undefined }),
    { mimeType: "application/octet-stream" },
    async (uri, variables) => blob(uri.href, session.pdfPart(Number(variables.seq), Number(variables.part))),
  );
  server.registerResource(
    "pdfjs-data",
    new ResourceTemplate("ui://typst-workbench/pdfjs/{kind}/{file}", { list: undefined }),
    { mimeType: "application/octet-stream" },
    async (uri, variables) => {
      const folder = PDFJS_KINDS[String(variables.kind) as keyof typeof PDFJS_KINDS];
      const file = String(variables.file);
      if (!folder || !pdfjsDataDir || !/^[A-Za-z0-9._-]+$/.test(file)) throw new TypstError("not_found", `No pdf.js data ${uri.href}`);
      return blob(uri.href, new Uint8Array(await readFile(join(pdfjsDataDir, folder, file))));
    },
  );

  return server;
}
