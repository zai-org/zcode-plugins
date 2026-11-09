import { useEffect, useRef } from "react";
import type { Diagram } from "#excalidraw/contract.ts";
import { ToolbarIcon } from "#ui/ToolbarIcon.tsx";

export type Translate = (zh: string, en: string) => string;
export function DocumentMenu({
  documents,
  currentId,
  busy,
  referenceLabel,
  onNew,
  onImport,
  onOpen,
  onReference,
  onRename,
  t,
}: {
  documents: Array<Pick<Diagram, "id" | "title">>;
  currentId?: string;
  busy: boolean;
  referenceLabel: string;
  onNew(): void;
  onImport(): void;
  onOpen(id: string): void;
  onReference(): void;
  onRename(): void;
  t: Translate;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const choose = (action: () => void) => {
    menu.current?.removeAttribute("open");
    menu.current?.querySelector("summary")?.focus();
    action();
  };
  return (
    <details
      ref={menu}
      className="document-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          choose(() => {});
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          menu.current?.removeAttribute("open");
      }}
    >
      <summary className="toolbar-button" aria-label={t("菜单", "Menu")} title={t("菜单", "Menu")}>
        <ToolbarIcon name="menu" />
      </summary>
      <div className="document-menu-content" aria-label={t("文档操作", "Document actions")}>
        <button id="new-document" disabled={busy} onClick={() => choose(onNew)}>
          {t("新建画板", "New diagram")}
        </button>
        <button disabled={busy} onClick={() => choose(onImport)}>
          {t("导入画板…", "Import diagram…")}
        </button>
        <button disabled={!currentId || busy} onClick={() => choose(onRename)}>
          {t("重命名画板…", "Rename diagram…")}
        </button>
        <button
          id="reference-selection"
          disabled={!currentId || busy}
          onClick={() => choose(onReference)}
        >
          {referenceLabel}
        </button>
        {documents.length > 0 && (
          <>
            <div className="menu-caption text-ui-sm">{t("切换画板", "Switch diagram")}</div>
            <div className="document-list">
              {documents.map((doc) => (
                <button
                  key={doc.id}
                  disabled={busy}
                  aria-current={doc.id === currentId ? "true" : undefined}
                  title={doc.title}
                  onClick={() => choose(() => onOpen(doc.id))}
                >
                  <span className="document-name">{doc.title}</span>
                  <span aria-hidden="true">{doc.id === currentId ? "✓" : ""}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
