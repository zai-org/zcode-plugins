// 页面与宿主的唯一连接：官方 MCP Apps SDK。
// 事件处理器必须先于 connect() 注册；大 UI 延迟加载期间收到的首个工具结果由本实例保留。
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";
import { EmptyResultSchema } from "@modelcontextprotocol/core";

export function createClient(
  app = new App({ name: "markdown", version: "0.3.5" }, {}, { autoResize: false }),
) {
  let toolInput: Record<string, unknown> | null = null;
  let toolOutput: unknown = null;
  let widgetState: unknown = null;
  let stateWritten = false;
  let connection: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
    window.dispatchEvent(new Event("plugin:change"));
  };
  app.ontoolinput = (input) => {
    toolInput = input.arguments ?? {};
    notify();
  };
  app.ontoolresult = (result) => {
    toolOutput = result.structuredContent ?? null;
    notify();
  };
  app.ontoolcancelled = notify;
  app.onhostcontextchanged = notify;
  const ready = () =>
    (connection ??= app.connect(new PostMessageTransport(window.parent, window.parent)).then(() => {
      if (!stateWritten) widgetState = app.getHostContext()?.["zcode/widgetState"] ?? null;
      notify();
    }));
  const run = <T>(operation: () => Promise<T>): Promise<T> => ready().then(operation);
  return {
    app,
    ready,
    get toolInput() {
      return toolInput;
    },
    get toolOutput() {
      return toolOutput;
    },
    get theme() {
      return app.getHostContext()?.theme ?? null;
    },
    get locale() {
      return app.getHostContext()?.locale ?? null;
    },
    get hostContext() {
      return app.getHostContext() ?? null;
    },
    get widgetState() {
      return widgetState;
    },
    callTool: (name: string, args: Record<string, unknown> = {}) =>
      run(() => app.callServerTool({ name, arguments: args })),
    readResource: (uri: string) => run(() => app.readServerResource({ uri })),
    request: (method: string, params: Record<string, unknown>) =>
      run(() => app.request({ method, params }, EmptyResultSchema)),
    async setWidgetState(state: unknown) {
      await ready();
      if (!app.getHostCapabilities()?.experimental?.["zcode/widgetState"]) return;
      stateWritten = true;
      widgetState = state;
      // 本地状态持久化不是新的工具结果；不能回放旧文档并再次写状态。
      await app.request(
        { method: "ui/set-widget-state", params: { widgetState: state } },
        EmptyResultSchema,
      );
    },
    updateModelContext: (input: Parameters<App["updateModelContext"]>[0]) =>
      run(() => app.updateModelContext(input)).then(() => undefined),
    notifyIntrinsicHeight: (height: number) => {
      void run(() => app.sendSizeChanged({ height })).catch(() => undefined);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type PluginClient = ReturnType<typeof createClient>;
declare global {
  interface Window {
    __pluginClient?: PluginClient;
  }
}
export function getClient(): PluginClient {
  // bootstrap 与延后执行的 UI bundle 共用一个实例，不能重复连接宿主。
  return (window.__pluginClient ??= createClient());
}
