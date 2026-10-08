// Vditor 的居中伪元素会在首尾按钮处越界；独立浮层按实际尺寸限制在视口内。
export function setupToolbarTooltip(toolbar: HTMLElement) {
  const tip = document.createElement("div");
  tip.id = "format-tooltip";
  tip.className = "format-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let anchor: HTMLElement | null = null;
  const hide = () => {
    anchor = null;
    tip.hidden = true;
  };
  const buttonFor = (target: EventTarget | null) => {
    const button =
      target instanceof Element
        ? target.closest<HTMLElement>(".vditor-toolbar__item > button[aria-label]")
        : null;
    return button && toolbar.contains(button) ? button : null;
  };
  const show = (event: Event) => {
    const button = buttonFor(event.target);
    if (!button || button === anchor) return;
    anchor = button;
    tip.textContent = button.getAttribute("aria-label");
    tip.hidden = false;
    const rect = button.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    const gap = 8;
    tip.style.left = `${Math.max(gap, Math.min(rect.left + (rect.width - bounds.width) / 2, innerWidth - bounds.width - gap))}px`;
    const below = rect.bottom + gap;
    const top = below + bounds.height <= innerHeight - gap ? below : rect.top - bounds.height - gap;
    tip.style.top = `${Math.max(gap, Math.min(top, innerHeight - bounds.height - gap))}px`;
  };
  for (const event of ["pointerover", "pointermove", "focusin"])
    toolbar.addEventListener(event, show);
  for (const event of ["pointerout", "focusout"])
    toolbar.addEventListener(event, (event) => {
      if (buttonFor((event as MouseEvent | FocusEvent).relatedTarget) !== anchor) hide();
    });
  document.addEventListener("pointerdown", hide);
  toolbar.addEventListener("click", hide);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  for (const event of ["markdown:opened", "markdown:dismiss"])
    document.addEventListener(event, hide);
}
