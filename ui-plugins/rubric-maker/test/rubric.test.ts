import { cp, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { levelOf, maxOf, parseRubric } from "../src/rubric.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("parses levels from descriptors and reads level input", () => {
    const R = parseRubric("# R\n## 内容（6 分）\n- A（3）：好\n- B（2）：中\n- C（1）：差\n## 表达\n- A：好");
    expect(R.levels.map((l) => [l.name, l.points])).toEqual([["A", 3], ["B", 2], ["C", 1]]);
    expect(R.criteria.map((c) => c.mult)).toEqual([2, 1]);
    expect(maxOf(R)).toBe(9);
    const D = parseRubric("## 论点\n- 优秀：x");
    expect(levelOf("优", D)).toBe("优秀");
    expect(levelOf("B", D)).toBe("良好");
    expect(levelOf("2", D)).toBe("合格");
    expect(levelOf("5", D)).toBeUndefined();
  });
});

describe("tools", () => {
  it("scores the class and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "rubric-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("rubric_open", { inputs: ["作文评分"], project: "essay" });
    expect(o.text).toMatch(/4 criteria \(论点 8, 论据 8, 结构 4, 语言 4\) × 4 levels \(优秀\/良好\/合格\/待改进\), 满分 20/);
    expect(o.text).toMatch(/add up to 24 points .* but 满分 is 20/);
    expect(o.text).toMatch(/Criterion “结构” has no descriptor for 待改进/);
    expect(o.text).toMatch(/吴俊杰: “5” for 论点 is not a level/);
    expect(o.text).toMatch(/孙浩然 \(803\) appears twice/);
    expect(o.text).toMatch(/周子涵: 结构 not scored/);
    expect(o.text).toMatch(/王梓轩 is not scored yet \(缺交\)/);
    expect(o.text).toMatch(/郑雨萱 \(807\)?.*|807 郑雨萱: 良好 良好 优秀 良好|807 郑雨萱: B B A B/);
    expect(o.text).toMatch(/804 李思琪: 优秀 优秀 良好 优秀 → 19\.2/);
    const st = await c.call("rubric_status", { project: "essay" });
    const rows = st.data.rows as Record<string, unknown>[];
    expect(String(rows[1]._feedback)).toMatch(/优点：语言：准确流畅/);
    expect(String(rows[2]._feedback)).toMatch(/下一步：论据：争取做到“论据单一或与论点联系不紧”/);
    await c.call("rubric_export", { project: "essay" });
    await c.call("rubric_edit", { project: "essay", set: [{ row: 5, values: { c0: "合格" } }, { row: 7, values: { include: false } }, { row: 4, values: { c2: "良好" } }], settings: { title: "八（3）班 议论文" } });
    await c.call("rubric_export", { project: "essay" }); // exports with errors still open must not crash
    const st2 = await c.call("rubric_status", { project: "essay" });
    expect(st2.text).not.toMatch(/not a level|appears twice|周子涵: 结构/);
    expect(st2.text).toMatch(/7 of 8 student\(s\) fully scored/);
    await c.call("rubric_export", { project: "essay" });
    expect((await readdir(join(root, "rubric-maker/essay"))).sort()).toEqual(["feedback.pdf", "rubric.pdf", "scores.xlsx"]);
  }, 120_000);
});
