// 页面共享上下文：宿主客户端、文档状态与基础助手。
// main/docs-menu/reference 共同引用；编辑器钩子由 main 注入，避免循环依赖。
import { getClient } from "./client.ts";

export const client = getClient();
export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type { DocumentPayload } from "./document-session.ts";
import type { DocumentPayload } from "./document-session.ts";

export interface EditorState {
  id: string;
  path: string;
  revision: number;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  subscribedFor: string;
  editor: unknown;
  ready: Promise<void> | null;
}

export const state: EditorState = {
  id: "",
  path: "",
  revision: 0,
  dirty: false,
  saving: false,
  conflict: false,
  subscribedFor: "",
  editor: null,
  ready: null,
};

export const lang = () => (client.locale?.toLowerCase().startsWith("en") ? "en_US" : "zh_CN");
export const isZh = () => lang() === "zh_CN";
export const text = (zh: string, en: string) => (isZh() ? zh : en);
export const isDark = () => client.hostContext?.theme === "dark";

export function setStatus(
  phase: "idle" | "saving" | "saved" | "conflict" | "error",
  message: string,
) {
  const status = $("status");
  status.dataset.phase = phase;
  status.textContent = message;
}

export function showConflict(visible: boolean) {
  state.conflict = visible;
  $("conflict").dataset.visible = String(visible);
}

/** Lute 未就绪时 getValue 会抛错；统一走安全读取。 */
export function safeGetValue(): string {
  try {
    const editor = state.editor as { getValue?: () => string } | null;
    return editor?.getValue?.() ?? "";
  } catch {
    return "";
  }
}

/** 编辑器实例由 main 写入；其他模块只读。 */
export function setStateEditor(editor: unknown) {
  state.editor = editor;
}

/** main 在初始化时注入 openDocument；openPath 依赖它而不产生循环导入。 */
export const editorHooks = {
  openDocument: async (_payload: DocumentPayload): Promise<boolean> => false,
  openPath: async (_path: string, _create?: { content: string }): Promise<boolean> => false,
};
export const openPath = (path: string, create?: { content: string }) =>
  editorHooks.openPath(path, create);
