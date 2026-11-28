import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { matchHeader, parseRubric, parseScore, parseVerdict } from "../src/score.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("parses the rubric, scores and verdicts", () => {
    const r = parseRubric("# T\n评分：1-4 分，3 分以上建议录用\n## 沟通 / Communication 60%\n1 = 差\n4 = 好\n## 逻辑\n## 学习");
    expect(r.max).toBe(4);
    expect(r.threshold).toBe(3);
    expect(r.criteria.map((c) => [c.name, c.weight])).toEqual([["沟通", 60], ["逻辑", 20], ["学习", 20]]);
    expect(r.criteria[0].anchors).toEqual({ 1: "差", 4: "好" });
    expect(matchHeader("Communication", r.criteria)).toBe(0);
    expect(matchHeader("逻辑（20%）", r.criteria)).toBe(1);
    expect(parseScore("４分")).toBe(4);
    expect(parseScore("★★★☆☆")).toBe(3);
    expect(parseScore("abc")).toBeNaN();
    expect(parseVerdict("Strong Yes")).toBe("强烈推荐");
    expect(parseVerdict("No hire")).toBe("不推荐");
  });
});

describe("tools", () => {
  it("merges sheets, flags problems and exports", async () => {
    const root = await mkdtemp(join(tmpdir(), "scorecard-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("scorecard_open", { inputs: ["面试"], project: "ops" });
    expect(o.text).toMatch(/4 candidate\(s\), 12 scorecard\(s\) from 3 interviewer\(s\); 5 criteria \(沟通表达 20%, 数据分析 30%, 用户思维 25%, 执行与抗压 15%, 团队协作 10%\); scale 1–5, bar 3.5/);
    expect(o.text).toMatch(/数据分析 = “45” is outside 1–5 \(did they mean 4.5\?\)/);
    expect(o.text).toMatch(/宋一凡 has two scorecards from 张经理/);
    expect(o.text).toMatch(/周晴: interviewers disagree on 数据分析 \(陈晓 4 vs 张经理 5 vs 李主管 2/);
    expect(o.text).toMatch(/李主管 says “强烈推荐” for 宋一凡 but their scores average 2\.\d+/);
    expect(o.text).toMatch(/林可 \/ 张经理: no score for 团队协作/);
    expect(o.text).toMatch(/陈晓 scores higher than the other interviewers/);
    expect(o.text).toMatch(/林可 [\d.]+ 建议录用/);
    expect(o.text).toMatch(/周晴 [\d.]+ 需讨论/);
    const st = await c.call("scorecard_status", { project: "ops" });
    const rows = st.data.rows as Record<string, string>[];
    const bad = rows.findIndex((r) => r.c1 === "45"), dup = rows.findIndex((r) => r.candidate === "宋一凡" && r.comment === "");
    expect(rows.some((r) => r.candidate === "宋一凡" && r.file.endsWith(".csv"))).toBe(true);
    await c.call("scorecard_edit", { project: "ops", set: [{ row: bad, values: { c1: "4.5" } }], settings: { calibrate: true } });
    const st2 = await c.call("scorecard_status", { project: "ops" });
    expect(st2.text).not.toMatch(/outside 1–5/);
    expect(st2.text).toMatch(/adjusted \(calibrate on\)/);
    expect(dup).toBeGreaterThan(-1);
    await c.call("scorecard_export", { project: "ops" });
    const dir = join(root, "interview-scorecard/ops");
    expect((await readdir(dir)).sort()).toEqual(["blank-scorecard.pdf", "ranking.xlsx", "scorecards.pdf"]);
    expect((await readFile(join(dir, "scorecards.pdf"))).subarray(0, 4).toString()).toBe("%PDF");
  }, 120_000);
});
