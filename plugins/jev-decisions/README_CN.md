# jev-decisions

基于 [TypeSafe Jev](https://docs.typesafe.ai) 与社区版 [jev-mcp](https://github.com/jkudish/jev-mcp) 服务，为 ZCode 智能体提供校准判断工具。

## 功能

- 声明一个 `jev` MCP 服务（默认禁用），暴露十一个判断工具：`jev_verify`、`jev_screen`、`jev_noul`、`jev_find`、`jev_rerank`、`jev_classify`、`jev_decide`、`jev_compare`、`jev_extract`、`jev_review`、`jev_gate`。
- 内置 `jev-judgment` Skill，教会智能体何时应调用判断工具、而不是凭自己的阅读直接作答——内容改编自 `@jkudish/jev-mcp` 包内的官方 Skill。

典型场景：外部获取或粘贴的文本进入上下文前先筛查、对照引用证据核实结论、按共享类目批量分类工单、在实现方案间择优、宣布任务完成前审查 diff、把"测试已通过"的声明与真实测试输出对账。

## 安装与启用

1. 安装插件后，在 ZCode 中打开插件设置。
2. 在 `TypeSafe API key` 字段填入你的 TypeSafe 控制台 API key。
3. 启用 `jev` MCP 服务（默认禁用），然后开启新会话。
4. 让智能体筛查一段不可信文本或核实一条声明；出现判断类任务时 Skill 会自动触发。

## 网络访问、依赖与副作用

- 启用后，服务通过 `npx -y @jkudish/jev-mcp@0.10.0` 启动：Node 首次运行会从 npm registry 下载该包及其依赖。版本已固定，升级请谨慎操作。
- 每次工具调用都会把输入文本发送到 TypeSafe Jev API（可通过服务自身配置切换到其他 Jev 兼容提供方）。输入会离开本机——除非策略允许，请勿发送密钥或私有源码。
- TypeSafe API 按 key 所属账户的输入 token 计费；每次成功调用都会返回 token 用量。
- 本插件不写文件、不注册 Hook，除 MCP 服务进程本身外不执行任何命令。

## 第三方组件

| 组件 | 许可证 | 来源 |
| --- | --- | --- |
| `@jkudish/jev-mcp` | MIT | https://github.com/jkudish/jev-mcp |
| `jev-judgment` Skill | 改编自 `@jkudish/jev-mcp` 内 `skills/jev`（MIT） | [上游 Skill](https://github.com/jkudish/jev-mcp/blob/main/skills/jev/SKILL.md) |
| TypeSafe Jev API | 商业服务 | https://docs.typesafe.ai |

本插件自身采用 MIT 许可证。
