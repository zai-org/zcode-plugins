import { describe, expect, it } from "vitest";
import { findDuplicates, normalizeRow, type Mapping } from "../src/clean.ts";
import { toVcf } from "../src/server.ts";

const mapping: Mapping = { 姓名: "name", 手机: "phone", 邮箱: "email", 公司: "company" } as Mapping;

describe("TEST-FINDINGS #3: large lists stay fast", () => {
  it("dedupes 20,000 rows with common Chinese surnames in under 10 s and keeps exact-name matches", () => {
    const rows = Array.from({ length: 20000 }, (_, i) =>
      normalizeRow("big.csv", i + 2, { 姓名: `${"张王李"[i % 3]}${i % 7000}`, 手机: `138${String(i).padStart(8, "0")}`, 邮箱: `u${i % 15000}@例子.cn`, 公司: `公司${i % 50}` }, mapping));
    const t0 = Date.now();
    const d = findDuplicates(rows);
    expect(Date.now() - t0).toBeLessThan(10000);
    // 邮箱 u0..u4999 各出现两次，姓名不同 → 应作为“可能重复”列出，而不是自动合并
    expect(d.groups.length).toBe(20000);
    expect(d.possible.length).toBeGreaterThan(0);
  }, 60000);
  it("still pairs two rows with the same Chinese name and same company", () => {
    const a = normalizeRow("a.csv", 2, { 姓名: "陈建国", 手机: "13900000001", 邮箱: "", 公司: "青禾科技有限公司" }, mapping);
    const b = normalizeRow("b.csv", 2, { 姓名: "陈建国", 手机: "13700000002", 邮箱: "", 公司: "青禾科技" }, mapping);
    expect(findDuplicates([a, b]).possible.map((p) => p.reason)).toEqual([expect.stringContaining("same name")]);
  });
});

describe("DRYRUN: vCard export", () => {
  it("writes valid vCard 3.0 with escaping, CJK names and folded long lines", () => {
    const base = { name: "", phone: "", phone2: "", email: "", email2: "", company: "", title: "", city: "", wechat: "", notes: "" };
    const v = toVcf([
      { ...base, name: "王晓明", phone: "+86 139 1234 5678", email: "wang@公司.cn", company: "青禾, 科技; 有限公司", city: "上海", wechat: "wxm88", notes: "第一行\n第二行" },
      { ...base, name: "John Smith", phone: "+1 415-555-0132", notes: "长".repeat(60) },
    ]);
    const cards = v.split("END:VCARD\r\n").filter(Boolean);
    expect(cards).toHaveLength(2);
    expect(v).toContain("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:王晓明\r\nN:王;晓明;;;\r\n");
    expect(v).toContain("TEL;TYPE=CELL:+86 139 1234 5678");
    expect(v).toContain("EMAIL;TYPE=INTERNET:wang@公司.cn");
    expect(v).toContain("ORG:青禾\\, 科技\\; 有限公司");
    expect(v).toContain("NOTE:WeChat: wxm88\\n第一行\\n第二行");
    expect(v).toContain("N:Smith;John;;;");
    for (const line of v.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(v.replace(/\r\n /g, "")).toContain("NOTE:" + "长".repeat(60));
    expect(v.endsWith("\r\n")).toBe(true);
  });
});
