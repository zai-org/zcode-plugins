import { describe, expect, it } from "vitest";
import { detect } from "../src/detect.ts";
import { normalizeSettings } from "../src/server.ts";

describe("TEST-FINDINGS #1: emails with Chinese (IDN) domains", () => {
  const kinds = ["email"] as const;
  it("finds IDN and ASCII emails and stops at the following Chinese text", () => {
    const t = "邮箱 wang@公司.cn联系我；备用 li@例子.中国。英文 a.b@company.cn, x@xn--fiqs8s.cn";
    const v = detect(t, { kinds: [...kinds], keywords: [] }).map((h) => h.value);
    expect(v).toEqual(["wang@公司.cn", "li@例子.中国", "a.b@company.cn", "x@xn--fiqs8s.cn"]);
  });
  it("does not treat a bare @ mention or trailing dot as an email", () => {
    expect(detect("找 @张三 聊聊。结尾 a@b.", { kinds: [...kinds], keywords: [] })).toEqual([]);
  });
});

describe("DRYRUN: keyword lines pasted from a TSV use the first column", () => {
  it("splits on tabs (array and string forms)", () => {
    expect(normalizeSettings({ keywords: ["王晓明\t13912345678\t110105", "陈建国\t139"] }).keywords).toEqual(["王晓明", "陈建国"]);
    expect(normalizeSettings({ keywords: "王晓明\t139\n陈建国\t138\r\nACME" }).keywords).toEqual(["王晓明", "陈建国", "ACME"]);
    const hits = detect("合同由王晓明签署，陈建国见证。", { kinds: [], keywords: normalizeSettings({ keywords: ["王晓明\t139", "陈建国\t138"] }).keywords });
    expect(hits.map((h) => h.value)).toEqual(["王晓明", "陈建国"]);
  });
});
