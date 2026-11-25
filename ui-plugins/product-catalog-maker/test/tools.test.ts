import { mkdtemp, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.ts";

let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as any;

function swatch(r: number, g: number, b: number) {
  const png = new PNG({ width: 400, height: 400 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, 255], i);
  return PNG.sync.write(png);
}

const header = "货号,商品名称,规格,售价,原价,分类\n";
const rows = (price1: string) =>
  [
    `A-01,陶瓷马克杯,350ml,${price1},39,杯具`,
    "A-02,玻璃杯,300ml,19.9,,杯具",
    "B-01,降噪耳机,头戴式,\"¥1,299\",,数码",
    "B-02,香水,50ml,199,,美妆",
    "B-03,无图商品,—,9,,数码",
    "B-04,超长名称的多功能户外运动双肩背包带防雨罩和独立鞋仓大容量旅行款,45L,abc,,箱包",
    "B-04,重复货号,,10,,箱包",
  ].join("\n");

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "catalog-"));
  await mkdir(join(workspace, "data/img"), { recursive: true });
  await writeFile(join(workspace, "data/products.csv"), header + rows("29") + "\n");
  await writeFile(join(workspace, "data/img/A-01.png"), swatch(200, 60, 60));
  await writeFile(join(workspace, "data/img/a-02.png"), swatch(60, 160, 60));
  await copyFile(join(import.meta.dirname, "fixtures/headphones-cc0.jpg"), join(workspace, "data/img/B-01.jpg"));
  await copyFile(join(import.meta.dirname, "fixtures/perfume.jpg"), join(workspace, "data/img/B-02.jpg"));
  await writeFile(join(workspace, "data/logo.png"), swatch(20, 40, 200));
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe("product-catalog-maker", () => {
  it("detects columns, matches images by SKU and reports problems", async () => {
    const result = await call("catalog_open", { table: "data/products.csv", imageDir: "data/img" });
    expect(result.isError).toBeFalsy();
    const { project, problems, toc, pages } = result.structuredContent;
    expect(project.mapping).toMatchObject({ sku: "货号", name: "商品名称", spec: "规格", price: "售价", originalPrice: "原价", category: "分类" });
    expect(toc.map((t: any) => t.name)).toEqual(["杯具", "数码", "美妆", "箱包"]);
    expect(pages).toBe(5);
    const text = problems.join("\n");
    expect(text).toContain("B-03: no image");
    expect(text).toContain('price "abc" is not a number');
    expect(text).toContain("SKU B-04 duplicates row 7");
    expect(text).not.toContain("A-02: no image"); // 文件名大小写不同也能匹配
  });

  it("builds a searchable PDF, an HTML catalog and a snapshot; then lists changes", async () => {
    const opened = await call("catalog_open", { table: "data/products.csv", imageDir: "data/img", style: { title: "青禾生活目录", logo: "data/logo.png", grid: "2x2", footer: "热线 400-000-0000" } });
    const project = opened.structuredContent.project;
    const built = await call("catalog_build", { project });
    expect(built.isError).toBeFalsy();
    expect(built.structuredContent.files).toEqual(["catalog/catalog.pdf", "catalog/catalog.html", "catalog/catalog.json"]);
    const pdf = await PDFDocument.load(await readFile(join(workspace, "catalog/catalog.pdf")));
    expect(pdf.getPageCount()).toBe(built.structuredContent.pages);
    expect(pdf.getTitle()).toBe("青禾生活目录");
    const raw = (await readFile(join(workspace, "catalog/catalog.pdf"))).toString("latin1");
    expect(raw).toContain("/ToUnicode");
    const html = await readFile(join(workspace, "catalog/catalog.html"), "utf8");
    expect(html).toContain("陶瓷马克杯");
    expect(html).toContain("¥1,299");
    expect(html).toContain("<s>¥39</s>");
    expect((html.match(/data:image\/jpeg/g) ?? []).length).toBe(5); // 4 张商品图 + logo

    await writeFile(join(workspace, "data/products.csv"), header + rows("25").split("\n").filter((l) => !l.startsWith("B-02")).join("\n") + "\nC-01,新品杯垫,圆形,15,,杯具\n");
    const again = await call("catalog_build", { project });
    const changes = again.structuredContent.changes;
    expect(changes.added.map((p: any) => p.sku)).toEqual(["C-01"]);
    expect(changes.removed.map((p: any) => p.sku)).toEqual(["B-02"]);
    expect(changes.changed).toContainEqual({ sku: "A-01", name: "陶瓷马克杯", field: "price", from: "29", to: "25" });
    const md = await readFile(join(workspace, "catalog/changes.md"), "utf8");
    expect(md).toContain("新增 1 · 下架 1");
    expect(await readFile(join(workspace, "catalog/changes.csv"), "utf8")).toContain("changed,A-01,陶瓷马克杯,price,29,25");
  });

  it("previews, saves a project and rejects bad input", async () => {
    const opened = await call("catalog_open", { table: "data/products.csv", imageDir: "data/img", style: { grid: "3x3", cover: false } });
    const preview = await call("catalog_preview", { project: opened.structuredContent.project });
    const pdf = await PDFDocument.load(Buffer.from(preview.structuredContent.pdf, "base64"));
    expect(pdf.getPageCount()).toBe(3); // 上个用例删掉了美妆分类
    const saved = await call("project_save", { path: "data/autumn", project: opened.structuredContent.project });
    expect(saved.structuredContent.path).toBe("data/autumn.catalogmaker.json");
    const reopened = await call("catalog_open", { project: "data/autumn.catalogmaker.json" });
    expect(reopened.structuredContent.project.style.grid).toBe("3x3");
    expect((await call("catalog_open", { table: "../x.csv" })).structuredContent.error.code).toBe("outside_workspace");
    expect((await call("catalog_open", { table: "data/products.csv", mapping: { price: "不存在" } })).structuredContent.error.code).toBe("bad_mapping");
  });
});
