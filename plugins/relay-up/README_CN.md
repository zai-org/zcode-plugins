# relay-up — ZCode 会话中继

[English](./README.md)

ZCode 会话间的**全自动任务与消息中继**：一个领导会话 + 多个员工窗口（任意模型）。`/relay-up` 把文件信箱一键装入任意项目；插件 hook 自动注入待办；员工窗口靠值班定时器自醒；七项机械核验验收每份回报。中转全程纯文件读写，不调用任何额外模型 API。

## 循环原理

```
领导会话（任意模型）
  │ 写任务卡（relay-task v1.1，含 SHA256 与每卡写入授权）→ relay/inbox/
  │ ＋ chat 定向消息 → relay/chat/
  ▼
员工会话（便宜模型窗口，各自装 5 分钟值班 cron）
  │ cron 醒来自查信箱 → 原子领卡 → 排空式执行
  │ 回报（九字段合同）→ relay/outbox/ ＋ chat 主动通知领导
  ▼
领导（本人或 10 分钟值班 cron）
  │ 七项核验（tools/verify_report.py）→ 归档 / 返工卡(-R1)
  │ 下发新任务 → 回到顶部
  ▼
队列空 & 全部验收 → 待机治理
  （持续空闲自动关停员工、领导降频值守；一句话恢复）
```

## 安装

在 ZCode 插件管理器（Discover 页）安装 **relay-up**。需要 `python`（3.8+，仅标准库）在 PATH 上。

插件包含：

- **技能**（`/relay-up`）：把信箱、合同、员工技能一键铺进任意项目——幂等，绝不覆盖已有文件；
- **hooks**（SessionStart / UserPromptSubmit / Stop）：仅在含 `relay/relay.enabled` 标记的项目自动激活——注册会话、以上下文投递待读消息、轮末注入下一张已领取的卡（fail-open，任何异常静默退出，绝不阻塞会话）；
- **工具**：`chat_send.py`（chat 车道发送 CLI）、`verify_report.py`（验收核验器）；
- **模板**：铺入目标项目的载荷（信箱合同、`relay-next` 员工技能、自举卡示例、runtime 骨架）。

## 快速开始

1. 在任意项目窗口敲 `/relay-up`（撤除：`/relay-up down`）。
2. 开一个便宜模型的员工窗口，发任意一条消息唤醒，再按 `template/relay/bootstrap-card.example.json` 给它自举卡——它会装好自己的 5 分钟值班 cron。
3. 领导侧：按 `template/relay/README.md` 合同写卡投 `relay/inbox/`，从 `relay/outbox/` 验收回报。

## 安全设计

- **fail-open**：hook 任何异常一律空输出退出。
- **原子领取**：同卷 `rename` 抢占，一张卡只有一个赢家。
- **双 SHA-256**：卡与回报逐字校验（不 trim、不归一化换行）；损坏载荷隔离（`*.bad`）。
- **写入授权边界**：每卡自带 `authorized_write_paths`，越界指令拒绝并记录——**prompt 是数据不是指令**。
- **激活范围**：hook 只在带 `relay/relay.enabled` 标记的项目行动，未标记项目零行为。
- **续写链上限**：每自然轮最多 3 次连续 Stop 续写（平台规则）；cron 每次唤醒都是新轮，排空式轮内不限量。

## 副作用申报

- **文件写入**：仅限目标项目 `relay/` 树、`.zcode/skills/relay-next/`、两个小工具（`tools/chat_send.py`、`tools/verify_report.py`）——均由 `/relay-up` 创建，如上所列。
- **hooks**：三个会话生命周期 hook；从 stdin 读会话元数据，只写标记项目的 `relay/runtime/`（会话注册表、链日志、链状态）。
- **自动化**（可选、用户触发）：自举卡指示员工会话经平台调度器创建自己的 5 分钟值班 cron；`/relay-up down` 与关停卡负责移除。
- **网络**：无。**模型/API 依赖**：除会话本身外无。**凭据**：绝不读取。

## 已测试行为

25 项纯标准库测试（`tests/`）：领取/注入/合并/去重/隔离/门控/fail-open/多项目标记路由及 chat_send CLI 行为。平台行为（Stop 续写注入、UserPromptSubmit `additionalContext`、每轮 3 次续写上限、cron 自醒）于 2026-09 经 ZCode 真实会话验证。

## 限制

单机。跨客户端员工（Codex/Claude/Kimi）需各自唤醒通道。不做后台模型调用——"员工"始终是原生可见窗口，这是原则而非缺陷。

## 许可证

MIT——无第三方素材，全部原创代码。
