import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "#ui/icons.tsx";

/**
 * 下拉菜单：锚点与菜单放在同一个相对定位的容器里。点外部或 Esc 关闭（Esc 把焦点还给锚点），
 * 上下方向键在菜单项间移动。
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return {
    open,
    root,
    anchor,
    toggle: () => setOpen((value) => !value),
    close: (refocus = false) => {
      setOpen(false);
      if (refocus) anchor.current?.focus();
    },
  };
}

export function Menu({
  onClose,
  align = "left",
  width,
  children,
  label,
}: {
  onClose: (refocus: boolean) => void;
  align?: "left" | "right";
  width?: number;
  children: ReactNode;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = () =>
    [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
  useEffect(() => {
    // 用键盘打开时把焦点放进菜单；鼠标打开时不抢焦点也无妨。
    items()[0]?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={ref}
      className={`menu ${align}`}
      role="menu"
      aria-label={label}
      style={width ? { width } : undefined}
      onKeyDown={(event) => {
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (event.key === "Escape") onClose(true);
        else if (event.key === "ArrowDown") list[(index + 1) % list.length]?.focus();
        else if (event.key === "ArrowUp") list[(index - 1 + list.length) % list.length]?.focus();
        else if (event.key === "Tab") onClose(false);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  lead,
  label,
  shortcut,
  danger,
  checked,
  trailing,
  onSelect,
  className,
}: {
  icon?: IconName | null;
  /** 代替图标放在最前面的内容，例如状态灯。 */
  lead?: ReactNode;
  label: ReactNode;
  shortcut?: string;
  danger?: boolean;
  /** 单选项：显示勾号位（未选中时留空位对齐）。 */
  checked?: boolean;
  trailing?: ReactNode;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={`mi ${danger ? "danger" : ""} ${className ?? ""}`}
      onClick={onSelect}
    >
      {checked !== undefined ? (
        <span className="mi-check">{checked && <Icon name="check" size={14} />}</span>
      ) : icon ? (
        <Icon name={icon} />
      ) : (
        lead
      )}
      <span className="mi-label">{label}</span>
      {trailing}
      {shortcut && <kbd className="sc">{shortcut}</kbd>}
    </button>
  );
}

export const MenuSeparator = () => <div className="msep" role="separator" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="mlabel">{children}</div>;
