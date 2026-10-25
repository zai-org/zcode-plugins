#!/usr/bin/env node
/**
 * 用户级安装 / 同步
 *
 * 把插件的命令和技能安装到 ZCode 的用户级目录：
 *   ~/.zcode/commands/<name>.md     命令（发现顺序里优先级高于插件）
 *   ~/.zcode/skills/<name>/SKILL.md 技能
 *
 * 为什么需要它：ZCode 没有命令行安装入口，市场安装只能在界面里点。这是等效的替代路径，
 * 而且命令正文用路径探测定位脚本，所以脚本始终从插件目录实时读取——升级脚本不用重装。
 * 需要重新同步的只有命令和技能的说明文字，插件更新后重跑一次本脚本即可。
 *
 * 用法：
 *   node install-user-scope.mjs                          安装 / 同步（用户级）
 *   node install-user-scope.mjs --workspace <目录>        额外装进该工作区 .zcode/commands
 *   node install-user-scope.mjs --dry-run                只显示会写哪些文件
 *   node install-user-scope.mjs --uninstall              移除副本（插件目录不动）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const CMD_DIR = path.join(HOME, '.zcode', 'commands');
const SKILL_DIR = path.join(HOME, '.zcode', 'skills');

// --workspace <dir>：额外把命令装进该工作区的 .zcode/commands。
// 用户级目录万一没被读取，工作区级是第二条独立路径（发现优先级低于用户级）。
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const uninstall = argv.includes('--uninstall');
const wsIndex = argv.indexOf('--workspace');
const WORKSPACE_DIR = wsIndex >= 0 && argv[wsIndex + 1] ? path.resolve(argv[wsIndex + 1]) : null;
const CMD_DIRS = WORKSPACE_DIR ? [CMD_DIR, path.join(WORKSPACE_DIR, '.zcode', 'commands')] : [CMD_DIR];

// 命令正文里的这个占位符在安装时被替换成脚本的绝对路径（bash 用的正斜杠形式）。
// 这样命令正文不依赖 agent 先跑一次 find 再把路径填进下一条命令；
// 万一插件被搬走，正文里还留了 find 兜底。
const SCRIPT_PLACEHOLDER = '@@CC_USAGE_SCRIPT@@';
const SCRIPT_PATH = path.join(PLUGIN_ROOT, 'scripts', 'cc-usage.mjs');

/** 转成 Git Bash / POSIX 能用的路径写法 */
function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/** 读源命令并把脚本路径占位符替换成真实绝对路径 */
function renderCommand(from) {
  return fs.readFileSync(from, 'utf8').split(SCRIPT_PLACEHOLDER).join(toPosix(SCRIPT_PATH));
}

