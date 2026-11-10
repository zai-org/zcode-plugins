# 1ToolRing

通过一个 1ToolRing 密钥按次调用第三方供应商提供的数千个工具：网页搜索、地图与地点、购物与价格、行情数据、网页抓取、图片、天气、招聘等。每次调用前显示价格，失败的调用不计费。

| | |
|-|-|
| MCP 地址 | `https://mcp.1toolring.com/mcp`（Streamable HTTP） |
| 鉴权 | 提示时使用 OAuth 2.1 登录，或在 https://app.1toolring.com/keys 创建 API Key |
| 工具 | `discover_tools`（免费）、`inspect_tool`（免费）、`run_tool`（计费）、`get_tool_run`（免费） |
| 文档 | https://docs.1toolring.com/overview/ |

## 安装

在 ZCode 插件市场中安装该插件，按提示完成 OAuth 登录。若希望使用密钥，请在插件配置中填写 API Key（留空则使用 OAuth）。

## 网络访问

所有工具调用都会通过 HTTPS 发送至 `https://mcp.1toolring.com/mcp`。插件包中不含任何凭据；填写的 API Key 只保存在本地 ZCode 配置中。

## 许可与来源

插件封装由 Khaisa Studio 提供，采用 MIT 许可。托管服务由 Khaisa Studio 运营：https://1toolring.com。源码与示例：https://github.com/khmuhtadin/1toolring-mcp。
