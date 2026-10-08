// 写作界面只管理展示；保存与文档身份仍由 DocumentSession 负责。
import { setupOutline, refreshOutline } from "./outline.ts";
import { setupToolbarTooltip } from "./toolbar-tooltip.ts";
import type Vditor from "vditor";
import { $, safeGetValue, state, text } from "./context.ts";

export function refreshWritingControls() {
  for (const id of ["format", "outline", "source"]) $<HTMLButtonElement>(id).disabled = !state.id;
  $<HTMLButtonElement>("outline").disabled =
    !state.id || (state.editor as Vditor | null)?.getCurrentMode() === "sv";
  refreshOutline();
  if (!state.id) return;
  const characters = [...safeGetValue().replace(/\s/g, "")].length;
  $("word-count").textContent = text(
    `${characters.toLocaleString()} 字符`,
    `${characters.toLocaleString()} characters`,
  );
}

export function setupWritingControls() {
  const editor = state.editor as Vditor;
  const toolbar = document.querySelector<HTMLElement>(".vditor-toolbar")!;
  toolbar.id = "format-tools";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", text("文本格式", "Text formatting"));
  setupToolbarTooltip(toolbar);
  const format = $("format");
  const closeMenus = () => {
    toolbar.querySelectorAll<HTMLElement>(".vditor-hint").forEach((panel) => {
      panel.style.display = "none";
    });
  };
  const setExpanded = (expanded: boolean) => {
    document.body.classList.toggle("format-open", expanded);
    format.setAttribute("aria-expanded", String(expanded));
    format.title = expanded
      ? text("收起格式工具栏", "Collapse formatting toolbar")
      : text("展开格式工具栏", "Expand formatting toolbar");
    if (!expanded) closeMenus();
  };
  const syncMode = () => {
    const source = editor.getCurrentMode() === "sv";
    $("source").setAttribute("aria-pressed", String(source));
    $("source").title = source
      ? text("返回即时预览", "Return to live preview")
      : text("编辑 Markdown 源码", "Edit Markdown source");
    if (source) refreshOutline();
    $<HTMLButtonElement>("outline").disabled = !state.id || source;
  };
  // 保留编辑器光标，点击格式菜单不会把格式施加到别的段落。
  for (const id of ["format", "outline", "source"])
    $(id).addEventListener("mousedown", (event) => event.preventDefault());
  format.addEventListener("click", () => {
    const opening = !document.body.classList.contains("format-open");
    document.dispatchEvent(new Event("markdown:dismiss"));
    $("docs").hidden = true;
    $("switch").setAttribute("aria-expanded", "false");
    setExpanded(opening);
  });
  setupOutline();
  $("source").addEventListener("click", () => {
    closeMenus();
    const mode = editor.getCurrentMode() === "sv" ? "ir" : "sv";
    toolbar.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)?.click();
    syncMode();
  });
  // 工具栏固定占位；只有二级菜单浮动，始终限制在视口内。
  toolbar.addEventListener("click", () =>
    requestAnimationFrame(() => {
      for (const panel of toolbar.querySelectorAll<HTMLElement>(".vditor-hint")) {
        if (getComputedStyle(panel).display === "none") continue;
        const anchor = panel.parentElement!.getBoundingClientRect();
        panel.style.position = "fixed";
        panel.style.maxHeight = `${Math.max(80, innerHeight - 80)}px`;
        panel.style.overflowY = "auto";
        const bounds = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
        panel.style.top = `${Math.max(52, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8))}px`;
      }
      syncMode();
    }),
  );
  document.addEventListener("pointerdown", (event) => {
    if (!toolbar.contains(event.target as Node) && !format.contains(event.target as Node))
      closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
    // 模式快捷键由 Vditor 处理，下一帧同步外围按钮。
    requestAnimationFrame(syncMode);
  });
  for (const event of ["markdown:opened", "markdown:dismiss"])
    document.addEventListener(event, closeMenus);
  window.addEventListener("resize", closeMenus);
  setExpanded(false);
  refreshWritingControls();
  syncMode();
}
