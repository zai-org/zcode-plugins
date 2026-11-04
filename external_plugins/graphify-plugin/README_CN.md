# Graphify — ZCode 代码知识图谱插件

[![CI](https://github.com/movtigroup/Graphify-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/movtigroup/Graphify-plugin/actions/workflows/ci.yml)
[![Release](https://github.com/movtigroup/Graphify-plugin/actions/workflows/release.yml/badge.svg)](https://github.com/movtigroup/Graphify-plugin/actions/workflows/release.yml)

**中文** — Graphify 将项目目录转换为**可查询的知识图谱**：扫描代码、文档与配置文件，提取文件、符号、import 与文档引用，并在 `<目标目录>/.graphify/` 下生成三个产物：

| 产物 | 用途 |
|---|---|
| `graph.json` | 节点（`code`/`doc`/`config`/`symbol`）+ 边（`imports`/`contains`/`links`/`mentions`），支持 9 个查询命令 |
| `graph.html` | 自包含的交互式图谱（无 CDN，可离线打开） |
| `graph-report.md` | 枢纽文件、孤立文件（疑似死代码）、外部依赖、失效文档链接 |

**English** — see [README.md](README.md). **فارسی** — [README.md](README.md) را ببینید.

## 安装

1. **Plugin Marketplace → Add → Add Plugin Marketplace**，粘贴本仓库地址；
2. 合入 ZCode 官方市场后，直接在市场列表安装 **Graphify**；
3. 手动方式：克隆后将 `skills/graphify` 复制到 `~/.agents/skills/`。

## 使用

用自然语言向智能体提问（中英文均可）：

```
graphify 扫描这个项目，告诉我系统的核心文件在哪
谁 import 了 utils.py？改它会影响什么？
找出项目里的死代码
```

底层流程：智能体运行一次 `build_graph.py`，先读 `graph-report.md` 概览，再用 `query_graph.py`
的 9 个命令（info / hubs / orphans / search / node / neighbors / imports / imported-by / external）
回答结构性问题，而不是反复阅读源码文件。

## 运行要求

- Python 3.8+（仅标准库，无需 pip 安装；Windows 可用 `py -3`）。
- 支持 ZCode / Claude Code 插件或技能机制。

## 副作用与安全

- 仅运行插件自带的两个 Python 脚本（`build_graph.py` / `query_graph.py`），纯标准库，**无网络访问**。
- 唯一的文件写入：在被扫描项目下创建 `.graphify/` 目录；输出路径经过 `realpath` + `commonpath`
  包含性校验，不会逃逸出输出目录。
- 不含凭据、机器特定路径、混淆代码、预编译二进制或第三方代码/资产。

## 开发

```bash
python tests/validate.py    # 结构校验
python tests/smoke_test.py  # 端到端：构建 + 查询
```

## 许可证

MIT © Movti Group
