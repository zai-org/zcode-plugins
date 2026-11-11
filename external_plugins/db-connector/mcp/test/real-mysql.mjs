/**
 * 真实 MySQL 集成测试：对可用的 MySQL 实例走完整插件链路。
 * 凭证通过环境变量传入（脚本本身不含任何密码）：
 *   TEST_MYSQL_HOST / TEST_MYSQL_PORT / TEST_MYSQL_USER / TEST_MYSQL_PW
 * 夹具库默认 db_connector_test（结束后删除），测试通过插件只读工具完成。
 * 运行（在 mcp/ 目录下，需先 npm run build）：
 *   TEST_MYSQL_HOST=... TEST_MYSQL_USER=root TEST_MYSQL_PW=... node test/real-mysql.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mcpDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(path.join(mcpDir, 'package.json'));
const mysql = require_('mysql2/promise');

const HOST = process.env.TEST_MYSQL_HOST;
const PORT = Number(process.env.TEST_MYSQL_PORT || 3306);
const USER = process.env.TEST_MYSQL_USER || 'root';
const PW = process.env.TEST_MYSQL_PW;
const DB = process.env.TEST_MYSQL_DB || 'db_connector_test';

if (!HOST || PW === undefined) {
  console.error('缺少 TEST_MYSQL_HOST / TEST_MYSQL_PW 环境变量');
  process.exit(2);
}
if (!/^db_connector_test/.test(DB)) {
  console.error('夹具库名必须以 db_connector_test 开头（安全保护）');
  process.exit(2);
}

const serverPath = path.join(mcpDir, 'dist', 'db-connect-server.js');
const workspace = mkdtempSync(path.join(tmpdir(), 'dbconn-real-'));

/* ---- 测试工作区：.env（密码） + db-connections.json（多环境 + 三层行数配置） ---- */
writeFileSync(path.join(workspace, '.env'), `DB_TEST_PW=${PW}\n`);
writeFileSync(
  path.join(workspace, 'db-connections.json'),
  JSON.stringify(
    {
      configVersion: 1,
      activeEnvironment: 'dev',
      defaults: { rowLimit: 2, maxRowLimit: 5, timeoutMs: 8000 },
      environments: {
        dev: {
          description: '测试环境',
          connections: {
            'mysql-test': {
              type: 'mysql', host: HOST, port: PORT, user: USER,
              password: '${DB_TEST_PW}', database: DB,
            },
          },
        },
        'prod-sim': {
          protected: true,
          connections: {
            'mysql-test': {
              type: 'mysql', host: HOST, port: PORT, user: USER,
              password: '${DB_TEST_PW}', database: DB,
            },
          },
        },
      },
    },
    null,
    2
  )
);

/* ---- 夹具：直接用 mysql2 建库建表插数据（插件自身只读，不用于建夹具） ---- */
async function setupFixture() {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PW, multipleStatements: false });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${DB}\`.users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await conn.query(`CREATE TABLE IF NOT EXISTS \`${DB}\`.orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2)
  )`);
  await conn.query(`DELETE FROM \`${DB}\`.users`);
  await conn.query(`DELETE FROM \`${DB}\`.orders`);
  const names = ['alice', 'bob', 'carol', "O'Brien", `x' OR '1'='1`];
  for (const n of names) {
    await conn.query(`INSERT INTO \`${DB}\`.users (name, email) VALUES (?, ?)`, [n, `${n.replace(/[^a-zA-Z]/g, '') || 'u'}@test.local`]);
  }
  const [rows] = await conn.query(`SELECT id FROM \`${DB}\`.users WHERE name = ?`, ['alice']);
  for (const amt of [9.9, 19.9, 29.9]) {
    await conn.query(`INSERT INTO \`${DB}\`.orders (user_id, amount) VALUES (?, ?)`, [rows[0].id, amt]);
  }
  await conn.end();
}

async function teardownFixture() {
  const conn = await mysql.createConnection({ host: HOST, port: PORT, user: USER, password: PW });
  await conn.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await conn.end();
}

/* ---- MCP 服务器进程与 JSON-RPC 通道 ---- */
const child = spawn(process.execPath, [serverPath], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
let nextId = 1;
const pending = new Map();
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
}
async function callTool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  return { isError: result.isError, text: result.content?.[0]?.text ?? '' };
}
async function callToolJson(name, args) {
  const r = await callTool(name, args);
  if (r.isError) throw new Error(`${name} 失败: ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text);
}

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label} ${detail}`); }
}

