import { App } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/core";
import { PLUGIN_NAME, PLUGIN_VERSION, type TypstErrorCode } from "#t/contract.ts";

/** 页面侧的工具错误；code 与 server 的 TypstErrorCode 一致。 */
export class ToolError extends Error {
  constructor(
    readonly code: TypstErrorCode | "host_error",
    message: string,
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
  toolResultListeners.forEach((listener) => listener(result.structuredContent as Record<string, unknown> | undefined));
app.setNotificationHandler("notifications/resources/updated", (notification) => {
  const uri = notification.params.uri;
  resourceListeners.forEach((listener) => listener(uri));
});

let connection: Promise<void> | undefined;
const ready = () => (connection ??= app.connect().then(() => hostListeners.forEach((listener) => listener())));

/** 重启 typst、切换主文件可能要等第一次编译。 */
const CALL_TIMEOUT_MS = 120_000;

async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  await ready();
  let result;
  try {
    result = await app.callServerTool({ name, arguments: args }, { timeout: CALL_TIMEOUT_MS });
  } catch (error) {
    throw new ToolError("host_error", error instanceof Error ? error.message : String(error));
  }
  const content = result.structuredContent as Record<string, unknown> | undefined;
  const error = content?.error as { code?: TypstErrorCode; message?: string } | undefined;
  if (result.isError || error) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new ToolError(error?.code ?? "typst_error", error?.message ?? text ?? "The tool failed.");
  }
  return (content ?? {}) as T;
}

async function readText(uri: string): Promise<string> {
  await ready();
  const result = await app.readServerResource({ uri });
  const first = result.contents[0] as { text?: string } | undefined;
  if (typeof first?.text !== "string") throw new ToolError("host_error", `Empty resource ${uri}`);
  return first.text;
}

async function readJson<T>(uri: string): Promise<T> {
  const text = await readText(uri);
  // 资源读取失败时宿主可能把错误文本放进 text。
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ToolError("host_error", text.slice(0, 300));
  }
}

async function readBlob(uri: string): Promise<Uint8Array> {
  await ready();
  const result = await app.readServerResource({ uri });
  const first = result.contents[0] as { blob?: string; text?: string } | undefined;
  if (typeof first?.blob !== "string") throw new ToolError("host_error", first?.text?.slice(0, 300) ?? `Empty resource ${uri}`);
  const binary = atob(first.blob);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
  readBlob,
  call,
  get widgetState(): unknown {
    const context = app.getHostContext() as Record<string, unknown> | undefined;
    return context?.["zcode/widgetState"] ?? null;
  },
  async setWidgetState(state: unknown) {
    await ready();
    if (!capabilities()?.experimental?.["zcode/widgetState"]) return;
    await app.request({ method: "ui/set-widget-state", params: { widgetState: state } }, EmptyResultSchema).catch(() => undefined);
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
