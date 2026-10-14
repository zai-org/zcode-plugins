# etsy-manager（中文）

用于管理 Etsy 店铺的 [ZCode](https://zcode.z.ai) 插件：商品（listing）、图片、
库存、物流方案、订单与评价 —— 基于 Etsy Open API v3 的 41 个工具，内置
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp)（MIT）的服务端。

插件完全**独立运行**：MCP 服务端经 esbuild 打包为单个无依赖文件
（`vendor/etsy-mcp/server-bundle.mjs`，约 1.3 MB），在 Windows / Linux / macOS 上
无需 `npm install` 即可使用。插件本身不保存任何凭据 —— 密钥从环境变量或
`~/.etsy-mcp/config.json` 读取。

[English README](./README.md) · [Türkçe README](./README_TR.md)

## 环境要求

- ZCode（桌面版或 CLI）
- **Node.js ≥ 20**（`node` 命令可用）。VPS 上可用 `nvm install 22` 安装。

## 首次配置

1. 在 https://www.etsy.com/developers/apps 获取应用的 **keystring**（`apiKey`）与
   **shared secret**（`sharedSecret`）。新建应用时回调 URL 填
   `http://localhost:3737/callback`。
2. 创建 `~/.etsy-mcp/config.json`：
   ```json
   { "apiKey": "你的keystring", "sharedSecret": "你的shared-secret" }
   ```
   （环境变量 `ETSY_API_KEY` / `ETSY_SHARED_SECRET` 优先。）
3. 在对话中说 **"连接 Etsy"** —— `authenticate` 工具会返回 OAuth 授权链接，
   授权一次后令牌保存到 `~/.etsy-mcp/tokens.json` 并自动刷新。

### 无界面服务器 / VPS

`authenticate` 工具直接在对话中返回授权链接且不阻塞。若服务器没有浏览器，在本地
电脑通过 SSH 转发回调端口后在本机浏览器打开链接：

```bash
ssh -L 3737:localhost:3737 user@your-vps
```

设置 `ETSY_NO_BROWSER=1` 可完全跳过启动浏览器的尝试。也可以直接从已授权的机器
复制 `~/.etsy-mcp/tokens.json` 跳过 OAuth（令牌与机器无关且自动刷新；请把该文件
当作机密妥善保管）。

## 对内置服务端的修改

- OAuth 回调端口固定（默认 3737，可用 `ETSY_CALLBACK_PORT` 覆盖），便于在 Etsy
  应用后台登记回调地址。
- 凭据从 `~/.etsy-mcp/config.json` 读取（环境变量优先）。
- 无界面/VPS 支持：授权链接在尝试打开浏览器**之前**即打印并作为 `authenticate`
  工具结果返回；工具不阻塞；打开浏览器失败不影响流程；`ETSY_NO_BROWSER=1` 可跳过。
- OAuth 回调服务器仅绑定回环地址（`127.0.0.1`）—— VPS 上安全，且可通过 SSH 隧道
  访问；端口被占用时立即报错而不是挂起。

## 副作用说明

- 运行本地 MCP 服务器（`node scripts/mcp-server.mjs`），向 `api.etsy.com` /
  `www.etsy.com` 发起 HTTPS 请求。
- OAuth 期间在 `127.0.0.1:3737`（`ETSY_CALLBACK_PORT`）上临时开启最多 2 分钟的
  HTTP 服务器，并尝试在浏览器打开授权链接（可用 `ETSY_NO_BROWSER=1` 跳过）。
- 仅读写 `~/.etsy-mcp/` 目录（你创建的 `config.json`、插件管理的 `tokens.json`），
  不读写其他任何文件。

## 目录结构

```
.zcode-plugin/plugin.json          插件清单
.mcp.json                          MCP 服务器定义（node scripts/mcp-server.mjs）
scripts/mcp-server.mjs             读取凭据的启动器
skills/etsy-manager/SKILL.md       模型使用指南
vendor/etsy-mcp/server-bundle.mjs  无依赖 MCP 服务端（esbuild 打包）
vendor/etsy-mcp/src/               打过补丁的上游 TypeScript 源码
```

## 许可证

MIT — Copyright (c) 2026 [Hugo](https://gozutok.info)。内置的
[aserper/etsy-mcp](https://github.com/aserper/etsy-mcp) 采用 MIT 许可证
（[其许可证](./vendor/etsy-mcp/LICENSE)）。
