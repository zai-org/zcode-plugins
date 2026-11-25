import { describe, expect, it } from "vitest";
import { mkclient } from "./_mkclient.ts";

describe("TEST-FINDINGS #5: course_save explains a project without a video", () => {
  it("returns bad_project, not internal_error", async () => {
    const { call, text } = await mkclient("cvp-");
    for (const project of [{}, { video: "" }, { video: 3 }, { chapters: [{ title: "第一章", start: 0 }] }]) {
      const r = await call("course_save", { project });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("bad_project");
      expect(text(r)).not.toMatch(/internal_error|argument must be of type/);
    }
  });
});
