import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { cites, numbers, quotes, sameNumber, sentences } from "../src/text.ts";
import { createServer } from "../src/server.ts";

// 真实样例：国家统计局 2024 年统计公报（网页打印成 PDF）+ WHO 肥胖事实清单网页，报告里故意写错 2 个数字、改了 1 句引文、加了 1 句没有出处的话。
const SAMPLES = process.env.CITE_SAMPLES ?? "/workspace/zcode-new-plugins/samples/cite";
const HAVE_SAMPLES = existsSync(join(SAMPLES, "资料/统计公报-2024.pdf"));
let workspace: string;
let client: Client;
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 })) as any;

async function pdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("Annual Energy Review 2023");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = [
    ["Annual Energy Review 2023", "", "Total electricity generation reached 4,178 terawatt-hours in 2023,", "down 1.2% from the previous year. Solar generation grew 15.6%.", "Coal's share of generation fell to 16.2 percent, the lowest on record."],
    ["Outlook", "", "\"Wind and solar will supply most new capacity over the next decade,\" the", "report concludes. Battery storage capacity doubled to 16 gigawatts."],
  ];
  for (const lines of pages) {
    const page = doc.addPage([612, 792]);
    lines.forEach((t, i) => page.drawText(t, { x: 60, y: 720 - i * 18, size: 12, font }));
  }
  return doc.save();
}
function docx(paras: string[]) {
  const body = paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join("");
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`) });
}
const REPORT = `# Energy brief

Prepared in March 2024.

US power plants generated 4,178 TWh in 2023, a 1.2% drop from 2022 [1]. Solar generation grew 18.6% [1].

Coal's share of generation fell to about 16% [1]. The report says "wind and solar will supply all new capacity over the next decade" [1].

Battery storage capacity doubled to 16 gigawatts [2].

Nuclear plants ran at a 93% capacity factor [1].

Heat pumps outsold gas furnaces by 21% [2].

## References

[1] Annual Energy Review 2023 (sources/review.pdf)
[2] Field notes (sources/notes.md)
`;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "cite-"));
  await mkdir(join(workspace, "brief/sources"), { recursive: true });
  await writeFile(join(workspace, "brief/report.md"), REPORT);
  await writeFile(join(workspace, "brief/sources/review.pdf"), await pdf());
  await writeFile(join(workspace, "brief/sources/notes.md"), "# Field notes\n\nHeat pumps outsold gas furnaces by 21% in 2023, according to AHRI shipment data.\n\nInstallers report long waiting lists.\n");
  await writeFile(join(workspace, "brief/sources/page.html"), `<html><head><title>Grid news</title><script>var x="Nuclear 93%";</script></head><body><nav>Home 93%</nav><article><h1>Grid news</h1><p>Nuclear plants ran at a 93.1% capacity factor last year.</p></article></body></html>`);
  if (HAVE_SAMPLES) await cp(SAMPLES, join(workspace, "samples"), { recursive: true });
  const server = createServer({ workspaceRoot: workspace, assetRoot: join(import.meta.dirname, "../dist") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "t", version: "1" });
  await client.connect(b);
});

describe("text", () => {
  it("splits sentences without breaking quotes, decimals or abbreviations", () => {
    const t = `世卫组织指出，“肥胖是一种慢性病。全球约有十亿人受影响。”[2] 他说 e.g. 1.5 倍。Dr. Smith wrote "it rose 2.5%. Then it fell." (Smith, 2020) Next one.`;
    expect(sentences(t).map((s) => s.text)).toEqual([`世卫组织指出，“肥胖是一种慢性病。全球约有十亿人受影响。”[2]`, `他说 e.g. 1.5 倍。`, `Dr. Smith wrote "it rose 2.5%. Then it fell." (Smith, 2020)`, `Next one.`]);
  });
  it("reads numbers with magnitudes and units, and skips dates and markers", () => {
    const ns = numbers("2024 年 GDP 1349084 亿元，增长 5.0%，提高 0.84 个百分点，出生率 6.77‰，人口 140,828 万；In 2024, 1.1 billion people, 3 月，就业[7]1256万人，-0.99‰");
    expect(ns.map((n) => [n.raw, n.unit, n.date])).toEqual([["2024", "", true], ["1349084 亿", "", false], ["5.0%", "%", false], ["0.84 个百分点", "pp", false], ["6.77‰", "‰", false], ["140,828 万", "", false], ["2024", "", true], ["1.1 billion", "", false], ["3", "", true], ["1256万", "", false], ["-0.99‰", "‰", false]]);
    const [a] = numbers("134.9 万亿元"), [b] = numbers("1349084亿元"), [c] = numbers("135 万亿");
    expect(sameNumber(a, b)).toBe(true); // 报告四舍五入
    expect(sameNumber(c, b)).toBe(true);
    expect(sameNumber(b, a)).toBe(false); // 资料更精确时反过来不算
    expect(sameNumber(numbers("16%")[0], numbers("16.2 percent")[0])).toBe(true);
    expect(sameNumber(numbers("16%")[0], numbers("16 万")[0])).toBe(false);
  });
  it("finds quotes and citation markers", () => {
    expect(quotes(`他说“十四五”很关键，“这是一段足够长的原话引文”。`).map((q) => q.text)).toEqual(["这是一段足够长的原话引文"]);
    expect(cites("见[1,3-5]与【2】及[^n1]，(Smith et al., 2021)、（王磊，2019）")).toEqual(["1", "3", "4", "5", "2", "n1", "Smith et al. 2021", "王磊 2019"]);
  });
});

describe("tools", () => {
  it("checks a report against PDF, Markdown and HTML sources", async () => {
    const r = await call("cite_check", { report: "brief/report.md" });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent.state;
    expect(s.sources.map((x: any) => x.file).sort()).toEqual(["brief/sources/notes.md", "brief/sources/page.html", "brief/sources/review.pdf"]);
    expect(s.refs.map((x: any) => x.file)).toEqual(["brief/sources/review.pdf", "brief/sources/notes.md"]);
    const by = Object.fromEntries(s.claims.map((c: any) => [c.text.slice(0, 18), c]));
    expect(s.claims.map((c: any) => c.status)).toEqual(["weak", "number", "ok", "quote", "ok", "ok", "ok"]);
    expect(by["US power plants ge"].evidence[0]).toMatchObject({ file: "brief/sources/review.pdf", page: 1 });
    expect(by["Solar generation g"].numbers).toEqual([{ raw: "18.6%", found: false, evidence: 0, suggest: "15.6%" }]);
    expect(by["Coal's share of ge"].numbers[0]).toMatchObject({ raw: "16%", found: true });
    const q = by["The report says \"w"].quotes[0];
    expect(q.found).toBe(false);
    expect(q.closest.file).toBe("brief/sources/review.pdf");
    expect(q.closest.page).toBe(2);
    // 93% 在网页里是 93.1%（四舍五入算一致），但引用 [1] 指向的是 PDF
    expect(by["Nuclear plants ran"].citeMismatch).toMatch(/page\.html/);
    expect(by["Heat pumps outsold"].evidence[0].file).toBe("brief/sources/notes.md");
    expect(by["Battery storage ca"].citeMismatch).toMatch(/review\.pdf/);
    expect(r.content[0].text).toMatch(/18\.6% not in source \(source says 15\.6%\)/);
    expect(s.claims.some((c: any) => /March 2024/.test(c.text))).toBe(false);
  });

  it("flags unsupported claims and keeps verdicts across re-checks", async () => {
    await writeFile(join(workspace, "brief/report.md"), REPORT.replace("## References", "Offshore wind employs 4,000 people in Ohio [1].\n\n## References"));
    let s = (await call("cite_check", { report: "brief/report.md" })).structuredContent.state;
    const off = s.claims.find((c: any) => c.text.startsWith("Offshore"));
    expect(off.status).toBe("missing");
    const solar = s.claims.find((c: any) => c.text.startsWith("Solar"));
    const rv = await call("cite_review", { report: "brief/report.md", reviews: [{ id: solar.id, verdict: "wrong", note: "source says 15.6%" }, { id: off.id, verdict: "unsupported" }, { id: "C99", verdict: "open" }] });
    expect(rv.content[0].text).toMatch(/Saved 2 verdict\(s\).*Unknown: C99/);
    s = (await call("cite_check", { report: "brief/report.md" })).structuredContent.state;
    expect(s.claims.find((c: any) => c.text.startsWith("Solar")).review).toMatchObject({ verdict: "wrong", note: "source says 15.6%" });
    expect((await call("cite_review", { report: "brief/report.md", reviews: [{ id: "C99", verdict: "open" }] })).isError).toBe(true);
  });

  it("searches sources and exports the table", async () => {
    const hits = (await call("cite_search", { report: "brief/report.md", query: "battery storage gigawatts" })).structuredContent.hits;
    expect(hits[0]).toMatchObject({ file: "brief/sources/review.pdf", page: 2 });
    expect(hits[0].text).toMatch(/Battery storage capacity doubled to 16 gigawatts/);
    const csv = await call("cite_export", { report: "brief/report.md", format: "csv" });
    expect(csv.structuredContent.path).toBe("brief/report.citations.csv");
    const text = await readFile(join(workspace, "brief/report.citations.csv"), "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toMatch(/Number mismatch/);
    expect(text).toMatch(/Wrong,source says 15\.6%/);
    await call("cite_export", { report: "brief/report.md" });
    const html = await readFile(join(workspace, "brief/report.citations.html"), "utf8");
    expect(html).toMatch(/<table>/);
    expect(html).not.toMatch(/<script/);
    // 导出文件不会被当作资料
    const again = (await call("cite_check", { report: "brief/report.md" })).structuredContent.state;
    expect(again.sources.length).toBe(3);
  });

  it("locates a PDF passage for highlighting and serves text context", async () => {
    const s = (await call("cite_status", { report: "brief/report.md" })).structuredContent.state;
    const ev = s.claims.find((c: any) => c.text.startsWith("Solar")).evidence[0];
    const v = (await call("source_view", { report: "brief/report.md", file: ev.file, block: ev.block, start: ev.start, end: ev.end })).structuredContent;
    expect(v).toMatchObject({ kind: "pdf", page: 1, pages: 2, w: 612, h: 792 });
    expect(v.rects.length).toBeGreaterThan(0);
    for (const r of v.rects) { expect(r.x).toBeGreaterThanOrEqual(50); expect(r.y).toBeGreaterThan(600); expect(r.y).toBeLessThan(720); }
    const hp = s.claims.find((c: any) => c.text.startsWith("Heat")).evidence[0];
    const t = (await call("source_view", { report: "brief/report.md", file: hp.file, block: hp.block, start: hp.start, end: hp.end })).structuredContent;
    expect(t).toMatchObject({ kind: "text", match: expect.stringMatching(/^Heat pumps outsold/) });
    expect((await call("source_view", { report: "brief/report.md", file: "brief/report.md", block: 0, start: 0, end: 1 })).isError).toBe(true);
  });

  it("reads DOCX reports and sources", async () => {
    await writeFile(join(workspace, "brief/report.docx"), docx(["Energy brief", "Heat pumps outsold gas furnaces by 12% [2].", "Coal fell to 16.2 percent of generation."]));
    const s = (await call("cite_check", { report: "brief/report.docx", sources: ["brief/sources"] })).structuredContent.state;
    expect(s.claims.map((c: any) => [c.loc, c.status])).toEqual([["¶2", "number"], ["¶3", "ok"]]);
    expect(s.claims[0].numbers[0]).toMatchObject({ raw: "12%", suggest: "21%" });
  });

  it("rejects bad input", async () => {
    expect((await call("cite_check", { report: "brief/nope.md" })).isError).toBe(true);
    await mkdir(join(workspace, "lonely"));
    await writeFile(join(workspace, "lonely/r.md"), "Sales rose 5%.");
    expect((await call("cite_check", { report: "lonely/r.md" })).content[0].text).toMatch(/No source documents/);
    expect((await call("cite_review", { report: "lonely/r.md", reviews: [{ id: "C1", verdict: "open" }] })).content[0].text).toMatch(/not been checked/);
  });
});

describe.skipIf(!HAVE_SAMPLES)("real sources (统计公报 PDF + WHO page)", () => {
  const expected = [
    ["国内生产总值 1349084", "ok"], ["第三产业增加值 765583", "ok"], ["年末全国人口 140828", "ok"], ["城镇调查失业率平均值为 5.2%", "number", "5.1%"], ["新能源汽车产量", "number", "38.7%"],
    ["外汇储备 32024", "ok"], ["城镇化率为 67.00%", "ok"], ["人均可支配收入 41314", "ok"], ["快递网点", "missing"], ["chronic disease affecting", "ok"], ["has tripled since 1990", "quote"], ["45% 超重", "weak"],
  ];
  for (const report of ["samples/报告.md", "samples/报告.docx"]) {
    it(`checks ${report}`, async () => {
      const r = await call("cite_check", { report, sources: ["samples/资料"] });
      const s = r.structuredContent.state;
      expect(s.claims.length).toBe(expected.length);
      expected.forEach(([needle, status, suggest], i) => {
        const c = s.claims[i];
        expect(c.text).toContain(needle);
        expect(c.status, c.text).toBe(status);
        if (suggest) expect(c.numbers.find((n: any) => !n.found).suggest).toBe(suggest);
      });
      const gdp = s.claims[0].evidence[0];
      expect(gdp).toMatchObject({ file: "samples/资料/统计公报-2024.pdf", page: 2 });
      expect(gdp.text).toMatch(/国内生产总值\[2\]1349084亿元/);
      expect(s.claims[10].quotes[0].closest.text).toMatch(/more than doubled since 1990/);
      expect(s.claims[11].evidence[0].file).toBe("samples/资料/WHO-obesity-factsheet.html");
      const v = (await call("source_view", { report, file: gdp.file, block: gdp.block, start: gdp.start, end: gdp.end })).structuredContent;
      expect(v.rects.length).toBeGreaterThan(0);
    });
  }
});
