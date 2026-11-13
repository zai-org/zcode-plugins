# ZCode 生图插件

[English](./README.md)

本插件通过 ZCode 官方生图服务，让 Agent 用文字描述生成图片，或按一张参考图改图，结果保存到工作区。

## 包含组件

- MCP 服务 `image_generation`（stdio，Node.js），运行时名称为 `plugin:image-generation:image_generation`，提供一个工具 `generate_image`。
- 技能 `generate-image`，告诉 Agent 何时、如何调用该工具。

## 使用前提

- ZCode 已登录，并连接了 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接无法使用。
- 账号已关联 Z.ai 并绑定手机号（海外账号需绑定邮箱）。
- 无需配置 Token 或 API Key：ZCode 每次调用时自动把当前登录身份交给插件。
- 安装或更新插件后需新建 ZCode 会话。

## 使用方式

直接用自然语言提需求，例如「画一只戴墨镜的橘猫，赛博朋克风格」，或「把 `assets/cover.png` 改成水彩风」，Agent 会调用 `generate_image`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 画面描述。 |
| `reference_image` | 否 | 一张参考图：工作区路径、`https://` 地址或 `data:image/...;base64` URL。支持 png / jpeg / webp，不超过 10 MiB。本地文件会先上传到 ZCode。 |
| `output_path` | 否 | 保存位置，默认保存到工作区 `generated-images/` 下。 |

工具返回保存路径和一个会过期的临时图片链接。

## 说明

- 每次调用生成一张图，通常需要数秒到数十秒。
- 模型、尺寸和水印由服务端固定。
- API 请求只发往宿主通过 `ZCODE_BASE_URL` 提供的 ZCode API 地址，拒绝跟随重定向；生成结果从服务返回的临时链接下载，该链接可能在其他域名。
- 本地输入文件和 `output_path` 都必须在工作区内，不会覆盖已有文件。
