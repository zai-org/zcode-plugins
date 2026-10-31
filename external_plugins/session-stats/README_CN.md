# session-stats — ZCode 会话统计插件

ZCode 会话统计插件：轮次/步数、模型/工具耗时、
TTFT、TPS（会话平均 + 最近请求）、token 用量与缓存命中率。零第三方依赖。

## 组件

- **MCP 工具 `get_stats`**：当前会话（含子代理，经 `session.parent_id` 聚合）
  或今日汇总的完整统计。
- **MCP App 侧栏面板**（`ui.surfaces`）：统计卡片 + 明细弹窗（耗时、token 分桶、
  缓存命中、模型分布），5 秒轮询自动刷新，跟随会话切换与主题。
- **`/stats` 命令**：同样数字的文字卡片输出。
- **SessionStart hook**：把当前会话 id 写入插件数据目录，供服务端解析「当前会话」。

## 数据源与指标口径

全部**只读**读取本地会话数据库 `~/.zcode/cli/db/db.sqlite`（SQLite URI `mode=ro` +
`busy_timeout=5000`，WAL 下并发安全）。口径对 ZCode 3.17.1 实测定案：

| 指标 | 定义 |
|---|---|
| 轮次 | 主会话 `model_usage.turn_id` 去重数 |
| 步数 | `logical_request_id` 去重数（重试不计步；失败/取消计步） |
| 模型用时 | Σ `duration_ms` |
| 工具用时 | Σ `tool_usage.duration_ms` |
| TTFT 均值 | AVG(`time_to_first_token_ms`) |
| TPS | Σ output ÷ Σ(completed_at − first_token_at)；「实时」= 最近一次完成请求 |
| token | Σ input + Σ output（实测 `input_tokens` 已含缓存读） |
| 缓存命中率 | cache_read ÷ input |

数据库 schema 属宿主实现细节（非稳定 API），usage 行保留 30 天；查询对缺列做了
优雅降级。

## 副作用说明

- 只读读取本地会话数据库。
- 启动仅绑定回环地址的本地服务（`127.0.0.1:31710`），向 ZCode 渲染层提供统计
  JSON 与面板动态脚本；只响应无跨域 `Origin` 头的请求（即应用自身 `file://` 页面），
  其余 Origin 一律 403。
- SessionStart hook 在插件数据目录写一个小文件（`current_session`）。
- 无网络访问、无凭证、无遥测。

## 安装

ZCode Desktop → **插件市场** → 添加收录本插件的市场（审核通过后为官方
`zcode-plugins` 市场，审核前可用本地目录）→ **安装 session-stats** → 重启或新开会话
→ 输入 `/stats` 或打开「会话统计」侧栏面板。

## 许可

MIT
