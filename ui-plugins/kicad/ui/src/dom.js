export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith("aria-") && v != null) { el.setAttribute(k, String(v)); continue; } // aria-pressed=true must be the string "true", not an empty attribute
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export function applyTheme(app) {
  const ctx = app.getHostContext?.() || {};
  document.documentElement.dataset.theme = ctx.theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.mode = ctx.displayMode === "fullscreen" ? "fullscreen" : "inline";   // see the --h* caps in style.css
}
export const text = (r) => (r?.content || []).find((c) => c.type === "text")?.text;
export const json = (r) => { try { return r?.structuredContent && Object.keys(r.structuredContent).length ? r.structuredContent : JSON.parse(text(r)); } catch { return null; } };
