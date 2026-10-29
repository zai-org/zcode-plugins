#!/usr/bin/env node
// Stop hook（async: true，fire-and-forget）：每轮回复结束时本地做两件事，全部零模型开销。
//  1. 写回合结束标记（~/.zcode/usage-detail-turn-done.json）：侧栏面板的 MCP 服务轮询到
//     该文件变化后向宿主发 notifications/resources/updated，打开着的用量面板实时刷新「本轮」横幅。
//  2. mode=notify 时（usage.sh turnstats notify）追加一条 macOS 系统通知，作为面板未打开时的兜底。
// 官方语义：async hook 的后台 stdout 不会注入上下文、不影响回合；统计行不进对话（进对话必经模型）。
// 开关：~/.zcode/usage-turnstats.json {"enabled":true,"mode":"notify"|"inject"}；任何异常静默退出。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATS_SCRIPT = path.join(HERE, '..', 'scripts', 'turn-stats.mjs');
const DONE_FILE = path.join(os.homedir(), '.zcode', 'usage-detail-turn-done.json');

function readSwitch() {
  try {
    const v = JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode', 'usage-turnstats.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (!v || v.enabled !== true) return null;
    return v.mode === 'notify' ? 'notify' : (v.mode === 'inject' ? 'inject' : 'inject'); // 兼容旧 {"enabled":true}（无 mode）= inject
  } catch (e) { return null; }
}

try {
  // 标记始终写（仅一次本地文件写）：面板实时卡不依赖 turnstats 开关
  fs.writeFileSync(DONE_FILE, JSON.stringify({ ts: Date.now() }) + '\n');
  if (readSwitch() !== 'notify') process.exit(0);
  const line = execFileSync(process.execPath, [STATS_SCRIPT, '--turn', '--current'], { encoding: 'utf8', timeout: 15000 }).trim();
  const msg = line.split('\n').filter((l) => l.includes('本轮用量'))[0] || line.split('\n')[0] || '';
  if (!msg) process.exit(0);
  // 统一经 notify.mjs 分发：macOS=osascript / Windows=WinRT toast / Linux=notify-send，失败静默
  spawn(process.execPath, [path.join(HERE, '..', 'scripts', 'notify.mjs'), 'ZCode 用量', '本轮统计（零上下文开销）', msg],
    { detached: true, stdio: 'ignore' }).unref();
} catch (e) {}
process.exit(0);
