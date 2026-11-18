# Advisor Mode for Zcode

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

面向 ZCode 的双层工程工作流。Advisor Mode 将高推理能力的前沿顾问与审阅者,和跟随会话模型的快速执行者配对使用,并内建极简工程、洁净文风、行动优先沟通与界面工艺标准。硬性生命周期门禁在工具层强制执行该工作流,即使会话模型忘记规则,纪律依然有效。

## 架构

插件在会话启动时根据会话模型标识判定角色,并据此切换行为。

### 1. 执行者会话(快速模型)

当会话运行在快速模型层级时,会话充当执行者,并必须在三个强制门禁处咨询 `advisor-reviewer` 子代理(前沿模型):

- **架构、规划与任务前门禁**:在规划或设计产品、系统、架构、规格或路线图时触发,也在多文件或敏感编辑之前触发。在顾问验证计划之前,钩子会拒绝第二个不同文件的编辑。
- **两连败熔断器**:同一条命令以归一化的相同签名失败两次时触发(忽略时间戳、哈希和计数)。在咨询顾问之前,命令与编辑保持封锁。
- **强制最终审阅门禁**:任务可以停止之前,每个被修改的文件都需要一份已批准的顾问审阅,其记录的 SHA-256 哈希仍与磁盘上的文件一致。Stop 钩子最多两次强制会话返回工作,之后若审阅仍缺失则明确警告。

### 2. 顾问会话(前沿模型)

当会话运行在前沿模型层级时,会话直接充当架构师、顾问和最终审阅者。它把实现工作委托给 `flash-executor` 子代理,并在关闭任务之前审计差异和命令退出码。

## 模型选择与未来模型

- `flash-executor` 使用 `model: inherit`,因此始终运行在用户为会话选择的模型上。切换会话模型是让执行者迁移到新版本所需的唯一步骤。
- `advisor-reviewer` 在其代理文件的单行 `model:` 上固定前沿模型,因为 ZCode 从代理定义解析子代理模型。该行通过 `$` 后缀携带显式推理档位(例如 `model: account:<plan>/GLM-5.3$max`);ZCode 会拒绝缺少推理档位的固定推理模型。新前沿模型发布时,这一行就是全部迁移工作。
- 角色检测将会话模型标识与 `advisor-config.json` 中可配置的模式匹配(先检查执行者模式,未知模型回退为执行者)。

## 内建工艺标准

插件向每个会话注入四条不可协商的纪律:

1. **极简工程**:先理解后精简、七级简化阶梯、外科手术式编辑、根因修复、先失败后通过的验收检查。
2. **洁净文风**:主动语态、具体主语、无填充短语、零长划线。
3. **行动优先认知工效**:第一行给出答案或行动、有界步骤、错误严格按原因与修复报告。
4. **界面方向**:优先本地品牌令牌与调色板,不加载未经批准的 CDN 资源。

## 安装

要求:支持插件的 ZCode,以及 PATH 上可用的 `node` 运行时(钩子运行一个小型 Node 脚本)。

从 ZCode 插件市场安装。安装后开始新会话:SessionStart 钩子会通告检测到的角色和已启用的门禁。要运行快速层执行者工作流,请选择 flash 会话模型;要以架构师身份运行,请选择前沿会话模型。

## 配置

设置保存在已安装插件目录内的 `advisor-config.json`:

```json
{
  "enabled": true,
  "roles": {
    "unknownModelRole": "executor",
    "advisor": {
      "label": "Frontier Advisor",
      "agentName": "advisor-reviewer",
      "uiModelPatterns": ["glm-5.3"]
    },
    "executor": {
      "label": "Fast Executor",
      "agentName": "flash-executor",
      "uiModelPatterns": ["flash"]
    }
  },
  "gates": {
    "planBeforeComplexTask": true,
    "maxConsecutiveFailures": 2,
    "mandatoryFinalReview": true,
    "maxStopContinuations": 2
  },
  "defaults": {
    "simplicityIntensity": "full",
    "actionFirstOutput": true
  }
}
```

## 副作用与依赖

- 运行时要求:PATH 上可用的 `node` 可执行文件。六个生命周期钩子各运行一个小型 Node 脚本(每个 10 秒超时);它们从 stdin 读取 JSON 负载,并把状态写入 ZCode 插件数据目录。
- 文件写入:仅在插件数据目录内写入按会话的状态文件和错误日志。钩子绝不写入项目文件。
- 命令执行:`advisor-reviewer` 代理可以运行只读验证命令,例如 `git status` 和 `git diff`;`flash-executor` 代理运行其任务所需的命令。
- 模型与服务依赖:使用 ZCode 会话模型,以及通过用户自己配置的 Z.ai 账户解析的一个固定前沿模型。无其他网络访问,无 MCP 服务器,无第三方代码、资产或服务。

## 生命周期钩子

插件在六个 ZCode 事件上注册钩子:

| 事件 | 用途 |
| --- | --- |
| `SessionStart` | 从模型标识检测会话角色,注入门禁指令与工艺标准 |
| `UserPromptSubmit` | 熔断器激活期间注入警告 |
| `PreToolUse` | 熔断器触发期间拒绝命令与编辑;无已批准计划时拒绝多文件编辑 |
| `PostToolUse` | 跟踪失败签名、记录文件哈希、捕获顾问裁决 |
| `PostToolUseFailure` | 统计通过失败事件上报的命令失败 |
| `Stop` | 以哈希验证强制最终审阅,缺失时强制继续 |

## 插件结构

- `.zcode-plugin/plugin.json`:插件清单。
- `hooks/hooks.json`:钩子定义。
- `scripts/advisor-hook.mjs`:跨平台 Node.js 生命周期钩子运行器与门禁验证器。
- `tests/advisor-hook.test.mjs`:覆盖角色、门禁、签名与哈希验证的自动化测试套件。
- `rules/craft.md`:会话启动时注入的工艺标准。
- `agents/advisor-reviewer.md`:前沿顾问、架构师与审阅者代理。
- `agents/flash-executor.md`:快速执行者代理。
- `skills/advisor-mode/SKILL.md`:配置技能。

## 测试钩子

```bash
# 运行单元与集成测试套件
node --test tests/advisor-hook.test.mjs

# 干运行会话启动钩子(stdin 传入负载)
echo '{"session_id":"demo","source":"startup","model":"your-session-model-id"}' | node ./scripts/advisor-hook.mjs SessionStart
```

## 作者与开发者

由 **Gianluca Iannotta** 创建并维护。源码仓库:https://github.com/jannotix/advisor-mode-for-zcode

## 许可证

本项目基于 Apache License, Version 2.0 授权。详情见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE) 文件。

## 免责声明

Advisor Mode for Zcode 是由 Gianluca Iannotta 创建并维护的独立开源项目。它与 Z.ai 及 ZCode 团队无隶属、背书、赞助或官方关联。所有产品与公司名称均为其各自持有者的商标或注册商标;它们的使用不表示任何隶属或背书。
