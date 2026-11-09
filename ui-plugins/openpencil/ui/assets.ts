import { assetBlob, assetText } from "#ui/host.ts";

/**
 * 沙箱里没有静态文件服务（协议只回 index.html），而 CanvasKit 的 Emscripten 胶水与上游的
 * 内置字体表都按绝对路径 fetch（`/canvaskit.wasm`、`/Inter-Regular.ttf`）。这里拦截这些
 * 已知路径，从宿主 readResource 取字节后合成 Response；不经过网络，也就不受 CSP connect-src 约束。
 */
const VIRTUAL_FILES: Record<string, { asset: string; type: string }> = {
  "/canvaskit.wasm": { asset: "canvaskit.wasm", type: "application/wasm" },
};
for (const font of [
  "Inter-Regular",
  "Inter-Medium",
  "Inter-SemiBold",
  "Inter-Bold",
  "Inter-ExtraBold",
  "NotoNaskhArabic-Regular",
])
  VIRTUAL_FILES[`/${font}.ttf`] = { asset: `${font}.ttf`, type: "font/ttf" };

const cache = new Map<string, Promise<ArrayBuffer>>();
function pathOf(input: RequestInfo | URL): string | null {
  try {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    return url.origin === location.origin ? url.pathname : null;
  } catch {
    return null;
  }
}
export function installFetchShim() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path = pathOf(input);
    const file = path ? VIRTUAL_FILES[path] : undefined;
    if (!file) return nativeFetch(input, init);
    let pending = cache.get(path!);
    if (!pending) {
      pending = assetBlob(file.asset).then(
        (bytes) =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
      cache.set(path!, pending);
    }
    const buffer = await pending;
    return new Response(buffer.slice(0), {
      status: 200,
      headers: { "content-type": file.type, "content-length": String(buffer.byteLength) },
    });
  };
}

/**
 * 上游 core 用 `new Worker(new URL("./export-worker.ts", import.meta.url))` 起 .fig 解析/压缩 worker；
 * 面板是单个内联 module，import.meta.url 指向文档，相对路径解析不到脚本（解析有主线程回退，导出没有）。
 * 构建期把两个 worker 单独打包成资源，这里把 Worker 构造拦下来换成 blob: 脚本（CSP script-src 放行 blob:）。
 */
const WORKER_ASSETS: Array<{ pattern: RegExp; asset: string }> = [
  { pattern: /export-worker/, asset: "worker-fig-export.js" },
  { pattern: /parse\/worker/, asset: "worker-fig-parse.js" },
];
export async function installWorkerShim() {
  const sources = new Map<string, string>();
  await Promise.all(
    WORKER_ASSETS.map(async ({ asset }) => {
      sources.set(
        asset,
        URL.createObjectURL(new Blob([await assetText(asset)], { type: "text/javascript" })),
      );
    }),
  );
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const text = String(url);
      const match = WORKER_ASSETS.find(({ pattern }) => pattern.test(text));
      super(match ? sources.get(match.asset)! : url, options);
    }
  } as typeof Worker;
}
