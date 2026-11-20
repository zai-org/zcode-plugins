#!/usr/bin/env node
// 查询套餐配额。数据源链：
//   1. 客户端日志尾随（零密钥，quota-log.mjs）——zcode-plan 套餐桶 + MCP 额度
//   2. /api/monitor/usage/quota/limit（仅使用用户显式提供给本插件的凭据：
//      env ZCODE_USAGE_QUOTA_TOKEN / ANTHROPIC_AUTH_TOKEN，或 ~/.zcode/usage-quota-token.json）
// 隐私红线：绝不读取 provider_config.json / credentials.json 等宿主凭据文件（README 明文承诺）。
// 两级都无数据时输出降级提示（面板渲染为操作指引）。
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readQuotaFromLog } from './quota-log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveEndpoint() {
  // 0) 插件设置注入的官方配额 Key（userConfig.quotaToken → panel-server env；命令行也可直接 export）
  if (process.env.ZCODE_USAGE_QUOTA_TOKEN) {
    return { token: process.env.ZCODE_USAGE_QUOTA_TOKEN, base: process.env.ZCODE_USAGE_QUOTA_BASE || 'https://open.bigmodel.cn' };
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    return { token: process.env.ANTHROPIC_AUTH_TOKEN, base: process.env.ANTHROPIC_BASE_URL };
  }
  // 用户手动放置的令牌文件（显式提供给本插件的凭据）
  try {
    const tf = JSON.parse(String(fs.readFileSync(path.join(os.homedir(), '.zcode/usage-quota-token.json'), 'utf8')).replace(/^\uFEFF/, ''));
    if (tf && tf.token) return { token: tf.token, base: tf.base || 'https://open.bigmodel.cn' };
  } catch (e) {}
  // 不扫描 provider_config.json / ~/.claude/settings.json / credentials.json：
  // 那些凭据用户并未提供给本插件，读取并外发即违反「只读名称映射、不读取 API Key」的承诺。
  return null;
}

const ep = resolveEndpoint();
// 数据源 1：客户端日志（零密钥）。有桶直接输出；日期非今天标 stale。
const fromLog = readQuotaFromLog();
if (fromLog.ok && fromLog.buckets.length) {
  console.log(JSON.stringify({
    ok: true,
    source: 'client-log',
    stale: !!fromLog.stale,
    logDate: fromLog.logDate,
    limits: fromLog.buckets.map(function (b) {
      return { type: b.name, percentage: b.percent, resetTime: b.resetAt ? new Date(b.resetAt).toLocaleString() : null, remaining: b.remaining, limit: b.limit };
    })
  }));
  process.exit(0);
}
if (!ep) {
  console.error(JSON.stringify({ error: '暂无可用配额数据：客户端日志中尚无额度观测（客户端刷新套餐余额后写入），也未找到 API 凭据。可在 ~/.zcode/usage-quota-token.json 写入 {"token":"你的KEY","base":"https://open.bigmodel.cn"} 启用监控接口。' }));
  process.exit(2);
}
const base = ep.base.replace(/\/+$/, '');
const url = base + '/api/monitor/usage/quota/limit';

https.get(url, { headers: { Authorization: 'Bearer ' + ep.token, Accept: 'application/json' }, timeout: 15000 }, function (res) {
  let body = '';
  res.on('data', function (c) { body += c; });
  res.on('end', function () {
    if (res.statusCode !== 200) {
      console.error(JSON.stringify({ error: 'HTTP ' + res.statusCode, body: body.slice(0, 300) }));
      process.exit(1);
    }
    try {
      const j = JSON.parse(body);
      const limits = (j.data && j.data.limits) || j.limits || [];
      const out = limits.map(function (l) {
        return { type: l.type, percentage: l.percentage, resetTime: l.resetTime || l.reset_time || null };
      });
      console.log(JSON.stringify({ ok: true, platform: base.includes('z.ai') ? 'ZAI' : 'ZHIPU', limits: out }));
    } catch (e) {
      console.error(JSON.stringify({ error: '响应解析失败', body: body.slice(0, 300) }));
      process.exit(1);
    }
  });
}).on('error', function (e) {
  console.error(JSON.stringify({ error: e.message }));
  process.exit(1);
});
