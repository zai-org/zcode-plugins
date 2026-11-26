import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSocials } from "../src/sig.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("socials", () => {
  it("parses label + url pairs", () => {
    expect(parseSocials("领英 https://linkedin.example/qinghe, Blog|blog.qinghe.example\ngithub.example/qinghe")).toEqual([
      { label: "领英", url: "https://linkedin.example/qinghe" },
      { label: "Blog", url: "https://blog.qinghe.example" },
      { label: "github.example", url: "https://github.example/qinghe" },
    ]);
  });
});

describe("signature tools", () => {
  it("writes one signature per person", async () => {
    const root = await mkdtemp(join(tmpdir(), "sig-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("sig_open", { inputs: ["team.csv"], project: "q", settings: { company: "青禾科技", companyEn: "Qinghe Tech", website: "www.qinghe.example", logoUrl: "https://qinghe.example/logo.png", socials: "Blog blog.qinghe.example" } });
    expect(o.data.stats).toMatchObject({ signatures: 5, links: 1 });
    expect(o.text).toContain("5 signatures");
    await c.call("sig_edit", { project: "q", settings: { template: "side", disclaimer: "本邮件仅供收件人使用。" }, set: [{ row: 3, values: { include: false } }] });
    const ex = await c.call("sig_export", { project: "q" });
    expect(ex.text).toContain("signatures/ming.html");
    const ming = await readFile(join(root, "email-signature-maker/q/signatures/ming.html"), "utf8");
    expect(ming).toContain("<table");
    expect(ming).toContain('href="mailto:ming@qinghe.example"');
    expect(ming).toContain('href="tel:13900001234"');
    expect(ming).toContain('src="https://qinghe.example/logo.png"');
    expect(ming).toContain("本邮件仅供收件人使用。");
    expect(ming).not.toMatch(/<style|class=/);
    const zhao = await readFile(join(root, "email-signature-maker/q/signatures/xiaoyu.html"), "utf8");
    expect(zhao).toContain("设计师 &lt;UI&gt;");
    const txt = await readFile(join(root, "email-signature-maker/q/signatures/chensi.txt"), "utf8");
    expect(txt).toContain("WeChat: chensi2026");
    const idx = await readFile(join(root, "email-signature-maker/q/index.html"), "utf8");
    expect(idx).toContain("4 份邮件签名");
    expect(idx).not.toContain("wanglei@");
  });
});
