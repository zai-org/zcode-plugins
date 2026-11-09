import { describe, expect, it } from "vitest";
import { excerpt, fuzzyFind, lineColumn, lineStarts, locateInSources, skeleton } from "#t/domain/match.ts";

describe("skeleton", () => {
  it("keeps letters and digits, folds case, ligatures and hyphenation", () => {
    expect(skeleton("Some *bold* text, ﬁne — ok-\nay; $x^2$").value).toBe("someboldtextfineokayx2");
    const { value, map } = skeleton("a *b*");
    expect(value).toBe("ab");
    expect(map).toEqual([0, 3]);
  });
});

describe("fuzzyFind", () => {
  const source = `= Introduction
Typst is a markup-based typesetting system. This sample document exercises the *live preview*: headings, _emphasis_, math such as $a^2 + b^2 = c^2$, and a table.

#text(fill: red)[Colored words] stay findable even when #emph[markup] sits between them and the rendered text.`;

  it("finds rendered text despite markup", () => {
    const [hit] = fuzzyFind("This sample document exercises the live preview: headings, emphasis, math such as a² + b² = c², and a table.", skeleton(source));
    expect(hit!.score).toBe(1);
    expect(source.slice(hit!.start, hit!.end)).toMatch(/^This sample document[\s\S]*and a table$/);
  });

  it("chains seeds across function names and arguments", () => {
    const [hit] = fuzzyFind("Colored words stay findable even when markup sits between them and the rendered text.", skeleton(source));
    expect(hit!.score).toBeGreaterThan(0.6);
    expect(source.slice(hit!.start, hit!.end)).toContain("stay findable");
    expect(lineColumn(lineStarts(source), hit!.start).line).toBe(4);
  });

  it("tolerates generated text missing from the source (numbering)", () => {
    const [hit] = fuzzyFind("1. Introduction Typst is a markup-based typesetting system.", skeleton(source));
    expect(hit).toBeDefined();
    expect(lineColumn(lineStarts(source), hit!.start).line).toBeLessThanOrEqual(2);
  });

  it("returns nothing for unrelated or too short text", () => {
    expect(fuzzyFind("completely unrelated sentence about elephants and trains", skeleton(source))).toEqual([]);
    expect(fuzzyFind("a", skeleton(source))).toEqual([]);
  });
});

describe("locateInSources", () => {
  const files = [
    { path: "main.typ", text: '= Intro\nHello there.\n#include "ch.typ"\n' },
    { path: "ch.typ", text: "= Chapter\nThe quick brown fox jumps over the lazy dog.\nA second sentence follows here.\n" },
  ];

  it("maps rendered text to file, line and excerpt", () => {
    expect(locateInSources(files, "The quick brown fox jumps over the lazy dog.")[0]).toEqual({
      file: "ch.typ",
      line: 2,
      column: 1,
      endLine: 2,
      excerpt: "The quick brown fox jumps over the lazy dog.",
      score: 1,
    });
  });

  it("narrows a context match to the focused line", () => {
    const [match] = locateInSources(files, "The quick brown fox jumps over the lazy dog.\nA second sentence follows here.", "A second sentence follows here.");
    expect(match).toMatchObject({ file: "ch.typ", line: 3, endLine: 3 });
  });
});

describe("excerpt", () => {
  it("limits long ranges", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    expect(excerpt(text, 2, 3)).toBe("line 2\nline 3");
    expect(excerpt(text, 1, 20, 2)).toBe("line 1\nline 2\n… (18 more lines)");
  });
});
