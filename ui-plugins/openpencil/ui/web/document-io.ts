import type { Editor } from "@open-pencil/core/editor";
import type { AppEditorState } from "@/app/editor/session/types";
import type { ViewportSize } from "@/app/document/io/types";
import type { StorageDocumentBinding } from "@/app/integrations/storage/types";
import { createDocumentViewportActions } from "@/app/document/io/browser";
import { createOpenActions } from "@/app/document/io/read";
import { createDOMOpenActions } from "@/app/document/io/dom";
import { createDocumentController } from "#ui/document.ts";
import { call, bytesToBase64, host } from "#ui/host.ts";
import type { DesignRef } from "#openpencil/contract.ts";
import { askPath } from "#ui/web/dialog.ts";

export const sessions = new WeakMap<object, ReturnType<typeof createDocumentController>>();
const label = (zh: string, en: string) => (host().locale?.startsWith("zh") ? zh : en);

export function createDocumentIOActions(
  editor: Editor,
  state: AppEditorState,
  viewport: ViewportSize,
) {
  const documents = createDocumentController(editor, state);
  sessions.set(state, documents);
  state.autosaveEnabled = true;
  const view = createDocumentViewportActions(editor, viewport);
  const setDocumentSource = (
    name: string,
    _format?: string,
    _handle?: FileSystemFileHandle,
    _path?: string,
  ) => {
    state.documentName = name.replace(/\.(fig|pen)$/i, "");
  };
  const openOptions = {
    editor,
    state,
    setDocumentSource,
    fitCurrentPageToViewport: view.fitCurrentPageToViewport,
  };

  async function saveFigFileAs() {
    const path = await askPath(
      label("保存到工作区", "Save in workspace"),
      `designs/${state.documentName || "untitled"}.fig`,
    );
    if (!path) return false;
    // 另存为只登记目标文件，不能先让服务端推送空文档覆盖当前 editor。
    try {
      const result = await call<{ document: DesignRef }>("new_design", { path, open: false });
      await documents.bind(result.document);
      state.documentName = result.document.name;
      await documents.save();
      return documents.status.value === "saved";
    } catch (error) {
      documents.error.value = String(error);
      return false;
    }
  }
  async function saveFigFile() {
    if (!documents.current.value || documents.current.value.format === "pen")
      return saveFigFileAs();
    await documents.save();
    return documents.status.value === "saved";
  }
  async function downloadBlob(bytes: Uint8Array, name: string, mime: string) {
    const path = await askPath(label("导出到工作区", "Export to workspace"), `exports/${name}`);
    if (path) {
      try {
        await call("write_export", { path, mime, base64: bytesToBase64(bytes) });
      } catch (error) {
        documents.error.value = String(error);
      }
    }
  }
  return {
    ...view,
    ...createOpenActions(openOptions),
    ...createDOMOpenActions(openOptions),
    downloadBlob,
    saveFigFile,
    saveFigFileAs,
    setDocumentSource,
    getDocumentFilePath: () => documents.current.value?.path ?? null,
    getSourceIdentity: () => ({ handle: null, path: documents.current.value?.path ?? null }),
    getStorageBinding: (): StorageDocumentBinding | null => null,
    setStorageDocumentSource: (_binding: StorageDocumentBinding, _name: string) => {
      throw new Error("Use ZCode workspace files");
    },
    setPlannedFilePath: (path: string) => setDocumentSource(path.split(/[\\/]/).pop() ?? path),
    startWatchingCurrentFile: () => {},
    disposeDocumentIO: () => documents.dispose(),
  };
}
