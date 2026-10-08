import { expect, it } from "vitest";
import { utf8Chunks } from "./utf8-chunks.mjs";

it.each([4, 5, 7, 11])("keeps every byte across multibyte boundaries of size %i", (size) => {
  const source = "abc中文🙂ef".repeat(20);
  const chunks = utf8Chunks(Buffer.from(source), size);
  expect(chunks.join("")).toBe(source);
  expect(chunks.every((part) => Buffer.byteLength(part) <= size)).toBe(true);
});
