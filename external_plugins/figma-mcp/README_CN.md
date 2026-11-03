# figma-mcp

通过 Figma **官方 MCP 服务器**（`https://mcp.figma.com/mcp`）将 ZCode 接入
Figma：获取截图与结构化设计上下文、读取变量与设计令牌、处理 code connect
映射与 FigJam 画板，以及将代码转换为设计。

## 包含内容

- **MCP 服务器声明**：官方远程 Figma MCP 服务器。授权后提供约 45 个工具，
  包括：
  - `get_screenshot` — 将文件/画框/节点渲染为图片
  - `get_design_context` — 获取选区的结构化布局数据
  - `get_variable_defs`、`get_metadata`、`get_figjam`
  - code connect：`get_code_connect_map`、`send_code_connect_mappings`、
    `send_code_to_figma`
  - `use_figma` 及其他高层设计操作
- **配置技能**：指引首次 OAuth 授权与 401 排障。

## 首次配置（一次性）

Figma MCP 服务器只允许固定名单内的 OAuth 客户端名称，ZCode 不在其中，
开箱即用的连接会在客户端注册一步失败。请先运行辅助脚本完成授权：

```bash
git clone https://github.com/Jommmain/zcode-figma-mcp
cd zcode-figma-mcp && npm install
node figma-mcp-auth.mjs
```

脚本会打开浏览器：登录 Figma 并点击授权。随后脚本将令牌写入 ZCode 的加密
凭据库（`~/.zcode/v2/credentials.json`，同时生成 `.backup` 备份）。完成后
重启 ZCode（或重连 `figma` 服务器）。

访问令牌约 90 天过期；ZCode 收到 401 时重新运行该脚本。

## 依赖、网络访问与副作用

- 网络：安装后由 ZCode 连接 `https://mcp.figma.com`（MCP 与 OAuth）。辅助
  脚本在授权期间额外在本机 `localhost:3000` 运行回调服务器。
- 服务依赖：需要 Figma 账号，且对用户指定的文件有访问权限。
- 文件写入：插件本身不写文件。可选的辅助脚本仅写入
  `~/.zcode/v2/credentials.json`（并生成 `.backup` 备份）。
- 命令执行：配置技能在需要授权时指示运行来自
  https://github.com/Jommmain/zcode-figma-mcp 的辅助脚本。

## 第三方代码与服务

- **Figma MCP 服务器** — Figma 运营的远程服务，受 Figma 服务条款约束。
- **zcode-figma-mcp 辅助脚本**（可选）—
  https://github.com/Jommmain/zcode-figma-mcp ，为
  https://github.com/DarkGenius/zcode-figma-mcp 的 fork；OAuth 流程依赖
  `@modelcontextprotocol/sdk`（MIT）。

## 分类

`productivity`
