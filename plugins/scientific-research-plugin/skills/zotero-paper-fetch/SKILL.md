---
name: zotero-paper-fetch
description: 批量检索文献、下载 PDF 并入库 Zotero 的完整管线。当用户提供文献/引用列表（Markdown 编号列表、参考文献节选、DOI 清单、arXiv ID 等），要求"搜索下载入库 Zotero""把这些文献加到 Zotero""下载 PDF 并归类""下载 arXiv 预印本"时使用。覆盖：CrossRef / arXiv / OpenAlex 检索补全元数据 → Zotero 入库归类打标 → 按出版商分层下载 PDF（OA 直链 / 仓库反爬 / 校园 VPN 付费墙）→ 挂载或落盘报告。适用于运筹学、供应链韧性、物流网络、风险建模等领域。
license: MIT
---

# 文献批量下载入库 Zotero 管线

五个阶段：**检索补全 → 入库归类 → PDF 下载 → 挂载 → 报告**。逐阶段执行、每阶段核验，不要攒到最后。

**核心原则（防幻觉）**：禁止凭记忆生成参考文献——AI 幻觉文献的根因是「从训练数据中回忆引用」。任何文献推荐、检索、引用都必须走 CrossRef / arXiv / OpenAlex 等权威 API 拿到真实 DOI（可在 doi.org 验证）；禁止不经 API 验证就断言某篇论文的存在，禁止凭记忆手写 BibTeX 条目。

**API 调用纪律**：arXiv 检索一律走 `scripts/search_arxiv.py`、OpenAlex 一律走 `scripts/openalex_cli.py`（两者内置限速、退避重试与 ID 校验），不要临时手写 curl 拼请求；禁止凭记忆编造 OpenAlex ID（形如 W2741809807）或 DOI，作者名/期刊名先用 `resolve` 解析成 ID 再过滤；最终报告列出所用文献的 URL（doi.org / arxiv.org/abs/…）供用户核验。

## 阶段 0：前置确认

1. **Zotero 状态**：`zotero_get_collections` 确认服务在线、拿到目标 collection key。
2. **付费墙预期**：若清单含 Elsevier/Wiley/Springer 等付费文献，先问用户校园 VPN（EasyConnect/aTrust 等系统级）是否已连。未连且用户无法连时，付费文献只入库元数据，PDF 留给用户自行下载。
3. **云存储配额**：`zotero_attach_file` 若报 413（quota exceeded），本次所有 PDF 一律落 `~/Downloads`，不再反复重试。

## 阶段 1：检索补全元数据

- **有 DOI**：直接进入阶段 2，`zotero_add_item(source=<DOI>, source_type='doi')` 走 CrossRef，元数据最全。
- **无 DOI / 引注不完整**（缺作者、期刊、年份，如 "Xu, et al. (2025). …"）：用 CrossRef 批量补全——

```python
# Bash 运行，需 dangerouslyDisableSandbox（沙箱拦网络）
url = "https://api.crossref.org/works?rows=2&query.bibliographic=" + quote(标题+作者线索)
# 每条提取: title / container-title / issued / author / DOI，人工核对候选（注意排除 erratum）
```

- **预印本（arXiv ID / OR/ML 预印本引注）**：`uv run scripts/search_arxiv.py --id_list <ID>`（或 `--query 'ti:… AND au:…'`）取元数据；结果先重定向到文件再解析，防撑爆上下文。返回字段含 title/authors/published/doi/pdf_url。注意 arXiv 的 DOI 是 DataCite 注册的 `10.48550/arXiv.<ID>`，CrossRef 查不到——入库走阶段 2 的 arXiv 分支。
- **书籍/无 DOI 条目**：手工构造 BibTeX 添加（作者/年份/出版社信息可控），不要走 ISBN（OpenLibrary 元数据 noisy）。
- **勘误上报**：CrossRef 结果与用户引注冲突时（如期刊名、卷期不符），以 CrossRef 为准入库，并在最终报告中列出勘误供用户改文档。

## 阶段 2：Zotero 入库（严格串行）

```
zotero_add_item(
  source=<DOI或bibtex>, source_type='doi'|'bibtex',
  collections=[<key>],
  tags=[...],               # 沿用库内既有标签体系，如「路线/韧性评估」「场景/航运与港口」
  if_exists='file',          # 幂等：已有同 DOI 条目则只补 collection
  attach_mode='none'         # 批量时禁用自动挂载，PDF 由阶段 3 统一处理
)
```

