import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localeOf, parseLocale, placeholders, serialize, unflatten } from "../src/locale.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("locale", () => {
  it("parses and serializes", () => {
    expect(localeOf("locales/zh-CN.json")).toBe("zh-CN");
    expect(localeOf("i18n/fr/common.json")).toBe("fr");
    expect(localeOf("messages.de.yaml")).toBe("de");
    expect(placeholders("Hi {name}, {{n}} %s %1$d %{x} ${y} {count, plural, one {# a} other {# b}}")).toEqual(["%1$d", "%s", "%{x}", "${y}", "{count}", "{name}", "{{n}}"].sort());
    const { meta, flat } = parseLocale("a/en.json", '{\n    "a": {"b": "x", "list": ["p", "q"]}, "c": 1}');
    expect([...flat]).toEqual([["a.b", "x"], ["a.list.0", "p"], ["a.list.1", "q"], ["c", "1"]]);
    expect(meta.indent).toBe(4);
    expect(serialize(meta, [...flat])).toBe('{\n    "a": {\n        "b": "x",\n        "list": [\n            "p",\n            "q"\n        ]\n    },\n    "c": "1"\n}\n');
    expect(unflatten([["a", "1"], ["a.b", "2"]], new Set())).toEqual({ a: "1", "a.b": "2" });
    expect(() => parseLocale("x/en.json", "{bad")).toThrow(/not valid JSON/);
  });
});

describe("i18n tools", () => {
  it("compares, fixes, exports and imports a translator sheet", async () => {
    const root = await mkdtemp(join(tmpdir(), "i18n-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const files = ["locales/en.json", "locales/zh.json", "locales/ja.yml"];
    const o = await c.call("i18n_open", { inputs: files, project: "app" });
    expect(o.data.stats).toMatchObject({ keys: 13, languages: 3, errors: 1 });
    const rows = o.data.rows as Record<string, string>[];
    const welcome = rows.findIndex((r) => r.key === "app.welcome");
    expect(rows[welcome]._status).toContain("zh placeholders");
    expect(rows.find((r) => r.key === "legacy.banner")!._status).toContain("not in en");
    expect(rows.find((r) => r.key === "checkout.pay")!._status).toContain("ja untranslated?");
    expect(rows.find((r) => r.key === "checkout.coupon")!._status).toContain("zh tags");
    await expect(c.call("i18n_export", { project: "app", formats: ["locales"] })).rejects.toMatchObject({ code: "has_errors" });
    await c.call("i18n_edit", { project: "app", set: [{ row: welcome, values: { l1: "欢迎回来，{name}！" } }], add: [{ key: "app.logout", l0: "Log out", l1: "退出登录" }] });
    const e = await c.call("i18n_export", { project: "app" });
    expect(e.text).toContain("translations.xlsx");
    const zh = JSON.parse(await readFile(join(root, "i18n-sheet/app/locales/zh.json"), "utf8"));
    expect(zh.app).toMatchObject({ welcome: "欢迎回来，{name}！", logout: "退出登录" });
    expect(zh.steps).toEqual(["选择", "支付", "完成"]);
    expect(zh.errors).toEqual({ network: "网络错误，请重试" });
    expect(zh.checkout.points).toBeUndefined();
    const ja = await readFile(join(root, "i18n-sheet/app/locales/ja.yml"), "utf8");
    expect(ja.startsWith("ja:\n  app:\n    title: 青禾茶業")).toBe(true);
    await c.call("i18n_edit", { project: "app", settings: { missing: "base" } });
    await c.call("i18n_export", { project: "app", formats: ["locales"] });
    expect(JSON.parse(await readFile(join(root, "i18n-sheet/app/locales/zh.json"), "utf8")).errors.timeout).toBe("Request timed out");
    await writeFile(join(root, "ja-done.csv"), "key,en (base),ja\nerrors.network,Network error,ネットワークエラー\ncheckout.pay,Pay now,今すぐ支払う\n");
    const o2 = await c.call("i18n_open", { inputs: [...files, "ja-done.csv"], project: "app2" });
    const r2 = o2.data.rows as Record<string, string>[];
    expect(r2.find((r) => r.key === "errors.network")!.l2).toBe("ネットワークエラー");
    expect(o2.text).toContain("2 cell(s) imported");
  });
});
