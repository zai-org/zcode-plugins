import { App } from "@modelcontextprotocol/ext-apps";

export class ToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

let app: App | undefined;
let connection: Promise<void> | undefined;
let created!: () => void;
const appCreated = new Promise<void>((resolve) => (created = resolve));
const resultListeners = new Set<(value: Record<string, unknown> | undefined, tool?: string) => void>();
const contextListeners = new Set<() => void>();

export function initHost(name: string, version: string) {
  app = new App({ name, version }, { availableDisplayModes: ["inline", "fullscreen"] });
  app.ontoolresult = (result) => {
    const content = result.structuredContent as Record<string, unknown> | undefined;
    resultListeners.forEach((listener) => listener(content));
  };
  app.onhostcontextchanged = () => contextListeners.forEach((listener) => listener());
  created();
  return ready();
}

export function ready(): Promise<void> {
  if (!app) return appCreated.then(() => ready());
  return (connection ??= app.connect().then(() => contextListeners.forEach((listener) => listener())));
}

export function onToolResult(listener: (value: Record<string, unknown> | undefined) => void) {
  resultListeners.add(listener);
}

export function onHostContext(listener: () => void) {
  contextListeners.add(listener);
}

export function hostContext() {
  return app?.getHostContext();
}

export function locale(): "zh" | "en" {
  const fromHost = (app?.getHostContext()?.locale as string | undefined) ?? navigator.language ?? "en";
  return /^zh/i.test(fromHost) ? "zh" : "en";
}

export async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}, timeout = 300_000): Promise<T> {
  await ready();
  let result;
  try {
    result = await app!.callServerTool({ name, arguments: args }, { timeout });
  } catch (error) {
    throw new ToolError("host_error", error instanceof Error ? error.message : String(error));
  }
  const content = result.structuredContent as Record<string, unknown> | undefined;
  const error = content?.error as { code?: string; message?: string } | undefined;
  if (result.isError || error) {
    const text = (result.content?.[0] as { text?: string } | undefined)?.text;
    throw new ToolError(error?.code ?? "tool_error", error?.message ?? text ?? "The tool failed.");
  }
  return (content ?? {}) as T;
}

/** 读取插件资源（二进制）。 */
export async function readBlob(uri: string): Promise<Uint8Array> {
  await ready();
  const result = await app!.readServerResource({ uri });
  const first = result.contents[0] as { blob?: string; text?: string } | undefined;
  if (typeof first?.blob !== "string") throw new ToolError("host_error", first?.text?.slice(0, 300) ?? `Empty resource ${uri}`);
  return base64ToBytes(first.blob);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 由用户点击触发：把一句话发到对话里交给 Agent。 */
export async function sendMessage(text: string) {
  await ready();
  return app!.sendMessage({ role: "user", content: [{ type: "text", text }] });
}

export async function updateContext(text: string) {
  await ready();
  return app!.updateModelContext({ content: [{ type: "text", text }] });
}

type Child = Node | string | number | null | undefined | false;
/** 极简 DOM 构建器。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "class") element.className = String(value);
    else if (key === "style" && typeof value === "object") Object.assign(element.style, value);
    else if (key in element && typeof value !== "string") (element as any)[key] = value;
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function toast(message: string, kind: "ok" | "error" = "ok") {
  const node = h("div", { class: `toast ${kind}`, role: "status" }, message);
  document.body.append(node);
  setTimeout(() => node.remove(), kind === "error" ? 6000 : 3000);
}

/** 主题：跟随宿主的浅色 / 深色。 */
export function applyTheme() {
  const theme = (app?.getHostContext()?.theme as string | undefined) ?? "light";
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

/** replaceChildren，跳过 null / false。 */
export function put(element: Element, ...children: (Node | string | null | undefined | false)[]) {
  element.replaceChildren(...(children.filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]));
}
