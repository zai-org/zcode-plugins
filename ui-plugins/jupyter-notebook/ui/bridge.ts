import { App } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { PLUGIN_NAME, PLUGIN_VERSION, type JupyterErrorCode } from "#nb/contract.ts";

/** 页面侧的工具错误；code 与 server 的 JupyterErrorCode 一致。 */
export class ToolError extends Error {
  constructor(
    readonly code: JupyterErrorCode | "host_error",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

const app = new App(
  { name: PLUGIN_NAME, version: PLUGIN_VERSION },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

type Listener<T> = (value: T) => void;
const hostListeners = new Set<Listener<void>>();
const toolResultListeners = new Set<Listener<Record<string, unknown> | undefined>>();
const resourceListeners = new Set<Listener<string>>();

// 先注册处理器再连接，避免初始化期间的主题、工具结果或资源通知丢失。
app.onhostcontextchanged = () => hostListeners.forEach((listener) => listener());
app.ontoolresult = (result) =>
  toolResultListeners.forEach((listener) =>
    listener(result.structuredContent as Record<string, unknown> | undefined),
  );
app.setNotificationHandler("notifications/resources/updated", (notification) => {
  const uri = notification.params.uri;
  resourceListeners.forEach((listener) => listener(uri));
});

let connection: Promise<void> | undefined;
const ready = () =>
  (connection ??= app.connect().then(() => hostListeners.forEach((listener) => listener())));

/** 页面调用 server 的超时：工具本身都很快返回（执行用 wait=false），start_server 例外。 */
const CALL_TIMEOUT_MS = 240_000;

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await ready();
  let result;
  try {
    result = await app.callServerTool({ name, arguments: args }, { timeout: CALL_TIMEOUT_MS });
  } catch (error) {
    throw new ToolError("host_error", error instanceof Error ? error.message : String(error));
  }
  const content = result.structuredContent as Record<string, unknown> | undefined;
  const error = content?.error as { code?: JupyterErrorCode; message?: string; details?: Record<string, unknown> } | undefined;
  if (result.isError || error) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new ToolError(error?.code ?? "jupyter_error", error?.message ?? text ?? "The tool failed.", error?.details);
  }
  return (content ?? {}) as T;
}

async function readJson<T>(uri: string): Promise<T> {
  await ready();
  const result = await app.readServerResource({ uri });
  const first = result.contents[0] as { text?: string } | undefined;
  if (!first?.text) throw new ToolError("host_error", `Empty resource ${uri}`);
  return JSON.parse(first.text) as T;
}

const capabilities = () => app.getHostCapabilities();

export const host = {
  ready,
  get context() {
    return app.getHostContext();
  },
  onContextChange(listener: () => void) {
    hostListeners.add(listener);
    return () => hostListeners.delete(listener);
  },
  onToolResult(listener: Listener<Record<string, unknown> | undefined>) {
    toolResultListeners.add(listener);
    return () => toolResultListeners.delete(listener);
  },
  onResourceUpdated(listener: Listener<string>) {
    resourceListeners.add(listener);
    return () => resourceListeners.delete(listener);
  },
  get canSubscribe() {
    return !!capabilities()?.experimental?.["zcode/resourceSubscribe"];
  },
  get canMessage() {
    return !!capabilities()?.message;
  },
  get canUpdateContext() {
    return !!capabilities()?.updateModelContext;
  },
  async subscribe(uri: string) {
    await ready();
    await app.request({ method: "resources/subscribe", params: { uri } }, EmptyResultSchema);
  },
  async unsubscribe(uri: string) {
    await ready();
    await app.request({ method: "resources/unsubscribe", params: { uri } }, EmptyResultSchema).catch(() => undefined);
  },
  readJson,
  call,
  get widgetState(): unknown {
    const context = app.getHostContext() as Record<string, unknown> | undefined;
    return context?.["zcode/widgetState"] ?? null;
  },
  async setWidgetState(state: unknown) {
    await ready();
    if (!capabilities()?.experimental?.["zcode/widgetState"]) return;
    await app
      .request({ method: "ui/set-widget-state", params: { widgetState: state } }, EmptyResultSchema)
      .catch(() => undefined);
  },
  async sendMessage(text: string) {
    await ready();
    const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    if (result.isError) throw new ToolError("host_error", "The host did not send the message.");
  },
  async updateModelContext(text: string, structured: Record<string, unknown>) {
    await ready();
    await app.updateModelContext({ content: [{ type: "text", text }], structuredContent: structured });
  },
  async openLink(url: string) {
    await ready();
    await app.openLink({ url }).catch(() => undefined);
  },
  async requestFullscreen() {
    await ready();
    await app.requestDisplayMode({ mode: "fullscreen" }).catch(() => undefined);
  },
};
