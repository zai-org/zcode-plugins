# Viralkey 插件

[Viralkey](https://viralkey.ai)（`SPARKLING LAKE TECHNOLOGIES LLC`）官方 AI Agent 插件。通过 Remote MCP（`https://mcp.viralkey.ai/mcp`）连接你的 Viralkey 账号，让 AI 编程与创作助手直接查询图片/视频模型目录、估价、调用 AI 生成图片与视频，并获取成品素材链接。

一套配置兼容 **Cursor**、**Google Antigravity**、**GitHub Copilot**、**ZCode**、**Claude Code** 与 **OpenAI Codex**。

## 功能与包含组件

- **Remote MCP 服务**（`https://mcp.viralkey.ai/mcp`，Streamable HTTP + OAuth 2.0 PKCE `S256` + CIMD）
  - `list_models` — 查看当前可用的 Viralkey 图片与视频模型目录（只读）
  - `get_model_schema` — 查询指定模型的准确参数、模式、画幅与参考图限制（只读）
  - `get_account` — 查看当前 Viralkey 钱包的可用、冻结与总积分余额（只读）
  - `estimate_generation` — 校验完整参数并返回当前积分估价与 `revision`，不建单、不扣费（只读）
  - `generate_image` — 使用现有 Viralkey 积分提交图片生成任务（基于 `request_id` 幂等）
  - `generate_video` — 使用现有 Viralkey 积分提交视频生成任务（基于 `request_id` 幂等）
  - `get_generation` — 按 `run_id` 查询生成进度与交付状态（只读）
  - `list_generations` — 分页查看近期生成记录（只读）
  - `get_asset` — 根据账户自有 `asset_id` 获取素材元数据与签名下载链接（只读）
- **Agent Skill**（`skills/viralkey-media/SKILL.md`）— 约束 Agent 先查动态模型 schema、生成前汇报积分估价、超时断线时沿用原 `request_id` / `run_id` 恢复任务不重复扣费，且不向媒体下载链接透传 OAuth Bearer Token。

## 安装方式

### Google Antigravity
```bash
agy plugin install https://github.com/Twin-sk/viralkey-plugin
```

### Cursor
在 Cursor Marketplace 搜索 **Viralkey** 安装，或在 Cursor Settings → Plugins 中添加本仓库地址。

### GitHub Copilot
将 `Twin-sk/viralkey-plugin` 添加为插件市场仓库（自动读取 `.github/plugin/marketplace.json`）。

### ZCode
在 ZCode 官方 Public 插件市场搜索 **viralkey** 安装，或在 **设置 → 插件 → Personal** 中添加 `https://github.com/Twin-sk/viralkey-plugin`。

### Claude Code / OpenAI Codex
```bash
# Claude Code
claude plugin marketplace add Twin-sk/viralkey-plugin
claude plugin install viralkey@viralkey-plugins

# OpenAI Codex
codex plugin marketplace add Twin-sk/viralkey-plugin
```

## 鉴权与计费说明

1. 首次使用时，MCP 客户端自动发现 `https://mcp.viralkey.ai/.well-known/oauth-protected-resource/mcp`，并在浏览器中引导你登录 `https://viralkey.ai` 完成单一权限包（`viralkey:mcp`）授权。
2. **本仓库不包含任何 API Key、私钥或敏感配置。**
3. **计费与副作用**：
   - 本插件本身免费开源（MIT 协议）。
   - `list_models`、`get_model_schema`、`get_account`、`estimate_generation`、`get_generation`、`list_generations`、`get_asset` 均为只读操作，不消耗积分。
   - `generate_image` 与 `generate_video` 会按预估结果消耗你已授权 Viralkey 账号中的现有积分。订阅管理与积分充值仅在 [viralkey.ai](https://viralkey.ai) 官网完成，MCP 工具不会自动购买积分、修改订阅或执行站点管理操作。
   - 远端 MCP 无法直接读取本机文件路径；如需传参考图，请先在 [viralkey.ai](https://viralkey.ai) 上传后传入账户自有 `asset_id`。

## 网络访问与外部依赖

- `https://mcp.viralkey.ai/mcp` — Remote Streamable HTTP MCP 接口与 OAuth 2.0 授权服务（`/.well-known/oauth-authorization-server`、`/oauth/authorize`、`/oauth/token`、`/oauth/revoke`）。
- `https://viralkey.ai/mcp/authorize/{request_id}` — 浏览器授权确认页（复用已有官网登录态）。
- `https://assets.viralkey.ai` / `https://cdn.viralkey.ai` — `get_asset` 返回的签名媒体交付域名。
- 本插件不安装任何本地二进制程序、Shell Hook 或后台常驻进程。

## 常见使用示例

- “列出 Viralkey 可用的图片和视频模型，推荐一个适合产品宣传片的模型。”
- “先帮我估价，再用 Viralkey 生成一张 16:9 的产品展示图。”
- “查看我最近的 Viralkey 生成记录并拿到成品素材链接。”

## 隐私、条款与支持

- **官网**：https://viralkey.ai
- **隐私政策**：https://viralkey.ai/privacy
- **服务条款**：https://viralkey.ai/terms
- **技术支持**：support@viralkey.ai
- **运营主体**：Sparkling Lake Technologies LLC
- **开源协议**：[MIT](./LICENSE)
