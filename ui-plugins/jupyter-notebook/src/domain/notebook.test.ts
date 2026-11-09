import { describe, expect, it } from "vitest";
import { JupyterError, type Cell } from "#nb/contract.ts";
import {
  applyOperations,
  normalizeNotebook,
  serializeNotebook,
  splitLines,
} from "#nb/domain/notebook.ts";

const raw = {
  nbformat: 4,
  nbformat_minor: 4,
  metadata: { kernelspec: { name: "python3" } },
  cells: [
    { cell_type: "markdown", metadata: {}, source: ["# T\n", "text"] },
    {
      id: "dup",
      cell_type: "code",
      metadata: { tags: ["x"] },
      execution_count: 3,
      source: "a = 1",
      outputs: [
        { output_type: "stream", name: "stdout", text: ["a\n", "b\n"] },
        {
          output_type: "execute_result",
          execution_count: 3,
          metadata: {},
          data: { "text/plain": ["1"], "application/json": { a: [1, 2] }, "image/png": ["aGVs\n", "bG8="] },
        },
        { output_type: "bogus" },
      ],
    },
    { id: "dup", cell_type: "raw", metadata: {}, source: "r" },
    { id: "bad id!", cell_type: "weird", source: "" },
  ],
};

const cells = (...sources: string[]): Cell[] =>
  sources.map((source, index) => ({
    id: `c${index}`,
    type: "code",
    source,
    revision: 1,
    executionCount: null,
    outputs: [],
    metadata: {},
    run: null,
  }));

describe("normalizeNotebook", () => {
  const nb = normalizeNotebook(raw);

  it("joins multiline sources and text outputs but keeps JSON mimes", () => {
    expect(nb.cells[0]!.source).toBe("# T\ntext");
    const [stream, result] = nb.cells[1]!.outputs;
    expect(stream).toEqual({ output_type: "stream", name: "stdout", text: "a\nb\n" });
    expect(result?.output_type === "execute_result" && result.data).toEqual({
      "text/plain": "1",
      "application/json": { a: [1, 2] },
      "image/png": "aGVs\nbG8=",
    });
    expect(nb.cells[1]!.outputs).toHaveLength(2);
    expect(nb.cells[1]!.executionCount).toBe(3);
  });

  it("assigns missing, duplicate and invalid cell ids, and maps unknown types to raw", () => {
    const ids = nb.cells.map((cell) => cell.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[1]).toBe("dup");
    expect(ids[2]).not.toBe("dup");
    expect(ids[3]).toMatch(/^[0-9a-f]{8}$/);
    expect(nb.cells[3]!.type).toBe("raw");
  });

  it("rejects nbformat 3", () => {
    expect(() => normalizeNotebook({ nbformat: 3 })).toThrow(JupyterError);
  });

  it("round-trips to nbformat 4.5 with line arrays", () => {
    const out = serializeNotebook(nb) as { nbformat_minor: number; cells: Record<string, unknown>[] };
    expect(out.nbformat_minor).toBe(5);
    expect(out.cells[0]).toEqual({ id: nb.cells[0]!.id, cell_type: "markdown", metadata: {}, source: ["# T\n", "text"] });
    expect(out.cells[1]!.outputs).toEqual([
      { output_type: "stream", name: "stdout", text: ["a\n", "b\n"] },
      {
        output_type: "execute_result",
        execution_count: 3,
        metadata: {},
        data: { "text/plain": ["1"], "application/json": { a: [1, 2] }, "image/png": "aGVs\nbG8=" },
      },
    ]);
    expect(out.cells[2]).not.toHaveProperty("outputs");
    expect(normalizeNotebook(out).cells.map((cell) => cell.source)).toEqual(nb.cells.map((cell) => cell.source));
  });

  it("splits lines keeping newlines", () => {
    expect(splitLines("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("applyOperations", () => {
  it("inserts by index, after and before, and appends by default", () => {
    const result = applyOperations(cells("a", "b"), [
      { op: "insert", source: "end" },
      { op: "insert", index: 0, source: "first", type: "markdown" },
      { op: "insert", after: "c0", source: "after-a" },
      { op: "insert", before: "c1", source: "before-b", id: "mine" },
    ]);
    expect(result.cells.map((cell) => cell.source)).toEqual(["first", "a", "after-a", "before-b", "b", "end"]);
    expect(result.inserted).toHaveLength(4);
    expect(result.inserted[3]).toBe("mine");
    expect(result.cells[0]!.type).toBe("markdown");
    expect(result.contentChanged).toBe(true);
  });

  it("updates source with revision checks", () => {
    const base = cells("a");
    const updated = applyOperations(base, [{ op: "update", cellId: "c0", source: "b", expectedRevision: 1 }]);
    expect(updated.cells[0]).toMatchObject({ source: "b", revision: 2 });
    expect(base[0]!.source).toBe("a");
    expect(() =>
      applyOperations(updated.cells, [{ op: "update", cellId: "c0", source: "c", expectedRevision: 1 }]),
    ).toThrow(expect.objectContaining({ code: "revision_conflict" }));
    const same = applyOperations(updated.cells, [{ op: "update", cellId: "c0", source: "b" }]);
    expect(same.contentChanged).toBe(false);
    expect(same.cells[0]!.revision).toBe(2);
  });

  it("moves, deletes, changes type and clears outputs", () => {
    const base = cells("a", "b", "c");
    base[0]!.outputs = [{ output_type: "stream", name: "stdout", text: "x" }];
    base[0]!.executionCount = 4;
    base[2]!.outputs = [{ output_type: "stream", name: "stdout", text: "y" }];
    const result = applyOperations(base, [
      { op: "move", cellId: "c2", index: 0 },
      { op: "delete", cellId: "c1" },
      { op: "set_type", cellId: "c0", type: "markdown" },
      { op: "clear_outputs", cellId: "c2" },
    ]);
    expect(result.cells.map((cell) => [cell.id, cell.type, cell.outputs.length])).toEqual([
      ["c2", "code", 0],
      ["c0", "markdown", 0],
    ]);
    expect(result.cells[1]!.executionCount).toBeNull();
    const clearAll = applyOperations(base, [{ op: "clear_outputs" }]);
    expect(clearAll.cells.every((cell) => cell.outputs.length === 0)).toBe(true);
    expect(clearAll.contentChanged).toBe(false);
  });

  it("is atomic: a failing operation leaves nothing applied", () => {
    const base = cells("a");
    expect(() =>
      applyOperations(base, [
        { op: "insert", source: "new" },
        { op: "delete", cellId: "missing" },
      ]),
    ).toThrow(expect.objectContaining({ code: "cell_not_found" }));
    expect(base).toHaveLength(1);
  });

  it("validates positions, types and ids", () => {
    const base = cells("a");
    expect(() => applyOperations(base, [{ op: "insert", index: 5 }])).toThrow(/out of range/);
    expect(() => applyOperations(base, [{ op: "insert", index: 0, after: "c0" }])).toThrow(/at most one/);
    expect(() => applyOperations(base, [{ op: "insert", type: "sql" as never }])).toThrow(/Unknown cell type/);
    expect(() => applyOperations(base, [{ op: "insert", id: "c0" }])).toThrow(/already exists/);
    expect(() => applyOperations(base, [{ op: "nope" } as never])).toThrow(/Unknown operation/);
  });
});
