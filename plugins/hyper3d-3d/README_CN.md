# ZCode Hyper3D 3D 建模插件

[English](./README.md)

本插件是 ZCode 官方 3D 建模插件：让 Agent 通过 Hyper3D 用文字和/或图片生成 3D 模型，生成低模（智能低模），给已有模型重新贴图，或给模型绑骨并套预设动画，产物保存到工作区。费用计入你的 Coding Plan，无需 Hyper3D 账号或 API Key；这一点与需要登录你自己 Hyper3D 账号的 `hyper3d-rodin` 插件不同。

## 包含组件

- MCP 服务 `hyper3d_3d`（stdio，Node.js），运行时名称为 `plugin:hyper3d-3d:hyper3d_3d`，提供三个工具：
  - `submit_hyper3d_task`：校验参数、提交任务、等待结果并下载产物；
  - `get_hyper3d_task`：继续等待已提交的任务，不会重新提交；
  - `list_hyper3d_animations`：列出预设动画库（免费）。
- 技能 `hyper3d-3d`，告诉 Agent 何时、如何调用这些工具。

## 使用前提

- ZCode 已登录，并连接了 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接无法使用。
- 账号已关联 Z.ai 并绑定手机号（海外账号需绑定邮箱）。
- 无需任何配置：ZCode 每次调用时自动把当前登录身份交给插件。
- 安装或更新插件后需新建 ZCode 会话。

## 使用方式

直接用自然语言提需求，例如：

- 「生成一个小木头宝箱的 3D 模型，保存成 GLB」
- 「把 `assets/hero.png` 做成 T 姿势的 3D 角色，再绑骨并加一个走路动画」
- 「用 `assets/armor-ref.png` 给 `https://example.com/knight.glb` 重新贴一套银色盔甲」
- 「把刚生成的宝箱做成约 2000 面的低模 OBJ，带 PBR 贴图」

Agent 会调用 `submit_hyper3d_task`，`action` 可选：

| `action` | 作用 | 必填 | 可选 |
| --- | --- | --- | --- |
| `generate` | 文字和/或图片生成 3D | `prompt`（不超过 1024 字）和/或 `images`（1–5 张） | `image_labels`（每张图的视角：`F`、`FL`、`FR`、`B`、`BL`、`BR`、`L`、`R`、`U`、`D`、`?`）、`mesh_mode`（`Raw` / `Quad`）、`quality`（`high` / `medium` / `low` / `extra-low`）、`material`（`PBR` / `Shaded` / `All` / `Hybrid` / `None`）、`format`（`glb` / `usdz` / `fbx` / `obj` / `stl`，默认 `glb`）、`ta_pose` |
| `polygen` | 智能低模：直接生成低多边形模型（不只是减面），适合游戏资产 | `task_id`（generate 任务返回，`gen:` 开头）、`model_url`（https；`.obj`、`.glb`、`.stl`、`.fbx`、`.usd`、`.usda`、`.usdz`、`.usdc`）、`images`（1–5 张）、`prompt`（不超过 1024 字）至少给一个；`task_id` 和 `model_url` 只能二选一 | `face_count`（200–10000；不填时 `model_url` 按 4000，其余自动）、`mesh_mode`（默认 `Quad` / `Raw` / `NGon`）、`format`（默认 `obj` / `glb` / `usdz` / `fbx` / `stl`）、`image_labels`（可以比 `images` 少，不能多）。不传 `model_url` 时：`material`（`PBR` / `Shaded` / `All` / `Hybrid` / `None`，默认 `None` 只出几何）和 `uhd_texture`（只让新生成的贴图更清晰，分辨率不变）。传 `model_url` 时：`images` 作为网格参考、`transfer_texture`（默认 `true` 迁移原贴图，`false` 只出几何）；不接受 `prompt`、`material`、`uhd_texture` |
| `texture` | 给已有模型重新贴图 | `model_url`（https；`.obj`、`.stl`、`.gltf`、`.glb`、`.fbx`、`.usdz`）和 `image`（一张参考图） | `prompt`、`material`（`PBR` / `Shaded` / `All` / `Hybrid`）、`format` |
| `rig` | 绑骨并套预设动画 | `task_id`（generate 任务返回，`gen:` 开头）和 `model_url`（https；`.obj`、`.glb`、`.stl`、`.fbx`、`.usd`、`.usda`、`.usdz`、`.usdc`）二选一 | `bone_template`（`auto` / `human` / `quadruped` / `bird` / `dragon` / `kaiju`）、`animations`（最多 10 个，来自 `list_hyper3d_animations`）、`in_place`、`format`（`glb` / `fbx` / `usdz`） |

