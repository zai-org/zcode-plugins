# ChatGPT Bridge

[English](README.md)

通过四个标准斜杠命令，在 ZCode 内管理本机 ChatGPT 订阅桥接。配套 macOS 服务负责独立 OpenAI 授权，并提供本地 **OpenAI Responses** 供应商。此命令插件不含 MCP Apps 页面、Hook、MCP 服务器、原生供应商注册接口或应用包补丁。

## 安装与使用

1. 在 macOS 安装 Node.js 22+ 和 ZCode。本版已在 Apple Silicon / ZCode 3.15.3 实测；尚无 Intel Mac 实机结果。
2. 从 [weixshaw/zcode-chatgpt-bridge Releases](https://github.com/weixshaw/zcode-chatgpt-bridge/releases) 下载配套 ZIP。解压、检查源码与 `SHA256SUMS.txt` 后，运行 `安装.command`。桥接服务是独立前置依赖；仅安装此命令插件不会安装服务。
3. 在本地控制台点击 **Continue with ChatGPT**，在 OpenAI 官方页面完成授权，允许使用 ChatGPT 套餐。模型和额度取决于账号/工作区权限；目录可见不等于推理访问已验证。
4. 点击 **应用到 ZCode** 写入本地连接及账号模型目录，或将控制页的 Base URL、本地密钥手动填写到 **OpenAI Responses** 自定义供应商中。新建 ZCode 会话并选择桥接模型。
5. 从社区市场安装并启用本插件。官方尚未收录时，可将 `https://github.com/weixshaw/zcode-chatgpt-bridge` 添加为个人插件市场（仓库根目录含 `marketplace.json`）。

| 命令 | 行为 |
| --- | --- |
| `/chatgpt-connect` | 打开本机账号及供应商配置控制台 |
| `/chatgpt-status` | 查看服务状态、已保存账号标签和本次运行的推理计数 |
| `/chatgpt-models` | 刷新当前账号模型目录 |
| `/chatgpt-doctor` | 诊断服务、登录和模型目录，不发起推理 |

命令通过 `node` 调用当前用户 macOS Application Support 目录下的配套 CLI，要求 Agent 的 PATH 中有 Node.js，并遵循当前 Agent 的正常工具权限流程。打开控制台不会切换当前会话的模型。服务缺失时，先从上述仓库安装。

## 网络、权限与副作用

- 插件命令执行本地 Node.js 进程。`connect` 打开系统浏览器，`models` / `doctor` 可能通过配套服务访问 OpenAI。插件本身没有自动 Hook、后台动作或模型请求。
- 配套服务将程序和受保护数据写入 `~/Library/Application Support/ZCode ChatGPT Bridge/`，并在 `~/Library/LaunchAgents/` 创建当前用户的后台服务。它绑定 `127.0.0.1`（默认端口 19781），其运行独立于插件启停。
- 服务访问 `auth.openai.com` 完成注册、登录、签名密钥发现、刷新及撤销，访问 `api.openai.com` 获取模型目录并推理。源码/安装包来自 GitHub，从源码安装会从 npm 获取锁定依赖。配置的 HTTP 代理可承载相应网络请求。
- 仅点击 **应用到 ZCode** 时，才会在创建用户专属备份后向 `~/.zcode/v2/provider_config.json` 写入桥接供应商和模型规则，保留其他供应商与默认模型。也可手动配置。
- OAuth 凭据按账号保存在本机（数据目录 `0700`，文件 `0600`），不读取 Codex 凭据，不提交、不通过这些命令输出，也不写入 ZCode 供应商配置。本地连接密钥与 OAuth 凭据分离。`status` 可能显示账号邮箱/标签，请勿公开粘贴其输出。
- ZCode 为模型请求选取的提示词、文件和工具结果会发送给 OpenAI。桥接仅在有限内存中缓存续接历史，不记录提示词/回复日志。服务重启、账号切换或缓存淘汰后需新建会话或重发完整历史。
- 实际模型使用会消耗已授权的 ChatGPT 套餐额度；订阅通道无需 OpenAI API Key，不保证账号资格或额外额度。

本集成面向本机 macOS 工作区。SSH/容器 Agent 的 `127.0.0.1` 指向其执行环境，需要在远端独立部署并授权；不要复制本机凭据到远端。

## 停用与移除

停用/卸载此插件仅移除命令。先在控制台退出以撤销可续期会话，再运行配套 `卸载.command`，停止并移除后台服务和程序；数据会保留，供用户明确删除。ZCode 供应商需在设置中单独移除。远端撤销未确认时，可在 [ChatGPT 设置](https://chatgpt.com/settings/usage)断开应用。

## 验证与来源

配套服务有 19 项自动测试。其 0.1.0 实现已完成 GPT-6.1-Sol 的真实文本、本地函数调用和工具结果续接验证，并通过 ZCode 3.15.3 写入/读取文件、返回 `NATIVE_OK` 的实测；四个命令可被已安装 ZCode 发现。这不代表所有模型、工具或未来版本均通过验证，详见配套仓库 `VERIFICATION.md`。

插件及配套源码：[weixshaw/zcode-chatgpt-bridge](https://github.com/weixshaw/zcode-chatgpt-bridge)，MIT 许可。配套服务依赖 `jose` 和 `undici`（均为 MIT），版本和声明在该仓库中。本命令插件没有嵌入第三方代码。OpenAI 与 ZCode 为外部服务/产品依赖。本项目为独立社区项目，与 OpenAI、Z.ai 无隶属关系。
