/**
 * 用 ZCode 自己的命令解析逻辑校验安装后的文件。
 * 以下函数逐行复刻自 resources/glm/zcode.cjs：
 *   Q4s extractFrontmatter / t6s parseFlatYaml / oOe parseScalar
 *   r6s extractDescription / X4s commandNameFromPath / tVr normalizeCommandName
 *   J4s 名称正则 / Y4s 允许的 frontmatter 键
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const YWr = '.md';
const J4s = /^[a-z0-9][a-z0-9_:-]{0,63}$/;
const XWr = 1024;
const Y4s = new Set(['allowed-tools', 'argument-hint', 'description', 'disable-noninteractive', 'model', 'skills']);

function Q4s(e) {
  let t = e.replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return null;
  let n = t.split(/\r?\n/);
  if (n[0]?.trim() !== '---') return null;
  let o = n.findIndex((s, a) => a > 0 && s.trim() === '---');
  return o <= 0 ? null : n.slice(1, o).join('\n');
}
function t6s(e, t, n) {
  let o = {}, s = [];
  for (let [a, l] of e.split(/\r?\n/).entries()) {
    if (l.trim().length === 0 || l.trim().startsWith('#') || /^\s/.test(l)) continue;
    let u = l.indexOf(':');
    if (u <= 0) {
      n.push({ code: 'custom_command_invalid_frontmatter', message: `Invalid frontmatter line ${a + 1} in ${path.basename(t)}`, path: t, severity: 'warning' });
      continue;
    }
    let f = l.slice(0, u).trim();
    s.push(f);
    o[f] = l.slice(u + 1).trim();
  }
  return { keys: s, values: o };
}
function e6s() { return { keys: [], values: {} }; }
function oOe(e) {
  if (e === undefined) return;
  let t = e.trim();
  if (t.length !== 0) return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1).trim() : t;
}
function nVr(e, t) { return e.length > t ? e.slice(0, t) : e; }
function r6s(e) {
  let t = e.split(/\r?\n/).map((n) => n.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim()).find(Boolean);
  return t ? nVr(t, XWr) : undefined;
}
function JWr(e) {
  let t = e.replace(/^\uFEFF/, '');
  if (!t.startsWith('---')) return e;
  let n = t.split(/\r?\n/);
  if (n[0]?.trim() !== '---') return e;
  let o = n.findIndex((s, a) => a > 0 && s.trim() === '---');
  return o <= 0 ? e : n.slice(o + 1).join('\n');
}
function tVr(e) { return e.trim().replace(/^\/+/, '').toLowerCase(); }
function X4s(e, t) { return tVr(path.relative(t, e).slice(0, -YWr.length).split(/[\\/]+/).join(':')); }

/** 复刻 parseCommand */
function parseCommand(file, rootPath, diagnostics) {
  let s;
  try { s = fs.readFileSync(file, 'utf8'); }
  catch (err) { diagnostics.push({ code: 'custom_command_read_failed', path: file, severity: 'warning' }); return null; }
  const name = X4s(file, rootPath);
  if (!J4s.test(name)) { diagnostics.push({ code: 'custom_command_invalid_name', message: `Invalid custom command name: ${name}`, path: file, severity: 'error' }); return null; }
  const fm = Q4s(s);
  const parsed = fm ? t6s(fm, file, diagnostics) : e6s();
  const body = JWr(s).trim();
  const description = oOe(parsed.values.description) ?? r6s(body);
  if (!description) { diagnostics.push({ code: 'custom_command_invalid_frontmatter', message: `Custom command must include a description or non-empty body: ${file}`, path: file, severity: 'error' }); return null; }
  for (const k of parsed.keys) {
    if (!Y4s.has(k)) diagnostics.push({ code: 'custom_command_unknown_frontmatter', commandName: name, message: `Unknown custom command frontmatter key: ${k}`, path: file, severity: 'warning' });
  }
  return {
    name,
    description: nVr(description, XWr),
    argumentHint: oOe(parsed.values['argument-hint']),
    frontmatterKeys: parsed.keys,
    path: file,
    scope: 'user',
    rootPath,
  };
}

