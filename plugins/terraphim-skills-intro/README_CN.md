# Terraphim Skills Introduction

[English](./README.md)

本插件为 ZCode 提供三个 Community 技能：本地代码搜索、操作经验记录和智能体记忆。

## 安装

1. 安装命令依赖：

   ```shell
   brew tap terraphim/terraphim
   brew install terraphim-grep terraphim-agent
   ```

2. 验证已安装的命令：

   ```shell
   terraphim-grep --version
   terraphim-agent --version
   terraphim-agent learn --help
   terraphim-agent memory --help
   ```

3. 打开 **设置 → 插件管理 → 发现**，选择 **Terraphim Skills Introduction** 并安装。
4. 新建一个 ZCode 会话，使三个技能可以被智能体发现。

插件不会自动安装软件。没有 Homebrew 时，请按照
[Terraphim 安装指南](https://terraphim-skills.md/docs/non-technical/)
下载适合平台的签名文件，并用该版本的 `SHA256SUMS` 验证。

## 技能

| 技能 | 用途 | 示例请求 |
| --- | --- | --- |
| `terraphim-grep` | 在指定的本地代码和文档中搜索，默认离线。 | “使用 Terraphim Grep 查找授权回调并显示两行上下文。” |
| `terraphim-agent-learn` | 检查失败并记录经过验证的操作修正。 | “把这次部署失败的经验记录下来，供下次会话使用。” |
| `terraphim-agent-memory` | 检索角色范围内的记忆并检查来源。 | “检索有关 OAuth 重定向验证的记忆，并引用来源。” |

智能体在依赖可能变化的命令接口前会先检查 `--help`。搜索是只读操作。只有用户明确要求时，
学习和记忆技能才会在选定的本地范围内写入数据。

## 权限与副作用

- 本插件不包含凭据、可执行文件、Hooks、后台任务或遥测。
- `terraphim-grep` 只读取用户为搜索指定的路径。
- 只有用户明确要求写入时，`terraphim-agent learn` 和 `terraphim-agent memory`
  才可能写入用户配置的本地 Terraphim 存储。
- 可选的模型综合功能可能把选定内容发送到用户配置的模型提供商，并可能产生该提供商的费用；
  除非用户明确要求，否则技能保持该功能关闭。
- 本插件只包含 Apache-2.0 Community 技能，不包含也不会解锁专有的 Core 或 Premium 指令。

可在 [Community、Core 和 Premium 技能目录](https://terraphim-skills.md/skills/)
中了解其他工作流。打开目录不会启动结账或付款。

隐私政策：<https://terraphim-skills.md/legal/privacy/>

服务条款：<https://terraphim-skills.md/legal/terms/>

产品信息：<https://terraphim-skills.md/>。
本插件适用随附的 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。
