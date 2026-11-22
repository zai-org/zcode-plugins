# ZCode Meshy 3D 建模插件

[English](./README.md)

本插件是 ZCode 官方 3D 建模插件：让 Agent 通过 Meshy 用文字描述或参考图生成 3D 模型，并可继续贴图、换贴图、减面、转格式、绑骨和套动画，产物保存到工作区。费用计入你的 Coding Plan，无需 Meshy 账号或 API Key。

## 包含组件

- MCP 服务 `meshy_3d`（stdio，Node.js），运行时名称为 `plugin:meshy-3d:meshy_3d`，提供三个工具：
  - `submit_meshy_task`：校验参数、提交任务、等待结果并下载产物；
  - `get_meshy_task`：继续等待已提交的任务，不会重新提交；
  - `list_meshy_animations`：列出预设动画库（免费）。
- 技能 `meshy-3d`，告诉 Agent 何时、如何调用这些工具。

## 使用前提

- ZCode 已登录，并连接了 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接无法使用。
- 账号已关联 Z.ai 并绑定手机号（海外账号需绑定邮箱）。
- 无需任何配置：ZCode 每次调用时自动把当前登录身份交给插件。
- 安装或更新插件后需新建 ZCode 会话。

## 使用方式

直接用自然语言提需求，例如：

- 「生成一个 A-pose 的卡通骑士 3D 模型，再给它贴上银色盔甲和红披风」
- 「把 `assets/robot.png` 做成 3D 模型，导出 FBX」
- 「给骑士减面后绑骨，让它挥手和走路」

Agent 会调用 `submit_meshy_task`，`action` 可选：

| `action` | 作用 | 必填 | 可选 |
| --- | --- | --- | --- |
| `generate` | 文字生成 3D（白模）、单图生成 3D、多图生成 3D（2–4 张，第一张为正面） | `prompt`（不超过 800 字）**或** `images` | `geometry_only`、`pose_mode`（`a-pose` / `t-pose`）、`formats` |
| `refine` | 给文字生成的白模贴图 | `preview:` 开头的 `task_id` | `texture_prompt`、`texture_image`、`formats` |
| `retexture` | 换贴图 | `task_id` 或 `model_url`；`texture_prompt` 和 / 或 `texture_image` | `formats` |
| `remesh` | 减面 / 重拓扑 | `task_id` 或 `model_url` | `topology`（`quad` / `triangle`）、`target_polycount`（100–300000）、`formats` |
| `convert` | 转格式 | `task_id` 或 `model_url`；`formats` | — |
| `rig` | 标准人形绑骨，附送走路和跑步动画 | `task_id` 或 `model_url`（`.glb`） | `height_meters`、`include_fingers`、`skeleton_template`、`formats` |
| `animate` | 套预设动画，多个动画合并成一个文件 | `rig:` 开头的 `task_id`；`action_ids`（1–10 个，来自 `list_meshy_animations`） | `formats` |

每个 action 都可以带 `output_dir`（工作区内的保存目录）和 `request_id`（仅在上一次调用提示「提交未确认」时用于重放同一次提交）。`formats` 可选 `glb`、`fbx`、`obj`、`usdz`、`stl`、`3mf`（`remesh` 和 `convert` 另支持 `blend`），决定下载哪些格式；`generate`、`remesh`、`convert` 还会把它作为输出格式提交。不传 `formats` 时下载 `glb`（没有 `glb` 时下载第一个可用格式）；传了 `formats` 就只下载这些格式，任务没有返回的格式会在结果里说明并列出可用链接，不会改下别的格式。按 `request_id` 重放时，`generate`、`remesh`、`convert` 按首次提交的 `formats` 下载，其余 action 按重放这次传的 `formats` 下载。

`get_meshy_task` 接收 `task_id`，以及可选的 `output_dir` 和 `formats`。`list_meshy_animations` 可选 `category` 和 `search` 筛选。

`retexture`、`remesh`、`convert`、`rig` 接受类型为 `preview`、`image`、`multi`、`refine`、`retexture`、`remesh` 的 `task_id`，或通过 `https://` 的 `model_url` 使用自己的模型。

