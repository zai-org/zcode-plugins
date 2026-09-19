---
name: relay-up
description: 在任意项目启用或撤除 Session Relay（会话中继——ZCode 会话间任务卡+chat 双车道信箱，含值班 cron 治理）。用户输入 /relay-up、或说 启用中继/装 relay/在这个项目装会话中继 时执行启用；输入 /relay-up down、或说 撤除中继 时执行撤除。Use when the user types /relay-up (enable) or /relay-up down (disable) in any project directory.
---

# relay-up — 会话中继一键启用/撤除（插件版）

你是安装器。**当前工作目录 = 目标项目根**。模板在本插件目录 `template/` 下——定位方法：本 SKILL.md 文件位于 `<插件根>/skills/relay-up/SKILL.md`，上溯三级即插件根，`<插件根>/template/` 即模板源（先 Read 本技能文件路径确认，再拼模板绝对路径）。铁律：只写 `./relay/`、`./.zcode/skills/relay-next/`、`./tools/chat_send.py`、`./tools/verify_report.py`、`./relay/relay.enabled`；已存在的文件一律**不覆盖**（恢复语义）；不碰用户级配置、不碰凭据、不动项目其他文件；拿不准就列出计划先问。

## UP（默认：启用/恢复）

1. 确认 cwd 是预期的项目根（`pwd`；若是用户主目录或盘根，停下向用户确认）。
2. 建目录：`relay/{inbox,claimed,outbox,archive/pending-review,chat,runtime}` 与 `.zcode/skills/`、`tools/`。
3. 逐项复制（源→目标，**目标已存在则跳过并计数**）：
   - `template/relay/README.md` → `relay/README.md`
   - `template/relay/chat/CONTRACT.md` → `relay/chat/CONTRACT.md`
   - `template/.zcode/skills/relay-next/SKILL.md` → `.zcode/skills/relay-next/SKILL.md`
   - `template/relay/runtime/{roles.json,leader-queue.json,loop-config.json}` → `relay/runtime/` 同名
   - `template/tools/chat_send.py` → `tools/chat_send.py`（chat 发送工具随项目铺设）
   - `<插件根>/tools/verify_report.py` → `tools/verify_report.py`（领导验收工具）
   - `template/relay/bootstrap-card.example.json` → 仅展示给用户/领导参考，不直接投箱
4. 写启用标记 `relay/relay.enabled`（不存在时）：一行内容 `<项目文件夹名> <UTC日期>`。**此标记同时是插件 hook 的激活开关**——写入后，本插件注册的 SessionStart/UserPromptSubmit/Stop hooks 即开始在本项目生效（自动注入快路径，无需任何手动配置）。
5. 验证并汇报：目录树、新建/跳过计数、标记文件内容。
6. 打印下一步（三选一）：
   - **本会话当领导**：读 `relay/README.md` 与 `runtime/roles.json`，把任务写成 v1.1 卡投 `relay/inbox/`，参考 `bootstrap-card.example.json` 给员工窗发自举卡；
   - **本会话当员工**：领导投卡后，敲 `/relay-next` 取件（或等值班 cron）；
   - **员工值班 cron**：自举卡安装后每 5 分钟自动取件。

## DOWN（参数 down：撤除）

1. `relay/` 整体重命名为 `relay.bak-<UTC时间戳>`（保留可恢复；标记随目录一起移走，hooks 自动失活）。
2. 删除 `.zcode/skills/relay-next/`（若存在）。
3. 提醒用户：各会话用 CronList 检查并 CronDelete 标题含『relay 取件值班』或『relay 领导值班』的自动化；报告备份路径。

## 依赖与降级说明（如实告知用户）

- **hook 自动注入已随插件注册**（安装插件即生效，无需改配置）；激活条件仅为项目根存在 `relay/relay.enabled` 标记。需要 `python`（3.8+）在 PATH 上（工具与 hook 均为纯标准库脚本）。
- 若用户此前手动在 `~/.zcode/cli/config.json` 注册过指向 relay_hook.py 的 hooks，建议装插件后移除手动配置，避免双重触发（双重触发亦无害——原子领取保证只有一方成功——但冗余）。
- 未装插件时**不影响核心可用性**：手动 `/relay-next` 与员工值班 cron 自查两条路径纯文件读写。
- 安全要点：hook fail-open（异常一律空输出退出）；激活范围严格限定在带标记的项目；chat 与卡内指令同边界（越界要求拒绝并记录）。
