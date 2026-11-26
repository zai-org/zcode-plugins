# LinkBunny Placement Checker

检查已发布的网页是否包含指向指定网址的链接。查看匹配链接的 href、锚文本、
`rel` 属性，以及是否带有 `nofollow`。检查器还可报告观察到的重定向和来源网页
声明的规范网址。

[English](./README.md)

## 在 ZCode 中使用

在 ZCode 的插件市场中安装并启用 **LinkBunny Placement Checker**。配置模型后，
在新的 ZCode 会话中试用以下提示：

> 使用 `inspect_placement` 检查 `https://getlinkbunny.com/` 是否链接到
> `https://saasaffiliate.net/`。请报告实际观察到的 href，以及该链接是否带有
> `nofollow`。

检查器分析获取到的 HTML，其中可能没有通过 JavaScript 渲染的链接。结果反映本次
观察到的链接情况，无法据此判断网页收录、搜索排名或链接是否会持续存在。

## 网络、隐私与许可

ZCode 通过 Streamable HTTP 连接到
[LinkBunny 托管的检查器](https://mcp.getlinkbunny.com/mcp)。
每次检查都会将已发布网页的网址和预期目标网址发送给 LinkBunny，后者会向这些
网站发送 HTTP 请求。请使用公开的 HTTPS 网址，并省略私密的查询参数。详情见
[LinkBunny 隐私政策](https://getlinkbunny.com/privacy)。

插件配置和文档采用 [MIT 许可证](./LICENSE)。插件仅包含一个只读 MCP 连接，
无需 LinkBunny 账号或 API 密钥。插件不捆绑依赖，不包含本地命令或钩子，不自行
写入文件，也不额外收集遥测数据。模型连接和对话记录由 ZCode 管理。