**绑骨前先减面。** 生成的模型约 140 万三角面，超过 Meshy 绑骨上限 38 万。推荐链路：`generate` →（文字生成再 `refine`）→ `remesh`（`target_polycount` ≤ 300000）→ 用 remesh 的 `task_id` 做 `rig` → `animate`。

## 只有文字描述时：先生图，再转 3D

3D 厂商的最佳实践是先把文字生成图片，再由图片生成 3D 模型。只有文字描述时，Agent 会推荐先用 Seedream 插件（`image-generation`）生成一张参考图，再用这张图生成 3D 模型。调用 Seedream 前，Agent 会先告诉你这会多一步单独计费的生图；你不同意，或明确只要用文字生成时，Agent 直接把文字作为 `prompt` 提交，不经过 Seedream。没有安装 Seedream 时也直接用文字生成。插件之间不会互相调用，需要同时安装并启用 Seedream 才能这样串起来。

## 输入与产物

- 参考图可以是工作区路径、`https://` 地址或 `data:image/...;base64` URL（png / jpeg / webp，不超过 20 MiB）；本地文件和 `data:` 会先上传到 ZCode。
- 本地 3D 模型文件无法上传：请提供公网 `https://` 的 `model_url`，或用 `task_id` 串联之前的任务。
- 产物保存到 `output_dir`，不填时保存到工作区 `generated-3d/<YYYYMMDD-HHMMSS>-<action 或任务种类>-<slug>/`：`submit_meshy_task` 用 `action`（`generate`、`remesh`、`rig` 等）；`get_meshy_task` 用 `task_id` 前缀里的任务种类（`preview`、`refine`、`image`、`multi`、`retexture`、`remesh`、`convert`、`rig`、`anim` 等，没有前缀时为 `task`）。slug 取文字 `generate` 的 prompt 里的字母和数字、以 `-` 连接（最多 24 个字符），其余情况为 `model`；目录已存在时加 `-1`、`-2`。文件名取自产物链接，绝不取自 task_id。链接路径最后一段没有扩展名时补上 `.<格式>`（例如 `model` 存成 `model.glb`），单纯补扩展名不算改名。在 macOS、Linux、Windows 上都安全的名字按链接给出的原样保留（包括空格、括号和中文等非 ASCII 文字），OBJ 引用 MTL 和贴图的地方才不会失效；只改不安全的部分：`/`、`\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 和控制字符换成 `_`；去掉开头和结尾的点和空格（只由点组成的名字改用 `model.<格式>`）；`CON`、`NUL`、`COM1`、`LPT1` 等 Windows 设备名（不分大小写，带不带扩展名都算）前面加 `_`；超过 200 字节的名字截短并保留扩展名。不会覆盖已有文件，重名时加 `-1`、`-2`。只要有文件换了名字保存（被清洗或加了重名后缀），结果里就会逐个列出（结构化结果里的 `renamed_files` 和 `rename_warning`），并提醒 OBJ / MTL 文件里的引用可能需要手动修正。
- 没有请求的格式、缩略图和下载失败的文件以链接列出。Meshy 约 3 天后删除这些文件。
- 第一个产物链接和之后的每一跳重定向遵循同一条规则（最多跟随 5 次重定向）：必须是 `https://` 链接，且不能指向 `localhost` 或本机回环、内网、链路本地、CGNAT、IPv6 唯一本地、组播、未指定的 IP 地址，包括 IPv4 映射和数字形式的 IPv4 写法。不在开发自测模式时，请求第一个链接和每一跳之前还会解析链接的域名（取全部地址）：只要有一个地址落在上述范围内，或者域名无法解析，就不下载；例外是解析出的 `198.18.0.0/15` 和 `fdfe:dcba:9876::/64` 地址：Clash、mihomo、Surge 等代理工具在 fake-ip 或 TUN 模式下给每个域名都回这类地址，真实地址由代理自己决定，这里看不到；这些地址直接写在链接里时仍然拒绝；链接里直接写的 IP 地址按字面检查。仍有 DNS 重绑定的窗口：检查时和连接时是两次独立的域名解析，DNS 服务器如果给检查回公网地址、给连接回内网地址，这里拦不住；即便如此，响应也只会写进工作区里的文件，不会回传给模型。从 `https://` 链接出发的同源跳转照常跟随。只有 `ZCODE_BASE_URL` 本身是本机回环地址（开发自测）时，才接受本机回环链接（包括 `http://`）。在这种开发自测模式下，任何 `https://` 链接都可以作为第一个链接下载，包括指向内网地址的链接；从本机回环 `http://` 链接出发的跳转可以到达任何可接受的链接。不符合规则、跳到别处或跳转次数过多的链接不下载，以链接形式列出并说明原因，整次调用不会因此失败。
- 结果里还会给出可原样用于下一步的 `task_id`。`invocation_id` 只在提交的那次调用（`submit_meshy_task`）里给出，而且要这次调用本身等到任务完成、服务端也返回了它；提交时等不完（仍在运行）或提交后出错的结果里没有它，`get_meshy_task` 的结果里为 `null`。

