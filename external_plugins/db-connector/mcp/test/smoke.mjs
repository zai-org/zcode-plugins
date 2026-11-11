/**
 * 冒烟测试：spawn MCP 服务器，走完整 JSON-RPC 流程。
 * 无需真实数据库——SQL 校验在连接解析前执行，配置工具仅落盘。
 * 运行：node test/smoke.mjs（在 mcp/ 目录下，需先 npm run build）
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const mcpDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverPath = path.join(mcpDir, 'dist', 'db-connect-server.js');
const workspace = mkdtempSync(path.join(tmpdir(), 'dbconn-smoke-'));

if (!existsSync(serverPath)) {
  console.error('未找到 dist/db-connect-server.js，请先 npm run build');
  process.exit(1);
}

// 预置系统环境变量 DB_SMOKE_PW：若服务器错误地读取 process.env，测试 10 将失败
const child = spawn(process.execPath, [serverPath], {
  cwd: workspace,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, DB_SMOKE_PW: 'from-process-env' },
});
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
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}
async function callTool(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  return { isError: result.isError, text: result.content?.[0]?.text ?? '' };
}

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label} ${detail}`); }
}

try {
  console.log(`工作区：${workspace}\n`);

  // 1. 握手
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  });
  check('initialize 返回 serverInfo', init.serverInfo?.name === 'db-connector');
  notify('notifications/initialized');

  // 2. 工具列表
  const list = await request('tools/list', {});
  const names = (list.tools ?? []).map((t) => t.name);
  check(`tools/list 返回 10 个工具（实际 ${names.length}）`, names.length === 10);
  check('工具定义完整', list.tools.every((t) => t.description && t.inputSchema));

  // 3. 无配置引导
  const noCfg = await callTool('db_list_connections', {});
  check('无配置时返回 no_config 引导', !noCfg.isError && noCfg.text.includes('no_config'));

  // 4. 只读校验（无需数据库）
  const badCases = [
    ['DROP', { connection: 'x', sql: 'DROP TABLE users' }],
    ['UPDATE', { connection: 'x', sql: 'UPDATE users SET name = 1' }],
    ['多语句', { connection: 'x', sql: 'SELECT 1; DROP TABLE users' }],
    ['注释藏关键词', { connection: 'x', sql: 'SELECT 1 /* DROP TABLE users */ AS x' }],
    ['CTE 藏写入', { connection: 'x', sql: 'WITH t AS (DELETE FROM users RETURNING *) SELECT * FROM t' }],
    ['FOR UPDATE', { connection: 'x', sql: 'SELECT * FROM users FOR UPDATE' }],
    ['危险函数 pg_sleep', { connection: 'x', sql: 'SELECT pg_sleep(10)' }],
    ['危险函数 load_file', { connection: 'x', sql: "SELECT load_file('/etc/passwd')" }],
    ['INTO OUTFILE', { connection: 'x', sql: "SELECT * FROM users INTO OUTFILE '/tmp/x'" }],
  ];
  for (const [label, args] of badCases) {
    const r = await callTool('db_query', args);
    check(`拒绝：${label}`, r.isError && r.text.includes('只读校验拒绝'), r.text.slice(0, 120));
  }

  // 5. 合法 SQL + 不存在的连接 → 错误应是"连接不存在"而非校验拒绝（证明校验先行通过）
  const noConn = await callTool('db_query', { connection: 'ghost', sql: 'SELECT 1 AS x' });
  check('合法 SQL 优先通过校验（报连接/环境错误）', noConn.isError && !noConn.text.includes('只读校验拒绝'), noConn.text.slice(0, 120));

  // 6. 配置工具：拒绝明文密码
  const plain = await callTool('db_add_connection', {
    environment: 'dev', name: 'mysql-main',
    config: { type: 'mysql', host: 'localhost', port: 3306, user: 'root', password: 'plain-secret', database: 'shop' },
  });
  check('db_add_connection 拒绝明文密码', plain.isError && plain.text.includes('明文密码'), plain.text.slice(0, 120));

  // 7. 配置工具：合法写入（passwordEnvVar）
  const add = await callTool('db_add_connection', {
    environment: 'dev', name: 'mysql-main',
    config: { type: 'mysql', host: 'localhost', port: 3306, user: 'root', database: 'shop' },
    passwordEnvVar: 'DB_SMOKE_PW',
  });
  check('db_add_connection 写入成功', !add.isError && add.text.includes('"ok": true'), add.text.slice(0, 160));

  const wsFile = path.join(workspace, 'db-connections.json');
  const raw = existsSync(wsFile) ? readFileSync(wsFile, 'utf8') : '';
  check('配置文件落盘且密码为 ${VAR} 引用', raw.includes('${DB_SMOKE_PW}') && !raw.includes('plain-secret'));
  check('配置为多环境结构', raw.includes('"environments"') && raw.includes('"dev"'));

  // 8. 列表可见 + 活动环境
  const lst = await callTool('db_list_connections', {});
  check('db_list_connections 显示新连接', !lst.isError && lst.text.includes('mysql-main'));
  const act = await callTool('db_set_active_environment', { environment: 'dev' });
  check('db_set_active_environment 成功', !act.isError && act.text.includes('"ok": true'));

  // 9. 合法 SQL + 已存在连接 → 应到达驱动层（连接失败即可，证明校验与解析已通过）
  const drive = await callTool('db_query', { connection: 'mysql-main', sql: 'SELECT 1 AS x' });
  check(
    '查询到达驱动层（连接级错误，非校验错误）',
    drive.isError && !drive.text.includes('只读校验拒绝') && !drive.text.includes('不存在'),
    drive.text.slice(0, 160)
  );

  // 10. 系统环境变量不参与解析：进程 env 里有 DB_SMOKE_PW 仍应报缺失并点名
  const missEnv = await callTool('db_test_connection', { connection: 'mysql-main' });
  check('系统环境变量不参与解析（.env 未定义时报缺失并点名 DB_SMOKE_PW）', missEnv.isError && missEnv.text.includes('DB_SMOKE_PW'), missEnv.text.slice(0, 160));

  // 10b. .env 支持：写入工作区 .env 后变量可用（错误应推进到连接层而非变量缺失）
  writeFileSync(path.join(workspace, '.env'), '# 冒烟测试\nexport DB_SMOKE_PW="secret-value"  # 行内注释\n');
  const withEnv = await callTool('db_test_connection', { connection: 'mysql-main' });
  check('.env 提供变量后不再报环境变量缺失', withEnv.isError && !withEnv.text.includes('环境变量未定义'), withEnv.text.slice(0, 160));
  const lstEnv = await callTool('db_list_connections', {});
  check('db_list_connections 显示 .env 来源', !lstEnv.isError && lstEnv.text.includes('.env'));

  // 11. 删除连接
  const rm = await callTool('db_remove_connection', { environment: 'dev', name: 'mysql-main' });
  check('db_remove_connection 成功', !rm.isError && rm.text.includes('"ok": true'), rm.text.slice(0, 120));

  // 12. .env 解析器单元测试（直接测 dist/config.js）
  const require_ = createRequire(import.meta.url);
  const { parseEnvFile } = require_(path.join(mcpDir, 'dist', 'config.js'));
  const parsed = parseEnvFile(
    [
      '# 全行注释',
      '',
      'export A=1',
      'B="quoted # not comment"',
      "C='single'",
      'D=bare  # 行内注释',
      'invalid-key=x',
      'E=',
    ].join('\n')
  );
  check(
    '.env 解析器：注释/引号/行内注释/export/非法键',
    parsed.A === '1' &&
      parsed.B === 'quoted # not comment' &&
      parsed.C === 'single' &&
      parsed.D === 'bare' &&
      parsed['invalid-key'] === undefined &&
      parsed.E === ''
  );

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
} finally {
  child.stdin.end();
  await new Promise((r) => child.on('exit', r));
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* Windows 临时目录清理失败忽略 */ }
}
process.exit(failed > 0 ? 1 : 0);
