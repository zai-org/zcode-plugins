import ExcelJS from "exceljs";

export interface SheetSpec {
  name: string;
  headers: string[];
  rows: unknown[][];
  /** 需要标色的单元格：row/col 从 0 开始（不含表头）。 */
  marks?: { row: number; col: number; color?: string; note?: string }[];
  widths?: number[];
  numberFormat?: Record<number, string>;
}

/** 写出 .xlsx：表头加粗冻结、数字保持数字、可选标色与批注。 */
export async function writeXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "Penova";
  for (const spec of sheets) {
    const sheet = book.addWorksheet(spec.name.replace(/[\\/?*[\]:]/g, "_").slice(0, 31) || "Sheet1");
    sheet.addRow(spec.headers);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of spec.rows) sheet.addRow(row.map((v) => (v === undefined || v === null ? "" : v instanceof Date ? v : typeof v === "number" || typeof v === "boolean" ? v : String(v))));
    spec.headers.forEach((h, i) => {
      const width = spec.widths?.[i] ?? Math.min(50, Math.max(8, String(h).length * 2, ...spec.rows.slice(0, 200).map((r) => String(r[i] ?? "").length * 1.2)));
      sheet.getColumn(i + 1).width = width;
      if (spec.numberFormat?.[i]) sheet.getColumn(i + 1).numFmt = spec.numberFormat[i];
    });
    for (const m of spec.marks ?? []) {
      const cell = sheet.getCell(m.row + 2, m.col + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: (m.color ?? "FFFDE68A").replace("#", "FF") } };
      if (m.note) cell.note = m.note;
    }
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
