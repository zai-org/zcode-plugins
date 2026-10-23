# Argo 阿尔戈 for ZCode

统一搜索、网页抓取与证据核验插件：272 个源、235 个免密钥可用，覆盖深度研究、学术、舆情、公众号、招聘聚合与本地检索。不止搜到，还要核到——高后果问题强制核验正文并回填证据分。

能力由 [argo CLI](https://github.com/taxueseek/argo) 提供，本插件是它在 ZCode 中的三层接入：

| 层 | 形态 | 说明 |
|---|---|---|
| 模型通道 | skills + commands + agents | `/argo` 日常一问、`/wide-research` 多轨编排取证；`argo-researcher` worker 用工具白名单机制化约束 |
| 控制通道 | ui.surfaces 面板 | 「Argo 面板」侧栏页：272 引擎开关、密钥写入（脱敏）、额度摘要；配置经页面直连服务，不占模型 token |
| 取证通道 | skill+CLI（主）/ MCP（可选） | 模型按 skill 纪律调 `argo search/fetch/research` 等 CLI 命令；面板 MCP 服务 `tools/list` 恒为空，零常驻 token |

## 前置依赖

- [argo CLI](https://github.com/taxueseek/argo)（插件能力全部经由它；未装时 skill 会给出安装指引）
- ZCode Desktop（面板需要支持 Plugin UI 的版本；Node.js 由宿主提供）
- 面板配置桥依赖 pyyaml（argo 唯一必需第三方依赖，装 argo 时已安装）

## 安装后验收

1. **模型通道**：新会话发送 `/wide-research 多轨研究一个争议问题`，观察是否按轨道拆分、派发 `argo-researcher` worker、产出带来源账本与质量门的报告（`passed=false` 时应降级表述）
2. **控制通道**：打开侧栏「Argo 面板」，切换任一引擎开关，下一次 `argo search` 应体现变更；密钥区保存一个测试 key 后 `argo search --list-engines --detail --engine <名>` 应显示已配置
3. **零 token 校验**：会话内模型工具列表不应出现 `mcp__argo-panel__*` 工具（面板工具仅页面可调）

## 隐私与安全

- 密钥写入 argo env 文件（chmod 600），面板只回显 key 名不回显值
- 引擎开关写入 argo 本机覆盖层 `config.local.yaml`（gitignore，不随 argo 发版）
- 使用日志留在本机（`ARGO_USAGE_LOG=0` 可整体关闭）
