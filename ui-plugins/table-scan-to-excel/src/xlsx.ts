import ExcelJS from "exceljs";
import { checkTable, parseNumber, type Issue, type ScanTable } from "./check.ts";

const key = (r: number, c: number) => `${r}:${c}`;

/** 写 xlsx：表头加粗、合并单元格、数字为真正数值并保留格式；待确认格子黄底加批注，合计不符红底加批注。 */
export async function toXlsx(tables: ScanTable[], source: string) {
  const book = new ExcelJS.Workbook();
  book.creator = "Table Scan to Excel (ZCode plugin)";
  const used = new Set<string>();
  for (const table of tables) {
    let name = table.name || "Sheet";
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${table.name.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    const sheet = book.addWorksheet(name, { views: table.headerRows ? [{ state: "frozen", ySplit: table.headerRows }] : [] });
    const issues = checkTable(table);
    const byCell = new Map<string, Issue[]>();
    for (const issue of issues) byCell.set(key(issue.row, issue.col), [...(byCell.get(key(issue.row, issue.col)) ?? []), issue]);
    const widths: number[] = [];
    table.rows.forEach((row, r) => {
      row.forEach((text, c) => {
        const cell = sheet.getCell(r + 1, c + 1);
        const parsed = r >= table.headerRows ? parseNumber(text) : null;
        if (parsed) {
          cell.value = parsed.value;
          cell.numFmt = parsed.format;
        } else cell.value = text;
        if (r < table.headerRows) {
          cell.font = { bold: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        }
        cell.border = { top: { style: "thin", color: { argb: "FFCBD5E1" } }, left: { style: "thin", color: { argb: "FFCBD5E1" } }, bottom: { style: "thin", color: { argb: "FFCBD5E1" } }, right: { style: "thin", color: { argb: "FFCBD5E1" } } };
        const found = byCell.get(key(r, c));
        if (found) {
          const mismatch = found.some((i) => i.kind === "total_mismatch");
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: mismatch ? "FFFECACA" : "FFFEF08A" } };
          cell.note = found.map((i) => i.message).join("\n");
        }
        widths[c] = Math.max(widths[c] ?? 6, Math.min(48, [...text].reduce((w, ch) => w + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0) + 2));
      });
    });
    for (const m of table.merges) sheet.mergeCells(m.row + 1, m.col + 1, m.row + m.rowSpan, m.col + m.colSpan);
    widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
  }
  const info = book.addWorksheet("_source");
  info.addRow(["Source image", source]);
  info.addRow(["Transcribed by", "the ZCode agent's vision model; checked with Table Scan to Excel"]);
  info.state = "hidden";
  return Buffer.from(await book.xlsx.writeBuffer());
}

