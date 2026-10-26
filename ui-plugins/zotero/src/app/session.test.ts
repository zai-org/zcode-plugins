import { describe, expect, it } from "vitest";
import { posix, win32 } from "node:path";
import { isInside } from "#z/app/session.ts";

describe("workspace boundary", () => {
  it("accepts paths under the root, including a drive root on Windows", () => {
    expect(isInside("C:\\proj", "C:\\proj\\refs\\main.bib", win32)).toBe(true);
    expect(isInside("C:\\Proj", "c:\\proj\\main.bib", win32)).toBe(true);
    expect(isInside("D:\\", "D:\\main.bib", win32)).toBe(true);
    expect(isInside("C:\\proj", "C:\\proj\\..foo.bib", win32)).toBe(true);
    expect(isInside("/", "/home/me/main.bib", posix)).toBe(true);
    expect(isInside("/home/me", "/home/me/a/main.bib", posix)).toBe(true);
  });

  it("rejects paths outside the root", () => {
    expect(isInside("C:\\proj", "C:\\project\\main.bib", win32)).toBe(false);
    expect(isInside("C:\\proj", "C:\\main.bib", win32)).toBe(false);
    expect(isInside("C:\\proj", "D:\\proj\\main.bib", win32)).toBe(false);
    expect(isInside("C:\\proj", "\\\\server\\share\\main.bib", win32)).toBe(false);
    expect(isInside("/home/me", "/home/meow/main.bib", posix)).toBe(false);
    expect(isInside("/home/me", "/etc/hosts", posix)).toBe(false);
  });
});
