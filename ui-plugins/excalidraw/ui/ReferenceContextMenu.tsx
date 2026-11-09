import { useLayoutEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { AppState } from "@excalidraw/excalidraw/types";

export function ReferenceContextMenu({
  canvasRef,
  menu,
  label,
  disabled,
  onSelect,
}: {
  canvasRef: RefObject<HTMLDivElement | null>;
  menu: AppState["contextMenu"];
  label: string;
  disabled: boolean;
  onSelect(): void;
}) {
  const [slot, setSlot] = useState<HTMLLIElement | null>(null);
  useLayoutEffect(() => {
    if (!menu) {
      setSlot(null);
      return;
    }
    // Excalidraw 0.18.1 没有菜单扩展 API；只挂载自有节点，保留原生菜单与命中选区逻辑。
    const list = canvasRef.current?.querySelector(".context-menu");
    if (!list) return;
    const item = document.createElement("li");
    item.className = "reference-menu-slot";
    list.prepend(item);
    setSlot(item);
    return () => {
      item.remove();
    };
  }, [canvasRef, menu]);
  useLayoutEffect(() => {
    const popover = slot?.closest<HTMLElement>(".popover");
    const canvas = canvasRef.current;
    if (!popover || !canvas) return;
    // 原生定位只观察坐标变化，新增项后需重新收边，避免侧栏底部的菜单被截断。
    const fit = () => {
      const bounds = canvas.getBoundingClientRect();
      popover.style.maxHeight = `${Math.max(40, bounds.height - 16)}px`;
      popover.style.maxWidth = `${Math.max(40, bounds.width - 16)}px`;
      popover.style.overflowY = "auto";
      const rect = popover.getBoundingClientRect();
      const dx = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
      const dy = Math.max(bounds.top + 8 - rect.top, Math.min(0, bounds.bottom - 8 - rect.bottom));
      if (dx) popover.style.left = `${popover.offsetLeft + dx}px`;
      if (dy) popover.style.top = `${popover.offsetTop + dy}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(popover);
    observer.observe(canvas);
    fit();
    return () => observer.disconnect();
  }, [slot, canvasRef, label]);
  return menu && slot
    ? createPortal(
        <button
          id="reference-context-menu"
          type="button"
          className="context-menu-item"
          disabled={disabled}
          onClick={onSelect}
        >
          <span className="context-menu-item__label">{label}</span>
        </button>,
        slot,
      )
    : null;
}
