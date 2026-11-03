# Tripo 3D

[English](./README.md)

## 0.1.5

用户明确指定的兼容模型优先于按用途选择的默认值；游戏/实时资产显式优先选择 **P2**（积分高于 H/P1），使用 P 系列时默认 **P2**；**P1**（积分更低、速度更快）仅在用户明确指定或选择时使用，
影视/渲染/打印用 v3.1。绑骨按体型显式指定：双足 v3.0，动物 v2.5；动画预设须跟随上游 rig 模型。
重拓扑 v3.0 的 `smart_uv` 与独立 `tripo_smart_uv` 是不同计费流程。
fast 贴图需 v3.5；`chat_image_1` 已退役。

插件只通过 Tripo MCP 工具执行，没有 CLI 路径；未授权也不会改走 CLI。PBR 默认关闭，
只有你明确要求时才开启。计划仅供参考，不是实时报价或预算锁；静态价格估算须说明
来源、区域和日期，未估算的步骤须明确标出，计费前取得确认。禁止自动切换账号。
Hook 同步执行 PBR 默认关闭与选模/计费约束。

Tripo 官方 ZCode 插件。用一句话或一张图生成带贴图的 3D 模型，支持骨骼绑定、动画、
减面和格式转换（GLB/FBX/OBJ/STL/USDZ/3MF），文件直接落到你的项目里。覆盖游戏、
影视、AR 和 3D 打印场景。

浏览器里授权一次**国内站** Tripo 账号即可使用（developers.tripo3d.com），无需复制
API Key。本构建的 MCP 只对接国内站；海外站账号请安装海外版插件。

## 包含的组件

| 组件 | 内容 |
| --- | --- |
| Skill `tripo-3d` | 主流程：工具检查、授权引导、MCP 工作流、场景 → 工具链映射、输入处理、积分规则 |
| Skill `tripo-game-asset` | 游戏资产配方：面数预算道具、LOD 链、绑骨角色与动画、接入 Unity/Unreal/Godot/Three.js |
| MCP 服务器 `tripo` | 远程 Streamable HTTP server `https://developers.tripo3d.com/mcp`（OAuth 2.1），含计划、生成、绑骨、转换与独立 UV；以实际可见工具 schema 为准 |
| Hook `SessionStart` | 注入 7 条规则：异步等待、链接过期、计费确认、浏览器授权、如实报错、PBR 默认关闭、显式选模与计费决策 |

## 怎么用

安装并启用插件后，直接描述需求即可，例如：

- 生成一个低多边形的宝箱 3D 模型，导出 FBX 给 Unity 用
- Turn this concept image into a textured 3D model and export it as GLB
- 生成一个可 3D 打印的骑士小雕像，导出 STL 文件
- 生成一个 T-pose 的机器人角色，绑好骨骼并加上走路动画
- 查一下我的 Tripo 余额

也可以在输入框输入 `/` 从「技能」分组手动选用 `tripo-3d` 或 `tripo-game-asset`。

### 首次授权

首次使用时 Tripo 的 MCP 服务器需要授权：

1. 打开 **设置 → MCP**，在「Plugin MCP 服务器」分组找到 Tripo 一行（显示「需要授权」），点 **打开授权**。
2. 系统浏览器打开的授权页对接**国内站**控制台（developers.tripo3d.com，+86 短信登录、支付宝充值），**没有选区步骤**。没有账号可以顺手注册，新账号有免费额度。海外站账号无法在此构建上授权——请改用海外版插件。
3. 页面显示一次性验证码并跳转 Tripo 控制台：登录后把验证码填入 **Verification code**，点 **Authorize**。
4. ZCode 自动重连并加载工具。撤销授权：在 Tripo 控制台的 API Keys 页删除授权时选定的 Key。

## 依赖、网络访问与副作用

- **网络**：MCP 工具调用走 `https://developers.tripo3d.com/mcp`；授权页跳转到国内站 Tripo 控制台（developers.tripo3d.com）。生成结果通过 Tripo 的 CDN 短期链接（约 2 小时过期）下载。
- **账号与计费**：所有生成任务消耗你自己 Tripo 账号的积分，通过任务状态与用量账单核对实际消耗；失败任务自动退款。批量生成前 skill 会先用 `tripo_plan` 草稿、查余额并确认。
- **文件写入**：只在你要求把模型落到本地时，用 `curl` 把结果下载到项目目录；Hook 与 MCP 服务器本身不写任何文件。
- **命令执行**：仅在上传本地图片/模型（`tripo_upload_ticket` 返回的 curl）或下载结果时运行 shell 命令。插件不会安装或调用任何命令行客户端，MCP 失败、未授权、批量或本地落盘需求也不例外。
- **Hook**：`hooks/session-start.mjs` 依赖 PATH 中的 `node`，只从 stdin 读取事件、向 stdout 输出一段固定文本，不访问网络、不读写文件。
- **遥测**：插件本体没有独立的分析 SDK。已部署的 Tripo MCP 服务启用分析时，可以记录工具调用结果、任务元数据及能够解析出的 Tripo 账号 ID。插件声明非凭据请求头 `X-Tripo-Distribution: zcode_plugin`；宿主透传时，服务端会分别记录分发渠道和识别出的客户端（如 ZCode、Claude 或 unknown）。埋点不包含提示词、API Key、OAuth token、文件路径或签名下载链接。账号凭据由 ZCode 的凭据存储管理，不经过对话。

## 来源与许可

- 插件本体：MIT，作者 [VAST](https://www.tripo3d.ai)。
- 两个 skill 由 Tripo 官方的 Kimi / Codex 插件（同为 VAST 维护，MIT）移植而来。
- MCP 服务器为 Tripo 官方实现；生成内容遵循 [Tripo API 内容策略](https://platform.tripo3d.ai/docs)。
