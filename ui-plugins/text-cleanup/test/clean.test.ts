import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { applyRule, assemble, cleanText, RULES } from "../src/clean.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL = new Set(RULES.filter((r) => r.on).map((r) => r.id));
const one = (line: string, md = true) => cleanText(line, ALL, md)[0]?.after ?? line;

describe("rules", () => {
  it("fixes punctuation, spacing and width", () => {
    expect(applyRule("fullwidthAlnum", "ＡＢＣ１２３")).toBe("ABC123");
    expect(applyRule("punct", "你好,世界!对吗?是的:好;")).toBe("你好，世界！对吗？是的：好；");
    expect(applyRule("punct", "共1,000元，版本1.2,很好")).toBe("共1,000元，版本1.2，很好");
    expect(applyRule("punct", "see a.b.c, ok")).toBe("see a.b.c, ok");
    expect(applyRule("punct", "结束了.")).toBe("结束了。");
    expect(applyRule("punct", "地点(A区)")).toBe("地点（A区）");
    expect(applyRule("ellipsis", "太长了...真的--很长")).toBe("太长了……真的——很长");
    expect(applyRule("quotes", '他说:"今天不错"')).toBe("他说:“今天不错”");
    expect(applyRule("quotes", 'say "hi" ok')).toBe('say "hi" ok');
    expect(applyRule("spaceCjkLatin", "在2026年发布ZCode版本")).toBe("在 2026 年发布 ZCode 版本");
    expect(applyRule("spaceCjkLatin", "完成率100%了")).toBe("完成率 100% 了");
    expect(applyRule("punctSpace", "好 ， 的 。")).toBe("好，的。");
    expect(applyRule("repeatPunct", "请带上！！！")).toBe("请带上！");
  });
  it("protects code, links and English lines", () => {
    expect(one("安装方法:运行`npm install`即可。")).toBe("安装方法：运行 `npm install` 即可。");
    expect(one("详见[官方文档](https://example.com/docs?a=1,b=2)。")).toBe("详见[官方文档](https://example.com/docs?a=1,b=2)。");
    expect(one('English line, keep it: "quotes", commas.')).toBe('English line, keep it: "quotes", commas.');
    expect(one("- 列表项目，带有  多余空格   ")).toBe("- 列表项目，带有 多余空格");
    expect(cleanText("```\n代码,不改\n```\n", ALL, true)).toEqual([]);
    expect(cleanText("a\n\n\n\nb\n\n", ALL, false).map((c) => [c.line, c.after])).toEqual([[3, null], [4, null], [6, null]]);
    expect(assemble("a\r\n\r\n\r\nb\r\n", new Map([[3, null], [1, "A"]]))).toBe("A\r\n\r\nb\r\n");
  });
});

describe("tools", () => {
  it("reviews changes, skips some and writes cleaned copies and a diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "clean-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("cleanup_open", { inputs: ["docs"], project: "d" });
    const rows = o.data.rows as Record<string, unknown>[];
    const at = (f: string, line: number) => rows.findIndex((r) => String(r.file).endsWith(f) && r.line === line);
    expect(rows[at("draft.md", 4)].after).toBe("# 使用 Markdown 写作指南");
    expect(rows[at("draft.md", 6)].after).toBe("我们在 2026 年发布了 ZCode，欢迎试用！");
    expect(rows[at("draft.md", 8)].after).toBe("全角字母 ABC 和数字 123 应该改成半角。");
    expect(rows.some((r) => String(r.file).endsWith("draft.md") && Number(r.line) >= 15 && Number(r.line) <= 17)).toBe(false);
    expect(rows.some((r) => String(r.file).endsWith("draft.md") && r.line === 2)).toBe(false);
    // 跳过一处、手改一处
    const skip = at("draft.md", 6), edit = at("notes.txt", 1);
    await c.call("cleanup_edit", { project: "d", set: [{ row: skip, values: { 接受: false } }, { row: edit, values: { after: "会议时间：下午 3 点，地点：3 楼会议室（A 区）。" } }] });
    const r = await c.call("cleanup_edit", { project: "d", settings: { repeatPunct: true } });
    const rr = r.data.rows as Record<string, unknown>[];
    expect(rr.find((x) => String(x.file).endsWith("draft.md") && x.line === 6)!.accept).toBe(false);
    expect(rr.find((x) => String(x.file).endsWith("notes.txt") && x.line === 1)!.after).toBe("会议时间：下午 3 点，地点：3 楼会议室（A 区）。");
    expect(rr.find((x) => String(x.file).endsWith("notes.txt") && x.line === 5)!.after).toBe("请带上电脑！");
    await c.call("cleanup_export", { project: "d" });
    const out = join(root, "text-cleanup", "d");
    const md = String(await readFile(join(out, "cleaned/docs/draft.md")));
    expect(md).toContain("我们在2026年发布了ZCode,欢迎试用!");
    expect(md).toContain('const s = "代码里的,标点不要改";');
    expect(md).toContain("这句话太长了……真的——很长。");
    expect(md).not.toMatch(/\n\n\n/);
    expect(String(await readFile(join(root, "docs/draft.md")))).toContain("使用Markdown写作指南");
    const notes = String(await readFile(join(out, "cleaned/docs/notes.txt")));
    expect(notes).toBe("会议时间：下午 3 点，地点：3 楼会议室（A 区）。\n\n请带上电脑！\n");
    const diff = String(await readFile(join(out, "changes.diff")));
    expect(diff).toContain("--- a/docs/draft.md");
    expect(diff).toContain("+# 使用 Markdown 写作指南");
    expect(String(await readFile(join(out, "changes.csv")))).toMatch(/,no\r?\n/);
  });
});
