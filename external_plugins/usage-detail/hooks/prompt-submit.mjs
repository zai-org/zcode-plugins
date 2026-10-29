#!/usr/bin/env node
// UserPromptSubmit hook：每次用户发消息时
// 1) 记录会话与提问时间戳到状态文件（turn-stats.mjs --current 守卫的唯一依据）
// 2) 注入「本轮统计指令」：模型在写最终回复正文之前自测本问速率，
//    把输出的统计行原样放进 Markdown 引用块附在回复最末尾。
// 输出必须为严格 JSON；任何异常静默退出，不影响对话。
// 机制参考 zcode-tps-monitor（MIT）实测经验：
//   - promptTs 绝不在别处覆盖，否则 --current 守卫误判"本问无数据"
//   - 统计行必须与完整回复正文同一条消息——客户端会把带工具调用的消息
//     折叠进「模型轨迹」区，统计行单独成条时用户只能看到统计行本身
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATS_SCRIPT = path.join(HERE, '..', 'scripts', 'turn-stats.mjs');
const STATE_FILE = process.env.ZCODE_USAGE_TURN_STATE || path.join(os.homedir(), '.zcode', 'usage-detail-turn.json');

const sid = process.env.ZCODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '';
try {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sessionId: sid, ts: now, promptTs: now, source: 'prompt-submit' }));
} catch (e) {}

// 开关：~/.zcode/usage-turnstats.json {"enabled":true}，缺省关闭。
// 统计行机制必须经由模型（hook 无法直接向消息追加文本）：注入指令约 0.5k token/轮
// + 模型一次工具调用（结果约 0.1k）+ 输出统计行约 0.05k，默认关闭由用户显式开启。
// 模式语义：notify（系统通知，零上下文）不注入指令；inject（对话内统计行）才注入。
// 兼容旧 {"enabled":true}（无 mode 字段）= inject。
function turnStatsMode() {
  try {
    const v = JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode', 'usage-turnstats.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (!v || v.enabled !== true) return null;
    return v.mode === 'notify' ? 'notify' : 'inject';
  } catch (e) { return null; }
}
if (turnStatsMode() !== 'inject') {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }));
  process.exit(0);
}

// 精简指令：注入文本每轮都会永久留在上下文里，是本功能最大的模型开销项
// （约 150 token；统计行本身仅 ~50）。完整约束靠脚本输出格式与模型习惯兜底。
const INSTRUCTION = [
  '',
  '【统计】写正文前先运行一次：node "' + STATS_SCRIPT + '" --turn --current',
  '把它输出的统计行原文放入「> 」引用块，附在本条回复最末尾；统计行必须与正文同一条消息，不要改写数字。',
  '脚本无输出则直接省略，不要为此额外调用工具。',
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: INSTRUCTION },
}));
