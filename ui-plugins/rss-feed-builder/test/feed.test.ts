import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { absolutize, parsePost, toDate } from "../src/feed.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("feed", () => {
  it("parses posts and dates", () => {
    expect(parsePost("p/2026-01-02-hi.md", "# 你好\ntext")).toMatchObject({ title: "你好", date: "2026-01-02", slug: "hi", dateSource: "file name" });
    expect(toDate("2026-11-02 09:30", "+08:00")!.toISOString()).toBe("2026-11-02T01:30:00.000Z");
    expect(toDate("2026-11-02T09:30:00Z", "+08:00")!.toISOString()).toBe("2026-11-02T09:30:00.000Z");
    expect(toDate("next week", "")).toBeUndefined();
    expect(absolutize('<img src="images/a.jpg"><a href="https://x.y">x</a><a href="#f">f</a>', "https://s.com/posts/p/")).toBe('<img src="https://s.com/posts/p/images/a.jpg"><a href="https://x.y">x</a><a href="#f">f</a>');
  });
});

describe("feed tools", () => {
  it("builds three valid feeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "feed-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("feed_open", { inputs: ["posts"], project: "blog", settings: { title: "青禾茶话", author: "林小满" } });
    expect(o.text).toContain("Set the site URL");
    const rows = o.data.rows as Record<string, unknown>[];
    const byFile = (f: string) => rows.find((r) => String(r.file).endsWith(f))!;
    expect(byFile("draft-new-shop.md").include).toBe(false);
    expect(byFile("2026-10-15-storage.md")).toMatchObject({ slug: "how-to-store-white-tea", author: "周宁", title: "白茶怎么存放？" });
    expect(byFile("no-front-matter.md")).toMatchObject({ title: "茶具清洗小技巧", slug: "no-front-matter" });
    await c.call("feed_edit", { project: "blog", settings: { siteUrl: "https://tea.example", content: "full" } });
    await c.call("feed_export", { project: "blog" });
    const out = (f: string) => readFile(join(root, "rss-feed-builder/blog", f), "utf8");
    const xml = await out("feed.xml");
    expect(xml).toContain("<link>https://tea.example/posts/2026-11-02-white-tea/</link>".replace("2026-11-02-", ""));
    expect(xml).toContain("<pubDate>Mon, 02 Nov 2026 01:30:00 GMT</pubDate>");
    expect(xml).toContain('<img src="https://tea.example/posts/white-tea/images/cup.jpg" alt="茶汤">');
    expect(xml).toContain("<description>今年头采银针的香气和口感记录。</description>");
    expect(xml).toContain("<dc:creator>周宁</dc:creator>");
    expect(xml).not.toContain("新店开业");
    expect(xml).not.toContain("<h1>");
    const j = JSON.parse(await out("feed.json"));
    expect(j.items.find((i: { url: string }) => i.url.includes("how-to-store")).summary).toBe("避光、防潮、无异味。用 密封罐 最方便。");
    expect(j.items[j.items.length - 1].title).toBe("白茶怎么存放？");
    const at = await out("atom.xml");
    expect(at).toContain("<id>https://tea.example/</id>");
    for (const f of ["feed.xml", "atom.xml"]) execFileSync("python3", ["-c", "import sys,xml.dom.minidom;xml.dom.minidom.parse(sys.argv[1])", join(root, "rss-feed-builder/blog", f)]);
  });
});

describe("file-date fallback", () => {
  it("keeps the file time in UTC instead of re-reading it in the tz setting", async () => {
    const root = await mkdtemp(join(tmpdir(), "feed-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const t = new Date("2026-11-25T22:00:00Z");
    await utimes(join(root, "posts/no-front-matter.md"), t, t);
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("feed_open", { inputs: ["posts"], project: "blog", settings: { siteUrl: "https://tea.example", tz: "+08:00" } });
    const row = (o.data.rows as Record<string, unknown>[]).find((r) => String(r.file).endsWith("no-front-matter.md"))!;
    expect(row.date).toBe("2026-11-25 22:00Z");
    await c.call("feed_export", { project: "blog" });
    const json = JSON.parse(await readFile(join(root, "rss-feed-builder/blog/feed.json"), "utf8"));
    const item = json.items.find((i: { title: string }) => i.title === "茶具清洗小技巧");
    expect(item.date_published).toBe("2026-11-25T22:00:00.000Z");
  });
});
