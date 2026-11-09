import { useEffect, useRef, useState } from "react";
import type { Translate } from "#ui/DocumentMenu.tsx";

export function RenameDialog({
  title,
  onSave,
  onClose,
  t,
}: {
  title: string;
  onSave(title: string): Promise<void>;
  onClose(): void;
  t: Translate;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.select();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="panel-dialog text-ui-base"
      aria-labelledby="rename-title"
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
            await onSave(value.trim());
            dialog.current?.close();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="rename-title" className="text-ui-base">
          {t("重命名画板", "Rename diagram")}
        </h2>
        <label htmlFor="rename-input">{t("画板名称", "Diagram name")}</label>
        <input
          ref={input}
          id="rename-input"
          autoFocus
          required
          maxLength={200}
          disabled={busy}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        {error && (
          <p className="dialog-error text-ui-sm" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={() => dialog.current?.close()}>
            {t("取消", "Cancel")}
          </button>
          <button id="rename-button" className="primary-button" disabled={busy || !value.trim()}>
            {busy ? t("保存中…", "Saving…") : t("保存", "Save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
