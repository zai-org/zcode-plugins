# Employed by Guaq AI

[English](./README.md)

在 ZCode 中搜索在招职位。Employed 直接读取约 5,000 家雇主自有的招聘系统（Greenhouse、Lever、Workday、Ashby、SmartRecruiters 等）中的职位。可按领域、职级、地点、办公方式、技术栈或签证信号查找职位，查看雇主的招聘概况，或生成简短的招聘市场简报。每条结果都链接到雇主自己的申请页面。

## 包含内容

- **MCP 服务器** `employed`：托管于 `https://jobs.guaqai.me/mcp`（Streamable HTTP）。搜索工具（`search_jobs`、`count_jobs`、`get_job`、`list_companies`、`company_profile`、`market_signal`、`api_meta`），以及用于已登录用户自己 Employed 账户的工具（个人资料、个性化职位推荐、申请跟踪、新职位提醒）。
- **Skills**：`employed-jobs`（筛选词汇与搜索流程）、`job-search-from-resume`、`employer-research`、`hiring-market-brief`、`application-tracker`。
- **Agents 与命令**：`/find-jobs`、`/company`、`/market`。
- **交互式结果页**：在支持 MCP Apps 的宿主中，搜索结果以 MCP Apps 页面（`ui://employed/results-v1`）展示；其他环境中以普通工具结果返回。

## 登录

首次调用工具时，ZCode 会在浏览器中打开 Employed 登录页（OAuth 2.1，动态客户端注册）。免费的 Employed 账户即可开始使用。插件不需要粘贴，也不会保存任何 API Key。

## 示例提示词

- "Find entry-level backend roles in India."（查找印度的初级后端职位）
- "Is Stripe hiring in London right now?"（Stripe 目前在伦敦招聘吗？）
- "Set up my Employed profile from this CV and show my best matches."（根据这份简历设置我的 Employed 资料并展示最匹配的职位）

## 网络访问、数据与副作用

- 唯一的网络目标是 `https://jobs.guaqai.me/mcp`。它接收智能体选择的筛选条件和 ID、你要求保存的资料字段，以及 OAuth 令牌。
- 账户类工具只会在你要求时修改你自己的 Employed 数据（资料、申请跟踪、提醒）。不会代你申请职位、联系雇主或涉及付费。
- 插件没有 hooks，不运行本地命令，也不会在你的工作区写入文件。
- 职位描述属于第三方内容；skills 会要求智能体将其视为数据，而不是指令。
- 标记为 `likely` 的签证担保是根据职位文本推断的，并非保证。

## 链接

- 官网：https://jobs.guaqai.me
- 源代码：https://github.com/Guaq-AI/employed-plugins
- 隐私政策：https://jobs.guaqai.me/privacy-policy
- 服务条款：https://jobs.guaqai.me/terms-of-service
- 支持：support@guaqai.me

## 许可证

MIT。托管的 Employed 服务由 Guaq AI 依据其自身条款运营。
