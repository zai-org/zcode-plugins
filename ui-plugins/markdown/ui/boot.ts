import { getClient } from "./client.ts";

/** Theme the first visible frame before loading the editor bundle. */
export function applyHostTheme() {
  const context = getClient().hostContext;
  const root = document.documentElement;
  root.dataset.theme = context?.theme === "dark" ? "dark" : "light";
  root.style.colorScheme = root.dataset.theme;
  for (const [name, value] of Object.entries(context?.styles?.variables ?? {}))
    if (typeof value === "string") root.style.setProperty(name, value);
  const message = document.getElementById("boot-message");
  if (message && document.body.dataset.boot !== "error")
    message.textContent = context?.locale?.startsWith("zh") ? "正在打开编辑器…" : "Opening editor…";
}

export function showBootError(error: unknown) {
  applyHostTheme();
  document.body.dataset.boot = "error";
  const chinese = getClient().locale?.startsWith("zh") !== false;
  const message = document.getElementById("boot-message");
  if (message)
    message.textContent = `${chinese ? "编辑器加载失败" : "Editor failed to load"}：${error instanceof Error ? error.message : String(error)}`;
  const retry = document.getElementById("boot-retry");
  if (retry) {
    retry.hidden = false;
    retry.textContent = chinese ? "重试" : "Retry";
    retry.onclick = () => window.location.reload();
  }
}