`mesh_mode: "NGon"` 只有 `polygen` 接受。`polygen` 用 `task_id` 时直接复用生成的模型（前一步任务必须已经成功）；`material` 不是 `None` 时按原任务的参考图或描述重新生成贴图，另给 `images` / `prompt` 会替换它们。

每个 action 都可以带 `output_dir`（工作区内的保存目录）和 `request_id`（仅在上一次调用提示「提交未确认」时用于重放同一次提交）。

`get_hyper3d_task` 接收 `task_id` 和可选的 `output_dir`。`list_hyper3d_animations` 可选 `category`（`human`、`canine`、`bird`、`fish`、`heavyhooved`、`leanhooved`、`lizard`、`rodentia`、`seaturtle`）和本地关键词过滤 `search`。

## 只有文字描述时：先生图，再转 3D

3D 厂商的最佳实践是先把文字生成图片，再由图片生成 3D 模型。只有文字描述时，Agent 会推荐先用 Seedream 插件（`image-generation`）生成一张参考图，再用这张图生成 3D 模型。调用 Seedream 前，Agent 会先告诉你这会多一步单独计费的生图；你不同意，或明确只要用文字生成时，Agent 直接把文字作为 `prompt` 提交，不经过 Seedream。没有安装 Seedream 时也直接用文字生成。`polygen` 同样可以用 Seedream 生成的图片，或直接用 `prompt` 生成低模。插件之间不会互相调用，需要同时安装并启用 Seedream 才能这样串起来。

## 输入与产物

- 参考图可以是工作区路径、`https://` 地址或 `data:image/...;base64` URL（png / jpeg / webp，不超过 10 MiB）；本地文件和 `data:` 会先上传到 ZCode。
- 本地 3D 模型文件无法上传：请提供公网 `https://` 的 `model_url`（不超过 100 MB）；给生成的模型绑骨或做低模时用 `task_id` 串联。
- 产物保存到 `output_dir`，不填时保存到工作区 `generated-3d/<YYYYMMDD-HHMMSS>-<action 或任务种类>-<slug>/`：`submit_hyper3d_task` 用 `action`（`generate`、`polygen`、`texture`、`rig`）；`get_hyper3d_task` 用 `task_id` 前缀里的任务种类（例如 `gen`、`poly`、`tex`，没有前缀时为 `task`）。slug 取 `generate`、`polygen` 或 `texture` 的 `prompt` 里的字母和数字、以 `-` 连接（最多 24 个字符），其余情况为 `model`；目录已存在时加 `-1`、`-2`。每个任务最多下载 20 个文件。文件名取自产物名称或链接，绝不取自 task_id。在 macOS、Linux、Windows 上都安全的名字按服务端给出的原样保留（包括空格、括号和中文等非 ASCII 文字），OBJ 引用 MTL 和贴图的地方才不会失效；只改不安全的部分：`/`、`\`、`:`、`*`、`?`、`"`、`<`、`>`、`|` 和控制字符换成 `_`；去掉开头和结尾的点和空格（只由点组成的名字改用 `file-<序号>`）；`CON`、`NUL`、`COM1`、`LPT1` 等 Windows 设备名（不分大小写，带不带扩展名都算）前面加 `_`；超过 200 字节的名字截短并保留扩展名。不会覆盖已有文件，重名时加 `-1`、`-2`。只要有文件换了名字保存（被清洗或加了重名后缀），结果里就会逐个列出（结构化结果里的 `renamed_files` 和 `rename_warning`），并提醒 OBJ / MTL 文件里的引用可能需要手动修正。
- `polygen` 的产物常是 OBJ：`.obj`、配套的 `.mtl` 和贴图图片都保存在同一个目录，名字安全时按原名保存，OBJ 才能找到材质和贴图。请用新的或空的 `output_dir`，文件被改名（名字不安全或重名加了 `-1`）会让这些引用失效，改名会在结果里列出。
- 产物链接 7 天内有效，服务端不转存。下载失败的文件会给出链接。
- 第一个产物链接和之后的每一跳重定向遵循同一条规则（最多跟随 5 次重定向）：必须是 `https://` 链接，且不能指向 `localhost` 或本机回环、内网、链路本地、CGNAT、IPv6 唯一本地、组播、未指定的 IP 地址，包括 IPv4 映射和数字形式的 IPv4 写法。不在开发自测模式时，请求第一个链接和每一跳之前还会解析链接的域名（取全部地址）：只要有一个地址落在上述范围内，或者域名无法解析，就不下载；例外是解析出的 `198.18.0.0/15` 和 `fdfe:dcba:9876::/64` 地址：Clash、mihomo、Surge 等代理工具在 fake-ip 或 TUN 模式下给每个域名都回这类地址，真实地址由代理自己决定，这里看不到；这些地址直接写在链接里时仍然拒绝；链接里直接写的 IP 地址按字面检查。仍有 DNS 重绑定的窗口：检查时和连接时是两次独立的域名解析，DNS 服务器如果给检查回公网地址、给连接回内网地址，这里拦不住；即便如此，响应也只会写进工作区里的文件，不会回传给模型。从 `https://` 链接出发的同源跳转照常跟随。只有 `ZCODE_BASE_URL` 本身是本机回环地址（开发自测）时，才接受本机回环链接（包括 `http://`）。在这种开发自测模式下，任何 `https://` 链接都可以作为第一个链接下载，包括指向内网地址的链接；从本机回环 `http://` 链接出发的跳转可以到达任何可接受的链接。不符合规则、跳到别处或跳转次数过多的链接不下载，以链接形式列出并说明原因，整次调用不会因此失败。
- 结果里还会给出可原样用于下一步的 `task_id`（600+ 字符）。`invocation_id` 只在提交的那次调用（`submit_hyper3d_task`）本身等到产物、且服务端返回了它时给出；提交后任务还在进行就返回时不包含这个字段，`get_hyper3d_task` 完成后的结果里为 `null`。

