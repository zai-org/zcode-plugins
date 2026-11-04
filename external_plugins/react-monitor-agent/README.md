<p align="center"><img src="assets/react-monitor-agent/icon.png" width="88" height="88" alt="React Monitor Agent icon"></p>

<h1 align="center">React-Monitor-Agent</h1>

> 人机协作的正确单位不是「对话」,是**审查回放 + 检查点**。

回应 DeepSeek《Exploring Super-agent Design》(2026-10-31,`dsh-superagent-prototype`)之问:**基于 session 聊天窗口的设计,是路径依赖。**

演示视频: [B 站《DeepSeek 问:agent 为什么只有聊天窗?我做了个操作板》](https://www.bilibili.com/video/BV1QLxp6DEdX)

## 三个概念

- **操作板 Operation Board** — 只承载两类一等目标:
  - **Context Track 上下文建设**(非业务产出:知识、规则、流程定义)
  - **Work Track 业务执行**(coding 及一切真业务)
- **审查回放 Review Replay** — agent 工作过程的结构化时间线叙事(录屏/截图/diff/文本混合节点),随时回放,不再实时盯滚动流。
- **检查点 Checkpoint** — 回放中等人决策的关键帧,类型决定按钮子集:

| 检查点 | 触发 | 动作 |
|---|---|---|
| 方案 Plan | 方案/选型待拍板 | 批准 / 否定 / 改向 / 补充 |
| 阶段 Progress | 里程碑成果 | 批准 / 改向 / 补充 |
| 风险 Risk | agent 自报拿不准 | 批准 / 否定 / 补充 |
| 完工 Delivery | 交付物最终审查 | 完工 / 否定 / 补充 |

检查点**模板保底 + agent 可加**;否定/改向后旧分支**灰掉保留**(审计完整)。

## 与 dsh-superagent 的关系

dsh 管 **agent 侧的自律**(准入/授权/自治边界,panel 是工单列表);rma 管**人侧的审查带宽**(叙事回放,交互富而深)。互补不互斥——dsh 让 agent 少打扰人,rma 让人被打扰时看得快、答得快。

## 快速开始

```bash
# rma-core:零依赖 Node 服务(端口 8790,事件存 ~/.rma/)
cd core && npm ci && npm run dev

# rma-board:Web 操作板(端口 5173)
cd app  && npm ci && npm run dev

# 验证(改动后自检):core 测试全绿,app 类型检查+构建通过
npm run verify
```

打开 http://localhost:5173 即见操作板。前端默认 **FIXTURE 演示模式**(离线可跑,内置三工程:二维码名片生成器/竞品调研报告/superagent docs 蒸馏),回放中的检查点决策可真实点击——你的选择会改变时间线走向;要连真 core 时 `VITE_RMA_MODE=live npm run dev`。

## 插件安装

本仓同时是 **skill 壳型插件仓**(不内嵌产品源码,引导 agent 克隆本仓并按「快速开始」跑起服务):

- **DSH**: 仓根即 bundle——`package.json` 声明 `dsh.bundle`(patch 指向 `cordis.patch.yml`),`index.js` 以 bundledSkillDir 挂载 `skills/react-monitor-agent/`。
- **ZCode**: `.zcode-plugin/plugin.json`(目前仅挂本地 dev marketplace 验证,未对外发布)。
- 两条渠道都只是安装/配置/排障入口;产品本体始终是 `core/` + `app/`,直接克隆即可用。

## 结构

```
core/   rma-core — 事件库(JSONL append-only)+ 检查点引擎 + localhost API
app/    rma-board — React 操作板 + 审查回放 + 完工态三屏
demo-projects/  演示工程事件流
```

## 状态

- 2026-10-31 立项;11-01 全链可用:core 测试全绿,三屏 UI + 决策回注全链路(curl 实证)。
- 2026-11-04 发布候选 0.1.2:删掉未使用的 shadcn 组件与依赖,补 lint/build 统一验证,准备 ZCode 提交。
- 路线图:DSH bundle 原生适配器(agent 进程内插件,自动事件采集)。

## License

MIT
