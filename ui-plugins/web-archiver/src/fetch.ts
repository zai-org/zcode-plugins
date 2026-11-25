import { KitError } from "./kit/workspace.ts";

export const USER_AGENT = "Mozilla/5.0 (compatible; ZCode-WebArchiver/0.1; +https://github.com/ppppp2005-p)";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new KitError("bad_url", `Not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new KitError("bad_url", `Only http(s) URLs: ${raw}`);
  url.hash = "";
  return url;
}

export interface Fetched { url: string; status: number; type: string; body: Uint8Array }

/** 抓取一个地址：限时、限大小，跟随跳转。 */
export async function fetchBytes(url: string, opts: { timeoutMs?: number; maxBytes?: number; accept?: string; referer?: string; browserUa?: boolean } = {}): Promise<Fetched> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "user-agent": opts.browserUa ? BROWSER_UA : USER_AGENT, accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "zh-CN,zh;q=0.9,en;q=0.8", ...(opts.referer ? { referer: opts.referer } : {}) },
    });
    const final = checkUrl(res.url || url).href;
    const max = opts.maxBytes ?? 15 * 1024 * 1024;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > max) throw new KitError("too_large", `${url} is ${Math.round(len / 1048576)} MB`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) { await reader.cancel(); throw new KitError("too_large", `${url} is larger than ${Math.round(max / 1048576)} MB`); }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { body.set(c, o); o += c.length; }
    return { url: final, status: res.status, type: (res.headers.get("content-type") ?? "").toLowerCase(), body };
  } catch (error) {
    if (error instanceof KitError) throw error;
    const e = error as Error & { cause?: { code?: string; message?: string } };
    throw new KitError(e.name === "AbortError" ? "timeout" : "fetch_failed", `${url}: ${e.name === "AbortError" ? "timed out" : e.cause?.code ?? e.cause?.message ?? e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 按 HTTP 头、BOM、<meta charset> 的顺序判断编码。 */
export function decodeHtml(body: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  let label = fromHeader;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) label = "utf-8";
  if (!label) {
    const head = new TextDecoder("latin1").decode(body.subarray(0, 4096));
    label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(label ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}