**关键行为约束**（实测教训）：
- **必须逐条串行**。并行调用本地 Zotero 会超时 / Connection closed。
- **超时 ≠ 失败**：客户端 30s 超时后服务端常已完成写入（含 collection 与 tags）。先等 45–60s，用 `zotero_get_recent` / `get_collection_items(detail='keys_only')` 核验是否已写入，确认未写入才重试。盲目重试会造出重复条目。
- 每篇添加后可顺手 `get_item_children` 检查：同名 PDF ×2 即重复附件，删一份（Trash 可恢复）。
- 全部完成后 `zotero_update_search_database` 更新语义索引（超时正常，等 60–90s 后用 `zotero_get_search_database_status` 看 Last Update）。

**arXiv 条目入库**：先试 `zotero_add_item(source=10.48550/arXiv.<ID>, source_type='doi')` 并核验元数据抓全（作者/年份/标题）；DataCite DOI 抓取失败时，用 search_arxiv.py 返回的元数据构造 `@misc` BibTeX（含 `eprint=<ID>, archivePrefix={arXiv}` 与 doi/url 字段）入库——不要因 DOI 路径失败就放弃元数据质量。

## 阶段 3：PDF 下载（按源分层，从低成本到高成本）

### 层 0 —— OA 直链，curl 直接下（Bash 需非沙箱）

| 来源 | 直链模式 |
|---|---|
| MDPI | `https://res.mdpi.com/d_attachment/<journal>/<id>/article_deploy/<id>.pdf`（主站拦 curl，res 子域不拦） |
| arXiv | 检索结果自带 `pdf_url`（`export.arxiv.org/pdf/<ID>`），全 OA，curl 直接下 |
| eScholarship | 文章页直链 |
| 大学仓库（DSpace/edoc） | 从落地页找到 bitstream 真实 URL 后 curl；DOI 落地页本身常无直链 |

每份下载后 `file` 命令验证是 PDF 而非 HTML 挑战页。

### 层 1 —— 仓库反爬，内置浏览器（Playwright MCP）

Cranfield 等 Anubis 类 JS 挑战：`browser_navigate` 到目标 → 等 8–10s 自动过 → 重定向出真实 content URL → 在该页面上下文取文件（见下方取回管线）。

### 层 2 —— 付费墙，需校园系统级 VPN

**EasyConnect IPv6 坑（先查再试）**：EasyConnect 只代理 IPv4 网段，支持 IPv6 的出版商（Wiley 有 AAAA）会被浏览器走家宽 v6 直连绕开隧道 → 无订阅 403。诊断：`route get <域名>` 看是否走 utun；页面内查出口 IP。解法：`networksetup -setv6off Wi-Fi`，**任务结束必须 `networksetup -setv6automatic Wi-Fi` 恢复**。

**ScienceDirect（Elsevier）**：
1. `navigate https://www.sciencedirect.com` 首页种 cookie（首页不挑战）；
2. `navigate /science/article/pii/<PII>`（PII 从 CrossRef `alternative-id` 批量拿；走 DOI 跳转会带 via=ihub 触发挑战）；
3. evaluate 取**含本页 PII** 的 `pdfft` 链接（`a.download-pdf-link` 会误抓推荐栏，必须按 PII 过滤）；
4. `navigate` 到 pdfft → 挑战后落在 `pdf.sciencedirectassets.com/…main.pdf?X-Amz-…` 签名 URL（viewer 页）；
5. 在 viewer 页执行取回管线。**直接 fetch pdfft 只会拿到 "Preparing your download" 中介页——fetch 不执行挑战 JS，必须先真导航。** curl 拿签名 URL 也被 CDN JS 挑战拦。

**Wiley**：`navigate` 文章页（挑战 10–25s 自动过）→ 页面内 `fetch('/doi/pdfdirect/<doi>')`。按刊订阅：大刊通常有，小刊可能未订（403 即无权，勿反复试）。

**Emerald**：文章页 DOM 里直接有 `article-pdf/…/<doi>.pdf` 链接，页面内 fetch 即得。

