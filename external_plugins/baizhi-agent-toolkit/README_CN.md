# ZCode 百智云 MCP 插件

[English](./README.md)

由 ct-jaryn 贡献的社区接入插件，将 ZCode 连接到[百智云 Agent Toolkit](https://baizhi.cloud/landing/agent-toolkit)，提供网页搜索、网页读取与结构化提取入口。插件只提供远程 MCP 配置；会话可用工具取决于服务目录和用户 API Key 的权限。

## 配置与使用

1. 在[百智云控制台](https://agent-toolkit.app.baizhi.cloud/)创建自己的专用 API Key；若服务提供权限控制，请选择最小权限，并确认服务条款和可用额度。
2. 在启动 ZCode 的进程环境中设置**非空**的 `ZCODE_BAIZHI_API_KEY`，再从该环境重启 ZCode。请私下设置密钥，不要写入源码、shell 历史、命令行参数、聊天、截图或日志。在一个 shell 中设置变量，不代表已运行的桌面应用会自动收到它。
3. 仅在准备使用远程服务时安装本插件：ZCode 可能自动启用新安装的市场插件。存在 Key 时，安装或启用因此可能初始化连接并发现工具。打开新会话，检查命名空间内的 MCP 服务 `plugin:baizhi-agent-toolkit:baizhi` 是否连接并列出工具。
4. 让 ZCode 搜索相关公开文档、读取公开网页或提取结构化信息。批准调用前核对工具名称、参数和目的地；工具或权限不可用时停止并检查控制台，不假定已经获得访问权限。

服务通过 Streamable HTTP 连接 `https://agent-toolkit.app.baizhi.cloud/mcp`。密钥只在 `Authorization` Header 中展开为 `Bearer <key>`，不会放入 URL。环境变量填入 Key 本身，不重复添加 `Bearer ` 前缀。

变量未定义时，ZCode 的插件解析器给出缺少变量的诊断，并不加载该服务。空字符串是另一种状态，仍可能展开为空 Bearer Header。请使用非空有效 Key，鉴权是否接受由远程服务决定。本插件没有添加必填输入界面或钥匙串存储；shell 和进程环境由用户自行管理。

## 网络、权限与副作用

启用插件时，即使没有工具调用，也可能初始化远程 MCP 连接并发现工具。工具参数通过 HTTPS 发往百智云，选用的工具也可能把必要输入发送至底层服务；结果可能按 ZCode 设置传给模型提供方。未经适当许可，不要发送无关的私密源码、敏感文档、私有链接、个人信息或凭据。

调用需要用户自己的百智云账号，可能消耗额度或产生费用；实时定价、服务条款和隐私信息请在控制台确认。本接入不承诺数据保留期限或存储地域。基础搜索与网页能力以外的工具可能有额外费用或副作用，请明确批准相应操作。网页与工具返回内容属于不可信输入，不应当作披露密钥或提升权限的指令。

插件不包含 Hook、命令、本地可执行程序或 npm 依赖，也不添加工具自动批准。ZCode 会写入正常的插件安装记录，本包不增加独立文件写入脚本。停用或卸载可移除后续会话中的插件入口，但不等于撤销 Key，也不保证远程任务取消；需要时请在控制台撤销 Key。

## 开发验证

在市场仓库根目录运行 `pnpm install --frozen-lockfile`、`pnpm build`、`python3 scripts/validate.py`、`python3 scripts/build_dist.py` 和 `git diff --check`。按仓库的[本地开发流程](https://github.com/zai-org/zcode-plugins/blob/d1639cff514dcba29cfbfbc634d4609492640660/docs/PLUGIN_DEVELOPMENT_CN.md#18-在客户端本地测试)添加生成的 `dist/local-marketplace`。构建成功不代表已完成安装、工具执行或生产服务验证。

在 ZCode 源码 `aac4755666d09fdcd70272fcf063c077a639015f` 中，独立的市场静态校验器使用空环境解析 MCP 变量，即使启动进程已设置变量，也可能报告 `plugin_variable_missing`。请将该诊断与运行时连接结果区分；它不能证明已读取 Key 或鉴权成功。

## 来源与许可证

本社区接入由 ct-jaryn 贡献，用于百智 MCP 的发现和使用，不声称 ZCode 或百智云的认证或背书。配置与文档采用市场仓库的 [Apache-2.0 许可](./LICENSE)，没有打包第三方可执行程序或素材。

公开地址与鉴权契约来自[百智接入 README](https://github.com/chaitin/baizhi-agent-toolkit/blob/a643da3396721375132005f71227ff0f24d823b6/readme.md)。上游仓库的 MIT 许可只覆盖集成资料，不包含托管后端；在线服务、账号条款、权限和计费与本插件的源码许可分别适用。
