# Cloudflare CLEF 决策评测（ZCode 插件）

移植自 OpenClaw decision-provider 插件 `openclaw-cloudflare-clef`（0.1.3）：用 Cloudflare Workers AI 的 CLEF 系列模型做结构化决策评测（boolean / choice / score），返回带校准概率的答案，而不是让聊天模型自由发挥。

- 协议层（`server/protocol.mjs`）与原插件**逐字节一致**，15 个协议单测全部通过。
- OpenClaw 宿主集成层改写为 ZCode 的 **MCP stdio server**（零 npm 依赖），以工具 `clef_evaluate` 暴露。
- 凭据用 **Windows DPAPI 加密落盘**，静态存储无明文——弥补 ZCode 没有 OpenClaw secret store 的空缺。

## 安装前置（Cloudflare 侧）

1. **Account ID**：Cloudflare 仪表盘 → Workers & Pages 概览页右侧，32 位十六进制。
2. **API Token**：仪表盘右上角头像 → My Profile → API Tokens → Create Token，权限选 **Workers AI → Run**（作用域限定到你的账户）。

## 凭据配置（DPAPI 加密存储，推荐）

在 PowerShell 里运行插件目录下的 `server\store-secret.ps1`（交互式输入，Token 不回显）：

```powershell
powershell -ExecutionPolicy Bypass -File "<插件安装目录>\server\store-secret.ps1"
```

凭据以 DPAPI 密文存于 `%USERPROFILE%\.zcode\secrets\cloudflare-clef.json`，**绑定当前 Windows 用户**——文件被拷到别的机器或别的账户无法解密，磁盘上任何时刻都没有明文。轮换凭据就重跑一次脚本；删除该文件即吊销。

之后**完全退出并重启 ZCode**。插件启动链路：`launch.mjs` 启动时经 PowerShell 解密两条凭据注入本进程环境变量（MCP 通信完全不经过 PowerShell），再加载 server。

替代方案：也可以设用户级环境变量 `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN`（明文落注册表，不推荐）；两者同时存在时优先用加密文件。

需要 Node.js ≥ 22 在 PATH 中（本机已确认 v26.12.1 可用）。

**安全边界（如实说明）**：DPAPI 防的是文件泄露、备份、网盘同步；当前 Windows 用户下的进程仍可解密（Windows 本地无更强的免交互方案）。凭据与提交的证据永不写日志，日志另有按 `token/secret/api-key` 键名的自动脱敏。

## 费用

- 建议 Workers Free：10,000 Neurons/UTC 日免费，用尽后平台硬限制；免费量与账户内其他 Workers AI 用量共享。
- Workers Paid 同样有免费量，但超额收费；本插件不改变账户套餐，不保证 Paid 账户零支出。
- 2026-10-20 官方价：CLEF Flash 3,455 Neurons / M input tokens；CLEF 21,818 Neurons / M input tokens。仅按输入计价。

## 用法

安装后在会话中让模型调用 `clef_evaluate`，例如：

```json
{
  "model": "clef-flash",
  "state": "货物尚未电放，ETA 明天，需要联系起运港。",
  "questions": {
    "是否紧急/urgent": { "type": "boolean", "instructions": "Is this urgent?" },
    "route": { "type": "choice", "criteria": { "关务/customs": "Customs clearance", "海运/ocean": "Ocean freight" } },
    "severity": { "type": "score", "criteria": ["None", "Moderate", "Critical"] }
  }
}
```

返回 `{model, answers, usage}`；答案以原始问题 id 为键，choice/score 附带完整概率分布，boolean 返回 `probabilityTrue`。`model` 省略时用 `clef-flash`。

state 中的图片有三种挂载方式：内嵌 data URL、`{content_type,base64}` 对象，或**绝对路径本地文件**（`.png/.jpg/.jpeg/.webp`，字符串须精确等于文件路径）。路径方式由 server 读盘嵌入并以 `[image #N]` 占位——聊天模型无法可靠生成大段 base64，实际截图请优先用路径；路径不存在或超过 4 MiB 会返回明确的 unsupported-input 错误。

## 翻译与边界（与原插件一致）

- boolean → noul → probabilityTrue；choice 保留全部概率；score 的索引对象转数组。
- 重新映射问题与选项 ID，允许中文、斜杠等标识，恢复结果原 ID。
- 请求 URL 固定为 `api.cloudflare.com`（构造上排除 SSRF），禁止重定向；55 秒超时；支持 MCP 请求取消。
- 无重试、无后台轮询、无收费模型自动回退；429 返回限流错误（含 retry-after 提示）。
- 支持文本/JSON 证据，最多 4 张图片（PNG/JPEG/WebP，单张 4 MiB、合计 8 MiB、16 MP 上限）；state 中以绝对路径引用的本地图片文件会在评测时被读取（仅 png/jpg/jpeg/webp，文件须存在且 ≤ 4 MiB）。
- 保守输入预算：UTF-8 字节 + 1,024 + 每候选 128 ≤ 24,000（接入侧近似保护，非厂商 tokenizer 精确计算）。
- 响应体读取上限 1 MiB。

## 验证

`node --test server/protocol.test.mjs` 验证协议转换与拒绝异常响应（15/15 通过）。已另做 MCP 握手、tools/list、无凭据指引、DPAPI 存取全链路（含真实请求与 401 映射）冒烟测试。**未做真实凭据端到端验证**——安装并存储凭据后，首次调用即是端到端验证。

## 来源

- https://developers.cloudflare.com/workers-ai/models/clef-flash/
- https://developers.cloudflare.com/workers-ai/models/clef/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
