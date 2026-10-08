// Vditor 离线适配：把它的三种懒加载机制转发到插件 MCP 资源（readServerResource）。
// 沙箱 connect-src 'none'、无外网；宿主 CSP 允许 inline 脚本/样式、blob: 脚本、data: 字体。
// 三层拦截（对应 vditor 的 addScript / addScriptSync+XHR / addStyle）：
// 1. 动态 <script src>：拦截实例 src 赋值 → 资源取回 → blob: URL（onload/onerror 语义不变）
// 2. XMLHttpRequest：同步请求仅限预载缓存；异步请求走资源
// 3. <link href> 样式：取回文本后插 <style>（style-src 无 blob:）
import { getClient } from "./client.ts";

const VIRTUAL_PREFIX = "/__vditor__/";
const RESOURCE_PREFIX = "ui://markdown/assets/vditor/";

declare global {
  interface Window {
    /** bootstrap 在注入主 bundle 前等待的预载完成信号。 */
    __mdVditorReady?: Promise<void>;
  }
}

const cache = new Map<string, Promise<{ text: string; mimeType?: string }>>();
const syncCache = new Map<string, string>();
const styleLoads: Promise<void>[] = [];
export async function waitForEditorStyles() {
  await Promise.all(styleLoads);
}

function resourceUri(path: string) {
  // vditor 的 cdn 选项后拼 /dist/...，剥掉后映射到打包进插件的 vditor 资产。
  const clean = path
    .slice(VIRTUAL_PREFIX.length)
    .split("?")[0]
    .replace(/^dist\//, "");
  return `${RESOURCE_PREFIX}${clean}`;
}

function loadVirtual(path: string) {
  const key = path.slice(VIRTUAL_PREFIX.length).split("?")[0];
  if (!cache.has(key)) {
    cache.set(
      key,
      getClient()
        .readResource(resourceUri(path))
        .then((response) => {
          const entry = (response.contents ?? [])[0];
          if (!entry || !("text" in entry) || typeof entry.text !== "string")
            throw new Error(`vditor asset missing: ${key}`);
          return { text: entry.text, mimeType: entry.mimeType };
        }),
    );
  }
  return cache.get(key)!;
}

// 同步 XHR（图标包、第三方高亮语言）必须在 vditor 初始化前预载完成。
const SYNC_PRELOAD = [
  "/__vditor__/dist/js/icons/ant.js",
  "/__vditor__/dist/js/highlight.js/third-languages.js",
];
window.__mdVditorReady = Promise.all(
  SYNC_PRELOAD.map(async (path) => {
    try {
      syncCache.set(path, (await loadVirtual(path)).text);
    } catch {
      // 资源缺失时对应的同步加载会明确报错，不阻塞其余预载。
    }
  }),
).then(() => undefined);

const OriginalXHR = window.XMLHttpRequest;
class ShimXHR {
  private virtual: { url: string; async: boolean } | null = null;
  private real: XMLHttpRequest | null = null;
  readyState = 0;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open(method: string, url: string, async = true) {
    if (typeof url === "string" && url.startsWith(VIRTUAL_PREFIX)) {
      this.virtual = { url, async };
      return;
    }
    this.real = new OriginalXHR();
    this.real.open(method, url, async);
  }
  setRequestHeader(name: string, value: string) {
    this.real?.setRequestHeader(name, value);
  }
  send() {
    if (!this.virtual) {
      this.real?.send();
      return;
    }
    const { url, async } = this.virtual;
    const preloaded = syncCache.get(url);
    if (!async) {
      if (preloaded === undefined) throw new Error(`sync XHR not preloaded: ${url}`);
      this.readyState = 4;
      this.status = 200;
      this.responseText = preloaded;
      return;
    }
    loadVirtual(url)
      .then((content) => {
        this.readyState = 4;
        this.status = 200;
        this.responseText = content.text;
        this.onload?.();
      })
      .catch(() => this.onerror?.());
  }
}
window.XMLHttpRequest = ShimXHR as unknown as typeof XMLHttpRequest;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (typeof url === "string" && url.startsWith(VIRTUAL_PREFIX)) {
    const content = await loadVirtual(url);
    return new Response(content.text, {
      headers: { "content-type": content.mimeType ?? "text/plain" },
    });
  }
  return originalFetch(input, init);
};

const originalCreateElement = document.createElement.bind(document);
const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src")!;
const linkHref = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href")!;

function interceptSrc(element: HTMLScriptElement) {
  let virtual: string | null = null;
  Object.defineProperty(element, "src", {
    get() {
      return virtual ?? scriptSrc.get!.call(element);
    },
    set(value: string) {
      if (typeof value === "string" && value.startsWith(VIRTUAL_PREFIX)) {
        virtual = value;
        loadVirtual(value)
          .then(async (content) => {
            const blob = new Blob([content.text], { type: "text/javascript" });
            virtual = null;
            scriptSrc.set!.call(element, URL.createObjectURL(blob));
          })
          .catch(() => {
            virtual = null;
            element.dispatchEvent(new ErrorEvent("error"));
          });
        return;
      }
      virtual = null;
      scriptSrc.set!.call(element, value);
    },
    configurable: true,
  });
}

function interceptHref(element: HTMLLinkElement) {
  let virtual: string | null = null;
  Object.defineProperty(element, "href", {
    get() {
      return virtual ?? linkHref.get!.call(element);
    },
    set(value: string) {
      if (typeof value === "string" && value.startsWith(VIRTUAL_PREFIX)) {
        virtual = value;
        const loaded = loadVirtual(value).then((content) => {
          const style = originalCreateElement("style");
          style.textContent = content.text;
          document.head.append(style);
          // 不给原 link 挂真实 href：vditor 靠 href 属性比对主题，getter 保留虚拟值。
        });
        // 保留拒绝状态给启动流程，同时避免初始化完成前的未处理拒绝。
        void loaded.catch(() => undefined);
        styleLoads.push(loaded);
        return;
      }
      virtual = null;
      linkHref.set!.call(element, value);
    },
    configurable: true,
  });
}

document.createElement = ((tag: string, options?: ElementCreationOptions) => {
  const element = originalCreateElement(tag, options);
  if (typeof tag === "string") {
    const lower = tag.toLowerCase();
    if (lower === "script") interceptSrc(element as HTMLScriptElement);
    if (lower === "link") interceptHref(element as HTMLLinkElement);
  }
  return element;
}) as typeof document.createElement;
