import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { host } from "#ui/bridge.ts";
import { strings } from "#ui/i18n.ts";
import { Icon, type IconName } from "#ui/icons.tsx";

/** 跟随宿主：主题、样式变量（颜色、字体、字号、圆角）、语言与显示模式。 */
export function useHostContext() {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const off = host.onContextChange(rerender);
    return () => void off();
  }, []);
  const context = host.context;
  const theme = context?.theme === "dark" ? "dark" : "light";
  const variables = context?.styles?.variables;
  const fonts = context?.styles?.css?.fonts;
  const inline = context?.displayMode === "inline";
  useEffect(() => applyDocumentTheme(theme), [theme]);
  useEffect(() => {
    if (variables) applyHostStyleVariables(variables);
  }, [variables]);
  useEffect(() => {
    if (fonts) applyHostFonts(fonts);
  }, [fonts]);
  useEffect(() => {
    document.documentElement.classList.toggle("inline", inline);
  }, [inline]);
  return { s: strings(context?.locale ?? navigator.language), inline };
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
  size = 16,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`btn ghost icon-only${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** 输入问题并发送到对话。Enter 发送，Shift+Enter 换行，Esc 关闭。 */
export function AskBox({
  placeholder,
  onSend,
  onClose,
  sendLabel,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
  sendLabel: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ask-box" onMouseDown={(event) => event.stopPropagation()}>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") onClose();
        }}
      />
      <div className="ask-actions">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
        <button type="button" className="btn primary sm" disabled={!text.trim() || busy} onClick={() => void submit()}>
          <Icon name="message" size={14} />
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

/** 页面底部的短暂提示。 */
export function Toast({ message, tone, onDismiss }: { message: string; tone?: "info" | "error"; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, tone === "error" ? 8_000 : 3_500);
    return () => clearTimeout(timer);
  }, [message, tone, onDismiss]);
  return (
    <div className={`toast ${tone ?? "info"}`} role="status" onClick={onDismiss}>
      {tone === "error" && <Icon name="alert" size={14} />}
      <span>{message}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
