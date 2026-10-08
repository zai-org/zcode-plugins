# Hyper3D Rodin

[English](./README.md)

在 ZCode 中使用文字或参考图片生成 Hyper3D Rodin Gen-2.5 三维模型，
使用 BANG 将已完成模型拆分为部件，跟踪进度，并获取结果页面或按需下载模型文件。

插件包含一个远程 HTTP MCP 声明和一个 Skill。需要 Hyper3D 账号；生成模型和
BANG 拆件会消耗 OAuth 授权时选择的个人或团队工作空间额度。

## 安装与连接

1. 正式发布后，在 ZCode 插件管理器中安装并启用 **Hyper3D Rodin**。
2. 通过 ZCode 的 MCP 认证入口在浏览器中登录 Hyper3D，核对请求授权的客户端，
   选择计费工作空间并授权。请选择当前项目实际使用的 MCP 作用域；某个作用域授权
   不代表其他作用域也已连接。不要把 API Key、密码、Cookie 或会话 Token
   放入聊天或本插件配置。
3. 确认当前会话能发现 Hyper3D 工具。仅能发现工具不代表 OAuth 或授权后的调用
   已经成功。如果客户端没有授权入口或登录失败，保留脱敏后的错误以便排查，
   不要通过在聊天中粘贴凭据来绕过问题。

MCP 地址为 `https://api.hyper3d.com/api/mcp`。ZCode 的服务命名空间为
`plugin:hyper3d-rodin:hyper3d-rodin`。Skill 会把下文的逻辑工具名对应到
当前会话实际提供的工具；本插件不定义斜杠命令。

服务声明的权限为 `rodin:generate`（上传及生成）和 `rodin:read`（状态及结果）。
OAuth 元数据声明支持 PKCE S256 授权码流程、动态客户端注册和刷新令牌；
实际登录与刷新行为取决于 ZCode 客户端实现。更换授权账号或计费工作空间需要重新连接。

## 使用

- 「用 Hyper3D 生成一个卡通宇航员，输出 GLB 模型。」
- 「根据这张参考图片生成一个三维模型。」
- 「查询我的 Rodin 任务，生成 ID 为……，完成后给我结果页面。」
- 「使用 BANG 拆分我已完成的 Rodin 模型，生成 ID 为……。」
- 「把已完成的模型下载到这个项目的 assets 目录。」

Skill 指导文字或图片生成、间隔查询进度和结果获取。参考图支持 1–5 张，每张不超过
20 MiB，格式以工具支持范围为准。ZCode 必须读取实际文件、申请上传地址并成功完成
HTTP PUT，再提交图片生成。如果无法上传，Agent 会说明限制并引导前往
[Hyper3D](https://hyper3d.ai)，不会悄悄忽略参考图片。

| 工具 | 用途 |
| --- | --- |
| `rodin_create_uploads` | 获取参考图片的临时上传地址 |
| `rodin_generate` | 提交 Rodin 生成任务，消耗额度 |
| `rodin_generate_bang` | 拆分当前授权用户拥有的已完成 Rodin 模型，消耗额度 |
| `rodin_get_status` | 查询任务状态和阶段 |
| `rodin_wait` | 服务端等待；ZCode 优先使用状态查询 |
| `rodin_get_result` | 获取结果页面和临时文件地址 |

服务还会声明 `rodin_import_images`，但它仅用于 ChatGPT Chat 附件，Skill 明确要求
ZCode 不调用它。当前没有账户余额或生成历史列表工具。可用参数及格式以实时工具
Schema 为准；目前模型格式包括 GLB、USDZ、FBX、OBJ 和 STL。

## 依赖、权限与副作用

- **服务与网络：** 对话模型由 ZCode 提供，Rodin/BANG 在线服务由 Hyper3D 提供。
  MCP 请求发送到 `api.hyper3d.com`；浏览器登录和结果页面使用 `hyper3d.ai`
  及 OAuth 元数据声明的端点。图片上传和按需文件下载还会访问 Hyper3D 返回的
  签名 URL 中的存储/CDN 域名。这些 URL 是临时地址，应避免打印或分享。
  MCP 响应及上传/下载工具卡片可能在 ZCode 历史中保留签名 URL；本插件无法保证
  宿主自动脱敏。分享日志或截图前应移除它们；宿主支持时使用其敏感信息脱敏功能。
- **数据：** 按需将提示词、选定的参考图片、生成参数和任务标识发送到 Hyper3D。
  插件不要求上传代码仓库。状态和结果仅能访问当前授权用户的生成任务；
  团队计费授权不代表可以访问其他成员的模型。
- **计费与恢复：** 生成及 BANG 会消耗 Hyper3D 额度并创建远程任务。Skill 会在
  首次收费提交前说明额度消耗，不会仅为测试连接而生成模型。这些调用不具备幂等性：
  超时或连接异常后应查询已知任务，或让用户在 Hyper3D Mine 检查后再决定是否重新提交。
  额度不足或缺少权益时会报告错误，不会擅自更换工作空间或修改用户要求的参数。
- **本地执行与文件：** 插件不包含本地 MCP 服务端、可执行程序、安装脚本、命令组件
  或 Hooks，也不需要额外的 Node.js/Python 运行时或模型 API Key。ZCode 管理安装及
  OAuth 状态。Agent 可能使用宿主的文件/网络工具或 shell 命令检查选定图片并上传。
  仅在用户要求下载模型时写入本地文件；shell 参数需安全引用，签名 URL 不应出现在
  共享输出中。导入 Blender、Unreal 或其他 DCC 不在本插件范围内。
- **结果：** 任务完成后展示永久 `display_url`。临时 `files[].url` 仅用于用户要求的
  文件下载，不作为面向用户的结果链接。

## 许可证

插件配置、Skill 和文档采用 [MIT License](./LICENSE)。远端 MCP 服务由 Deemos
运营；其服务端实现及生成资产不在该许可证范围内，仍受 Hyper3D 适用条款约束。
Hyper3D 图标用于标识服务，不授予商标权。
