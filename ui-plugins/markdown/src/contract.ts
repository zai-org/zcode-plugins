// markdown 插件的接口契约：工具入参 schema、大小上限与业务错误码。
// 大小上限对齐宿主约束（页面单次资源读取 8 MiB），超限直接拒绝而不是截断。
import { z } from "zod";

export const PLUGIN_VERSION = "0.3.5";
export const PANEL_URI = "ui://markdown/panel.html";
export const ASSET_URI_PREFIX = "ui://markdown/assets/";
export const documentUri = (id: string) => `ui://markdown/document/${id}`;

/** 文档读写上限：与宿主页面资源读取上限一致，超限报错不截断。 */
export const MAX_DOC_BYTES = 8 * 1024 * 1024;
/** list_documents 遍历深度与数量上限。 */
export const WALK_MAX_DEPTH = 4;
export const WALK_LIMIT = 500;
/** 外部变更检测防抖窗口。 */
export const WATCH_DEBOUNCE_MS = 250;

export const patchOpSchema = z.object({
  find: z.string().min(1).max(64 * 1024).describe("Text to find"),
  replace: z.string().max(MAX_DOC_BYTES).describe("Replacement text"),
  all: z.boolean().optional().describe("Replace every occurrence (default: first only)"),
});

export const openInput = z.object({
  path: z.string().min(1).max(1024).describe("Workspace-relative .md path, e.g. docs/api.md"),
});
export const newInput = openInput.extend({
  content: z.string().max(MAX_DOC_BYTES).optional().describe("Initial content"),
});
export const listInput = z.object({
  query: z.string().max(256).optional().describe("Case-insensitive substring filter on paths"),
});
export const readInput = openInput;
export const writeInput = openInput.extend({
  content: z.string().min(1).max(MAX_DOC_BYTES),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export const patchInput = openInput.extend({
  ops: z.array(patchOpSchema).min(1).max(50),
  expectedRevision: z.number().int().nonnegative().optional(),
});
export const commitInput = z.object({
  id: z.string().regex(/^m[0-9a-f]{12}$/),
  content: z.string().max(MAX_DOC_BYTES),
  expectedRevision: z.number().int().nonnegative(),
});
export const resolveConflictInput = z.object({
  id: z.string().regex(/^m[0-9a-f]{12}$/),
  strategy: z.enum(["reload", "overwrite"]),
  content: z.string().max(MAX_DOC_BYTES).optional().describe("Draft content (required for overwrite)"),
});
export const statusInput = z.object({
  id: z.string().regex(/^m[0-9a-f]{12}$/).optional(),
});
export const closeInput = z.object({
  id: z.string().regex(/^m[0-9a-f]{12}$/),
});

export type PatchOp = z.infer<typeof patchOpSchema>;

/** 工具与资源的公共错误结构：页面据此区分冲突与路径问题。 */
export class MarkdownError extends Error {
  constructor(
    readonly code:
      | "path_outside_workspace"
      | "unsafe_path"
      | "not_found"
      | "file_exists"
      | "not_markdown"
      | "doc_too_large"
      | "revision_conflict"
      | "unknown_document"
      | "invalid_input"
      | "no_matches",
    message: string,
  ) {
    super(message);
    this.name = "MarkdownError";
  }
}

/** 工具结果里的文档引用：面板用它打开/恢复，不携带全文（全文走资源或 read）。 */
export interface DocumentRef {
  id: string;
  path: string;
  revision: number;
  bytes: number;
}
