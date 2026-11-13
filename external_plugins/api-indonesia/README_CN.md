# API Indonesia

通过一个 MCP 服务器访问来自官方来源的印尼公共数据：从省到村和邮政编码的行政区划、区域边界、公共假期、礼拜时间、伊斯兰历日期、学校、大学、医院、地震、天气、空气质量、汇率、最低工资、QRIS 解析、印尼盾金额格式化等。

| | |
|-|-|
| MCP 地址 | `https://mcp.apiindonesia.id/mcp`（Streamable HTTP，84 个工具） |
| 鉴权 | 提示时使用 OAuth 2.1 登录，或使用 `aip_live_...` API Key |
| 定价 | 注册赠 3,000 积分，无需信用卡；每次成功请求 2 积分 |
| 文档 | https://docs.apiindonesia.id |

## 安装

在 ZCode 插件市场中安装该插件，按提示完成 OAuth 登录。若希望使用密钥，请在插件配置中填写 API Key（留空则使用 OAuth）。

## 网络访问

所有工具调用都会通过 HTTPS 发送至 `https://mcp.apiindonesia.id/mcp`。插件包中不含任何凭据；填写的 API Key 只保存在本地 ZCode 配置中。

## 许可与来源

插件封装由 Khaisa Studio 提供，采用 MIT 许可。托管服务由 Khaisa Studio 运营：https://apiindonesia.id。源码与示例：https://github.com/khmuhtadin/api-indonesia-examples。
