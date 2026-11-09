import { describe, expect, it } from "vitest";
import type { Cell, NotebookDoc } from "#nb/contract.ts";
import { collectImages, outputText, renderNotebook } from "#nb/domain/summary.ts";

const code = (id: string, source: string, outputs: Cell["outputs"] = [], extra: Partial<Cell> = {}): Cell => ({
  id,
  type: "code",
  source,
  revision: 1,
  executionCount: null,
  outputs,
  metadata: {},
  run: null,
  ...extra,
});

const doc = (cells: Cell[]): NotebookDoc => ({
  id: "nb-1",
  serverId: "127.0.0.1:8888",
  path: "a.ipynb",
  name: "a.ipynb",
  revision: 3,
  version: 9,
  cells,
  metadata: {},
  nbformat: 4,
  nbformatMinor: 5,
  kernel: { status: "idle", name: "python3", displayName: "Python 3", language: "python", id: "k" },
  save: { state: "saved", savedAt: 1, error: null },
});

describe("outputText", () => {
  it("strips ANSI from streams and tracebacks", () => {
    expect(outputText({ output_type: "stream", name: "stderr", text: "\x1b[31mred\x1b[0m" })).toBe("[stderr]\nred");
    expect(
      outputText({ output_type: "error", ename: "ValueError", evalue: "bad", traceback: ["\x1b[1mline\x1b[0m"] }),
    ).toBe("[error] ValueError: bad\nline");
  });
  it("prefers text over html and notes images and widgets", () => {
    expect(
      outputText({
        output_type: "execute_result",
        execution_count: 2,
        metadata: {},
        data: { "text/plain": "df", "text/html": "<table>" },
      }),
    ).toBe("[Out[2]] df");
    expect(
      outputText({ output_type: "display_data", metadata: {}, data: { "text/html": "<p>a&amp;b</p><script>x</script>" } }),
    ).toBe("[display] a&b");
    expect(
      outputText({ output_type: "display_data", metadata: {}, data: { "image/png": "AAA", "text/plain": "<Figure>" } }),
    ).toBe("[display] (image/png image)\n<Figure>");
    expect(
      outputText({
        output_type: "display_data",
        metadata: {},
        data: { "application/vnd.jupyter.widget-view+json": {}, "text/plain": "IntSlider" },
      }),
    ).toContain("widget");
  });
});

describe("renderNotebook", () => {
  const nb = doc([
    code("a", "print(1)", [{ output_type: "stream", name: "stdout", text: "1\n" }], {
      executionCount: 1,
      run: { state: "ok", runId: "r", by: "agent", seq: 1, batch: "b", queuedAt: 0 },
    }),
    { ...code("m", "# Title"), type: "markdown" },
    code("b", "x = '```'"),
  ]);

  it("lists cells with ids, revisions, run state and outputs", () => {
    const text = renderNotebook(nb);
    expect(text).toContain("Notebook `a.ipynb` (id nb-1) on server 127.0.0.1:8888: revision 3, 3 cells.");
    expect(text).toContain("### [0] code id=a rev=1 exec=1 ok\n```python\nprint(1)\n```\nOutputs:\n[stdout]\n1");
    expect(text).toContain("### [1] markdown id=m rev=1\n```markdown\n# Title\n```");
    expect(text).toContain("### [2] code id=b rev=1 not run\n````python");
  });

  it("filters by cell id and reports unknown ids", () => {
    const text = renderNotebook(nb, { cellIds: ["b", "zz"] });
    expect(text).not.toContain("id=a");
    expect(text).toContain("id=b");
    expect(text).toContain("No cells with ids: zz.");
  });

  it("stays within the budget and says what was left out", () => {
    const big = doc(Array.from({ length: 10 }, (_, i) => code(`c${i}`, "x".repeat(500))));
    const text = renderNotebook(big, { budget: 2_000 });
    expect(text.length).toBeLessThan(2_600);
    expect(text).toMatch(/more cell\(s\) not shown/);
  });

  it("clips long outputs per cell", () => {
    const long = doc([code("a", "", [{ output_type: "stream", name: "stdout", text: "y".repeat(5_000) }])]);
    expect(renderNotebook(long, { maxOutputChars: 100 })).toContain("characters omitted");
  });
});

describe("collectImages", () => {
  it("returns bitmap images up to the limit", () => {
    const image = { output_type: "display_data" as const, metadata: {}, data: { "image/png": "AA\nAA" } };
    const images = collectImages([code("a", "", [image, image]), code("b", "", [image])], 2);
    expect(images).toEqual([
      { cellId: "a", mimeType: "image/png", data: "AAAA" },
      { cellId: "a", mimeType: "image/png", data: "AAAA" },
    ]);
  });
});