**不可行路径**（不要浪费时间）：网页统一认证/WebVPN 登录式（headless 浏览器用户无法输密码，凭证不进对话）；ScienceDirect 对 curl / 未导航的持续挑战。

### 取回管线（层 1/2 通用，核心）

页面 → `127.0.0.1` 本地接收服务的 POST 会被 Chrome Private Network Access **静默挂起**（勿用）；`browser_run_code_unsafe` 无 require/import（勿用）。**唯一可靠方案——页面暂存 + 分块读回**：

```js
// ① evaluate（立即返回，后台执行）：fetch → FileReader → dataURL 暂存
() => {
  window.__pdfReady = false; window.__pdf64 = null; window.__pdfErr = null;
  fetch(location.href /* 或目标 pdf 链接 */, { credentials: 'include' })
    .then(r => { window.__ct = r.headers.get('content-type'); return r.blob(); })
    .then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))
    .then(du => { window.__pdf64 = du; window.__pdfReady = true; })
    .catch(e => { window.__pdfErr = String(e); });
  return 'bg';
}
```

```
② Bash sleep 10–15 后 evaluate 查 {ready, err, ct, len}，ct 含 application/pdf 才继续
③ evaluate 分块读回（每块 2,000,000 字符，配 filename 参数直接落盘不占上下文）：
   () => window.__pdf64.slice(0, 2000000)        // filename: .c1
   () => window.__pdf64.slice(2000000, 4000000)  // filename: .c2 …
④ Bash 拼接解码验证：
   cat .c1 .c2 … > /tmp/x_b64
   python3: s=json.loads(可能带引号的JSON字符串) → split('base64,',1)[1] → b64decode → 写文件
   file 验证为 PDF → rm 分块
```

## 阶段 4：挂载 Zotero

- 配额正常：`zotero_attach_file(item_key=<条目>, file_path=<本地路径>)`，逐条串行。
- 配额满（413）：PDF 统一 `mv ~/Downloads/<Author>_<Year>_<Short_Title>.pdf`，命名含作者年份便于对号。

## 阶段 5：报告规范

结论先行，分四组汇报：
1. **已入库并挂载 PDF**（数量 + 文件夹分布）；
2. **已入库、PDF 在 ~/Downloads 待拖**（逐条列文件名 → 目标 Zotero 子文件夹；提醒"按标题搜条目、选中拖入，文件夹无需手选"）；
3. **无法获取 PDF 及原因**（无订阅 / 需注册 / 专著无电子版），附 DOI 链接；
4. **元数据勘误**（CrossRef 与用户引注不符处）与待办（配额清理、IPv6 已恢复确认等系统状态）。

## 检索模式（用户给关键词找文献，而非提供现成清单）

先查库内已有：`zotero_semantic_search` 语义检索用户 Zotero 库，不要遍历集合。库内没有再走外部 API。

多关键词批量流程：与用户确认 3–5 个检索词 → 逐词 API 搜索 → 呈现候选（标题/作者/年份/被引/DOI）→ 用户确认后批量入库（从阶段 2 起复用本管线）。

### CrossRef API（英文文献首选）

```bash
curl -s "https://api.crossref.org/works?query=KEYWORD1+KEYWORD2&filter=from-pub-date:2020,type:journal-article&rows=15&sort=relevance&order=desc" \
  -H "User-Agent: ResearchTool/1.0 (mailto:user@example.com)" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, item in enumerate(data['message']['items'], 1):
    title = item.get('title', ['(no title)'])[0]
    authors = item.get('author', [])
    author_str = '; '.join(f\"{a.get('family','')} {a.get('given','')[0:1]}.\" for a in authors[:3])
    if len(authors) > 3: author_str += ' et al.'
    year = item.get('published-print', item.get('published-online', {})).get('date-parts', [['']])[0][0]
    doi = item.get('DOI', '')
    cited = item.get('is-referenced-by-count', 0)
    journal = item.get('container-title', [''])[0]
    print(f'{i:2}. [{cited:>4} cites] {title}')
    print(f'    {author_str} ({year}) {journal}')
    print(f'    DOI: {doi}')
"
```

参数：`query` 关键词用 `+` 连接；`filter=from-pub-date:2020` 限年份；`sort=relevance` 或 `sort=published`；`rows` 建议 10–15。

### arXiv API（OR/ML 预印本首选，走脚本）

