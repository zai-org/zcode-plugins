# nimbus-bci

[English](./README.md)

将 ZCode 连接到托管的 [Nimbus BCI](https://docs.nimbusbci.com) MCP 服务。Nimbus BCI 是一个基于 Apache-2.0 协议的开源工具包，用于在公开数据集上进行脑机接口（BCI）与 EEG 解码研究。

## 功能

- **MCP 服务 `nimbus-bci`**（远程，Streamable HTTP）：`https://nimbus-mcp.fly.dev/mcp`，提供 63 个工具和 5 个提示词（nimbus-mcp 0.14.20）：
  - 浏览并加载 MOABB / BNCI 公开数据集；
  - 构建并校验解码流水线；
  - 托管模型训练；
  - 数据与结果绘图；
  - BIDS 导出；
  - 公开的结果排行榜。
- **Skill `nimbus-bci`**：引导智能体完成"数据集 → 流水线 → 校验 → 训练 → 绘图"的流程，并在任何公开排行榜提交前要求用户确认。

## 认证

服务端通过 OAuth 处理登录。首次使用时，ZCode 会在浏览器中打开 Nimbus 授权页面。插件中不包含 API 密钥或其他机密信息，也无需任何配置。

## 网络访问与副作用

- 所有工具调用都通过 HTTPS 发送到由 Nimbus BCI 运营的 `nimbus-mcp.fly.dev`。数据集获取与训练在该托管服务上进行，而不是在你的电脑上。
- 插件不写入本地文件，不包含 hooks、命令或本地可执行文件。
- 排行榜提交内容公开可见。
- 范围：仅限离线公开数据集。插件不连接 EEG 硬件，也不对人进行实时会话。

## 链接

- 源码：<https://github.com/nimbusbci/nimbus-mcp>（Apache-2.0）
- PyPI：[`nimbus-mcp`](https://pypi.org/project/nimbus-mcp/) 0.14.20（本地 stdio 替代方案）
- 文档：<https://docs.nimbusbci.com>
- 联系方式：hello@nimbusbci.com

## 许可证

Apache License 2.0。通过该服务访问的公开数据集遵循其各自的许可证。
