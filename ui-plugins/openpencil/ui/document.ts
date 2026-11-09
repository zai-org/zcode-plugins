import { ref, shallowRef, watch } from "vue";
import type { Editor, EditorState } from "@open-pencil/core/editor";
import { exportFigFile, parseFigFile } from "@open-pencil/core/io";
import { parsePenFile } from "@open-pencil/pen";
import { DesignError, type DesignRef } from "#openpencil/contract.ts";
import { bytesToBase64, call, readDesignBytes } from "#ui/host.ts";
import { ensureGraphFonts } from "#ui/fonts.ts";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict" | "readonly";
export interface PanelDocument extends DesignRef {
  format: "fig" | "pen";
  externalChange: boolean;
}
const AUTOSAVE_DELAY_MS = 1500;

/**
 * 面板侧文档控制器：加载（readResource 分片 → 解析 → replaceGraph）、自动保存（sceneVersion 变化去抖）、
 * revision 过期 → conflict、外部修改 → 无本地改动时静默重载、有改动时让用户选。
 * 面板打开期间它是文档权威（server 登记表 owner = live）。
 */
export function createDocumentController(editor: Editor, state: EditorState) {
  const current = shallowRef<PanelDocument | null>(null);
  const status = ref<SaveStatus>("idle");
  const error = ref<string | null>(null);
  let savedVersion = state.sceneVersion;
  let savedBase64: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;
  let loadSeq = 0;

  const isDirty = () => current.value !== null && state.sceneVersion !== savedVersion;

  async function load(target: { id: string }): Promise<PanelDocument> {
    const seq = ++loadSeq;
    if (timer) clearTimeout(timer);
    await saving;
    const { bytes, meta } = await readDesignBytes(target.id);
    if (seq !== loadSeq) throw new DesignError("superseded", "被更新的打开请求取代");
    const format = meta.format as "fig" | "pen";
    const graph =
      format === "pen"
        ? parsePenFile(new TextDecoder().decode(bytes))
        : await parseFigFile(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
            {
              populate: "all",
            },
          );
    // 解析 worker 也会异步返回；旧请求不能在新请求完成后覆盖画布。
    if (seq !== loadSeq) throw new DesignError("superseded", "被更新的打开请求取代");
    editor.replaceGraph(graph);
    const firstPage = graph.getPages()[0];
    if (firstPage && !graph.getNode(state.currentPageId)) await editor.switchPage(firstPage.id);
    const page = graph.getNode(state.currentPageId);
    if (page) await ensureGraphFonts(graph, page.childIds, editor.renderer);
    current.value = { ...(meta.document as DesignRef), format, externalChange: false };
    savedVersion = state.sceneVersion;
    savedBase64 = null;
    status.value = format === "pen" ? "readonly" : "saved";
    error.value = null;
    editor.requestRender();
    editor.zoomToFit();
    await call("report_panel_state", { documentId: target.id, live: true, dirty: false }).catch(
      () => undefined,
    );
    return current.value;
  }

  async function serialize(): Promise<Uint8Array> {
    const renderer = editor.renderer;
    return exportFigFile(
      editor.graph,
      renderer?.ck,
      renderer ?? undefined,
      state.currentPageId,
      false,
    );
  }

  async function save(): Promise<void> {
    const doc = current.value;
    if (!doc) return;
    // 外部变更会更新 revision；普通 Save 不能借新 revision 绕过冲突选择。
    if (status.value === "conflict") return;
    if (doc.format === "pen") {
      status.value = "readonly";
      return;
    }
    if (saving) return saving;
    saving = (async () => {
      const version = state.sceneVersion;
      status.value = "saving";
      try {
        const base64 = bytesToBase64(await serialize());
        // 加载后字体解析、布局等会再抬 sceneVersion，内容并没变；字节与上次落盘一致就不写盘、不抬 revision。
        if (base64 !== savedBase64) {
          const result = await call<{ document: DesignRef }>("save_design", {
            documentId: doc.id,
            expectedRevision: doc.revision,
            base64,
          });
          if (current.value?.id !== doc.id) return;
          current.value = {
            ...current.value,
            revision: result.document.revision,
            externalChange: false,
          };
          savedBase64 = base64;
        }
        savedVersion = version;
        status.value = state.sceneVersion === version ? "saved" : "dirty";
        error.value = null;
        if (status.value === "dirty") scheduleSave();
      } catch (e) {
        if (e instanceof DesignError && e.code === "revision_conflict") {
          status.value = "conflict";
          if (current.value) current.value = { ...current.value, externalChange: true };
        } else {
          status.value = "error";
          error.value = (e instanceof Error && e.message) || String(e);
          // 保存失败必须能在宿主日志里看到（guest console 会转发到 main 日志）。
          console.error("[openpencil] save_design failed", e);
        }
      } finally {
        saving = null;
      }
    })();
    return saving;
  }
  function scheduleSave(delay = AUTOSAVE_DELAY_MS) {
    if (!current.value || current.value.format === "pen") return;
    if (status.value !== "conflict") status.value = "dirty";
    if (timer) clearTimeout(timer);
    // 使用上游菜单里的自动保存开关，不能同时存在两套 autosave 状态。
    if ("autosaveEnabled" in state && state.autosaveEnabled === false) return;
    timer = setTimeout(() => {
      timer = null;
      if (status.value !== "conflict") void save();
    }, delay);
  }
  const stopWatching = watch(
    () => state.sceneVersion,
    () => {
      if (isDirty()) scheduleSave();
    },
  );

  /** server 检测到磁盘被别人改了：没有本地改动就静默重载，否则交给用户选。 */
  async function onExternalChange(revision: number) {
    const doc = current.value;
    if (!doc) return;
    if (!isDirty() && status.value !== "conflict") {
      current.value = { ...doc, revision };
      await call("resolve_conflict", { documentId: doc.id, strategy: "reload" }).catch(
        () => undefined,
      );
      await load(doc);
      return;
    }
    current.value = { ...doc, revision, externalChange: true };
    status.value = "conflict";
  }
  async function resolveConflict(strategy: "keep-mine" | "reload") {
    const doc = current.value;
    if (!doc) return;
    const result = await call<{ document: DesignRef }>("resolve_conflict", {
      documentId: doc.id,
      strategy,
    });
    if (strategy === "reload") {
      await load(doc);
      return;
    }
    current.value = { ...doc, revision: result.document.revision, externalChange: false };
    status.value = "dirty";
    // keep-mine 要覆盖磁盘上的外部改动：即使内容与面板上次落盘相同也必须重写。
    savedBase64 = null;
    await save();
  }
  /** teardown 只有 500 ms：不等待回执，把最后一版交给 server 即可。 */
  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (isDirty() && status.value !== "conflict") void save();
  }
  async function bind(doc: DesignRef) {
    await saving;
    if (timer) clearTimeout(timer);
    const previous = current.value;
    if (previous)
      await call("report_panel_state", { documentId: previous.id, live: false, dirty: false });
    current.value = { ...doc, format: "fig", externalChange: false };
    savedBase64 = null;
    savedVersion = -1;
    status.value = "dirty";
    await call("report_panel_state", { documentId: doc.id, live: true, dirty: true, active: true });
  }
  function dispose() {
    stopWatching();
    if (timer) clearTimeout(timer);
    ++loadSeq;
    const doc = current.value;
    if (doc)
      void call("report_panel_state", { documentId: doc.id, live: false, dirty: isDirty() }).catch(
        console.error,
      );
  }
  return {
    current,
    status,
    error,
    isDirty,
    load,
    save,
    scheduleSave,
    onExternalChange,
    resolveConflict,
    flush,
    bind,
    dispose,
  };
}
export type DocumentController = ReturnType<typeof createDocumentController>;
