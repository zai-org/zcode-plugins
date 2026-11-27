import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";
import { convert, parseDict, parseTerms, protectMarkdown, scriptGuess } from "../src/zh.ts";
import { readDocx, writeDocx } from "../src/docx.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const o = (dir: any, custom: { from: string; to: string }[] = [], exclude: string[] = []) => ({ dir, custom, exclude });

describe("convert", () => {
  it("converts both ways with regional phrasing", () => {
    expect(convert("我们的软件用鼠标操作", o("cn-tw")).text).toBe("我們的軟件用鼠標操作");
    expect(convert("我们的软件用鼠标操作", o("cn-twp")).text).toBe("我們的軟體用滑鼠操作");
    expect(convert("里面的头发", o("cn-hk")).text).toBe("裏面的頭髮");
    expect(convert("我們的軟體用滑鼠操作", o("twp-cn")).text).toBe("我们的软件用鼠标操作");
    expect(convert("我們的軟體", o("tw-cn")).text).toBe("我们的软体");
    const r = convert("软件和打印机", o("cn-twp"));
    expect(r.hits.filter((h) => h.kind === "phrase").map((h) => `${h.from}>${h.to}`)).toEqual(["软件>軟體", "打印机>印表機"]);
  });
  it("keeps excluded terms and applies custom entries first", () => {
    const r = convert("云帆门店的软件", o("cn-twp", [{ from: "门店", to: "門市" }], ["云帆"]));
    expect(r.text).toBe("云帆門市的軟體");
    expect(r.hits.map((h) => h.kind)).toEqual(["exclude", "custom", "phrase"]);
    // 更长的词优先
    expect(convert("云帆笔记和云", o("cn-tw", [{ from: "云帆笔记", to: "YunFan Notes" }], ["云帆"])).text).toBe("YunFan Notes和雲");
  });
  it("flags one-to-many characters outside known phrases", () => {
    const r = convert("面", o("cn-tw"));
    expect(r.hits).toEqual([]);
    expect(convert("发", o("cn-tw")).hits).toEqual([{ kind: "ambiguous", from: "发", to: "發" }]);
  });
  it("parses dictionaries, terms and markdown", () => {
    expect(parseDict("门店=門市\n# 注释\n智能 → 智慧\nbad\n")).toEqual({ rules: [{ from: "门店", to: "門市" }, { from: "智能", to: "智慧" }], errors: ["line 4: bad"] });
    expect(parseTerms("云帆、张三\n李四,云帆")).toEqual(["云帆", "张三", "李四"]);
    const p = protectMarkdown("运行 `数据库` 见[页面](https://x.com/网络)", false);
    expect(p.parts.filter((x) => x.keep).map((x) => x.text)).toEqual(["`数据库`", "https://x.com/网络)"]);
    expect(protectMarkdown("```js", false).fence).toBe(true);
    expect(scriptGuess("我们的软件").simp).toBeGreaterThan(0);
  });
  it("rewrites Word text and keeps runs when the length is unchanged", async () => {
    const buf = await readFile(join(HERE, "samples/docs/通知.docx"));
    const d = readDocx(new Uint8Array(buf));
    expect(d.paras.map((p) => p.text)).toEqual(["门店营业通知", "各位会员：本周六起，软件更新期间暂停网络下单。", "联系人：云帆客服 & 前台", "Opening hours: 10:00–18:00", "第 1 页 · 内部资料"]);
    const next = new Map(d.paras.map((p) => [p, convert(p.text, o("cn-twp")).text]));
    const back = readDocx(writeDocx(d.files, d.paras, next));
    expect(back.paras[1].nodes.map((n) => n.text)).toEqual(["各位會員：本週六起，", "軟", "體", "更新期間暫停網路下單。"]);
    expect(back.paras[2].text).toBe("聯絡人：雲帆客服 & 前臺");
  });
});

describe("tools", () => {
  it("converts a folder, keeps names, takes hand edits and writes copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "zh-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const r0 = await c.call("zhconv_open", { inputs: ["docs"], project: "d", settings: { exclude: "云帆", custom: "门店=門市" } });
    const rows = r0.data.rows as Record<string, unknown>[];
    const at = (f: string, line: number) => rows.findIndex((r) => String(r.file).endsWith(f) && r.line === line);
    expect(rows[at("产品说明.md", 7)].after).toBe("云帆筆記是一款跨平臺的筆記軟體，支援滑鼠拖拽和鍵盤快捷鍵。");
    expect(rows[at("产品说明.md", 12)].after).toBe("2. 執行 `yunfan --init 数据库` 初始化本地資料庫。");
    expect(rows[at("产品说明.md", 11)].after).toBe("1. 從官網下載安裝包，詳見[下載頁面](https://example.com/下载)。");
    expect(at("产品说明.md", 16)).toBe(-1); // 代码块
    expect(rows[at("产品说明.md", 22)].note).toContain("自定义 门店→門市");
    expect(rows[at("通知.docx", 3)].after).toBe("聯絡人：云帆客服 & 前臺");
    expect(at("episode.srt", 10)).toBe(-1);
    // 手改一处，跳过一处
    const bad = at("产品说明.md", 23), skip = at("episode.srt", 3);
    expect(rows[bad].after).toBe("- 頭髮幹了以後再出門，我們後來改成了自動同步。");
    await c.call("zhconv_edit", { project: "d", set: [{ row: bad, values: { 转换后: "- 頭髮乾了以後再出門，我們後來改成了自動同步。" } }, { row: skip, values: { accept: false } }] });
    const r1 = await c.call("zhconv_edit", { project: "d", settings: { names: true, keepCode: true } });
    const rr = r1.data.rows as Record<string, unknown>[];
    expect(rr.find((x) => String(x.file).endsWith("产品说明.md") && x.line === 23)!.after).toBe("- 頭髮乾了以後再出門，我們後來改成了自動同步。");
    await c.call("zhconv_export", { project: "d" });
    const out = join(root, "zh-convert", "d");
    const md = String(await readFile(join(out, "converted/docs/產品說明.md")));
    expect(md).toContain('echo "网络连接正常"');
    expect(md).toContain("頭髮乾了");
    expect(md.startsWith("---\ntitle: 云帆筆記 使用說明\n---\n")).toBe(true);
    const srt = String(await readFile(join(out, "converted/docs/episode.srt")));
    expect(srt).toContain("00:00:01,000 --> 00:00:03,500\n欢迎收看本期节目\n");
    expect(srt).toContain("今天我們聊聊影片軟體和滑鼠");
    const doc = readDocx(new Uint8Array(await readFile(join(out, "converted/docs/通知.docx"))));
    expect(doc.paras.map((p) => p.text)).toEqual(["門市營業通知", "各位會員：本週六起，軟體更新期間暫停網路下單。", "聯絡人：云帆客服 & 前臺", "Opening hours: 10:00–18:00", "第 1 頁 · 內部資料"]);
    const terms = String(await readFile(join(out, "terms.csv")));
    expect(terms).toMatch(/用词,软件,軟體,\d+/);
    expect(terms).toMatch(/保留,云帆,云帆,/);
    expect(String(await readFile(join(out, "changes.csv")))).toMatch(/,no\r?\n/);
    expect(String(await readFile(join(root, "docs/产品说明.md")))).toContain("云帆笔记是一款");
  });
});
