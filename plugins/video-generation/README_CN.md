# ZCode 视频生成插件

[English](./README.md)

本插件通过 ZCode 官方视频生成服务，让 Agent 用文字描述生成短视频，或按参考图 / 参考视频 / 参考音频、首尾帧生成，结果保存到工作区。

## 包含组件

- MCP 服务 `video_generation`（stdio，Node.js），运行时名称为 `plugin:video-generation:video_generation`，提供两个工具：
  - `generate_video`：提交任务并等待结果；
  - `get_video_result`：继续等待已提交的任务，不会重新提交。
- 技能 `generate-video`，告诉 Agent 何时、如何调用这些工具。

## 使用前提

- ZCode 已登录，并连接了 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接无法使用。
- 账号已关联 Z.ai 并绑定手机号（海外账号需绑定邮箱）。
- 无需配置 Token 或 API Key：ZCode 每次调用时自动把当前登录身份交给插件。
- 安装或更新插件后需新建 ZCode 会话。

## 使用方式

直接用自然语言提需求，例如「生成一段视频：蓝天白云下一只卡通小鸟飞过，固定镜头」，或「让 `assets/cover.png` 动起来」，Agent 会调用 `generate_video`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 视频内容描述。 |
| `images` | 否 | 参考图，最多 9 张：工作区路径、`https://` / `asset://` 地址或 `data:image/...;base64` URL。本地文件（png / jpeg / webp，不超过 10 MiB）会先上传到 ZCode。 |
| `videos` | 否 | 参考视频，最多 3 个，只能是 `https://` 或 `asset://` 地址。 |
| `audios` | 否 | 参考音频，最多 3 段（wav / mp3）：地址、`data:audio/...;base64`，或不超过 2 MiB 的工作区文件。 |
| `first_frame` / `last_frame` | 否 | 首帧，以及可选的尾帧。不能与参考素材同时使用。 |
| `output_path` | 否 | 保存位置，默认保存到工作区 `generated-videos/` 下。 |
| `request_id` | 否 | 仅当上一次调用提示「提交未确认」时，原样传回返回的值，用于重放同一次提交。 |

## 说明

- 生成通常需要几分钟。单次工具调用最多等约四分钟，未完成时返回 `task_id`，再由 `get_video_result` 继续等待。
- 每次调用 `generate_video` 都消耗额度。同一次提交的重试复用同一个 `Idempotency-Key`，网络错误或超时不会重复提交。
- 提交未确认期间，请求体（提示词、素材地址、内联的本地音频，不含身份）暂存在插件数据目录、仅当前用户可读，保证按 `request_id` 重放时请求完全一致；确认后或 24 小时后删除。
- 时长、画幅、模型和水印由服务端固定。
- API 请求只发往宿主通过 `ZCODE_BASE_URL` 提供的 ZCode API 地址，拒绝跟随重定向；生成结果从服务返回的临时链接下载，该链接可能在其他域名。
- 本地输入文件和 `output_path` 都必须在工作区内，不会覆盖已有文件。
