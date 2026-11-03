# Magnific

使用 Magnific，将创意、产品照片、脚本和参考图片转化为视觉营销素材。此普通插件包含 12 项技能、一个 `/magnific` 命令以及官方远程 Magnific MCP 连接，不声明 MCP Apps 交互界面。

## 安装与连接

本地评审请遵循仓库的[开发指南](../../docs/PLUGIN_DEVELOPMENT.md)：构建仓库，将 `dist/local-marketplace` 添加为本地插件市场，然后安装 `magnific@zcode-plugins-local`。市场发布后，可从 ZCode 插件目录安装 Magnific。

启用 Magnific MCP 连接，并按客户端提示在浏览器中登录。付费操作需要 Magnific 账户及足够的积分。服务端点为 `https://mcp.magnific.com/mcp`（Streamable HTTP，OAuth 2.1）。认证由宿主客户端与 Magnific 处理，包内不包含 API 密钥或令牌。仍需验证 ZCode 运行时兼容性；本包不声称已完成 ZCode 安装或生成测试。

可以先尝试 `/magnific 查询我的积分余额`，或 `/magnific 为产品策划一段 15 秒广告；生成前先估算费用。` 只读账户检查不能代替付费生成测试。消耗积分前，请遵循技能中的费用模拟及确认要求。

## 包含的工作流程

- `magnific-essentials`：工具发现、模型、费用估算、上传和任务处理。
- `ad-campaign`、`video-ad`：营销素材与视频广告。
- `product-imagery`、`precise-image-edits`：产品摄影和精确图片编辑。
- `cinematic-shots`、`scene-direction`、`fight-scenes`：镜头、场景调度与动作。
- `consistent-characters`、`previs-storyboard`：角色一致性与分镜预演。
- `sound-and-voice`、`video-finishing`：音频、配音、超分辨率和成片交付。

## 依赖与副作用

需要联网访问 Magnific 的 MCP 及认证服务。工作流程可能使用服务返回的上传或下载地址；用户选择的图片、视频、音频及提示词可能会发送至 Magnific 进行处理。生成、编辑、音频及后期操作可能消耗当前登录用户的积分。套餐和积分需要另行购买。

技能可能要求代理运行 `curl` 等 shell 命令进行上传或下载，并将用户要求的输出写入文件。可选的本地辅助脚本 `skills/product-imagery/scripts/packshot.py` 需要 Python 3 和 Pillow，仅对指定的本地图片路径进行读写，不发送网络请求。依赖不会自动安装。包内没有 hooks、后台守护进程、捆绑的可执行程序或本地 MCP 服务器。

## 来源、许可证与支持

技能、命令、图片辅助脚本、图标、MCP 配置及 MIT 许可证均原样复制自 [freepik-company/magnific-plugin](https://github.com/freepik-company/magnific-plugin) **1.3.0** 版本，提交 `857f25194f57390941c79bb73c9176a8137d1894`。ZCode 清单、市场元数据及中英文文档为新增的打包内容。这是首个 ZCode 包版本，版本号为 1.3.0。

插件采用 MIT 许可证，托管服务另受 Magnific 服务条款约束。参阅 [MCP 文档](https://docs.magnific.com/modelcontextprotocol)、[隐私政策](https://www.magnific.com/legal/privacy)、[服务条款](https://www.magnific.com/legal/terms-of-use)及[支持](https://www.magnific.com/ai/support)。
