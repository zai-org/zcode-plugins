# Craft Connector（ZCode 插件）

一个把 ZCode 智能体连接到 macOS 上 [Craft](https://www.craft.do)（craft.do）的插件：

- **创建笔记**（`/craft-notiz`）——新建带标题和 Markdown 内容的文档
- **搜索并阅读笔记**（`/craft-suche`）——通过 `documents/search` 进行全文检索
- **每日笔记**（`/craft-daily`）——读取今天的笔记并追加条目
- **在 Craft 中打开**——针对页面、搜索和每日笔记的 `craftdocs://` 深度链接

首选路径是官方 [Craft API](https://connect.craft.do/api-docs)；`craftdocs://` URL
Scheme 用于在应用中打开内容。源码与问题反馈：<https://github.com/dbrussig/craft-connector>

## 环境要求

- macOS，并安装 Craft 桌面应用
- 一个 Craft API 连接：在 Craft 中打开所属 Space 的 **Connect** 区域，创建 API
  连接（例如"连接全部文档"）。Craft 会显示**两个**成对的值：**连接 URL**
  （`https://connect.craft.do/links/<id>/api/v1`）和**密钥**（`pdk_…`）。

## 一次性配置（API 凭据）

把两个值保存到项目之外的本地 env 文件中，并在终端里操作，避免进入 shell
历史（以下为 zsh 语法）：

```bash
mkdir -p ~/.config/craft-connector && chmod 700 ~/.config/craft-connector
umask 077
printf 'CRAFT_API_URL=%s\n' 'YOUR-CONNECTION-URL' > ~/.config/craft-connector/craft.env
read -s "CRAFT_API_KEY?粘贴密钥后回车: "
printf 'CRAFT_API_KEY=%s\n' "$CRAFT_API_KEY" >> ~/.config/craft-connector/craft.env
unset CRAFT_API_KEY
chmod 600 ~/.config/craft-connector/craft.env
```

连通性检查（只显示 Space 名称/时区，绝不显示密钥）：

```bash
set -a; source ~/.config/craft-connector/craft.env; set +a
curl -sS -H "Authorization: Bearer $CRAFT_API_KEY" "${CRAFT_API_URL%/}/connection"
```

URL 和密钥属于凭据：绝不打印、粘贴到聊天中或提交到版本库。

## 安装

- **官方插件市场（推荐）**：ZCode → 插件管理器 → 搜索 **Craft Connector** →
  安装 → 启用 → 重启 ZCode。
- **从源码 / 自建 GitHub 市场**：把 <https://github.com/dbrussig/craft-connector>
  作为插件市场添加（Plugin Marketplace → Add），然后安装其中的 `craft` 插件。

## 组件

- `skills/craft/SKILL.md`——核心知识：env 处理、安全规则、API 流程
- `commands/craft-notiz.md`、`commands/craft-suche.md`、`commands/craft-daily.md`
- 不包含 MCP 服务器、后台进程或 hooks

## 已知的 API 行为（2026-11-07 实测）

- `POST /documents` 会**忽略** `content` 字段——先用标题创建文档，再通过
  `pageId` 以块的形式追加内容（Skill 中记录了可靠的两步流程）。
- `clickableLink` 中的 `documentId` 与可通过 API 寻址的页面 ID
  （`items[].id`）不同；该链接可打开 Craft，但其 ID 不能用于 `GET /blocks?id=`。
- `GET /documents?id=…` 不按 ID 过滤，而是返回整个 Space 的文档列表。

## 网络访问与副作用

- **网络**：插件只访问用户自己的 Craft Connect API 端点
  （`https://connect.craft.do/links/<id>/api/v1`，在 Craft 中创建 API 连接时
  显示），并使用本地 env 文件中用户自己的凭据进行认证。无遥测、无第三方服务、
  无自动云端调用。
- **写入**：智能体可以在所连接 Craft Space 的每日笔记和页面中追加块、创建新
  文档——且仅限用户任务范围内。删除操作仅在用户对具体对象明确提出请求时进行。
- **凭据**：从 `~/.config/craft-connector/craft.env`（位于所有项目之外）读取；
  绝不打印、记录或提交。
- **无 hooks、无 MCP 服务器、无后台进程**——本插件由一个 Skill 和三条斜杠命令
  组成，由智能体执行。
- **第三方服务**：Craft（craft.do）及其 Connect API；`craftdocs://` URL Scheme
  用于打开本地 Craft 桌面应用。本插件与 Craft 官方无关联、亦未获其背书。

## 许可证

MIT——见 [LICENSE](./LICENSE)。
