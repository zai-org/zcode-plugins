import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 本机 Chrome / Edge / Chromium（找不到就不截图）。 */
export const BROWSER_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];

export async function findBrowser(configured?: string): Promise<string | undefined> {
  const list = configured?.trim() && !configured.includes("${") ? [configured.trim(), ...BROWSER_CANDIDATES] : BROWSER_CANDIDATES;
  for (const p of list) {
    try {
      if ((await stat(p)).isFile()) return p;
    } catch {
      // 下一个
    }
  }
  return undefined;
}

/** 极简的 CDP 客户端（--remote-debugging-pipe：fd 3 写、fd 4 读，消息以 \0 结尾）。 */
class Pipe {
  private id = 0;
  private buf = "";
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: ((m: any) => void)[] = [];
  private write: NodeJS.WritableStream;
  constructor(write: NodeJS.WritableStream, read: NodeJS.ReadableStream) {
    this.write = write;
    read.setEncoding?.("utf8");
    read.on("data", (chunk: string) => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        } else for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = ++this.id;
    this.write.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method: string, sessionId: string, timeoutMs: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const l = (m: any) => { if (m.method === method && m.sessionId === sessionId) done(); };
      this.listeners.push(l);
      function done() { clearTimeout(timer); resolve(); }
    });
  }
}

/** 用无头浏览器截整页（宽 1280，最高 12000 像素）；临时用户目录，不碰用户自己的浏览器配置。 */
export async function screenshot(browser: string, url: string, out: string, timeoutMs = 60_000): Promise<boolean> {
  const profile = await mkdtemp(join(tmpdir(), "web-archiver-"));
  const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"];
  if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
  const child = spawn(browser, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const cdp = new Pipe(child.stdio[3] as NodeJS.WritableStream, child.stdio[4] as NodeJS.ReadableStream);
    const exited = new Promise<never>((_, reject) => child.on("exit", () => reject(new Error("browser exited"))));
    const run = async () => {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      const loaded = cdp.once("Page.loadEventFired", sessionId, 30_000);
      await cdp.send("Page.navigate", { url }, sessionId);
      await loaded;
      await new Promise((r) => setTimeout(r, 1200));
      const m = await cdp.send("Page.getLayoutMetrics", {}, sessionId);
      const height = Math.min(12000, Math.max(900, Math.ceil(m.cssContentSize?.height ?? m.contentSize?.height ?? 900)));
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      await new Promise((r) => setTimeout(r, 300));
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
      await writeFile(out, Buffer.from(shot.data, "base64"));
      await cdp.send("Browser.close").catch(() => undefined);
    };
    await Promise.race([run(), exited]);
    return (await stat(out)).size > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(killer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}
