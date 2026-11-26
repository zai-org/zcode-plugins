import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanText } from "../src/scan.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const T = ["TODO", "FIXME", "HACK", "XXX", "BUG"];

describe("scan", () => {
  it("finds comments, not strings", () => {
    const h = scanText("a.ts", 'x(); // TODO(amy): one\nconst s = "TODO: no";\n/* FIXME @bob: two */\n  # XXX three\n// todo: four\n//   continues here\n', T);
    expect(h.map((x) => [x.line, x.tag, x.owner, x.text])).toEqual([[1, "TODO", "amy", "one"], [3, "FIXME", "bob", "two"], [4, "XXX", "", "three"], [5, "TODO", "", "four continues here"]]);
    expect(scanText("r.md", "- [ ] TODO not code\n<!-- TODO: yes -->", T).map((x) => x.text)).toEqual(["yes"]);
    expect(scanText("a.py", "# TODO 紧急 修复 !!!", T)[0]).toMatchObject({ urgent: true, text: "紧急 修复" });
  });
});

describe("todo tools", () => {
  it("collects from a folder with git blame", async () => {
    const root = await mkdtemp(join(tmpdir(), "todo-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_DATE: "2025-01-02T10:00:00+08:00", GIT_COMMITTER_DATE: "2025-01-02T10:00:00+08:00" };
    for (const a of [["init", "-q"], ["add", "."], ["-c", "user.name=林小满", "-c", "user.email=l@e.com", "commit", "-qm", "init"]]) execFileSync("git", a, { cwd: root, env });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("todos_open", { inputs: ["shop-app"], project: "s" });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(rows.map((r) => `${r._where} ${r.tag} ${r.priority} ${r.owner}`)).toEqual([
      "shop-app/scripts/deploy.sh:2 XXX low ",
      "shop-app/src/api/orders.py:2 TODO high lin",
      "shop-app/src/api/orders.py:3 BUG high ",
      "shop-app/src/cart.ts:2 TODO normal ",
      "shop-app/src/cart.ts:4 FIXME high zhouning",
      "shop-app/src/cart.ts:5 HACK low ",
      "shop-app/src/cart.ts:8 TODO normal ",
      "shop-app/src/index.html:1 TODO normal ",
    ]);
    expect(rows[1]).toMatchObject({ text: "分页参数校验", author: "林小满", date: "2025-01-02" });
    expect(o.text).toMatch(/has been there \d+ days/);
    await c.call("todos_edit", { project: "s", set: [{ row: 3, values: { owner: "chen", priority: "high" } }, { row: 0, values: { include: false } }], settings: { groupBy: "owner" } });
    await c.call("todos_export", { project: "s" });
    const md = await readFile(join(root, "todo-collector/s/TODO.md"), "utf8");
    expect(md).toContain("## chen (1)\n\n- [ ] **TODO** apply member discount before coupons ([shop-app/src/cart.ts:2](shop-app/src/cart.ts#L2)) · 2025-01-02");
    expect(md).not.toContain("sleep");
    const csv = await readFile(join(root, "todo-collector/s/todos.csv"), "utf8");
    expect(csv.split("\r\n")[0]).toBe("\uFEFFtitle,priority,owner,tag,file,line,author,date,age_days");
    expect(csv).toContain("floating point rounding on ¥0.1 items,high,zhouning,FIXME,shop-app/src/cart.ts,4,林小满,2025-01-02,");
    const n = await c.call("todos_edit", { project: "s", settings: { tags: "NOTE" } });
    expect(n.data.rows.length).toBe(1);
  });
});
