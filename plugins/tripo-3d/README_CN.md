# Tripo 3D

[English](./README.md)

## 0.1.5

插件支持 Tripo 国内站和海外站账号，分别通过国内 MCP 服务器 `tripo` 和海外 MCP
服务器 `tripo-global` 连接。授权与自己账号所属站点对应的服务器即可。

用户明确指定的兼容模型优先于按用途选择的默认值。先按必需功能筛选兼容模型，再按
场景选择。若用户指定的模型与必需功能冲突，变更模型或放弃要求前先询问。游戏和
实时资产显式优先使用 **P2**（积分高于 H/P1），使用 P 系列时默认 **P2**，**P1**
（积分更低、速度更快）仅在用户明确指定或选择时使用，影视、渲染和打印场景使用
v3.1。绑骨时显式指定模型，双足使用 v3.0，动物使用 v2.5。API 自身默认的 v1.0 只
支持双足，动画预设须根据上游 rig 模型选择。重拓扑 v3.0 的 `smart_uv` 与独立
`tripo_smart_uv` 是不同的计费流程。fast 贴图需要 v3.5，`chat_image_1` 已退役。

插件通过 Tripo MCP 工具执行，没有 CLI 路径，未授权也不会改走 CLI。PBR 默认关闭，
只有你明确要求时才开启。计划仅供参考，不是实时报价或预算锁。展示费用估算或明确
标出无法估算的费用，使用静态价格时注明来源、区域和日期，计费前取得明确确认。
禁止自动切换账号。Hook 同步提供 PBR 默认关闭与选模、计费指引。

这是 Tripo 官方 ZCode 插件。用文字或参考图生成带贴图的 3D 模型，支持骨骼绑定、
动画、重拓扑和格式转换（GLB/FBX/OBJ/STL/USDZ/3MF）。你可以要求将文件保存到项目中，
用于游戏、影视、AR 和 3D 打印。

在浏览器中授权一次 Tripo 账号即可使用，无需粘贴 API Key。插件分别支持**国内站**
（developers.tripo3d.com）和**海外站**（developers.tripo3d.ai）账号，授权所属站点
对应的 MCP 服务器即可。

## 包含的组件

| 组件 | 内容 |
| --- | --- |
| Skill `tripo-3d` | 主流程，包括工具检查、授权引导、MCP 工作流、场景到工具链的映射、输入处理和积分规则 |
| Skill `tripo-game-asset` | 游戏资产配方，包括面数预算道具、LOD 链、绑骨角色与动作，以及接入 Unity/Unreal/Godot/Three.js |
| MCP 服务器 `tripo` | 国内站远程 Streamable HTTP 服务器 `https://developers.tripo3d.com/mcp`（OAuth 2.1），提供 `tripo_plan`、生成、绑骨、转换和 `tripo_smart_uv` 等工具，以实际可见的工具 schema 为准 |
| MCP 服务器 `tripo-global` | 海外站远程服务器 `https://openapi-mcp.tripo3d.ai/mcp`（OAuth 2.1），提供相同工具 |
| Hook `SessionStart` | 注入 8 条规则，覆盖异步等待、短期链接、计费确认、浏览器授权、如实报错、PBR、模型选择和概念图确认，并根据系统时区提供区域提示 |

## 使用方法

安装并启用插件后，直接描述需求即可，例如：

- 生成一个低多边形的宝箱 3D 模型，导出 FBX 给 Unity 用
- 把这张概念图变成带贴图的 3D 模型，导出 GLB
- 生成一个可 3D 打印的骑士小雕像，导出 STL 文件
- 生成一个 T-pose 的机器人角色，绑好骨骼并加上走路动画
- 查一下我的 Tripo 余额

也可以在输入框输入 `/`，从「技能」分组手动选用 `tripo-3d` 或 `tripo-game-asset`。

