// 复用 Vditor 的格式命令与状态，避免另建一套 Markdown 编辑/撤销逻辑。
import { $, text } from "./context.ts";

export function setupSelectionFormat(onInvalidSelection: () => void) {
  const bubble = $("selection-actions");
  const toolbar = document.querySelector<HTMLElement>(".vditor-toolbar")!;
  let range: Range | null = null;
  bubble.setAttribute("aria-label", text("选区格式与操作", "Selection formatting and actions"));
  const controls = ["bold", "italic", "strike", "inline-code", "link"].map((type) => {
    const command = toolbar.querySelector<HTMLButtonElement>(`[data-type="${type}"]`)!;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.selectionFormat = type;
    button.innerHTML = command.innerHTML;
    const label = command.getAttribute("aria-label")!;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", () => {
      if (!range || !$("editor").contains(range.commonAncestorContainer) || button.disabled)
        return onInvalidSelection();
      const selected = window.getSelection();
      const node = range.startContainer;
      const element = node instanceof Element ? node : node.parentElement;
      element?.closest<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
      selected?.removeAllRanges();
      selected?.addRange(range);
      command.click();
    });
    $("selection-format").append(button);
    return { command, button };
  });
  const refresh = () => {
    for (const { command, button } of controls) {
      button.disabled = command.classList.contains("vditor-menu--disabled");
      button.setAttribute(
        "aria-pressed",
        String(command.classList.contains("vditor-menu--current")),
      );
    }
  };
  new MutationObserver(refresh).observe(toolbar, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  // 鼠标点击不夺走选区；Tab 进入工具条后也能恢复刚才的选区。
  bubble.addEventListener("mousedown", (event) => event.preventDefault());
  bubble.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...bubble.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  });
  return (selectionRange: Range) => {
    range = selectionRange.cloneRange();
    refresh();
  };
}
