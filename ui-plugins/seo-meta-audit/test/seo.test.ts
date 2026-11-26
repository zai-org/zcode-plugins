import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMeta, readMeta, width } from "../src/meta.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("meta", () => {
  it("reads and rewrites only meta tags", () => {
    expect(width("青禾 tea")).toBe(8);
    const html = '<html>\n<head>\n  <title>Old</title>\n  <meta content="x" name="description">\n</head><body><h1>A <b>b</b></h1><img src="a.png"></body></html>';
    expect(readMeta(html)).toMatchObject({ title: "Old", description: "x", h1: ["A b"], noAlt: ["a.png"] });
    const out = applyMeta(html, { title: "新 & 标题", description: 'say "hi"', og: true, lang: "zh-CN" });
    expect(out).toBe('<html lang="zh-CN">\n<head>\n  <title>新 &amp; 标题</title>\n  <meta property="og:description" content="say &quot;hi&quot;">\n  <meta property="og:title" content="新 &amp; 标题">\n  <meta name="description" content="say &quot;hi&quot;">\n</head><body><h1>A <b>b</b></h1><img src="a.png"></body></html>');
    expect(applyMeta("<p>x</p>", { title: "T" })).toBe("<head>\n  <title>T</title>\n</head>\n<p>x</p>");
  });
});

describe("seo tools", () => {
  it("audits, fixes copies, applies and undoes", async () => {
    const root = await mkdtemp(join(tmpdir(), "seo-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("seo_open", { inputs: ["site"], project: "s" });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => r.path)).toEqual(["site/about.html", "site/index.html", "site/products/white-tea.html"]);
    expect(rows[0]._notes).toBe("title short, dup title, no description, 2 h1, no lang, no viewport, no og");
    expect(rows[1]._notes).toContain("1 img no alt");
    expect(rows[2]._notes).toContain("title long");
    const before = await readFile(join(root, "site/about.html"), "utf8");
    await c.call("seo_edit", { project: "s", settings: { lang: "zh-CN" }, set: [{ row: 0, values: { title: "关于青禾茶业 · 福鼎白茶的种植与制作", description: "青禾茶业成立于 2012 年，在福鼎太姥山拥有自有茶园，坚持传统日晒工艺，为茶友提供可追溯的高品质白茶。" } }] });
    const e = await c.call("seo_export", { project: "s" });
    expect(e.text).toContain("pages/site/about.html");
    const fixed = await readFile(join(root, "seo-meta-audit/s/pages/site/about.html"), "utf8");
    expect(fixed).toContain('<html lang="zh-CN">');
    expect(fixed).toContain("<title>关于青禾茶业 · 福鼎白茶的种植与制作</title>\n<meta name=\"description\"");
    expect(await readFile(join(root, "site/about.html"), "utf8")).toBe(before);
    expect(await readFile(join(root, "seo-meta-audit/s/audit.csv"), "utf8")).toContain("site/index.html,青禾茶业,8,青禾茶业,8,1,2,1,");
    await c.call("seo_export", { project: "s", formats: ["apply"] });
    expect(await readFile(join(root, "site/about.html"), "utf8")).toBe(fixed);
    const st = await c.call("seo_status", { project: "s" });
    expect(st.data.stats.edited).toBe(0);
    await c.call("seo_export", { project: "s", formats: ["undo"] });
    expect(await readFile(join(root, "site/about.html"), "utf8")).toBe(before);
  });
});
