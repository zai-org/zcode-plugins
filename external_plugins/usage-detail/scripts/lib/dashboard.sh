# 交互式仪表盘（dashboard / dashboard-this）：META 组装与 HTML 片段输出（由入口 usage.sh source）

cmd_dashboard() {
    # 生成交互式用量界面（HTML 片段），输出路径必须由调用方指定。
    # 默认内嵌全部历史（-1）；可用第三参数或 ZCODE_USAGE_LIMIT 限制条数。
    out="${2:-}"
    [[ -n "$out" ]] || { echo "用法：usage.sh $cmd <输出.html> [条数]" >&2; exit 1; }
    scope=''
    session_meta='null'
    limit_arg="${3:-}"
    if [[ "$cmd" == dashboard-this ]]; then
      limit_arg=''
      resolve_session "${@:3}"
      scope="WHERE session_id=$SESSION_SQL"
      session_meta="(SELECT json_object('id',$SESSION_SQL,
        'title',coalesce(nullif(s.title,''),'（无标题或会话已删除）'),
        'directory',s.directory,'created',s.time_created,
        'latest',(SELECT max(started_at) FROM model_usage $scope),
        'selection',$(sql_quote "$SESSION_MODE"))
        FROM (SELECT 1) LEFT JOIN session s ON s.id=$SESSION_SQL)"
    fi
    [[ "$limit_arg" == "-1" ]] && limit_arg=''   # 显式 -1 = 全部
    limit=$(num_arg "${ZCODE_USAGE_LIMIT:--1}" "$limit_arg")
    # 默认 -1 = 全部历史；显式给定条数时校验范围
    [[ "$limit" == "-1" ]] || { is_num "$limit" && [[ "$limit" -ge 1 && "$limit" -le 20000 ]] || { echo "条数应在 1-20000 之间或 -1（全部）：${limit}" >&2; exit 1; }; }
    # 价格表每日自动同步一次（需要 node + curl；ZCODE_USAGE_NO_AUTOSYNC=1 关闭）
    if [[ -z "${ZCODE_USAGE_NO_AUTOSYNC:-}" ]] && command -v node >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
      upf="${ZCODE_USAGE_PRICES:-$HOME/.zcode/usage-prices.json}"
      upf_mtime=0
      if [[ -f "$upf" ]]; then
        upf_mtime=$(stat -f %m "$upf" 2>/dev/null || stat -c %Y "$upf" 2>/dev/null || echo 0)
      fi
      # autoSync=false（设置弹窗可关）时跳过每日自动同步
      if [[ $(( $(date +%s) - upf_mtime )) -ge 86400 ]] && ! grep -q '"autoSync"[: ]*false' "$upf" 2>/dev/null; then
        bash "$SCRIPT_DIR/usage.sh" prices sync >/dev/null 2>&1 || true
      fi
    fi
    pf=$(price_file)
    if [[ -n "$pf" ]]; then
      PJ_SQL="(SELECT CAST(readfile($(sql_quote "$pf")) AS text) AS pj)"
    else
      PJ_SQL="(SELECT NULL AS pj)"
    fi
    logs_mb=$(du -sm "$HOME/.zcode/v2/logs" 2>/dev/null | cut -f1 || true); logs_mb=${logs_mb:-0}
    rollout_mb=$(du -sm "$HOME/.zcode/cli/rollout" 2>/dev/null | cut -f1 || true); rollout_mb=${rollout_mb:-0}
    artifacts_mb=$(du -sm "$HOME/.zcode/cli/artifacts" 2>/dev/null | cut -f1 || true); artifacts_mb=${artifacts_mb:-0}
    db_mb=$(du -m "$DB" 2>/dev/null | cut -f1 || true); db_mb=${db_mb:-0}
    META=$(qr "
      WITH U AS (SELECT * FROM model_usage $scope),
           P AS (SELECT provider_id AS v, row_number() OVER (ORDER BY provider_id)-1 AS i FROM (SELECT DISTINCT provider_id FROM U)),
           M AS (SELECT model_id AS v, row_number() OVER (ORDER BY model_id)-1 AS i FROM (SELECT DISTINCT model_id FROM U)),
           S AS (SELECT session_id AS v, row_number() OVER (ORDER BY session_id)-1 AS i FROM (SELECT DISTINCT session_id FROM U)),
           PJ AS $PJ_SQL,
           R AS (SELECT * FROM U ORDER BY started_at DESC, id DESC LIMIT $limit)
      SELECT json_object(
        'session',$session_meta,
        'providers',(SELECT json_group_array(v) FROM (SELECT v,i FROM P ORDER BY i)),
        'models',(SELECT json_group_array(v) FROM (SELECT v,i FROM M ORDER BY i)),
        'sessions',(SELECT json_group_array(coalesce(se.title,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
        'sessionDirs',(SELECT json_group_array(coalesce(se.directory,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
        'tools',(SELECT COALESCE(json_group_array(json_array(tool_name, c, f, d)),'[]') FROM (SELECT tool_name, count(*) AS c, sum(status<>'completed') AS f, CAST(round(avg(duration_ms)) AS int) AS d FROM tool_usage $scope GROUP BY tool_name ORDER BY c DESC LIMIT 8)),
        'todos',(SELECT json_array(sum(CASE WHEN status='completed' THEN 1 ELSE 0 END), count(*)) FROM todo),
        'stability',(SELECT json_array(COALESCE(sum(retry_count),0), COALESCE(sum(cancelled_by_user),0), COALESCE(sum(CASE WHEN status='error' THEN 1 ELSE 0 END),0)) FROM U),
        'hours',(SELECT COALESCE(json_group_object(hr, c),'{}') FROM (SELECT strftime('%H', started_at/1000,'unixepoch','localtime') AS hr, count(*) AS c FROM U GROUP BY hr)),
        'compactions',(SELECT COALESCE(json_group_array(json_array(SI.i, c.cnt, c.maxpre, json(c.ts))),'[]') FROM (SELECT p.session_id AS sid, count(*) AS cnt, max(COALESCE(json_extract(p.data,'$.preCompactTokenCount'),0)) AS maxpre, json_group_array(strftime('%m-%d %H:%M', p.time_created/1000,'unixepoch','localtime')) AS ts FROM part p WHERE json_extract(p.data,'$.type')='compaction' GROUP BY p.session_id) c LEFT JOIN S SI ON SI.v = c.sid WHERE SI.i IS NOT NULL),
        'sessionTools',(SELECT COALESCE(json_group_array(json_array(SI.i, t.tool, t.c, t.ms)),'[]') FROM (SELECT session_id AS sid, tool_name AS tool, count(*) AS c, CAST(sum(duration_ms) AS int) AS ms FROM tool_usage GROUP BY session_id, tool_name) t LEFT JOIN S SI ON SI.v = t.sid WHERE SI.i IS NOT NULL),
        'disk', json('{"logs":$logs_mb,"rollout":$rollout_mb,"artifacts":$artifacts_mb,"db":$db_mb}'),
        'prices',(SELECT CASE
              WHEN pj IS NULL OR NOT json_valid(pj) THEN json('{}')
              ELSE json_object('currency', COALESCE(json_extract(pj,'$.currency'),'CNY'),
                   'models', COALESCE(CASE WHEN json_type(pj,'$.models')='object'
                     THEN (SELECT json_group_object(lower(je.key), json(je.value)) FROM json_each(pj,'$.models') je
                           WHERE lower(je.key) IN (SELECT lower(v) FROM M) AND json_type(je.value)='object')
                     ELSE (SELECT json_group_object(lower(je.key), json(je.value)) FROM json_each(pj) je
                           WHERE lower(je.key) IN (SELECT lower(v) FROM M) AND json_type(je.value)='object')
                   END, json('{}')))
            END FROM PJ),
        'total',(SELECT count(*) FROM U),
        'covered',(SELECT count(*) FROM R),
        'gen',(SELECT datetime('now','localtime')),
        'rows',(SELECT json_group_array(json_array(
                  SI.i, R.started_at, MI.i, PI.i,
                  R.input_tokens, R.output_tokens+R.reasoning_tokens, R.cache_read_input_tokens,
                  R.duration_ms,
                  CASE R.status WHEN 'completed' THEN 0 WHEN 'error' THEN 1 WHEN 'cancelled' THEN 2 ELSE 3 END,
                  CASE R.query_source WHEN 'main_turn' THEN 0 WHEN 'subagent' THEN 1 ELSE 2 END,
                  R.cache_creation_input_tokens, R.time_to_first_token_ms, R.id, R.retry_count))
                FROM R
                LEFT JOIN S SI ON SI.v = R.session_id
                LEFT JOIN M MI ON MI.v = R.model_id
                LEFT JOIN P PI ON PI.v = R.provider_id));")
    mkdir -p "$(dirname "$out")"
    {
      cat <<'UD_HEAD'
<div id="usage-dashboard">
<style>
/* ===== token 层：宿主变量之上派生，统一节奏（轻分隔、紧凑行、克制的色彩） ===== */
#usage-dashboard{
  --ud-soft:color-mix(in srgb,var(--border) 55%,transparent);
  --ud-accent:var(--primary,var(--viz-series-1,#6c7bd0));
  --ud-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased;
}
#usage-dashboard ::-webkit-scrollbar{width:8px;height:8px;}
#usage-dashboard ::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
#usage-dashboard ::-webkit-scrollbar-thumb:hover{background:var(--muted-foreground);}
#usage-dashboard :focus-visible{outline:2px solid var(--ud-accent);outline-offset:1px;border-radius:4px;}
#usage-dashboard h3{font-size:13px;font-weight:600;margin:20px 0 8px;letter-spacing:.01em;}
#usage-dashboard .num,#usage-dashboard .tabular-nums{font-variant-numeric:tabular-nums;}
/* ===== 分段控件（ud-toggle 组）：合体浅底 + 浮起选中块 ===== */
#usage-dashboard .viz-row{display:inline-flex;align-items:center;gap:2px;background:var(--muted);border-radius:8px;padding:2px;}
#usage-dashboard .ud-toggle{border:none;background:transparent;border-radius:6px;padding:2px 10px;font-size:12px;color:var(--muted-foreground);white-space:nowrap;}
#usage-dashboard .ud-toggle[aria-pressed="true"]{background:var(--card);color:var(--foreground);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.1);}
#usage-dashboard .ud-toggle:hover:not([aria-pressed="true"]){color:var(--foreground);}
#usage-dashboard .ud-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;vertical-align:-1px;}
/* ===== 顶部筛选区：一行流式排布，弱化容器感 ===== */
#usage-dashboard .viz-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin-bottom:4px;}
#usage-dashboard .viz-controls .form-label{margin:0;}
#usage-dashboard .viz-controls .form-select{width:auto;max-width:200px;padding:3px 8px;font-size:12px;border-radius:7px;}
#usage-dashboard .ud-sortable{cursor:pointer;user-select:none;}
#usage-dashboard .ud-sortable:hover{color:var(--foreground);}
#usage-dashboard .ud-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
#usage-dashboard .ud-tag{font-size:11px;color:var(--muted-foreground);background:var(--muted);border-radius:5px;padding:2px 7px;margin-left:6px;vertical-align:middle;}
#usage-dashboard .ud-click{cursor:pointer;}
#usage-dashboard .ud-flink{cursor:pointer;text-decoration:underline dotted var(--muted-foreground);text-underline-offset:3px;}
#usage-dashboard .ud-flink:hover{color:var(--foreground);}
/* ===== KPI 数字带：去卡片化，细分隔线分组的数字群 ===== */
#usage-dashboard .ud-band{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:6px 0 2px;}
#usage-dashboard .ud-band>div{padding:2px 18px;border-left:1px solid var(--ud-soft);min-width:0;}
#usage-dashboard .ud-band>div:first-child{border-left:none;padding-left:0;}
#usage-dashboard .ud-band .v{font-size:22px;font-weight:650;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.25;}
#usage-dashboard .ud-band .l{font-size:11.5px;color:var(--muted-foreground);margin-top:1px;}
#usage-dashboard .ud-band .s{font-size:11px;color:var(--muted-foreground);opacity:.8;margin-top:1px;}
@media (max-width:560px){#usage-dashboard .ud-band{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:12px;}#usage-dashboard .ud-band>div:nth-child(3){border-left:none;padding-left:0;}}
/* ===== 紧凑事实行：标签 + 色点 + 值，替代成片卡片 ===== */
#usage-dashboard .ud-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0 32px;border-top:1px solid var(--ud-soft);}
#usage-dashboard .ud-fact{display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px solid var(--ud-soft);font-size:12.5px;min-width:0;}
#usage-dashboard .ud-fact .fdot{width:7px;height:7px;border-radius:2px;flex:none;}
#usage-dashboard .ud-fact .fl{flex:1;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#usage-dashboard .ud-fact .fv{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
#usage-dashboard .ud-fact .fs{font-size:11px;color:var(--muted-foreground);font-weight:400;margin-left:5px;}
#usage-dashboard .ud-fact.ud-wide{grid-column:1/-1;flex-wrap:wrap;}
#usage-dashboard .ud-collapsed .ud-fact:nth-child(n+7){display:none;}
#usage-dashboard .ud-more{margin-top:6px;}
#usage-dashboard .ud-more .btn{font-size:11.5px;padding:1px 10px;margin:0;}
#usage-dashboard .ud-budget-bar{flex:0 0 110px;height:5px;border-radius:3px;background:var(--muted);overflow:hidden;}
#usage-dashboard .ud-budget-bar>i{display:block;height:100%;background:var(--ud-accent);border-radius:3px;}
#usage-dashboard .ud-budget-bar.ud-over>i{background:var(--red,var(--viz-series-1));}
/* ===== 图例（构成/趋势） ===== */
#usage-dashboard .ud-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0;}
#usage-dashboard .ud-legend .form-check{display:inline-flex;align-items:center;gap:4px;margin:0;}
#usage-dashboard .ud-leg{display:flex;flex-direction:column;gap:4px;min-width:0;}
#usage-dashboard .ud-leg-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;line-height:1.5;padding:1px 4px;margin:0 -4px;border-radius:5px;}
#usage-dashboard .ud-leg-row:hover{background:var(--muted);}
#usage-dashboard .ud-leg-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#usage-dashboard .ud-leg-row .n{flex:0 0 auto;color:var(--muted-foreground);font-variant-numeric:tabular-nums;}
#usage-dashboard .ud-stack{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--muted);margin:8px 0 4px;gap:1px;}
#usage-dashboard .ud-stack span{height:100%;}
/* ===== 页签：下划线式，弱化胶囊感 ===== */
#usage-dashboard .nav.nav-pills{display:flex;gap:2px;border-bottom:1px solid var(--ud-soft);margin:14px 0 12px;flex-wrap:wrap;}
#usage-dashboard .nav-pills .nav-link{border-radius:6px 6px 0 0;padding:5px 12px;font-size:12.5px;color:var(--muted-foreground);background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;}
#usage-dashboard .nav-pills .nav-link.active{color:var(--foreground);font-weight:600;background:none;border-bottom-color:var(--ud-accent);}
#usage-dashboard .nav-pills .nav-link:hover:not(.active){color:var(--foreground);background:var(--muted);}
/* ===== 表格：轻表头 + 细行分隔 + 柔和悬停 ===== */
#usage-dashboard table{font-size:12.5px;}
#usage-dashboard thead th{font-size:11px;font-weight:500;color:var(--muted-foreground);border-bottom:1px solid var(--border);white-space:nowrap;background:transparent;}
#usage-dashboard td{border-color:var(--ud-soft);}
#usage-dashboard tbody tr{transition:background .12s;}
#usage-dashboard tbody tr:hover td{background:color-mix(in srgb,var(--muted) 40%,transparent);}
#usage-dashboard .ud-exp td{background:var(--muted);padding:12px 14px;}
#usage-dashboard .table-responsive{overflow-x:auto;}
#usage-dashboard #ud-detail table{min-width:1080px;}
#usage-dashboard #ud-sessions table{min-width:900px;}
#usage-dashboard #ud-errors table{min-width:760px;}
#usage-dashboard .ud-pager{display:flex;align-items:center;gap:10px;margin-top:10px;}
#usage-dashboard .ud-pager .btn{margin-top:0;}
/* ===== 横幅（本轮统计）：呼吸脉点的浅色条 ===== */
#usage-dashboard .ud-turn{display:flex;align-items:baseline;gap:8px;padding:8px 12px;margin:0 0 12px;border-radius:10px;background:color-mix(in srgb,var(--ud-accent) 7%,var(--card));border:1px solid color-mix(in srgb,var(--ud-accent) 16%,transparent);font-size:12.5px;line-height:1.6;}
#usage-dashboard .ud-turn::before{content:'';align-self:center;width:7px;height:7px;border-radius:50%;background:var(--ud-accent);flex:none;animation:ud-pulse 2.4s ease-in-out infinite;}
@keyframes ud-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--ud-accent) 28%,transparent);}50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--ud-accent) 28%,transparent);}}
#usage-dashboard .ud-turn[hidden]{display:none;}
#usage-dashboard .ud-turn-t{color:var(--muted-foreground);white-space:nowrap;font-size:11px;margin-left:auto;padding-left:12px;}
/* ===== 会话详情三列 + 时间线 ===== */
#usage-dashboard .ud-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start;}
@media (max-width:900px){#usage-dashboard .ud-grid3{grid-template-columns:1fr;}}
#usage-dashboard .ud-timeline{position:relative;margin:6px 0 0 4px;padding-left:14px;border-left:2px solid var(--ud-soft);}
#usage-dashboard .ud-tl-item{position:relative;display:flex;gap:10px;align-items:baseline;padding:3px 0;font-size:12px;}
#usage-dashboard .ud-tl-dot{position:absolute;left:-20px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 3px var(--card);}
#usage-dashboard .ud-tl-dot.ud-tl-c{background:var(--yellow);}
#usage-dashboard .ud-tl-dot.ud-tl-m{background:var(--viz-series-1);}
#usage-dashboard .ud-tl-dot.ud-tl-more{background:var(--muted-foreground);}
#usage-dashboard .ud-tl-t{font-variant-numeric:tabular-nums;color:var(--muted-foreground);flex:0 0 auto;}
#usage-dashboard .ud-tl-x{color:var(--foreground);}
#usage-dashboard .ud-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px 16px;margin:4px 0;}
#usage-dashboard .ud-kv-l{font-size:11px;color:var(--muted-foreground);}
#usage-dashboard .ud-kv-v{font-size:13px;font-weight:500;}
#usage-dashboard .ud-sec{margin-top:14px;}
#usage-dashboard pre.ud-raw{font-size:11px;background:var(--muted);border-radius:8px;padding:8px 10px;overflow-x:auto;white-space:pre;}
/* ===== 设置弹窗：毛玻璃遮罩 + 悬浮面板 + 吸顶标题 ===== */
#usage-dashboard #ud-mgr-mask{position:fixed;inset:0;background:rgba(0,0,0,.42);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;}
#usage-dashboard #ud-mgr-mask[hidden]{display:none;}
#usage-dashboard .ud-mgr-panel{width:min(720px,96vw);max-height:88vh;overflow:auto;border-radius:14px;border:1px solid var(--border);background:var(--card);box-shadow:0 16px 48px rgba(0,0,0,.22);}
#usage-dashboard .ud-mgr-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--ud-soft);background:color-mix(in srgb,var(--card) 86%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}
#usage-dashboard .ud-mgr-head h3{margin:0;font-size:14px;font-weight:650;}
#usage-dashboard .ud-mgr-body{padding:14px 18px 18px;}
#usage-dashboard .ud-mgr-t input{width:86px;padding:3px 8px;font-size:12px;border-radius:6px;}
#usage-dashboard .ud-mgr-h{font-size:12.5px;font-weight:600;margin:18px 0 8px;padding-top:14px;border-top:1px solid var(--ud-soft);}
#usage-dashboard .ud-mgr-h:first-child{border-top:none;padding-top:0;margin-top:0;}
#usage-dashboard .ud-mgr-sub{font-size:11.5px;color:var(--muted-foreground);margin:2px 0 8px;}
#usage-dashboard .ud-sw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--ud-soft);}
#usage-dashboard .ud-sw-row:last-child{border-bottom:none;}
#usage-dashboard .ud-sw-row .form-check{margin:0;flex:none;}
</style>
UD_HEAD
      if [[ "$cmd" == dashboard-this ]]; then
        cat "$SCRIPT_DIR/../assets/session-dashboard.html"
      else
        cat <<'UD_ALL_HEAD'
<div id="ud-turn" class="ud-turn" hidden></div>
<div class="viz-controls" role="group" aria-label="用量筛选">
  <label class="form-label text-small text-muted" for="ud-f-pv">来源</label>
  <select class="form-select" id="ud-f-pv"></select>
  <label class="form-label text-small text-muted" for="ud-f-model">模型</label>
  <select class="form-select" id="ud-f-model"></select>
  <div class="viz-row" role="group" aria-label="时间范围" id="ud-f-range">
    <button type="button" class="ud-toggle" data-r="today" aria-pressed="true">今天</button>
    <button type="button" class="ud-toggle" data-r="7" aria-pressed="false">近 7 天</button>
    <button type="button" class="ud-toggle" data-r="30" aria-pressed="false">近 30 天</button>
    <button type="button" class="ud-toggle" data-r="all" aria-pressed="false">全部</button>
  </div>
  <span id="ud-sess-filter" class="ud-tag" hidden style="cursor:pointer" title="点击清除会话筛选"></span>
  <span id="ud-day-filter" class="ud-tag" hidden style="cursor:pointer" title="点击清除日期筛选"></span>
  <label class="form-check form-switch" id="ud-cost-wrap" hidden><input type="checkbox" class="form-check-input" id="ud-f-cost"><span class="form-check-label text-small">折算成本（API 牌价）</span></label>
  <button type="button" class="btn" id="ud-price-sync" style="margin:0;padding:2px 10px;font-size:12px">同步价格</button>
  <button type="button" class="btn" id="ud-price-mgr" style="margin:0;padding:2px 10px;font-size:12px">设置</button>
  <button type="button" class="btn" id="ud-export-report" style="margin:0;padding:2px 10px;font-size:12px">导出报表</button>
  <span class="text-small text-muted" id="ud-meta"></span>
</div>
<div id="ud-mgr-mask" hidden>
  <div class="ud-mgr-panel" role="dialog" aria-label="价格与预算设置">
    <div class="ud-mgr-head">
      <h3>设置</h3>
      <button type="button" class="btn" id="ud-mgr-close" style="margin:0;padding:2px 12px;font-size:12px">关闭</button>
    </div>
    <div class="ud-mgr-body" id="ud-mgr-body"></div>
  </div>
</div>
<div class="nav nav-pills" role="tablist" aria-label="用量视图">
  <button class="nav-link active" id="ud-tab-overview" role="tab" aria-controls="ud-overview" aria-selected="true" type="button">总览</button>
  <button class="nav-link" id="ud-tab-trend" role="tab" aria-controls="ud-trend" aria-selected="false" type="button">每日趋势</button>
  <button class="nav-link" id="ud-tab-sessions" role="tab" aria-controls="ud-sessions" aria-selected="false" type="button">会话排行</button>
  <button class="nav-link" id="ud-tab-models" role="tab" aria-controls="ud-models" aria-selected="false" type="button">模型效率</button>
  <button class="nav-link" id="ud-tab-detail" role="tab" aria-controls="ud-detail" aria-selected="false" type="button">请求明细</button>
  <button class="nav-link" id="ud-tab-errors" role="tab" aria-controls="ud-errors" aria-selected="false" type="button">失败请求</button>
</div>
<div id="ud-overview" role="tabpanel" aria-labelledby="ud-tab-overview">
  <div class="ud-band">
    <div><div class="v tabular-nums" id="ud-k1">–</div><div class="l">请求次数</div><div class="s" id="ud-k1c"></div></div>
    <div><div class="v tabular-nums" id="ud-k2">–</div><div class="l">输入 token</div><div class="s" id="ud-k2c"></div></div>
    <div><div class="v tabular-nums" id="ud-k3">–</div><div class="l">生成 token</div><div class="s" id="ud-k3c"></div></div>
    <div><div class="v tabular-nums" id="ud-k4">–</div><div class="l">活跃会话</div><div class="s" id="ud-k4c"></div></div>
  </div>
  <div class="ud-sec"><div class="ud-kv-l">用量洞察</div><div class="ud-facts" id="ud-insights" aria-live="polite"></div><div class="ud-more" id="ud-insights-more" hidden></div></div>
  <div class="ud-sec"><div class="ud-kv-l">性能体检</div><div class="ud-facts" id="ud-health"></div></div>
  <div id="ud-quota-card" hidden></div>
  <div class="ud-grid3">
    <div>
      <h3>来源构成</h3>
      <div id="ud-pv-stack"></div>
      <div id="ud-pv-rows"></div>
    </div>
    <div>
      <h3>模型分布</h3>
      <div id="ud-model-bars"></div>
    </div>
    <div>
      <h3>常用工具</h3>
      <div id="ud-tools-donut"></div>
    </div>
  </div>
  <h3>最活跃会话（Top 5）</h3>
  <div id="ud-top-sessions"></div>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h3 style="margin-bottom:0">时段分布</h3>
    <span class="viz-row" id="ud-hours-toggle" role="group" aria-label="时段分布指标">
      <button type="button" class="ud-toggle" data-m="req" aria-pressed="true">请求</button>
      <button type="button" class="ud-toggle" data-m="tok" aria-pressed="false">token</button>
      <span class="text-small text-muted" id="ud-hours-note"></span>
    </span>
  </div>
  <div id="ud-hours"></div>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h3 style="margin-bottom:0">活跃热力图</h3>
    <div class="viz-row" role="group" aria-label="热力图粒度" id="ud-heat-toggle">
      <button type="button" class="ud-toggle" data-hm="hour" aria-pressed="true">小时</button>
      <button type="button" class="ud-toggle" data-hm="day" aria-pressed="false">每日</button>
      <button type="button" class="ud-toggle" data-hm="week" aria-pressed="false">每周</button>
      <button type="button" class="ud-toggle" data-hm="month" aria-pressed="false">月历</button>
    </div>
  </div>
  <div id="ud-heatmap"></div>
</div>
<div id="ud-trend" role="tabpanel" aria-labelledby="ud-tab-trend" hidden>
  <div class="viz-row" role="group" aria-label="指标切换" id="ud-series-toggle">
    <button type="button" class="ud-toggle" data-m="req" aria-pressed="true"><span class="ud-swatch" style="background:var(--viz-series-1)"></span>请求数</button>
    <button type="button" class="ud-toggle" data-m="inn" aria-pressed="false"><span class="ud-swatch" style="background:var(--viz-series-1)"></span>输入 token</button>
    <button type="button" class="ud-toggle" data-m="out" aria-pressed="false"><span class="ud-swatch" style="background:var(--viz-series-1)"></span>生成 token</button>
    <button type="button" class="ud-toggle" data-m="ca" aria-pressed="false"><span class="ud-swatch" style="background:var(--viz-series-1)"></span>缓存读 token</button>
    <span class="text-small text-muted" id="ud-trend-readout" aria-live="polite"></span>
  </div>
  <div class="ud-legend" id="ud-pv-legend"></div>
  <div id="ud-trend-chart"></div>
  <div id="ud-daily-wrap"></div>
</div>
<div id="ud-sessions" role="tabpanel" aria-labelledby="ud-tab-sessions" hidden>
  <p class="text-small text-muted">点击表头排序，筛选条件在上方全局生效；点击行可展开会话详情。</p>
  <div class="table-responsive"><table class="table table-sm">
    <thead id="ud-sessions-head"></thead>
    <tbody id="ud-sessions-body"></tbody>
  </table></div>
</div>
<div id="ud-models" role="tabpanel" aria-labelledby="ud-tab-models" hidden>
  <p class="text-small text-muted">按模型对比效率与成本：平均输出速率（生成 token / 生成耗时）、平均首字延迟、失败率、每 1k token 折算成本。随上方全局筛选联动；点击模型名只看该模型。</p>
  <div class="table-responsive"><table class="table table-sm">
    <thead id="ud-models-head"></thead>
    <tbody id="ud-models-body"></tbody>
  </table></div>
</div>
<div id="ud-detail" role="tabpanel" aria-labelledby="ud-tab-detail" hidden>
  <p class="text-small text-muted">点击表头排序；点击任意请求行可展开该请求的完整信息。</p>
  <div class="viz-row">
    <label class="form-label text-small text-muted" for="ud-f-stat">状态</label>
    <select class="form-select" id="ud-f-stat">
      <option value="-1">全部状态</option>
      <option value="0">完成</option>
      <option value="1">失败</option>
      <option value="2">已取消</option>
      <option value="3">进行中</option>
    </select>
  </div>
  <div class="table-responsive"><table class="table table-sm">
    <thead id="ud-detail-head"></thead>
    <tbody id="ud-detail-body"></tbody>
  </table></div>
  <div class="ud-pager" id="ud-pager" aria-live="polite"></div>
</div>
<div id="ud-errors" role="tabpanel" aria-labelledby="ud-tab-errors" hidden>
  <div class="table-responsive"><table class="table table-sm">
    <thead><tr><th>时间</th><th>会话</th><th>模型</th><th>来源</th><th>类型</th><th>状态</th></tr></thead>
    <tbody id="ud-errors-body"></tbody>
  </table></div>
</div>
UD_ALL_HEAD
      fi
      cat <<'UD_DATA_HEAD'
<script>
const DATA =
UD_DATA_HEAD
      # JSON 位于 script 中：转义 < 防止会话标题中的 </script> 提前闭合标签。
      printf '%s\n' "${META//</\\u003c}"
      cat <<'UD_TAIL'
;
function __usageBoot(D) {
  var PV = D.providers || [], MD = D.models || [], TL = D.sessions || [], R = D.rows || [];
  var TOOLS = D.tools || [], SD = D.sessionDirs || [];
  var PRICE = (D.prices && typeof D.prices === 'object') ? D.prices : null;
  var PMODELS = PRICE && PRICE.models && typeof PRICE.models === 'object' ? PRICE.models : PRICE;
  var CURSYM = (function () {
    var c = PRICE && PRICE.currency;
    return { USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' }[c] || (c ? c + ' ' : '$');
  })();
  var $ = function (id) { return document.getElementById(id); };
  var N = function (v) { return v == null ? 0 : v; };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function fmt(n) { n = N(n); if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'; if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'; return String(Math.round(n)); }
  function fmtI(n) { return N(n).toLocaleString('zh-CN'); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fullTs(ts) { var d = new Date(ts); return dayKey(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  if (D.session) {
    $('ud-session-title').textContent = '会话用量 · ' + D.session.title;
    $('ud-session-last').textContent = '最近请求：' + (D.session.latest == null ? '暂无请求' : fullTs(D.session.latest)) + ' · 会话信息';
    $('ud-session-selection').textContent = '定位：' + D.session.selection;
    $('ud-session-info').textContent = '会话 ID：' + D.session.id + '\n项目目录：' + (D.session.directory || '–')
      + '\n创建：' + (D.session.created == null ? '–' : fullTs(D.session.created))
      + '\n仅统计该 session_id 的记录。';
  }

  var STAT = ['完成', '失败', '已取消', '进行中'];
  var SCOLOR = ['var(--green)', 'var(--red)', 'var(--yellow)', 'var(--blue)'];
  var QT = ['主会话', '子代理', '系统'];
  // tok/s：生成 = 输出+思考；生成耗时 ≈ 总耗时 - 首字（首字缺失按总耗时近似）
  function tpsOf(r) {
    var gen = Math.max(1, N(r[7]) - (r[11] == null ? 0 : N(r[11])));
    return Math.round(N(r[5]) / gen * 1000);
  }
  function tpsHtml(t) {
    var c = t >= 320 ? 'var(--viz-series-5)' : t >= 240 ? 'var(--red)' : t >= 160 ? 'var(--yellow)' : t >= 80 ? 'var(--green)' : 'var(--viz-series-1)';
    return '<span class="tabular-nums" style="color:' + c + '">' + fmtI(t) + '</span>';
  }
  // 甜甜圈图：items=[{name, value, extra}]，悬停显示名称/值/占比（点击不响应，纯展示）
  var PALETTE = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)', 'var(--viz-series-5)', 'var(--viz-series-6)'];
  function donut(items, centerLabel) {
    if (!items || !items.length) return '<p class="text-muted text-small">暂无数据</p>';
    var total = 0;
    items.forEach(function (it) { total += it.value; });
    if (!total) return '<p class="text-muted text-small">暂无数据</p>';
    var R1 = 52, R0 = 30, CX = 60, CY = 60;
    var a0 = -Math.PI / 2, paths = '', legend = '';
    items.slice(0, 6).forEach(function (it, i) {
      var frac = it.value / total;
      var a1 = a0 + frac * Math.PI * 2;
      var large = frac > 0.5 ? 1 : 0;
      var color = it.color || PALETTE[i % 6];
      var x0 = CX + R1 * Math.cos(a0), y0 = CY + R1 * Math.sin(a0);
      var x1 = CX + R1 * Math.cos(a1), y1 = CY + R1 * Math.sin(a1);
      var xi = CX + R0 * Math.cos(a1), yi = CY + R0 * Math.sin(a1);
      var xj = CX + R0 * Math.cos(a0), yj = CY + R0 * Math.sin(a0);
      var tipTxt = it.tip || (it.name + ' · ' + fmtI(it.value) + '（' + Math.round(frac * 100) + '%）');
      if (frac >= 0.999) {
        paths += '<circle cx="' + CX + '" cy="' + CY + '" r="' + ((R1 + R0) / 2) + '" fill="none" stroke="' + color + '" stroke-width="' + (R1 - R0) + '"><title>' + esc(tipTxt) + '</title></circle>';
      } else {
        paths += '<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R1 + ' ' + R1 + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + xi.toFixed(1) + ' ' + yi.toFixed(1) + ' A' + R0 + ' ' + R0 + ' 0 ' + large + ' 0 ' + xj.toFixed(1) + ' ' + yj.toFixed(1) + ' Z" fill="' + color + '" fill-opacity="0.88"><title>' + esc(tipTxt) + '</title></path>';
      }
      legend += '<div class="ud-leg-row"><span class="nm" title="' + esc(it.name) + '"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color + ';margin-right:5px"></i>' + esc(it.name) + '</span><span class="n">' + Math.round(frac * 100) + '%</span></div>';
      a0 = a1;
    });
    return '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="甜甜圈图" style="flex:0 0 auto">' + paths +
      '<text x="60" y="57" text-anchor="middle" font-size="11" fill="var(--muted-foreground)" pointer-events="none">' + esc(centerLabel || '') + '</text>' +
      '<text x="60" y="72" text-anchor="middle" font-size="13" font-weight="600" fill="var(--foreground)" pointer-events="none">' + esc(fmt(total)) + '</text></svg>' +
      '<div class="ud-leg" style="flex:1;min-width:150px">' + legend + '</div></div>';
  }
  function stHtml(s) { return '<span style="white-space:nowrap"><span style="color:' + SCOLOR[s] + '">●</span> ' + STAT[s] + '</span>'; }

  // 供应商：官方账号(account:*) / 自定义接入，按总 token 降序分配固定系列色
  var pvTot = PV.map(function (p, i) { var t = 0; R.forEach(function (r) { if (r[3] === i) t += N(r[4]) + N(r[5]); }); return { i: i, t: t }; })
    .sort(function (a, b) { return b.t - a.t; });
  var pvOrder = pvTot.map(function (x) { return x.i; });
  function pvColor(p) { var k = pvOrder.indexOf(p); return 'var(--viz-series-' + ((k % 6) + 1) + ')'; }
  // 官方套餐 provider id → 官方中文名（GLM Coding Plan 档位命名见 bigmodel.cn/glm-coding）；未知 id 与自定义来源保留原名
  var PV_CN = {
    'bigmodel-individual-coding-plan': 'GLM Coding Plan 个人版',
    'bigmodel-coding-plan': 'GLM Coding Plan',
    'bigmodel-lite-coding-plan': 'GLM Coding Plan Lite',
    'bigmodel-pro-coding-plan': 'GLM Coding Plan Pro',
    'bigmodel-max-coding-plan': 'GLM Coding Plan Max',
    'bigmodel-start-plan': 'GLM Coding Plan 入门版',
    'zai-start-plan': 'GLM Coding Plan 入门版'
  };
  function pvLabel(p) {
    var raw = String(PV[p] || '?');
    if (/^account:/.test(raw)) {
      var id = raw.replace(/^account:/, '');
      return esc(PV_CN[id] || id);
    }
    return esc(raw);
  }
  function pvTag(p) { return /^account:/.test(String(PV[p] || '')) ? '官方账号' : '自定义接入'; }

  function priceOf(mi) {
    if (!PMODELS) return null;
    var name = String(MD[mi] || '');
    var p = PMODELS[name] || PMODELS[name.toLowerCase()];
    if (!p) { for (var k in PMODELS) { if (k.toLowerCase() === name.toLowerCase()) { p = PMODELS[k]; break; } } }
    return p || null;
  }
  function tierMult(ts, t) {
    if (!t || !t.tiers) return 1;
    var d = new Date(ts);
    var h = d.getHours();
    if (typeof t.tz === 'number') h = ((d.getUTCHours() + t.tz) % 24 + 24) % 24;
    for (var i = 0; i < t.tiers.length; i++) {
      var tier = t.tiers[i] || {};
      var ws = tier.hours || [];
      for (var j = 0; j < ws.length; j++) {
        var b = ws[j][0], e = ws[j][1];
        if (b <= e ? (h >= b && h < e) : (h >= b || h < e)) return tier.mult == null ? 1 : tier.mult;
      }
    }
    return 1;
  }
  function rowCost(r) {
    var p = priceOf(r[2]);
    if (!p) return null;
    var base = N(r[4]) / 1e6 * N(p.in) + N(r[5]) / 1e6 * N(p.out) + N(r[6]) / 1e6 * N(p.cache);
    return base * tierMult(r[1], p.tariff);
  }
  function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : N(mb) + ' MB'; }
  function fmtCost(c) { return c == null ? '–' : CURSYM + (c >= 100 ? Math.round(c).toLocaleString('zh-CN') : c.toFixed(2)); }
  // 列表用短格式：小数字原样、大数 k/M，悬停（data-tip 即时层）看完整值；fmt() 的万/亿保留给卡片与图表
  function fmtK(n) {
    n = N(n);
    if (n < 1000) return String(Math.round(n));
    if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 2 : 1) + 'k';
    return (n / 1e6).toFixed(2) + 'M';
  }
  function tokCell(n) { n = N(n); return '<span data-tip="' + fmtI(n) + ' token" style="cursor:default">' + fmtK(n) + '</span>'; }
  function fmtDur(ms) {
    ms = N(ms);
    if (ms <= 0) return '0 ms';
    if (ms < 1000) return String(Math.round(ms)) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    var m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  }
  function durCell(ms) { ms = N(ms); return '<span data-tip="' + fmtI(ms) + ' ms" style="cursor:default">' + fmtDur(ms) + '</span>'; }

  var maxTs = 0;
  R.forEach(function (r) { if (r[1] > maxTs) maxTs = r[1]; });
  var cmpMap = {}, toolsMap = {};
  (D.compactions || []).forEach(function (c) { cmpMap[c[0]] = { cnt: c[1], pre: c[2], ts: c[3] || [] }; });
  (D.sessionTools || []).forEach(function (t) { (toolsMap[t[0]] || (toolsMap[t[0]] = [])).push([t[1], t[2], t[3]]); });

  var st = { p: -1, m: -1, s: -1, rng: 'today', day: null, hidePv: {} };
  var sortS = { k: 4, d: -1 }, sortD = { k: 0, d: -1 };
  var page = 1, pageSize = 50, sessShown = 50, detailStat = -1, curMetric = 'req', costOn = false;
  var heatMode = 'hour', heatLastW = -1, sessExp = -1, detExp = -1;
  var insightsOpen = false; // 洞察区折叠状态：默认只露 6 项，重渲染（筛选/保存后）保持

  function cutOf() {
    if (st.rng === 'all') return 0;
    if (st.rng === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    return maxTs - (st.rng === '7' ? 7 : 30) * 864e5;
  }
  function frows(ignorePv) {
    var cut = cutOf();
    return R.filter(function (r) {
      if (!ignorePv && st.p >= 0 && r[3] !== st.p) return false;
      if (st.m >= 0 && r[2] !== st.m) return false;
      if (st.s >= 0 && r[0] !== st.s) return false;
      if (st.day && dayKey(r[1]) !== st.day) return false;
      if (cut && r[1] < cut) return false;
      return true;
    });
  }
  function agg(rows) {
    var a = { req: rows.length, inn: 0, out: 0, ca: 0, ccw: 0, dur: 0, sub: 0, sids: {} };
    rows.forEach(function (r) {
      a.inn += N(r[4]); a.out += N(r[5]); a.ca += N(r[6]); a.ccw += N(r[10]); a.dur += N(r[7]);
      if (r[9] === 1) a.sub++;
      a.sids[r[0]] = 1;
    });
    a.sess = 0; for (var k in a.sids) a.sess++;
    a.tok = a.inn + a.out;
    return a;
  }
  function dayList(rows) {
    var s = {};
    rows.forEach(function (r) { s[dayKey(r[1])] = 1; });
    return Object.keys(s).sort();
  }

  function renderSession(rows) {
    var a = agg(rows), states = [0, 0, 0, 0];
    rows.forEach(function (r) { states[r[8]]++; });
    $('ud-k1').textContent = fmtI(a.req);
    $('ud-k1c').textContent = '完成 ' + fmtI(states[0]) + (states[3] ? ' · 进行中 ' + fmtI(states[3]) : '');
    $('ud-k2').textContent = fmt(a.inn);
    $('ud-k3').textContent = fmt(a.out);
    $('ud-k4').textContent = fmt(a.ca);
    $('ud-k4c').textContent = '缓存命中率 ' + (a.inn ? Math.round(a.ca / a.inn * 100) + '%' : '–');
    $('ud-meta').textContent = '本地快照 ' + (D.gen || '') + ' · 已加载 ' + fmtI(D.covered) + ' / ' + fmtI(D.total) + ' 条'
      + (D.covered < D.total ? '，统计仅含已加载记录' : '');
    var failures = states[1] + states[2];
    $('ud-failures').hidden = failures === 0;
    $('ud-failures').textContent = '查看失败 / 取消（' + fmtI(failures) + '）';
    $('ud-request-count').textContent = fmtI(rows.length) + ' 条';

    var groups = {}, models = {};
    rows.forEach(function (r) {
      var key = r[2] + ':' + r[3];
      var g = groups[key] || (groups[key] = { m: r[2], p: r[3], req: 0, inn: 0, out: 0, ca: 0 });
      g.req++; g.inn += N(r[4]); g.out += N(r[5]); g.ca += N(r[6]);
      models[r[2]] = true;
    });
    $('ud-model-count').textContent = Object.keys(models).length + ' 个模型';
    var list = Object.keys(groups).map(function (key) { return groups[key]; })
      .sort(function (a, b) { return (b.inn + b.out) - (a.inn + a.out); });
    $('ud-session-models').innerHTML = list.length ? list.map(function (g) {
      return '<tr><td>' + esc(MD[g.m]) + '</td><td>' + pvLabel(g.p) + '</td><td class="text-end tabular-nums">' + fmtI(g.req)
        + '</td><td class="text-end tabular-nums">' + fmtI(g.inn) + '</td><td class="text-end tabular-nums">' + fmtI(g.out)
        + '</td><td class="text-end tabular-nums">' + fmtI(g.ca) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="text-muted">该会话暂无模型请求</td></tr>';
  }

  function renderKpis(rows) {
    var a = agg(rows);
    var dcount = dayList(rows).length || 1;
    $('ud-k1').textContent = fmtI(a.req);
    $('ud-k1c').textContent = '日均 ' + fmt(a.req / dcount) + ' · 覆盖 ' + dcount + ' 天';
    $('ud-k2').textContent = fmt(a.inn);
    $('ud-k2c').textContent = '缓存读 ' + fmt(a.ca) + ' · 缓存写 ' + fmt(a.ccw);
    $('ud-k3').textContent = fmt(a.out);
    $('ud-k3c').textContent = '输出 + 思考 token';
    $('ud-k4').textContent = fmtI(a.sess);
    $('ud-k4c').textContent = a.sub ? '含子代理请求 ' + fmtI(a.sub) + ' 次' : '合计 ' + fmt(a.tok) + ' token';
    $('ud-meta').textContent = '数据截至 ' + (D.gen || '') + ' · 已加载最近 ' + fmtI(D.covered) + ' / ' + fmtI(D.total) + ' 条 · 仅统计本机';
  }

  function renderInsights(rows) {
    var a = agg(rows);
    var days = dayList(rows);
    // 连续天数：当前连续（今天/昨天截止）与最长连续
    var cur = 0, longest = 0, run = 0;
    var dayMs = days.map(function (k) { return new Date(k + 'T00:00:00').getTime(); });
    var lastMs = dayMs.length ? dayMs[dayMs.length - 1] : 0;
    var todayMs = new Date(new Date().toDateString()).getTime();
    for (var i = 0; i < dayMs.length; i++) {
      run = (i > 0 && dayMs[i] - dayMs[i - 1] === 864e5) ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    cur = lastMs && (todayMs - lastMs <= 864e5) ? run : 0;
    var peak = null, peakV = -1;
    var perDay = {};
    rows.forEach(function (r) { var k = dayKey(r[1]); perDay[k] = (perDay[k] || 0) + N(r[4]) + N(r[5]); });
    for (var k in perDay) { if (perDay[k] > peakV) { peakV = perDay[k]; peak = k; } }
    var hit = a.inn ? Math.round(a.ca / a.inn * 100) : 0;
    // 紧凑事实行：语义色只用于色点（蓝=活跃/耗时，绿=缓存/任务，黄=重试，红=浪费，紫=峰值/拆分，橙=成本，灰=体量）
    var C = { blue: 'var(--blue)', green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', purple: '#8b5cf6', gold: 'var(--viz-series-2,var(--yellow))', gray: 'var(--muted-foreground)' };
    function row(l, v, ac, s) {
      return '<div class="ud-fact"><span class="fdot" style="background:' + (C[ac] || C.gray) + '"></span><span class="fl">' + l + '</span><span class="fv">' + v + (s ? '<span class="fs">' + s + '</span>' : '') + '</span></div>';
    }
    var items = [];
    items.push(row('活跃天数', days.length + ' 天', 'blue'));
    items.push(row('连续活跃', cur + ' 天', 'blue', '最长 ' + longest));
    if (peak) items.push(row('峰值日', peak.slice(5), 'purple', fmt(peakV) + ' tok'));
    items.push(row('缓存命中率', hit + '%', 'green', '读 ' + fmt(a.ca)));
    if (a.ca + a.ccw > 0) items.push(row('缓存量（读+写）', fmt(a.ca + a.ccw), 'green'));
    if (D.todos && D.todos[1] > 0) items.push(row('任务完成', N(D.todos[0]) + '/' + D.todos[1], 'green', Math.round(N(D.todos[0]) / D.todos[1] * 100) + '%'));
    if (D.stability) items.push(row('重试 / 取消', fmtI(D.stability[0]) + ' / ' + fmtI(D.stability[1]), 'yellow'));
    if (a.req) items.push(row('平均耗时', (a.dur / a.req / 1000).toFixed(1) + ' s', 'blue'));
    if (a.sub) items.push(row('主会话 / 子代理', fmtI(a.req - a.sub) + ' / ' + fmtI(a.sub), 'purple'));
    if (D.hours) {
      var pk = -1, pv2 = -1;
      for (var hh = 0; hh < 24; hh++) { var kk2 = (hh < 10 ? '0' : '') + hh; var c2 = N(D.hours[kk2]); if (c2 > pv2) { pv2 = c2; pk = hh; } }
      if (pk >= 0) items.push(row('峰值时段', pk + ' 点', 'blue', fmtI(pv2) + ' 次'));
    }
    if (D.disk && D.disk.logs) items.push(row('数据体量', fmtMB(D.disk.logs), 'gray', '导出 ' + fmtMB(D.disk.rollout) + ' · 库 ' + fmtMB(D.disk.db)));
    var totalCost = 0, anyCost = false, unpricedTok = 0;
    rows.forEach(function (r) { var c = rowCost(r); if (c != null) { totalCost += c; anyCost = true; } else unpricedTok += N(r[4]) + N(r[5]); });
    if (anyCost) {
      var aTok = a.inn + a.out;
      items.push(row('折算成本（API 牌价）', fmtCost(totalCost), 'gold', unpricedTok > 0 && aTok ? '未定价 ' + Math.round(unpricedTok / aTok * 100) + '%' : ''));
    }
    // 本地预算：整宽行 + 进度条（日 / 30 天）
    if (st.budget && (N(st.budget.daily) > 0 || N(st.budget.monthly) > 0)) {
      var nowD = new Date();
      var dayStart = new Date(nowD.toDateString()).getTime();
      var mStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
      var dayCost = 0, mCost = 0;
      rows.forEach(function (r) { var c = rowCost(r); if (c == null) return; if (r[1] >= dayStart) dayCost += c; if (r[1] >= mStart) mCost += c; });
      var bd = N(st.budget.daily), bm = N(st.budget.monthly);
      function budgetRow(l, v, tot, pd) {
        return '<div class="ud-fact ud-wide"><span class="fdot" style="background:' + C.gold + '"></span><span class="fl">' + l + '</span>' +
          '<span class="ud-budget-bar' + (pd >= 100 ? ' ud-over' : '') + '"><i style="width:' + Math.min(100, pd) + '%"></i></span>' +
          '<span class="fv">' + v + '<span class="fs">/ ' + fmtCost(tot) + ' · ' + pd + '%</span></span></div>';
      }
      if (bd > 0) items.push(budgetRow('今日折算 / 日预算', fmtCost(dayCost), bd, Math.min(100, Math.round(dayCost / bd * 100))));
      if (bm > 0) items.push(budgetRow('本月折算 / 月预算', fmtCost(mCost), bm, Math.min(100, Math.round(mCost / bm * 100))));
    }
    // 浪费取证：失败/取消请求白耗的 token
    (function () {
      var wReq = 0, wTok = 0;
      rows.forEach(function (r) { if (r[8] === 1 || r[8] === 2) { wReq++; wTok += N(r[4]) + N(r[5]); } });
      if (wReq > 0) items.push(row('浪费取证', fmt(wTok) + ' tok', 'red', fmtI(wReq) + ' 次失败/取消'));
    })();
    var host = $('ud-insights');
    host.innerHTML = items.join('');
    // 降噪：默认只展示前 6 项，其余折叠进「展开全部」
    host.classList.toggle('ud-collapsed', !insightsOpen && items.length > 6);
    var more = $('ud-insights-more');
    more.hidden = items.length <= 6;
    if (items.length > 6) {
      more.innerHTML = '<button type="button" class="btn">' + (insightsOpen ? '收起洞察' : '展开全部 ' + items.length + ' 项') + '</button>';
    }
  }

  // 健康度体检：性能与稳定性紧凑行（全部本地聚合）
  function renderHealth(rows) {
    var host = $('ud-health');
    if (!host) return;
    var a = agg(rows);
    var CB = { blue: 'var(--blue)', green: 'var(--green)', yellow: 'var(--yellow)', red: 'var(--red)', purple: '#8b5cf6', gray: 'var(--muted-foreground)' };
    function hrow(l, v, ac, s) {
      return '<div class="ud-fact"><span class="fdot" style="background:' + (CB[ac] || CB.gray) + '"></span><span class="fl">' + l + '</span><span class="fv">' + v + (s ? '<span class="fs">' + s + '</span>' : '') + '</span></div>';
    }
    var out = '';
    var ttft = 0, tn = 0, genTok = 0, genMs = 0;
    rows.forEach(function (r) { var t = N(r[11]); if (t > 0) { ttft += t; tn++; } var d = N(r[7]) - t; if (d > 0) { genMs += d; genTok += N(r[5]); } });
    if (tn) out += hrow('平均首字', (ttft / tn / 1000).toFixed(2) + ' s', 'yellow', '首个 token 延迟');
    if (genMs > 0) out += hrow('生成速率', fmtI(Math.round(genTok / (genMs / 1000))) + ' tok/s', 'blue');
    if (D.stability && a) {
      var errPct = a.req ? Math.round(D.stability[2] / a.req * 1000) / 10 : 0;
      out += hrow('错误率', errPct + '%', 'red', '失败 / 全部');
    }
    var peakCtx = 0;
    (D.compactions || []).forEach(function (c) { if (N(c[2]) > peakCtx) peakCtx = N(c[2]); });
    if (peakCtx > 0) out += hrow('峰值上下文', fmt(peakCtx), 'purple', '压缩前最高');
    var toolMs = 0, toolC = 0;
    (D.sessionTools || []).forEach(function (t) { toolC += N(t[2]); toolMs += N(t[3]); });
    if (toolC) out += hrow('工具调用', fmtI(toolC) + ' 次', 'gray', '累计 ' + (toolMs / 1000).toFixed(0) + ' s');
    host.innerHTML = out;
  }

  function renderProviders(rows) {
    var per = PV.map(function (p, i) { return { i: i, req: 0, tok: 0, inn: 0, ca: 0, cost: 0, hasCost: false }; });
    rows.forEach(function (r) { var o = per[r[3]]; o.req++; o.tok += N(r[4]) + N(r[5]); o.inn += N(r[4]); o.ca += N(r[6]); var c = rowCost(r); if (c != null) { o.cost += c; o.hasCost = true; } });
    var tot = per.reduce(function (a, x) { return a + x.tok; }, 0);
    var act = per.filter(function (x) { return x.req > 0; }).sort(function (a, b) { return b.tok - a.tok; });
    if (!act.length) { $('ud-pv-stack').innerHTML = '<p class="text-muted">当前筛选下暂无数据</p>'; $('ud-pv-rows').innerHTML = ''; return; }
    $('ud-pv-stack').innerHTML = donut(act.slice(0, 6).map(function (x) {
      return { name: pvLabel(x.i), value: x.tok, color: pvColor(x.i), tip: pvLabel(x.i) + ' · ' + fmtI(x.req) + ' 次请求 · ' + fmt(x.tok) + ' tok · 缓存 ' + (x.inn ? Math.round(x.ca / x.inn * 100) : 0) + '%' + (costOn && x.hasCost ? ' · ' + fmtCost(x.cost) : '') };
    }), 'token');
    $('ud-pv-rows').innerHTML = act.map(function (x) {
      return '<div class="text-small" style="display:flex;justify-content:space-between;gap:8px;padding:3px 0">' +
        '<span><span class="ud-dot" style="background:' + pvColor(x.i) + '"></span>' + pvLabel(x.i) + '<span class="ud-tag">' + pvTag(x.i) + '</span></span>' +
        '<span class="tabular-nums text-muted">' + fmtI(x.req) + ' 次 · ' + fmt(x.tok) + ' token · ' + (tot ? (x.tok / tot * 100).toFixed(1) : 0) + '% · 缓存 ' + (x.inn ? Math.round(x.ca / x.inn * 100) : 0) + '%' + (costOn && x.hasCost ? ' · ' + fmtCost(x.cost) : '') + '</span></div>';
    }).join('');
  }

  function renderModels(rows) {
    var per = {};
    rows.forEach(function (r) {
      var o = per[r[2]] || (per[r[2]] = { req: 0, tok: 0, inn: 0, ca: 0 });
      o.req++; o.tok += N(r[4]) + N(r[5]); o.inn += N(r[4]); o.ca += N(r[6]);
    });
    var list = Object.keys(per).map(function (m) { return { m: m, req: per[m].req, tok: per[m].tok, hit: per[m].inn ? Math.round(per[m].ca / per[m].inn * 100) : 0 }; })
      .sort(function (a, b) { return b.tok - a.tok; }).slice(0, 8);
    var tot = list.reduce(function (a, x) { return a + x.tok; }, 0);
    $('ud-model-bars').innerHTML = list.length ? donut(list.slice(0, 6).map(function (x) {
      return { name: String(MD[x.m]), value: x.tok, tip: MD[x.m] + ' · ' + fmtI(x.req) + ' 次请求 · ' + fmt(x.tok) + ' tok · 缓存 ' + x.hit + '%' };
    }), 'token') + list.map(function (x) {
      var p = tot ? Math.round(x.tok / tot * 100) : 0;
      return '<div class="text-small" style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>' + esc(MD[x.m]) + '</span><span class="tabular-nums text-muted">' + fmtI(x.req) + ' 次 · ' + fmt(x.tok) + ' token · ' + p + '% · 缓存 ' + x.hit + '%</span></div>';
    }).join('') : '<p class="text-muted">当前筛选下暂无数据</p>';
  }

  function sessAgg(rows) {
    var per = {};
    rows.forEach(function (r) {
      var o = per[r[0]] || (per[r[0]] = { tl: TL[r[0]] || '', req: 0, inn: 0, out: 0, ca: 0, sub: 0, last: 0, cost: 0, hasCost: false, err: 0, cancel: 0, retry: 0 });
      o.req++; o.inn += N(r[4]); o.out += N(r[5]); o.ca += N(r[6]); if (r[1] > o.last) o.last = r[1];
      if (r[9] === 1) o.sub++;
      if (r[8] === 1) o.err++; else if (r[8] === 2) o.cancel++;
      o.retry += N(r[13]);
      var c = rowCost(r); if (c != null) { o.cost += c; o.hasCost = true; }
    });
    return Object.keys(per).map(function (g) {
      var o = per[g]; o.g = +g; o.tot = o.inn + o.out;
      o.rate = o.inn ? Math.round(o.ca / o.inn * 100) : 0;
      // 健康分：100 − 失败率×60 − 取消率×25 − 每请求重试率×10（封顶 15），可解释的纯本地加权
      o.health = Math.max(0, Math.min(100, Math.round(100 -
        (o.req ? o.err / o.req * 60 : 0) - (o.req ? o.cancel / o.req * 25 : 0) -
        Math.min(15, o.req ? o.retry / o.req * 10 : 0))));
      return o;
    });
  }
  function sessTitle(o) { return o.tl ? esc(o.tl) : '<span class="text-muted">（无标题）</span>'; }

  function renderTopSessions(rows) {
    var list = sessAgg(rows).sort(function (a, b) { return b.tot - a.tot; }).slice(0, 5);
    $('ud-top-sessions').innerHTML = list.length ? '<div class="table-responsive"><table class="table table-sm" style="min-width:520px;margin:0"><thead><tr><th>会话</th><th class="text-end">请求数</th><th class="text-end">token 合计</th><th class="text-end">最后活动</th></tr></thead><tbody>' +
      list.map(function (o) {
        return '<tr class="ud-click" data-sg="' + o.g + '" title="点击查看会话详情"><td>' + sessTitle(o) + '</td><td class="text-end tabular-nums">' + fmtI(o.req) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td><td class="text-end text-nowrap">' + fullTs(o.last) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="text-muted">当前筛选下暂无数据</p>';
    var donutEl = $('ud-tools-donut');
    if (donutEl) {
      donutEl.innerHTML = donut((D.tools || []).slice(0, 6).map(function (t) {
        return { name: String(t[0]).replace(/^mcp__/, ''), value: t[1], tip: String(t[0]).replace(/^mcp__/, '') + ' · ' + fmtI(t[1]) + ' 次调用' + (t[3] ? ' · 均 ' + fmtI(t[3]) + ' ms' : '') + (t[2] ? ' · 失败 ' + t[2] : '') };
      }), '调用');
    }
    Array.prototype.forEach.call($('ud-top-sessions').querySelectorAll('tr.ud-click'), function (tr) {
      tr.addEventListener('click', function () {
        sessExp = +tr.getAttribute('data-sg');
        var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-sessions"]');
        if (btn) btn.click();
        renderSessions(frows(false));
        var host = $('ud-sessions');
        if (host) host.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  var hourMetric = 'req';
  function renderHours(rows) {
    var host = $('ud-hours');
    if (!host) return;
    var w = host.clientWidth;
    if (!w) return;
    // 逐小时聚合：请求数 / token（输入+生成）/ 缓存率（与热力图同口径，随全局筛选）
    var H = D.hours || {};
    var reqArr = [], tokArr = [], caArr = [], innArr = [];
    for (var i = 0; i < 24; i++) { var kk = (i < 10 ? '0' : '') + i; reqArr.push(N(H[kk])); tokArr.push(0); caArr.push(0); innArr.push(0); }
    rows.forEach(function (r) {
      var hr = new Date(r[1]).getHours();
      tokArr[hr] += N(r[4]) + N(r[5]);
      caArr[hr] += N(r[6]);
      innArr[hr] += N(r[4]);
    });
    var arr = hourMetric === 'tok' ? tokArr : reqArr;
    var peak = 0;
    for (var i2 = 1; i2 < 24; i2++) if (arr[i2] > arr[peak]) peak = i2;
    var max = Math.max.apply(null, arr) || 1;
    var cw = Math.floor((w - 4) / 24);
    var bw = Math.max(3, cw - 3);
    var Hh = 92;
    var out = '';
    for (var i3 = 0; i3 < 24; i3++) {
      var bh = Math.round((Hh - 20) * arr[i3] / max);
      var x = 2 + i3 * cw;
      var cr = innArr[i3] ? Math.round(caArr[i3] / innArr[i3] * 100) + '%' : '–';
      out += '<rect x="' + x + '" y="' + (Hh - 18 - bh) + '" width="' + bw + '" height="' + bh + '" rx="2" fill="var(--viz-series-1)"' + (i3 === peak ? '' : ' fill-opacity="0.45"') + '><title>' + i3 + ':00–' + i3 + ':59 · ' + fmtI(reqArr[i3]) + ' 次请求 · ' + fmt(tokArr[i3]) + ' tok · 缓存 ' + cr + '</title></rect>';
      if (i3 % 3 === 0) out += '<text x="' + (x + bw / 2) + '" y="' + (Hh - 4) + '" text-anchor="middle" font-size="10" fill="var(--muted-foreground)">' + i3 + '</text>';
    }
    host.innerHTML = '<svg width="' + (cw * 24) + '" height="' + Hh + '" role="img" aria-label="24 小时用量分布"><desc>峰值 ' + peak + ' 点</desc>' + out + '</svg>';
    var note = $('ud-hours-note');
    if (note) note.textContent = hourMetric === 'tok' ? '峰值 ' + peak + ' 点 · ' + fmt(arr[peak]) + ' tok' : '峰值 ' + peak + ' 点 · ' + fmtI(arr[peak]) + ' 次请求';
  }
  function wireHoursToggle() {
    var wrap = $('ud-hours-toggle');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.ud-toggle'), function (b) {
      b.addEventListener('click', function () {
        hourMetric = b.dataset.m;
        Array.prototype.forEach.call(wrap.querySelectorAll('.ud-toggle'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        renderHours(frows(false));
      });
    });
  }
  function renderHeatmap(rows) {
    var host = $('ud-heatmap');
    if (!host) return;
    var w = host.clientWidth;
    if (!w) return;
    var per = {};
    rows.forEach(function (r) { var k = dayKey(r[1]); var o = per[k] || (per[k] = { req: 0, tok: 0 }); o.req++; o.tok += N(r[4]) + N(r[5]); });
    var days = Object.keys(per).sort();
    if (!days.length) { host.innerHTML = '<p class="text-muted">当前筛选下暂无数据</p>'; heatLastW = w; return; }
    var start = new Date(days[0] + 'T00:00:00'), end = new Date(days[days.length - 1] + 'T00:00:00');
    var cells = [];
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var k = dayKey(d.getTime());
      cells.push({ k: k, v: per[k] ? per[k].tok : 0, req: per[k] ? per[k].req : 0 });
    }
    var gap = 3, L = 2, T = 2;
    var out = '';
    function shade(v, qs) {
      if (v <= 0) return { fill: 'var(--muted)', op: '' };
      var f = 'var(--viz-series-1)';
      if (v <= qs[0]) return { fill: f, op: ' fill-opacity="0.35"' };
      if (v <= qs[1]) return { fill: f, op: ' fill-opacity="0.6"' };
      if (v <= qs[2]) return { fill: f, op: ' fill-opacity="0.85"' };
      return { fill: f, op: '' };
    }
    function rect(x, y, cw, ch, st2, tip) {
      return '<rect x="' + x + '" y="' + y + '" width="' + cw + '" height="' + ch + '" rx="3" fill="' + st2.fill + '"' + st2.op + '><title>' + esc(tip) + '</title></rect>';
    }
    if (heatMode === 'hour') {
      // 近 7 天 × 24 小时矩阵：行=天、列=小时，悬停看该小时请求/token
      // 近 7 天 = 今天回推 7 个自然日（不从数据取日期，停用日也要成行）
      var dayKeys7 = [];
      for (var di7 = 6; di7 >= 0; di7--) dayKeys7.push(dayKey(Date.now() - di7 * 86400000));
      var daySet = {};
      dayKeys7.forEach(function (k) { daySet[k] = 1; });
      var cells7 = dayKeys7.map(function (k) { var arr = []; for (var i = 0; i < 24; i++) arr.push({ tok: 0, req: 0 }); return { k: k, h: arr }; });
      var idx7 = {};
      dayKeys7.forEach(function (k, i) { idx7[k] = i; });
      rows.forEach(function (r) {
        var k = dayKey(r[1]);
        if (!daySet[k]) return;
        var c = cells7[idx7[k]].h[new Date(r[1]).getHours()];
        c.tok += N(r[4]) + N(r[5]); c.req++;
      });
      var hv = [];
      cells7.forEach(function (c) { c.h.forEach(function (x) { if (x.tok > 0) hv.push(x.tok); }); });
      hv.sort(function (a, b) { return a - b; });
      var hq = [0.25, 0.5, 0.75].map(function (pp) { return hv.length ? hv[Math.min(hv.length - 1, Math.floor(hv.length * pp))] : 1; });
      var CW = 16, CG = 2, LX = 46, TY = 20;
      var W4 = LX + 24 * (CW + CG) + 4, H4 = TY + 7 * (CW + CG) + 6;
      var out4 = '';
      [0, 6, 12, 18].forEach(function (hh) { out4 += '<text x="' + (LX + hh * (CW + CG)) + '" y="13" font-size="10" fill="var(--muted-foreground)">' + hh + '时</text>'; });
      cells7.forEach(function (c, di) {
        var lbl = c.k.slice(5) + ' ' + '日一二三四五六'[new Date(c.k + 'T00:00:00').getDay()];
        out4 += '<text x="2" y="' + (TY + di * (CW + CG) + 12.5) + '" font-size="10" fill="var(--muted-foreground)">' + lbl + '</text>';
        for (var hh = 0; hh < 24; hh++) {
          var x = c.h[hh];
          out4 += rect(LX + hh * (CW + CG), TY + di * (CW + CG), CW, CW, shade(x.tok, hq),
            c.k + ' ' + (hh < 10 ? '0' : '') + hh + ':00 · ' + fmtI(x.req) + ' 次请求 · ' + fmt(x.tok) + ' token');
        }
      });
      host.innerHTML = '<svg width="' + W4 + '" height="' + H4 + '" role="img" aria-label="近 7 天小时热力图"><desc>行=日期，列=0-23 时</desc>' + out4 + '</svg>' +
        '<div class="text-muted text-small" style="margin-top:6px">近 7 天，每天按 0–23 时切分；着色深浅按该小时 token 用量，悬停查看明细。</div>';
      heatLastW = w;
      return;
    }
    if (heatMode === 'month') {
      // 最近 3 个月月历：每格一天，着色同日热力（按 token 分位），悬停明细
      var vAll = cells.map(function (c) { return c.v; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
      var qs3 = [0.25, 0.5, 0.75].map(function (pp) { return vAll.length ? vAll[Math.min(vAll.length - 1, Math.floor(vAll.length * pp))] : 1; });
      var endD = new Date(days[days.length - 1] + 'T00:00:00');
      var mHtml = '';
      for (var mi = 2; mi >= 0; mi--) {
        var m0 = new Date(endD.getFullYear(), endD.getMonth() - mi, 1);
        var dim = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
        var lead = (new Date(m0.getFullYear(), m0.getMonth(), 1).getDay() + 6) % 7;
        var g = '<div style="min-width:212px"><div class="text-small text-muted" style="margin:2px 0 4px">' + (m0.getFullYear() + ' 年 ' + (m0.getMonth() + 1) + ' 月') + '</div><div style="display:grid;grid-template-columns:repeat(7,26px);gap:3px">';
        '一二三四五六'.split('').forEach(function (w) { g += '<div class="text-muted" style="font-size:10px;text-align:center">' + w + '</div>'; });
        for (var e = 0; e < lead; e++) g += '<div></div>';
        for (var dd = 1; dd <= dim; dd++) {
          var mk = m0.getFullYear() + '-' + pad(m0.getMonth() + 1) + '-' + pad(dd);
          var c = cells.find(function (x) { return x.k === mk; });
          var vv = c ? c.v : 0;
          var st2 = shade(vv, qs3);
          g += '<div class="ud-mcal-day" data-tip="' + mk + ' · ' + fmtI(c ? c.req : 0) + ' 次请求 · ' + fmt(vv) + ' token" style="width:26px;height:22px;border-radius:3px;background:' + st2.fill + ';opacity:' + (st2.op ? st2.op.replace(' fill-opacity="', '').replace('"', '') : (vv > 0 ? 1 : 0.35)) + ';font-size:9px;line-height:22px;text-align:center;color:var(--muted-foreground)">' + dd + '</div>';
        }
        g += '</div></div>';
        mHtml += g;
      }
      host.innerHTML = '<div style="display:flex;gap:16px;flex-wrap:wrap">' + mHtml + '</div><div class="text-muted text-small" style="margin-top:6px">着色深浅按当日 token 用量，悬停查看明细。</div>';
      heatLastW = w;
      return;
    }
    if (heatMode === 'week') {
      var lead0 = (new Date(cells[0].k + 'T00:00:00').getDay() + 6) % 7;
      var weeks = [], wk = null;
      cells.forEach(function (c, i) {
        var wi = Math.floor((lead0 + i) / 7);
        if (!wk || wk.i !== wi) { wk = { i: wi, k: c.k, v: 0, req: 0 }; weeks.push(wk); }
        wk.v += c.v; wk.req += c.req;
      });
      var wv = weeks.map(function (x) { return x.v; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
      var wq = [0.25, 0.5, 0.75].map(function (pp) { return wv.length ? wv[Math.min(wv.length - 1, Math.floor(wv.length * pp))] : 1; });
      var cw = Math.min(40, Math.floor((w - L - (weeks.length - 1) * gap) / Math.max(1, weeks.length)));
      var ch = Math.min(28, Math.max(14, cw));
      var W2 = L + weeks.length * (cw + gap), H2 = T + ch + 24;
      var lastM = '';
      weeks.forEach(function (x, i) {
        var x0 = L + i * (cw + gap);
        var mk = x.k.slice(0, 7);
        if (mk !== lastM) { lastM = mk; out += '<text x="' + x0 + '" y="' + (T + ch + 16) + '" font-size="10" fill="var(--muted-foreground)">' + Number(x.k.slice(5, 7)) + '月</text>'; }
        out += rect(x0, T, cw, ch, shade(x.v, wq), x.k + ' 当周 · ' + fmtI(x.req) + ' 次请求 · ' + fmt(x.v) + ' token');
      });
      host.innerHTML = '<svg width="' + W2 + '" height="' + H2 + '" role="img" aria-label="活跃热力图（每周 token）"><desc>共 ' + weeks.length + ' 周</desc>' + out + '</svg>';
      heatLastW = w;
      return;
    }
    var minCw = 6;
    var maxCols = Math.max(1, Math.floor((w - L - minCw) / (minCw + gap)));
    var maxCells = maxCols * 7;
    if (cells.length > maxCells) { cells = cells.slice(-maxCells); }
    start = new Date(cells[0].k + 'T00:00:00');
    var lead = (start.getDay() + 6) % 7;
    var cols = Math.ceil((lead + cells.length) / 7);
    var cw = Math.min(16, Math.floor((w - L - (cols - 1) * gap) / cols));
    var ch = cw;
    var W2 = L + cols * (cw + gap), H2 = T + 7 * (ch + gap) + 24;
    var dv = cells.map(function (c) { return c.v; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    var dq = [0.25, 0.5, 0.75].map(function (pp) { return dv.length ? dv[Math.min(dv.length - 1, Math.floor(dv.length * pp))] : 1; });
    var lastM = '';
    cells.forEach(function (c, i) {
      var pos = lead + i;
      var col = Math.floor(pos / 7), row = pos % 7;
      var x = L + col * (cw + gap), y = T + row * (ch + gap);
      if (row === 0) {
        var mk = c.k.slice(0, 7);
        if (mk !== lastM) {
          lastM = mk;
          out += '<text x="' + x + '" y="' + (T + 7 * (ch + gap) + 16) + '" font-size="10" fill="var(--muted-foreground)">' + Number(c.k.slice(5, 7)) + '月</text>';
        }
      }
      out += rect(x, y, cw, ch, shade(c.v, dq), c.k + ' · ' + fmtI(c.req) + ' 次请求 · ' + fmt(c.v) + ' token');
    });
    host.innerHTML = '<svg width="' + W2 + '" height="' + H2 + '" role="img" aria-label="活跃热力图（每日 token）"><desc>共 ' + cells.length + ' 天，' + dv.length + ' 天有用量</desc>' + out + '</svg>';
    heatLastW = w;
  }

  function sessionDetailHTML(o) {
    var rs = R.filter(function (r) { return r[0] === o.g; }).sort(function (a, b) { return a[1] - b[1]; });
    var dir = SD[o.g] ? esc(SD[o.g]) : '<span class="text-muted">–</span>';
    var mm = {}, pv2 = {};
    rs.forEach(function (r) {
      var nm = String(MD[r[2]] || '?').toLowerCase();
      mm[nm] = (mm[nm] || 0) + N(r[4]) + N(r[5]);
      pv2[r[3]] = (pv2[r[3]] || 0) + 1;
    });
    var mix = donut(Object.keys(mm).sort(function (a, b) { return mm[b] - mm[a]; }).map(function (k) {
      return { name: k, value: mm[k], tip: k + ' · ' + fmt(mm[k]) + ' tok（' + Math.round(mm[k] / (mtot() || 1) * 100) + '%）' };
    }), 'token');
    function mtot() { var t = 0; for (var k2 in mm) t += mm[k2]; return t; }
    var pvm = Object.keys(pv2).map(function (k) { return '<span class="text-small text-muted">' + pvLabel(k) + ' ×' + pv2[k] + '</span>'; }).join(' · ');
    var tl = (toolsMap[o.g] || []).slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6)
      .map(function (t) { return '<span class="text-small text-muted">' + esc(String(t[0]).replace(/^mcp__/, '')) + ' ×' + fmtI(t[1]) + '</span>'; }).join(' · ');
    var cm = cmpMap[o.g];
    var cmpHtml = cm ? '压缩 ' + cm.cnt + ' 次 · 压缩前水位最高 ' + fmt(cm.pre) + ' token' : '无压缩记录';
    // 事件时间线：压缩事件（META 带时间）+ 模型切换（相邻请求模型变化推导），按时间归并
    var events = [];
    (cm ? cm.ts : []).forEach(function (t) { events.push({ t: t, label: '上下文压缩' }); });
    var prevM = -1;
    rs.forEach(function (r) {
      if (prevM !== -1 && r[2] !== prevM) {
        var d = new Date(r[1]);
        events.push({ t: pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), label: '切换模型 → ' + (MD[r[2]] || '?') });
      }
      prevM = r[2];
    });
    events.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var tl8 = events.length
      ? '<div class="ud-sec"><div class="ud-kv-l">事件时间线</div><div class="ud-timeline">' +
        events.slice(-12).map(function (e) {
          var cls = e.label.indexOf('压缩') >= 0 ? 'ud-tl-c' : 'ud-tl-m';
          return '<div class="ud-tl-item"><span class="ud-tl-dot ' + cls + '"></span><span class="ud-tl-t">' + esc(e.t) + '</span><span class="ud-tl-x">' + esc(e.label) + '</span></div>';
        }).join('') +
        (events.length > 12 ? '<div class="ud-tl-item"><span class="ud-tl-dot ud-tl-more"></span><span class="ud-tl-t">…</span><span class="ud-tl-x text-muted">共 ' + events.length + ' 个事件</span></div>' : '') +
        '</div></div>'
      : '';
    // 主会话 / 子代理拆分（rows r[9]：0 主会话 1 子代理 2 系统）
    var subTok = 0, subReq = 0, mainTok = 0, mainReq = 0;
    rs.forEach(function (r) {
      var t = N(r[4]) + N(r[5]);
      if (r[9] === 1) { subTok += t; subReq++; } else { mainTok += t; mainReq++; }
    });
    var W = 600, H = 96, maxIn = 1;
    rs.forEach(function (r) { if (N(r[4]) > maxIn) maxIn = N(r[4]); });
    var pts = [], dots = [];
    rs.forEach(function (r, i) {
      var x = rs.length > 1 ? i / (rs.length - 1) * (W - 8) + 4 : W / 2;
      var y = H - 8 - (H - 16) * N(r[4]) / maxIn;
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      var d = new Date(r[1]);
      var tt = pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var st = r[8] === 0 ? '完成' : r[8] === 1 ? '失败' : r[8] === 2 ? '已取消' : '进行中';
      dots.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (rs.length > 60 ? 2.4 : 3.4) + '" fill="var(--viz-series-1)" fill-opacity="0.85"><title>' + esc(tt) + ' · 输入 ' + fmt(N(r[4])) + ' tok · 生成 ' + fmt(N(r[5])) + ' tok · ' + esc(MD[r[2]] || '?') + ' · ' + st + (r[9] === 1 ? ' · 子代理' : '') + '</title></circle>');
    });
    var startT = fullTs(rs.length ? rs[0][1] : 0), endT = fullTs(o.last);
    var curve = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="上下文水位曲线">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--viz-series-1)" stroke-width="1.5"/>' + dots.join('') + '</svg>';
    // 起止时间直接标在水位曲线两端上方
    var curveWrap = '<div style="position:relative">' +
      '<span class="text-small text-muted" style="position:absolute;left:0;top:0">' + esc(startT) + '</span>' +
      '<span class="text-small text-muted" style="position:absolute;right:0;top:0;text-align:right">' + esc(endT) + '</span>' +
      '<div style="padding-top:16px">' + curve + '</div></div>';
    var curveHead = '<div class="ud-kv-l" style="margin:2px 0 2px">按请求输入 token 近似 · 峰值 ' + fmt(maxIn) + ' · 悬停看点明细</div>';
    var toolDonut = (toolsMap[o.g] || []).length
      ? donut((toolsMap[o.g] || []).slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6).map(function (t) {
          return { name: String(t[0]).replace(/^mcp__/, ''), value: t[1], tip: String(t[0]).replace(/^mcp__/, '') + ' · ' + fmtI(t[1]) + ' 次调用' + (t[3] ? ' · 累计 ' + fmtI(t[3]) + ' ms' : '') };
        }), '调用')
      : '<span class="text-muted text-small">无工具调用</span>';
    function kv(l, v) { return '<div><div class="ud-kv-l">' + l + '</div><div class="ud-kv-v">' + v + '</div></div>'; }
    // 主/子代理 token 拆分条（双色堆叠，悬停看明细；rows r[9]：0 主会话 1 子代理）
    var tot2 = mainTok + subTok;
    var subBar = tot2 > 0
      ? '<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin:6px 0 6px;max-width:460px">' +
        (mainTok > 0 ? '<div data-tip="主会话 · ' + fmtI(mainReq) + ' 次 · ' + fmt(mainTok) + ' tok（' + Math.round(mainTok / tot2 * 100) + '%）" style="width:' + (mainTok / tot2 * 100) + '%;background:var(--viz-series-1)"></div>' : '') +
        (subTok > 0 ? '<div data-tip="子代理 · ' + fmtI(subReq) + ' 次 · ' + fmt(subTok) + ' tok（' + Math.round(subTok / tot2 * 100) + '%）" style="width:' + (subTok / tot2 * 100) + '%;background:var(--viz-series-3)"></div>' : '') +
        '</div><div class="text-small text-muted">' +
        (mainReq ? '<span style="color:var(--viz-series-1)">■</span> 主会话 ' + fmt(mainTok) + ' tok × ' + fmtI(mainReq) : '') +
        (subReq ? (mainReq ? '　' : '') + '<span style="color:var(--viz-series-3)">■</span> 子代理 ' + fmt(subTok) + ' tok × ' + fmtI(subReq) : '') + '</div>'
      : '';
    return '<div class="ud-sec"><div class="ud-kv-l">项目目录</div><div class="ud-kv-v" style="word-break:break-all">' + dir + '</div>' +
      (subReq ? subBar : '') +
      (pvm ? '<div class="text-small text-muted" style="margin-top:4px">来源：' + pvm + '</div>' : '') + '</div>' +
      '<div class="ud-kv">' +
      kv('请求 / 缓存率', fmtI(o.req) + ' 次 · ' + o.rate + '%') +
      (function () {
        var gen = 0, ms = 0;
        rs.forEach(function (r) { gen += N(r[5]); ms += Math.max(1, N(r[7]) - (r[11] == null ? 0 : N(r[11]))); });
        return ms > 0 ? kv('平均输出速率', tpsHtml(Math.round(gen / ms * 1000)) + ' tok/s（加权）') : '';
      })() +
      (subReq ? kv('主会话 / 子代理', fmtI(mainReq) + ' 次 · ' + fmt(mainTok) + ' tok <span class="text-muted">/</span> ' + fmtI(subReq) + ' 次 · ' + fmt(subTok) + ' tok') : '') +
      kv('上下文压缩', cmpHtml) +
      (costOn && o.hasCost ? kv('折算成本', fmtCost(o.cost)) : '') +
      '</div>' +
      '<div class="ud-grid3" style="margin-top:14px">' +
      '<div><div class="ud-kv-l">模型占比（按 token）</div>' + mix +
      '<button type="button" class="btn ud-sess-logs" data-sg="' + o.g + '" style="margin:8px 0 0;padding:2px 10px;font-size:12px">查看该会话请求日志 →</button></div>' +
      '<div><div class="ud-kv-l">使用工具（调用次数占比）</div>' + toolDonut + '</div>' +
      '<div>' + (tl8 || '<div class="ud-kv-l">事件时间线</div><span class="text-muted text-small">无压缩 / 模型切换事件</span>') + '</div>' +
      '</div>' +
      '<div class="ud-sec" style="margin-top:14px">' + curveHead + curveWrap + '</div>';
  }
  function renderModelBoard(rows) {
    var headEl = $('ud-models-head'), bodyEl = $('ud-models-body');
    if (!headEl || !bodyEl) return;
    var per = {};
    rows.forEach(function (r) {
      var o = per[r[2]] || (per[r[2]] = { req: 0, inn: 0, out: 0, ca: 0, err: 0, genMs: 0, ttft: 0, ttftN: 0, cost: 0, hasCost: false });
      o.req++; o.inn += N(r[4]); o.out += N(r[5]); o.ca += N(r[6]);
      if (r[8] === 1) o.err++;
      if (r[8] === 0) o.genMs += Math.max(1, N(r[7]) - (r[11] == null ? 0 : N(r[11])));
      if (r[11] != null) { o.ttft += N(r[11]); o.ttftN++; }
      var c = rowCost(r); if (c != null) { o.cost += c; o.hasCost = true; }
    });
    var list = Object.keys(per).map(function (m) {
      var o = per[m]; o.m = m; o.tot = o.inn + o.out;
      o.tps = o.genMs > 0 ? Math.round(o.out / o.genMs * 1000) : null;
      o.avgTtft = o.ttftN ? Math.round(o.ttft / o.ttftN) : null;
      o.rate = o.inn ? Math.round(o.ca / o.inn * 100) : 0;
      o.errRate = o.req ? Math.round(o.err / o.req * 100) : 0;
      o.per1k = o.hasCost && o.tot > 0 ? o.cost / (o.tot / 1000) : null;
      return o;
    }).sort(function (a, b) { return b.tot - a.tot; });
    headEl.innerHTML = '<tr><th>模型</th><th class="text-end">请求数</th><th class="text-end">平均 tok/s</th><th class="text-end">平均首字</th><th class="text-end">失败率</th><th class="text-end">输入 token</th><th class="text-end">生成 token</th><th class="text-end">合计</th><th class="text-end">缓存率</th>' + (costOn ? '<th class="text-end">折算成本</th><th class="text-end">成本 / 1k tok</th>' : '') + '</tr>';
    bodyEl.innerHTML = list.length ? list.map(function (o) {
      return '<tr><td class="ud-flink" data-k="m" data-v="' + o.m + '" title="点击只看该模型">' + esc(MD[o.m]) + '</td>' +
        '<td class="text-end tabular-nums">' + fmtI(o.req) + '</td>' +
        '<td class="text-end">' + (o.tps == null ? '–' : tpsHtml(o.tps)) + '</td>' +
        '<td class="text-end tabular-nums">' + (o.avgTtft == null ? '–' : durCell(o.avgTtft)) + '</td>' +
        '<td class="text-end tabular-nums" style="color:' + (o.errRate >= 10 ? 'var(--red)' : o.errRate > 0 ? 'var(--yellow)' : 'inherit') + '">' + o.errRate + '%</td>' +
        '<td class="text-end tabular-nums">' + tokCell(o.inn) + '</td><td class="text-end tabular-nums">' + tokCell(o.out) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td>' +
        '<td class="text-end tabular-nums">' + o.rate + '%</td>' +
        (costOn ? '<td class="text-end tabular-nums">' + (o.hasCost ? fmtCost(o.cost) : '–') + '</td><td class="text-end tabular-nums">' + (o.per1k == null ? '–' : fmtCost(o.per1k)) + '</td>' : '') +
        '</tr>';
    }).join('') : '<tr><td colspan="11" class="text-muted">当前筛选下暂无数据</td></tr>';
    if (!bodyEl.dataset.flinkBound) {
      bodyEl.dataset.flinkBound = '1';
      bodyEl.addEventListener('click', function (e) {
        var fl = e.target.closest ? e.target.closest('.ud-flink') : null;
        if (!fl) return;
        st.m = (st.m === +fl.dataset.v ? -1 : +fl.dataset.v);
        var ms = $('ud-f-model');
        if (ms) ms.value = String(st.m);
        apply();
      });
    }
  }
  function healthBadge(h) {
    var c = h >= 90 ? 'var(--green)' : h >= 70 ? 'var(--yellow)' : 'var(--red)';
    return '<span data-tip="健康分 ' + h + '／100：失败率×60 + 取消率×25 + 重试率（封顶 15）加权扣分" style="color:' + c + ';font-weight:600">' + h + '</span>';
  }
  function renderSessions(rows) {
    var keys = { 1: 'req', 2: 'inn', 3: 'out', 4: 'tot', 5: 'last', 6: 'cost', 7: 'rate', 8: 'health' };
    var list = sessAgg(rows).sort(function (a, b) { return ((a[keys[sortS.k]] || 0) - (b[keys[sortS.k]] || 0)) * sortS.d; });
    var hasCmp = (D.compactions || []).length > 0;
    var cols = [
      { h: '会话', k: null }, { h: '请求数', k: 1, end: 1 }, { h: '输入 token', k: 2, end: 1 },
      { h: '生成 token', k: 3, end: 1 }, { h: 'token 合计', k: 4, end: 1 },
      { h: '缓存率', k: 7, end: 1 }, { h: '健康', k: 8, end: 1 },
      hasCmp ? { h: '压缩', k: null, end: 1 } : null,
      costOn ? { h: '折算成本', k: 6, end: 1 } : null,
      { h: '最后活动', k: 5, end: 1 }
    ].filter(Boolean);
    var span = cols.length;
    $('ud-sessions-head').innerHTML = '<tr>' + cols.map(function (c) {
      var arrow = sortS.k === c.k ? (sortS.d < 0 ? ' ↓' : ' ↑') : '';
      return c.k == null ? '<th>' + c.h + '</th>' : '<th class="ud-sortable' + (c.end ? ' text-end' : '') + '" data-k="' + c.k + '"' + (sortS.k === c.k ? ' aria-sort="' + (sortS.d < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c.h + arrow + '</th>';
    }).join('') + '</tr>';
    var shown = list.slice(0, 30);
    var body = '';
    shown.forEach(function (o) {
      body += '<tr class="ud-click" data-sg="' + o.g + '"><td>' + sessTitle(o) + (o.sub ? '<span class="ud-tag">子代理 ×' + fmtI(o.sub) + '</span>' : '') + '</td><td class="text-end tabular-nums">' + fmtI(o.req) + '</td><td class="text-end tabular-nums">' + tokCell(o.inn) + '</td><td class="text-end tabular-nums">' + tokCell(o.out) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td><td class="text-end tabular-nums">' + o.rate + '%</td><td class="text-end">' + healthBadge(o.health) + '</td>' + (hasCmp ? '<td class="text-end text-nowrap">' + (cmpMap[o.g] ? cmpMap[o.g].cnt + ' 次' : '–') + '</td>' : '') + (costOn ? '<td class="text-end tabular-nums">' + (o.hasCost ? fmtCost(o.cost) : '–') + '</td>' : '') + '<td class="text-end text-nowrap">' + fullTs(o.last) + '</td></tr>';
      if (o.g === sessExp) body += '<tr class="ud-exp"><td colspan="' + span + '">' + sessionDetailHTML(o) + '</td></tr>';
    });
    $('ud-sessions-body').innerHTML = body || '<tr><td colspan="' + span + '" class="text-muted">当前筛选下暂无数据</td></tr>';
    Array.prototype.forEach.call($('ud-sessions-body').querySelectorAll('tr.ud-click'), function (tr) {
      tr.addEventListener('click', function () {
        var g = +tr.getAttribute('data-sg');
        sessExp = (sessExp === g) ? -1 : g;
        renderSessions(frows(false));
      });
    });
    var bodyEl = $('ud-sessions-body');
    if (!bodyEl.dataset.logsBtnBound) {
      bodyEl.dataset.logsBtnBound = '1';
      bodyEl.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.ud-sess-logs') : null;
        if (!btn) return;
        st.s = +btn.getAttribute('data-sg');
        page = 1; sessExp = -1; detExp = -1;
        var dbtn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-detail"]');
        if (dbtn) dbtn.click();
        apply();
      });
    }
    Array.prototype.forEach.call($('ud-sessions-head').querySelectorAll('.ud-sortable'), function (th) {
      th.addEventListener('click', function () {
        var k = +th.getAttribute('data-k');
        if (sortS.k === k) sortS.d = -sortS.d; else { sortS.k = k; sortS.d = -1; }
        sessExp = -1;
        renderSessions(frows(false));
      });
    });
  }

  function requestDetailHTML(r) {
    // 列里已有的信息不再重复；展开区只放增量：生成耗时拆解、首字占比、（serve）provider 原始用量
    var genMs = fmtI(Math.max(1, N(r[7]) - (r[11] == null ? 0 : N(r[11]))));
    var ttftpct = r[11] != null && r[7] ? Math.round(r[11] / r[7] * 100) + '%' : '–';
    return '<div class="text-small text-muted" style="line-height:1.9">生成耗时 ' + genMs + ' ms · 首字占比 ' + ttftpct +
      (window.__USAGE_SERVE__ ? ' · 以下为 provider 上报的原始用量' : '') + '</div>' +
      (window.__USAGE_SERVE__ ? '<div class="ud-sec" id="ud-reqraw"><div class="ud-kv-l">正在拉取 provider 上报的原始用量…</div></div>' : '');
  }
  function fillRawUsage(id) {
    var el = $('ud-reqraw');
    if (!el) return;
    fetch('/api/request?id=' + encodeURIComponent(id)).then(function (x) { return x.json(); }).then(function (j) {
      if (j.error) { el.innerHTML = '<div class="ud-kv-l">原始用量：' + esc(j.error) + '</div>'; return; }
      var usage = '(无)';
      try { usage = j.raw_usage_json ? JSON.stringify(JSON.parse(j.raw_usage_json), null, 1) : usage; } catch (e) { usage = j.raw_usage_json || usage; }
      var extra = [];
      if (j.finish_reason) extra.push('finish_reason: ' + j.finish_reason);
      if (j.error_code || j.error_message) extra.push('错误: ' + (j.error_code || '') + ' ' + (j.error_message || ''));
      if (j.agent) extra.push('agent: ' + j.agent);
      el.innerHTML = '<div class="ud-kv-l">provider 上报的原始用量</div><pre class="ud-raw">' + esc(usage) + '</pre>' + (extra.length ? '<div class="text-small text-muted">' + esc(extra.join(' · ')) + '</div>' : '');
    }).catch(function (e) { el.innerHTML = '<div class="ud-kv-l">拉取失败：' + esc(String(e)) + '</div>'; });
  }
  function renderDetail(rows) {
    var ACC = {
      0: function (r) { return r[1]; },
      4: function (r) { return N(r[4]); },
      5: function (r) { return N(r[5]); },
      6: function (r) { return N(r[6]); },
      7: function (r) { return N(r[7]); },
      10: function (r) { return N(r[10]); },
      11: function (r) { return N(r[11]); },
      12: function (r) { return N(r[4]) + N(r[5]); },
      13: function (r) { return rowCost(r) || 0; },
      14: function (r) { return tpsOf(r); }
    };
    var list = rows.filter(function (r) { return detailStat === -2 ? (r[8] === 1 || r[8] === 2) : (detailStat < 0 || r[8] === detailStat); })
      .sort(function (a, b) { return (ACC[sortD.k](a) - ACC[sortD.k](b)) * sortD.d; });
    var cols = [
      { h: '时间', k: 0 }, { h: '会话', k: null }, { h: '模型', k: null }, { h: '来源', k: null }, { h: '类型', k: null },
      { h: '输入', k: 4, end: 1 }, { h: '缓存读', k: 6, end: 1 }, { h: '缓存写', k: 10, end: 1 },
      { h: '生成', k: 5, end: 1 }, { h: '合计', k: 12, end: 1 }, { h: '耗时', k: 7, end: 1 }, { h: '首字', k: 11, end: 1 },
      { h: 'tok/s', k: 14, end: 1 },
      { h: '状态', k: null },
      costOn ? { h: '成本', k: 13, end: 1 } : null
    ].filter(Boolean);
    if (D.session) { cols = cols.filter(function (c) { return c.h !== '会话' && c.h !== '类型'; }); }
    var span = cols.length;
    $('ud-detail-head').innerHTML = '<tr>' + cols.map(function (c) {
      var arrow = sortD.k === c.k ? (sortD.d < 0 ? ' ↓' : ' ↑') : '';
      return c.k == null ? '<th>' + c.h + '</th>' : '<th class="ud-sortable' + (c.end ? ' text-end' : '') + '" data-k="' + c.k + '"' + (sortD.k === c.k ? ' aria-sort="' + (sortD.d < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c.h + arrow + '</th>';
    }).join('') + '</tr>';
    var totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;
    var view = list.slice((page - 1) * pageSize, page * pageSize);
    var body = '';
    if (D.session) {
      view = list.slice(0, sessShown);
      view.forEach(function (r) {
        body += '<tr><td class="text-nowrap">' + fullTs(r[1]) + '</td>' +
          '<td>' + esc(MD[r[2]]) + '</td><td>' + pvLabel(r[3]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[4]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[6]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[10]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[5]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(N(r[4]) + N(r[5])) + '</td>' +
          '<td class="text-end tabular-nums">' + durCell(r[7]) + '</td>' +
          '<td class="text-end tabular-nums">' + (r[11] == null ? '–' : durCell(r[11])) + '</td>' +
          '<td class="text-end">' + tpsHtml(tpsOf(r)) + '</td>' +
          '<td>' + stHtml(r[8]) + '</td></tr>';
      });
    } else {
      view.forEach(function (r, i) {
        body += '<tr class="ud-click" data-di="' + i + '"><td class="text-nowrap">' + fullTs(r[1]) + '</td>' +
          '<td class="ud-flink" data-k="s" data-v="' + r[0] + '" title="点击只看该会话">' + (TL[r[0]] ? esc(TL[r[0]]) : '<span class="text-muted">（无标题）</span>') + '</td>' +
          '<td class="ud-flink" data-k="m" data-v="' + r[2] + '" title="点击只看该模型">' + esc(MD[r[2]]) + '</td><td>' + pvLabel(r[3]) + '</td><td>' + QT[r[9]] + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[4]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[6]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[10]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(r[5]) + '</td>' +
          '<td class="text-end tabular-nums">' + tokCell(N(r[4]) + N(r[5])) + '</td>' +
          '<td class="text-end tabular-nums">' + durCell(r[7]) + '</td>' +
          '<td class="text-end tabular-nums">' + (r[11] == null ? '–' : durCell(r[11])) + '</td>' +
          '<td class="text-end">' + tpsHtml(tpsOf(r)) + '</td>' +
          '<td>' + stHtml(r[8]) + '</td>' +
          (costOn ? '<td class="text-end tabular-nums">' + (rowCost(r) == null ? '–' : fmtCost(rowCost(r))) + '</td>' : '') +
          '</tr>';
        if (detExp === i) body += '<tr class="ud-exp"><td colspan="' + span + '">' + requestDetailHTML(r) + '</td></tr>';
      });
    }
    $('ud-detail-body').innerHTML = body || '<tr><td colspan="' + span + '" class="text-muted">当前筛选下暂无数据</td></tr>';
    if (D.session) {
      var more = $('ud-more');
      if (more) {
        if (sessShown >= list.length) { more.hidden = true; }
        else { more.hidden = false; more.textContent = '加载更多（已显示 ' + sessShown + ' / ' + list.length + '）'; }
      }
    } else {
      var pageSel = '';
      if (totalPages > 1) {
        pageSel = '<select class="form-select" id="ud-page-sel" aria-label="跳转到页" style="max-width:110px">';
        for (var pi = 1; pi <= totalPages; pi++) pageSel += '<option value="' + pi + '"' + (pi === page ? ' selected' : '') + '>' + pi + ' / ' + totalPages + '</option>';
        pageSel += '</select>';
      }
      $('ud-pager').innerHTML = '<button type="button" class="btn" id="ud-prev"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
        pageSel +
        '<span class="text-small text-muted tabular-nums">共 ' + fmtI(list.length) + ' 条</span>' +
        '<button type="button" class="btn" id="ud-next"' + (page >= totalPages ? ' disabled' : '') + '>下一页</button>';
      var prevBtn = $('ud-prev'), nextBtn = $('ud-next');
      if (prevBtn) prevBtn.addEventListener('click', function () { page--; detExp = -1; renderDetail(frows(false)); });
      if (nextBtn) nextBtn.addEventListener('click', function () { page++; detExp = -1; renderDetail(frows(false)); });
      var pageSelEl = $('ud-page-sel');
      if (pageSelEl) pageSelEl.addEventListener('change', function () { page = +this.value; detExp = -1; renderDetail(frows(false)); });
      var tbodyEl = $('ud-detail-body');
      if (!tbodyEl.dataset.flinkBound) {
        tbodyEl.dataset.flinkBound = '1';
        tbodyEl.addEventListener('click', function (e) {
          var fl = e.target.closest ? e.target.closest('.ud-flink') : null;
          if (!fl) return;
          e.stopPropagation();
          var k = fl.dataset.k, v = +fl.dataset.v;
          if (k === 's') st.s = (st.s === v ? -1 : v);
          if (k === 'm') st.m = (st.m === v ? -1 : v);
          page = 1; sessExp = -1; detExp = -1;
          var ms = $('ud-f-model');
          if (k === 'm' && ms) ms.value = String(st.m);
          apply();
        });
      }
      Array.prototype.forEach.call($('ud-detail-body').querySelectorAll('tr.ud-click'), function (tr) {
        tr.addEventListener('click', function () {
          var i = +tr.getAttribute('data-di');
          detExp = (detExp === i) ? -1 : i;
          renderDetail(frows(false));
          if (detExp >= 0 && window.__USAGE_SERVE__) fillRawUsage(view[detExp][12]);
        });
      });
    }
    Array.prototype.forEach.call($('ud-detail-head').querySelectorAll('.ud-sortable'), function (th) {
      th.addEventListener('click', function () {
        var k = +th.getAttribute('data-k');
        if (sortD.k === k) sortD.d = -sortD.d; else { sortD.k = k; sortD.d = -1; }
        detExp = -1;
        renderDetail(frows(false));
      });
    });
  }

  function renderErrors(rows) {
    var list = rows.filter(function (r) { return r[8] === 1 || r[8] === 2; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 30);
    $('ud-errors-body').innerHTML = list.length ? list.map(function (r) {
      return '<tr><td class="text-nowrap">' + fullTs(r[1]) + '</td><td>' + (TL[r[0]] ? esc(TL[r[0]]) : '<span class="text-muted">（无标题）</span>') + '</td><td>' + esc(MD[r[2]]) + '</td><td>' + pvLabel(r[3]) + '</td><td>' + QT[r[9]] + '</td><td>' + stHtml(r[8]) + '</td></tr>';
    }).join('') : '<tr><td colspan="6" class="text-muted">当前筛选下没有失败或取消的请求</td></tr>';
  }

  function drawTrend() {
    var host = $('ud-trend-chart');
    if (!host) return;
    var w = host.clientWidth;
    if (!w) return;
    var rows = frows(false);
    if (!rows.length) { host.innerHTML = '<p class="text-muted">当前筛选下暂无数据</p>'; return; }
    var days = dayList(rows);
    var perDay = {};
    rows.forEach(function (r) {
      var k = dayKey(r[1]);
      var o = perDay[k] || (perDay[k] = {});
      var m = o[r[3]] || (o[r[3]] = { req: 0, inn: 0, out: 0, ca: 0 });
      m.req++; m.inn += N(r[4]); m.out += N(r[5]); m.ca += N(r[6]);
    });
    var active = {};
    rows.forEach(function (r) { active[r[3]] = 1; });
    var pvs = pvOrder.filter(function (p) { return active[p] && !st.hidePv[p]; });
    var legendRows = frows(true).reduce(function (acc, r) {
      var o = acc[r[3]] || (acc[r[3]] = { req: 0, inn: 0, out: 0, ca: 0 });
      o.req++; o.inn += N(r[4]); o.out += N(r[5]); o.ca += N(r[6]);
      return acc;
    }, {});
    $('ud-pv-legend').innerHTML = pvOrder.filter(function (p) { return active[p]; }).map(function (p) {
      var o = legendRows[p] || { req: 0, inn: 0, out: 0, ca: 0 };
      var total = o[curMetric];
      return '<label class="form-check form-switch"><input type="checkbox" class="form-check-input" data-pv="' + p + '"' + (st.hidePv[p] ? '' : ' checked') + '><span class="ud-swatch" style="background:' + pvColor(p) + '"></span><span class="form-check-label text-small">' + pvLabel(p) + ' · ' + fmt(total) + '</span></label>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#ud-pv-legend input'), function (cb) {
      cb.addEventListener('change', function () {
        st.hidePv[+cb.getAttribute('data-pv')] = !cb.checked;
        drawTrend();
      });
    });
    var H = 240, P = { t: 12, r: 12, b: 28, l: 64 };
    var iw = w - P.l - P.r, ih = H - P.t - P.b;
    var slot = iw / days.length, bw = Math.max(2, Math.min(slot - 2, 40));
    var ymax = 1;
    days.forEach(function (k) {
      var o = perDay[k] || {};
      var t = 0;
      pvs.forEach(function (p) { t += N((o[p] || {})[curMetric]); });
      if (t > ymax) ymax = t;
    });
    var out = '';
    for (var i = 0; i <= 4; i++) {
      var v = ymax * i / 4, y = P.t + ih - ih * i / 4;
      out += '<line x1="' + P.l + '" y1="' + y + '" x2="' + (w - P.r) + '" y2="' + y + '" stroke="var(--border)" stroke-width="1"/>';
      out += '<text x="' + (P.l - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="var(--muted-foreground)">' + fmt(v) + '</text>';
    }
    var kStep = Math.ceil(days.length / 8);
    days.forEach(function (k, di) {
      if (di % kStep === 0) {
        out += '<text x="' + (P.l + di * slot + slot / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="var(--muted-foreground)">' + esc(k.slice(5)) + '</text>';
      }
      var o = perDay[k] || {}, yBase = P.t + ih;
      pvs.forEach(function (p) {
        var v = N((o[p] || {})[curMetric]);
        if (!v) return;
        var bh = Math.round(ih * v / ymax);
        var tip = k + '\n' + pvLabel(p) + '\n请求 ' + fmtI((o[p] || {}).req || 0) + ' · 输入 ' + fmt((o[p] || {}).inn) + '\n生成 ' + fmt((o[p] || {}).out) + ' · 缓存读 ' + fmt((o[p] || {}).ca);
        out += '<rect x="' + (P.l + di * slot + (slot - bw) / 2) + '" y="' + (yBase - bh) + '" width="' + bw + '" height="' + Math.max(bh, 1) + '" fill="' + pvColor(p) + '" rx="2"><title>' + esc(tip) + '</title></rect>';
        yBase -= bh;
      });
    });
    host.innerHTML = '<svg width="' + w + '" height="' + H + '" role="img" aria-label="每日用量堆叠柱状图（按来源）"><desc>按天按来源堆叠展示 ' + days.length + ' 天数据</desc>' + out + '</svg>';
    var total = agg(rows);
    $('ud-trend-readout').textContent = '当前指标合计：请求数 ' + fmtI(total.req) + ' · 输入 ' + fmt(total.inn) + ' · 生成 ' + fmt(total.out) + ' · 缓存读 ' + fmt(total.ca);
    // 每日明细表：与图表同口径，点击某天切换全站日期筛选（再点一次取消）
    var perDur = {};
    rows.forEach(function (r) { var k = dayKey(r[1]); perDur[k] = (perDur[k] || 0) + N(r[7]); });
    var dayRows = days.slice().reverse().map(function (k) {
      var o = perDay[k] || {}, req = 0, inn = 0, out = 0, ca = 0;
      for (var p in o) { var m = o[p]; req += m.req; inn += m.inn; out += m.out; ca += m.ca; }
      var dur = perDur[k] || 0;
      var hit = inn ? Math.round(ca / inn * 100) : 0;
      var rate = dur > 0 ? fmtI(Math.round(out / (dur / 1000))) + ' tok/s' : '–';
      var sel = st.day === k;
      return '<tr class="ud-click" data-day="' + k + '" title="点击查看该日的请求明细"><td class="text-nowrap">' + k + (sel ? ' <span class="ud-tag">已选</span>' : '') + '</td><td class="text-end tabular-nums">' + fmtI(req) + '</td><td class="text-end tabular-nums">' + fmt(inn) + '</td><td class="text-end tabular-nums">' + fmt(out) + '</td><td class="text-end tabular-nums">' + fmt(ca) + '</td><td class="text-end tabular-nums">' + hit + '%</td><td class="text-end text-nowrap tabular-nums">' + rate + '</td></tr>';
    });
    var mAgg = {};
    rows.forEach(function (r) {
      var mk = dayKey(r[1]).slice(0, 7);
      var o = mAgg[mk] || (mAgg[mk] = { req: 0, inn: 0, out: 0, ca: 0, cost: 0, hasCost: false });
      o.req++; o.inn += N(r[4]); o.out += N(r[5]); o.ca += N(r[6]);
      var cc = rowCost(r); if (cc != null) { o.cost += cc; o.hasCost = true; }
    });
    var mRows = Object.keys(mAgg).sort().reverse().map(function (mk) {
      var o = mAgg[mk];
      var hit2 = o.inn ? Math.round(o.ca / o.inn * 100) : 0;
      return '<tr><td class="text-nowrap">' + mk + '</td><td class="text-end tabular-nums">' + fmtI(o.req) + '</td><td class="text-end tabular-nums">' + fmt(o.inn) + '</td><td class="text-end tabular-nums">' + fmt(o.out) + '</td><td class="text-end tabular-nums">' + fmt(o.ca) + '</td><td class="text-end tabular-nums">' + hit2 + '%</td>' + (o.hasCost ? '<td class="text-end tabular-nums">' + fmtCost(o.cost) + '</td>' : '') + '</tr>';
    }).join('');
    $('ud-daily-wrap').innerHTML = '<h3 style="margin-top:18px">每日明细</h3><div class="table-responsive" style="max-height:420px;overflow:auto"><table class="table table-sm"><thead><tr><th>日期</th><th class="text-end">请求</th><th class="text-end">输入</th><th class="text-end">生成</th><th class="text-end">缓存读</th><th class="text-end">缓存命中</th><th class="text-end">生成速率</th></tr></thead><tbody>' + dayRows.join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:18px">每月汇总</h3><div class="table-responsive"><table class="table table-sm"><thead><tr><th>月份</th><th class="text-end">请求</th><th class="text-end">输入</th><th class="text-end">生成</th><th class="text-end">缓存读</th><th class="text-end">缓存命中</th>' + (costOn ? '<th class="text-end">折算成本</th>' : '') + '</tr></thead><tbody>' + mRows + '</tbody></table></div>';
    Array.prototype.forEach.call($('ud-daily-wrap').querySelectorAll('tr.ud-click'), function (tr) {
      tr.addEventListener('click', function () {
        var d = tr.getAttribute('data-day');
        st.day = st.day === d ? null : d;
        page = 1; sessExp = -1; detExp = -1;
        if (st.day) {
          var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-detail"]');
          if (btn) btn.click();
        }
        apply();
      });
    });
  }

  function fillSelect(el, allLabel, items) {
    el.innerHTML = '<option value="-1">' + allLabel + '</option>' + items.map(function (it) {
      return '<option value="' + it.v + '">' + esc(it.label) + '</option>';
    }).join('');
  }

  function apply() {
    var sf = $('ud-sess-filter');
    if (sf) {
      sf.hidden = st.s < 0;
      if (st.s >= 0) sf.textContent = '会话：' + (TL[st.s] ? TL[st.s].slice(0, 24) : '#' + st.s) + ' ✕';
    }
    var df = $('ud-day-filter');
    if (df) {
      df.hidden = !st.day;
      if (st.day) df.textContent = '日期：' + st.day + ' ✕';
    }
    var rows = frows(false);
    if (D.session) { renderSession(rows); renderDetail(rows); return; }
    renderKpis(rows);
    renderInsights(rows);
    renderHealth(rows);
    renderProviders(frows(true));
    renderModels(rows);
    renderTopSessions(rows);
    renderHours(rows);
    if (!wireHoursToggle.done) { wireHoursToggle.done = true; wireHoursToggle(); }
    renderHeatmap(rows);
    renderSessions(rows);
    renderModelBoard(rows);
    renderDetail(rows);
    renderErrors(rows);
    drawTrend();
  }

  // 会话视图只初始化明细交互；全量分析与筛选控件留给 dashboard。
  if (D.session) {
    $('ud-f-stat').addEventListener('change', function () { detailStat = +this.value; sessShown = 50; renderDetail(R); });
    $('ud-more').addEventListener('click', function () { sessShown += 50; renderDetail(R); });
    $('ud-failures').addEventListener('click', function () {
      detailStat = -2; sessShown = 50;
      $('ud-request-section').open = true;
      $('ud-f-stat').value = '-2';
      renderDetail(R);
      $('ud-f-stat').focus();
    });
    apply();
    return;
  }

  // 全量仪表盘筛选控件
  fillSelect($('ud-f-pv'), '全部来源', PV.map(function (p, i) { return { v: i, label: pvLabel(i) + '（' + pvTag(i) + '）' }; }));
  fillSelect($('ud-f-model'), '全部模型', MD.map(function (m, i) { return { v: i, label: String(m) }; }));
  if (PRICE && Object.keys(PRICE).length) { $('ud-cost-wrap').hidden = false; }
  (function () {
    var sf = $('ud-sess-filter');
    if (sf) sf.addEventListener('click', function () { st.s = -1; page = 1; sessExp = -1; detExp = -1; apply(); });
  })();
  (function () {
    var df = $('ud-day-filter');
    if (df) df.addEventListener('click', function () { st.day = null; page = 1; sessExp = -1; detExp = -1; apply(); });
  })();
  $('ud-f-pv').addEventListener('change', function () { st.p = +this.value; page = 1; sessExp = -1; detExp = -1; apply(); });
  $('ud-f-model').addEventListener('change', function () { st.m = +this.value; page = 1; sessExp = -1; detExp = -1; apply(); });
  $('ud-f-stat').addEventListener('change', function () { detailStat = +this.value; page = 1; renderDetail(frows(false)); });
  $('ud-f-cost').addEventListener('change', function () { costOn = this.checked; renderProviders(frows(true)); renderSessions(frows(false)); renderInsights(frows(false)); renderDetail(frows(false)); });
  Array.prototype.forEach.call(document.querySelectorAll('#ud-f-range .ud-toggle'), function (b) {
    b.addEventListener('click', function () {
      st.rng = b.getAttribute('data-r');
      Array.prototype.forEach.call(document.querySelectorAll('#ud-f-range .ud-toggle'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      page = 1; sessExp = -1; detExp = -1; apply();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#ud-series-toggle .ud-toggle'), function (b) {
    b.addEventListener('click', function () {
      curMetric = b.getAttribute('data-m');
      Array.prototype.forEach.call(document.querySelectorAll('#ud-series-toggle .ud-toggle'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      drawTrend();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#ud-heat-toggle .ud-toggle'), function (b) {
    b.addEventListener('click', function () {
      heatMode = b.getAttribute('data-hm');
      Array.prototype.forEach.call(document.querySelectorAll('#ud-heat-toggle .ud-toggle'), function (x) {
        x.setAttribute('aria-pressed', String(x === b));
      });
      heatLastW = -1;
      renderHeatmap(frows(false));
    });
  });
  $('ud-price-sync').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = '同步中…';
    if (window.__USAGE_SERVE__) {
      fetch('/api/sync-prices', { method: 'POST' }).then(function () { location.reload(); }).catch(function () {
        btn.textContent = '同步失败'; btn.disabled = false;
      });
      return;
    }
    var zc = window.zcode || null;
    var reset = function (t) { btn.textContent = t; setTimeout(function () { btn.textContent = '同步价格'; btn.disabled = false; }, 3000); };
    if (zc && typeof zc.callTool === 'function') {
      // 直调 App-only 同步工具（后台 execFile prices sync，约数秒），完成后按新价软刷新
      zc.callTool('usage_prices_sync', {}).then(function (r) {
        var sc = (r && r.structuredContent) || {};
        if (sc.ok && sc.prices) { mgrState.prices = sc.prices; softReloadPrices(sc.prices); reset('已同步'); }
        else if (r && r.isError) { reset('同步失败'); }
        else reset('已同步');
      }).catch(function () { reset('同步失败'); });
    } else {
      reset('当前环境不支持');
    }
  });
  // ---- 价格 / 预算管理（serve 模式可编辑并即时重算；其他环境只读引导） ----
  var mgrState = { q: '', prices: null, budget: null, switches: null };
  function mgrRow(m, e, used) {
    return '<tr data-m="' + esc(m) + '"><td class="text-nowrap">' + esc(m) + (used ? ' <span class="ud-tag">当前用量</span>' : '') + '</td>' +
      '<td class="ud-mgr-t"><input data-k="in" value="' + e.in + '" inputmode="decimal"></td>' +
      '<td class="ud-mgr-t"><input data-k="out" value="' + e.out + '" inputmode="decimal"></td>' +
      '<td class="ud-mgr-t"><input data-k="cache" value="' + e.cache + '" inputmode="decimal"></td>' +
      '<td class="text-nowrap"><button type="button" class="btn ud-mgr-save" style="margin:0;padding:1px 8px;font-size:12px">保存</button> <button type="button" class="btn ud-mgr-del" style="margin:0;padding:1px 8px;font-size:12px">删除</button></td></tr>';
  }
  function swRow(id, name, desc, on) {
    return '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">' + name + '</div><div class="ud-mgr-sub" style="margin:1px 0 0">' + desc + '</div></div>' +
      '<input type="checkbox" class="form-check-input" id="' + id + '"' + (on ? ' checked' : '') + '></div>';
  }
  function renderMgr() {
    var body = $('ud-mgr-body');
    var p = mgrState.prices, b = mgrState.budget || {}, sw = mgrState.switches || {};
    var models = Object.keys(p.models || {});
    var used = {};
    frows(false).forEach(function (r) { used[String(MD[r[2]] || '').toLowerCase()] = 1; });
    var hit = models.filter(function (m) { return mgrState.q ? m.indexOf(mgrState.q) >= 0 : (used[m.toLowerCase()] || mgrState.builtins.indexOf(m) >= 0); });
    var list = (mgrState.q ? models.filter(function (m) { return m.indexOf(mgrState.q) >= 0; }) : hit).slice(0, 60);
    var tsMode = sw.turnstats || 'off';
    body.innerHTML =
      '<div class="ud-mgr-h">成本单价（元 / 每百万 token）</div>' +
      '<div class="ud-mgr-sub">GLM 5.3 系为智谱官网权威价；其余来自 models.dev（USD 按 7.2 换算）。默认列出当前用量相关模型，搜索可查全量；修改保存后按新价重算。</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input class="form-control form-control-sm" id="ud-mgr-q" placeholder="搜索模型…" value="' + esc(mgrState.q) + '" style="max-width:260px"><span class="text-small text-muted">' + list.length + ' / ' + models.length + ' 个模型' + (p.modelsSlim && p.modelsTotal != null ? '（全量 ' + p.modelsTotal + '）' : '') + (list.length >= 60 ? '（仅显示前 60）' : '') + '</span></div>' +
      '<div class="table-responsive" style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:8px"><table class="table table-sm" style="margin:0"><thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读</th><th></th></tr></thead><tbody id="ud-mgr-rows">' +
      list.map(function (m) { return mgrRow(m, p.models[m], !mgrState.q && used[m.toLowerCase()]); }).join('') +
      '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin:10px 0 2px;flex-wrap:wrap"><span class="text-small text-muted">新增模型价：</span><input class="form-control form-control-sm" id="ud-mgr-newname" placeholder="模型名（与请求记录一致）" style="width:230px"><input class="form-control form-control-sm" id="ud-mgr-newin" placeholder="输入" style="width:76px" inputmode="decimal"><input class="form-control form-control-sm" id="ud-mgr-newout" placeholder="输出" style="width:76px" inputmode="decimal"><input class="form-control form-control-sm" id="ud-mgr-newcache" placeholder="缓存读" style="width:76px" inputmode="decimal"><button type="button" class="btn" id="ud-mgr-add" style="margin:0;padding:2px 10px;font-size:12px">添加</button></div>' +
      '<div class="ud-mgr-h">通用</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label class="text-small text-muted">USD→CNY 汇率<input class="form-control form-control-sm" id="ud-mgr-rate" value="' + (p.usdCny == null ? '' : p.usdCny) + '" placeholder="默认 7.2" style="width:90px;margin-left:4px" inputmode="decimal"></label>' +
      '<label class="form-check form-switch text-small" style="margin:0">每日自动同步模型价<input type="checkbox" class="form-check-input" id="ud-sw-autosync"' + (p.autoSync !== false ? ' checked' : '') + ' style="margin-left:6px"></label>' +
      '<button type="button" class="btn" id="ud-mgr-gsave" style="margin:0;padding:2px 10px;font-size:12px">保存通用</button>' +
      '</div>' +
      '<div class="ud-mgr-h">预算（折算金额，超 80% 黄色进度、100% 红色）</div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label class="text-small text-muted">日预算 ¥<input class="form-control form-control-sm" id="ud-mgr-bd" value="' + (N(b.daily) || '') + '" style="width:100px;margin-left:4px" inputmode="decimal"></label>' +
      '<label class="text-small text-muted">月预算 ¥<input class="form-control form-control-sm" id="ud-mgr-bm" value="' + (N(b.monthly) || '') + '" style="width:100px;margin-left:4px" inputmode="decimal"></label>' +
      '<button type="button" class="btn" id="ud-mgr-bsave" style="margin:0;padding:2px 10px;font-size:12px">保存预算</button>' +
      '</div>' +
      '<div class="ud-mgr-h">通知（macOS 系统通知，全部本地计算、零模型开销）</div>' +
      swRow('ud-sw-permission', '权限等待提醒', 'Agent 弹出批准请求时通知你——挂机跑长任务不漏确认', sw.permissionAlerts === true) +
      swRow('ud-sw-budget', '预算 / 燃烧告警', '日折算成本达预算 80% / 100% 时提醒；今日用量超近 7 天日均 50% 也会提示', sw.budgetAlerts !== false) +
      '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">每轮用量统计</div><div class="ud-mgr-sub" style="margin:1px 0 0">每轮回合结束弹通知显示本轮速率 / 缓存率 / 耗时（不进入对话上下文）。选「关」时统计仍显示在侧栏面板顶部横幅</div></div>' +
      '<select class="form-select form-select-sm" id="ud-sw-turnstats" style="width:auto;flex:none">' +
      '<option value="off"' + (tsMode === 'off' ? ' selected' : '') + '>关</option>' +
      '<option value="notify"' + (tsMode === 'notify' ? ' selected' : '') + '>系统通知（推荐）</option>' +
      '<option value="inject"' + (tsMode === 'inject' ? ' selected' : '') + '>对话内统计行（约 0.3k token/轮）</option>' +
      '</select></div>' +
      '<div class="ud-mgr-sub" style="margin-top:8px">权限提醒与每轮统计依赖会话钩子，修改后重开会话生效；预算告警立即生效。</div>';
    var qi = $('ud-mgr-q');
    var qTimer = null, qSeq = 0;
    qi.addEventListener('input', function () {
      mgrState.q = this.value.trim().toLowerCase();
      renderMgr(); var q2 = $('ud-mgr-q'); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length);
      // 侧栏拿到的是瘦身价格表（宿主对工具响应有 64KiB 上限）：搜索时经 callTool 按名拉取匹配项
      if (window.__USAGE_SERVE__ || !(window.zcode && typeof window.zcode.callTool === 'function')) return;
      var seq = ++qSeq, kw = this.value.trim();
      clearTimeout(qTimer);
      qTimer = setTimeout(function () {
        window.zcode.callTool('usage_settings_get', { query: kw }).then(function (r) {
          if (seq !== qSeq) return; // 已有更新的输入，丢弃过期响应
          var sc = (r && r.structuredContent) || {};
          if (sc.prices) { mgrState.prices = sc.prices; mgrState.q = ($('ud-mgr-q').value || '').trim().toLowerCase(); renderMgr(); }
        }).catch(function () {});
      }, 300);
    });
    Array.prototype.forEach.call(body.querySelectorAll('tr[data-m]'), function (tr) {
      var m = tr.getAttribute('data-m');
      tr.querySelector('.ud-mgr-save').addEventListener('click', function () {
        var get = function (k) { return tr.querySelector('input[data-k="' + k + '"]').value; };
        priceSave({ url: '/api/prices/set', data: { model: m, in: get('in'), out: get('out'), cache: get('cache') }, tool: { price: { model: m, in: get('in'), out: get('out'), cache: get('cache') } } }).then(afterPriceSave);
      });
      tr.querySelector('.ud-mgr-del').addEventListener('click', function () {
        priceSave({ url: '/api/prices/remove', data: { model: m }, tool: { priceRemove: m } }).then(afterPriceSave);
      });
    });
    $('ud-mgr-add').addEventListener('click', function () {
      var nm = $('ud-mgr-newname').value.trim();
      if (!nm) return;
      priceSave({ url: '/api/prices/set', data: { model: nm, in: $('ud-mgr-newin').value, out: $('ud-mgr-newout').value, cache: $('ud-mgr-newcache').value }, tool: { price: { model: nm, in: $('ud-mgr-newin').value, out: $('ud-mgr-newout').value, cache: $('ud-mgr-newcache').value } } }).then(afterPriceSave);
    });
    $('ud-mgr-bsave').addEventListener('click', function () {
      var nb = { daily: $('ud-mgr-bd').value, monthly: $('ud-mgr-bm').value };
      var applyB = function () { st.budget = { daily: N(nb.daily), monthly: N(nb.monthly) }; apply(); };
      if (window.__USAGE_SERVE__) postJSON('/api/budget', nb).then(applyB);
      else settingsCall({ budget: { daily: N(nb.daily), monthly: N(nb.monthly) } }).then(applyB);
    });
    // 通用设置（币种口径下的汇率与自动同步）
    $('ud-mgr-gsave').addEventListener('click', function () {
      var g = { currency: mgrState.prices.currency || 'CNY', usdCny: $('ud-mgr-rate').value, autoSync: !$('ud-sw-autosync').checked ? false : true };
      priceSave({ url: '/api/prices/general', data: g, tool: { priceGeneral: g } }).then(afterPriceSave);
    });
    function postSwitch(patch) {
      return settingsSave(patch).then(function (j) { if (j && j.switches) mgrState.switches = j.switches; });
    }
    $('ud-sw-permission').addEventListener('change', function () { postSwitch({ permissionAlerts: this.checked }); });
    $('ud-sw-budget').addEventListener('change', function () { postSwitch({ budgetAlerts: this.checked }); });
    $('ud-sw-turnstats').addEventListener('change', function () { postSwitch({ turnstats: this.value }); });
  }
  function postJSON(url, data) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function (r) { return r.json(); });
  }
  // 侧栏（MCP App）无 HTTP 服务：经 callTool 直调 App-only 设置工具，不经模型
  function settingsCall(setArgs) {
    var zc = window.zcode || null;
    return zc && typeof zc.callTool === 'function'
      ? Promise.resolve(zc.callTool('usage_settings_set', setArgs)).then(function (r) { return (r && r.structuredContent) || { ok: true }; })
      : Promise.reject(new Error('no-calltool'));
  }
  function settingsSave(patch) {
    if (window.__USAGE_SERVE__) return postJSON('/api/switches', patch);
    return settingsCall({ switches: patch });
  }
  function priceSave(payload) {
    if (window.__USAGE_SERVE__) return postJSON(payload.url, payload.data);
    return settingsCall(payload.tool);
  }
  // 价格类保存后的统一收尾。MCP App 沙箱内禁止页面级导航/重载（location.reload、location.href
  // 都会让宿主把面板判为崩溃，报「MCP App page stopped」），侧栏改软刷新：用保存响应里的最新
  // 瘦身价格表重绑页内价格并整体重渲染；仅本地面板（serve，普通浏览器页面）保留整页 reload。
  function softReloadPrices(np) {
    if (np && typeof np === 'object') {
      PRICE = np;
      PMODELS = PRICE.models || PRICE;
      CURSYM = ({ USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' })[PRICE.currency] || (PRICE.currency ? PRICE.currency + ' ' : '$');
    }
    apply();
  }
  function afterPriceSave(sc) {
    if (window.__USAGE_SERVE__) { location.reload(); return; }
    var finish = function (p) {
      if (p) { mgrState.prices = p; softReloadPrices(p); }
      else if (typeof apply === 'function') apply();
      var mask = $('ud-mgr-mask'); if (mask) mask.hidden = true;
    };
    if (sc && sc.prices) { finish(sc.prices); return; }
    var zc = window.zcode || null;
    if (zc && typeof zc.callTool === 'function') {
      zc.callTool('usage_settings_get', {}).then(function (r) {
        finish((r && r.structuredContent && r.structuredContent.prices) || null);
      }).catch(function () { finish(null); });
    } else finish(null);
  }
  mgrState.builtins = ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx'];
  $('ud-price-mgr').addEventListener('click', function () {
    mgrState.q = ''; // 重开弹框不残留上次搜索词（瘦身表按旧词过滤会得到空列表）
    $('ud-mgr-mask').hidden = false;
    var body = $('ud-mgr-body');
    var zc = window.zcode || null;
    function renderFrom(sc) {
      mgrState.prices = sc.prices || { currency: 'CNY', models: {} };
      mgrState.budget = sc.budget || {};
      mgrState.switches = sc.switches || {};
      if (!st.budget) st.budget = mgrState.budget;
      renderMgr();
    }
    function loadServe() {
      body.innerHTML = '<p class="text-muted text-small">加载中…</p>';
      Promise.all([
        fetch('/api/prices').then(function (r) { return r.json(); }),
        fetch('/api/budget').then(function (r) { return r.json(); }),
        fetch('/api/switches').then(function (r) { return r.json(); }).catch(function () { return {}; })
      ]).then(function (rs) {
        renderFrom({ prices: rs[0], budget: rs[1], switches: rs[2] || {} });
      });
    }
    if (window.__USAGE_SERVE__) { loadServe(); return; }
    // 侧栏（MCP App）：callTool 直调设置工具，不经模型
    if (zc && typeof zc.callTool === 'function') {
      body.innerHTML = '<p class="text-muted text-small">加载中…</p>';
      Promise.resolve(zc.callTool('usage_settings_get', {})).then(function (r) {
        renderFrom((r && r.structuredContent) || {});
      }).catch(function () { openPanelFallback(body, zc); });
      return;
    }
    openPanelFallback(body, zc);
  });
  function openPanelFallback(body, zc) {
    body.innerHTML =
      '<p class="text-small" style="margin:0 0 10px">当前环境不支持面板内编辑。两种方式：</p>' +
      '<ol class="text-small text-muted" style="margin:0 0 12px;padding-left:18px;line-height:1.9">' +
      '<li>打开本地面板编辑（推荐，同样的界面）</li>' +
      '<li>直接编辑 <code>~/.zcode/usage-prices.json</code>（字段 in / out / cache，每百万 token）</li></ol>' +
      '<button type="button" class="btn" id="ud-mgr-open-serve" style="margin:0 8px 0 0;padding:3px 14px;font-size:12px">打开本地面板</button>' +
      '<span class="text-small text-muted">或运行 <code>usage.sh serve</code></span>';
    var btn = $('ud-mgr-open-serve');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = '启动中…';
      var call = (zc && typeof zc.callTool === 'function')
        ? Promise.resolve(zc.callTool('open_full_panel', {}))
        : Promise.reject(new Error('no-calltool'));
      call.then(function () {
        btn.textContent = '已启动（浏览器将自动打开）';
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = '打开本地面板';
        alert('启动失败：请在终端运行 usage.sh serve');
      });
    });
  }
  $('ud-mgr-close').addEventListener('click', function () { $('ud-mgr-mask').hidden = true; });
  $('ud-mgr-mask').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('ud-export-report').hidden = false;
  $('ud-export-report').addEventListener('click', function () {
    var btn = this;
    if (window.__USAGE_SERVE__) { location.href = '/report.html'; return; }
    // 侧栏（MCP App）禁止页面级导航（宿主会报 App page stopped）：
    // 确保本地 serve 面板运行后，交系统浏览器下载报表（Content-Disposition 附件）。
    btn.disabled = true;
    btn.textContent = '准备中…';
    var zc = window.zcode || null;
    var done = function () { setTimeout(function () { btn.disabled = false; btn.textContent = '导出报表'; }, 2500); };
    var call = (zc && typeof zc.callTool === 'function')
      ? Promise.resolve(zc.callTool('open_full_panel', {}))
      : Promise.reject(new Error('no-calltool'));
    call.then(function (r) {
      var base = ((r && r.structuredContent && r.structuredContent.url) || 'http://127.0.0.1:7741').replace(/\/$/, '');
      if (!(zc && typeof zc.openExternal === 'function')) { btn.textContent = '当前环境不支持导出'; return; }
      zc.openExternal({ href: base + '/report.html' });
      btn.textContent = '已交浏览器下载';
    }).catch(function () {
      btn.textContent = '导出失败（需本地面板）';
    }).then(done, done);
  });
  // 官方配额（可选）：配置 API Key 后 serve 模式显示官方口径配额卡
  if (window.__USAGE_SERVE__) {
    fetch('/api/quota').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !Array.isArray(j.limits) || !j.limits.length) return;
      var host = $('ud-quota-card');
      host.hidden = false;
      host.innerHTML = '<h3 style="margin-top:16px">官方套餐配额' + (j.stale ? ' <span class="ud-tag">观测时间：' + (j.logDate || '–') + '</span>' : '') + '</h3><div class="card" style="padding:12px 14px">' +
        j.limits.map(function (L) {
          var pct = Math.max(0, Math.min(100, Math.round(N(L.percentage))));
          return '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between" class="text-small"><span>' + esc(L.type || '配额') + '</span><span class="tabular-nums text-muted">已用 ' + pct + '%' + (L.resetTime ? ' · ' + esc(String(L.resetTime)) + ' 重置' : '') + '</span></div>' +
            '<div class="ud-budget-bar' + (pct >= 80 ? ' ud-over' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
        }).join('') + '</div>';
    }).catch(function () {});
  }
  $('ud-tab-trend').addEventListener('click', function () { requestAnimationFrame(drawTrend); });
  $('ud-insights-more').addEventListener('click', function () {
    insightsOpen = !insightsOpen;
    apply(); // 重渲染洞察区并保持其他视图一致
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { drawTrend(); }).observe($('ud-trend-chart'));
    new ResizeObserver(function () {
      var w = $('ud-heatmap').clientWidth;
      if (w && w !== heatLastW) renderHeatmap(frows(false));
    }).observe($('ud-heatmap'));
  }


  apply();
  // 图表悬停提示：SVG rect 的 title 即入即显（原生 title 有 1~2s 延迟；全环境通用）
  var tip = document.createElement('div');
  tip.id = 'ud-tip';
  tip.setAttribute('role', 'tooltip');
  tip.style.cssText = 'position:fixed;display:none;z-index:999;pointer-events:none;background:var(--card);color:var(--foreground);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.5;box-shadow:0 6px 20px rgba(0,0,0,.22);white-space:pre;max-width:360px;';
  document.body.appendChild(tip);
  document.addEventListener('mousemove', function (e) {
    var t = e.target;
    // SVG 图元读内嵌 <title>；任意 data-tip 元素（月历格、拆分条）读 data-tip（统一即时 tooltip）
    var el2 = t && t.closest ? t.closest('svg rect, svg circle, svg path, [data-tip]') : null;
    var text = '';
    if (el2) {
      var dt = el2.getAttribute && el2.getAttribute('data-tip');
      if (dt) text = dt;
      else { var tt = el2.querySelector && el2.querySelector('title'); text = (tt && tt.textContent) || ''; }
    }
    if (text) {
      tip.textContent = text;
      tip.style.display = 'block';
      var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 10);
      var y = Math.min(e.clientY + 14, window.innerHeight - tip.offsetHeight - 10);
      tip.style.left = Math.max(6, x) + 'px';
      tip.style.top = Math.max(6, y) + 'px';
    } else {
      tip.style.display = 'none';
    }
  });
  // 支持 #tab hash 定位（本地面板跳转：#trend/#sessions/#detail/#errors）
  var h = (location.hash || '').replace('#', '');
  if (h) {
    var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-' + h + '"]');
    if (btn) btn.click();
  }
  window.__usageBootDone = true;
}
if (window.__USAGE_DATA_URL__) {
  fetch(window.__USAGE_DATA_URL__).then(function (r) { return r.json(); }).then(function (j) { __usageBoot(j); });
} else {
  __usageBoot(DATA || {});
}
// 「本轮」实时横幅：侧栏面板内走宿主资源订阅（MCP resources/updated 推送，零轮询）；
// 浏览器/serve 模式退化为轮询本机 /api/turn。统计由本地脚本计算，不经过模型。
(function () {
  var el = document.getElementById('ud-turn');
  if (!el) return;
  function render(text) {
    text = String(text || '').trim();
    if (!text) { el.hidden = true; return; }
    var d = new Date();
    var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    el.innerHTML = '<span>' + text.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) +
      '</span><span class="ud-turn-t">' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' 更新</span>';
    el.hidden = false;
  }
  var zc = window.zcode || null;
  function refreshZc() {
    try {
      zc.readResource({ uri: 'ui://usage-detail/turn.txt' }).then(function (res) {
        render(res && res.contents && res.contents[0] && res.contents[0].text);
      }).catch(function () {});
    } catch (e) {}
  }
  function refreshHttp() {
    fetch('/api/turn', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { render(j && j.text); }).catch(function () {});
  }
  if (zc && typeof zc.subscribeResource === 'function' && typeof zc.onResourceUpdated === 'function') {
    try {
      zc.subscribeResource({ uri: 'ui://usage-detail/turn.txt' });
      zc.onResourceUpdated(function (u) { if (!u || !u.uri || u.uri === 'ui://usage-detail/turn.txt') refreshZc(); });
    } catch (e) {}
    refreshZc();
  } else if (location.protocol === 'http:' || location.protocol === 'https:') {
    refreshHttp();
    setInterval(refreshHttp, 15000);
  }
})();
</script>
</div>
UD_TAIL
    } > "$out"
    echo "已生成用量界面：$out"
}

