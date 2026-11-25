import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import MiniSearch from "minisearch";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveRef } from "../src/pack.ts";
import { createServer } from "../src/server.ts";

// 虚构的 “Lumen Lamp — Docs” 产品文档站（samples/site/make-site.mjs 生成），带服务器式链接和预置问题。
const MAKE = process.env.SITE_SAMPLE ?? "/workspace/zcode-new-plugins/samples/site/make-site.mjs";
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), "osp-"));
  execFileSync(process.execPath, [MAKE, join(ws, "lumen/public")]);
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("resolveRef", () => {
  const files = new Set(["index.html", "guide/index.html", "guide/install.html", "css/a.css", "img/x y.png"]);
  const r = (from: string, href: string, base?: string) => resolveRef(files, from, href, base ? new URL(base) : undefined);
  it("maps server-style URLs to files", () => {
    expect(r("index.html", "/guide/")).toEqual({ type: "internal", target: "guide/index.html", hash: "" });
    expect(r("index.html", "/guide")).toEqual({ type: "internal", target: "guide/index.html", hash: "" });
    expect(r("guide/index.html", "install#unbox")).toEqual({ type: "internal", target: "guide/install.html", hash: "#unbox" });
    expect(r("guide/install.html", "../css/a.css?v=3")).toEqual({ type: "internal", target: "css/a.css", hash: "" });
    expect(r("index.html", "img/x%20y.png").type).toBe("internal");
    expect(r("guide/index.html", "/")).toEqual({ type: "internal", target: "index.html", hash: "" });
    expect(r("index.html", "https://docs.x.com/guide/install", "https://docs.x.com/")).toMatchObject({ type: "internal", target: "guide/install.html" });
    expect(r("index.html", "https://docs.x.com/help/guide/", "https://docs.x.com/help/")).toMatchObject({ type: "internal", target: "guide/index.html" });
    expect(r("index.html", "//cdn.x.com/a.js")).toEqual({ type: "external", href: "https://cdn.x.com/a.js" });
    expect(r("index.html", "/nope")).toEqual({ type: "broken", path: "/nope" });
    expect(r("index.html", "../../etc/passwd").type).toBe("broken");
    for (const s of ["#top", "mailto:a@b.c", "tel:1", "javascript:void 0", "data:image/png;base64,AA", ""]) expect(r("index.html", s).type).toBe("skip");
  });
});

describe("pack the Lumen docs", () => {
  it("checks without writing", async () => {
    const c = await call("site_check", { dir: "lumen/public" });
    expect(c.structuredContent.wrote).toBe(false);
    expect(c.structuredContent.report.pages).toHaveLength(7);
    expect(await readdir(join(ws, "lumen"))).toEqual(["public"]);
  });
  it("rewrites links, reports problems, adds search and zips", async () => {
    const p = await call("site_pack", { dir: "lumen/public", baseUrl: "https://docs.lumen-example.com" });
    expect(p.isError).toBeFalsy();
    const r = p.structuredContent.report;
    expect(r.output).toBe("lumen-offline");
    expect(r.pages.map((x: any) => x.path).sort()).toEqual(["faq/index.html", "guide/index.html", "guide/install.html", "guide/pairing.html", "guide/scenes/index.html", "index.html", "troubleshooting/index.html"]);
    expect(r.broken).toEqual([{ from: "guide/pairing.html", href: "/guide/firmware", kind: "page" }, { from: "guide/scenes/index.html", href: "/img/missing-diagram.png", kind: "asset" }]);
    expect(r.external.map((e: any) => e.href)).toEqual(["https://github.com/lumen-example/firmware", "https://lumen-example.com/warranty-terms", "https://shop.lumen-example.com/"]);
    expect(r.external[2].from).toHaveLength(7);
    expect(r.orphans).toEqual(["old/press-kit.html"]);
    expect(r.unused).toEqual(["img/unused-draft.png"]);
    const out = (f: string) => readFile(join(ws, "lumen-offline", f), "utf8");
    const scenes = await out("guide/scenes/index.html");
    expect(scenes).toContain('href="../../css/site.css"');
    expect(scenes).toContain('<a href="../../faq/index.html">FAQ</a>');
    expect(scenes).toContain('src="../../_offline/search.js" data-root="../../"');
    expect(scenes).toContain('src="/img/missing-diagram.png"'); // broken stays as-is
    const home = await out("index.html");
    expect(home).toContain('srcset="img/hero-2x.png 2x, img/hero.png 1x"');
    expect(home).toContain('href="guide/install.html#unbox"');
    expect(await out("faq/index.html")).toContain('href="../guide/install.html">installing Lumen');
    const css = await out("css/site.css");
    expect(css).toContain('@import url("theme.css")');
    expect(css).toContain('url("../img/header-bg.png")');
    await expect(readFile(join(ws, "lumen-offline/img/unused-draft.png"))).rejects.toThrow();
    await expect(readFile(join(ws, "lumen-offline/old/press-kit.html"))).rejects.toThrow();
    // 搜索索引能被浏览器端 MiniSearch 加载
    const idx = (await out("_offline/search-index.js")).replace(/^window\.__OFFLINE_SEARCH=/, "").replace(/;\n$/, "");
    const ms = MiniSearch.loadJSON(JSON.parse(idx), { fields: ["title", "text"], storeFields: ["title", "url", "text"] });
    expect(ms.search("sunrise").map((x) => x.url).sort()).toEqual(["guide/scenes/index.html", "index.html"]);
    expect(ms.search("colour temperature")[0].url).toBe("guide/scenes/index.html");
    expect(ms.search("charger", { prefix: true }).map((x) => x.url)).toEqual(expect.arrayContaining(["faq/index.html", "troubleshooting/index.html"]));
    const zip = unzipSync(await readFile(join(ws, "lumen-offline.zip")));
    expect(Object.keys(zip)).toContain("lumen-offline/guide/install.html");
    expect(Object.keys(zip).some((k) => k.includes(".packed-by"))).toBe(false);
  });
  it("includes unlinked pages on request, warns about fetch(), and protects other folders", async () => {
    await writeFile(join(ws, "lumen/public/js/site.js"), "fetch('/api/status.json').then(r => r.json());\n");
    const p = await call("site_pack", { dir: "lumen/public", out: "lumen-all", includeUnlinked: true, search: false, zip: false });
    const r = p.structuredContent.report;
    expect(r.pages).toHaveLength(8);
    expect(r.warnings.join()).toMatch(/js\/site\.js loads data with fetch/);
    expect(await readFile(join(ws, "lumen-all/old/press-kit.html"), "utf8")).toContain('href="../css/site.css"');
    expect(await readFile(join(ws, "lumen-all/index.html"), "utf8")).not.toContain("_offline/search.js");
    await mkdir(join(ws, "mine"), { recursive: true });
    await writeFile(join(ws, "mine/notes.txt"), "keep me");
    expect((await call("site_pack", { dir: "lumen/public", out: "mine" })).content[0].text).toMatch(/not created by this plugin/);
    expect(await readFile(join(ws, "mine/notes.txt"), "utf8")).toBe("keep me");
    expect((await call("site_pack", { dir: "lumen/public", out: "lumen/public/x" })).content[0].text).toMatch(/bad_output/);
    expect((await call("site_pack", { dir: "lumen" })).content[0].text).toMatch(/index\.html not found/);
  });
});
