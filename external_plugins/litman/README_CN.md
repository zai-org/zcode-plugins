# litman ZCode 插件

[English](./README.md)

[litman](https://litman.dev) 把你读过的每篇论文都存在你自己的电脑上，归档交给
AI 助手来做。本插件把它接入 ZCode：没装 litman 时，agent 会问你要不要装，装好后
交给 litman 自己的 skill。

litman 是独立的开源程序（[GitHub](https://github.com/wqx1999/litman)，AGPL-3.0），
不装本插件也能用；插件只负责把它装上、接入 ZCode。

## 使用

在任意会话里提到 litman 或你的文献库即可，例如「帮我装 litman」；也可以在输入框打
`/litman`，在「技能」里选 `$litman-setup`。

`litman-setup` skill 的流程：

1. 运行 `lit --version`。已经装好 litman 和它的 skill，就直接交给它们。
2. 没装就先问你要不要装，你明确同意后才用官方一行安装命令安装。
3. 运行 `lit install-skill --agent zcode`，把 litman 的 skill 复制到
   `~/.agents/skills`。
4. 还没有文献库时，问你放在哪，再运行 `lit init`。

ZCode 可能要在新会话里才加载 litman 的 skill。agent 可以用 `lit agent zcode`
把你的文献库作为新的 ZCode 工作区打开。

## Skills

| Skill | 入口 | 用途 |
| --- | --- | --- |
| `litman-setup` | `$litman-setup`，或按上下文自动触发 | 检查、安装并接入 litman |

## 会在你的电脑上做什么

- **网络访问**：从 `get.litman.dev` 下载安装脚本。安装脚本会安装
  [uv](https://github.com/astral-sh/uv)、由 uv 管理的 Python 运行时，以及 PyPI 上的
  litman。从中国大陆访问时，拿到的安装脚本会改从大陆可访问的镜像下载。
- **命令执行**：安装脚本，以及 `lit` 命令（`lit --version`、`lit install-skill`、
  `lit vault list`、`lit init`、`lit agent`）。ZCode 照常弹出审批。
- **文件写入**：uv 和 litman 装在你的用户目录下（`~/.local/bin` 和 uv 的工具目录）；
  需要时安装脚本会把该目录加进 `PATH`，并创建 litman 快捷方式。litman 的 skill
  写到 `~/.agents/skills`；文献库放在你选的文件夹。
- **没有** Hook、MCP 服务、自带的模型或 API 服务，也不涉及任何凭据。

## 许可证

本插件使用 MIT 许可证，不含第三方代码。litman 使用 AGPL-3.0；uv 使用 MIT / Apache-2.0。

问题和 bug：[litman issues](https://github.com/wqx1999/litman/issues)。
