import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { priceText } from "../src/menu.ts";
import { connect } from "../src/kit/testing.ts";
import { createServer } from "../src/server.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("menu", () => {
  it("formats prices", () => {
    expect(priceText("38", "¥")).toBe("¥38");
    expect(priceText("12.5", "$")).toBe("$12.50");
    expect(priceText("12/18", "¥")).toBe("¥12 / ¥18");
    expect(priceText("时价", "¥")).toBe("时价");
  });
});

describe("menu tools", () => {
  it("makes the pdf and web menu", async () => {
    const root = await mkdtemp(join(tmpdir(), "menu-"));
    await cp(join(HERE, "samples"), root, { recursive: true });
    const c = await connect(createServer({ workspaceRoot: root, assetRoot: root }));
    const o = await c.call("menu_open", { inputs: ["菜单.xlsx"], project: "m", settings: { title: "青禾小馆", subtitle: "福州市鼓楼区 · 11:00–21:30" } });
    const rows = o.data.rows as Record<string, unknown>[];
    expect(o.data.stats).toMatchObject({ dishes: 9, sections: 4 });
    expect(rows[0]).toMatchObject({ section: "凉菜", name: "口水鸡", price: "38", allergens: "花生、芝麻", spicy: 2, star: true, veg: false });
    expect(rows[3].spicy).toBe(3);
    await c.call("menu_edit", { project: "m", settings: { layout: "twocol", menuUrl: "https://tea.example/menu", footer: "价格均含服务费" }, set: [{ row: 6, values: { include: false } }] });
    await c.call("menu_export", { project: "m" });
    const html = await readFile(join(root, "menu-maker/m/menu.html"), "utf8");
    expect(html).toContain('<a href="#s1">凉菜</a>');
    expect(html).toContain("¥12 / ¥18");
    expect(html).not.toContain("白米饭");
    expect(html).toContain("Mouth-watering Chicken");
    const pdf = join(root, "menu-maker/m/menu.pdf");
    const txt = execFileSync("pdftotext", ["-layout", pdf, "-"]).toString();
    expect(txt).toContain("青禾小馆");
    expect(txt).toContain("宫保鸡丁");
    expect(txt).toContain("¥48");
    expect(txt).toContain("扫码看电子菜单");
    expect((await readFile(join(root, "menu-maker/m/qr.png"))).subarray(1, 4).toString()).toBe("PNG");
  });
});
