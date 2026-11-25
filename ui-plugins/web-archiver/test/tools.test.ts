import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer as createHttp, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffParagraphs } from "../src/archive.ts";
import { extract } from "../src/extract.ts";
import { findBrowser } from "../src/screenshot.ts";
import { createServer } from "../src/server.ts";

const SAMPLES = process.env.WEB_SAMPLES ?? "/workspace/zcode-new-plugins/samples/web";
const HAVE_SAMPLES = existsSync(join(SAMPLES, "en-wikipedia-web-archiving.html"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
let workspace: string, http: Server, base: string, client: Client;
let version = 1;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;

const para = (n: number) => `<p>这是第 ${n} 段正文，内容足够长，用来让正文提取算法把它认作文章主体。Paragraph ${n} has enough words to look like an article body for the extractor to keep.</p>`;
const article = () => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试文章 - 示例站</title>
<meta property="og:site_name" content="示例站"><meta property="article:published_time" content="2026-11-20T08:00:00Z"><meta name="author" content="佩妮">
<script>window.tracker = 1</script></head><body>
<nav><a href="/">首页</a> <a href="/about">关于</a></nav>
<article><h1>测试文章</h1>
${para(1)}
<figure><img src="/img/a.png" alt="图一"><figcaption>图一说明</figcaption></figure>
${para(2)}
<p><img data-src="/img/lazy.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="懒加载"></p>
${version === 1 ? para(3) : `<p>这是第 3 段正文，内容已经修改，用来让正文提取算法把它认作文章主体。Paragraph 3 was edited and has enough words to look like an article body.</p>`}
<p><img srcset="/img/small.png 320w, /img/big.png 1280w" src="/img/small.png" alt="响应式"></p>
${version === 1 ? para(4) : ""}
${para(5)}
${version === 2 ? para(6) : ""}
<p>链接：<a href="/other?x=1&amp;y=2">相对链接</a> <a href="javascript:alert(1)">坏链接</a> <img src="/img/missing.png" alt="丢失"></p>
<table><tr><th>项目</th><th>数量</th></tr><tr><td>苹果</td><td>3</td></tr></table>
</article><footer>版权所有</footer></body></html>`;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "webarch-"));
  http = createHttp((req, res) => {
    const u = new URL(req.url!, "http://x");
    if (u.pathname === "/post/hello-world.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(article()); return; }
    if (u.pathname === "/moved") { res.writeHead(301, { location: "/post/hello-world.html" }); res.end(); return; }
    if (u.pathname.startsWith("/img/") && !u.pathname.includes("missing")) { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
    if (u.pathname === "/gbk") {
      const body = Buffer.from("3c68746d6c3e3c686561643e3c6d65746120636861727365743d2267626b223e3c7469746c653ec4e3bac33c2f7469746c653e3c2f686561643e3c626f64793e3c703ec4e3bac3cac0bde7a3acd5e2cac7d2bbb6ced3c32047424b20b1e0c2ebb5c4cec4d7d6a1a33c2f703e3c2f626f64793e3c2f68746d6c3e", "hex");
      res.writeHead(200, { "content-type": "text/html" }); res.end(body); return;
    }
    if (u.pathname === "/file.pdf") { res.writeHead(200, { "content-type": "application/pdf" }); res.end("%PDF-1.4"); return; }
    if (u.pathname.startsWith("/real/") && HAVE_SAMPLES) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(readFileSync(join(SAMPLES, decodeURIComponent(u.pathname.slice(6))))); return; }
    res.writeHead(404, { "content-type": "text/html" }); res.end("<h1>Not found</h1>");
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});
afterAll(() => http?.close());

describe("extract", () => {
  it("keeps the article, drops navigation and scripts, resolves lazy and responsive images", () => {
    const a = extract(article(), "https://example.com/post/hello-world.html");
    expect(a).toMatchObject({ title: "测试文章", byline: "佩妮", siteName: "示例站", published: "2026-11-20T08:00:00Z", lang: "zh-CN" });
    expect(a.images.map((i) => i.src)).toEqual(["https://example.com/img/a.png", "https://example.com/img/lazy.png", "https://example.com/img/big.png", "https://example.com/img/missing.png"]);
    expect(a.html).not.toMatch(/首页|tracker|javascript:|版权所有/);
    expect(a.html).toMatch(/href="https:\/\/example\.com\/other\?x=1&(amp;)?y=2"/);
    expect(a.paragraphs.slice(0, 2)).toEqual(["测试文章", expect.stringMatching(/^这是第 1 段正文/)]);
    expect(a.paragraphs).toContain("苹果");
  });
  it("diffs paragraphs and pairs edits", () => {
    const d = diffParagraphs(["a b c", "keep", "old line here", "gone"], ["a b c", "keep", "new line here", "added"]);
    expect([d.added, d.removed, d.changed]).toEqual([0, 0, 2]);
    expect(d.rows[2].html).toBe("<del>old</del><ins>new</ins> line here");
    const zh = diffParagraphs(["第一段", "价格是 100 元"], ["第一段", "价格是 120 元", "新增"]);
    expect([zh.added, zh.removed, zh.changed]).toEqual([1, 0, 1]);
    expect(zh.rows[1].html).toBe("价格是 1<ins>2</ins>0<del>0</del> 元");
  });
});

describe("tools", () => {
  it("captures a page: offline single file, Markdown with local images, source, metadata and index", async () => {
    const r = await call("archive_capture", { urls: [`${base}/moved`, `${base}/nope`, `${base}/file.pdf`, "file:///etc/passwd"] });
    expect(r.isError).toBeFalsy();
    const res = r.structuredContent.results;
    expect(res.map((x: any) => x.ok)).toEqual([true, false, false, false]);
    expect(res[1].error).toContain("HTTP 404");
    expect(res[2].error).toContain("application/pdf, not a web page");
    expect(res[3].error).toContain("Only http(s)");
    const c = res[0].capture;
    expect(c.dir).toMatch(/^web-archive\/127\.0\.0\.1\/hello-world\/\d{8}-\d{6}Z$/);
    expect(res[0].capture.title).toBe("测试文章");
    expect(c.finalUrl).toBe(`${base}/post/hello-world.html`);
    expect([c.images, c.imagesFailed]).toEqual([3, 1]);
    const dir = join(workspace, c.dir);
    const html = await readFile(join(dir, "article.html"), "utf8");
    expect(html).toContain(`Source: <a href="${base}/post/hello-world.html">`);
    expect(html.match(/src="data:image\/png;base64,/g)?.length).toBe(3);
    expect(html).toContain(`src="${base}/img/missing.png"`);
    const md = await readFile(join(dir, "article.md"), "utf8");
    expect(md).toMatch(/^---\ntitle: "测试文章"\nsource: "http:\/\/127\.0\.0\.1:\d+\/post\/hello-world\.html"\ncaptured: "[\d-]+T[\d:.]+Z"\nauthor: "佩妮"/);
    expect(md).toContain("![图一](assets/001.png)");
    expect(md).toContain("| 项目 | 数量 |");
    expect(await readFile(join(dir, "assets/003.png"))).toEqual(PNG);
    expect((await readFile(join(dir, "source.html"), "utf8"))).toContain("window.tracker");
    const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    expect(meta).toMatchObject({ title: "测试文章", site: "示例站", images: { saved: 3, failed: 1 }, change: null });
    expect(await readFile(join(workspace, "web-archive/index.md"), "utf8")).toContain("| first |");
    expect(r.content[0].text).toContain("first capture");
  });

  it("re-captures, compares the text and writes changes.html", async () => {
    version = 2;
    const r = await call("archive_capture", { urls: [`${base}/post/hello-world.html`], images: false });
    const c = r.structuredContent.results[0].capture;
    expect(c.change).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: false });
    const changes = await readFile(join(workspace, c.dir, "changes.html"), "utf8");
    expect(changes).toContain('<p class="add">这是第 6 段正文');
    expect(changes).toContain('<p class="del">这是第 4 段正文');
    expect(changes).toMatch(/<p class="mod">.*<ins>.*已经修改/);
    const list = await call("archive_list", {});
    expect(list.structuredContent.entries[0].captures.length).toBe(2);
    expect(list.content[0].text).toContain("+1 −1 ~1 paragraph(s)");
    const d = await call("archive_diff", { url: `${base}/post/hello-world.html` });
    expect(d.content[0].text).toMatch(/\+ 这是第 6 段正文/);
    const again = await call("archive_capture", { urls: [`${base}/post/hello-world.html`], images: false });
    expect(again.content[0].text).toContain("text unchanged");
    const read = await call("archive_read", { dir: c.dir, maxChars: 500 });
    expect(read.content[0].text).toMatch(/^---\ntitle: "测试文章"/);
    expect(read.content[0].text).toContain("more characters in");
  });

  it("decodes GBK pages", async () => {
    const r = await call("archive_capture", { urls: [`${base}/gbk`] });
    const c = r.structuredContent.results[0].capture;
    expect(c.title).toBe("你好");
    expect(await readFile(join(workspace, c.dir, "article.md"), "utf8")).toContain("你好世界，这是一段用 GBK 编码的文字。");
  });

  it.skipIf(!existsSync("/usr/bin/google-chrome"))("takes a screenshot with the local browser", async () => {
    expect(await findBrowser()).toBeTruthy();
    const r = await call("archive_capture", { urls: [`${base}/post/hello-world.html`], images: false, screenshot: true });
    const c = r.structuredContent.results[0].capture;
    expect(c.screenshot).toBe(true);
    const png = await readFile(join(workspace, c.dir, "screenshot.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1280);
  }, 90_000);

  it.skipIf(!HAVE_SAMPLES)("extracts real pages (Wikipedia EN/ZH, GitHub blog, W3C, 阮一峰周刊)", async () => {
    const cases: [string, string, RegExp, RegExp][] = [
      ["en-wikipedia-web-archiving.html", "Web archiving", /^Web archiving is the process of collecting/, /Wayback Machine/],
      ["zh-wikipedia-internet-archive.html", "互联网档案馆", /./, /互联网档案馆.{0,40}(是|为).{0,60}非营利/],
      ["github-blog-availability-2025-05.html", "GitHub Availability Report: May 2025", /^In May, we experienced three incidents/, /Issues service/],
      ["w3c-wcag21.html", "Web Content Accessibility Guidelines (WCAG) 2.1", /^Web Content Accessibility Guidelines \(WCAG\) 2\.1 covers/, /success criteria/],
      ["ruanyifeng-weekly-285.html", "科技爱好者周刊（第 285 期）：为什么 PPT 不如备忘录", /^本杂志开源，欢迎投稿/, /备忘录/],
    ];
    for (const [file, title, first, body] of cases) {
      const r = await call("archive_capture", { urls: [`${base}/real/${file}`], images: false });
      const res = r.structuredContent.results[0];
      expect([file, res.ok, res.capture.title]).toEqual([file, true, title]);
      const text = JSON.parse(await readFile(join(workspace, res.capture.dir, "text.json"), "utf8")) as string[];
      expect(text.find((p) => p.length > 30)).toMatch(first);
      expect(text.join("\n")).toMatch(body);
      const md = await readFile(join(workspace, res.capture.dir, "article.md"), "utf8");
      expect(md).not.toMatch(/<script|mw-parser-output|cookie banner/i);
    }
    const rf = JSON.parse(await readFile(join(workspace, (await call("archive_list", { query: "285" })).structuredContent.entries[0].captures[0].dir, "meta.json"), "utf8"));
    expect(rf.byline).toBe("阮一峰");
  });

  it("explains bad input", async () => {
    expect((await call("archive_read", { dir: "web-archive/nope" })).content[0].text).toContain("No capture at");
    expect((await call("archive_diff", { url: `${base}/gbk` })).content[0].text).toContain("only one capture");
    expect((await call("archive_diff", { url: "https://never.example/" })).content[0].text).toContain("has not been captured");
  });
});
