export interface Merge {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface ScanTable {
  name: string;
  /** 单元格文字，按行。被合并覆盖的格子留空字符串。 */
  rows: string[][];
  headerRows: number;
  merges: Merge[];
  /** 模型没把握的格子 [行, 列]。 */
  uncertain: [number, number][];
  /** 用户在面板里确认过的格子 [行, 列]。 */
  confirmed: [number, number][];
  /** 表格在图片中的位置（像素），用于面板里按格子大致定位原图。 */
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface Parsed {
  value: number;
  format: string;
}

const CJK_DIGITS: Record<string, number> = {
  "零": 0, "〇": 0, "一": 1, "壹": 1, "二": 2, "贰": 2, "两": 2, "兩": 2, "三": 3, "叁": 3, "四": 4, "肆": 4,
  "五": 5, "伍": 5, "六": 6, "陆": 6, "陸": 6, "七": 7, "柒": 7, "八": 8, "捌": 8, "九": 9, "玖": 9,
};
const CJK_UNITS: Record<string, number> = { "十": 10, "拾": 10, "百": 100, "佰": 100, "千": 1000, "仟": 1000, "万": 10000, "萬": 10000 };

/** 中文数字：十、十一、二十、一百零三、一万二千。无单位时按数位拼接（一二三 = 123）。 */
export function parseCJKInteger(text: string): number | null {
  const chars = [...text];
  if (!chars.length || !chars.every((c) => c in CJK_DIGITS || c in CJK_UNITS)) return null;
  if (chars.every((c) => c in CJK_DIGITS)) return Number(chars.map((c) => CJK_DIGITS[c]).join(""));
  let total = 0;
  let current = 0;
  let hasDigit = false;
  for (const c of chars) {
    if (c in CJK_DIGITS) {
      current = CJK_DIGITS[c];
      hasDigit = true;
      continue;
    }
    const unit = CJK_UNITS[c];
    if (unit === 10000) {
      const n = hasDigit ? current : total === 0 ? 1 : 0;
      total = (total + n) * unit;
      current = 0;
      hasDigit = false;
      continue;
    }
    total += (hasDigit ? current : 1) * unit;
    current = 0;
    hasDigit = false;
  }
  return total + current;
}

/** 识别数字：千分位、全角、括号负数、负号、百分号、货币符号、中文数字。不是数字返回 null。 */
export function parseNumber(raw: string): Parsed | null {
  let text = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，]/g, ",")
    .replace(/[．]/g, ".")
    .replace(/[－−–]/g, "-");
  if (!text) return null;
  let negative = false;
  const paren = /^\((.*)\)$/.exec(text) ?? /^（(.*)）$/.exec(text);
  if (paren) {
    negative = true;
    text = paren[1].trim();
  }
  const currency = /^([¥￥$€£]|RMB|CNY|USD)\s*/i.exec(text);
  if (currency) text = text.slice(currency[0].length);
  text = text.replace(/\s*元$/, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  const percent = text.endsWith("%");
  if (percent) text = text.slice(0, -1).trim();
  let value: number;
  let grouped = false;
  let decimals = 0;
  if (/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^\.\d+$/.test(text)) {
    grouped = text.includes(",");
    decimals = (text.split(".")[1] ?? "").length;
    value = Number(text.replace(/,/g, ""));
  } else {
    const cjk = parseCJKInteger(text);
    if (cjk === null) return null;
    value = cjk;
  }
  if (percent) value /= 100;
  if (negative) value = -value;
  const base = `${grouped ? "#,##0" : "0"}${decimals ? `.${"0".repeat(decimals)}` : ""}`;
  const format = percent ? `${base}%` : negative && paren ? `${base};(${base})` : base;
  return { value, format };
}

const TOTAL_RE = /^(?:合\s*计|总\s*计|小\s*计|总\s*额|共\s*计|(?:sum|total|subtotal|grand total)\b)/i;

export interface Issue {
  row: number;
  col: number;
  kind: "uncertain" | "total_mismatch" | "not_number" | "ragged_row";
  message: string;
}

/** 规范化：补齐每行列数、合并范围裁到表格内。 */
export function normalizeTable(input: Partial<ScanTable>, index: number): { table: ScanTable; issues: Issue[] } {
  const issues: Issue[] = [];
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? "" : String(c))) : []));
  const width = Math.max(0, ...rows.map((r) => r.length));
  rows.forEach((r, i) => {
    if (r.length && r.length < width) issues.push({ row: i, col: r.length, kind: "ragged_row", message: `row ${i + 1} has ${r.length} cells, others have ${width} — padded with empty cells; check for a missing or shifted column` });
    while (r.length < width) r.push("");
  });
  const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < rows.length && c < width;
  const merges = (Array.isArray(input.merges) ? input.merges : [])
    .map((m) => ({ row: Math.trunc(Number(m.row)), col: Math.trunc(Number(m.col)), rowSpan: Math.max(1, Math.trunc(Number(m.rowSpan) || 1)), colSpan: Math.max(1, Math.trunc(Number(m.colSpan) || 1)) }))
    .filter((m) => inside(m.row, m.col) && (m.rowSpan > 1 || m.colSpan > 1))
    .map((m) => ({ ...m, rowSpan: Math.min(m.rowSpan, rows.length - m.row), colSpan: Math.min(m.colSpan, width - m.col) }));
  const cells = (list: unknown) => (Array.isArray(list) ? list : []).filter((p): p is [number, number] => Array.isArray(p) && inside(Number(p[0]), Number(p[1]))).map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
  const b = input.bounds;
  const table: ScanTable = {
    name: String(input.name || `Table ${index + 1}`).slice(0, 31).replace(/[\\/?*[\]:]/g, " "),
    rows,
    headerRows: Math.min(rows.length, Math.max(0, Math.trunc(Number(input.headerRows ?? 1)))),
    merges,
    uncertain: cells(input.uncertain),
    confirmed: cells(input.confirmed),
    ...(b && [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(Number(v))) ? { bounds: { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) } } : {}),
  };
  return { table, issues };
}