纯文字建模请求会先规划概念图并请你确认生图费用，生成并展示图片后等待你接受。
接受图片后，Skill 再规划 3D 生成及你要求的后处理，并单独请你确认费用。你可以明确
要求跳过概念图、直接文生 3D。你已提供的图片或多视图可直接用于 3D 生成。

### 首次授权

为账号所属站点的 Tripo MCP 服务器完成一次授权：

1. 打开 **设置 → MCP 服务器**。在「Plugin MCP 服务器」分组中有两个 Tripo 条目，
   初次使用时会显示「需要授权」。`tripo` 对应国内站账号，`tripo-global` 对应海外
   站账号。在账号所属站点的条目上点击 **打开授权**，另一个条目可以保持原样。
2. 系统浏览器会打开对应站点的授权页。`tripo` 使用**国内站**（developers.tripo3d.com，
   +86 短信登录、支付宝充值），`tripo-global` 使用**海外站**（developers.tripo3d.ai，
   邮箱登录、Stripe 充值）。授权页没有选区步骤。没有账号时可以注册，新账号有免费额度。
3. 页面显示一次性验证码并打开 Tripo 控制台。登录后把验证码填入 **Verification code**，
   点击 **Authorize**。
4. ZCode 自动重连并加载工具。需要撤销授权时，在 Tripo 控制台的 API Keys 页面删除
   授权时选定的 Key。

如果已连接两个区域的账号，请在规划或上传前选择此次任务使用的账号。任务 ID、
文件令牌和余额均归属所选服务器。

## 依赖、网络访问与副作用

- **网络**：ZCode 连接国内站 `https://developers.tripo3d.com/mcp` 和海外站
  `https://openapi-mcp.tripo3d.ai/mcp`，工具调用发往已授权的服务器，授权页跳转到
  对应站点的 Tripo 控制台。生成结果通过 Tripo CDN 的短期链接获取，需要时用
  `tripo_task_status` 刷新。
- **账号与计费**：生成任务消耗你自己 Tripo 账号的积分，通过任务状态与用量账单核对
  实际消耗，失败任务自动退款。Skill 用 `tripo_plan` 规划计费步骤并在执行前取得明确
  确认。批量生成时会查余额，并在各阶段执行前分别确认该阶段的费用。
- **文件写入**：在你要求保存或集成模型时，Agent 用 `curl` 把结果下载到项目目录。
  Hook 与 MCP 服务器本身不写任何文件。
- **命令执行**：仅在上传本地图片或模型，以及下载结果时运行 shell 命令。上传使用
  `tripo_upload_ticket` 返回的命令，较大文件可在连接的服务器支持时使用
  `tripo_upload_presign` 返回的命令。插件不会安装或调用命令行客户端，MCP 失败、
  未授权、批量或本地落盘需求也不例外。
- **Hook**：`hooks/session-start.mjs` 依赖 PATH 中的 `node`，从 stdin 读取事件，向
  stdout 输出规则和基于系统时区的区域提示，不访问网络、不读写文件。
- **遥测**：插件本体没有独立的分析 SDK。已授权的 Tripo MCP 服务（国内或海外，记录
  相同字段）启用分析时，可以记录工具调用结果、任务元数据及能够解析出的 Tripo 账号
  ID。两个 MCP 服务器均声明非凭据请求头 `X-Tripo-Distribution: zcode_plugin`。宿主
  透传时，服务端会分别记录分发渠道和识别出的客户端（如 ZCode、Claude 或 unknown）。
  埋点不包含提示词、API Key、OAuth token、文件路径或签名下载链接。账号凭据由 ZCode
  的凭据存储管理，不经过对话。

## 来源与许可

- 插件本体采用 MIT 许可，作者为 [VAST](https://www.tripo3d.ai)。
- 两个 Skill 由 Tripo 官方的 Kimi / Codex 插件移植而来，同由 VAST 维护并采用 MIT 许可。
- 两个 MCP 服务器均运行 Tripo 官方实现，生成内容遵循 [Tripo API 内容策略](https://platform.tripo3d.ai/docs)。