/** 复刻 commandFilesUnderRoot + scanMarkdownFiles */
function scan(rootPath, diagnostics, depth = 0) {
  if (depth > 12) return [];
  let entries;
  try { entries = fs.readdirSync(rootPath, { withFileTypes: true }); }
  catch (err) { diagnostics.push({ code: 'custom_command_scan_failed', message: String(err.message), path: rootPath, severity: 'warning' }); return []; }
  const out = [];
  for (const a of entries) {
    const full = path.resolve(rootPath, a.name);
    let isDir = a.isDirectory();
    let isFile = a.isFile();
    if (a.isSymbolicLink()) {
      try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
    }
    if (isDir) out.push(...scan(full, diagnostics, depth + 1));
    else if (isFile && a.name.toLowerCase().endsWith(YWr)) out.push(full);
  }
  return out;
}

// ---- 运行：模拟 HWr 的根目录解析（用户级 + 工作区级）----
const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
const workspace = process.argv[2] ? path.resolve(process.argv[2]) : null;

console.log('home       =', home);
console.log('os.homedir =', os.homedir());
console.log('workspace  =', workspace ?? '(未指定，仅检查用户级)');

// HWr 顺序：用户级（优先级 10）→ 各工作区目录向上逐级
const roots = [
  { path: path.resolve(path.join(home, '.zcode', 'commands')), scope: 'user', source: 'zcode', priority: 10 },
  { path: path.resolve(path.join(home, '.agents', 'commands')), scope: 'user', source: 'agents', priority: 10 },
];
if (workspace) {
  // 与 ZCode 一致：向上找 git 仓库根（.git），找到就走到那里为止；没有仓库则只用 cwd 这一层。
  // 只走到盘根会重复扫到 ~/.zcode/commands，产生并不存在的同名告警。
  const findWorktreeRoot = (start) => {
    let dir = start;
    for (;;) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };
  const root = findWorktreeRoot(workspace);
  const dirs = [];
  if (root) {
    let dir = workspace;
    for (;;) {
      dirs.push(dir);
      if (dir === root) break;
      dir = path.dirname(dir);
    }
  } else {
    dirs.push(workspace);
  }
  let p = 20;
  for (const dir of dirs) {
    roots.push({ path: path.join(dir, '.zcode', 'commands'), scope: 'project', source: 'zcode', priority: p });
    roots.push({ path: path.join(dir, '.agents', 'commands'), scope: 'project', source: 'agents', priority: p });
    p += 10;
  }
  console.log(`git 仓库根   = ${root ?? '(不是 git 仓库，只用 cwd)'}`);
}

const diagnostics = [];
const byName = new Map();
let total = 0;
// 与 discoverCommands 一致：按 priority 升序，先到者胜
for (const root of roots.sort((a, b) => a.priority - b.priority)) {
  let exists = false;
  try { exists = fs.statSync(root.path).isDirectory(); } catch { exists = false; }
  if (!exists) continue;
  const found = [];
  for (const f of scan(root.path, diagnostics)) {
    const c = parseCommand(f, root.path, diagnostics);
    if (!c) continue;
    total++;
    if (byName.has(c.name)) { diagnostics.push({ code: 'custom_command_duplicate_name', commandName: c.name, message: `被更高优先级的同名命令忽略: ${c.name}`, path: f, severity: 'warning' }); continue; }
    byName.set(c.name, c);
    found.push(c.name);
  }
  console.log(`\n根目录 [${root.scope}/${root.source}] ${root.path}`);
  console.log(`  发现 ${found.length} 个: ${found.map((n) => '/' + n).join(', ') || '（无）'}`);
}

console.log(`\n最终可用命令 ${byName.size} 个（总扫描 ${total}，去重后）`);
const reserved = ['clear','compact','compress','continue','dwf','effort','expert','fork','goal','help','init','language','locale','login','logout','mcp','mode','model','new','plan','plugin','plugins','resume','rewind','skill','target','variant'];
for (const c of [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`\n  /${c.name}   [${c.scope}]`);
  console.log(`      description   = ${c.description}`);
  console.log(`      argument-hint = ${c.argumentHint}`);
  console.log(`      frontmatter   = [${c.frontmatterKeys.join(', ')}]`);
  console.log(`      保留名冲突     = ${reserved.includes(c.name) ? '是（会被丢弃）' : '无'}`);
  const body = fs.readFileSync(c.path, 'utf8');
  const m = body.match(/CC_SCRIPT="([^"]+)"/);
  if (m) console.log(`      脚本路径       = ${m[1]}  ${fs.existsSync(m[1]) ? '✓ 存在' : '✗ 不存在'}`);
}

console.log(`\n诊断 ${diagnostics.length} 条:`);
for (const d of diagnostics) console.log(`  [${d.severity}] ${d.code} ${d.path || ''} ${d.message || ''}`);
