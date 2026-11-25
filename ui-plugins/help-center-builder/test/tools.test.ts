import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import MiniSearch from "minisearch";
import { beforeAll, describe, expect, it } from "vitest";
import { parseDoc, slugify } from "../src/docs.ts";
import { createServer } from "../src/server.ts";

// 样例：虚构的 Harbor Bikes 帮助中心（英文，14 篇 Markdown + 1 篇 CMS 导出的 HTML，5 个分类）、虚构中文帮助中心（小站记账）、真实的 ripgrep 文档（GUIDE/FAQ/README）。
const S = process.env.HELP_SAMPLES ?? "/workspace/zcode-new-plugins/samples/help";
const DIST = join(import.meta.dirname, "../dist");
const tokenize = new Function(`${readFileSync(join(DIST, "runtime/assets/tokenize.js"), "utf8")}\nreturn hcTokenize;`)() as (s: string) => string[];
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
const out = (p: string) => readFileSync(join(ws, "help-center", p), "utf8");
const search = (dir: string, q: string) => {
  const js = readFileSync(join(ws, dir, "search-index.js"), "utf8");
  const data = JSON.parse(js.slice("window.HC_SEARCH=".length, -2));
  const ms = MiniSearch.loadJSON(JSON.stringify(data.index), { fields: data.fields, storeFields: [], tokenize, processTerm: (t: string) => t });
  return ms.search(q, { boost: { title: 4, tags: 3, headings: 2 }, prefix: (t: string) => t.length > 2, combineWith: "AND" }).map((r) => data.docs[r.id].t);
};
beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "hcb-"));
  cpSync(join(S, "harbor"), join(ws, "docs"), { recursive: true });
  cpSync(join(S, "zh"), join(ws, "zh"), { recursive: true });
  cpSync(join(S, "ripgrep"), join(ws, "rg"), { recursive: true });
  const server = createServer({ workspaceRoot: ws, assetRoot: DIST });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("parsing", () => {
  it("reads front matter, headings, links and cleans HTML exports", () => {
    const d = parseDoc("getting-started/create-account.md", readFileSync(join(S, "harbor/getting-started/create-account.md"), "utf8"));
    expect(d).toMatchObject({ title: "Create a Harbor Bikes account", folder: "getting-started", order: 1, tags: ["account", "signup", "app"], updated: "2026-10-02" });
    expect(d.headings.map((h) => h.id)).toEqual(["what-you-need", "sign-up-in-the-app", "sign-up-on-the-web"]);
    expect(d.links.filter((l) => l.kind !== "external").map((l) => `${l.kind}:${l.target}`)).toEqual(["asset:images/signup.png", "doc:billing/company-accounts.md", "doc:getting-started/first-ride.md"]);
    const h = parseDoc("account/contact-support.html", readFileSync(join(S, "harbor/account/contact-support.html"), "utf8"));
    expect(h).toMatchObject({ title: "Contact support", description: "Reach a person by chat, email or phone.", tags: ["support", "contact", "phone"] });
    expect(h.html).not.toMatch(/onclick|<script|cms-nav|<h1/);
    expect(h.stripped).toEqual(["onclick="]);
    const x = parseDoc("a.md", "## Setup\n\n## Setup\n\n### 常见 问题！\n<script>alert(1)</script><a href=\"javascript:alert(1)\">x</a>");
    expect(x.title).toBe("Setup");
    expect(x.headings.map((h) => h.id)).toEqual(["setup", "常见-问题"]);
    expect(x.html).not.toMatch(/script|javascript:/);
    expect(parseDoc("r.md", "ripgrep (rg)\n------------\nbody text").title).toBe("ripgrep (rg)");
    expect(slugify("What's new in v2.0?")).toBe("whats-new-in-v20");
  });
  it("tokenizes Latin words and CJK bigrams the same way as the browser", () => {
    expect(tokenize("Refund e-bike 会员退款")).toEqual(["refund", "e-bike", "e", "bike", "会", "会员", "员", "员退", "退", "退款", "款"]);
  });
});

