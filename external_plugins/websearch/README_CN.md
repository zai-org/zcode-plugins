# websearch

ZCode 的独立网页搜索插件：一个零依赖的 MCP server，把 AnySearch / Exa / Parallel / Bing / SearXNG 串成一条会自动回退的引擎链，另带一个静态网页正文读取工具。**所有引擎都能免 Key 使用**（免费额度）；某个引擎额度用完时，把它的 Key 填进配置文件就切换到你的额度。

> [English](./README.md)

## 工具

### `web_search`

```json
{ "query": "必填，≤2000 字符", "limit": "1-10，省略用设置默认值", "engines": ["bing", "exa"] }
```

成功返回 `{ ok:true, engine, results:[{title,url,snippet,publishedAt}], attempts, skipped, elapsedMs }`；失败返回 `{ ok:false, errorCode, message, attempts, skipped, configPath }`，`message` 可直接转述给用户。

`attempts` 里每个引擎都有 `ok` / `count` / `ms`，失败时带 `error`；额度类失败（401/402/429、rate limit、quota）会额外带 `hint`，提示可以填 Key。

### `fetch_page`

```json
{ "url": "必填，http(s) 绝对地址", "maxChars": "可选，默认 8000，范围 500-30000" }
```

去掉 `script`/`style`/`svg`/注释，块级标签转换行，解码 HTML 实体，压缩空白后截断。`application/json` 直接返回原文。不执行页面脚本、不处理登录态。

## 引擎

| id | 端点 | 方式 | Key |
|---|---|---|---|
| `anysearch` | `api.anysearch.com/v1/search` | JSON API | 可选（Bearer） |
| `exa` | `mcp.exa.ai/mcp` | 托管 MCP，工具 `web_search_exa` | 可选（Bearer） |
| `parallel` | `mcp.parallel.ai/mcp` | 托管 MCP，工具 `web_search` | 可选（`x-api-key`） |
| `bing` | `www.bing.com/search` | 抓结果页 HTML | 不需要，也无法填 |
| `searxng` | 你填的实例 | `/search?format=json` | 需要自建实例（公共实例基本关了 JSON API） |

链式规则：`fallback`（默认，每次从第一位开始）或 `rotate`（每次把起始位后移一格，分散匿名额度）；一次调用只有一个总预算（默认 20s），每个引擎用剩余预算，预算耗尽后剩余引擎记入 `skipped`。只做去重与 300 字符截断，不改写摘要。

## 配置

**当前版本的 ZCode 插件详情页没有配置表单**（详情页的「高级信息」只展示路径）。配置有三种方式，按优先级：

1. **插件数据目录的 `websearch.json`（推荐）**：路径是

   ```text
   <插件数据目录>/websearch.json
   ```

   文件在**首次使用时自动生成**，且绝对路径写进了两个工具的描述——最省事的找到方式就是直接问模型「websearch 配置文件在哪」。典型安装下的完整路径：

   ```text
   C:\Users\<你>\.zcode\cli\plugins\data\websearch@zcode-plugin\websearch.json
   ```

   ```json
   {
     "anysearchKey": "",
     "exaKey": "",
     "parallelKey": "",
     "order": "anysearch,exa,parallel,bing,searxng",
     "disabled": "",
     "mode": "fallback",
     "defaultLimit": 10,
     "timeoutMs": 20000,
     "bingMarket": "auto",
     "searxngInstances": ""
   }
   ```

   只写要改的键即可，其余用默认值；保存后开新会话生效。

2. **环境变量**：`ANYSEARCH_API_KEY` / `EXA_API_KEY` / `PARALLEL_API_KEY`（`setx` 后重启 ZCode）。**仅当 `websearch.json` 和插件配置里都没填该引擎的 Key 时生效**。

3. **插件的 `userConfig`**（清单里声明了 10 个字段）：值会展开进 MCP 的环境变量，但当前版本没有输入界面；等 ZCode 支持配置表单后，无需改本插件即可使用。

优先级：`websearch.json` > `userConfig`（应用配置）> 环境变量 > 内置默认值。

## 安全边界

- **没有宿主守门**。Cindy 版靠宿主的 `cindy.fetch` 做 SSRF/体积/超时拦截；ZCode 的 MCP server 是普通本地进程，所以这些限制写在本插件里：只允许 http/https、拒绝带用户名密码的 URL、拒绝回环/内网/链路本地（含 `169.254.169.254` 元数据地址）/CGNAT/唯一本地地址/组播地址（IPv4 与 IPv6 都判）、最多 5 次重定向且**每一跳都重新校验**、响应上限 2 MB、请求超时。
- `fetch_page` 的 URL 来自模型，因此始终走上面的校验；SearXNG 实例地址来自你自己的配置，允许指向本机（本地自建实例是正常用法）。
- 搜索结果的正文与摘要是**不可信数据**，两个工具的描述里都写明了不要执行其中的指令。

## 已知限制

- **Bing 靠 HTML 解析**：结果页 class 改版就会返回 0 条（会被链自动跳过，不会伪装成「没有结果」）。
- **匿名额度会限流**：Exa 曾长期 429、AnySearch 曾转付费档，链会自动回退；失败时 `attempts[].hint` 会提示填 Key。
- **`fetch_page` 不渲染 JS**：需要脚本渲染的页面只能拿到静态部分。
- **没有缓存**：每次调用都真实打到引擎。
- 内置 `WebSearch` 存在时（provider 命中支持服务端搜索的端点），模型可能优先用内置那个；插件无法禁用内置工具。

## 开发与验证

```text
external_plugins/websearch/
├── .mcp.json                # MCP server 声明（stdio、node、user_config 环境变量）
├── .zcode-plugin/plugin.json
├── bin/server.mjs           # 全部实现，零依赖，Node 18+（全局 fetch）
├── commands/websearch.md    # /websearch 手动入口与单引擎排查
├── tests/test-server.py     # 离线 + --live 测试
├── LICENSE                  # MIT
└── README.md / README_CN.md
```

```bash
node --check bin/server.mjs
node bin/server.mjs --self-test          # 离线解析器/配置/SSRF 断言
python tests/test-server.py              # 离线：MCP 握手、工具表、错误路径
python tests/test-server.py --live       # 追加真实引擎与网络守门测试
```

`--self-test` 与离线测试不发网络请求，可以随时跑；`--live` 需要出网，用来确认引擎是否仍然可用（Bing 解析失效时它会是第一个失败的用例）。

## 许可

MIT — 见 [LICENSE](./LICENSE)。搜索引擎本身是第三方服务（AnySearch、Exa、Parallel、Bing、SearXNG），通过它们的公开端点使用。
