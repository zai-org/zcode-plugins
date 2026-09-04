# zCoder(ZCode 插件)

ZCode 的常驻 GLM 多模型编排器,并内置 **skill-forge** —— 一套可度量的技能构建与改进生命周期。每个任务都会被自动分解并路由到合适的引擎;每次技能变更在发布前都要经过确定性预言机评分。

## 解决什么问题

- **路由浪费**:ZCode 主线程与其子代理可能以相同力度运行同一任务。zCoder 为每个引擎锁定模型与思考力度,再按有序谓词路由:原子请求直接回答;视觉子任务交给视觉引擎;机械批量走廉价通道;深度子任务仅在并行或上下文隔离确实有收益时才使用最大力度引擎。
- **无法度量的技能**:改完"感觉更好"的技能只是感觉。skill-forge 用确定性 Python 预言机把技能评分写入 Wilson 加权、按会话标记的试验台账;改进必须是同会话配对的 Pareto 前沿证据,晋升要过 7 道显式闸门。空闲的自动化永不晋升 —— 晋升需要交互式 `--approved-by`。

## 引擎

| 引擎代理 | 模型 | 力度 | 路由 |
|---|---|---|---|
| `glm-vision` | GLM-5.3-Flash | `max` | 图像、OCR、截图/设计稿、视觉比对、UI/UX 检查、图表 |
| `glm-turbo` | GLM-5.3-Flash | `low` | **条件通道** —— 仅当本会话内该引擎有已验证的 PASS 后才路由;在此之前机械批量在主线程执行(绝不把真实工作交给未验证的引擎) |
| `glm-main` | GLM-5.3 | `max` | 架构、跨文件逻辑、算法、深度调试、安全分析、最终正确性审计 |

**降级阶梯**:若视觉引擎失败,感知先降级到主线程(同一模型),再降级到 `glm-main`。未经验证的引擎绝不承担真实工作 —— 机械批量仅在当前会话内 `glm-turbo` 获得已验证的 PASS 之后才路由给它。

**仅限 ZCode。** 本插件使用 `.zcode-plugin/plugin.json` 清单,仅包含 ZCode 的 hooks/agents/skills/commands,刻意不附带 `.claude-plugin/` 或 `.codex-plugin/` 兼容清单。

## 组件

- `agents/` —— 三个引擎代理。每个代理 frontmatter 中的 `model:` 与 `thoughtLevel:` 锁定路由与力度,两者都必填:省略 `thoughtLevel:` 会让框架注入编译期默认值,而某些后端会拒绝(如 `high`/`low`),因此这些值是显式锁定的。`thoughtLevel:` 的修改在下一次分发即时生效;`model:` 的修改需要重启会话。
- `skills/glm-orchestrator/` —— 编排协议:4 步链(分解 → 路由计划 → 分发 → 综合 + 主工程师审计)、零浪费规则、降级规则、完整示例。
- `skills/skill-forge/` + `commands/skill-scan.md` + `commands/skill-evolve.md` —— 可度量的技能生命周期。`/skill-scan` 零 token 检测技术栈缺口(基于清单,不调用 LLM);`/skill-evolve` 执行一轮 分阶段 评估→变异→晋升(Pareto 定向、小批量预算:修不好目标场景的候选在任何全矩阵开销之前就被淘汰)。技能由确定性 Python 预言机评分并写入 Wilson 加权试验台账(位于运行该技能项目下的 `tests/skill-evals/<skill>/trials.jsonl`);只做同会话交错比较;改进是必须引用失败试验的反身性变异(`MUTATION.md`);验收标准是 Pareto 前沿扩张(`pareto.py` —— 按场景支配,绝不使用标量平均;同时输出下一个变异目标与平台期止损规则:连续 2 次晋升未进入前沿 ⇒ 写新场景,而不是继续改正文)。晋升通过 7 道闸门 —— 静态上限、预言机自检、严格更优的配对证据、变异引用、与现任不同、增长上限、触发证据(修改 `description:` 需要记录在案的路由探针运行:有效值 ≥0.75 且零跨技能回归)—— 并需要交互式 `--approved-by`。
- `skills/laravel-dev/`、`skills/yaml-json-convert/` —— 该生命周期产出的前两个技能,各自在 `tests/skill-evals/` 下附带场景/预言机评测套件。
- `commands/` —— `/orchestrate <任务>`(完整流水线,可见路由 JSON)与 `/route <任务>`(仅预览计划,不执行)。
- `hooks/` —— **常驻路由,三个事件**:`SessionStart` 在会话启动时锚定路由指令(覆盖新建、恢复、清空与压缩会话);`UserPromptSubmit` 在每次输入时重新注入;`PreToolUse`(Agent 工具)对每次 glm 引擎分发执行分发契约检查(自包含消息、≤300 词、不内联文件正文 —— 非 zCoder 代理不受影响)。
- `tests/` —— 插件自身的回归与完整性套件(可移植、零 token):`skill-forge-static.sh`(静态完整性检查)、`skill-forge-smoke.sh`(针对每个脚本 CLI 的对抗性夹具,全部状态在 mktemp 沙箱中)、OHI 监控脚本、能力台账,以及预注册的触发用例表。

