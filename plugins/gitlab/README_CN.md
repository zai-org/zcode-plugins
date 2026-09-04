# ZCode GitLab CLI 工作流插件

[English](./README.md)

本插件将 GitLab 官方 CLI（`glab`）内置的 Agent Skills 打包为 ZCode 插件，并补充安装与认证引导。它使用本机 [`glab`](https://docs.gitlab.com/cli/)，支持 GitLab.com、GitLab Dedicated 和 GitLab Self-Managed。

## 安装与认证

- 运行 `/gitlab:setup [hostname]`，让 Agent 检查 `glab` 二进制；缺少或过期时默认引导安装/升级到最新稳定版，未登录时引导浏览器/OAuth 认证。
- 所有 GitLab Skill 在执行业务流程前都会验证主机、认证状态和当前用户名。
- 用户完成登录后必须再次现场验证；验证失败或账号不符时停止执行。
- Agent 不得要求用户在对话中粘贴 Token、密码或设备码。

插件不会内置 `glab` 或保存凭据。显式运行 `/gitlab:setup` 时，Agent 会先展示最新稳定版的安装/升级命令；普通 GitLab workflow 不会静默替换二进制。`GITLAB_TOKEN` 等环境凭据可能覆盖本地存储的登录状态，preflight 会验证最终生效的身份，但不得输出密钥。

## Skills

| Skill | ZCode 命令 | 说明 |
|-------|------------|------|
| setup | `/gitlab:setup [hostname]` | 检查 `glab`、引导登录并确认当前账号 |
| glab | `/gitlab:glab` | GitLab 官方通用 CLI 与 API 工作流指导 |
| glab-stack | `/gitlab:glab-stack` | GitLab 官方实验性 Stacked MR 工作流指导 |

使用自然语言提出 GitLab 任务时，也可以自动激活对应 Skill，不要求必须输入斜杠命令。

## 示例

```text
/gitlab:setup gitlab.example.com
/gitlab:glab 查看等待我 Review 的 MR
/gitlab:glab 分析当前分支失败的 Pipeline
/gitlab:glab-stack 非交互地查看当前 Stack
```

## 兼容性

官方 Skill 来源与固定提交见 [`UPSTREAM.md`](./UPSTREAM.md)。本插件不依赖较新的 `glab skills install` 命令，只要 ZCode 能调用底层 `glab` 命令即可。Setup 通过 `glab check-update` 动态选择最新版本，不硬编码发行号。命令模板已使用 `glab 1.93.0` 做 smoke test；`mr note`、`stack`、`mcp`、`work-items` 等实验性命令必须先读取本机 `--help`。

## 安全边界

这是本机 `glab` 之上的提示词/Skill 层，不是强制策略沙箱。插件本身不接收或保存 GitLab 凭据。执行远端写操作前，Agent 必须明确主机、项目、账号和目标；合并、删除、取消保护、Secret/Variable 修改或 Token 变更等破坏性操作必须获得用户明确确认。

## ZCode 打包

可安装的主清单是 `.zcode-plugin/plugin.json`；`.claude-plugin/plugin.json` 保留为兼容镜像。市场注册信息维护在仓库根目录 [`marketplace.json`](../../marketplace.json)。

## 许可证

导入的 GitLab CLI Skills 使用 MIT 许可证，见 [`LICENSE`](./LICENSE) 与 [`UPSTREAM.md`](./UPSTREAM.md)。
