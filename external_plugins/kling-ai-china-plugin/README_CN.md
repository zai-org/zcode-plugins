# 可灵 AI 中国区 Plugin

[English](./README.md)

将 ZCode 连接到可灵 AI 中国区官方 MCP 服务，用于图片与视频生成。

## 配置

1. 在 ZCode 中安装并启用此插件。
2. 新建会话，在**设置 → MCP 服务器**中为 `kling-ai-china` 点击**打开授权**，然后登录可灵中国区账号。
3. 让 Agent 使用可灵 AI 创建图片或视频。

服务使用 OAuth。生成会消耗所连接的可灵中国区账号积分。Global 与中国区账号、积分及任务记录相互独立。

## 网络访问与副作用

- 插件连接 `https://klingai.com/mcp/plugin`。
- 服务会按用户请求执行可灵图片或视频生成，生成任务会消耗账号积分。
- 插件只包含远程 MCP 配置，不运行本地命令、不安装依赖，也不写入文件。
- 插件配置不保存 API 密钥或密码；OAuth 授权由 ZCode 在浏览器中完成。

## 链接

- [可灵 MCP 接入指南](https://github.com/klingai-tech/claude-plugin-cn)
- [可灵 AI 中国区 Plugin 仓库](https://github.com/klingai-tech/claude-plugin-cn)
