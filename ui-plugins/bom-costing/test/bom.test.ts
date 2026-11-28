import { cp, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connect } from "../src/kit/testing.ts";
import { createServer, parseBuild } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("rules", () => {
  it("reads a build plan", () => {
    expect(parseBuild("LAMP-01=300，LAMP-02 × 150")).toEqual([{ code: "LAMP-01", qty: 300 }, { code: "LAMP-02", qty: 150 }]);
  });
});

describe("tools", () => {
  it("costs a two-level BOM and plans purchases", async () => {
    const root = await mkdtemp(join(tmpdir(), "bom-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("bom_open", { inputs: ["台灯BOM"], project: "lamp" });
    expect(o.text).toMatch(/15 item\(s\), 20 BOM line\(s\)/);
    expect(o.text).toMatch(/component “P-OO5” isn't in the item list — did you mean P-005 \(PC 灯罩\)\?/);
    expect(o.text).toMatch(/SUB-BASE → P-003 is listed twice/);
    expect(o.text).toMatch(/P-008 18650 锂电池: no price, so LAMP-02 can't be costed/);
    expect(o.text).toMatch(/P-011 旧款拨动开关 isn't used/);
    expect(o.text).toMatch(/has a build plan \(LAMP-01=300, LAMP-02=150\)/);
    const rows = (await c.call("bom_status", { project: "lamp" })).data.rows as Record<string, string>[];
    const bomAt = (pa: string, ch: string, nth = 0) => rows.map((r, i) => [r, i] as const).filter(([r]) => r.kind === "bom" && r.parent === pa && r.child === ch)[nth][1];
    const itemAt = (code: string) => rows.findIndex((r) => r.kind === "item" && r.code === code);
    await c.call("bom_edit", { project: "lamp", set: [
      { row: bomAt("SUB-HEAD", "P-OO5"), values: { child: "P-005" } }, { row: bomAt("SUB-BASE", "P-003", 1), values: { include: false } }, { row: itemAt("P-008"), values: { price: 21.5 } },
    ], settings: { build: "LAMP-01=300, LAMP-02=150" } });
    const st = await c.call("bom_status", { project: "lamp" });
    expect(st.text).not.toMatch(/isn't in the item list|listed twice|no price/);
    expect(st.text).toMatch(/Unit cost: LAMP-01 ¥82\.81, LAMP-02 ¥128\.81/);
    const r2 = st.data.rows as Record<string, string>[];
    expect(r2[itemAt("SUB-BASE")]._need).toBe("需做 410");
    expect(r2[itemAt("P-002")]._need).toBe("需 119，买 500");
    expect(r2[itemAt("P-004")]._need).toBe("需 314，买 400");
    expect(r2[itemAt("P-001")]._need).toBe("需 335，买 350");
    expect(r2[itemAt("P-007")]._need).toBe("库存够");
    await c.call("bom_export", { project: "lamp" });
    expect((await readdir(join(root, "bom-costing/lamp"))).sort()).toEqual(["cost-sheets.pdf", "costed-bom.xlsx", "purchase-list.csv"]);
    expect(await readFile(join(root, "bom-costing/lamp/purchase-list.csv"), "utf8")).toMatch(/能动电池,P-008,18650 锂电池,300,300,21.5,6450.00,20/);
  }, 120_000);
});
