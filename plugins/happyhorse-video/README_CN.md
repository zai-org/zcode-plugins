# ZCode HappyHorse 视频生成插件

[English](./README.md)

本插件通过 ZCode 官方 ToolHub 服务调用 HappyHorse，让 Agent 用文字描述、首帧图或 1–9 张参考图生成短视频，结果保存到工作区。

## 包含组件

- MCP 服务 `happyhorse_video`（stdio，Node.js），运行时名称为 `plugin:happyhorse-video:happyhorse_video`，提供两个工具：
  - `generate_happyhorse_video`：提交任务并等待结果；
  - `get_happyhorse_video_result`：继续等待已提交的任务，不会重新提交。
- 技能 `generate-happyhorse-video`，告诉 Agent 何时、如何调用这些工具。

## 使用前提

- ZCode 已登录，并有有效的 Coding Plan 订阅（个人或团队），费用从该订阅扣除。
- 账号已关联 Z.ai 并绑定手机号（海外账号需绑定邮箱）。
- 无需配置 Token 或 API Key：ZCode 每次调用时自动把当前登录身份交给插件。
- 安装或更新插件后需新建 ZCode 会话。

## 使用方式

直接用自然语言提需求，例如「生成一段 5 秒的视频：一只猫在草地上奔跑」，或「让 `assets/cover.png` 动起来」，Agent 会调用 `generate_happyhorse_video`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 视频内容描述，最长 10000 个字符。用参考图时按顺序用 `[Image 1]`、`[Image 2]` 指代。 |
| `duration` | 否 | 时长（秒），3 到 15 的整数，默认 5。 |
| `resolution` | 否 | `480P`、`720P` 或 `1080P`，不区分大小写，默认 `720P`。 |
| `ratio` | 否 | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`4:5`、`5:4`、`9:21` 或 `21:9`，默认 `16:9`。用了 `first_frame` 时不起作用。 |
| `first_frame` | 否 | 首帧图（图生视频）：工作区图片（png / jpeg / webp，不超过 10 MiB，会先上传）或 `https://` 公网地址。 |
| `reference_images` | 否 | 参考图 1–9 张（人物、物品、风格素材），格式同上。不能与 `first_frame` 同时使用。 |
| `output_path` | 否 | 工作区内的保存位置，不会覆盖已有文件。默认保存到 `generated-videos/` 下。 |
| `request_id` | 否 | 仅当上一次调用提示「提交未确认」时，原样传回返回的值，用于重放同一次提交。 |

## 说明

- 生成通常需要 1–5 分钟。单次工具调用最多等约四分钟，未完成时返回 `task_id`，再由 `get_happyhorse_video_result` 继续等待。
- 按成功生成的秒数和分辨率计费（例如国内 720P 5 秒约 4.8 元，含水印费），生成失败不计费。同一次提交的重试复用同一个 `Idempotency-Key`，网络错误或超时不会重复提交。
- 提交未确认期间，请求体（提示词、参数、图片地址，不含身份）暂存在插件数据目录、仅当前用户可读，保证按 `request_id` 重放时请求完全一致；确认后或 24 小时后删除。
- 模型和水印由服务端固定。
- API 请求只发往宿主通过 `ZCODE_BASE_URL` 提供的 ZCode API 地址，拒绝跟随重定向；生成结果从服务返回的临时链接下载，该链接可能在其他域名。
- 本地输入文件和 `output_path` 都必须在工作区内，不会覆盖已有文件。
