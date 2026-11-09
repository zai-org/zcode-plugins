import { describe, expect, it } from "vitest";
import { WatchLog, parseDeps, parseDiagnostics, type WatchEvent } from "#t/typst/diagnostics.ts";

// 以下输出取自 typst 0.14.2。
const HINT = `error: unknown variable: a-b
  ┌─ h2.typ:3:1
  │
3 │ #a-b
  │  ^^^
  │
  = hint: if you meant to use subtraction, try adding spaces around the minus sign: \`a - b\`

`;

const TRACE = `warning: unknown font family: nope
  ┌─ h3.typ:1:16
  │
1 │ #set text(font: "Nope")
  │                 ^^^^^^

error: type integer has no method \`foo\`
  ┌─ h3.typ:3:14
  │
3 │ #let f(x) = x.foo()
  │               ^^^

help: error occurred in this call of function \`f\`
  ┌─ h3.typ:4:1
  │
4 │ #f(1)
  │  ^^^^

`;

describe("parseDiagnostics", () => {
  it("reads message, location and hints", () => {
    expect(parseDiagnostics(HINT)).toEqual([
      {
        severity: "error",
        message: "unknown variable: a-b",
        location: { file: "h2.typ", line: 3, column: 1 },
        hints: ["if you meant to use subtraction, try adding spaces around the minus sign: `a - b`"],
        trace: [],
      },
    ]);
  });

  it("attaches help entries to the previous diagnostic as a trace", () => {
    const diagnostics = parseDiagnostics(TRACE);
    expect(diagnostics.map((entry) => entry.severity)).toEqual(["warning", "error"]);
    expect(diagnostics[1]!.trace).toEqual([{ message: "error occurred in this call of function `f`", location: { file: "h3.typ", line: 4, column: 1 } }]);
  });

  it("handles diagnostics without a location, colours and path mapping", () => {
    const text = "\u001b[31merror\u001b[0m: file not found (searched at /x/missing.png)\nerror: other\n  ┌─ /abs/doc/a.typ:2:5\n";
    const diagnostics = parseDiagnostics(text, (path) => path.replace("/abs/", ""));
    expect(diagnostics[0]).toMatchObject({ message: "file not found (searched at /x/missing.png)", location: null });
    expect(diagnostics[1]!.location).toEqual({ file: "doc/a.typ", line: 2, column: 5 });
  });

  it("keeps package paths", () => {
    const [diagnostic] = parseDiagnostics("error: oops\n  ┌─ @preview/cetz:0.3.1/src/lib.typ:10:2\n");
    expect(diagnostic!.location!.file).toBe("@preview/cetz:0.3.1/src/lib.typ");
  });
});

describe("WatchLog", () => {
  const collect = () => {
    const events: WatchEvent[] = [];
    const log = new WatchLog((event) => events.push(event));
    return { events, log };
  };

  it("follows compile rounds of typst watch", () => {
    const { events, log } = collect();
    log.feed("watching doc/main.typ\nwriting to build/out.pdf\n\n[17:32:56] compiling ...\n\n");
    log.feed("watching doc/main.typ\nwriting to build/out.pdf\n\n[17:32:56] compiled successfully in 4.62 ms\n\n");
    log.feed("watching doc/main.typ\nwriting to build/out.pdf\n\n[17:32:57] compiling ...\n\nwatching doc/main.typ\nwriting to build/out.pdf\n\n[17:32:57] compiled with errors\n\n");
    // 诊断分块到达，直到下一轮开始或调用方 finalize。
    expect(log.feed(HINT.slice(0, 40))).toBe(true);
    log.feed(HINT.slice(40));
    expect(events.map((event) => event.kind)).toEqual(["compiling", "finished", "compiling"]);
    log.finalize();
    expect(events.at(-1)).toMatchObject({ kind: "finished", outcome: "error", diagnostics: [{ message: "unknown variable: a-b" }] });
    expect(events[1]).toEqual({ kind: "finished", outcome: "ok", durationMs: 4.62, diagnostics: [] });
  });

  it("reads warnings with durations in seconds and a following round", () => {
    const { events, log } = collect();
    log.feed("[10:00:00] compiling ...\n[10:00:01] compiled with warnings in 1.5 s\n\nwarning: unknown font family: nope\n  ┌─ a.typ:2:16\n\nwatching a.typ\n");
    expect(events[1]).toMatchObject({ kind: "finished", outcome: "warnings", durationMs: 1500, diagnostics: [{ severity: "warning", location: { file: "a.typ", line: 2, column: 16 } }] });
  });

  it("reports errors outside a compile round", () => {
    const { events, log } = collect();
    log.feed("error: input file not found (searched at nope.typ)\n");
    expect(events).toEqual([{ kind: "fatal", message: "input file not found (searched at nope.typ)" }]);
  });
});

describe("parseDeps", () => {
  it("reads the JSON format", () => {
    expect(parseDeps('{"inputs":["doc/ch/a.typ","doc/main.typ"]}')).toEqual(["doc/ch/a.typ", "doc/main.typ"]);
    expect(parseDeps("{broken")).toEqual([]);
    expect(parseDeps("")).toEqual([]);
  });

  it("reads the Makefile format with escapes", () => {
    expect(parseDeps("out.pdf: main.typ my\\ file.typ \\\n  $$money.typ\n")).toEqual(["main.typ", "my file.typ", "$money.typ"]);
  });
});
