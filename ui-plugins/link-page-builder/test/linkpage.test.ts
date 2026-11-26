import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/page.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("urls", () => {
  it("normalizes", () => {
    expect(normalizeUrl("tea.example/x")).toEqual({ url: "https://tea.example/x", fixed: true, bad: false });
    expect(normalizeUrl("a@b.cn").url).toBe("mailto:a@b.cn");
    expect(normalizeUrl("+86 138-0000-1234").url).toBe("tel:+8613800001234");
    expect(normalizeUrl("javascript:alert(1)").bad).toBe(true);
  });
});

describe("linkpage tools", () => {
  it("builds the page and QR", async () => {
    const root = await mkdtemp(join(tmpdir(), "linkpage-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("linkpage_open", { inputs: ["我的主页/links.yaml"], project: "me" });
    expect(o.data.settings).toMatchObject({ name: "林小满", theme: "forest", avatar: "avatar.jpg" });
    expect(o.data.stats.links).toBe(4);
    expect(o.text).toContain("will link to https://tea.example/video");
    await c.call("linkpage_edit", { project: "me", settings: { pageUrl: "https://lin.example", showQr: true, theme: "sunset", shape: "pill" }, add: [{ title: "坏链接", url: "javascript:alert(1)" }] });
    await expect(c.call("linkpage_export", { project: "me" })).rejects.toMatchObject({ code: "has_errors" });
    await c.call("linkpage_edit", { project: "me", set: [{ row: 5, values: { url: "+86 138 0000 1234", title: "打电话" } }] });
    await c.call("linkpage_export", { project: "me" });
    const html = await readFile(join(root, "link-page-builder/me/index.html"), "utf8");
    expect(html).toContain('<img class="av" src="data:image/jpeg;base64,');
    expect(html).toContain('<a class="link hi" href="https://tea.example/shop" target="_blank" rel="noopener"><span class="ic">🍵</span>');
    expect(html).toContain('href="tel:+8613800001234"');
    expect(html).not.toContain("tea.example/2025");
    expect(html).not.toMatch(/<script|https?:\/\/[^"]*\.(css|js)/);
    expect(html).toContain("border-radius:999px");
    expect(html).toContain("<svg");
    const qr = join(root, "link-page-builder/me/qr.png");
    expect((await readFile(qr)).subarray(1, 4).toString()).toBe("PNG");
  });
  it("reads a CSV", async () => {
    const root = await mkdtemp(join(tmpdir(), "linkpage-"));
    await writeFile(join(root, "l.csv"), "标题,链接\n博客,tea.example\n");
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("linkpage_open", { inputs: ["l.csv"], project: "c" });
    expect(o.data.rows[0]).toMatchObject({ title: "博客", url: "tea.example" });
  });
});
