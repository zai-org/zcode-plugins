import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generalize, hash, partial, scrub } from "../src/mask.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("mask", () => {
  it("masks each kind", () => {
    expect(partial("13800001234", "phone")).toBe("138****1234");
    expect(partial("lin.xm@qinghe.cn", "email")).toBe("l***@qinghe.cn");
    expect(partial("31010119851212452X", "idcard")).toBe("310101********452X");
    expect(partial("6222021234567890123", "bankcard")).toBe("**** **** **** 0123");
    expect(partial("林小满", "name")).toBe("林**");
    expect(partial("Alex Wong", "name")).toBe("A*** W***");
    expect(generalize("1990-03-07", "date")).toBe("1990");
    expect(generalize("浙江省杭州市西湖区文三路100号", "address")).toBe("浙江省杭州市西湖区");
    expect(generalize("1280.5", "number")).toBe("1000-2000");
    expect(scrub("手机 13800001234，邮箱 chen@xiaoman.cn")).toBe("手机 138****1234，邮箱 c***@xiaoman.cn");
    expect(hash("13800001234", "k1")).toBe(hash("13800001234", "k1"));
    expect(hash("13800001234", "k1")).not.toBe(hash("13800001234", "k2"));
  });
});

describe("mask tools", () => {
  it("detects columns, masks consistently and warns about leaks", async () => {
    const root = await mkdtemp(join(tmpdir(), "mask-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("mask_open", { inputs: ["会员数据-给外包.csv"], project: "out" });
    expect(o.data.rows.map((r: { method: string }) => r.method)).toEqual(["keep", "pseudonym", "partial", "partial", "partial", "partial", "generalize", "generalize", "keep", "scrub"]);
    expect(String(o.data.settings.salt).length).toBeGreaterThanOrEqual(8);
    expect(o.data.stats.warnings).toBe(0);
    const w = await c.call("mask_edit", { project: "out", set: [{ row: 9, values: { method: "keep" } }, { row: 2, values: { method: "hash" } }, { row: 4, values: { method: "drop" } }] });
    expect(w.data.issues[0].message).toMatch(/备注: the output still contains phone, email/);
    await c.call("mask_edit", { project: "out", set: [{ row: 9, values: { method: "scrub" } }] });
    await c.call("mask_export", { project: "out" });
    const csv = (await readFile(join(root, "dataset-masker/out/masked.csv"), "utf8")).replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(","));
    expect(csv[0]).toEqual(["会员ID", "姓名", "手机号", "邮箱", "银行卡", "生日", "收货地址", "消费金额", "备注"]);
    expect(csv[1][1]).toBe("用户0001");
    expect(csv[4][1]).toBe("用户0001");
    expect(csv[1][2]).toMatch(/^[0-9a-f]{16}$/);
    expect(csv[1][2]).toBe(csv[4][2]);
    expect(csv[1][8]).toBe("老客户 手机 138****1234 改过");
    const all = await readFile(join(root, "dataset-masker/out/masked.csv"), "utf8");
    for (const secret of ["13800001234", "330106199003071234", "林小满", "lin.xm@", "文三路"]) expect(all).not.toContain(secret);
    const report = await readFile(join(root, "dataset-masker/out/masking-report.md"), "utf8");
    expect(report).toMatch(/身份证号 \| idcard \| 删除列 \(drop\)/);
    expect(report).not.toContain(o.data.settings.salt);
  });
});
