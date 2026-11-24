#!/usr/bin/env node
// PermissionRequest hook（async: true）：Agent 弹出权限批准请求时发 macOS 系统提醒。
// 场景：挂机跑长任务时人不在屏幕前，批准请求会被静默挂起——这条通知把人拉回来。
// 官方语义：async hook 的后台 stdout 不会注入上下文、不影响回合，零模型开销。
// 开关：~/.zcode/usage-alerts.json {"permission":true}（默认关；usage.sh alerts permission on）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE_NOTIFY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

try {
  const v = JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode', 'usage-alerts.json'), 'utf8')).replace(/^\uFEFF/, ''));
  if (v.permission !== true) process.exit(0);
  let tool = '';
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    tool = String(input.tool_name || input.tool || '').replace(/"/g, '');
  } catch (e) {}
  const msg = tool ? `正在等待你批准：${tool}` : 'Agent 正在等待你的批准';
  // 统一经 notify.mjs 分发：macOS / Windows / Linux，失败静默
  spawn(process.execPath, [path.join(HERE_NOTIFY, "notify.mjs"), "ZCode 用量", "需要你的确认", msg, "zcode"],
    { detached: true, stdio: 'ignore' }).unref();
} catch (e) {}
process.exit(0);
