import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { pngSize } from "../src/icons.ts";
import { checkTask, permissions, toPattern } from "../src/task.ts";
import { createServer } from "../src/server.ts";

// 样例：虚构的 Harbor Bikes 供应商门户任务（搜索、翻页、导出 CSV、下载规格单）、books.toscrape.com 任务、以及“当前标签页”任务。
const S = process.env.TASK_SAMPLES ?? "/workspace/zcode-new-plugins/samples/webtask";
const sample = (f: string, portal = "http://127.0.0.1:8123") => JSON.parse(readFileSync(join(S, f), "utf8").replaceAll("{{PORTAL}}", portal));
let ws: string;
let call: (name: string, args: Record<string, unknown>) => Promise<any>;
beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), "wte-"));
  const server = createServer({ workspaceRoot: ws, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(b);
  call = async (name, args) => (await client.callTool({ name, arguments: args })) as any;
});

describe("task model", () => {
  it("derives minimal permissions", () => {
    const portal = { ...sample("portal-task.json"), version: "1.0.0", sites: [] };
    expect(permissions(portal).map((p) => p.name)).toEqual(["storage", "scripting", "downloads", "http://127.0.0.1/*"]);
    const books = { ...sample("books-task.json"), version: "1.0.0", settings: [], sites: [] };
    expect(permissions(books).map((p) => p.name)).toEqual(["storage", "scripting", "downloads", "https://books.toscrape.com/*"]);
    const tab = { ...sample("current-tab-task.json"), version: "1.0.0", settings: [], sites: [] };
    expect(permissions(tab).map((p) => p.name)).toEqual(["storage", "scripting", "downloads", "activeTab"]);
    expect(toPattern("shop.example.com")).toBe("https://shop.example.com/*");
    expect(toPattern("http://localhost:3000/app?x=1")).toBe("http://localhost/*");
    expect(toPattern("*.example.org")).toBe("https://*.example.org/*");
    expect(toPattern("not a site")).toBeNull();
  });
  it("catches task mistakes", () => {
    const base = { name: "x", description: "", version: "1.0.0", settings: [], sites: [] as string[] };
    const errs = (t: object) => checkTask({ ...base, ...t } as never).filter((p) => p.level === "error").map((p) => p.message);
    expect(errs({ steps: [{ action: "fill", selector: "#q", value: "{{term}}" }] })[0]).toMatch(/Unknown placeholder \{\{term\}\}/);
    expect(errs({ steps: [{ action: "open", url: "https://{{host}}.example.com/" }], settings: [{ key: "host" }] })[0]).toMatch(/can't change the site/);
    expect(errs({ steps: [{ action: "open", url: "ftp://x.com/" }] })[0]).toMatch(/http\(s\)/);
    expect(errs({ steps: [{ action: "download" }] })[0]).toMatch(/Nothing extracted/);
    expect(errs({ steps: [{ action: "wait" }] })[0]).toMatch(/selector or ms/);
    expect(errs({ steps: [{ action: "open", url: "https://a.com/" }], sites: ["<all_urls>"] })[0]).toMatch(/every website/);
    expect(errs({ steps: [{ action: "extract", selector: "tr" }, { action: "download", filename: "../x.csv" }] })[0]).toMatch(/relative path/);
    const warns = checkTask({ ...base, steps: [{ action: "fill", selector: "#password", value: "x" }] } as never).filter((p) => p.level === "warn").map((p) => p.message);
    expect(warns.join(" ")).toMatch(/password.*out of scope/i);
  });
});

describe("tools", () => {
  it("generates, validates and zips the portal extension", async () => {
    const r = await call("ext_new", sample("portal-task.json"));
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent.saved;
    expect(s).toMatchObject({ out: "extensions/harbor-parts-price-export", version: "1.0.0", errors: 0, warnings: 0, zip: "extensions/harbor-parts-price-export-1.0.0.zip" });
    expect(s.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    const dir = join(ws, s.out);
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(m).toMatchObject({ manifest_version: 3, permissions: ["storage", "scripting", "downloads"], host_permissions: ["http://127.0.0.1/*"], action: { default_popup: "popup.html" }, options_page: "options.html", background: { service_worker: "background.js" } });
    expect(m.content_scripts).toBeUndefined();
    expect(pngSize(readFileSync(join(dir, "icons/icon128.png")))).toEqual([128, 128]);
    expect(readFileSync(join(dir, "PERMISSIONS.md"), "utf8")).toMatch(/`downloads` \| Saves the extracted data/);
    const z = unzipSync(readFileSync(join(ws, s.zip)));
    expect(Object.keys(z)).toContain("manifest.json");
    expect(Object.keys(z)).not.toContain("README.md");
    expect(Object.keys(z).sort()).toEqual(["_locales/en/messages.json", "_locales/zh_CN/messages.json", "background.js", "common.js", "icons/icon128.png", "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "manifest.json", "options.html", "options.js", "popup.html", "popup.js", "steps.js", "task.json", "ui.css"]);
    expect(r.structuredContent.preview.zh).toContain("运行任务");
    expect(r.content[0].text).toMatch(/Load unpacked/);
    const again = await call("ext_new", sample("portal-task.json"));
    expect(again.content[0].text).toMatch(/\[exists\]/);
  });
  it("rejects a bad task with the reason", async () => {
    const r = await call("ext_new", { name: "Bad", steps: [{ action: "fill", selector: "#q", value: "{{nope}}" }] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/\[bad_task\].*nope/s);
  });
  it("updates, bumps the version and keeps permissions in step with the steps", async () => {
    await call("ext_new", sample("books-task.json"));
    const r = await call("ext_update", { out: "extensions/mystery-books-price-list", steps: sample("books-task.json").steps.slice(0, 3) });
    const s = r.structuredContent.saved;
    expect(s.version).toBe("1.0.1");
    expect(s.permissions.map((p: { name: string }) => p.name)).toEqual(["storage", "scripting", "https://books.toscrape.com/*"]);
    expect(s.zip).toBe("extensions/mystery-books-price-list-1.0.1.zip");
    const list = await call("ext_list", {});
    expect(list.content[0].text).toMatch(/mystery-books-price-list\/ — “Mystery books price list” 1\.0\.1/);
  });
  it("ext_check catches hand edits that break MV3 rules", async () => {
    await call("ext_new", { ...sample("current-tab-task.json"), out: "ext/tab" });
    const dir = join(ws, "ext/tab");
    const ok = await call("ext_check", { out: "ext/tab" });
    expect(ok.structuredContent.saved.errors).toBe(0);
    expect(ok.structuredContent.saved.warnings).toBe(1); // 不以 Open 开头 → activeTab 提醒
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    m.permissions.push("tabs");
    m.host_permissions = ["<all_urls>"];
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(m));
    writeFileSync(join(dir, "popup.html"), readFileSync(join(dir, "popup.html"), "utf8").replace("</body>", '<script>alert(1)</script><button onclick="x()">x</button><script src="https://cdn.example.com/a.js"></script></body>'));
    writeFileSync(join(dir, "options.js"), "const x = eval('1'); function (");
    writeFileSync(join(dir, "icons/icon48.png"), readFileSync(join(dir, "icons/icon16.png")));
    const bad = await call("ext_check", { out: "ext/tab" });
    const c = Object.fromEntries(bad.structuredContent.saved.checks.map((x: { id: string }) => [x.id, x]));
    expect(c.csp.ok).toBe(false);
    expect(c.csp.message).toMatch(/inline <script>.*remote script.*inline onclick/);
    expect(c.js.message).toMatch(/options\.js: Function statements require a function name; options\.js: eval/);
    expect(c.icons.message).toMatch(/48/);
    expect(c.minimal.ok).toBe(false);
    expect(c.permissions_match.message).toMatch(/Not needed by any step: <all_urls>, tabs/);
    expect(bad.structuredContent.saved.zip).toBeNull();
    expect(bad.content[0].text).toMatch(/no zip was written/);
  });
});
