import { describe, it, expect, vi, afterEach } from "vitest";
import { shallowReactive } from "vue";
import type { Editor, EditorState } from "@open-pencil/core/editor";
import { createDocumentController } from "#ui/document.ts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn(), call: vi.fn(), export: vi.fn() }));
vi.mock("#ui/host.ts", () => ({
  readDesignBytes: mocks.read,
  call: mocks.call,
  bytesToBase64: () => "UEs=",
}));
vi.mock("#ui/fonts.ts", () => ({ ensureGraphFonts: vi.fn() }));
vi.mock("@open-pencil/core/io", () => ({ parseFigFile: mocks.parse, exportFigFile: mocks.export }));
vi.mock("@open-pencil/pen", () => ({ parsePenFile: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fixture() {
  const state = shallowReactive({ sceneVersion: 0, currentPageId: "page" }) as EditorState;
  const graph = { getPages: () => [{ id: "page" }], getNode: () => ({ childIds: [] }) };
  const editor = {
    graph,
    replaceGraph: vi.fn(),
    requestRender: vi.fn(),
    zoomToFit: vi.fn(),
  } as unknown as Editor;
  mocks.call.mockResolvedValue({});
  mocks.read.mockImplementation(async (id: string) => ({
    bytes: new Uint8Array([1]),
    meta: { format: "fig", document: { id, revision: 1 } },
  }));
  return { graph, editor, state, documents: createDocumentController(editor, state) };
}
afterEach(() => vi.clearAllMocks());
describe("工作区文档身份", () => {
  it("冲突时普通保存不能覆盖外部修改，必须明确选择保留当前版本", async () => {
    const f = fixture();
    await f.documents.bind({
      id: "conflict",
      revision: 4,
      name: "conflict",
      path: "conflict.fig",
      owner: "file",
      uri: "ui://openpencil/design/conflict",
    });
    await f.documents.onExternalChange(5);
    mocks.call.mockClear();
    await f.documents.save();
    expect(mocks.call).not.toHaveBeenCalledWith("save_design", expect.anything());
    expect(f.documents.status.value).toBe("conflict");
    mocks.export.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
    mocks.call.mockResolvedValue({ document: { revision: 5 } });
    await f.documents.resolveConflict("keep-mine");
    expect(mocks.call).toHaveBeenCalledWith(
      "save_design",
      expect.objectContaining({ documentId: "conflict", expectedRevision: 5 }),
    );
    f.documents.dispose();
  });
  it("旧解析请求晚于新文档返回时，不覆盖新画布", async () => {
    const f = fixture();
    const firstParse = deferred<typeof f.graph>();
    const started = deferred<void>();
    mocks.parse
      .mockImplementationOnce(() => {
        started.resolve();
        return firstParse.promise;
      })
      .mockResolvedValueOnce(f.graph);
    const first = f.documents.load({ id: "first" });
    const rejected = expect(first).rejects.toMatchObject({ code: "superseded" });
    await started.promise;
    await f.documents.load({ id: "second" });
    firstParse.resolve(f.graph);
    await rejected;
    expect(f.editor.replaceGraph).toHaveBeenCalledTimes(1);
    expect(f.documents.current.value?.id).toBe("second");
    f.documents.dispose();
  });
  it("另存为绑定文件时保留画布，再使用新 revision 写入", async () => {
    const f = fixture();
    await f.documents.bind({
      id: "new",
      revision: 4,
      name: "new",
      path: "new.fig",
      owner: "file",
      uri: "ui://openpencil/design/new",
    });
    expect(f.editor.replaceGraph).not.toHaveBeenCalled();
    expect(f.documents.isDirty()).toBe(true);
    mocks.export.mockResolvedValue(new Uint8Array([0x50, 0x4b]));
    mocks.call.mockResolvedValue({ document: { revision: 5 } });
    await f.documents.save();
    expect(mocks.call).toHaveBeenCalledWith("save_design", {
      documentId: "new",
      expectedRevision: 4,
      base64: "UEs=",
    });
    expect(f.documents.status.value).toBe("saved");
    f.documents.dispose();
  });
});
