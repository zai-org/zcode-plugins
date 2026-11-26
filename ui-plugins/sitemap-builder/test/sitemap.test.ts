import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { linkKind, pageUrl, parsePage, resolveLink } from "../src/html.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("html", () => {
  it("parses and resolves", () => {
    const i = parsePage('<title> A &amp; B </title><meta name="robots" content="noindex,follow"><!-- <a href="x.html"> --><a href=\'y.html\'>y</a><img src=z.png>');
    expect(i).toMatchObject({ title: "A & B", noindex: true, links: [{ url: "y.html", kind: "page" }, { url: "z.png", kind: "asset" }] });
    expect(parsePage('<a href="/img/tea.jpg">大图</a><a href="/files/menu.PDF?v=2">菜单</a><a href="/blog/">博客</a><a href="/v1.2/">v</a>').links.map((l) => l.kind)).toEqual(["asset", "asset", "page", "page"]);
    expect([linkKind("a", "about.html"), linkKind("a", "/about"), linkKind("a", "x.php?id=1"), linkKind("a", "a.zip#top"), linkKind("img", "x")]).toEqual(["page", "page", "page", "asset", "asset"]);
    expect(resolveLink("blog/a.html", "../b/", "")).toBe("b/index.html");
    expect(resolveLink("blog/a.html", "/c.html?x=1#h", "")).toBe("c.html");
    expect(resolveLink("a.html", "https://ex.com/d%20e.html", "https://ex.com")).toBe("d e.html");
    expect(resolveLink("a.html", "https://other.com/", "https://ex.com")).toBeUndefined();
    expect(resolveLink("a.html", "../../x", "")).toBe("\u0000outside");
    expect(pageUrl("blog/index.html", "https://ex.com/", true)).toBe("https://ex.com/blog/");
    expect(pageUrl("关于.html", "https://ex.com", true)).toBe("https://ex.com/%E5%85%B3%E4%BA%8E");
  });
});

describe("sitemap tools", () => {
  it("builds sitemap, robots and link report", async () => {
    const root = await mkdtemp(join(tmpdir(), "sitemap-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("sitemap_open", { inputs: ["site"], project: "tea" });
    expect(o.data.stats).toMatchObject({ broken: 5 });
    expect(o.text).toContain("Set the site URL");
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => `${r.path} ${r.include} ${r.priority}`)).toEqual(["index.html true 1", "404.html false 0.8", "about/index.html true 0.8", "blog/2026-white-tea.html true 0.6", "blog/index.html true 0.8"]);
    expect(rows[3].lastmod).toBe("2026-11-02");
    expect(rows[0]._broken).toBe(2);
    const e = await c.call("sitemap_edit", { project: "tea", settings: { baseUrl: "https://tea.example/", disallow: "/drafts/" }, set: [{ row: 4, values: { changefreq: "weekly" } }] });
    expect(e.text).not.toContain("Set the site URL");
    await c.call("sitemap_export", { project: "tea" });
    const xml = await readFile(join(root, "sitemap-builder/tea/sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://tea.example/</loc>");
    expect(xml).toContain("<loc>https://tea.example/blog/2026-white-tea</loc>\n    <lastmod>2026-11-02</lastmod>\n    <priority>0.6</priority>");
    expect(xml).toContain("<loc>https://tea.example/blog/</loc>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).not.toContain("404");
    expect(await readFile(join(root, "sitemap-builder/tea/robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /drafts/\n\nSitemap: https://tea.example/sitemap.xml\n");
    const csv = await readFile(join(root, "sitemap-builder/tea/link-report.csv"), "utf8");
    expect(csv).toContain("about/index.html,../contact.html,contact.html,page");
    expect(csv).toContain("index.html,/css/site.css,css/site.css,asset");
    expect(csv).toContain("blog/index.html,./old-post.html,blog/old-post.html,page");
    expect(csv).toContain("blog/2026-white-tea.html,/img/tea.jpg,img/tea.jpg,asset");
    expect(csv).not.toContain("tea.jpg,page");
  });
});
