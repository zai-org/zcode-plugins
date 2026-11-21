# oh-my-zcode-slim

面向 **ZCode** 的 [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim) 等价多智能体编排套件。它把 ZCode 主会话智能体变成一位 orchestrator（调度者），将工作委派给专家子代理——在质量、速度与成本之间取得平衡——并为高风险决策提供可配置的多模型议会（council），同时附带 OMOS 的工作流技能。

所有与机器相关的部分（模型提供方、MCP 服务、议会席位）都**由你自行配置**——插件本身只包含在任何环境都可用的内容。

## 致谢

本套件移植自 **[@alvinunreal](https://github.com/alvinunreal)** 的 **[oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)**（[ohmyopencodeslim.com](https://ohmyopencodeslim.com)）。专家阵容与代理提示词、编排守则及其路由表、以及各技能均基于其 MIT 许可的作品改编。ZCode 专属部分（插件打包、配置脚本、移植笔记）为本插件自有。详见 [LICENSE](LICENSE) 与[上游项目](https://github.com/alvinunreal/oh-my-opencode-slim)。

## 套件内容

| 层 | 内容 |
|---|---|
| **代理**（7 个） | `coder`、`explorer`、`librarian`、`oracle`、`designer`、`observer`、`council` |
| **技能**（6 个） | `simplify`（自动挂载到 oracle）、`verification-planning`、`deepwork`、`clonedeps`、`worktrees`、`reflect` |
| **命令**（2 个） | `/deepwork`、`/reflect` |
| **调度守则**（`doctrine/AGENTS.md` → `~/.zcode/AGENTS.md`） | orchestrator 角色、路由表、委派机制、席位无关的议会协议 |
| **议会席位**（由你配置） | 用 `scripts/add-councillor.sh` 生成的 `councillor-*` 代理——可以使用你拥有的任意模型 |

默认模型固定使用内置引用（`custom:builtin%3Azai-coding-plan:GLM-5.3` / `GLM-5.3-Flash`），任何完成 z.ai 认证的 ZCode 会话均可使用。内置代理**不声明任何 MCP 服务**——参见 [MCP 配置](#mcp-配置)。

## 安装

1. **插件**：在 ZCode 插件管理器中从市场安装并启用 `oh-my-zcode-slim`。插件目录（含下述脚本）会落在插件安装缓存中；也可以克隆 [GitHub 仓库](https://github.com/MartijnDekkers/oh-my-zcode-slim)并将其作为市场源。
2. **调度守则**：在插件目录中运行 `./install-doctrine.sh`。插件无法直接提供 AGENTS.md，因此该文件需单独安装到 `~/.zcode/AGENTS.md`（已有文件会备份为 `.bak`）。守则负责把会话智能体变成 orchestrator——没有它，你只有专家代理而没有路由调度。
3. **议会席位**（推荐）：见下一节。
4. 重启 ZCode 会话——代理、技能、命令与 AGENTS.md 均在会话启动时加载。

## 配置你的议会

议会就是你的会话中存在的所有 `councillor-*` 代理。orchestrator 会把同一个问题并行派发给每一个席位；`council` 代理随后综合出结构化的共识报告（共识水平、一致/分歧点、建议）。

在插件目录中运行：

```bash
./scripts/list-models.sh                                  # 列出在你的机器上被证实可用的模型引用
./scripts/add-councillor.sh glm53 'custom:builtin%3Azai-coding-plan:GLM-5.3'
./scripts/add-councillor.sh mymodel 'custom:<provider>:<model>'
./scripts/remove-councillor.sh mymodel
```

席位写入用户级（`~/.zcode/agents/`）；加上 `--workspace <path>` 则写入项目级，实现按仓库定制议会。两个及以上席位即可启用议会；不足两个时，守则会明确报告"议会未配置"，绝不伪造共识。多样性是议会的价值所在——不同提供方/模型的席位才有意义。

**模型固定规则**（完整踩坑记录见 `docs/LESSONS.md`）：格式为 `custom:<provider-id>:<model-id>`，区分大小写；错误的引用会在派发时 loudly 失败——这是设计使然，添加席位后请逐一 ping 验证。在远程（SSH）会话中，自定义提供方会以 UUID 形式物化，而非显示名称；`list-models.sh` 输出的是在你的机器上真正可解析的引用。

## 覆盖内置代理

用户级（`~/.zcode/agents/`）或工作区级（`<repo>/.zcode/agents/`）的同名代理优先于插件代理。把代理文件复制出来，修改 `model` 固定或提示词，你的副本即生效——这也是维护项目级变体的方式。

## MCP 配置

代理可以在 frontmatter 中声明 `mcpServers`，但**列出的每个服务在派发时必须处于已连接状态，否则代理拒绝启动**。因此内置代理一律不声明。为代理接入你的服务：

```bash
./scripts/enable-mcp.sh explorer Terraform codegraph "MS Learn"
```

该命令会把插件代理复制到用户级并添加 `mcpServers` 行（若已有用户副本则就地修改，并做一次性备份）。也可以不接 MCP，让拥有全部服务的 orchestrator 自行检索，再把结果粘贴进委派提示。

## 副作用、权限与依赖

按市场贡献规则要求披露：

- **文件写入**：`coder` 与 `designer` 代理可在其被委派的范围内编辑、创建工作区文件。`install-doctrine.sh` 写入 `~/.zcode/AGENTS.md`（先备份 `.bak`）。席位/MCP 脚本写入 `~/.zcode/agents/`，加 `--workspace` 时写入对应项目的 `.zcode/agents/`。`worktrees`/`clonedeps` 技能被调用时写入项目的 `.slim/` 目录。
- **命令执行**：代理可在各自工具白名单内执行 shell 命令（`coder`、`designer`：任务授权时的构建/测试命令；只读代理：仅非变更性诊断）。脚本为纯 bash，依赖 `git`/`sqlite3`/`jq`。
- **网络访问**：插件自身不发起任何网络请求。`librarian` 代理被派发时会使用网络搜索/抓取做文档调研。用户自行接入的 MCP 服务（可选）访问其各自定义的端点。
- **模型/API 依赖**：默认固定使用已认证 ZCode 会话可用的内置 z.ai coding-plan 提供方；议会席位使用你配置的任意模型。插件本身不携带也不需要任何 API key。
- **Hooks / MCP 服务**：不含。
- **第三方材料**：提示词、守则与技能改编自 [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim)（MIT），见上文致谢与 [LICENSE](LICENSE)。

## 冒烟测试

在全新会话中执行：

1. 子代理列表显示 7 个插件代理及你的 `councillor-*` 席位。
2. 向每个议会席位发送简单 ping；失败信息会指明未解析的提供方/模型。
3. 让 coder 做样式修改（它会拒绝并指向 designer）；问 explorer "where is X"（返回 file:line 列表）；发起一次议会提问（结构化报告）；确认 oracle 加载 `simplify`。
4. 代码侦察类问题派发给 `@explorer`，绝不使用内置 `Explore`。
5. `/deepwork` 与 `/reflect` 出现在 `/` 菜单中。

## 远程（SSH）环境

桌面端连接远程工作区时，所有状态都在远程主机上：请在远程（SSH 会话内）运行脚本；市场请用 git URL 添加而非本地目录；议会席位请以远程主机上 `list-models.sh` 的输出为准——自定义提供方在远程会以每台机器不同的 UUID 物化。细节与排障记录见 `docs/LESSONS.md`。

## 源码与问题反馈

开发在 [MartijnDekkers/oh-my-zcode-slim](https://github.com/MartijnDekkers/oh-my-zcode-slim) 进行，版本发布也在该仓库打标签。
