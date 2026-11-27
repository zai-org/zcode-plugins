import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { parseRange, parseResume } from "../src/resume.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("parsing", () => {
  it("reads the resume structure and dates", () => {
    const r = parseResume("# 张三\n电话 13800000000\n## 工作经历\n### A 公司 · 工程师 | 2020.01 – 至今\n- 做了 3 件事\n## 技能\n- SQL");
    expect(r.name).toBe("张三");
    expect(r.entries).toEqual([{ section: "工作经历", title: "A 公司 · 工程师", dates: "2020.01 – 至今", details: "• 做了 3 件事" }, { section: "技能", title: "", dates: "", details: "• SQL" }]);
    expect(parseRange("Mar 2020 – Present", 2026 * 12)).toMatchObject({ start: 2020 * 12 + 2, end: 2026 * 12 });
    expect(parseRange("2019/8-2021/2", 0)).toMatchObject({ start: 2019 * 12 + 7, end: 2021 * 12 + 1 });
  });
});

describe("tools", () => {
  it("checks and exports the resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "resume-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("resume_open", { inputs: ["简历/林小满-简历.md"], project: "cv" });
    expect(o.text).toMatch(/end 2018\.06 is before start 2019\.08/);
    expect(o.text).toMatch(/ID card number/);
    expect(o.text).toMatch(/10-month gap between 快鹿出行 \(to 2022\.05\) and 山间茶铺（连锁茶饮） \(from 2023\.03\)/);
    expect(o.text).toMatch(/Only 2 of 7 work bullets have a number/);
    expect(o.text).toMatch(/5 bullet\(s\) start with 负责/);
    await c.call("resume_edit", { project: "cv", set: [{ row: 3, values: { dates: "2018.07 – 2019.06" } }], settings: { contact: "产品经理 · 杭州 · 138-0000-1234 · xiaoman.lin@example.com" } });
    const st = await c.call("resume_status", { project: "cv" });
    expect(st.text).not.toMatch(/before start|ID card|Age/);
    expect(st.data.stats).toMatchObject({ entries: 6, pages: 1 });
    await c.call("resume_export", { project: "cv" });
    const dir = join(root, "resume-builder/cv");
    expect((await readdir(dir)).sort()).toEqual(["resume.docx", "resume.html", "resume.md", "resume.pdf"]);
    expect((await readFile(join(dir, "resume.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await readFile(join(dir, "resume.md"), "utf8")).toContain("### 云帆科技 · 产品助理 | 2018.07 – 2019.06");
    expect((await readFile(join(dir, "resume.docx"))).subarray(0, 2).toString()).toBe("PK");
  }, 120_000);
});