## 安装(ZCode)

1. 打开 ZCode → **Settings → Plugin Management → Discover** 标签页。
2. 在官方市场中找到 **zCoder**,点击 **Get**。
3. 保持启用 —— 插件 hooks 会自动启用 hook runner。

验证:`/` 菜单在 zCoder 下显示 `orchestrate` 与 `route`,且 **Settings → Subagents** 列出 `glm-vision`、`glm-turbo`、`glm-main`。

## 使用

- 常驻:插件启用后,zCoder 编排自动作用于每次会话 —— hooks 在会话启动时锚定路由、每次输入时重新注入、每次引擎分发时检查契约。无需手动调用。
- 显式:`/orchestrate implement this dashboard mockup and optimize the server fetch logic`。
- 仅预览:`/route refactor auth across 3 services and fix the CSV parser` → 输出子任务、引擎与力度表格,不执行。
- 技能生命周期:`/skill-scan` 检测缺失的技术栈技能;`/skill-evolve <skill>` 执行一轮可度量的改进。

## 模型 ID

默认值是 Z.ai GLM 目录中的模型代码:`glm-5.3-flash`(视觉/轻量)、`glm-5.3`(深度)。如果你的构建在模型选择器中列出不同名称,修改对应 `agents/*.md` 中的 `model:` 行并重启会话即可 —— 无需其他改动。

## 调优

- **思考力度** —— 通过 `agents/*.md` 中的 `thoughtLevel:` 按代理锁定。力度被拒绝是确定性且零 token 成本的:绝不重试。锁定在会话启动时生效;会话中途修改 `thoughtLevel:` 可能命中过期缓存。
- **视觉模型** —— 如果你的套餐提供了专用视觉模型,修改 `agents/glm-vision.md` 中的 `model:` 并重启会话。
- **关闭常驻路由注入**(保留 agents/commands):`touch ~/.zcode/zcoder.off`,或以 `GLM_ORCHESTRATOR_DISABLE=1` 启动 ZCode。删除该文件 / 取消该变量即可重新启用。
- **路由规则** —— 路由矩阵与分发规则位于 `skills/glm-orchestrator/SKILL.md`;在其中编辑即可调整优先级(例如让轻量通道替代深度引擎成为默认)。

## 依赖、副作用与安全

- **网络**:无。插件不发起任何出站请求,不捆绑 MCP 服务器。编排器分发的子代理使用 ZCode 自身的模型提供方。
- **模型/API 依赖**:引擎代理按 ID 引用 GLM 模型(`glm-5.3`、`glm-5.3-flash`),经由 ZCode 内置的 Z.ai 提供方访问。若套餐没有这些精确的模型 ID,按上文所述修改一行 `model:` 即可。
- **命令执行**:hooks 在会话启动、每次输入与 Agent 工具分发时运行本地 bash 脚本(`hooks/inject-routing.sh`)。它只读取 stdin 载荷并打印路由指令 —— 不写文件、不联网,且任一开关生效时立即退出。
- **文件写入**:运行 skill-forge 轮次(`/skill-evolve`)与 OHI 监控会**在你运行它们的项目**下的 `tests/skill-evals/` 与 `tests/` 中写入试验台账、晋升记录与日志。插件绝不写入当前项目与 `~/.zcode`(可选的 `zcoder.off` 开关文件)之外的位置。
- **不收集、不传输**任何凭据、遥测或分析数据。

## 健康定义(惨痛教训)

绿色的静态套件只能证明**文件彼此一致** —— 那不是系统健康。轻量通道曾经在整个生命周期内零成功分发,而每一轮都报告绿色,因为没有任何东西测量真实能力。健康现在是三重合取,并由静态检查强制:

1. **静态套件绿色**(配置一致)—— `tests/skill-forge-static.sh`;
2. **能力台账绿色** —— `tests/capability-ledger.json`:每个引擎显式为 VERIFIED-fresh / CONDITIONAL-routed-around / REMOVED;无静默默认、无僵尸通道;以及
3. **无生命周期告警** —— `tests/ohi-stats.py` 基于分发台账:0% 成功与多数失败的引擎报告 NEVER-WORKED / 移除或调查;连续失败被标记。

加上制度化的谦逊:每个 FULL 轮次运行一次对抗性**盲区扫描**(让一个引擎回答系统还看不见什么),因为盲区是猎出来的,不是清单查出来的。

## 许可与来源

MIT。反身性变异、尺寸上限、增长上限、会话挖掘、Pareto 前沿、分阶段小批量与触发/描述演化模式移植自 [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)(MIT)。其 AGPL 达尔文进化器被刻意未移植,其 DSPy/GEPA LLM 评审机制被重新实现为确定性预言机(评审的意见不是测量)。
