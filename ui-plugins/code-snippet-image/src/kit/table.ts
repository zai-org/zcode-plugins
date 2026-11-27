import { extname } from "node:path";
import ExcelJS from "exceljs";
import { KitError, type Workspace } from "./workspace.ts";

export interface TableData {
  columns: string[];
  rows: Record<string, string>[];
  sheets: string[];
  sheet?: string;
}

/** UTF-8 解码失败（出现替换字符）时按 GB18030 解码：中文版 Excel 导出的 CSV 常是 GBK。 */
export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("gb18030").decode(bytes);
  } catch {
    return utf8;
  }
}

export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("error" in value) return "";
  }
  return String(value);
}

function toTable(matrix: string[][], sheets: string[], sheet?: string): TableData {
  if (!matrix.length) throw new KitError("empty_table", "The table has no rows.");
  const seen = new Map<string, number>();
  const columns = matrix[0].map((raw, index) => {
    let name = raw.trim() || `列${index + 1}`;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count) name = `${name}_${count + 1}`;
    return name;
  });
  const rows = matrix.slice(1).map((cells) => Object.fromEntries(columns.map((column, index) => [column, (cells[index] ?? "").trim()])));
  return { columns, rows, sheets, sheet };
}

/** 读取 CSV / TSV / XLSX：第一行是表头。 */
export interface ReadOptions {
  /** 表头不在第一行时（例如银行导出前面有说明文字），用它在前 40 行里找表头行。 */
  findHeader?: (cells: string[]) => boolean;
}

function headerFirst(matrix: string[][], options?: ReadOptions) {
  if (!options?.findHeader) return matrix;
  const index = matrix.slice(0, 40).findIndex((cells) => options.findHeader!(cells.map((c) => c.trim())));
  return index > 0 ? matrix.slice(index) : matrix;
}

export async function readTable(ws: Workspace, path: string, sheet?: string, options?: ReadOptions): Promise<TableData> {
  const ext = extname(path).toLowerCase();
  const bytes = await ws.read(path, 50 * 1024 * 1024);
  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") return toTable(headerFirst(parseCsv(decodeText(bytes)), options), []);
  if (ext === ".xlsx") {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheets = book.worksheets.map((item) => item.name);
    const target = sheet ? book.getWorksheet(sheet) : book.worksheets.find((item) => item.actualRowCount > 0) ?? book.worksheets[0];
    if (!target) throw new KitError("sheet_not_found", `Sheet not found: ${sheet}. Sheets: ${sheets.join(", ")}`);
    const matrix: string[][] = [];
    target.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let col = 1; col <= target.columnCount; col++) cells.push(cellText(row.getCell(col).value).trim());
      if (cells.some((cell) => cell)) matrix.push(cells);
    });
    return toTable(headerFirst(matrix, options), sheets, target.name);
  }
  throw new KitError("unsupported_table", `Use a .csv, .tsv or .xlsx file (got ${ext || "no extension"}). Save .xls files as .xlsx first.`);
}

/** 把 "{列名}" 占位符替换成该行的值。 */
export function renderPattern(pattern: string, row: Record<string, string>): string {
  return pattern.replace(/\{([^{}]+)\}/g, (_, key: string) => row[key.trim()] ?? "");
}

export function patternColumns(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}=]+)\}/g)].map((match) => match[1].trim());
}