const key = (r: number, c: number) => `${r}:${c}`;

/** 校验：没把握且未确认的格子、合计行与上面数字之和不符、数字列里混入的非数字。 */
export function checkTable(table: ScanTable): Issue[] {
  const issues: Issue[] = [];
  const confirmed = new Set(table.confirmed.map(([r, c]) => key(r, c)));
  for (const [r, c] of table.uncertain) if (!confirmed.has(key(r, c))) issues.push({ row: r, col: c, kind: "uncertain", message: `cell ${cellRef(r, c)} "${table.rows[r][c]}" was hard to read — please check` });
  const body = table.rows.map((row, r) => ({ row, r })).filter(({ r }) => r >= table.headerRows);
  const width = table.rows[0]?.length ?? 0;
  const headerOf = (c: number) => table.rows.slice(0, table.headerRows).map((row) => row[c]?.trim() ?? "").filter(Boolean).join(" ");
  const QTY_HEADER = /数量|件数|qty|quantity|count|单价|价格|金额|amount|price|total|合计|总计/i;
  const numericCols: number[] = [];
  for (let c = 0; c < width; c++) {
    const values = body.filter(({ row }) => !TOTAL_RE.test(row.find((x) => x.trim()) ?? "")).map(({ row }) => row[c].trim()).filter(Boolean);
    const nums = values.filter((v) => parseNumber(v));
    const headerHint = QTY_HEADER.test(headerOf(c)) && nums.length >= 1 && values.length >= 1;
    if (values.length >= 2 && (nums.length / values.length >= 0.6 || headerHint)) {
      numericCols.push(c);
      for (const { row, r } of body) {
        const v = row[c].trim();
        if (v && !parseNumber(v) && !/^[-—–/\\.…·]+$|^n\/?a$/i.test(v) && !TOTAL_RE.test(v) && !confirmed.has(key(r, c))) issues.push({ row: r, col: c, kind: "not_number", message: `cell ${cellRef(r, c)} "${v}" is not a number in a numeric column` });
      }
    }
  }
  const isTotalHeader = (h: string) => {
    const t = h.trim();
    return TOTAL_RE.test(t) || /(?:合\s*计|总\s*计|小\s*计|总\s*额|共\s*计|(?:sum|total|subtotal|grand[\s-]*total))$/i.test(t);
  };
  const totalCols = Array.from({ length: width }, (_, c) => c).filter((c) => isTotalHeader(headerOf(c)));
  // 合计行：小计累加上一个合计/小计之后的行；合计/总计累加上一个合计之后的所有明细行（跳过小计）。
  const isSub = (label: string) => /^小\s*计|^subtotal/i.test(label);
  let sectionStart = table.headerRows;
  let grandStart = table.headerRows;
  for (const { row, r } of body) {
    const label = (row.find((x) => x.trim()) ?? "").trim();
    if (!TOTAL_RE.test(label)) continue;
    const sub = isSub(label);
    for (const c of numericCols) {
      const total = parseNumber(row[c]);
      if (!total) continue;
      let sum = 0;
      let count = 0;
      for (let i = sub ? sectionStart : grandStart; i < r; i++) {
        if (TOTAL_RE.test((table.rows[i].find((x) => x.trim()) ?? "").trim())) continue;
        const n = parseNumber(table.rows[i][c]);
        if (n) {
          sum += n.value;
          count++;
        }
      }
      const tolerance = Math.max(0.011, Math.abs(total.value) * 1e-9);
      if (count >= 2 && Math.abs(sum - total.value) > tolerance && !confirmed.has(key(r, c))) {
        issues.push({ row: r, col: c, kind: "total_mismatch", message: `${label} ${cellRef(r, c)} = ${row[c].trim()}, but the cells above add up to ${round(sum)} (difference ${round(total.value - sum)})` });
      }
    }
    sectionStart = r + 1;
    if (!sub) grandStart = r + 1;
  }
  // 合计列：同一行其它数字列之和应等于该列（跳过合计行，避免与纵向检查重复）。
  for (const tc of totalCols) {
    for (const { row, r } of body) {
      const label = (row.find((x) => x.trim()) ?? "").trim();
      if (TOTAL_RE.test(label)) continue;
      const total = parseNumber(row[tc]);
      if (!total || confirmed.has(key(r, tc))) continue;
      let sum = 0;
      let count = 0;
      for (const c of numericCols) {
        if (c === tc || totalCols.includes(c)) continue;
        const n = parseNumber(row[c]);
        if (n) {
          sum += n.value;
          count++;
        }
      }
      const tolerance = Math.max(0.011, Math.abs(total.value) * 1e-9);
      if (count >= 2 && Math.abs(sum - total.value) > tolerance) {
        issues.push({ row: r, col: tc, kind: "total_mismatch", message: `${headerOf(tc) || "Total"} ${cellRef(r, tc)} = ${row[tc].trim()}, but the other numeric cells in the row add up to ${round(sum)} (difference ${round(total.value - sum)})` });
      }
    }
  }
  return issues;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function cellRef(r: number, c: number) {
  let col = "";
  let n = c + 1;
  while (n > 0) {
    col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
    n = Math.floor((n - 1) / 26);
  }
  return `${col}${r + 1}`;
}

export function toCsv(table: ScanTable) {
  const cell = (t: string) => (/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  return "\uFEFF" + table.rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
