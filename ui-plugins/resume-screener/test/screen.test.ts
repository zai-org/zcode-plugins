import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { groupsOf, hasTerm, parseJd, phoneOf, workYears } from "../src/screen.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("parses the JD and matches terms", () => {
    const jd = parseJd("# 分析师\n## 任职要求\n- 2 年以上经验\n- 熟悉 Tableau 或 Power BI\n- 30 岁以下，女性优先\n## 加分项\n- 了解 A/B 测试");
    expect(jd.minYears).toBe(2);
    expect(jd.must).toEqual([{ text: "熟悉 Tableau 或 Power BI", alts: ["Tableau", "Power BI"] }]);
    expect(jd.nice[0].alts).toEqual(["A/B 测试"]);
    expect(jd.flagged).toEqual(["30 岁以下", "女性"]);
    expect(groupsOf("熟练使用 SQL、Python").map((g) => g.alts)).toEqual([["SQL"], ["Python"]]);
    expect(hasTerm("ran A/B tests on pricing", "A/B 测试")).toBe(true);
    expect(hasTerm("NoSQLite", "SQL")).toBe(false);
    expect(workYears("A | 2020.01 – 2021.12\nB | 2021.06 – 2022.12\n大学 | 2010.09 – 2014.06", 0)).toBe(3);
    expect(phoneOf("tel +86 135 7777 8888, 2020.03")).toBe("13577778888");
  });
});

describe("tools", () => {
  it("screens the resumes and exports the shortlist", async () => {
    const root = await mkdtemp(join(tmpdir(), "screen-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("screen_open", { inputs: ["招聘"], project: "da" });
    expect(o.text).toMatch(/5 candidate\(s\)/);
    expect(o.text).toMatch(/must: SQL, Python, Tableau\/Power BI; nice: 零售\/餐饮, A\/B 测试, dbt; ≥3 yrs; 本科\+/);
    expect(o.text).toMatch(/“35 岁以下”, “男性”/);
    expect(o.text).toMatch(/looks like the same person as row \d \(王磊/);
    expect(o.text).toMatch(/李雨桐: about [\d.]+ year\(s\)/);
    expect(o.text).toMatch(/Daniel Ortiz \(Daniel-Ortiz-CV\.pdf\) score \d+/);
    expect(o.text).toMatch(/李雨桐 \(李雨桐\.md\) score \d+ missing Python/);
    const st0 = await c.call("screen_status", { project: "da" });
    const rows = st0.data.rows as { name: string; _score: number; file: string }[];
    const score = (n: string) => rows.find((r) => r.file.endsWith(n))!._score;
    expect(score("陈思远.md")).toBe(100);
    expect(score("李雨桐.md")).toBeLessThan(50);
    const dup = rows.findIndex((r) => r.file.endsWith("王磊.docx"));
    await c.call("screen_edit", { project: "da", set: [{ row: dup, values: { include: false } }] });
    const st = await c.call("screen_status", { project: "da" });
    expect(st.text).not.toMatch(/same person/);
    await c.call("screen_export", { project: "da" });
    const dir = join(root, "resume-screener/da");
    expect((await readdir(dir)).sort()).toEqual(["shortlist.md", "shortlist.xlsx"]);
    const md = await readFile(join(dir, "shortlist.md"), "utf8");
    expect(md).toMatch(/\| 1 \| 王磊 \| 100 \| 9.4 \|/);
    expect(md).toMatch(/\| 4 \| 李雨桐 \| \d+ \| 2.4 \| 本科 \| Python \|/);
    expect(md).not.toMatch(/王磊.*\n.*王磊/);
  }, 120_000);
});
