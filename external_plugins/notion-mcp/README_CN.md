# notion-mcp

通过 Notion **官方 MCP 服务器**（`https://mcp.notion.com/mcp`）将 ZCode 接入
Notion 工作区：读取、创建和更新页面与数据库，处理评论与讨论，查看页面版本
历史，以及搜索/读取 Notion 聊天会话记录。

## 包含内容

- **MCP 服务器声明**：官方远程 Notion MCP 服务器。授权后提供约 70 个工具：
  - 页面与文档：`notion-search`、`notion-fetch`、`notion-create-pages`、
    `notion-update-page`、`notion-move-pages`、`notion-duplicate-page`
  - 数据库：`notion-create-database`、`notion-query-data-sources`
  - 评论与讨论：`notion-get-comments`、`notion-create-comment`、
    `notion-set-discussion-resolved`
  - 聊天会话记录：`notion-search-sessions`、`notion-query-sessions`、
    `notion-read-session-event`、`notion-send-message-to-session`
  - 页面版本历史：`notion-get-version-changes`、`notion-view-version`、
    `notion-restore-version`
  - 日历与会议记录、文件与附件
- **配置技能**：指引首次 OAuth 授权与 401 排障。

## 首次配置（一次性）

Notion MCP 服务器只允许固定名单内的 OAuth 客户端名称，ZCode 不在其中，
开箱即用的连接会在客户端注册一步失败。请先运行辅助脚本完成授权：

```bash
git clone https://github.com/Jommmain/zcode-notion-mcp
cd zcode-notion-mcp && npm install
node notion-mcp-auth.mjs
```

脚本会打开浏览器：登录 Notion、选择要共享的页面并点击允许。随后脚本将令牌
写入 ZCode 的加密凭据库（`~/.zcode/v2/credentials.json`，同时生成 `.backup`
备份）。完成后重启 ZCode（或重连 `notion` 服务器）。

访问令牌过期（ZCode 收到 401）时，重新运行该脚本即可。

## 依赖、网络访问与副作用

- 网络：安装后由 ZCode 连接 `https://mcp.notion.com`（MCP 与 OAuth）。辅助
  脚本在授权期间额外在本机 `localhost:3000` 运行回调服务器。
- 服务依赖：需要 Notion 账号；连接只能访问用户在授权时明确共享的页面。
- 文件写入：插件本身不写文件。可选的辅助脚本仅写入
  `~/.zcode/v2/credentials.json`（并生成 `.backup` 备份）。
- 命令执行：配置技能在需要授权时指示运行来自
  https://github.com/Jommmain/zcode-notion-mcp 的辅助脚本。

## 第三方代码与服务

- **Notion MCP 服务器** — Notion Labs 运营的远程服务，受 Notion 服务条款
  约束。
- **zcode-notion-mcp 辅助脚本**（可选，MIT 许可证）—
  https://github.com/Jommmain/zcode-notion-mcp ，OAuth 流程依赖
  `@modelcontextprotocol/sdk`（MIT）。

## 分类

`productivity`
