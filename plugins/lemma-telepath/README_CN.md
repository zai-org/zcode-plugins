# Telepath —— 让 ZCode 读懂你的 Telegram

[English](./README.md)

Telepath 通过托管的 MCP 服务器，把**你本人的 Telegram 账号**接入 ZCode。它不是又一个
"用 Telegram 和 AI 聊天"的通道，而是让助手能够使用你已有的对话：检索归档、读取其中的
文档、图片与语音转写，并以你本人的身份回复。

它运行在 Telegram 官方的 business-bot API 之上——你把一个机器人添加到自己的账号——
而不是 MTProto 用户会话。这里没有任何东西会以你的身份登录。

## 它提供什么

一个名为 `telepath` 的 MCP 服务器，通过 HTTP 连接到
`https://telepath.lemma.company/mcp`。其工具包括：

- 对已归档的聊天、图片说明与语音转写进行全文检索；
- 读取某个会话的最近消息，或某条具体消息及其上下文；
- 按内容打开附件—— PDF、表格、文档、图片；
- 在你自己的会话中以你本人的身份发送、编辑消息和添加表情回应；
- 一个仅限你账号使用的小型 Markdown 笔记库。

一次会话中实际存在哪些工具，取决于你保留启用的权限；每一项都是你在 Telegram 机器人里
可以自行开关的开关。

## 安装与配置

1. 在 Telegram 中打开 **设置 → 我的账号 → 聊天自动化（Settings → My Account → Chat
   automation）**，添加 **@lemma_telepath_bot**，并选择它可以访问哪些会话。该入口对
   **所有账号开放——不需要 Telegram Premium**。
2. 安装本插件。ZCode 会注册该远程 MCP 服务器，并提示你进行授权。
3. 浏览器打开后用 Telegram 登录。这就是全部的身份验证过程：没有 API key，也不需要把
   任何凭据粘贴到对话里。

从这一刻起，你所选会话中的新消息会被归档，并可在 ZCode 中检索。除非你主动要求，否则
不会导入此前的历史记录。

图文教程：https://telepath.lemma.company/start

## 网络访问

插件本身不包含任何代码——只有清单文件与文档。所有请求都指向同一个域名：

| 地址 | 用途 |
|---|---|
| `https://telepath.lemma.company/mcp` | MCP 服务器本身（streamable HTTP） |
| `https://telepath.lemma.company/authorize`、`/token`、`/register` | OAuth 2.1，含 PKCE 与动态客户端注册 |
| `https://telepath.lemma.company/oauth/login` | 登录页面，其中加载来自 `oauth.telegram.org` 的 Telegram 登录控件 |

没有 `curl | bash`，不下载可执行文件，没有 `postinstall` 步骤，没有 hooks、没有
commands，也不写入本地文件。

## 权限与副作用

- **它会读取你的消息。** 仅限你在 Telegram 中选择的会话，且仅从你连接机器人的那一刻起。
- **在你保留该权限时，它能以你的身份发送和编辑消息。** 这是会作用于现实世界的副作用：
  一次工具调用会真正送达某个人。Telegram 仅允许在最近 24 小时内收到过对方消息的私聊中
  这样做。
- **语音转写是可选的付费功能。** 启用后，音频会发送至 Mistral（Voxtral，欧盟）转为文字；
  不会被用于训练，转写结果保存后也不保留音频副本。其余处理都在我们自己的服务器上完成。
- **群组归档、历史记录导入、使用你自己的机器人**均为可选项，默认关闭。

以上任何一项都可以在机器人中关闭或彻底清除：`/settings`、`/deletedata`。

## 需要如实说明的限制

Telepath 是**托管服务**，并且**不是端到端加密的**——为了替你检索和转写，我们的服务器
必须处理你的消息，因此技术上我们能够访问它们。我们选择把这一点讲清楚，而不是含糊其辞。

每个账号拥有物理隔离的独立数据库，磁盘整体静态加密（LUKS 全盘加密），凭据在此之上另行
加密或哈希存储。如果你需要"运营方绝无可能读取"的保证，该连接器同样可以自行部署——
单租户、同一套代码。

- 隐私政策：https://telepath.lemma.company/privacy
- 服务条款：https://telepath.lemma.company/terms
- 技术支持：https://telepath.lemma.company/support

## 许可与来源

本插件包采用 **MIT** 许可，见
[源仓库](https://github.com/Lemma-Company/telepath-plugin)。其中仅包含清单文件与文档，
不含服务端的任何代码。它所指向的托管服务由 Lemma 运营，适用上面链接的条款。Telepath
与 Telegram、Z.ai 均无从属关系。
