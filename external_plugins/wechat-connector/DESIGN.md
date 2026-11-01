# wechat-connector 微信接入插件 · 设计草案 v0.2

日期:2026-11-01 ｜ 状态:v0.2 —— M1 已实现并实测通过(errcode 0);M2 规划中

## 1. 目标与范围

让 ZCode 通过**微信官方接口**收发消息:

| 能力 | 方向 | 通道 | 版本 |
|---|---|---|---|
| 群通知(文本 / Markdown) | 出站 | 企业微信群机器人 webhook | M1 |
| 对话机器人 | 双向 | 微信公众号(开发用测试号) | M2 |
| 图片 / 模板卡片、多群多渠道 | — | 同上 | M3 |

**明确不做**:个人微信客户端自动化 / 协议机器人——违反微信使用条款、有封号风险,不碰。

## 2. 总体架构

```
ZCode 会话
  │  skills(纯指令文档,教 agent 怎么做)
  │  ├─ wechat-send:发通知(curl → 机器人 webhook)
  │  └─ wechat-bot:收发对话(读 mailbox → 生成回复 → curl 客服接口)
  │
  ├──(M2 起)gateway:常驻小服务(Node,无重依赖)
  │     微信服务器 → HTTP 回调 → 验签 → 追加 mailbox/inbox.jsonl → 立即回空串
  │
  ├──(M2 起)responder:回复引擎,可插拔
  │     A. zcode-session:ZCode 定时任务读 mailbox,用当前会话模型生成回复(能调全部工具)
  │     B. llm-api:常驻脚本轮询 mailbox,直接调 OpenAI 兼容接口生成回复(默认 DeepSeek)
  │
  └── 运行时数据 ~/.zcode/wechat/
        config.json(多个 webhook 渠道、appid/secret/token)
        mailbox/inbox.jsonl(网关写,ZCode 读)
        mailbox/seen.json(MsgId 去重)
```

设计原则:**先零依赖,后加组件**。

- M1 不需要任何常驻进程:skill 教 agent 用 `curl` 直接调 webhook,密钥从环境变量读。
- M2 才引入 gateway + mailbox;收发用 Read/curl 即可完成,先不写 MCP server,等工具面变大后再封装成 MCP(留作演进项)。

## 3. 接口约定

**出站(企业微信 webhook)**

- `POST https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=XXX`
- msgtype:`text`(支持 @mention)/ `markdown` / `image`(base64+md5)/ 模板卡片
- 频控:每机器人 20 条/分钟,超出时排队或合并;失败退避重试 3 次

**入站(公众号回调,gateway 暴露)**

- `GET /wechat/callback`:微信验证,echostr 原样返回
- `POST /wechat/callback`:验签 `sha1(sort(token, timestamp, nonce))`,解析 XML 得 FromUser / Content / MsgId
- 收到即回空串(规避 5 秒被动回复超时与重推),消息落 mailbox 异步处理
- 回复走客服接口 `POST message/custom/send`(测试号无 48h 窗口限制)

**回复引擎(M2,可插拔)**

- 方案 A `zcode-session`:定时自动化(如每 2 分钟)拉 mailbox,ZCode 用当前模型生成并发出回复——能查文件、跑命令,适合"半自动助理";依赖 ZCode 会话在跑。
- 方案 B `llm-api`(默认先做):独立 responder 脚本常驻轮询 mailbox,直接调 OpenAI 兼容接口生成并回复。默认接 DeepSeek:`base_url=https://api.deepseek.com`、`model=deepseek-chat`、密钥 `DEEPSEEK_API_KEY`;换其他模型只改 base_url/model 两个变量。7×24 无人值守,成本最低。

**配置优先级**:环境变量 > `config.json`。
`WECHAT_WEBHOOK_URL`、`WECHAT_APPID` / `WECHAT_SECRET` / `WECHAT_TOKEN` / `WECHAT_ENCODING_AES_KEY`、`DEEPSEEK_API_KEY`(M2 方案 B)。
密钥永不写入插件源码、不进 git。

## 4. 插件目录结构(按 ZCode 插件规范)

```
plugins/
  marketplace.json                       # 本地测试市场
  wechat-connector/
    .zcode-plugin/plugin.json            # name: wechat-connector, version 0.1.0
    skills/wechat-send/SKILL.md
    skills/wechat-bot/SKILL.md           # M2
    gateway/index.mjs + package.json     # M2
    DESIGN.md / README.md
```

manifest 只声明真实存在的组件(M1 仅 `"skills": "./skills"`),M2 起再按需加 `"mcpServers"`。

## 5. 里程碑与验收

| 里程碑 | 内容 | 验收标准(代表性用例) |
|---|---|---|
| M1 出站通知 | wechat-send skill + 配置模板 + 冒烟脚本 | 对 ZCode 说"往研发群发:今晚 8 点发布"→ 群里收到该消息 |
| M2 双向对话 | gateway + mailbox + wechat-bot skill + responder(默认 DeepSeek 方案 B) | 给测试号发"你好"→ 1 分钟内收到机器人回复 |
| M3 增强 | 图片/卡片消息、多群渠道管理、消息日志查询 | 另行评审 |

回复引擎方案 A 由 ZCode 定时自动化驱动(每 2 分钟处理一次新消息),平时也可以手动说一句"看看微信";方案 B 由 responder 自己轮询,完全不依赖 ZCode 在线。

## 6. 安全与合规

- 回调验签,可选 AES 加密模式;验签失败一律 403
- MsgId 去重,防微信重推导致重复回复
- webhook URL 视同密码,不入库不入 git
- 频控 + 退避重试,防止刷屏被封 webhook
- 全程走官方 API,无逆向协议、无第三方机器人框架

## 7. 风险与限制

- 公众号被动回复有 5 秒超时 → 已用"回空 + 异步 mailbox"模式规避
- 测试号回调需要公网可达的 80/443 → 本地开发用内网穿透(cpolar / ngrok / frp),或直接部署到云服务器
- 未认证订阅号的客服接口有 48 小时会话窗口限制 → 先在测试号上开发,不受此限
- 企业微信 webhook 每机器人 20 条/分钟,大量通知需合并发送

## 8. 设计决策记录(已确认)

1. 通道:企业微信群机器人(出站,M1)+ 公众号(双向,M2);个人微信客户端自动化永不支持。
2. 架构:M1 零依赖(skill + curl);M2 起引入 gateway(Node)+ 本地信箱;回复引擎可插拔(A:ZCode 会话 / B:OpenAI 兼容 API,默认 DeepSeek)。
3. 实现语言:Node/JavaScript(gateway 与未来 MCP),skill 为纯 Markdown。
4. M2 的 gateway 部署位置:待定(本地 + 内网穿透,或云服务器)。
