import { describe, expect, it } from "vitest";
import { LIMITS, type Output } from "#nb/contract.ts";
import { applyControlChars, capText, reduceOutput, updateDisplay, type OutputState } from "#nb/domain/outputs.ts";

const empty: OutputState = { outputs: [], clearPending: false };
const run = (...messages: [string, Record<string, unknown>][]) =>
  messages.reduce((state, [type, content]) => reduceOutput(state, type, content), empty);

describe("reduceOutput", () => {
  it("merges consecutive stream chunks of the same name", () => {
    const state = run(
      ["stream", { name: "stdout", text: "a" }],
      ["stream", { name: "stdout", text: "b\n" }],
      ["stream", { name: "stderr", text: "e" }],
      ["stream", { name: "stdout", text: "c" }],
    );
    expect(state.outputs).toEqual([
      { output_type: "stream", name: "stdout", text: "ab\n" },
      { output_type: "stream", name: "stderr", text: "e" },
      { output_type: "stream", name: "stdout", text: "c" },
    ]);
  });

  it("handles carriage-return progress output", () => {
    const state = run(
      ["stream", { name: "stdout", text: "10%\r" }],
      ["stream", { name: "stdout", text: "50%\r" }],
      ["stream", { name: "stdout", text: "100%\ndone\n" }],
    );
    expect((state.outputs[0] as { text: string }).text).toBe("100%\ndone\n");
  });

  it.each([
    ["Hello\rWo", "Wollo"],
    ["Hello\rWorld!\rX\nnext", "Xorld!\nnext"],
    ["Hello\rWo\brld\n", "Wrld\n"],
    ["first\r\nsecond\rXY", "first\nXYcond"],
  ])("renders every split of %j identically", (text, expected) => {
    for (let split = 0; split <= text.length; split++) {
      const state = run(
        ["stream", { text: text.slice(0, split) }],
        ["stream", { text: text.slice(split) }],
      );
      expect(state.outputs).toEqual([{ output_type: "stream", name: "stdout", text: expected }]);
    }
    expect(run(...Array.from(text, (char): [string, Record<string, unknown>] => ["stream", { text: char }])).outputs)
      .toEqual([{ output_type: "stream", name: "stdout", text: expected }]);
  });

  it("does not reuse a cursor after another output or clearing", () => {
    const first = run(["stream", { text: "Hello\rW" }]);
    for (const message of [
      ["stream", { name: "stderr", text: "error" }],
      ["display_data", { data: { "text/plain": "display" } }],
      ["clear_output", { wait: false }],
      ["clear_output", { wait: true }],
    ] as [string, Record<string, unknown>][]) {
      const state = reduceOutput(reduceOutput(first, ...message), "stream", { text: "o" });
      expect(state.outputs.at(-1)).toEqual({ output_type: "stream", name: "stdout", text: "o" });
    }
    // A branch must not mutate the original state's continuation.
    expect(reduceOutput(first, "stream", { text: "o" }).outputs[0])
      .toEqual({ output_type: "stream", name: "stdout", text: "Wollo" });
  });

  it("keeps long stream output bounded while continuing at the retained head", () => {
    const state = run(
      ["stream", { text: "a".repeat(LIMITS.streamChars + 100) + "\rW" }],
      ["stream", { text: "o" }],
    );
    const output = state.outputs[0] as { text: string };
    expect(output.text.startsWith("Woaa")).toBe(true);
    expect(output.text).toContain("characters omitted");
    expect(output.text.length).toBeLessThan(LIMITS.streamChars + 100);
    const overwritten = reduceOutput(state, "stream", { text: "\rX\bY" });
    expect((overwritten.outputs[0] as { text: string }).text.startsWith("Yaaa")).toBe(true);
  });

  it("clears immediately, or on the next output with wait", () => {
    expect(run(["stream", { name: "stdout", text: "a" }], ["clear_output", { wait: false }]).outputs).toEqual([]);
    const waiting = run(["stream", { name: "stdout", text: "a" }], ["clear_output", { wait: true }]);
    expect(waiting.outputs).toHaveLength(1);
    expect(waiting.clearPending).toBe(true);
    const next = reduceOutput(waiting, "display_data", { data: { "text/plain": ["x"] }, metadata: {} });
    expect(next).toEqual({
      outputs: [{ output_type: "display_data", data: { "text/plain": "x" }, metadata: {} }],
      clearPending: false,
    });
  });

  it("records results, errors and display ids", () => {
    const state = run(
      ["execute_result", { data: { "text/plain": "2" }, metadata: {}, execution_count: 7 }],
      ["display_data", { data: { "text/html": "<b>" }, metadata: {}, transient: { display_id: "d1" } }],
      ["error", { ename: "E", evalue: "v", traceback: ["t1", "t2"] }],
      ["unknown", {}],
    );
    expect(state.outputs.map((output) => output.output_type)).toEqual(["execute_result", "display_data", "error"]);
    expect((state.outputs[0] as { execution_count: number }).execution_count).toBe(7);
    expect((state.outputs[1] as { transient: unknown }).transient).toEqual({ display_id: "d1" });
  });
});

describe("updateDisplay", () => {
  it("replaces data of matching display outputs only", () => {
    const outputs: Output[] = [
      { output_type: "display_data", data: { "text/plain": "old" }, metadata: {}, transient: { display_id: "d" } },
      { output_type: "display_data", data: { "text/plain": "other" }, metadata: {} },
    ];
    const next = updateDisplay(outputs, "d", { data: { "text/plain": "new" }, metadata: { m: 1 } });
    expect(next?.[0]).toMatchObject({ data: { "text/plain": "new" }, metadata: { m: 1 } });
    expect(next?.[1]).toBe(outputs[1]);
    expect(updateDisplay(outputs, "zzz", { data: {} })).toBeNull();
  });
});

describe("text helpers", () => {
  it("applies carriage returns and backspaces", () => {
    expect(applyControlChars("abc\rX")).toBe("Xbc");
    expect(applyControlChars("line\r\nnext")).toBe("line\nnext");
    expect(applyControlChars("ab\bc")).toBe("ac");
  });
  it("caps long text keeping head and tail", () => {
    const capped = capText("a".repeat(50) + "b".repeat(50), 20);
    expect(capped.startsWith("aaaaaaaa")).toBe(true);
    expect(capped.endsWith("bbbbbbbbbbbb")).toBe(true);
    expect(capped).toContain("80 characters omitted");
  });
});
