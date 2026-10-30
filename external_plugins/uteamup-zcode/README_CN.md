# UteamUP CMMS（ZCode 版）

将 ZCode 连接到您的 [UteamUP](https://uteamup.com) 工作区，用自然语言查询资产和工单。
本插件只包含一个远程 MCP 服务和一个 Skill，不包含任何本地代码、钩子或命令。

## 工作原理

`uteamup` MCP 服务连接生产只读端点
`https://api.uteamup.com/mcp/read-only`，并通过您自己的 UteamUP 账号进行
OAuth 2.0 授权（插件自动完成客户端注册，首次使用时 ZCode 会打开 UteamUP
授权页面）。申请的权限范围为 `mcp:read`。

前置条件（一次性操作，在 UteamUP 中完成，与 ZCode 无关）：

1. 租户管理员在公司的 **API Keys** 标签页开启 **Allow members to connect AI
   assistants**（允许成员连接 AI 助手）。
2. 首次使用时，在 UteamUP 授权页面登录并选择公司。仅显示您作为所有者或持有
   许可证的公司。

无需 API 密钥或密钥口令。连接使用成员本人在所选公司中的权限。成员可以在
**Profile → Accounts** 中断开连接；管理员可以在 API Keys 标签页查看并撤销
所有连接。

## 工具

- `uteamup_asset_list` — 列出所连接工作区中的资产
- `uteamup_asset_get_by_guid` — 按 GUID 获取单个资产
- `uteamup_asset_search` — 搜索资产（名称、全文）
- `uteamup_workorder_list` — 列出所连接工作区中的工单
- `uteamup_workorder_search` — 搜索工单（标题、描述、全文）

仅提供上述只读工具；写入或管理类调用会被服务端拒绝。读取操作不会调用
UteamUP 的 AI 服务，也不消耗 UteamUP AI 积分。

## 试一试

- "列出我工作区中的前五个资产。"
- "查找名称包含 pump 的资产。"
- "显示我未关闭的工单。"

## 网络访问、副作用与来源说明

- 网络访问：仅出站 HTTPS 访问 `https://api.uteamup.com/mcp/read-only` 及
  UteamUP OAuth 端点（`/oauth/authorize`、`/oauth/token`、`/oauth/register`）。
  未配置其他网络目标。
- 本地副作用：无。不写文件、不执行命令、无钩子、无内置二进制文件。插件仅
  声明一个 MCP 服务和一个 Skill。
- 第三方服务与代码：UteamUP 是本插件的发布者，并运营唯一被访问的服务。未捆绑
  第三方代码。Logo 素材归 UteamUP 所有。请求与响应由 Z.ai（ZCode）和 UteamUP
  按各自政策处理；UteamUP 按其隐私政策和工作区保留设置保存记录。
- 许可证：MIT。隐私政策：https://app.uteamup.com/privacypolicy。
  服务条款：https://app.uteamup.com/terms。
  支持渠道：https://github.com/UteamUP/uteamup-mcp/issues。
  源码维护于 https://github.com/UteamUP/uteamup-mcp（`plugins/uteamup-zcode`），
  也可从 UteamUP 自有插件市场安装。
