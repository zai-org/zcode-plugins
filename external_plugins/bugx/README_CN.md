# BugX

面向 ZCode 的自主代码审查与测试智能体插件，提供专用审计 Agent、ZCode 工作流 Skill 与 MCP Server 桥接，排查代码隐藏 Bug，驱动测试与质量守门。

## 包含组件

- **Agents（`agents/`）**：`bugx`（审计主协调器）与 `bugx-worker`（并发审计 Worker）。
- **Skills（`skills/`）**：`bugx` 与 `bugx-zcode` 审计流程 Skill。
- **MCP Server（`.mcp.json`）**：通过 stdio 将 ZCode 接入本地 `bugx mcp serve --root ${ZCODE_PROJECT_DIR}`。

## 前置依赖

启用本插件前，请先在本机安装 `bugx-cli`（`>=0.1.6`）：

```bash
# Python (>=3.11)
pip install bugx-cli

# 或 Node.js (>=18)
npm install -g bugx-cli
```

验证安装：

```bash
bugx --version
```

## 权限、网络与副作用说明

- **命令执行**：通过 stdio 启动本地 `bugx mcp serve` 进程，并在当前工作区执行静态分析与可复现 PoC 验证命令。
- **文件写入**：在被审计项目根目录下读写 `.bugx/` 目录，用于持久化代码覆盖账本、检查点与验证证据。
- **网络访问**：本地审计过程不上传源码；可选的云同步与脱敏心跳可通过环境变量 `BUGX_TELEMETRY_ENABLED=0` 或 `bugx config set telemetry.data_sharing false` 彻底关闭。
- **模型与凭据**：完全复用 ZCode 宿主自身已配置的模型，本插件不索取或保存额外 API Key。

## 来源与许可证

- 本插件目录内的清单、Agent、Skill 与图标素材均由 BugX（https://bugx.dev）原创维护，采用 MIT 许可证。
- 外部依赖引擎 `bugx-cli` 通过 PyPI / npm 独立分发，采用 BUSL-1.1 许可证。