// 安装清单：记录本安装器写过哪些文件、以及写入时的内容哈希。
// 只有「清单里有、且自我写入后没被改动过」的文件才允许覆盖：
//   - 不在清单里        → 可能是你自己写的同名文件，拒绝
//   - 在清单里但内容变了 → 你改过它，拒绝，不覆盖你的改动
// 清单丢失时退回内容比对（内容与本次渲染一致即视为无冲突）。
function statePath(pluginName) {
  return path.join(SKILL_DIR, pluginName, '.installed.json');
}
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function readState(pluginName) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(pluginName), 'utf8'));
    const map = new Map();
    // 兼容早期只存路径数组的格式
    for (const entry of s.commands ?? []) {
      if (typeof entry === 'string') map.set(entry, null);
      else if (entry?.path) map.set(entry.path, entry.sha256 ?? null);
    }
    return map;
  } catch {
    return new Map();
  }
}
function writeState(pluginName, manifest, plan, installedSkillDir) {
  const state = {
    plugin: pluginName,
    version: manifest.version,
    commands: plan
      .filter((i) => i.kind === '命令' && fs.existsSync(i.to))
      .map((i) => ({ path: i.to, sha256: sha256(fs.readFileSync(i.to, 'utf8')) })),
    skills: plan.filter((i) => i.kind === '技能').map((i) => i.to),
  };
  try {
    fs.mkdirSync(installedSkillDir, { recursive: true });
    fs.writeFileSync(path.join(installedSkillDir, '.installed.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch {
    /* 清单写不了只影响下次更新能否自动识别，不影响本次使用 */
  }
}

function main() {
  const manifest = readJson(path.join(PLUGIN_ROOT, '.zcode-plugin', 'plugin.json'));
  if (!manifest?.name) {
    console.error(`读不到插件清单：${path.join(PLUGIN_ROOT, '.zcode-plugin', 'plugin.json')}`);
    process.exitCode = 1;
    return;
  }

  const commandsDir = path.join(PLUGIN_ROOT, manifest.commands?.replace(/^\.\//, '') || 'commands');
  const skillsDir = path.join(PLUGIN_ROOT, manifest.skills?.replace(/^\.\//, '') || 'skills');

  const commands = listFiles(commandsDir);
  const skills = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md')))
    : [];

  if (uninstall) {
    let removed = 0;
    for (const dir of CMD_DIRS) {
      for (const c of commands) {
        const target = path.join(dir, c);
        if (fs.existsSync(target)) {
          if (!dryRun) fs.rmSync(target);
          console.log(`移除命令  ${target}`);
          removed++;
        }
      }
    }
    for (const s of skills) {
      const target = path.join(SKILL_DIR, s);
      if (fs.existsSync(target)) {
        if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
        console.log(`移除技能  ${target}`);
        removed++;
      }
    }
    console.log(removed ? `\n已移除 ${removed} 项（插件目录未改动）。` : '\n没有需要移除的副本。');
    return;
  }

  const plan = [];
  for (const dir of CMD_DIRS) {
    for (const c of commands) {
      plan.push({ kind: '命令', from: path.join(commandsDir, c), to: path.join(dir, c) });
    }
  }
  for (const s of skills) {
    plan.push({ kind: '技能', from: path.join(skillsDir, s), to: path.join(SKILL_DIR, s) });
  }

  if (!plan.length) {
    console.error('插件里没有可安装的命令或技能。');
    process.exitCode = 1;
    return;
  }

  const priorState = readState(manifest.name);

  const conflicts = [];
  const reasons = [];
  for (const item of plan) {
    if (item.kind !== '命令' || !fs.existsSync(item.to)) continue;
    const rendered = renderCommand(item.from);
    const current = fs.readFileSync(item.to, 'utf8');
    if (current === rendered) continue; // 与本次要写的内容一致，无冲突
    const recorded = priorState.get(item.to);
    if (recorded === undefined) {
      conflicts.push(item.to);
      reasons.push('不在本插件的安装清单里（像是你自己写的文件）');
    } else if (recorded !== null && recorded !== sha256(current)) {
      conflicts.push(item.to);
      reasons.push('内容自上次安装后被修改过');
    }
    // recorded === null（旧格式清单）且内容不同 → 按更新处理，因为清单证明是我们写的
  }
  if (conflicts.length) {
    console.error('为避免覆盖你的内容，已中止。以下文件与本插件要安装的不同：');
    for (let i = 0; i < conflicts.length; i++) console.error(`  ${conflicts[i]}\n      ${reasons[i]}`);
    console.error('\n确认可以覆盖就删掉这些文件再重跑；或先改名保留你自己的版本。');
    process.exitCode = 1;
    return;
  }

  for (const item of plan) {
    if (dryRun) {
      console.log(`将写入  [${item.kind}] ${item.to}`);
      continue;
    }
    fs.mkdirSync(path.dirname(item.to), { recursive: true });
    if (item.kind === '技能') {
      fs.rmSync(item.to, { recursive: true, force: true });
      fs.cpSync(item.from, item.to, { recursive: true });
    } else {
      fs.writeFileSync(item.to, renderCommand(item.from), 'utf8');
    }
    console.log(`已安装  [${item.kind}] ${item.to}`);
  }

  if (dryRun) return;

  // 版本戳放在已安装的技能目录里，用于对比是否已与新版本同步
  const installedSkillDir = path.join(SKILL_DIR, manifest.name);
  writeState(manifest.name, manifest, plan, installedSkillDir);
  for (const s of skills) {
    const stamp = path.join(SKILL_DIR, s, '.synced-version');
    try {
      fs.writeFileSync(stamp, `${manifest.name} ${manifest.version}\n`, 'utf8');
    } catch {
      /* 版本戳只是辅助信息，写不了不影响使用 */
    }
  }

  console.log(
    [
      '',
      `插件 ${manifest.name} v${manifest.version} 已装到用户级目录。`,
      '',
      '接下来：**新建一个任务**（老任务的命令列表不会刷新），然后输入 /quota。',
      '脚本始终从插件目录实时读取，所以以后升级脚本不需要重装；',
      '只有命令/技能的说明文字变了才需要重跑本脚本。',
    ].join('\n'),
  );
}

main();