describe("build", () => {
  it("builds the whole help center", async () => {
    const r = await call("hc_build", { docs: "docs" });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent.summary;
    expect(s).toMatchObject({ articles: 15, pages: 23, first: true, lang: "en" });
    expect(s.categories.map((c: { name: string; count: number }) => `${c.name}:${c.count}`)).toEqual(["Getting started:3", "Rentals & bookings:4", "Billing & payments:3", "Bikes & safety:3", "Your account:2"]);
    expect(s.issues.filter((i: { level: string }) => i.level !== "info")).toEqual([]);
    const home = out("index.html");
    expect(home).toMatch(/<title>Harbor Bikes Help Center<\/title>/);
    expect(home).toContain('href="billing/index.html">Billing &amp; payments</a>');
    const a = out("billing/refunds.html");
    expect(a).toMatch(/<div class="crumbs"><a href="..\/index.html">Home<\/a><span>›<\/span><a href="..\/billing\/index.html">Billing &amp; payments<\/a><span>›<\/span>Refunds<\/div>/);
    expect(a).toContain('<a href="../billing/refunds.html" class="on" aria-current="page">Refunds</a>');
    expect(a).toMatch(/class="prev" href="..\/billing\/deposits.html"/);
    expect(a).toMatch(/class="next" href="..\/billing\/company-accounts.html"/);
    expect(a).toContain('<link rel="canonical" href="https://help.harborbikes.example/billing/refunds.html">');
    const related = out("rentals/change-or-cancel.html").match(/<section class="related">([\s\S]*?)<\/section>/)![1];
    expect(related.match(/href="([^"]+)"/)![1]).toBe("../billing/refunds.html"); // front matter related 排第一
    expect(out("getting-started/create-account.html")).toContain('href="../billing/company-accounts.html"');
    expect(out("getting-started/create-account.html")).toContain('src="../images/signup.png"');
    expect(existsSync(join(ws, "help-center/images/signup.png"))).toBe(true);
    expect(out("billing/deposits.html")).toContain('href="../account/contact-support.html"');
    expect(out("account/contact-support.html")).not.toMatch(/onclick|trackingPixel/);
    expect(out("bikes/battery.html")).toMatch(/<div class="table-wrap"><table>/);
    expect(out("getting-started/create-account.html")).toMatch(/<aside class="toc">.*href="#what-you-need"/s);
    expect(out("sitemap.xml").match(/<url>/g)!.length).toBe(21);
    expect(out("404.html")).toContain('href="https://help.harborbikes.example/assets/style.css"');
    expect(search("help-center", "refund")[0]).toBe("Refunds");
    expect(search("help-center", "battery range")[0]).toBe("Charging an e-bike battery");
    expect(search("help-center", "dock full")).toContain("Ending a rental when a station is full");
    expect(search("help-center", "chat")).toContain("Contact support");
  });
  it("rebuilds only what a change affects, and says why", async () => {
    const again = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    expect(again).toMatchObject({ rebuilt: [], unchanged: 23, searchRebuilt: false, copied: [] });
    const f = join(ws, "docs/billing/refunds.md");
    const orig = readFileSync(f, "utf8");
    writeFileSync(f, orig.replace("3–5 working days**.", "3–5 working days** (Revolut: instant)."));
    let s = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    expect(s.rebuilt).toEqual([{ out: "billing/refunds.html", kind: "article", reasons: ["content"], src: "billing/refunds.md" }]);
    expect(s.searchRebuilt).toBe(true);
    expect(search("help-center", "revolut")).toEqual(["Refunds"]);
    writeFileSync(f, readFileSync(f, "utf8").replace("title: Refunds", "title: Refunds and chargebacks"));
    s = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    const by = Object.fromEntries(s.rebuilt.map((r: { out: string; reasons: string[] }) => [r.out, r.reasons]));
    expect(by["billing/refunds.html"]).toContain("content");
    expect(by["billing/deposits.html"]).toEqual(expect.arrayContaining(["nav", "prevnext"]));
    expect(by["billing/company-accounts.html"]).toEqual(expect.arrayContaining(["nav", "prevnext"]));
    expect(by["rentals/change-or-cancel.html"]).toEqual(["related"]);
    expect(by["billing/index.html"]).toEqual(["list"]);
    expect(by["index.html"]).toEqual(["list"]);
    expect(by["bikes/battery.html"]).toEqual(["related"]); // 共同标签 charge → 相关文章里有 Refunds
    expect(Object.keys(by).sort()).toEqual(["bikes/battery.html", "billing/company-accounts.html", "billing/deposits.html", "billing/index.html", "billing/refunds.html", "index.html", "rentals/change-or-cancel.html"]);
    expect(s.unchanged).toBe(23 - s.rebuilt.length);
    writeFileSync(join(ws, "docs/billing/vat-invoices.md"), "---\ntitle: VAT invoices\norder: 4\ntags: [invoice, business]\n---\nDownload a VAT invoice for any ride from **Rides → Receipt**.\n");
    s = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    expect(s.rebuilt.find((r: { out: string }) => r.out === "billing/vat-invoices.html").reasons).toEqual(["new"]);
    expect(s.pages).toBe(24);
    rmSync(join(ws, "docs/billing/vat-invoices.md"));
    s = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    expect(s.removed).toEqual(["billing/vat-invoices.html"]);
    expect(existsSync(join(ws, "help-center/billing/vat-invoices.html"))).toBe(false);
    rmSync(join(ws, "help-center/bikes/battery.html"));
    s = (await call("hc_build", { docs: "docs" })).structuredContent.summary;
    expect(s.rebuilt).toEqual([{ out: "bikes/battery.html", kind: "article", reasons: ["missing"], src: "bikes/battery.md" }]);
    s = (await call("hc_build", { docs: "docs", accent: "#9333ea" })).structuredContent.summary;
    expect(s.rebuilt.length).toBe(23);
    expect(s.rebuilt.every((r: { reasons: string[] }) => r.reasons.includes("site"))).toBe(true);
    const full = (await call("hc_build", { docs: "docs", accent: "#9333ea", full: true })).structuredContent.summary;
    expect(full.rebuilt.length).toBe(23);
    writeFileSync(f, orig);
  });
  it("reports broken links, anchors, conflicts and drafts", async () => {
    cpSync(join(S, "harbor"), join(ws, "bad"), { recursive: true });
    writeFileSync(join(ws, "bad/bikes/battery.md"), readFileSync(join(ws, "bad/bikes/battery.md"), "utf8") + "\nSee [locks](lock-wont-open.md#missing) and [old page](../old/page.md) and ![x](../images/nope.png).\n");
    writeFileSync(join(ws, "bad/bikes/draft.md"), "---\ntitle: Upcoming cargo bikes\ndraft: true\n---\nSoon.\n");
    const r = await call("hc_scan", { docs: "bad" });
    const msgs = r.structuredContent.issues.map((i: { level: string; src: string; message: string }) => `${i.level} ${i.src}: ${i.message}`);
    expect(msgs).toEqual(expect.arrayContaining([
      "warn bikes/battery.md: Missing anchor: lock-wont-open.md#missing (no #missing in bikes/lock-wont-open.md).",
      "error bikes/battery.md: Broken link: ../old/page.md (no such article).",
      "error bikes/battery.md: Broken link: ../images/nope.png (file not found).",
      "info bikes/draft.md: Draft: not published.",
    ]));
    writeFileSync(join(ws, "bad/bikes/battery.html"), "<h1>Dup</h1><p>x</p>");
    const c = await call("hc_build", { docs: "bad", out: "bad-site" });
    expect(c.content[0].text).toMatch(/\[conflict\].*battery/s);
    // 输出目录可以放在文档目录里：再次构建时不会把生成的页面当成文档。
    expect((await call("hc_build", { docs: "bad", out: "bad" })).content[0].text).toMatch(/\[bad_out\]/);
    rmSync(join(ws, "bad/bikes/battery.html"));
    await call("hc_build", { docs: "bad", out: "bad/_site" });
    const second = (await call("hc_build", { docs: "bad", out: "bad/_site" })).structuredContent.summary;
    expect(second).toMatchObject({ articles: 15, rebuilt: [] });
  });
  it("Chinese help center: UI language, Unicode paths and CJK search", async () => {
    const s = (await call("hc_build", { docs: "zh", out: "zh-site" })).structuredContent.summary;
    expect(s).toMatchObject({ articles: 5, lang: "zh-CN" });
    expect(s.categories.map((c: { name: string }) => c.name).sort()).toEqual(["入门", "常见问题"].sort());
    const page = readFileSync(join(ws, "zh-site/常见问题/会员退款.html"), "utf8");
    expect(page).toContain('<html lang="zh-CN"');
    expect(page).toContain(">首页</a>");
    expect(page).toMatch(/相关文章.*%E6%95%B0%E6%8D%AE%E5%AE%89%E5%85%A8\.html/s);
    expect(search("zh-site", "退款")[0]).toBe("会员如何退款");
    expect(search("zh-site", "验证码")).toEqual(expect.arrayContaining(["忘记密码怎么办", "注册账号"]));
    expect(search("zh-site", "excel")).toEqual(["导入银行账单"]);
  });
  it("real ripgrep docs: titles from ## / setext headings, HTML anchors, real broken links", async () => {
    const r = await call("hc_build", { docs: "rg", out: "rg-site", title: "ripgrep docs" });
    const s = r.structuredContent.summary;
    expect(s.articles).toBe(3);
    const scan = await call("hc_scan", { docs: "rg" });
    expect(scan.structuredContent.categories[0].articles.map((a: { title: string }) => a.title).sort()).toEqual(["FAQ", "User Guide", "ripgrep (rg)"]);
    expect(s.issues.filter((i: { level: string }) => i.level === "error").map((i: { message: string }) => i.message)).toEqual(["Broken link: CHANGELOG.md (no such article).", "Broken link: CHANGELOG.md (no such article)."]);
    expect(s.issues.some((i: { message: string }) => /Missing anchor/.test(i.message))).toBe(false);
    expect(search("rg-site", "gitignore")).toContain("User Guide");
    expect(search("rg-site", "pcre2 slower")).toContain("FAQ");
  });
});
