#!/usr/bin/env node
// sqlite3 CLI 的 node:sqlite 替身（Windows Git Bash / 未装 sqlite3 的环境）。
// 用法：node sqlite.mjs [-header] <db> <sql>
// 输出对齐 sqlite3 CLI list 模式：行内 | 分隔、NULL 为空串；-header 先输出表头行。只读打开。
import { DatabaseSync } from 'node:sqlite';

const argv = process.argv.slice(2);
const header = argv[0] === '-header';
const dbPath = header ? argv[1] : argv[0];
const sql = header ? argv[2] : argv[1];
if (!dbPath || !sql) process.exit(1);

try {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(sql).all();
  if (header && rows.length) console.log(Object.keys(rows[0]).join('|'));
  for (const r of rows) {
    console.log(Object.values(r).map((v) => (v == null ? '' : String(v))).join('|'));
  }
} catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}
