# ZCode 百智云浏览器插件

[English](./README.md)

连接百智云浏览器 MCP，查询凭据并管理浏览器资源。本社区插件与百智 Agent Toolkit 是不同服务。插件本身不能操作网页，也不会替换 ZCode 的内置浏览器；操作页面需要另行配置兼容的 CDP 客户端。

## 使用

1. 在 ZCode 安装并启用插件，打开「设置 → 插件 → Baizhi Cloud Browser → 高级信息 → 配置」，将 `Capy API Key` 填为自己的百智云浏览器 API Key 原文并保存，不要加 `Bearer`；连接器会构造授权请求头。
2. 如有需要，重启会话；确认服务和 `browser_auth_check` 工具出现，要求 Agent 调用该 MCP 工具检查当前账户，出现提示时确认本次工具调用。`browser_pricing` 可查询当前价格，不启动浏览器。
3. 确需使用浏览器运行时先核对费用，再使用稳定唯一的 `idempotency_key` 和有上限的 `max_seconds` 创建运行；结果不确定时用原参数和原键重试。运行变为 `ready` 后，`browser_control` 返回短期、一次性的 CDP 地址，可交给独立的兼容客户端（如 Playwright）操作页面；请勿公开该地址。插件不会把 ZCode 内置浏览器连接到该地址。
4. 如果创建了运行，无论任务完成、失败还是取消，都要用 `browser_stop_session` 结束，再用 `browser_get_session` 查询至 `released`；若无法确认释放，应报告该状态并保留运行标识用于恢复；费用和结算需单独核对。断开插件不等于结束云端运行。

## 依赖和影响

- 需要百智云浏览器账户、API Key 和访问 `https://capybrowser.app.baizhi.cloud/mcp` 的网络；Key 作为授权请求头发送给该服务。插件配置由 ZCode 管理，凭据存储与访问控制请参阅 ZCode 文档。
- 工具可创建、修改和删除云资源；创建及运行浏览器可能产生费用。插件自身不添加命令、钩子、脚本或本地文件写入。
- 插件不包含、不安装 CDP 网页客户端。使用前须核对客户端兼容性；不要把控制地址写入日志或公开聊天。

文档：[百智云浏览器](https://capybrowser.app.baizhi.cloud/docs/installation.md)。插件文件采用 Apache-2.0 许可，托管服务适用其自身条款。

## 维护与支持

[百智云浏览器（CapyBrowser）](https://baizhibrowser.cloud/zh/) · [插件源码](https://github.com/ctcbyzx/zcode-plugins/tree/codex/baizhi-cloud-browser-mcp/external_plugins/baizhi-cloud-browser) · [服务控制台](https://capybrowser.app.baizhi.cloud/)。

维护者：[ctcbyzx](https://github.com/ctcbyzx)（[Chaitin 公共接入仓](https://github.com/chaitin/baizhi-cloud-browser)贡献者）。更多接入方式见[公开接入材料](https://github.com/ctcbyzx/baizhi-cloud-browser)。

配置问题可到[接入维护仓 Issues](https://github.com/ctcbyzx/baizhi-cloud-browser/issues)反馈，附客户端版本和脱敏错误信息。账号或账务问题请通过服务控制台处理。
