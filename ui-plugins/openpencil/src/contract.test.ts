import { describe, expect, it } from "vitest";
import {
  DESIGN_CHUNK_BYTES,
  DESIGN_URI_PREFIX,
  DesignError,
  designFormatOf,
} from "#openpencil/contract.ts";
import { designExample, designRefExample } from "#openpencil/contract.example.ts";
describe("OpenPencil contract", () => {
  it("设计稿分片经 base64 传输后仍在宿主 uiReadResource 8 MiB 边界内，引用带版本与资源 URI", () => {
    expect(Math.ceil((DESIGN_CHUNK_BYTES * 4) / 3)).toBeLessThan(8 * 1024 * 1024);
    expect(designRefExample).toMatchObject({
      id: designExample.id,
      revision: 1,
      owner: "file",
      uri: `${DESIGN_URI_PREFIX}${designExample.id}`,
    });
    expect(designFormatOf("designs/a.PEN")).toBe("pen");
    expect(() => designFormatOf("designs/a.svg")).toThrow(DesignError);
  });
});
