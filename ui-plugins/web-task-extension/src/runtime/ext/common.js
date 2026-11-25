/* Shared by the popup and the options page. */
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
const zh = chrome.i18n.getUILanguage().toLowerCase().startsWith("zh");
const el = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) (k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v));
  for (const k of kids) if (k != null) e.append(k);
  return e;
};
function i18nPage() { for (const n of document.querySelectorAll("[data-i18n]")) n.textContent = t(n.dataset.i18n); }
function describe(step) {
  const s = step;
  const q = (x) => `“${x}”`;
  switch (s.action) {
    case "open": return t("dOpen", [s.url]);
    case "click": return t("dClick", [s.text ? q(s.text) : s.selector]);
    case "fill": return t("dFill", [s.selector, q(s.value)]);
    case "wait": return s.selector ? t(s.gone ? "dWaitGone" : "dWait", [s.selector]) : t("dWaitMs", [String((s.ms || 1000) / 1000)]);
    case "extract": return t(s.next ? "dExtractPages" : "dExtract", [s.selector, Object.keys(s.fields || { text: 1 }).join(", "), String(s.maxPages || 5)]);
    case "download": return s.selector ? t("dDownloadLinks", [s.selector]) : t("dDownload", [s.from || "rows", (s.format || "csv").toUpperCase()]);
    default: return s.action;
  }
}
const taskReady = fetch(chrome.runtime.getURL("task.json")).then((r) => r.json());
