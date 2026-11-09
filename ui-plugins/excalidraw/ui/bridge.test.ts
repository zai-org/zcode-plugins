import { afterEach, describe, expect, it, vi } from "vitest";
import { outputRef } from "#ui/bridge.ts";

afterEach(() => vi.unstubAllGlobals());
const input = { id: "demo", expectedRevision: 4, path: "diagram.excalidraw" };
const output = { path: "/workspace/diagram.excalidraw", revision: 4 };
function resolve(toolInput: unknown, toolOutput: unknown, toolCancelled: unknown = null) {
  vi.stubGlobal("window", { __pluginClient: { toolInput, toolOutput, toolCancelled } });
  return outputRef();
}

describe("画板工具结果恢复", () => {
  it("文档引用优先于另一工具的输入", () => {
    const document = { id: "original", revision: 3 };
    expect(resolve(input, { document })).toEqual(document);
  });
  it.each([
    ["相对路径", "diagram.excalidraw", "/workspace/diagram.excalidraw"],
    ["绝对路径", "/workspace/diagram.excalidraw", "/workspace/diagram.excalidraw"],
    ["Windows", "C:\\workspace\\diagram.excalidraw", "C:\\workspace\\diagram.excalidraw"],
    ["当前目录", "./diagram.excalidraw", "/workspace/diagram.excalidraw"],
  ])("兼容旧导出结果：%s", (_name, requested, exported) => {
    expect(resolve({ ...input, path: requested }, { ...output, path: exported })).toEqual({
      id: "demo",
      revision: 4,
    });
  });
  it.each([
    ["输入先到", input, undefined],
    ["失败结果", input, { ...output, error: { code: "revision_conflict" } }],
    ["无文档输入", { path: input.path, expectedRevision: 4 }, output],
    ["非法文档 ID", { ...input, id: "../other" }, output],
    ["版本不同", { ...input, expectedRevision: 5 }, output],
    ["路径不同", { ...input, path: "other.excalidraw" }, output],
    ["绝对路径不同", { ...input, path: "/other/diagram.excalidraw" }, output],
    ["非导出结果", input, { revision: 4 }],
  ])("%s 不推断文档", (_name, args, result) => {
    expect(resolve(args, result)).toBeNull();
  });
  it("取消后的旧导出结果不与新输入拼成引用", () => {
    expect(resolve(input, output, { reason: "cancelled" })).toBeNull();
  });
  it("已打开页面禁用旧格式推断，但仍接受明确的新文档引用", () => {
    resolve(input, output);
    expect(outputRef(false)).toBeNull();
    resolve(input, { document: { id: "other", revision: 1 } });
    expect(outputRef(false)).toEqual({ id: "other", revision: 1 });
  });
});
