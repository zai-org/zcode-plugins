#!/usr/bin/env node
// sqlite3 CLI 的 node:sqlite 替身（Windows Git Bash / 未装 sqlite3 的环境）。
// 用法：node sqlite.mjs [-header|-csv] <db> <sql>
// 输出对齐 sqlite3 CLI：缺省 list 模式（行内 | 分隔、NULL 空串）；-header 先输出表头；
// -csv 输出 RFC4180 CSV（含引号/逗号/换行的值包裹并翻倍引号）。只读打开。
// CLI 特有的 readfile()（价格表注入等 SQL 依赖）以自定义函数补齐；文件不存在返回 NULL，
// 比 CLI 直接报错更利于降级（价格缺失 → 按无价表渲染）。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const flags = [];
while (argv.length && String(argv[0]).startsWith('-') && argv[0] !== '-' && !/^-\d/.test(argv[0])) flags.push(argv.shift());
const header = flags.includes('-header');
const csvMode = flags.includes('-csv');
const dbPath = argv[0];
const sql = argv[1];
if (!dbPath || !sql) process.exit(1);

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  // 公式注入防护：Excel/Numbers 把 = + - @ 开头的单元格当公式执行；前缀单引号（纯负数不处理）
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.function('readfile', (p) => {
    try { return fs.readFileSync(String(p)); } catch (e) { return null; }
  });
  const stmt = db.prepare(sql);
  const rows = stmt.all();
  let keys = rows.length ? Object.keys(rows[0]) : null;
  if (header && !keys && csvMode) {
    try { keys = stmt.columns().map((c) => c.name); } catch (e) {} // 空结果也输出表头（对齐 CLI）
  }
  if (header && keys) console.log((csvMode ? keys.map(csvCell) : keys).join(csvMode ? ',' : '|'));
  for (const r of rows) {
    const vals = Object.values(r).map((v) => (v == null ? '' : String(v)));
    console.log((csvMode ? vals.map(csvCell) : vals).join(csvMode ? ',' : '|'));
  }
} catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}