```bash
uv run scripts/search_arxiv.py \
  --query 'ti:"supply chain resilience"' \
  --max_results 10 --sort_by submittedDate --sort_order descending \
  > /tmp/arxiv.json
python3 -c "
import json
data = json.load(open('/tmp/arxiv.json'))
for i, p in enumerate(data['papers'], 1):
    authors = '; '.join(p['authors'][:3]) + (' et al.' if len(p['authors']) > 3 else '')
    print(f\"{i:2}. {p['title']}\")
    print(f'    {authors} ({p[\"published\"][:4]})  arXiv:{p[\"id\"]}')
    print(f'    DOI: {p.get(\"doi\",\"\")}  PDF: {p.get(\"pdf_url\",\"\")}')
"
```

字段前缀 `all:/ti:/au:/abs:/cat:`，短语加引号，布尔 `AND/OR/ANDNOT`；限速已内置（1 次/3 秒），不要并行跑多个实例。

### OpenAlex API（备选，覆盖 2.5 亿+ 文献；一律走 CLI）

```bash
uv run scripts/openalex_cli.py filter works \
  --search 'supply chain resilience' \
  --filter publication_year:2020-2026,type:article \
  --sort cited_by_count:desc --per-page 15 \
  --select id,doi,title,publication_year,cited_by_count,authorships \
  > /tmp/openalex.json
```

- 名字 → ID：`resolve authors 'John Doe'`；单条详情：`get works W2741809807 --select id,doi,title`；配额自查：`rate-limit`。
- 429 或高频使用：`--api-key`（默认读 `~/.env` 的 `OPENALEX_API_KEY`；无 key 时配额很低）。
- `download-pdf` 子命令走 OpenAlex 付费内容服务（$0.01/次且需 key）——非必要不用，OA PDF 优先走阶段 3 分层。

### Semantic Scholar API（语义搜索，适合主题发现）

```bash
curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=KEYWORD&limit=10&fields=title,authors,year,citationCount,externalIds" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for i, p in enumerate(data.get('data', []), 1):
    title = p.get('title', '(no title)')
    authors = '; '.join(a['name'] for a in p.get('authors', [])[:3])
    year = p.get('year', '')
    doi = p.get('externalIds', {}).get('DOI', '')
    cited = p.get('citationCount', 0)
    print(f'{i:2}. [{cited:>4} cites] {title}')
    print(f'    {authors} ({year})  DOI: {doi}')
"
```

### 中文文献

CrossRef/OpenAlex 对中文文献覆盖有限：CNKI / 万方通过浏览器搜索，拿到 DOI 或 BibTeX 后 `zotero_add_item(source_type='bibtex')`；Google Scholar 需处理反爬。

### 相关路由

- 文献阅读与笔记走 zotero-paper-note / paper-reader 技能。
- 文献综述先 `zotero_synthesize_annotations` 汇总高亮与笔记，再动笔综合。
- 检索 GitHub 仓库 / 网页调研用 zread、web_reader；引用代码带 file:line。

## 脚本与来源

- `scripts/search_arxiv.py`、`scripts/openalex_cli.py` 收编自 [google-deepmind/science-skills](https://github.com/google-deepmind/science-skills)（Apache 2.0，Copyright Google LLC）。用 `uv run` 直接执行，依赖（polite-http、python-dotenv）由 uv 按脚本内联声明自动解析；首次运行需联网装依赖，在 ZCode 里用非沙箱 Bash。
- 遵守两端 API 条款：arXiv 限 1 req/3s（脚本已内置），OpenAlex 无 key 走 polite pool；检索结果遵守各数据源使用条款。

## 故障速查

| 症状 | 处置 |
|---|---|
| add_item 超时/Connection closed | 等 45–60s → get_recent 核验 → 未写入才重试 |
| OpenAlex 429 / 配额低 | `rate-limit` 查配额；`~/.env` 配 `OPENALEX_API_KEY` 后自动携带 |
| attach 413 quota | 全部落 ~/Downloads，报告说明 |
| SD/Wiley 403 + 页面标题"请稍候" | 真导航等待 10–25s；仍 403 查 IPv6 是否绕过隧道 |
| fetch 拿到 text/html 中介页 | 挑战未过，改真导航后再 fetch |
| 下载文件是 HTML | CDN 挑战页，换浏览器内 fetch 路径 |
