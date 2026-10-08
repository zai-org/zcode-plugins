// Vditor 内置大纲在移动宽度被内核强制隐藏；插件独立维护响应式目录。
import type Vditor from "vditor";
import { $, state, text } from "./context.ts";

export function refreshOutline() {
  const panel = $("outline-panel");
  const editor = state.editor as Vditor | null;
  if (editor?.getCurrentMode() === "sv") {
    panel.hidden = true;
    $("outline").setAttribute("aria-pressed", "false");
  }
  if (panel.hidden) return;
  const mode = editor?.getCurrentMode() ?? "ir";
  const nodes = document.querySelectorAll<HTMLElement>(
    `.vditor-${mode} [contenteditable] :is(h1,h2,h3,h4,h5,h6)`,
  );
  const buttons = [...nodes].map((heading) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent =
      heading.innerText.replace(/^#+\s*/, "").trim() || text("未命名标题", "Untitled heading");
    button.title = button.textContent;
    button.style.paddingInlineStart = `${12 + Math.min(3, Number(heading.tagName.slice(1)) - 1) * 12}px`;
    button.addEventListener("click", () => {
      heading.scrollIntoView({ block: "start" });
      if (matchMedia("(max-width: 760px)").matches) {
        panel.hidden = true;
        $("outline").setAttribute("aria-pressed", "false");
      }
    });
    return button;
  });
  $("outline-items").replaceChildren(...buttons);
  $("outline-empty").hidden = nodes.length > 0;
}

export function setupOutline() {
  $("outline").setAttribute("aria-controls", "outline-panel");
  $("outline").addEventListener("click", () => {
    const panel = $("outline-panel");
    panel.hidden = !panel.hidden;
    $("outline").setAttribute("aria-pressed", String(!panel.hidden));
    document.dispatchEvent(new Event("markdown:dismiss"));
    refreshOutline();
  });
  $("outline-close").addEventListener("click", () => $("outline").click());
  document.addEventListener("pointerdown", (event) => {
    if (!matchMedia("(max-width: 760px)").matches || $("outline-panel").hidden) return;
    const target = event.target as Node;
    if (!$("outline-panel").contains(target) && !$("outline").contains(target)) {
      $("outline-panel").hidden = true;
      $("outline").setAttribute("aria-pressed", "false");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("outline-panel").hidden) {
      $("outline-panel").hidden = true;
      $("outline").setAttribute("aria-pressed", "false");
      $("outline").focus();
    }
  });
}
