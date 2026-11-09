import { describe, expect, it } from "vitest";
import { duration, hostOf, relativeTime, shortTraceback, stripAnsi } from "#ui/text.ts";
import { strings } from "#ui/i18n.ts";

const s = strings("en");

describe("shortTraceback", () => {
  it("keeps the user's cell frame and drops library frames", () => {
    const traceback = [
      "\u001b[0;31m---------------------------------------------------------------------------\u001b[0m",
      "\u001b[0;31mKeyError\u001b[0m                                  Traceback (most recent call last)",
      "Cell \u001b[0;32mIn[3], line 2\u001b[0m\n\u001b[1;32m      1\u001b[0m big = orders\n\u001b[0;32m----> 2\u001b[0m big.groupby(\"regoin\")\n",
      "File \u001b[0;32m~/pandas/frame.py:9183\u001b[0m, in \u001b[0;36mgroupby\u001b[0m\n\u001b[0;32m-> 9183\u001b[0m raise KeyError(by)\n",
      "\u001b[0;31mKeyError\u001b[0m: 'regoin'",
    ];
    const { frame, total } = shortTraceback({ ename: "KeyError", evalue: "'regoin'", traceback });
    expect(stripAnsi(frame!)).toBe('Cell In[3], line 2\n      1 big = orders\n----> 2 big.groupby("regoin")');
    expect(total).toBe(traceback.join("\n").split("\n").length);
  });

  it("removes the repeated error line and common indentation (SyntaxError)", () => {
    const traceback = ['  Cell In[1], line 1\n    1/\n      ^\nSyntaxError: invalid syntax\n'];
    const { frame } = shortTraceback({ ename: "SyntaxError", evalue: "invalid syntax", traceback });
    expect(frame).toBe("Cell In[1], line 1\n  1/\n    ^");
  });

  it("has no frame when the traceback only names the error", () => {
    expect(shortTraceback({ ename: "KeyboardInterrupt", evalue: "", traceback: [] })).toEqual({ frame: null, total: 0 });
  });
});

describe("formatting", () => {
  it("formats durations, relative times and hosts", () => {
    expect(duration(412)).toBe("0.4s");
    expect(duration(12_400)).toBe("12s");
    expect(duration(65_000)).toBe("1m 05s");
    const now = new Date("2026-10-12T15:00:00").getTime();
    expect(relativeTime(now - 10_000, now, s)).toBe("just now");
    expect(relativeTime(now - 120_000, now, s)).toBe("2 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now, s)).toBe("3 h ago");
    expect(relativeTime(now - 24 * 3_600_000, now, s)).toBe("Yesterday");
    expect(hostOf("http://127.0.0.1:8888/")).toBe("127.0.0.1:8888");
    expect(hostOf("https://hub.example.org/user/me/")).toBe("hub.example.org/user/me");
  });
});