## 计费

- 任务成功才扣费：`generate`、`polygen`、`texture`、`rig` 每次 0.5 credit；失败的任务、被拒绝的提交和本地参数校验错误都不扣费，动画库查询免费。
- 同一次提交的重试复用同一个 `Idempotency-Key`，网络错误或超时不会重复提交。继续等待请用 `get_hyper3d_task`，不要重新提交。

## 说明与限制

- 任务通常需要 1–2 分钟。单次工具调用最多等约四分钟，未完成时返回 `task_id`，再由 `get_hyper3d_task` 继续等待；重新调用 `submit_hyper3d_task` 会建出并扣费一个新任务。
- 服务端报告任务已成功、但还没给出产物链接时，插件会继续等待；等待时间先用完时返回状态 `succeeded_pending_products` 和 `task_id`：任务已经成功并已计费，之后可以用 `get_hyper3d_task` 取回产物。
- 用 `task_id` 串联时，前一步任务必须已经成功。只有 generate 任务（`gen:`）能按 `task_id` 串联：低模（`poly:`）、贴图或绑骨后的产物不能再按 `task_id` 绑骨或做 `polygen`，需要下载后以 https `model_url` 传入。
- 档位、贴图模式和贴图分辨率由服务端固定（`polygen` 也一样）；`uhd_texture`（仅 `polygen`）只让新生成的贴图更清晰，不改变贴图分辨率。不提供部件拆分、图片生成、自定义骨骼和上传动画。
- 提交未确认期间，请求体（action、参数、图片和模型地址，不含身份）和每个参数的指纹暂存在插件数据目录，保证按 `request_id` 重放时请求完全一致，并能指出重放时改过、因而没有生效的所有参数。macOS / Linux 上文件权限为 0600（目录 0700）；Windows 上依赖用户配置目录的 ACL 保护。提交被确认或被明确拒绝后删除，最晚在首次保存 24 小时后删除（重放时重写记录不会续期）；重放如果到 24 小时之后才结束，不会再保存记录，工具会说明。
- 结果不明的提交或按 `request_id` 的重放可能被上游拒绝（code 3703、3707）。如果服务端此前从没受理过这个 `request_id`（没有回过 `UNKNOWN`、`CALLING`、不带 `task_id` 的结果、「同一请求仍在处理」（3702）或其他 2xx 响应），说明它没有创建任务：插件删除记录并按提交失败报告。不要再重放这个 `request_id`；如有需要调整输入后，不带 `request_id` 重新提交（3703 且原因是前一步任务尚未完成时，先用 `get_hyper3d_task` 等它完成）。如果服务端已经受理过这个 `request_id`，之后的拒绝（例如上游限流、图片链接已过期）证明不了任务没有创建，插件会连同拒绝原因再次交回 `request_id`。code 3001 可能来自当前团队或个人范围不完整、与这次请求无关，它和其余错误一样，也会交回 `request_id`。
- API 请求只发往宿主通过 `ZCODE_BASE_URL` 提供的 ZCode API 地址，拒绝跟随重定向，超过 1 MiB 的接口响应不读取；产物从服务返回的临时链接下载，下载时不携带任何身份头。
- 工具没有定义的参数（例如拼错的 `bone_template`）在本地直接拒绝，不发任何请求，并列出可用参数；不会提交，也不扣费。
- ZCode 取消调用时，插件立即停止等待、重试和下载，也不再返回结果；已经提交的任务会继续执行，成功后照常扣费。只有已经拿到 `task_id` 时才能取回结果：宿主显示进度时，「任务已提交」的进度消息里带有 `task_id`，可以用 `get_hyper3d_task` 取回；否则无法通过插件取回。
- 本地输入文件和 `output_dir` 都必须在工作区内。
