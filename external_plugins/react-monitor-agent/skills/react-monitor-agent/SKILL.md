---
name: react-monitor-agent
description: Install, run and troubleshoot React-Monitor-Agent (rma), a human-agent operation board of review replay + checkpoints — zero-dependency Node event service on 127.0.0.1:8790 plus React board on localhost:5173 with an offline FIXTURE demo mode. Use when the user says "装 react-monitor-agent", "把 rma 操作板跑起来", "review replay board", "审查回放操作板", or wants to try the board locally.
---

# React-Monitor-Agent (rma) — install / run / troubleshoot

rma 是人机协作操作板：agent 把工作过程写成结构化时间线（审查回放），人在关键帧（检查点：方案/阶段/风险/完工）上拍板。本 skill 是**安装壳**——引导你把 GitHub 主仓克隆到用户机器并跑起来；产品源码不内嵌在本插件里，永远以主仓为准。

## 前置要求（先逐项确认，缺了先向用户报告再动手）

- Node **>= 20**（`node -v`；core 的 engines 硬要求）
- git 可用
- 端口 **8790**（core）与 **5173**（board）空闲：`lsof -i :8790 -i :5173` 无占用
- 两个终端窗口/面板（core 与 board 各一个，都是常驻 dev 进程）

## 安装并跑起来

1. **克隆主仓**（装到用户指定的目录；用户没说就先问，或用其惯用 projects 目录）：

   ```bash
   git clone https://github.com/Lumos-789/react-monitor-agent.git
   ```

2. **起 rma-core**（零运行时依赖的 Node 服务，监听 `127.0.0.1:8790`，事件数据存 `~/.rma/`）：

   ```bash
   cd react-monitor-agent/core
   npm ci
   npm run dev
   ```

   数据目录为空时自动灌入演示 fixture（`RMA_NO_SEED=1` 可关）；`RMA_HOME` 可改数据目录，`RMA_PORT` 可改端口。

3. **起 rma-board**（React 操作板，监听 `localhost:5173`）：

   ```bash
   cd react-monitor-agent/app
   npm ci
   npm run dev
   ```

4. **验证**（全部满足才算装好）：

   ```bash
   curl http://127.0.0.1:8790/api/health   # core 存活
   ```

   - 打开 http://localhost:5173 能看到操作板；
   - 前端**默认 FIXTURE 离线演示模式**（无需 core 即可浏览内置示例工程，回放里的检查点决策可真实点击）；
   - 要连真 core：`cd app && VITE_RMA_MODE=live npm run dev`（看板顶部徽章标注当前模式：「演示数据」=FIXTURE 离线，「实时数据」=已连真 core）。

## 配置项一览

| 环境变量 | 作用端 | 默认 | 说明 |
|---|---|---|---|
| `RMA_PORT` | core | `8790` | 服务端口 |
| `RMA_HOME` | core | `~/.rma` | 事件数据目录 |
| `RMA_NO_SEED` | core | 未设 | 设 `1` 则空目录不灌演示 fixture |
| `RMA_SEED_FIXTURE` | core | 内置 | 指定自定义 fixture 路径 |
| `VITE_RMA_MODE` | board | fixture | 设 `live` 连接真 core |

## 排障

- **`EADDRINUSE` / 端口占用**：`lsof -i :8790`（或 5173）找到进程；core 可用 `RMA_PORT=` 换端口，board 必须**保持在 5173**（core CORS 白名单只放行 localhost:5173；board dev 开了 strictPort，5173 被占会直接报错退出、不会静默换端口），先腾出 5173 再起。
- **board live 模式连不上 core**：先 `curl http://127.0.0.1:8790/api/health` 确认 core 活着；core 没起或被 `RMA_PORT` 改过端口都会导致连不上。
- **`npm ci` 报 engines / 语法错误**：`node -v` 低于 20 → 升级 Node，不在仓内改 engines。
- **改完代码自检**（对齐主仓 README 的验证口径）：`cd core && npm test` 全绿；`cd app && npm run build` 通过。
- 其余问题去主仓 README/issue 查，不在本插件里猜。

## 边界

- 本 skill 只负责装、跑、排障；产品功能（检查点决策、回放交互、事件接入）以主仓 README 与代码为准。
- 两个 dev 进程都是前台常驻，退出即停；没有装系统服务的步骤，别替用户加。
