import { describe, expect, it } from "vitest";
import { MAX_SCENE_BYTES } from "#excalidraw/contract.ts";
import { commitExample } from "#excalidraw/contract.example.ts";
describe("Excalidraw contract", () => {
  it("持久化内容受资源读取边界约束，提交包含版本与幂等键", () => {
    expect(MAX_SCENE_BYTES).toBeLessThan(8 * 1024 * 1024);
    expect(commitExample).toMatchObject({ expectedRevision: 1, operationId: "edit-1" });
  });
});
