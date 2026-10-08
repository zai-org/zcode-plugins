// MCP 工具注册：文档打开/读写/patch（模型+页面）与页面专属工具。
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  WALK_LIMIT,
  WALK_MAX_DEPTH,
  commitInput,
  closeInput,
  listInput,
  MarkdownError,
  newInput,
  openInput,
  patchInput,
  readInput,
  resolveConflictInput,
  statusInput,
  writeInput,
  PANEL_URI,
} from "../contract.ts";
import { assertMarkdownExtension, readWorkspaceFile } from "./files.ts";
import { DocumentRegistry, type OpenDocument } from "./registry.ts";
import { RecentStore } from "./recent.ts";

const OPEN_META = {
  ui: { resourceUri: PANEL_URI, surface: "editor", visibility: ["model", "app"] as const },
  "openai/ui": { preferredModelDisplayMode: "fullscreen" as const },
};
const CALLABLE_META = { ui: { visibility: ["model", "app"] as const } };
const APP_ONLY_META = { ui: { visibility: ["app"] as const } };
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".zcode"]);

export interface ToolContext {
  server: McpServer;
  registry: DocumentRegistry;
  workspaceRoot: string;
  recent: RecentStore;
}

export function registerTools({ server, registry, workspaceRoot, recent }: ToolContext) {
  const errorResult = (error: unknown) => {
    if (error instanceof MarkdownError)
      return {
        content: [{ type: "text" as const, text: error.message }],
        isError: true,
        structuredContent: { error: { code: error.code, message: error.message } },
      };
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text" as const, text: `markdown: ${message}` }], isError: true };
  };
  const docPayload = (doc: OpenDocument, extra: Record<string, unknown> = {}) => ({
    ...extra,
    document: { id: doc.id, path: doc.path, revision: doc.revision },
    externalChange: doc.externalChange,
  });
  const withDoc = async <T>(id: string, run: (doc: OpenDocument) => Promise<T>): Promise<T> => {
    const doc = registry.get(id);
    if (!doc) throw new MarkdownError("unknown_document", `Unknown document id ${id}`);
    return run(doc);
  };

  server.registerTool(
    "open_document",
    {
      description:
        "Open a workspace markdown file in the editor panel. Use when the user asks to view, edit, or continue writing a .md document.",
      inputSchema: openInput.shape,
      _meta: OPEN_META,
    },
    async ({ path }) => {
      try {
        assertMarkdownExtension(path);
        const { doc, content } = await registry.open(path);
        await recent.touch(doc.path);
        return {
          content: [
            { type: "text" as const, text: `Opened ${doc.path} (revision ${doc.revision}).` },
          ],
          structuredContent: docPayload(doc, { content }),
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "new_document",
    {
      description:
        "Create a new markdown file in the workspace and open it in the editor panel. Fails if the file already exists.",
      inputSchema: newInput.shape,
      _meta: OPEN_META,
    },
    async ({ path, content }) => {
      try {
        assertMarkdownExtension(path);
        const { doc, content: text } = await registry.open(path, content ?? "", true);
        await recent.touch(doc.path);
        return {
          content: [{ type: "text" as const, text: `Created ${doc.path}.` }],
          structuredContent: docPayload(doc, { content: text }),
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_documents",
    {
      description:
        "List markdown files in this workspace (depth-limited walk). Optional case-insensitive query filters paths.",
      inputSchema: listInput.shape,
      _meta: CALLABLE_META,
    },
    async ({ query }) => {
      const files = await walkMarkdown(workspaceRoot, query);
      return {
        content: [{ type: "text" as const, text: `${files.length} markdown file(s).` }],
        structuredContent: { files, total: files.length },
      };
    },
  );

  server.registerTool(
    "read_document",
    {
      description:
        "Read a markdown file's content without opening the editor. Use before write/patch when the current text matters.",
      inputSchema: readInput.shape,
      _meta: CALLABLE_META,
    },
    async ({ path }) => {
      try {
        assertMarkdownExtension(path);
        const { content } = await readWorkspaceFile(workspaceRoot, path);
        return {
          content: [{ type: "text" as const, text: content.slice(0, 2000) || "(empty)" }],
          structuredContent: { path, content },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "write_document",
    {
      description:
        "Replace the whole content of a markdown file. Pass expectedRevision from the latest open_document when available to avoid clobbering newer edits.",
      inputSchema: writeInput.shape,
      _meta: CALLABLE_META,
    },
    async ({ path, content, expectedRevision }) => {
      try {
        assertMarkdownExtension(path);
        const { doc } = await registry.open(path);
        const ref =
          expectedRevision === undefined
            ? await registry.forceSave(doc, content)
            : await registry.save(doc, content, expectedRevision);
        await recent.touch(ref.path);
        return {
          content: [
            { type: "text" as const, text: `Wrote ${ref.path} (revision ${ref.revision}).` },
          ],
          structuredContent: { document: ref },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "patch_document",
    {
      description:
        "Apply find/replace edits to a markdown file without rewriting the rest. Each op replaces the first occurrence by default; set all: true to replace every match. Fails with no_matches when nothing matched; nothing is written in that case.",
      inputSchema: patchInput.shape,
      _meta: CALLABLE_META,
    },
    async ({ path, ops, expectedRevision }) => {
      try {
        assertMarkdownExtension(path);
        const { doc } = await registry.open(path);
        const { ref, replacements } = await registry.patch(doc, ops, expectedRevision);
        await recent.touch(ref.path);
        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${replacements} replacement(s) to ${ref.path}.`,
            },
          ],
          structuredContent: { document: ref, replacements },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ---- 仅页面工具 ----

  server.registerTool(
    "commit_draft",
    {
      description: "App-only: save the editor draft to the workspace file with revision check.",
      inputSchema: commitInput.shape,
      _meta: APP_ONLY_META,
    },
    async ({ id, content, expectedRevision }) => {
      try {
        const ref = await withDoc(id, (doc) => registry.save(doc, content, expectedRevision));
        return {
          content: [{ type: "text" as const, text: `Saved revision ${ref.revision}.` }],
          structuredContent: { document: ref },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "resolve_conflict",
    {
      description:
        "App-only: resolve an external-change conflict. reload discards the draft and re-reads the file; overwrite persists the provided draft content.",
      inputSchema: resolveConflictInput.shape,
      _meta: APP_ONLY_META,
    },
    async ({ id, strategy, content }) => {
      try {
        if (strategy === "reload") {
          const result = await withDoc(id, (doc) => registry.reload(doc));
          return {
            content: [{ type: "text" as const, text: `Reloaded revision ${result.ref.revision}.` }],
            structuredContent: { document: result.ref, content: result.content, strategy },
          };
        }
        if (typeof content !== "string")
          throw new MarkdownError("invalid_input", "overwrite requires the draft content");
        const ref = await withDoc(id, (doc) => registry.forceSave(doc, content));
        return {
          content: [{ type: "text" as const, text: `Overwrote at revision ${ref.revision}.` }],
          structuredContent: { document: ref, strategy },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_status",
    {
      description:
        "App-only: document status for cold-start recovery (revision, external change) plus recently opened documents.",
      inputSchema: statusInput.shape,
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      try {
        const docs = id ? [await withDoc(id, async (doc) => doc)] : registry.list();
        const current = docs[0]?.path;
        const recentFiles = await recent.list(6, current);
        return {
          content: [{ type: "text" as const, text: `${docs.length} open document(s).` }],
          structuredContent: {
            documents: docs.map((doc) => docPayload(doc)),
            recent: recentFiles,
          },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "close_document",
    {
      description: "App-only: stop tracking a document (stops external-change watching).",
      inputSchema: closeInput.shape,
      _meta: APP_ONLY_META,
    },
    async ({ id }) => {
      try {
        registry.close(id);
        return { content: [{ type: "text" as const, text: `Closed ${id}.` }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

/** 遍历工作区收集 markdown 文件（深度受限、跳过构建与依赖目录）。 */
export async function walkMarkdown(
  workspaceRoot: string,
  query?: string,
): Promise<{ path: string; bytes: number }[]> {
  const results: { path: string; bytes: number }[] = [];
  const needle = query?.toLowerCase();
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > WALK_MAX_DEPTH || results.length >= WALK_LIMIT) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (results.length >= WALK_LIMIT) return;
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        const rel = relative(workspaceRoot, full);
        if (needle && !rel.toLowerCase().includes(needle)) continue;
        const info = await stat(full).catch(() => null);
        results.push({ path: rel, bytes: info?.size ?? -1 });
      }
    }
  };
  await walk(workspaceRoot, 0);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}