## 计费

- 任务成功才扣费；失败的任务、被拒绝的提交和本地参数校验错误都不扣费，预设动画库查询免费。
- 参考消耗（credits）：文字生成 20、refine 10、图片生成 30（`geometry_only` 为 20）、retexture 10、remesh 5、convert 1、rig 5、animate 每个动画 3。
- 同一次提交的重试复用同一个 `Idempotency-Key`，网络错误或超时不会重复提交。继续等待请用 `get_meshy_task`，不要重新提交。

## 说明与限制

- 任务通常需要一到三分钟。单次工具调用最多等约四分钟，未完成时返回 `task_id`，再由 `get_meshy_task` 继续等待；重新调用 `submit_meshy_task` 会建出并扣费一个新任务。
- 服务端报告任务已成功、但还没给出产物链接时，插件会继续等待；等待时间先用完时返回状态 `succeeded_pending_products` 和 `task_id`：任务已经成功并已计费，之后可以用 `get_meshy_task` 取回产物。
- 用 `task_id` 串联时，前一步任务必须已经成功，否则提交会被拒绝（不扣费）。
- 绑骨只支持人形模型。Meshy 模型版本、贴图分辨率和 PBR 设置由服务端固定。
- 提交未确认期间，请求体（action、参数、图片地址，不含身份）和每个参数的指纹暂存在插件数据目录，保证按 `request_id` 重放时请求完全一致，并能指出重放时改过、因而没有生效的所有参数。macOS / Linux 上文件权限为 0600（目录 0700）；Windows 上依赖用户配置目录的 ACL 保护。提交被确认或被明确拒绝后删除，最晚在首次保存 24 小时后删除（重放时重写记录不会续期）；重放如果到 24 小时之后才结束，不会再保存记录，工具会说明。
- 结果不明的提交或按 `request_id` 的重放可能被上游拒绝（code 3703、3707）。如果服务端此前从没受理过这个 `request_id`（没有回过 `UNKNOWN`、`CALLING`、不带 `task_id` 的结果、「同一请求仍在处理」（3702）或其他 2xx 响应），说明它没有创建任务：插件删除记录并按提交失败报告。不要再重放这个 `request_id`；如有需要调整输入后，不带 `request_id` 重新提交（3703 且原因是前一步任务尚未完成时，先用 `get_meshy_task` 等它完成）。如果服务端已经受理过这个 `request_id`，之后的拒绝（例如上游限流、图片链接已过期）证明不了任务没有创建，插件会连同拒绝原因再次交回 `request_id`。code 3001 可能来自当前团队或个人范围不完整、与这次请求无关，它和其余错误一样，也会交回 `request_id`。
- API 请求只发往宿主通过 `ZCODE_BASE_URL` 提供的 ZCode API 地址，拒绝跟随重定向，超过 1 MiB 的接口响应不读取；产物从服务返回的临时链接下载，下载时不携带任何身份头。
- 工具没有定义的参数（例如拼错的 `target_polycount`）在本地直接拒绝，不发任何请求，并列出可用参数；不会提交，也不扣费。
- ZCode 取消调用时，插件立即停止等待、重试和下载，也不再返回结果；已经提交的任务会继续执行，成功后照常扣费。只有已经拿到 `task_id` 时才能取回结果：宿主显示进度时，「任务已提交」的进度消息里带有 `task_id`，可以用 `get_meshy_task` 取回；否则无法通过插件取回。
- 本地输入文件和 `output_dir` 都必须在工作区内。
