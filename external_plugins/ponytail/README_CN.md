# Ponytail for ZCode

AI 编程智能体的**懒惰资深开发模式**：最好的代码是从未写过的代码。Ponytail
让智能体用最少的新代码解决完整问题——没人要求的功能不做、优先复用代码库已有
实现、优先标准库、绝不为几行代码引入新依赖。对解决方案懒，对改动本身不懒：被
改动波及的调用方、测试和夹具照样补齐，校验、错误处理、安全、可访问性绝不削减。

本插件是 [DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail)
v5.3.2（MIT）的 ZCode 移植版，提示内容保持上游英文原文。

## 实测收益

上游公开的智能体基准（无头 Claude Code，Opus 5.5，39 个任务 × 5 次运行，
与同一智能体不开技能对照）：

| 指标 | 结果 |
|------|------|
| 代码行数 | −53% |
| 时间 | −41% |
| 成本 | −26% |
| 输出 token | −45% |
| 关键逻辑带测试的比例 | 98%（基线 68%） |
| 隐藏正确性/安全检查通过率 | 97%（基线 96%） |

来源：上游仓库 `benchmarks/results/2026-10-07-agentic.md`。

## 包含内容

**技能**（自然语言自动触发，或在输入框技能选择器中选取）：

| 技能 | 触发方式 | 作用 |
|------|---------|------|
| `ponytail` | `/ponytail`、"用最简实现"、"别过度设计" | 懒人模式本体，lite / full / ultra 三档。 |
| `ponytail-review` | `/ponytail-review` | 变更质量审查：bug、安全、并发负载、缺测试、速度、可删项。 |
| `ponytail-audit` | `/ponytail-audit` | 同标准审查整个仓库，按重要性排序，最多 20 条。 |
| `ponytail-debt` | `/ponytail-debt` | 收集 `shortcut:` 注释为技术债台账。 |
| `ponytail-gain` | `/ponytail-gain` | 实测收益面板。 |
| `ponytail-help` | `/ponytail-help` | 速查卡。 |

**命令**：`/ponytail [lite|full|ultra|off]`、`/ponytail-review`、
`/ponytail-audit`、`/ponytail-debt`、`/ponytail-gain`、`/ponytail-help`。

## 未移植内容

Claude Code 专属的状态栏（`/ponytail band`）、会话启动自动激活与默认模式配置
（`PONYTAIL_DEFAULT_MODE`）依赖上游的宿主专属 hooks 运行时，未包含。用
`/ponytail` 手动激活（或直接要求用最简方案实现）。

## 副作用与第三方内容

无：本插件仅含 Markdown 提示文件——无网络访问、无 API 依赖、无文件写入、无
命令执行。第三方内容：提示文本来自
[DietrichGebert/ponytail](https://github.com/dietrichgebert/ponytail)
（MIT，© 2026 DietrichGebert），已附署名收录。

## 许可证

MIT，© 2026 DietrichGebert——见 [LICENSE](LICENSE)。提示内容逐字移植自
https://github.com/dietrichgebert/ponytail。
