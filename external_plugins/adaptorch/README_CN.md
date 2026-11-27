# AdaptOrch ZCode 插件

将 ZCode 连接到 [AdaptOrch](https://adaptorch.com) 远程 MCP 服务（`adaptorch-mcp==0.6.3`），为编码任务提供 DAG 拓扑路由、多模型输出合成、有界生成观测与可验证执行回执。

## 依赖与网络访问说明

- 需要系统 `PATH` 中已安装 [`uv`](https://docs.astral.sh/uv/)（`uvx`），用于通过 stdio 启动 PyPI 发布的 `adaptorch-mcp==0.6.3`。
- 通过 HTTPS 连接至 `https://adaptorch.com/mcp`，需在环境变量中配置 `ADAPTORCH_CONTROL_PLANE_TOKEN`（可在 [adaptorch.com/app/api-keys](https://adaptorch.com/app/api-keys) 获取）。
- 如需执行模型调用（BYOK），请在宿主环境变量中配置 `ADAPTORCH_MCP_PROVIDER`、`ADAPTORCH_MCP_PROVIDER_MODEL` 与 `ADAPTORCH_MCP_PROVIDER_API_KEY`。凭证仅在提交运行时通过请求头转发，错误日志自动脱敏。
- 不包含本地 Hook，不读写工作区外私有文件，无隐藏遥测。

## 相关链接

- 官网与 Three.js OFF vs ON 实时对比 / 基准数据：https://adaptorch.com/#proof
- MCP 配置文档：https://adaptorch.com/mcp-docs
- 公开客户端仓库：https://github.com/dmae97/Adaptorch-MCP（Proprietary, ClassicMate）
- 论文：https://arxiv.org/abs/2602.16873
