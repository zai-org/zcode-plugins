import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { check, parseRules } from "../src/rules.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const R = (s: string) => parseRules(`x: ${s}`).cols[0].rules[0];

describe("rules", () => {
  it("parses and checks", () => {
    expect(parseRules("a: required, in(甲|乙), regex(^\\d{2,3}$)").cols[0].rules.map((r) => r.kind)).toEqual(["required", "in", "regex"]);
    expect(parseRules("a: bogus").errors[0]).toMatch(/unknown rule/);
    expect(check("2025-13-01", R("date"))).toMatch(/date/);
    expect(check("2026-02-29", R("date"))).toMatch(/date/);
    expect(check("2024-02-29", R("date"))).toBeUndefined();
    expect(check("-5", R("number 0..100"))).toMatch(/below 0/);
    expect(check("1391111222", R("phone"))).toMatch(/mobile/);
    expect(check("+86 138 0000 1234", R("phone"))).toBeUndefined();
    expect(check("a@b", R("email"))).toMatch(/email/);
    expect(check("12345", R("length<=4"))).toMatch(/length/);
    expect(check("ABC-001", R("regex(^[A-Z]{3}-\\d{3}$)"))).toBeUndefined();
    expect(check("2019-01-01", R("after 2020-01-01"))).toMatch(/before/);
  });
});

describe("validate tools", () => {
  it("suggests rules, finds problems, re-checks after fixes", async () => {
    const root = await mkdtemp(join(tmpdir(), "validate-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("validate_open", { inputs: ["员工花名册.csv"], project: "hr" });
    expect(o.data.settings.rules).toMatch(/^工号: required, unique$/m);
    expect(o.data.settings.rules).toMatch(/^邮箱: required, email$/m);
    expect(o.data.settings.rules).toMatch(/^月薪: required, number/m);
    const rules = "工号: required, unique\n姓名: required\n部门: in(市场部|设计部|研发部|销售部)\n手机: phone\n邮箱: email\n入职日期: date\n月薪: number 3000..100000";
    const e = await c.call("validate_edit", { project: "hr", settings: { rules } });
    expect(e.data.stats).toMatchObject({ rows: 6, badRows: 5, ruleErrors: 0 });
    expect(e.data.rows[1]._errors).toMatch(/工号: 重复.*手机: 手机号不对.*入职日期: 不是有效日期/);
    const f = await c.call("validate_edit", { project: "hr", set: [{ row: 1, values: { c0: "E004", c3: "13911112222", c5: "2025-12-01" } }, { row: 2, values: { c1: "陈晓", c4: "chen@penova.example" } }, { row: 3, values: { c6: "15000" } }, { row: 4, values: { c2: "销售部" } }] });
    expect(f.data.stats).toMatchObject({ badRows: 1, problems: 1 });
    await c.call("validate_export", { project: "hr" });
    expect(await readFile(join(root, "sheet-validator/hr/errors.csv"), "utf8")).toMatch(/月薪,二万,不是数字/);
    expect((await readFile(join(root, "sheet-validator/hr/valid-rows.csv"), "utf8")).trim().split("\r\n")).toHaveLength(6);
    const bad = await c.call("validate_edit", { project: "hr", settings: { rules: "城市: required" } });
    expect(bad.data.issues[0]).toMatchObject({ level: "error", key: "rules" });
  });
});
