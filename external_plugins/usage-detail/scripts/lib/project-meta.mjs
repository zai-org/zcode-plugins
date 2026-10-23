// 项目根与 BYOK 供应商名解析（面板增强数据，只读本地配置，不外发）：
// - providerNames()：读 ~/.zcode/v2/provider_config.json 的 providerConfigRules，
//   只提取 providerId → providerName 映射。该文件含 apiKey 明文，其余字段一律不读不出。
// - projectMap(dirs)：对每个会话目录跑 git -C <dir> rev-parse --show-toplevel 解析真实
//   仓库根，子/孙目录会话因此归并到同一项目；目录不存在或非 git 仓库退化空串（前端回退原目录）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let nameCache = { at: 0, v: null };
export function providerNames() {
  if (nameCache.v && Date.now() - nameCache.at < 60000) return nameCache.v;
  const v = {};
  try {
    const cfg = JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode', 'v2', 'provider_config.json'), 'utf8')).replace(/^\uFEFF/, ''));
    for (const r of ((cfg.config && cfg.config.providerConfigRules && cfg.config.providerConfigRules.providerRules) || [])) {
      const id = String(r.providerId || '');
      const name = String(r.providerName || '').trim();
      if (id && name && name !== id) v[id] = name;
    }
  } catch (e) { /* 配置不存在或非 JSON：无 BYOK 命名 */ }
  nameCache = { at: Date.now(), v };
  return v;
}

const rootCache = new Map();
export function projectRoot(dir) {
  const d = String(dir || '').trim();
  if (!d) return '';
  if (rootCache.has(d)) return rootCache.get(d);
  let root = '';
  try {
    // Windows 的 git 输出正斜杠风格（C:/repo），与会话目录的反斜杠并存时归一为正斜杠，
    // 保证同项目不同目录归并到同一字符串、显示风格一致
    root = String(execFileSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })).trim().replace(/\\/g, '/');
  } catch (e) { root = ''; } // 目录已删除 / 非 git 仓库 / git 未安装（Windows 常见）：退化，前端按原目录分组
  rootCache.set(d, root);
  return root;
}

export function projectMap(dirs) {
  const m = {};
  for (const d of (dirs || [])) m[d] = projectRoot(d);
  return m;
}

// CLI 入口（bash 版 dashboard 消费）：echo '<dirs-json>' | node project-meta.mjs
// → {"providerNames":{...},"projectMap":{...}}
// dirs 走 stdin：Git Bash(MSYS) 会把 argv 里以 / 开头的路径参数自动改写成 Windows
// 安装路径（/home/x → C:/Program Files/Git/home/x），JSON 目录清单会被篡改；stdin 不经转换。
// 仅作为主模块运行——被 import 时 argv 是宿主脚本的参数，绝不能碰。
const asMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  || (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href); // 符号链接安装：Node 对 ESM 主入口默认 realpath 化，两侧都要归一后再比
if (asMain) {
  let raw = '';
  try { if (!process.stdin.isTTY) raw = fs.readFileSync(0, 'utf8'); } catch (e) {}
  let dirs = [];
  try { dirs = JSON.parse(raw.trim() || process.argv[2] || '[]'); } catch (e) {}
  process.stdout.write(JSON.stringify({ providerNames: providerNames(), projectMap: projectMap(dirs) }));
}
