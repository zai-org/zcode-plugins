import { getClient } from "./client.ts";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, CaptureUpdateAction, restore } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createEditorController, type EditorState } from "#excalidraw/app/editor.ts";
import { selectionContext } from "#excalidraw/domain/scene.ts";
import type { Diagram, Scene } from "#excalidraw/contract.ts";
import { call, read, outputRef } from "#ui/bridge.ts";
import { exportDiagram } from "#ui/export.ts";
import { DocumentMenu } from "#ui/DocumentMenu.tsx";
import { ExportDialog } from "#ui/ExportDialog.tsx";
import { ReferenceContextMenu } from "#ui/ReferenceContextMenu.tsx";
import { RenameDialog } from "#ui/RenameDialog.tsx";
import { ToolbarIcon } from "#ui/ToolbarIcon.tsx";
import "@excalidraw/excalidraw/index.css";
import "#ui/panel.css";

const OPTIONS = {
  canvasActions: {
    loadScene: false,
    export: false as const,
    saveToActiveFile: false,
    saveAsImage: false,
    toggleTheme: false,
  },
};
function outputRefKey() {
  const ref = outputRef();
  return ref ? `${ref.id}:${ref.revision}` : "";
}
function App() {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<AppState["contextMenu"]>(null);
  const [state, setState] = useState<EditorState>({
    document: null,
    dirty: false,
    saving: false,
    error: null,
  });
  const [ready, setReady] = useState(false);
  const [globals, setGlobals] = useState({
    theme: getClient().theme,
    locale: getClient().locale,
  });
  const [documents, setDocuments] = useState<Array<Pick<Diagram, "id" | "title">>>([]);
  const recentIds = useRef<string[]>([]);
  const [recentDocumentIds, setRecentDocumentIds] = useState<string[]>([]);
  const [renameTarget, setRenameTarget] = useState<Pick<Diagram, "id" | "title"> | null>(null);
  const lastContextDocument = useRef("");
  const lastToolRef = useRef("");
  const contextQueue = useRef(Promise.resolve());
  const widgetStateQueue = useRef(Promise.resolve());
  const [selectedCount, setSelectedCount] = useState(0);
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const importing = useRef<HTMLInputElement>(null);
  const applying = useRef(false);
  const cn = globals.locale?.startsWith("zh") ?? true;
  const t = (zh: string, en: string) => (cn ? zh : en);
  const persistTabs = (documentId: string | null) => {
    const saved = {
      documentId,
      recentDocumentIds: [...recentIds.current],
      lastToolRef: outputRefKey(),
    };
    const pending = widgetStateQueue.current.then(() => getClient().setWidgetState(saved));
    widgetStateQueue.current = pending.catch(() => {});
    return pending;
  };
  const publishContext = (context: Record<string, unknown>) => {
    // A slow previous bridge request must never overwrite the newly selected diagram.
    const pending = contextQueue.current.then(() =>
      getClient().updateModelContext({
        content: [{ type: "text", text: `Excalidraw ${JSON.stringify(context)}` }],
        structuredContent: context,
      }),
    );
    contextQueue.current = pending.catch(() => {});
    return pending;
  };
  const controller = useRef<ReturnType<typeof createEditorController> | null>(null);
  if (!controller.current)
    controller.current = createEditorController({
      read,
      async commit(input) {
        const result = await call("commit_scene", input as unknown as Record<string, unknown>);
        return { ...result.document, scene: input.scene, updatedAt: Date.now() };
      },
      onScene(scene, mode) {
        const canvas = api.current;
        if (!canvas) return;
        applying.current = true;
        try {
          const reset = mode === "reset";
          const restored = restore(
            scene as any,
            reset ? null : canvas.getAppState(),
            reset ? null : canvas.getSceneElementsIncludingDeleted(),
          );
          // 同一文档的工具修改必须入普通历史；resetScene 会清空用户已有撤销记录。
          if (reset) canvas.resetScene();
          canvas.addFiles(Object.values(restored.files));
          canvas.updateScene({
            elements: restored.elements,
            appState: {
              ...(reset ? restored.appState : scene.appState),
              ...(reset
                ? { zoom: { value: 1 as AppState["zoom"]["value"] }, scrollX: 0, scrollY: 0 }
                : {}),
              theme: getClient().theme === "dark" ? "dark" : "light",
            },
            captureUpdate: reset ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
          });
          // Fitting an empty bounding box produces Excalidraw's maximum zoom (3000%).
          if (reset && restored.elements.some((element: ExcalidrawElement) => !element.isDeleted))
            canvas.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.75 });
        } finally {
          applying.current = false;
        }
      },
      onState(next) {
        setState(next);
        if (next.document && !next.dirty && !next.saving) {
          const doc = next.document;
          setDocuments((docs) => [
            { id: doc.id, title: doc.title },
            ...docs.filter((item) => item.id !== doc.id),
          ]);
          if (recentIds.current.at(-1) !== doc.id) {
            const recent = [...recentIds.current.filter((id) => id !== doc.id), doc.id].slice(-8);
            recentIds.current = recent;
            // Keep visible tabs in place while retaining the eight most recently visited diagrams.
            setRecentDocumentIds((ids) => [
              ...ids.filter((id) => recent.includes(id)),
              ...recent.filter((id) => !ids.includes(id)),
            ]);
          }
          void persistTabs(doc.id).catch((e) => setOperation(String(e)));
          const key = JSON.stringify([doc.id, doc.title]);
          if (key !== lastContextDocument.current) {
            lastContextDocument.current = key;
            void publishContext({
              kind: "active-diagram",
              documentId: doc.id,
              title: doc.title,
              revision: doc.revision,
            }).catch((e) => {
              if (lastContextDocument.current === key) lastContextDocument.current = "";
              setOperation(String(e));
            });
          }
        } else if (!next.document) {
          // Closing the last tab must not reopen an old tool result on the next host update.
          lastToolRef.current = outputRefKey();
          lastContextDocument.current = "";
          void persistTabs(null).catch((e) => setOperation(String(e)));
          void publishContext({ kind: "active-diagram", documentId: null }).catch((e) =>
            setOperation(String(e)),
          );
        }
      },
    });
  const editor = controller.current;
  useEffect(() => {
    tabsRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.document?.id, recentDocumentIds]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setOperation("");
    try {
      await action();
    } catch (e) {
      setOperation(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let initial = true;
    const refresh = () => {
      if (!active) return;
      setGlobals({ theme: getClient().theme, locale: getClient().locale });
      // 旧结果仅用于空页面恢复；活页面不能把先到的新输入与旧导出结果拼接后误切文档。
      const ref = outputRef(!editor.state().document);
      const saved = getClient().widgetState as
        | { documentId?: string | null; lastToolRef?: string; recentDocumentIds?: string[] }
        | undefined;
      if (initial && Array.isArray(saved?.recentDocumentIds)) {
        recentIds.current = [
          ...new Set(saved.recentDocumentIds.filter((id) => typeof id === "string")),
        ].slice(-8);
        setRecentDocumentIds(recentIds.current);
      }
      // 重开时旧 toolOutput 不能覆盖用户另选的文档；真正新增的工具结果仍优先打开。
      const restoreSelected =
        initial && saved?.documentId && (!ref || saved.lastToolRef === outputRefKey());
      const restoreEmpty =
        initial && saved?.documentId === null && (!ref || saved.lastToolRef === outputRefKey());
      initial = false;
      if (restoreEmpty) {
        lastToolRef.current = outputRefKey();
        return;
      }
      if (restoreSelected) {
        lastToolRef.current = outputRefKey();
        void editor.open(saved.documentId!).catch((e) => setOperation(String(e)));
        return;
      }
      if (ref && `${ref.id}:${ref.revision}` !== lastToolRef.current) {
        lastToolRef.current = `${ref.id}:${ref.revision}`;
        const current = editor.state().document;
        if (current?.id === ref.id && current.revision >= ref.revision) return;
        void editor.open(ref.id).catch((e) => setOperation(String(e)));
      }
    };
    window.addEventListener("plugin:change", refresh);
    refresh();
    void call("list_diagrams")
      .then((r) => {
        if (active)
          setDocuments((docs) => [
            ...docs,
            ...r.documents.filter((doc: Diagram) => !docs.some((item) => item.id === doc.id)),
          ]);
      })
      .catch((e) => setOperation(String(e)));
    getClient().notifyIntrinsicHeight(680);
    window.__excalidrawPanel = {
      api: api.current,
      state: editor.state,
      flush: editor.flush,
      reload: async () => {
        const d = editor.state().document;
        if (d) await editor.open(d.id);
      },
    };
    return () => {
      active = false;
      window.removeEventListener("plugin:change", refresh);
      delete window.__excalidrawPanel;
    };
  }, [ready, editor]);
  const changed = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    setSelectedCount(Object.values(appState.selectedElementIds).filter(Boolean).length);
    setContextMenu(appState.contextMenu);
    if (!applying.current) {
      try {
        editor.edit({ elements, appState, files } as unknown as Scene);
      } catch (e) {
        setOperation(String(e));
      }
    }
  };
  const newDocument = async (scene?: Scene) => {
    await editor.flush();
    const title = t("未命名画板", "Untitled diagram");
    const result = scene
      ? await call("save_copy", { title, scene })
      : await call("create_diagram", { title, elements: [] });
    await editor.open(result.document.id, true);
  };
  const reference = async () => {
    // 右键先更新命中选区；等待保存前固定目标，避免旧闭包或后续选择造成引用错位。
    const id = editor.state().document?.id;
    const selectedIds = Object.entries(api.current?.getAppState().selectedElementIds ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    await editor.flush();
    const doc = editor.state().document;
    if (!doc || doc.id !== id)
      throw new Error(t("画板已切换，请重新引用。", "Diagram changed. Please reference it again."));
    const ids = selectedIds.length
      ? selectedIds
      : doc.scene.elements.filter((e) => !e.isDeleted).map((e) => e.id);
    const context = {
      kind: selectedIds.length ? "selection" : "diagram",
      documentId: doc.id,
      title: doc.title,
      revision: doc.revision,
      elementIds: ids,
      labels: selectionContext(doc.scene, ids)
        .filter((e) => e.type === "text")
        .map((e) => String(e.text))
        .slice(0, 20),
    };
    await publishContext(context);
    setOperation(
      t(
        "已加入对话输入框，可继续输入修改要求。",
        "Added to the chat input. Describe your changes there.",
      ),
    );
  };
  const referenceLabel = selectedCount
    ? t(`引用选区到对话 (${selectedCount})`, `Reference selection in chat (${selectedCount})`)
    : t("引用整图到对话", "Reference diagram in chat");
  const visibleDocuments =
    state.document && !documents.some((doc) => doc.id === state.document!.id)
      ? [state.document, ...documents]
      : documents;
  const recentDocuments = recentDocumentIds.flatMap((id) => {
    const doc = visibleDocuments.find((doc) => doc.id === id);
    return doc ? [doc] : [];
  });
  const showDocumentTabs = recentDocuments.length > 0;
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const scrollTabs = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        tabs.scrollWidth <= tabs.clientWidth
      )
        return;
      // Keep native horizontal gestures; convert a vertical mouse wheel only over the tabs.
      event.preventDefault();
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? tabs.clientWidth
            : 1;
      tabs.scrollLeft += event.deltaY * unit;
    };
    // React's delegated wheel listener is passive, so cancellation needs a native listener.
    tabs.addEventListener("wheel", scrollTabs, { passive: false });
    return () => tabs.removeEventListener("wheel", scrollTabs);
  }, [showDocumentTabs]);
  const saveState = state.error
    ? "error"
    : state.saving || state.dirty
      ? "saving"
      : state.document
        ? "saved"
        : "empty";
  const saveLabel = {
    error: t("保存失败", "Save failed"),
    saving: t("保存中…", "Saving…"),
    saved: t("已保存", "Saved"),
    empty: t("未打开画板", "No diagram"),
  }[saveState];
  const rename = () => {
    const doc = editor.state().document;
    if (doc && !busy) setRenameTarget({ id: doc.id, title: doc.title });
  };
  const closeTab = async (id: string) => {
    const index = recentDocuments.findIndex((doc) => doc.id === id);
    if (index < 0) return;
    if (editor.state().document?.id === id) {
      const neighbor = recentDocuments[index + 1] ?? recentDocuments[index - 1];
      if (neighbor) await editor.open(neighbor.id);
      else await editor.close();
      // A newer tool update may have superseded the switch or close.
      if (editor.state().document?.id === id) return;
    }
    recentIds.current = recentIds.current.filter((item) => item !== id);
    setRecentDocumentIds((ids) => ids.filter((item) => item !== id));
    await persistTabs(editor.state().document?.id ?? null);
    requestAnimationFrame(() => {
      (
        tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
        document.querySelector<HTMLElement>(".document-menu summary")
      )?.focus();
    });
  };
  return (
    <main className={`diagram-app text-ui-base ${globals.theme === "dark" ? "dark" : ""}`}>
      <header className="document-bar">
        <DocumentMenu
          documents={visibleDocuments}
          currentId={state.document?.id}
          busy={busy}
          referenceLabel={referenceLabel}
          t={t}
          onNew={() => void run(() => newDocument())}
          onImport={() => importing.current?.click()}
          onOpen={(id) => void run(() => editor.open(id))}
          onReference={() => void run(reference)}
          onRename={rename}
        />
        <button
          id="new-document-shortcut"
          className="toolbar-button"
          disabled={busy}
          title={t("新建画板", "New diagram")}
          aria-label={t("新建画板", "New diagram")}
          onClick={() => void run(() => newDocument())}
        >
          <ToolbarIcon name="plus" />
        </button>
        {showDocumentTabs && (
          <div
            ref={tabsRef}
            className="document-tabs"
            role="tablist"
            aria-label={t("最近打开的画板", "Recently opened diagrams")}
          >
            {recentDocuments.map((doc) => (
              <div
                key={doc.id}
                className="document-tab"
                role="presentation"
                data-active={doc.id === state.document?.id}
              >
                <button
                  id={`diagram-tab-${doc.id}`}
                  role="tab"
                  aria-selected={doc.id === state.document?.id}
                  aria-controls="diagram-canvas"
                  tabIndex={doc.id === state.document?.id ? 0 : -1}
                  disabled={busy}
                  title={t(`${doc.title}（双击重命名）`, `${doc.title} (double-click to rename)`)}
                  onClick={() => {
                    if (doc.id !== editor.state().document?.id) void run(() => editor.open(doc.id));
                  }}
                  onDoubleClick={() => {
                    if (doc.id === editor.state().document?.id) rename();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "F2" && doc.id === editor.state().document?.id) {
                      event.preventDefault();
                      rename();
                    }
                    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                      event.preventDefault();
                      const tabs = Array.from(
                        tabsRef.current!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                      );
                      const index = tabs.indexOf(event.currentTarget);
                      const next =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                              tabs.length;
                      tabs[next]?.focus();
                    }
                  }}
                >
                  <span className="document-name">{doc.title}</span>
                </button>
                <button
                  className="document-tab-close"
                  disabled={busy}
                  aria-label={t(`关闭标签 ${doc.title}`, `Close tab ${doc.title}`)}
                  title={t("关闭标签（保留画板）", "Close tab (keep diagram)")}
                  onClick={() => void run(() => closeTab(doc.id))}
                >
                  <ToolbarIcon name="close" />
                </button>
              </div>
            ))}
          </div>
        )}
        <span id="save-status" role="status" data-state={saveState} title={saveLabel}>
          <span className="save-status-dot" aria-hidden="true" />
          <span className="sr-only">{saveLabel}</span>
        </span>
        <button
          id="open-export"
          className="toolbar-button"
          title={t("导出", "Export")}
          aria-label={t("导出", "Export")}
          disabled={!state.document || busy}
          onClick={() => setExportOpen(true)}
        >
          <ToolbarIcon name="export" />
        </button>
        <input
          ref={importing}
          type="file"
          accept=".excalidraw,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(async () => newDocument(JSON.parse(await file.text())));
            event.target.value = "";
          }}
        />
      </header>
      <div
        className="canvas-host"
        id="diagram-canvas"
        role={showDocumentTabs ? "tabpanel" : "region"}
        aria-labelledby={
          showDocumentTabs && state.document ? `diagram-tab-${state.document.id}` : undefined
        }
        ref={canvasRef}
      >
        <Excalidraw
          excalidrawAPI={(value: ExcalidrawImperativeAPI) => {
            api.current = value;
            setReady(true);
          }}
          onChange={changed}
          theme={globals.theme === "dark" ? "dark" : "light"}
          langCode={cn ? "zh-CN" : "en"}
          UIOptions={OPTIONS}
          aiEnabled={false}
          validateEmbeddable={false}
          handleKeyboardGlobally={false}
          viewModeEnabled={!state.document}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
        <ReferenceContextMenu
          canvasRef={canvasRef}
          menu={contextMenu}
          label={referenceLabel}
          disabled={!state.document || busy}
          onSelect={() => {
            void run(reference);
            api.current?.updateScene({
              appState: { contextMenu: null },
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            canvasRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus();
          }}
        />
      </div>
      {(state.error || operation) && (
        <div className="notice text-ui-sm" role="status" id="operation-status">
          <span>{state.error || operation}</span>
          {state.error ? (
            <div className="notice-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await call("save_copy", {
                      title: `${state.document?.title} ${t("副本", "copy")}`,
                      scene: editor.scene(),
                    });
                    await editor.open(result.document.id, true);
                  })
                }
              >
                {t("保存副本", "Save a copy")}
              </button>
              <button
                disabled={busy}
                onClick={() => void run(() => editor.open(state.document!.id, true))}
              >
                {t("放弃草稿并重载", "Discard draft and reload")}
              </button>
            </div>
          ) : (
            <button aria-label={t("关闭提示", "Dismiss message")} onClick={() => setOperation("")}>
              ×
            </button>
          )}
        </div>
      )}
      {renameTarget && (
        <RenameDialog
          title={renameTarget.title}
          t={t}
          onClose={() => setRenameTarget(null)}
          onSave={async (title) => {
            if (editor.state().document?.id !== renameTarget.id)
              throw new Error(
                t("画板已切换，请重新命名。", "Diagram changed. Please rename it again."),
              );
            await editor.rename(title);
          }}
        />
      )}
      {exportOpen && state.document && (
        <ExportDialog
          title={state.document.title}
          t={t}
          onClose={() => setExportOpen(false)}
          onExport={async (format, path, overwrite) => {
            const documentId = state.document!.id;
            await editor.flush();
            const current = editor.state().document;
            if (!current || current.id !== documentId)
              throw new Error(
                t("画板已切换，请重新导出。", "Diagram changed. Please export again."),
              );
            const output = await exportDiagram(api.current!, current, format, path, overwrite);
            setOperation(`${t("已导出", "Exported")}: ${output}`);
            return output;
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
