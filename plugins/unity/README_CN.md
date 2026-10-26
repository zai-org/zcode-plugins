# Unity

Unity 0.1.4 打包 Unity Technologies 官方 CLI Skill 与参考文件，补充 ZCode 安装、环境检测和版本兼容指引。不注册 MCP 服务或 UI 扩展。

## 使用

从插件市场安装 Unity，然后提出：“使用 Unity 检查已打开的项目，并创建一个测试立方体。”`unity-cli` 用于操作编辑器；`unity-setup` 负责安装、许可证、环境检查及版本差异。官方 Skill 入口会引导 Agent 在执行命令前读取兼容指引。

需要安装官方 Unity CLI、项目匹配版本的 Unity Editor 并激活许可证。实时编辑器操作需要项目安装 Unity Pipeline 包，且兼容的编辑器正在运行（Unity 6+）。只有可选的只读环境检查脚本需要 Node.js。不要仅为启用 Pipeline 而迁移现有项目。

## 兼容性和验证

用户反馈的 Windows 冒烟测试通过：CLI 1.0.0-beta.6、Editor 6000.3.26f1、Pipeline 0.9.0-exp.1，覆盖技能加载、诊断、连接、命令发现、C# 执行、场景物体、层级、播放模式、截图、资源和脚本编译。未测试 Player 构建及测试运行器。

0.1.2 补充多词命令引号、资源路径、不支持的参数、域重载后的有限重连，以及更新源返回旧版本时避免降级的指引。修订指引已完成静态验证，尚未重新进行 Windows 实测。保留可用 CLI 版本，执行写操作前检查实际命令参数定义。

## 依赖与副作用

本插件提供指引及只读 Node.js 检查脚本，不内置 Unity 程序，不自动安装软件，也无安装时执行的 Hooks。按用户要求执行 CLI 时，可能运行 C#、修改项目文件/资源/场景、安装包、启动编辑器或生成构建产物。下载、登录、许可证操作和版本查询会访问 Unity 服务或所选官方软件源；本地 Pipeline 操作连接运行中的编辑器。模型由 ZCode 会话提供，本插件不配置模型服务或凭据。账号登录、许可证选择及条款接受由用户交互完成。

## 许可证

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Unity Skill 固定上游提交 `9d282100540601cfddc4bbd69f36a239d7a6f55c`，使用随包附带的 Unity Companion License。入口增加了明确标识的 ZCode 兼容提示，脱敏代理 URL 示例改为文字描述以兼容公开镜像检查，其余上游内容保留。Z.ai 集成辅助内容采用 MIT 许可证。
