import { useEffect, useRef, useState } from "react";
import type { Translate } from "#ui/DocumentMenu.tsx";
import { DiagramError } from "#excalidraw/contract.ts";

export function ExportDialog({
  title,
  onExport,
  onClose,
  t,
}: {
  title: string;
  onExport(format: string, path: string, overwrite: boolean): Promise<string>;
  onClose(): void;
  t: Translate;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState("excalidraw");
  const [path, setPath] = useState(
    () => `${title.replace(/[\\/:*?"<>|]/g, "_").trim() || "diagram"}.excalidraw`,
  );
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="panel-dialog text-ui-base"
      aria-labelledby="export-title"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onExport(format, path, overwrite);
            dialog.current?.close();
          } catch (error) {
            setError(
              error instanceof DiagramError && error.code === "file_exists"
                ? t(
                    "同名文件已存在。请修改文件名，或勾选“覆盖同名文件”。",
                    "A file with this name exists. Choose another name or enable overwrite.",
                  )
                : error instanceof Error
                  ? error.message
                  : String(error),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="export-title" className="text-ui-base">
          {t("导出画板", "Export diagram")}
        </h2>
        <label htmlFor="export-format">{t("格式", "Format")}</label>
        <select
          id="export-format"
          autoFocus
          disabled={busy}
          value={format}
          onChange={(event) => {
            const next = event.target.value;
            setFormat(next);
            setPath((value) => value.replace(/\.(excalidraw|png|svg)$/i, "") + `.${next}`);
          }}
        >
          <option value="excalidraw">
            {t("Excalidraw · 可继续编辑", "Excalidraw · Editable")}
          </option>
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
        </select>
        <label htmlFor="export-path">{t("文件路径", "File path")}</label>
        <input
          id="export-path"
          required
          disabled={busy}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <p className="field-hint text-ui-sm">
          {t(
            "保存到当前工作区，可输入已有子目录。",
            "Save in this workspace or an existing subfolder.",
          )}
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={busy}
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          {t("覆盖同名文件", "Overwrite existing file")}
        </label>
        {error && (
          <p className="dialog-error text-ui-sm" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>
            {t("取消", "Cancel")}
          </button>
          <button id="export-button" className="primary-button" disabled={busy || !path.trim()}>
            {busy ? t("导出中…", "Exporting…") : t("导出", "Export")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
