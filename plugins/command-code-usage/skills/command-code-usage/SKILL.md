---
name: command-code-usage
description: Use when asked how much Command Code quota/credits/balance is left, how close the GOAT/Pro/Max/Teams plan is to its 5-hour or weekly cap, whether there is enough quota to finish a task, when a limit resets, or why a Command Code model request was rate-limited — covers reading the live panel via the bundled script and the underlying /alpha account API fields.
---

# Command Code 额度查询

用户问「用到什么程度了」「还剩多少」「够不够跑完」「什么时候重置」「怎么被限流了」，都归这里。

Command Code 的额度由**三个数**决定：月度额度（或余额）、5 小时滚动窗口、每周滚动窗口。
两个窗口是关键——月度还剩很多不代表现在能连续跑，因为 5 小时窗口可能已经贴着上限。

## 做法：跑脚本，把面板原样给用户

```bash
find "$HOME/.zcode" -type f -name cc-usage.mjs -path '*command-code-usage*' -print -quit 2>/dev/null
node "<上一步的脚本路径>" --no-color
```

脚本内置凭证发现与字段换算，输出即成品面板。**放进代码块原样转述**，不要重算数字，也不要重排成表格。

| 参数 | 用途 |
|---|---|
| （无） | 默认面板：三条进度条 + 重置倒计时 + 预估 |
| `--md` | Markdown 表格，用户要复制或贴到别处时用 |
| `--compact` | 一行摘要 |
| `--json` | 归一化字段全量（含原始响应，可用 `--from-json` 离线重放） |
| `--demo hot` | 样例数据，预览用量吃紧时的告警 |
| `--verbose` | 凭证来源与接口地址，排查用 |
| `--html` / `--serve` | 可选：浏览器大图。用户没要求就别用 |

## 怎么回答才真的有用

面板里已经有两个直接回答用户目的的数字：

- **「还能跑约 N 次」** = 剩余额度 ÷ 本周期均单价。基准是**用户自己实际的模型组合**，
  所以必须一并说明：换更贵的模型，次数会明显变少。不要把这个数字说成承诺。
- **`⚠` 告警行** = 按当前消耗速度，某窗口会在重置前耗尽。

用户问「够不够跑完 X」时：把「还能跑约 N 次」和任务规模对上再下判断。
没有 `⚠` 且窗口用量低，可以说「够」；窗口已高且没有告警，只能说「本窗口够，但下一个窗口要等重置」。

**不要编造次数**：本周期没有请求记录时脚本不给估算（没有均单价可依据），这时只报绝对额度。

## 凭证从哪来

按顺序找，找到即用：

1. 环境变量 `COMMAND_CODE_API_KEY` / `CMD_API_KEY` / `COMMANDCODE_API_KEY`
2. `~/.commandcode/auth.json`（Command Code CLI 登录后生成）
3. `~/.zcode/v2/provider_config.json` 里 `api.baseUrl` 含 `commandcode.ai` 的 provider
   ——即 ZCode 已配好的那把 key，所以装了 ZCode provider 就无需额外登录

密钥只用于 `Authorization: Bearer`，脚本不打印、不落盘。**不要把 key 贴进回答、日志或提交。**

## 底层接口（脚本失灵时手工查）

Base `https://api.commandcode.ai`，全部 `GET`，头 `Authorization: Bearer <key>`：

| 端点 | 内容 |
|---|---|
| `/alpha/whoami?limits=1` | 用户、`org`、组织级 `orgLimits` |
| `/alpha/billing/credits` | `credits`（余额）与 `windowLimits`（两个滚动窗口） |
| `/alpha/billing/subscriptions` | `planId`、`status`、计费周期起止 |
| `/alpha/usage/summary?orgId=&since=` | 本周期请求数、成本、token、成功率 |

`/provider/v1/*` 是模型推理接口（OpenAI/Anthropic 兼容），**不提供**额度查询——额度只在 `/alpha/*`。
`/provider/v1/models` 只给模型清单，不含额度系数或单价，所以无法算出「某模型还能跑几次」。
有 `orgId` 时带查询参数；`since` 用 `currentPeriodStart` 的 ISO 8601 值。

## 字段语义（最容易搞反的地方）

- `credits.credits.monthlyCredits` 是**剩余**额度，不是已用。已用 = 面额 − 剩余。
- 窗口的 `used` / `cap` 都是**美元价值**，不是请求条数。`cap` 一律取接口返回值。
- `resetAt` 是毫秒时间戳，窗口**从该窗口内首次请求起算**，不随自然日/周边界，用量不跨窗口结转。
- `limited: false` = 没有滚动窗口（按量计费或企业池），此时只有余额，不要去套百分比。
- `belowThreshold` / `creditThreshold` 是余额预警线，与窗口无关。
- `orgLimits` 是组织级消费上限，字段名没有公开 schema；认不出形状就跳过，别猜。

## 套餐面额参考（仅用于显示月度总额；窗口 cap 以接口为准）

| planId | 名称 | 月度 | 5 小时 | 每周 |
|---|---|---|---|---|
| `individual-go` | Go | $10 | $3 | $6 |
| `individual-goat` | GOAT | $70 | $14 | $35 |
| `individual-pro` | Pro | $30 | $16 | $40 |
| `individual-pro-v1` | Pro | $80 | $16 | $40 |
| `individual-max` | Max 10× | $150 | $45 | $90 |
| `individual-ultra` | Max 20× | $300 | $90 | $180 |
| `teams-pro` | Teams Pro | $40 | $12 | $24 |

表里没有的 `planId`（新套餐、企业套餐）不要硬套数字，直接用接口返回的窗口 `cap`，
并把总额度说明为「按已花 + 剩余推算」。

credits 记的是**用量价值**：全额度模型（如 GLM 系列）1 credit ≈ $1 用量，低额度模型按比例多扣。
所以「还能跑多少请求」必然取决于模型组合，不要给出与模型无关的单一数字。

## 回答时注意

- 报百分比要同时给**绝对值和重置时间**：「5 小时窗口 5.7%（$0.80 / $14），04:29 重置，还有 3h 51m」。
  只给百分比用户没法判断能不能撑到任务做完。
- 窗口重置时间随时在走，跨了一分钟以上的对话要重新取数，别复用旧读数。
- 触发 429 时先看哪个窗口 `exceeded`，再给三条出路：等重置、买额外额度、升级套餐。
- 脚本给出的速度外推有最小采样门槛（不足窗口的 5% 就不出结论）。**没有告警不代表安全**，
  只代表样本还不够判断——此时照实说，别替它下结论。
