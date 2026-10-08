// 选区操作跟随鼠标/键盘选区；成功提示不能覆盖文档保存状态。
import { $, client, state, text } from "./context.ts";
import { setupSelectionFormat } from "./selection-format.ts";

type Snapshot = { id: string; path: string; revision: number; selection: string };
export function setupReferenceButton() {
  const bubble = $("selection-actions");
  const button = $<HTMLButtonElement>("reference");
  const root = $("editor");
  let selected: Snapshot | null = null;
  let dragging = false;
  let composing = false;
  let toastTimer = 0;
  const hide = () => {
    bubble.hidden = true;
    button.disabled = true;
    selected = null;
  };
  const refreshFormat = setupSelectionFormat(hide);
  const toast = (message: string) => {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").hidden = false;
    toastTimer = window.setTimeout(() => {
      $("toast").hidden = true;
    }, 3200);
  };
  const reveal = (pointer?: { x: number; y: number }) => {
    const selection = window.getSelection();
    if (dragging || composing || !state.id || !selection?.rangeCount || selection.isCollapsed)
      return hide();
    const range = selection.getRangeAt(0);
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const editable = start?.closest('[contenteditable="true"]');
    if (!editable || !root.contains(editable) || !editable.contains(range.endContainer))
      return hide();
    const value = selection.toString();
    if (!value.trim()) return hide();
    const viewport = root.getBoundingClientRect();
    const rect = [...range.getClientRects()]
      .filter((item) => item.height > 0 && item.bottom > viewport.top && item.top < viewport.bottom)
      .at(-1);
    if (!rect) return hide();
    refreshFormat(range);
    selected = {
      id: state.id,
      path: state.path,
      revision: state.revision,
      selection: value.slice(0, 12 * 1024),
    };
    button.disabled = false;
    bubble.hidden = false;
    const box = bubble.getBoundingClientRect();
    const x = pointer?.x ?? rect.right;
    const y = pointer?.y ?? Math.min(rect.bottom, viewport.bottom - 8);
    const below = y + 12;
    bubble.style.left = `${Math.max(8, Math.min(x + 8, innerWidth - box.width - 8))}px`;
    bubble.style.top = `${Math.max(8, Math.min(below + box.height <= innerHeight - 8 ? below : y - box.height - 12, innerHeight - box.height - 8))}px`;
  };
  document.addEventListener("pointerdown", (event) => {
    if (bubble.contains(event.target as Node)) return;
    dragging = root.contains(event.target as Node);
    hide();
  });
  document.addEventListener("pointerup", (event) => {
    if (bubble.contains(event.target as Node)) return;
    const fromEditor = dragging;
    dragging = false;
    if (fromEditor) requestAnimationFrame(() => reveal({ x: event.clientX, y: event.clientY }));
  });
  document.addEventListener("selectionchange", () => {
    if (bubble.contains(document.activeElement)) return;
    if (window.getSelection()?.isCollapsed) hide();
    else if (!dragging) requestAnimationFrame(() => reveal());
  });
  root.addEventListener("keyup", (event) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey)
      requestAnimationFrame(() => requestAnimationFrame(() => reveal()));
  });
  root.addEventListener("input", hide);
  root.addEventListener("compositionstart", () => {
    composing = true;
    hide();
  });
  root.addEventListener("compositionend", () => {
    composing = false;
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  for (const event of ["markdown:opened", "markdown:dismiss"])
    document.addEventListener(event, hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  button.addEventListener("click", async () => {
    const snapshot = selected;
    if (!snapshot || snapshot.id !== state.id || button.disabled) return;
    button.disabled = true;
    try {
      await client.updateModelContext({
        content: [
          {
            type: "text",
            text: `Markdown 选区 ${snapshot.path}:\n${snapshot.selection.slice(0, 2000)}`,
          },
        ],
        structuredContent: {
          document: { id: snapshot.id, path: snapshot.path, revision: snapshot.revision },
          selection: snapshot.selection,
        },
      });
      hide();
      toast(text("已添加到输入框，发送时生效", "Added to the composer; applies on send"));
    } catch {
      if (selected === snapshot) button.disabled = false;
      toast(text("添加失败，请重试", "Could not add selection; retry"));
    }
  });
}