try {
  console.log(`目标：${HOST}:${PORT}/${DB}（夹具库，测后删除）\n`);
  await setupFixture();

  const init = await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'real-test', version: '0' } });
  notify('notifications/initialized');
  check('initialize 握手', init.serverInfo?.name === 'db-connector');

  // 1. 连接列表与 .env 来源
  const conns = await callToolJson('db_list_connections', {});
  check('列表含 dev 与 prod-sim 环境', !!conns.environments.dev && !!conns.environments['prod-sim']);
  check('envSources 显示 .env', (conns.envSources ?? []).some((s) => s.endsWith('.env')));
  check('连接密码脱敏为 ${…}', conns.environments.dev.connections[0].password === '${…}');

  // 2. 连通性
  const t = await callToolJson('db_test_connection', { connection: 'mysql-test' });
  check('连通性返回 MySQL 版本：' + t.serverInfo, /MySQL|MariaDB/i.test(t.serverInfo));

  // 3. 表列表
  const tables = await callToolJson('db_list_tables', { connection: 'mysql-test' });
  const tableNames = tables.tables.map((x) => x.name).sort();
  check('表列表含 users 与 orders', tableNames.includes('orders') && tableNames.includes('users'), JSON.stringify(tableNames));

  // 4. 表结构
  const desc = await callToolJson('db_describe_table', { connection: 'mysql-test', table: 'users' });
  const colNames = desc.columns.map((c) => c.name);
  check('users 结构含 id/name/email', ['id', 'name', 'email'].every((c) => colNames.includes(c)), JSON.stringify(colNames));

  // 5. 聚合 + 参数绑定
  const cnt = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT COUNT(*) AS c FROM users' });
  check('COUNT(*) = 5', cnt.rows[0].c === 5, JSON.stringify(cnt.rows));

  const byName = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT name FROM users WHERE name = ?', params: ['alice'] });
  check("参数绑定：name=? ['alice'] 命中 1 行", byName.rowCount === 1 && byName.rows[0].name === 'alice');

  const quote = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT name FROM users WHERE name = ?', params: ["O'Brien"] });
  check("参数绑定：单引号值 O'Brien 安全命中", quote.rowCount === 1 && quote.rows[0].name === "O'Brien");

  const inj = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT name FROM users WHERE name = ?', params: [`x' OR '1'='1`] });
  check('注入载荷作为参数值仅精确匹配 1 行（非拼接）', inj.rowCount === 1, `实际 ${inj.rowCount} 行`);

  const agg = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT u.name, SUM(o.amount) AS total FROM users u JOIN orders o ON o.user_id = u.id GROUP BY u.name ORDER BY total DESC' });
  check('JOIN + GROUP BY 聚合正常', agg.rows.length === 1 && Number(agg.rows[0].total) === 59.7, JSON.stringify(agg.rows));

  // 6. 三层行数配置：defaults.rowLimit=2 → maxRowLimit=5
  const l1 = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT id FROM users ORDER BY id' });
  check('未传 limit 时按 defaults.rowLimit=2 截断', l1.rowCount === 2 && l1.truncated === true);
  const l2 = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT id FROM users ORDER BY id', limit: 4 });
  check('limit=4 生效（截断标记）', l2.rowCount === 4 && l2.truncated === true);
  const l3 = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT id FROM users ORDER BY id', limit: 99 });
  check('limit=99 被 maxRowLimit=5 封顶', l3.rowCount === 5 && l3.truncated === false);

  // 7. 只读校验（真实服务器在场仍拒绝）
  const upd = await callTool('db_query', { connection: 'mysql-test', sql: `UPDATE users SET name = 'hacked' WHERE id = 1` });
  check('UPDATE 被拒（未触达服务器）', upd.isError && upd.text.includes('只读校验拒绝'));
  const del = await callTool('db_query', { connection: 'mysql-test', sql: `DELETE FROM users WHERE id = 1` });
  check('DELETE 被拒', del.isError && del.text.includes('只读校验拒绝'));

  // 8. protected 环境提示条
  const prod = await callToolJson('db_query', { connection: 'prod-sim/mysql-test', sql: 'SELECT COUNT(*) AS c FROM users' });
  check('protected 环境返回受保护提示', typeof prod.warning === 'string' && prod.warning.includes('受保护'));

  // 9. 只读不变式：全程跑完后夹具数据未被改动
  const after = await callToolJson('db_query', { connection: 'mysql-test', sql: 'SELECT COUNT(*) AS c FROM users' });
  check('测试全程数据零改动（仍为 5 行）', after.rows[0].c === 5);

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
} finally {
  child.stdin.end();
  await new Promise((r) => child.on('exit', r));
  try { await teardownFixture(); console.log('夹具库已清理'); } catch (e) { console.error('夹具清理失败（请手动删除）:', e.message); }
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
process.exit(failed > 0 ? 1 : 0);
