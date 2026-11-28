import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { fmtClock, parseLesson } from "../src/lesson.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("parses one-line steps and clock times", () => {
    const L = parseLesson("# 课\n课时：45 分钟\n## 教学目标\n- 能读出分数\n## 教学过程\n- 导入（5 分钟）：提问\n- 新授 20 分钟：讲解\n  - 学生：讨论\n");
    expect(L.minutes).toBe(45);
    expect(L.steps.map((x) => [x.phase, x.minutes, x.teacher])).toEqual([["导入", 5, "提问"], ["新授", 20, "讲解"]]);
    expect(L.steps[1].students).toBe("讨论");
    expect(fmtClock("08:00", 65)).toBe("09:05");
  });
});

describe("tools", () => {
  it("checks two lessons and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "lesson-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("lesson_open", { inputs: ["教案"], project: "math" });
    expect(o.text).toMatch(/2 lesson plan\(s\): 《认识几分之一》 4 steps, 42\/40 min, 3 objective\(s\); 《比较几分之一的大小》 5 steps, 40\/40 min, 2 objective\(s\), no homework/);
    expect(o.text).toMatch(/《认识几分之一》: steps add up to 42 min but the lesson is 40 min \(2 over\)/);
    expect(o.text).toMatch(/《认识几分之一》: “计时器” used in the steps but not listed/);
    expect(o.text).toMatch(/《比较几分之一的大小》: “视频” used in the steps/);
    expect(o.text).toMatch(/讲解新课: 20 min with no student activity/);
    expect(o.text).toMatch(/《比较几分之一的大小》 has no 作业布置/);
    expect(o.text).toMatch(/objective “了解分数的产生。” uses a vague verb \(了解\)/);
    expect(o.text).not.toMatch(/objective “能用/);
    const st = await c.call("lesson_status", { project: "math" });
    const rows = st.data.rows as Record<string, unknown>[];
    const wrap = rows.findIndex((r) => r.content === "课堂小结");
    const talk = rows.findIndex((r) => r.content === "讲解新课");
    await c.call("lesson_edit", { project: "math", set: [{ row: wrap, values: { minutes: 5 } }, { row: talk, values: { minutes: 15, students: "观察视频，说一说发现" } }, { row: rows.findIndex((r) => r.content === "动手操作"), values: { minutes: 13 } }], add: [{ lesson: "比较几分之一的大小", kind: "作业", content: "完成练习册第 92 页" }, { lesson: "比较几分之一的大小", kind: "准备", content: "切蛋糕视频" }, { lesson: "认识几分之一", kind: "准备", content: "计时器" }], settings: { start: "08:00" } });
    const st2 = await c.call("lesson_status", { project: "math" });
    expect(st2.text).not.toMatch(/add up to|not listed|no student activity|no 作业布置/);
    expect(st2.text).toMatch(/课堂小结 5 min \(08:35–08:40\)/);
    await c.call("lesson_export", { project: "math" });
    const dir = join(root, "lesson-plan-builder/math");
    expect((await readdir(dir)).sort()).toEqual(["lesson-plans.docx", "lesson-plans.md", "lesson-plans.pdf"]);
    const md = await readFile(join(dir, "lesson-plans.md"), "utf8");
    expect(md).toMatch(/\| 讲解新课 \| 15 分钟（08:03–08:18） \|/);
    expect(md).toMatch(/- 完成练习册第 92 页/);
    const doc = strFromU8(unzipSync(new Uint8Array(await readFile(join(dir, "lesson-plans.docx"))))["word/document.xml"]);
    expect(doc).toMatch(/教学过程（共 40 分钟）/);
    expect(doc).toMatch(/pageBreakBefore/);
  }, 120_000);
});
