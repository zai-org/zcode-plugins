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
      PJ_SQL="(SELECT replace(CAST(readfile($(sql_quote "$pf")) AS text), char(65279), '') AS pj)"
    else
      PJ_SQL="(SELECT NULL AS pj)"
    fi
    logs_mb=$(du -sm "$HOME/.zcode/v2/logs" 2>/dev/null | cut -f1 || true); logs_mb=${logs_mb:-0}
    rollout_mb=$(du -sm "$HOME/.zcode/cli/rollout" 2>/dev/null | cut -f1 || true); rollout_mb=${rollout_mb:-0}
    artifacts_mb=$(du -sm "$HOME/.zcode/cli/artifacts" 2>/dev/null | cut -f1 || true); artifacts_mb=${artifacts_mb:-0}
    db_mb=$(du -m "$DB" 2>/dev/null | cut -f1 || true); db_mb=${db_mb:-0}
    # 全新环境：model_usage/session 表还不存在（ZCode 尚未写入）→ 直接给空数据，避免 META SQL 报 no such table
    if [[ "$(qr "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')")" != "2" ]]; then
      META='{"providers":[],"models":[],"sessions":[],"sessionDirs":[],"sessionIds":[],"tools":[],"todos":[0,0],"stability":[0,0,0],"hours":{},"compactions":[],"sessionTools":[],"disk":{"logs":0,"rollout":0,"artifacts":0,"db":0},"providerNames":{},"projectMap":{},"budgetDaily":0,"budgetMonthly":0,"zcodeLocale":"","userLang":"","ctxMix":[],"sessionAgents":[],"prices":{},"total":0,"covered":0,"rows":[]}'
    else
    # turn_id 是较新 ZCode 才有的列：老库直接 SELECT 会 prepare 失败，先探测再拼表达式
    turn_expr="NULL"
    [[ "$(qr "SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='turn_id'")" == "1" ]] && turn_expr="R.turn_id"
    # agent / context_exceeded 同为较新列：老库回退（agent 置空显示未知来源，ctx 置 NULL 无超限标注）
    agent_expr="''"
    [[ "$(qr "SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='agent'")" == "1" ]] && agent_expr="mu.agent"
    # 子代理会话归属：session.parent_id（较新列）把子会话挂到主会话；老库无此列时子代理团队留在子会话名下
    parent_expr="NULL"
    [[ "$(qr "SELECT count(*) FROM pragma_table_info('session') WHERE name='parent_id'")" == "1" ]] && parent_expr="ch.parent_id"
    ctx_exc_expr="NULL"
    [[ "$(qr "SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='context_exceeded'")" == "1" ]] && ctx_exc_expr="R.context_exceeded"
    # BYOK 供应商显示名（provider_config.json，只取名映射）+ 项目根归并（git 仓库根）：
    # node 一次性解析成两个映射表进 META；node/git 不可用或空目录时给空表，前端按原样回退。
    # dirs 走 stdin：Git Bash(MSYS) 会改写 argv 里以 / 开头的路径参数，JSON 清单会被篡改
    DIRS_JSON=$(qr "SELECT COALESCE(json_group_array(d),'[]') FROM (SELECT DISTINCT se.directory AS d FROM model_usage u LEFT JOIN session se ON se.id=u.session_id WHERE coalesce(se.directory,'')<>'')")
    PMETA=$(printf '%s' "$DIRS_JSON" | node "$SCRIPT_DIR/lib/project-meta.mjs" 2>/dev/null || echo '{"providerNames":{},"projectMap":{}}')
    PMETA=${PMETA//\'/\'\'}
    # 预算值（洞察区「今日预算」进度卡用）：node 读 usage-budget.json，只取两个数字
    BUDGET_JSON=$(node -e "try{const b=JSON.parse(require('fs').readFileSync(require('path').join(process.env.HOME||'', '.zcode', 'usage-budget.json'),'utf8'));process.stdout.write((Number(b.daily)||0)+' '+(Number(b.monthly)||0))}catch(e){process.stdout.write('0 0')}" 2>/dev/null || echo "0 0")
    BUDGET_D=${BUDGET_JSON%% *}; BUDGET_M=${BUDGET_JSON##* }
    [[ "$BUDGET_D" =~ ^[0-9.]+$ ]] || BUDGET_D=0
    [[ "$BUDGET_M" =~ ^[0-9.]+$ ]] || BUDGET_M=0
    # 界面语言跟随 ZCode 设置（~/.zcode/v2/setting.json 的 localePreference）：
    # 只取显式语言（system=跟随系统时留空，前端回退 navigator.language）；严格校验格式防注入
    ZLOC=$(node -e "try{const s=JSON.parse(require('fs').readFileSync(require('path').join(process.env.HOME||'', '.zcode', 'v2', 'setting.json'),'utf8'));const p=String(s.localePreference||'');process.stdout.write(p&&p!=='system'?p:'')}catch(e){process.stdout.write('')}" 2>/dev/null || echo "")
    [[ "$ZLOC" =~ ^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$ ]] || ZLOC=''
    # 用户显式语言选择（usage-lang.json，由本地面板/侧栏设置写入）：跨面板权威，优先于 localStorage
    ULANG=$(node -e "try{const b=JSON.parse(require('fs').readFileSync(require('path').join(process.env.HOME||'', '.zcode', 'usage-lang.json'),'utf8'));const v=String(b.language||'');process.stdout.write(v==='zh'||v==='en'?v:'')}catch(e){process.stdout.write('')}" 2>/dev/null || echo "")

    META=$(qr "
      WITH U AS (SELECT * FROM model_usage $scope),
           P AS (SELECT provider_id AS v, row_number() OVER (ORDER BY provider_id)-1 AS i FROM (SELECT DISTINCT provider_id FROM U)),
           M AS (SELECT model_id AS v, row_number() OVER (ORDER BY model_id)-1 AS i FROM (SELECT DISTINCT model_id FROM U)),
           S AS (SELECT session_id AS v, row_number() OVER (ORDER BY session_id)-1 AS i FROM (SELECT DISTINCT session_id FROM U)),
           PJ AS $PJ_SQL,
           R AS (SELECT * FROM U ORDER BY started_at DESC, id DESC LIMIT $limit)
      -- 输出前把 < 转义为 \u003c（防会话标题中的 </script> 提前闭合标签）。
      -- 必须在 SQL 层做：bash 3.2 的模式替换运算符在长串 + replacement 含反斜杠时
      -- 是平方级（实测 300KB+单匹配 2.6s、多匹配分钟级），sqlite replace() 是 C 线性实现。
      -- < 只会出现在 JSON 字符串值内部，替换为 u003c 转义后仍是合法 JSON 且语义不变。
      SELECT replace(json_object(
        'session',$session_meta,
        'providers',(SELECT json_group_array(v) FROM (SELECT v,i FROM P ORDER BY i)),
        'models',(SELECT json_group_array(v) FROM (SELECT v,i FROM M ORDER BY i)),
        'sessions',(SELECT json_group_array(coalesce(se.title,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
    'sessionIds',(SELECT json_group_array(v) FROM (SELECT v,i FROM S ORDER BY i)),
        'sessionDirs',(SELECT json_group_array(coalesce(se.directory,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
        'tools',(SELECT COALESCE(json_group_array(json_array(tool_name, c, f, d)),'[]') FROM (SELECT tool_name, count(*) AS c, sum(status<>'completed') AS f, CAST(round(avg(duration_ms)) AS int) AS d FROM tool_usage $scope GROUP BY tool_name ORDER BY c DESC LIMIT 8)),
        'todos',(SELECT json_array(sum(CASE WHEN status='completed' THEN 1 ELSE 0 END), count(*)) FROM todo),
        'stability',(SELECT json_array(COALESCE(sum(retry_count),0), COALESCE(sum(cancelled_by_user),0), COALESCE(sum(CASE WHEN status='error' THEN 1 ELSE 0 END),0)) FROM U),
        'hours',(SELECT COALESCE(json_group_object(hr, c),'{}') FROM (SELECT strftime('%H', started_at/1000,'unixepoch','localtime') AS hr, count(*) AS c FROM U GROUP BY hr)),
        'compactions',(SELECT COALESCE(json_group_array(json_array(SI.i, c.cnt, c.maxpre, json(c.ts), json(c.triggers))),'[]') FROM (SELECT p.session_id AS sid, count(*) AS cnt, max(COALESCE(json_extract(p.data,'$.preCompactTokenCount'),0)) AS maxpre, json_group_array(strftime('%m-%d %H:%M', p.time_created/1000,'unixepoch','localtime')) AS ts, json_group_array(COALESCE(json_extract(p.data,'$.trigger'),'manual') || '/' || COALESCE(json_extract(p.data,'$.phase'),'')) AS triggers FROM part p WHERE json_extract(p.data,'$.type')='compaction' GROUP BY p.session_id) c LEFT JOIN S SI ON SI.v = c.sid WHERE SI.i IS NOT NULL),
        'ctxMix',(SELECT COALESCE(json_group_array(json_array(SI.i, m.t, m.b)),'[]') FROM (SELECT p.session_id AS sid, json_extract(p.data,'$.type') AS t, sum(length(p.data)) AS b FROM part p WHERE p.session_id IN (SELECT DISTINCT session_id FROM R) AND p.session_id IS NOT NULL GROUP BY p.session_id, json_extract(p.data,'$.type')) m LEFT JOIN S SI ON SI.v = m.sid WHERE SI.i IS NOT NULL),
        'sessionAgents',(SELECT COALESCE(json_group_array(json_array(SI.i, a.agent, a.c, a.tok)),'[]') FROM (SELECT COALESCE(${parent_expr}, mu.session_id) AS root_sid, COALESCE(NULLIF(${agent_expr},''),'-') AS agent, count(*) AS c, sum(mu.input_tokens+mu.output_tokens+mu.reasoning_tokens) AS tok FROM R mu LEFT JOIN session ch ON ch.id = mu.session_id WHERE mu.query_source='subagent' GROUP BY 1, 2) a LEFT JOIN S SI ON SI.v = a.root_sid WHERE SI.i IS NOT NULL),
        'sessionTools',(SELECT COALESCE(json_group_array(json_array(SI.i, t.tool, t.c, t.ms)),'[]') FROM (SELECT session_id AS sid, tool_name AS tool, count(*) AS c, CAST(sum(duration_ms) AS int) AS ms FROM tool_usage GROUP BY session_id, tool_name) t LEFT JOIN S SI ON SI.v = t.sid WHERE SI.i IS NOT NULL),
        'disk', json('{"logs":$logs_mb,"rollout":$rollout_mb,"artifacts":$artifacts_mb,"db":$db_mb}'),
        'providerNames', json_extract(json('$PMETA'),'$.providerNames'),
        'projectMap', json_extract(json('$PMETA'),'$.projectMap'),
        'budgetDaily', $BUDGET_D,
        'budgetMonthly', $BUDGET_M,
        'zcodeLocale', '$ZLOC',
        'userLang', '$ULANG',
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
                  R.cache_creation_input_tokens, R.time_to_first_token_ms, R.id, R.retry_count, ${turn_expr}, ${ctx_exc_expr}))
                FROM R
                LEFT JOIN S SI ON SI.v = R.session_id
                LEFT JOIN M MI ON MI.v = R.model_id
                LEFT JOIN P PI ON PI.v = R.provider_id)), '<', '\u003c');")
    fi
    mkdir -p "$(dirname "$out")"
    {
      cat <<'UD_HEAD'
<div id="usage-dashboard">
<style>
/* ===== 主题变量回退：生成页 file:// 直开无宿主注入时不再缺色（值与官方主题一致，宿主内同值覆盖无感） ===== */
#usage-dashboard{
  --background:#ffffff; --foreground:#1a1a1a; --card:#ffffff;
  --muted:#f2f2f3; --muted-foreground:#6b6b70; --border:#e4e4e7;
  --primary:#18181b; --primary-foreground:#ffffff;
  --blue:#2f6bff; --green:#15803d; --red:#dc2626; --yellow:#b45309;
  --viz-series-1:#4066f0; --viz-series-2:#e8890c; --viz-series-3:#0f9d6a;
  --viz-series-4:#ab47bc; --viz-series-5:#d15b5b; --viz-series-6:#2f80c8;
}
@media (prefers-color-scheme: dark){
  #usage-dashboard{
    --background:#1b1b1f; --foreground:#e9e9ec; --card:#232328;
    --muted:#2c2c31; --muted-foreground:#9c9ca6; --border:#3a3a41;
    --primary:#e9e9ec; --primary-foreground:#1b1b1f;
    --blue:#5b8cff; --green:#3fbf7f; --red:#f47166; --yellow:#d9a514;
    --viz-series-1:#6c8cff; --viz-series-2:#e8a15c; --viz-series-3:#5cbf9a;
    --viz-series-4:#c586c0; --viz-series-5:#d16f6f; --viz-series-6:#7fb3e0;
  }
}
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
/* ===== 表单控件：统一设计语言，覆盖宿主 Bootstrap 默认外观 ===== */
#usage-dashboard .form-control,#usage-dashboard .form-select{
  appearance:none;-webkit-appearance:none;
  width:auto;border:1px solid var(--border);border-radius:8px;
  padding:5px 10px;background:var(--card);color:var(--foreground);
  font:inherit;font-size:13px;line-height:1.4;
  transition:border-color .12s,box-shadow .12s,background-color .12s;
}
#usage-dashboard .form-control:hover,#usage-dashboard .form-select:hover{border-color:color-mix(in srgb,var(--muted-foreground) 55%,var(--border));}
#usage-dashboard .form-control:focus,#usage-dashboard .form-select:focus{outline:none;border-color:var(--ud-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ud-accent) 18%,transparent);}
#usage-dashboard .form-control:disabled,#usage-dashboard .form-select:disabled{opacity:.5;cursor:default;}
#usage-dashboard .form-control::placeholder{color:var(--muted-foreground);opacity:.7;}
#usage-dashboard .form-control-sm,#usage-dashboard .form-select-sm{padding:3px 8px;font-size:12px;border-radius:7px;}
#usage-dashboard .form-select{
  padding-right:28px;cursor:pointer;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%238a8a93' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 10px center;
}
#usage-dashboard .form-select-sm{padding-right:24px;background-position:right 8px center;}
#usage-dashboard input[type="search"]::-webkit-search-cancel-button{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:var(--muted-foreground);opacity:.55;cursor:pointer;
  mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 2l8 8M10 2l-8 8' stroke='%23000' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 2l8 8M10 2l-8 8' stroke='%23000' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") center/contain no-repeat;}
#usage-dashboard input[type="search"]::-webkit-search-cancel-button:hover{opacity:.9;}
#usage-dashboard .viz-controls .form-select{max-width:200px;}
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
#usage-dashboard .ud-fact .fv{font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;}
#usage-dashboard .ud-fact .fs{font-size:11px;color:var(--muted-foreground);font-weight:400;margin-left:5px;}
#usage-dashboard .ud-fact.ud-wide{grid-column:1/-1;flex-wrap:wrap;}
#usage-dashboard .ud-collapsed .ud-fact:nth-child(n+7){display:none;}
#usage-dashboard .ud-more{margin-top:6px;}
#usage-dashboard .ud-more .btn{font-size:11.5px;padding:1px 10px;margin:0;}
#usage-dashboard .ud-budget-bar{flex:0 0 110px;height:5px;border-radius:3px;background:var(--muted);overflow:hidden;}
#usage-dashboard .ud-budget-bar>i{display:block;height:100%;background:var(--ud-accent);border-radius:3px;}
#usage-dashboard .ud-budget-bar.ud-over>i{background:var(--red,var(--viz-series-1));}
#usage-dashboard .ud-budget-bar.ud-warn>i{background:var(--yellow,var(--viz-series-2));}
/* ===== 图例（构成/趋势） ===== */
#usage-dashboard .ud-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:6px 0;}
#usage-dashboard .ud-legend .form-check{display:inline-flex;align-items:center;gap:4px;margin:0;}
#usage-dashboard .ud-brow-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 6px;border-radius:6px;cursor:pointer;margin:0 -6px;min-width:0;}
#usage-dashboard .ud-brow-row:hover{background:var(--muted);}
#usage-dashboard .ud-brow-row .nm{font-weight:500;flex:none;}
#usage-dashboard .ud-brow-arrow{display:inline-block;transition:transform .15s;color:var(--muted-foreground);width:12px;flex:none;}
#usage-dashboard .ud-brow-row.ud-open .ud-brow-arrow{transform:rotate(90deg);}
#usage-dashboard .ud-brow-row .bar{flex:1 1 20px;max-width:72px;height:5px;border-radius:3px;background:var(--muted);overflow:hidden;}
#usage-dashboard .ud-brow-row .bar i{display:block;height:100%;border-radius:3px;}
#usage-dashboard .ud-brow-row .abs{font-size:11px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;flex:none;}
#usage-dashboard .ud-brow-row .n{font-weight:600;font-variant-numeric:tabular-nums;flex:none;min-width:30px;text-align:right;}
#usage-dashboard .ud-brow-items{margin:2px 0 6px 18px;border-left:2px solid var(--border);padding-left:10px;}
#usage-dashboard .ud-brow-item{display:flex;gap:10px;font-size:11px;padding:2px 0;align-items:baseline;min-width:0;}
#usage-dashboard .ud-brow-item .ts{color:var(--muted-foreground);flex:none;font-variant-numeric:tabular-nums;}
#usage-dashboard .ud-brow-item .sn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
#usage-dashboard .ud-brow-item .sn .full{display:none;}
#usage-dashboard .ud-brow-item.ud-full .sn{white-space:normal;word-break:break-all;}
#usage-dashboard .ud-brow-item.ud-full .sn .full{display:inline;}
#usage-dashboard .ud-brow-item.ud-full .sn{color:var(--foreground);}
#usage-dashboard .ud-brow-item.ud-full .sn{white-space:normal;word-break:break-word;}
#usage-dashboard .ud-toolhead{font-weight:600;margin:4px 0 4px;}
#usage-dashboard .ud-tooljson{background:var(--muted);border-radius:8px;padding:6px 10px;max-height:280px;overflow-y:auto;}
#usage-dashboard .ud-tooljson .ud-kvrow{display:flex;gap:10px;padding:3px 0;border-bottom:1px solid var(--ud-soft);align-items:baseline;}
#usage-dashboard .ud-tooljson .ud-kvrow:last-child{border-bottom:none;}
#usage-dashboard .ud-tooljson .ud-kvrow .k{flex:none;min-width:90px;max-width:30%;color:var(--muted-foreground);font-family:var(--ud-mono);font-size:11px;word-break:break-all;}
#usage-dashboard .ud-tooljson .ud-kvrow .v{flex:1;font-family:var(--ud-mono);font-size:11px;white-space:pre-wrap;word-break:break-word;}
#usage-dashboard .ud-rawbody{font-family:var(--ud-mono);font-size:11px;background:var(--muted);border-radius:8px;padding:6px 10px;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow-y:auto;margin:4px 0 0;}
#usage-dashboard .ud-msgbody{white-space:pre-wrap;word-break:break-word;line-height:1.7;max-height:320px;overflow-y:auto;background:var(--muted);border-radius:8px;padding:8px 12px;margin:4px 0 0;}
#usage-dashboard .ud-msgbody.ud-reasoning{color:var(--muted-foreground);font-style:italic;}
#usage-dashboard .ud-brow-item .abs{color:var(--muted-foreground);flex:none;font-variant-numeric:tabular-nums;}
#usage-dashboard .ud-leg{display:flex;flex-direction:column;gap:3px;min-width:0;}
#usage-dashboard .ud-leg-row{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.5;padding:1px 4px;margin:0 -4px;border-radius:5px;min-width:0;}
#usage-dashboard .ud-leg-row:hover{background:var(--muted);}
#usage-dashboard .ud-leg-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;}
#usage-dashboard .ud-leg-row .bar{flex:1 1 20px;max-width:56px;min-width:14px;height:5px;border-radius:3px;background:var(--muted);overflow:hidden;}
#usage-dashboard .ud-leg-row .bar i{display:block;height:100%;border-radius:3px;}
#usage-dashboard .ud-leg-row .abs{font-size:11px;color:var(--muted-foreground);font-variant-numeric:tabular-nums;flex:none;}
#usage-dashboard .ud-leg-row .n{font-weight:600;font-variant-numeric:tabular-nums;flex:none;min-width:30px;text-align:right;}
#usage-dashboard .ud-pill{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--muted);font-size:11px;color:var(--muted-foreground);margin:0 6px 4px 0;white-space:nowrap;}
#usage-dashboard .ud-hero-num{font-size:26px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;}
#usage-dashboard .ud-hero-pct{font-size:22px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;}
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
/* 热力图：格子悬停描边（十字定位感） */
#usage-dashboard #ud-heatmap svg rect:hover{stroke:var(--foreground);stroke-width:1;}
/* ===== 环比变更徽章（quota-peek 式：涨幅分级着色） ===== */
#usage-dashboard .ud-badge{display:inline-flex;align-items:center;height:17px;padding:0 6px;border-radius:5px;font-size:11px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;flex:none;vertical-align:1px;}
#usage-dashboard .ud-badge.up{background:color-mix(in srgb,var(--red) 14%,transparent);color:var(--red);}
#usage-dashboard .ud-badge.down{background:color-mix(in srgb,var(--green) 14%,transparent);color:var(--green);}
#usage-dashboard .ud-badge.flat{background:var(--muted);color:var(--muted-foreground);font-weight:500;}
/* ===== 计费窗口（近似）横条列表 ===== */
#usage-dashboard .ud-win-list{display:flex;flex-direction:column;gap:6px;}
#usage-dashboard .ud-win{display:grid;grid-template-columns:200px 1fr auto;align-items:center;gap:12px;padding:5px 10px;border:1px solid var(--ud-soft);border-radius:9px;}
#usage-dashboard .ud-win-active{border-color:color-mix(in srgb,var(--ud-accent) 35%,transparent);background:color-mix(in srgb,var(--ud-accent) 6%,var(--card));}
#usage-dashboard .ud-win-t{font-size:12px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#usage-dashboard .ud-win-bar{height:8px;border-radius:4px;background:var(--muted);overflow:hidden;}
#usage-dashboard .ud-win-bar>i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,color-mix(in srgb,var(--ud-accent) 55%,transparent),var(--ud-accent));}
#usage-dashboard .ud-win-v{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;}
#usage-dashboard .ud-win-v .fs{font-size:11px;color:var(--muted-foreground);font-weight:400;margin-left:3px;}
@media (max-width:560px){#usage-dashboard .ud-win{grid-template-columns:150px 1fr auto;gap:8px;}}
/* ===== 页签切换淡入（尊重系统减弱动效偏好） ===== */
#usage-dashboard [role=tabpanel]:not([hidden]){animation:ud-fade .18s ease-out;}
@keyframes ud-fade{from{opacity:0;transform:translateY(2px);}to{opacity:1;transform:none;}}
@media (prefers-reduced-motion:reduce){
  #usage-dashboard [role=tabpanel]:not([hidden]){animation:none;}
  #usage-dashboard .ud-turn::before{animation:none;}
  #usage-dashboard tbody tr{transition:none;}
}
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
#usage-dashboard .ud-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:4px 0;}
#usage-dashboard .ud-kv>div{background:var(--muted);border-radius:10px;padding:7px 10px;}
#usage-dashboard .ud-kv-l{font-size:11px;color:var(--muted-foreground);}
#usage-dashboard .ud-kv-v{font-size:13px;font-weight:500;}
#usage-dashboard .ud-sec{margin-top:14px;}
#usage-dashboard pre.ud-raw{font-size:11px;background:var(--muted);border-radius:8px;padding:8px 10px;overflow-x:auto;white-space:pre;}
/* ===== 设置弹窗：毛玻璃遮罩 + 悬浮面板 + 吸顶标题 ===== */
#usage-dashboard #ud-mgr-mask{position:fixed;inset:0;background:rgba(8,10,14,.46);-webkit-backdrop-filter:blur(10px) saturate(1.1);backdrop-filter:blur(10px) saturate(1.1);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px;animation:ud-fade-in .14s ease-out;}
#usage-dashboard #ud-mgr-mask[hidden]{display:none;}
@keyframes ud-fade-in{from{opacity:0}to{opacity:1}}
@keyframes ud-pop-in{from{opacity:0;transform:translateY(10px) scale(.975)}to{opacity:1;transform:none}}
#usage-dashboard .ud-mgr-panel{width:min(760px,96vw);max-height:88vh;overflow:auto;border-radius:18px;border:1px solid color-mix(in srgb,var(--border) 80%,transparent);background:var(--card);box-shadow:0 24px 64px rgba(0,0,0,.30),0 2px 8px rgba(0,0,0,.12);animation:ud-pop-in .18s cubic-bezier(.2,.8,.2,1);}
#usage-dashboard .ud-mgr-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:14px 20px 12px;border-bottom:1px solid var(--ud-soft);background:color-mix(in srgb,var(--card) 88%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);}
#usage-dashboard .ud-mgr-head h3{margin:0;font-size:15px;font-weight:700;letter-spacing:.01em;}
#usage-dashboard .ud-mgr-close{width:30px;height:30px;border-radius:50%;border:1px solid transparent;background:var(--muted);color:var(--muted-foreground);font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .12s,color .12s,transform .12s;}
#usage-dashboard .ud-mgr-close:hover{background:color-mix(in srgb,var(--foreground) 10%,transparent);color:var(--foreground);transform:scale(1.06);}
#usage-dashboard .ud-mgr-body{padding:16px 20px 20px;}
#usage-dashboard .ud-mgr-t input{width:86px;padding:4px 9px;font-size:12px;border-radius:8px;border-color:transparent;background:color-mix(in srgb,var(--muted) 55%,transparent);transition:border-color .12s,background .12s;}
#usage-dashboard .ud-mgr-t input:hover{border-color:color-mix(in srgb,var(--muted-foreground) 55%,var(--border));}
#usage-dashboard .ud-mgr-t input:focus{outline:none;border-color:var(--ud-accent);background:var(--card);box-shadow:0 0 0 3px color-mix(in srgb,var(--ud-accent) 18%,transparent);}
#usage-dashboard #ud-mgr-rows tr{transition:background .1s;}
#usage-dashboard #ud-mgr-rows tbody tr:hover{background:color-mix(in srgb,var(--muted) 38%,transparent);}
#usage-dashboard #ud-mgr-wrap thead th{position:sticky;top:0;z-index:1;background:var(--card);box-shadow:0 1px 0 var(--border);}
#usage-dashboard .ud-mgr-act{margin:0;padding:2px 10px;font-size:12px;border-radius:7px;}
#usage-dashboard .ud-mgr-act.ud-mgr-del:hover{color:var(--red);border-color:color-mix(in srgb,var(--red) 45%,transparent);}
#usage-dashboard .ud-mgr-card{background:color-mix(in srgb,var(--muted) 34%,transparent);border:1px solid var(--ud-soft);border-radius:12px;padding:10px 12px;margin:6px 0 2px;}
#usage-dashboard .ud-mgr-card .ud-sw-row{border-bottom:none;padding:5px 0;}
#usage-dashboard .ud-mgr-h{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:650;margin:20px 0 8px;padding-top:16px;border-top:1px solid var(--ud-soft);}
#usage-dashboard .ud-mgr-h::before{content:'';width:3px;height:12px;border-radius:2px;background:var(--ud-accent);opacity:.75;flex:none;}
#usage-dashboard .ud-mgr-h:first-child{border-top:none;padding-top:0;margin-top:0;}
#usage-dashboard .ud-mgr-sub{font-size:11.5px;color:var(--muted-foreground);margin:2px 0 8px;}
#usage-dashboard .ud-sw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--ud-soft);}
#usage-dashboard .ud-sw-row>div:first-child{flex:1 1 220px;} /* 窄屏描述换行堆叠，控件不被挤成竖条 */
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
  <input type="search" class="form-control form-control-sm" id="ud-f-q" placeholder="搜索会话 / 模型 / 来源…" style="max-width:200px" aria-label="文本筛选">
  <div class="viz-row" role="group" aria-label="时间范围" id="ud-f-range">
    <button type="button" class="ud-toggle" data-r="today" aria-pressed="true">今天</button>
    <button type="button" class="ud-toggle" data-r="yday" aria-pressed="false">昨天</button>
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
      <div><h3 style="margin:0">设置</h3><div class="text-small text-muted" style="margin-top:1px">价格 · 预算 · 通知 · 厂商配额（全部本地存储）</div></div>
      <button type="button" class="ud-mgr-close" id="ud-mgr-close" aria-label="关闭设置" title="关闭">✕</button>
    </div>
    <div class="ud-mgr-body" id="ud-mgr-body"></div>
  </div>
</div>
<div class="nav nav-pills" role="tablist" aria-label="用量视图">
  <button class="nav-link active" id="ud-tab-overview" role="tab" aria-controls="ud-overview" aria-selected="true" type="button">总览</button>
  <button class="nav-link" id="ud-tab-trend" role="tab" aria-controls="ud-trend" aria-selected="false" type="button">每日趋势</button>
  <button class="nav-link" id="ud-tab-sessions" role="tab" aria-controls="ud-sessions" aria-selected="false" type="button">会话排行</button>
  <button class="nav-link" id="ud-tab-models" role="tab" aria-controls="ud-models" aria-selected="false" type="button">模型效率</button>
  <button class="nav-link" id="ud-tab-projects" role="tab" aria-controls="ud-projects" aria-selected="false" type="button">项目用量</button>
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
  <div class="ud-sec" id="ud-budget-hero" hidden></div>
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
  <div id="ud-hours" style="overflow-x:auto"></div>
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h3 style="margin-bottom:0">活跃热力图</h3>
    <div class="viz-row" role="group" aria-label="热力图粒度" id="ud-heat-toggle">
      <button type="button" class="ud-toggle" data-hm="hour" aria-pressed="true">小时</button>
      <button type="button" class="ud-toggle" data-hm="day" aria-pressed="false">每日</button>
      <button type="button" class="ud-toggle" data-hm="week" aria-pressed="false">每周</button>
      <button type="button" class="ud-toggle" data-hm="month" aria-pressed="false">月历</button>
    </div>
  </div>
  <div id="ud-heatmap" style="overflow-x:auto"></div>
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
  <div style="display:flex;justify-content:space-between;align-items:center">
    <h3 style="margin-bottom:0">计费窗口（近似）</h3>
    <span class="text-small text-muted">相邻请求间隔 ≥5h 切分</span>
  </div>
  <div id="ud-blocks"></div>
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
<div id="ud-projects" role="tabpanel" aria-labelledby="ud-tab-projects" hidden>
  <p class="text-small text-muted">按项目目录聚合（ccusage project / CCMeter 项目卡片的本地版）：点击项目行可跳到会话排行并只看该项目；点击表头排序。</p>
  <span id="ud-proj-filter" class="ud-tag" hidden style="cursor:pointer" title="点击清除项目筛选"></span>
  <div class="table-responsive"><table class="table table-sm">
    <thead id="ud-projects-head"></thead>
    <tbody id="ud-projects-body"></tbody>
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
      # < 的转义已在 SQL 层完成（replace → 反斜杠 u003c）；bash 3.2 的模式替换运算符
      # 对大串是平方级性能陷阱（见 META SQL 处注释），这里必须原样输出。
      printf '%s\n' "$META"
      cat <<'UD_TAIL'
;
// ===== i18n 基础设施：中文原文为 key 的字典 + tr() 查表（缺失回退中文原文）=====
// 语言判定优先级：localStorage 显式选择 > 系统语言（zh 开头为中文，其余英文）。
// v1 覆盖高频可见文案（页签/筛选/KPI/洞察标签/列头/按钮/空态）；长句口径说明暂中文，逐步补全。
var I18N_EN = {
  '亿': "B",
  '万': "0K",
  '会话用量 · ': "Session usage · ",
  '最近请求：': "Last request: ",
  '暂无请求': "No requests",
  ' · 会话信息': " · Session info",
  '定位：': "Scope: ",
  '会话 ID：': "Session ID: ",
  '完成': "Done",
  '失败': "Failed",
  '已取消': "Cancelled",
  '进行中': "Running",
  '系统': "System",
  'GLM Coding Plan 个人版': "GLM Coding Plan Personal",
  'GLM Coding Plan 入门版': "GLM Coding Plan Starter",
  '官方账号': "Official account",
  '自定义接入': "Custom (BYOK)",
  '节假日价': "Holiday price",
  '周末价': "Weekend price",
  '高峰': "Peak",
  '空闲': "Off-peak",
  '标准': "Standard",
  '完成 ': "Done ",
  ' · 进行中 ': " · running ",
  '缓存命中率 ': "Cache hit ",
  '本地快照 ': "Local snapshot ",
  ' · 已加载 ': " · loaded ",
  ' 条': " rows",
  '，统计仅含已加载记录': ", stats cover loaded rows only",
  '查看失败 / 取消（': "View failed/cancelled (",
  ' 个模型': " models",
  '日均 ': "Daily avg ",
  ' · 覆盖 ': " · over ",
  ' 天': " days",
  '缓存读 ': "Cache read ",
  ' · 缓存写 ': " · cache write ",
  '含子代理请求 ': "incl. subagent ",
  ' 次': " reqs",
  '合计 ': "Total ",
  '数据截至 ': "Data as of ",
  ' · 已加载最近 ': " · loaded last ",
  ' 条 · 仅统计本机': " rows · local only",
  '前日 ': "Day before ",
  '昨日 ': "Yesterday ",
  '月预算 ': "Monthly budget ",
  '达 80% / 100% 时系统提醒': "system alert at 80% / 100%",
  '最长 ': "max ",
  ' · 至 ': " · until ",
  ' · 周末全天空闲价': " · weekend off-peak all day",
  ' · 法定节假日全天空闲价': " · public-holiday off-peak all day",
  '读 ': "read ",
  '主会话 / 子代理': "Main / Subagent",
  ' 点': ":00",
  '数据体量': "Data Footprint",
  '导出 ': "Export ",
  ' · 库 ': " · db ",
  '未定价 ': "unpriced ",
  '今日折算 / 日预算': "Today spent / daily budget",
  '本月折算 / 月预算': "Month spent / monthly budget",
  '浪费取证': "Waste forensics",
  ' 次失败/取消': " failed/cancelled",
  '展开全部 ': "Expand all ",
  ' 项': " items",
  '累计 ': "total ",
  ' 次请求 · ': " reqs · ",
  ' tok · 缓存 ': " tok · cache ",
  ' 次 · ': " reqs · ",
  '% · 缓存 ': "% · cache ",
  ' 次调用': " calls",
  ' · 均 ': " · avg ",
  ' · 失败 ': " · failed ",
  '调用': "calls",
  '峰值 ': "peak ",
  ' 点 · ': ":00 · ",
  ' 次请求': " reqs",
  '日一二三四五六': "SMTWTFS",
  ' 年 ': " ",
  ' 月': "M",
  ' 当周 · ': "week of · ",
  ' 天，': " days, ",
  '压缩 ': "compact ",
  ' 次 · 压缩前水位最高 ': " reqs · pre-compact peak ",
  '无压缩记录': "No compaction records",
  '上下文压缩': "Context Compaction",
  '切换模型 → ': "Model switch → ",
  ' · 第 ': " · round ",
  ' 轮': "",
  ' · 输入 ': " · in ",
  ' tok · 生成 ': " tok · out ",
  ' · 子代理': " · subagent",
  ' · 占 ': " · ",
  ' 窗口 ': " of window ",
  '%（上限 ': "% (limit ",
  ' · 悬停看点明细': " · hover for request details",
  ' · 累计 ': " · total ",
  '请求 / 缓存率': "Requests / cache %",
  '平均输出速率': "Avg output speed",
  ' tok/s（加权）': " tok/s (weighted)",
  '（未知目录）': "(unknown directory)",
  ' · 含 ': " · ",
  ' 个目录': " directories",
  ' · 预计全窗 ': " · projected full window ",
  ' ms · 首字占比 ': " ms · TTFT share ",
  ' · 以下为 provider 上报的原始用量': " · raw provider-reported usage below",
  '(无)': "(none)",
  '错误: ': "Error: ",
  '首字': "TTFT",
  '成本': "Cost",
  '加载更多（已显示 ': "Load more (shown ",
  ' · 缓存读 ': " · cache read ",
  '当前指标合计：请求数 ': "Current metric total: requests ",
  ' · 生成 ': " · out ",
  '会话：': "Session: ",
  '日期：': "Date: ",
  '项目：': "Project: ",
  '全部来源': "All providers",
  '全部模型': "All models",
  '同步中…': "Syncing…",
  '同步失败': "Sync failed",
  '已配置 · 输入新值更换': "Configured · enter a new value to replace",
  '未配置': "Not configured",
  '权限等待提醒': "Permission-wait reminder",
  'Agent 弹出批准请求时通知你——挂机跑长任务不漏确认': "Notifies you when the agent waits for approval — never miss one on long unattended runs",
  '预算 / 燃烧告警': "Budget / burn alerts",
  '日折算成本达预算 80% / 100% 时提醒；今日用量超近 7 天日均 50% 也会提示': "macOS alert at 80% / 100% of the daily budget; also when today exceeds 1.5× the 7-day daily average",
  '官方账户余额': "Official account balance",
  '5 小时 / 周窗口用量': "5-hour / weekly window usage",
  '预付额度使用情况': "Prepaid credit usage",
  'Token Plan 窗口用量': "Token Plan window usage",
  '重新打开面板后生效': "Reopen the panel to apply",
  '已保存，重新打开面板后生效': "Saved. Reopen the panel to apply",
  '上下文 Top →': 'Context Top →',
  '加载中…': "Loading…",
  '子代理并行时间轴': 'Subagent parallel timeline',
  '上下文浏览器': 'Context Browser',
  ' 条': ' items',
  '仅展示最大的前 30 条': 'showing the largest 30 items only',
  '近 1h': 'last 1h',
  '水位': 'Level',
  '增量': 'Delta',
  '点击展开/收起全文': 'click to expand/collapse full text',
  '点击看该子代理请求': 'click to view its requests',
  '耗时构成': 'Timing Breakdown',
  '首字等待': 'TTFT wait',
  '生成': 'Generation',
  '工具执行': 'Tool runs',
  '活跃时长': 'Active time',
  '本月 ': 'This month ',
  '燃烧率 ': 'Burn rate ',
  '达 80% / 100% 时系统提醒': 'system alert at 80% / 100%',
  '当前上下文': 'Current Context',
  'of context used': 'of context used',
  '窗口上限 ': 'window limit ',
  '缓存率 ': 'cache ',
  '压缩 ': 'compacted ',
  ' 次': ' times',
  '无压缩': 'no compaction',
  '缓存读': 'cache read',
  '未命中输入': 'uncached input',
  '峰值 ': 'peak ',
  '子代理散点': 'subagent dots',
  '工具字节 Top（存储字节）': 'Tool bytes top (storage bytes)',
  '文件字节 Top（Read/Edit/Write）': 'File bytes top (Read/Edit/Write)',
  '保存中…': "Saving…",
  '已保存': "Saved",
  '保存 Key': "Save Keys",
  '启动中…': "Starting…",
  '已启动（浏览器将自动打开）': "Started (browser will open)",
  '打开本地面板': "Open local panel",
  '准备中…': "Preparing…",
  '当前环境不支持导出': "Export not supported here",
  '已交浏览器下载': "Sent to browser download",
  '导出失败（需本地面板）': "Export failed (local panel only)",
  '高峰 1× · 18:00 后转半价': "Peak 1× · half price after 18:00",
  '非高峰 0.5× · 工作日 14:00–18:00 为高峰': "Off-peak 0.5× · workday 14:00–18:00 is peak",
  '配额': "Quota",
  ' 重置': " reset",
  '总览': 'Overview', '每日趋势': 'Daily Trend', '会话排行': 'Sessions', '模型效率': 'Model Efficiency',
  '项目用量': 'Projects', '请求明细': 'Requests', '失败请求': 'Failures',
  '来源': 'Provider', '模型': 'Model', '今天': 'Today', '昨天': 'Yesterday', '近 7 天': '7 Days', '近 30 天': '30 Days', '全部': 'All',
  '折算成本（API 牌价）': 'Converted Cost (API list)', '同步价格': 'Sync Prices', '设置': 'Settings',
  '导出报表': 'Export Report', '刷新数据': 'Refresh', '刷新中…': 'Refreshing…', '同步数据': 'Sync Data', '同步中…': 'Syncing…', '同步失败': 'Sync failed', '自动刷新': 'Auto refresh', '关': 'Off', '关闭': 'Close', '近 1h 合计 ': 'last-1h total ',
  '请求次数': 'Requests', '输入 token': 'Input Tokens', '生成 token': 'Output Tokens', '活跃会话': 'Active Sessions',
  '缓存读': 'Cache Read', '缓存写': 'Cache Write', '日均': 'Daily Avg', '覆盖': 'Days', '输出 + 思考 token': 'Output + Reasoning Tokens', '合计': 'Total', '含子代理请求': 'incl. subagent requests',
  '用量洞察': 'Insights', '今日用量': 'Today', '昨日用量': 'Yesterday', '近 7 天用量': '7-Day', '近 30 天用量': '30-Day', '累计用量': 'All-Time',
  '活跃天数': 'Active Days', '连续活跃': 'Streak', '最长': 'max', '峰值日': 'Peak Day', '缓存命中率': 'Cache Hit', '读': 'read',
  '近 1h 燃烧率': '1h Burn Rate', '节奏：放缓': 'Pace: slowing', '节奏：平稳': 'Pace: steady', '节奏：加速': 'Pace: accelerating',
  '当前时段': 'Current Tier', '任务完成': 'Todos Done', '重试 / 取消': 'Retries / Cancels', '平均耗时': 'Avg Duration',
  '今日预算': 'Today Budget', '月预算': 'Monthly', '峰值时段': 'Peak Hours', '缓存量（读+写）': 'Cache Volume (read+write)',
  '展开全部': 'Expand all', '收起洞察': 'Collapse', '项': 'items',
  '性能体检': 'Health Check', '平均首字': 'Avg TTFT', '首个 token 延迟': 'time to first token', '生成速率': 'Gen Speed',
  '错误率': 'Error Rate', '失败 / 全部': 'failed / total', '峰值上下文': 'Peak Context', '压缩前最高': 'pre-compact max', '工具调用': 'Tool Calls', '累计': 'total',
  '次': 'calls',
  '厂商配额': 'Provider Quotas', '来源构成': 'By Provider', '模型分布': 'By Model', '常用工具': 'Top Tools',
  '最活跃会话（Top 5）': 'Most Active Sessions (Top 5)', '会话': 'Session', '请求数': 'Requests', 'token 合计': 'Total Tokens',
  '最后活动': 'Last Active', '会话数': 'Sessions', '近 7 天': '7-Day', '项目': 'Project', '平均 tok/s': 'Avg tok/s',
  '平均首字': 'Avg TTFT', '失败率': 'Fail Rate', '平均产出': 'Avg Output',
  '时间': 'Time', '类型': 'Type', '状态': 'Status', '输入': 'Input', '生成': 'Output', '缓存率': 'Cache %',
  '日期': 'Date', '请求': 'Requests', '缓存命中': 'Cache Hit', '每月汇总': 'Monthly', '每日明细': 'Daily Detail', '月份': 'Month',
  '健康': 'Health', '压缩': 'Compact', '折算成本': 'Cost', '耗时': 'Duration',
  '当前筛选下暂无数据': 'No data for current filters', '暂无数据': 'No data',
  '关闭设置': 'Close settings', '用量筛选': 'Usage filters', '文本筛选': 'Text filter', '时间范围': 'Time range', '甜甜圈图': 'Donut chart', '点击清除会话筛选': 'Click to clear the session filter', '热力图粒度': 'Heatmap granularity', '时段分布指标': 'Hourly metric', '价格与预算设置': 'Price & budget settings', '每日用量趋势（按来源堆叠）': 'Daily trend (stacked by provider)', '24 小时用量分布': '24-hour distribution', '近 7 天趋势': 'Last 7 days', '生成 token / 请求（单轮平均产出）': 'Generated tokens per request (single-turn avg output)',
  '点击表头排序，筛选条件在上方全局生效；点击行可展开会话详情。': 'Click headers to sort; filters above apply globally; click a row to expand session details.',
  '点击表头排序；点击任意请求行可展开该请求的完整信息。': 'Click headers to sort; click any request row to expand its full details.',
  '主会话': 'Main', '子代理': 'Subagent', '其他': 'Other',
  '本轮用量': 'This Turn', '更新': 'updated', '截至': 'as of', '缓存': 'cache', '实时': 'Live', '燃烧率': 'burn rate', '近 5h': 'last 5h', '今日': 'today',
  '搜索会话 / 模型 / 来源…': 'Search sessions / models / providers…',
  '事件时间线': "Event Timeline",
  '项目目录': "Project directory",
  '来源：': "Provider: ",
  '模型占比（按 token）': "By Model (tokens)",
  '使用工具（调用次数占比）': "Tool Usage (by calls)",
  '查看该会话请求日志 →': "View session request log →",
  '时段分布': 'Hourly Distribution', '小时': 'Hour', '每日': 'Day', '每周': 'Week', '月历': 'Month',
  '近 7 天，每天按 0–23 时切分；着色深浅按该小时 token 用量，悬停查看明细。': 'Last 7 days split into 0–23h slots; darker means more tokens in that hour. Hover for details.',
  '每日自动同步模型价': 'Auto-sync model prices daily',
  '共 N 个事件': 'N events in total',
  '上下文构成': 'Context Composition',
  '对话文本': 'Conversation text',
  '思考': 'Reasoning',
  '工具调用与结果': 'Tool calls & results',
  '步骤骨架': 'Step skeleton',
  '附件': 'Attachments',
  '元数据与其他': 'Metadata & other',
  '按本地存储字节近似，非模型实际读取的 token 计量': 'Approximated by local storage bytes, not the tokens actually read by the model',
  '无分段数据': 'No part data',
  'Agent 团队（子代理分布）': 'Agent team (subagent breakdown)',
  '未知来源': 'Unknown',
  '（': ' (',
  '）': ')',
  '自动': 'auto',
  '手动': 'manual',
  '超出窗口': 'over window',
  ' · 已超上下文窗口 · 输入 ': ' · over context window · input ',
  '按请求输入 token 近似 · 峰值 ': 'Approx. per-request input tokens · peak ',
  '压缩事件 ': 'Compact event ',
  '压缩事件': 'Compact events',
  '当前环境不支持面板内编辑。两种方式：': 'In-panel editing is not available here. Two options:',
  '打开本地面板编辑（推荐，同样的界面）': 'Open the local panel editor (recommended, same UI)',
  '直接编辑': 'Edit',
  '（字段 in / out / cache，每百万 token）': ' directly (fields in / out / cache, per million tokens)',
  '或运行': 'or run',
  "成本单价（元 / 每百万 token）": "Model unit prices (CNY / million tokens)",
  "GLM 5.3 系为智谱官网权威价；其余来自 models.dev（USD 按 7.2 换算）。默认列出当前用量相关模型，搜索可查全量；修改保存后按新价重算。": "GLM 5.3 prices are from z.ai official; others from models.dev (USD x 7.2). Models in current usage are listed by default, search for all. Recalculated at the new price after saving.",
  "搜索模型…": "Search models…",
  "模型": "Model",
  "输入": "In",
  "输出": "Out",
  "缓存读": "Cache Read",
  "窗口": "Context",
  "上下文窗口 token 数，留空自动检测": "Context window tokens; leave blank to auto-detect",
  "新增模型价：": "Add model price: ",
  "模型名（与请求记录一致）": "Model name (must match request records)",
  "添加": "Add",
  "通用": "General",
  "USD→CNY 汇率": "USD→CNY rate",
  "保存通用": "Save General",
  "预算（折算金额，超 80% 黄色进度、100% 红色）": "Budget (converted amount; yellow past 80%, red at 100%)",
  "日预算 ¥": "Daily ¥",
  "月预算 ¥": "Monthly ¥",
  "保存预算": "Save Budget",
  "通知（macOS 系统通知，全部本地计算、零模型开销）": "Notifications (macOS system notifications, all local, zero model cost)",
  "语言选择保存到本地文件，全面板共享：本地面板与生成页立即生效；侧栏面板重新打开后生效": "Saved to a local file shared by all panels: applies immediately in the local panel and generated pages; reopen the side panel to apply",
  "每轮用量统计": "Per-turn Usage Stats",
  "每轮回合结束弹通知显示本轮速率 / 缓存率 / 耗时（不进入对话上下文）。选「关」时统计仍显示在侧栏面板顶部横幅": "A notification with rate / cache / duration pops when each turn ends (never sent to the model). When off, stats still show in the side panel top banner",
  "关": "Off",
  "系统通知（推荐）": "System notification (recommended)",
  "对话内统计行（约 0.3k token/轮）": "In-conversation stats line (~0.3k tokens/turn)",
  "厂商配额（可选）": "Vendor quotas (optional)",
  "以下 Key 仅发送到对应厂商官方域名做只读查询，保存在本地": "Keys below are sent only to the corresponding vendor official domain for read-only queries and stored locally in",
  "在总览页聚合显示各厂商套餐 / 额度用量。GLM 无需配置（自动读客户端日志）；": "Aggregates vendor plan / quota usage on the Overview tab. GLM needs no setup (reads client logs automatically); ",
  "（权限 0600）": " (permission 0600).",
  "权限提醒与每轮统计依赖会话钩子，修改后重开会话生效；预算告警立即生效。": "Permission alerts and per-turn stats rely on session hooks: reopen a session to apply. Budget alerts apply immediately.",
  "当前用量": "in use",
  "上下文窗口 token 数，留空按模型自动检测（水印曲线用）": "Context window tokens; blank = auto-detect per model (watermark curve)",
  "保存": "Save",
  "删除": "Del",
  "删除该模型价": "Delete this price",
  "已配置": "Configured",
  "设置": "Settings",
  "价格 · 预算 · 通知 · 厂商配额（全部本地存储）": "Prices · Budget · Notifications · Vendor quotas (all stored locally)",
  "时": ":00",
  "行=日期，列=0-23 时": "rows = dates, columns = 0-23h",
  "近 7 天小时热力图": "Last-7-days hourly heatmap",
  "活跃热力图": "Activity Heatmap",
  "活跃热力图（每周 token）": "Activity heatmap (weekly tokens)",
  "活跃热力图（每日 token）": "Activity heatmap (daily tokens)",
  "共 N 周": "N weeks in total",
  "共 N 天，M 天有用量": "N days, M with usage",
  "缓存读 token": "Cache-read tokens",
  "计费窗口（近似）": "Billing windows (approx.)",
  "相邻请求间隔 ≥5h 切分": "new window after >=5h idle",
  "按模型对比效率与成本：平均输出速率（生成 token / 生成耗时）、平均首字延迟、失败率、每 1k token 折算成本。随上方全局筛选联动；点击模型名只看该模型。": "Compares model efficiency and cost: avg output speed (output tokens / generation time), avg TTFT, fail rate, cost per 1k tokens. Follows the global filters above; click a model name to focus it.",
  "输入 token": "Input tokens",
  "生成 token": "Output tokens",
  "合计": "Total",
  "成本 / 1k tok": "Cost / 1k tok",
  "近似口径：按相邻请求间隔 ≥5h 开新窗，官方窗口起点在服务端，仅作节奏参考。": "Approximation: a new window opens after >=5h between requests; the official window start is server-side. For pacing reference only.",
  "子代理 ×": "Subagent ×",
  "厂商配额": "Vendor Quotas",
  "积分时段": "Off-peak windows",
  "已用 ": "Used ",
  "合计 ": "Total ",
  "按项目目录聚合（ccusage project / CCMeter 项目卡片的本地版）：点击项目行可跳到会话排行并只看该项目；点击表头排序。": "Aggregated by project directory (local take on ccusage project / CCMeter project cards): click a project row to jump to Sessions filtered to it; click headers to sort.",
  "全部状态": "All statuses",
  "上一页": "Prev",
  "下一页": "Next",
  "共 ": "Total ",
  " 条": " rows",
  "活跃": "Active",
  "点击只看该项目的会话": "Click to show only this project's sessions",
  "健康分 ": "Health score ",
  "／100：失败率×60 + 取消率×25 + 重试率（封顶 15）加权扣分": "/100: fail rate x60 + cancel x25 + retry x15 (capped) deducted",
  "（全量 ": " (total ",
  "）": ")",
  "（仅显示前 60）": " (showing first 60)",
  "已选": "Selected",
  "跳转到页": "Go to page",
  "点击只看该会话": "Click to show only this session",
  "点击只看该模型": "Click to show only this model",
  '启动失败：请在终端运行 usage.sh serve': 'Failed to start: run "usage.sh serve" in a terminal'
};
var I18N_LANG = 'zh';
try {
  // 语言判定：手动选择(localStorage) > 侧栏/本地跟随 ZCode 界面语言(localePreference) > 浏览器/WebView 语言
  // serve 浏览器模式恒跟随浏览器（独立服务的访客以浏览器语言为准）；localePreference=system 留空同回退
  I18N_LANG = (function () {
    // 判定链：本 origin 显式选择(localStorage) > 跨面板权威文件(userLang，随 DATA 注入)
    // > ZCode 界面语言(localePreference，serve 浏览器模式跳过) > 浏览器/WebView 语言
    var pref = '';
    try { pref = String(localStorage.getItem('ud-lang') || ''); } catch (e) {}
    if (pref === 'zh' || pref === 'en') return pref;
    var ul = '';
    // __USAGE_LANG__：serve 初始页服务端同步注入（判定时 /api/data 尚未返回）；其余模式读 DATA.userLang
    try { ul = String(window.__USAGE_LANG__ || (typeof DATA === 'object' && DATA && DATA.userLang) || ''); } catch (e) {}
    if (ul === 'zh' || ul === 'en') return ul;
    var zl = '';
    try { zl = String((typeof DATA === 'object' && DATA && DATA.zcodeLocale) || ''); } catch (e) {}
    var zc = zl ? (zl.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en') : '';
    if (!window.__USAGE_SERVE__ && zc) return zc;
    return ((navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
  })();
} catch (e) { I18N_LANG = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'; }
function tr(s) { return I18N_LANG === 'en' && I18N_EN[s] ? I18N_EN[s] : s; }
// 静态 HTML 区的 DOM 文本翻译：boot 前对精确匹配的文本节点与 placeholder/title 属性做一次替换
(function () {
  if (I18N_LANG !== 'en') return;
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var nodes = [], n;
  while ((n = walker.nextNode())) {
    var v = n.nodeValue.trim();
    if (v && I18N_EN[v]) nodes.push([n, n.nodeValue.replace(v, I18N_EN[v])]);
  }
  nodes.forEach(function (x) { x[0].nodeValue = x[1]; });
  Array.prototype.forEach.call(document.querySelectorAll('[placeholder],[title],[aria-label]'), function (el) {
    ['placeholder', 'title', 'aria-label'].forEach(function (a) {
      var v = el.getAttribute(a);
      if (v && I18N_EN[v.trim()]) el.setAttribute(a, I18N_EN[v.trim()]);
    });
  });
})();

function __usageBoot(D) {
  // 模型名归一（boot 与局部刷新共用）：同一模型可能以多种大小写形态入库
  // （GLM-5.3-Flash / glm-5.3-flash），不合并会把同模型拆成多行、模型筛选也分裂。
  // 建索引前就地合并：lower 相同的形态并为一个模型索引，显示名取 token 量最大的原形态；
  // 价格匹配本身已有小写兜底不受影响。
  function normalizeModels(D) {
    var MD0 = D.models || [];
    if (MD0.length < 2) return;
    var tokOf = {};
    (D.rows || []).forEach(function (r) { tokOf[r[2]] = (tokOf[r[2]] || 0) + (r[4] || 0) + (r[5] || 0); });
    var keyIdx = {}, remap = [], disp = [], bestTok = {};
    for (var i = 0; i < MD0.length; i++) {
      var k = String(MD0[i] || '').toLowerCase();
      if (k in keyIdx) { remap[i] = keyIdx[k]; continue; }
      keyIdx[k] = disp.length; remap[i] = disp.length; disp.push(MD0[i]);
    }
    if (disp.length === MD0.length) return; // 本就无重名形态
    for (var j = 0; j < MD0.length; j++) {
      var gi = keyIdx[String(MD0[j] || '').toLowerCase()], t = tokOf[j] || 0;
      if (!(gi in bestTok) || t > bestTok[gi]) { bestTok[gi] = t; disp[gi] = MD0[j]; }
    }
    D.models = disp;
    (D.rows || []).forEach(function (r) { r[2] = remap[r[2]] != null ? remap[r[2]] : r[2]; });
  }
  normalizeModels(D);
  var PV = D.providers || [], MD = D.models || [], TL = D.sessions || [], R = D.rows || [];
  var PVNAME = D.providerNames || {}; // BYOK 真名映射（id → 显示名），pvLabel 与文本筛选共用
  var PVNAME_PV = PV.map(function (id) { return PVNAME[id] || id; });
  var TOOLS = D.tools || [], SD = D.sessionDirs || [];
  var CTXMIX = D.ctxMix || [];   // 上下文构成（按 part 存储字节近似）：[session索引, part类型, 字节]
  var SAGENTS = D.sessionAgents || []; // 子代理具名分布：[session索引, agent, 请求数, token]
  var PRICE = (D.prices && typeof D.prices === 'object') ? D.prices : null;
  var PMODELS = PRICE && PRICE.models && typeof PRICE.models === 'object' ? PRICE.models : PRICE;
  var CURSYM = (function () {
    var c = PRICE && PRICE.currency;
    return { USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' }[c] || (c ? c + ' ' : '$');
  })();
  try { document.documentElement.lang = I18N_LANG === 'en' ? 'en' : 'zh-CN'; } catch (e) {} // <html lang> 与界面语言同步（无障碍/拼写检查）
  var $ = function (id) { return document.getElementById(id); };
  var N = function (v) { var x = Number(v); return v == null || !Number.isFinite(x) ? 0 : x; }; // 真·转数字：弹窗输入框的字符串值也要安全进入算术
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function fmt(n) {
    n = N(n);
    if (I18N_LANG === 'en') { // 英文数字单位：K/M/B（万/亿 仅中文语境）
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(Math.round(n));
    }
    if (n >= 1e8) return (n / 1e8).toFixed(2) + tr('亿');
    if (n >= 1e4) return (n / 1e4).toFixed(1) + tr('万');
    return String(Math.round(n));
  }
  function fmtI(n) { return N(n).toLocaleString('zh-CN'); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fullTs(ts) { var d = new Date(ts); return dayKey(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  if (D.session) {
    $('ud-session-title').textContent = tr('会话用量 · ') + D.session.title;
    $('ud-session-last').textContent = tr('最近请求：') + (D.session.latest == null ? tr('暂无请求') : fullTs(D.session.latest)) + tr(' · 会话信息');
    $('ud-session-selection').textContent = tr('定位：') + D.session.selection;
    $('ud-session-info').textContent = tr('会话 ID：') + D.session.id + '\n项目目录：' + (D.session.directory || '–')
      + '\n创建：' + (D.session.created == null ? '–' : fullTs(D.session.created))
      + '\n仅统计该 session_id 的记录。';
  }

  var STAT = [tr('完成'), tr('失败'), tr('已取消'), tr('进行中')];
  var SCOLOR = ['var(--green)', 'var(--red)', 'var(--yellow)', 'var(--blue)'];
  var QT = [tr('主会话'), tr('子代理'), tr('系统')];
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
      var tipTxt = it.tip || (it.name + ' · ' + fmtI(it.value) + ' (' + Math.round(frac * 100) + '%)');
      if (frac >= 0.999) {
        paths += '<circle cx="' + CX + '" cy="' + CY + '" r="' + ((R1 + R0) / 2) + '" fill="none" stroke="' + color + '" stroke-width="' + (R1 - R0) + '"><title>' + esc(tipTxt) + '</title></circle>';
      } else {
        paths += '<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + R1 + ' ' + R1 + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + xi.toFixed(1) + ' ' + yi.toFixed(1) + ' A' + R0 + ' ' + R0 + ' 0 ' + large + ' 0 ' + xj.toFixed(1) + ' ' + yj.toFixed(1) + ' Z" fill="' + color + '" fill-opacity="0.88"><title>' + esc(tipTxt) + '</title></path>';
      }
      legend += '<div class="ud-leg-row"><span class="nm" title="' + esc(it.name) + '"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color + ';margin-right:5px"></i>' + esc(it.name) + '</span><span class="bar"><i style="width:' + Math.round(frac * 100) + '%;background:' + color + '"></i></span>' +
        (it.absLabel ? '<span class="abs">' + esc(it.absLabel) + '</span>' : '') +
        '<span class="n">' + Math.round(frac * 100) + '%</span></div>';
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
    'bigmodel-individual-coding-plan': tr('GLM Coding Plan 个人版'),
    'bigmodel-coding-plan': 'GLM Coding Plan',
    'bigmodel-lite-coding-plan': 'GLM Coding Plan Lite',
    'bigmodel-pro-coding-plan': 'GLM Coding Plan Pro',
    'bigmodel-max-coding-plan': 'GLM Coding Plan Max',
    'bigmodel-start-plan': tr('GLM Coding Plan 入门版'),
    'zai-start-plan': tr('GLM Coding Plan 入门版')
  };
  function pvLabel(p) {
    var raw = String(PV[p] || '?');
    if (/^account:/.test(raw)) {
      var id = raw.replace(/^account:/, '');
      return esc(PV_CN[id] || id);
    }
    // BYOK 自定义接入（如 new-provider）：用 provider_config.json 里的 providerName 显示
    return esc(PVNAME[raw] || raw);
  }
  function pvTag(p) { return /^account:/.test(String(PV[p] || '')) ? tr('官方账号') : tr('自定义接入'); }

  function priceOf(mi) {
    if (!PMODELS) return null;
    var name = String(MD[mi] || '');
    var p = PMODELS[name] || PMODELS[name.toLowerCase()];
    if (!p) { for (var k in PMODELS) { if (k.toLowerCase() === name.toLowerCase()) { p = PMODELS[k]; break; } } }
    return p || null;
  }
  // tz 口径的本地日期串（YYYY-MM-DD）：节假日/调休集合按此匹配
  function tariffDayStr(loc, useUTC) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return (useUTC ? loc.getUTCFullYear() : loc.getFullYear()) + '-' + p2((useUTC ? loc.getUTCMonth() : loc.getMonth()) + 1) + '-' + p2(useUTC ? loc.getUTCDate() : loc.getDate());
  }
  // 中国官方节假日判定：holidays 全天低谷价；workdays（调休上班的周末）按正常分时档
  // 返回 'holiday' | 'workday' | null
  function tariffSpecial(t, loc, useUTC) {
    if (!t.holidays && !t.workdays) return null;
    var ds = tariffDayStr(loc, useUTC);
    if (t.workdays && t.workdays.indexOf(ds) >= 0) return 'workday';
    if (t.holidays && t.holidays.indexOf(ds) >= 0) return 'holiday';
    return null;
  }
  function tierMult(ts, t) {
    if (!t || !t.tiers) return 1;
    var d = new Date(ts);
    var off = typeof t.tz === 'number' ? t.tz * 3600e3 : 0;
    var loc = off ? new Date(ts + off) : d; // 时区平移后按目标时区取小时/星期/日期
    var useUTC = !!off;
    var h = useUTC ? loc.getUTCHours() : d.getHours();
    var sp = tariffSpecial(t, loc, useUTC);
    if (sp === 'holiday') return t.weekend != null ? t.weekend : 1; // 法定节假日全天按空闲价
    if (t.weekend != null && sp !== 'workday') { // 周末统一倍率（调休上班的周末除外）
      var dow = useUTC ? loc.getUTCDay() : d.getDay();
      if (dow === 0 || dow === 6) return t.weekend;
    }
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
  // 系统当前时间落在哪个档位（"现在进行时"指示用）：返回 {name, mult, until} 或 null
  function curTier(t, now) {
    if (!t || !t.tiers) return null;
    var d = new Date(now);
    var off = typeof t.tz === 'number' ? t.tz * 3600e3 : 0;
    var loc = off ? new Date(now + off) : d;
    var useUTC = !!off;
    var h = useUTC ? loc.getUTCHours() : d.getHours();
    var sp = tariffSpecial(t, loc, useUTC);
    if (sp === 'holiday') return { name: tr('节假日价'), mult: t.weekend != null ? t.weekend : 1, until: null };
    if (t.weekend != null && sp !== 'workday') {
      var dow = useUTC ? loc.getUTCDay() : d.getDay();
      if (dow === 0 || dow === 6) return { name: tr('周末价'), mult: t.weekend, until: null };
    }
    var best = null;
    for (var i = 0; i < t.tiers.length; i++) {
      var tier = t.tiers[i] || {};
      var ws = tier.hours || [];
      for (var j = 0; j < ws.length; j++) {
        var b = ws[j][0], e = ws[j][1];
        if (b <= e ? (h >= b && h < e) : (h >= b || h < e)) {
          best = { name: tier.name || (tier.mult > 1 ? tr('高峰') : tr('空闲')), mult: tier.mult == null ? 1 : tier.mult, until: e < b || e > 24 ? null : e };
          break;
        }
      }
      if (best) break;
    }
    return best || { name: tr('标准'), mult: 1, until: null };
  }
  function rowCost(r) {
    var p = priceOf(r[2]);
    if (!p) return null;
    // input_tokens 已包含缓存命中（computed_total = input+output+reasoning 可证）：
    // 未命中部分按牌价 in、命中部分按 cache，缓存段不能重复计费
    var miss = Math.max(0, N(r[4]) - N(r[6]));
    var base = miss / 1e6 * N(p.in) + N(r[5]) / 1e6 * N(p.out) + N(r[6]) / 1e6 * N(p.cache);
    return base * tierMult(r[1], p.tariff);
  }
  function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : N(mb) + ' MB'; }
  function fmtBytes(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b >= 1024 ? (b / 1024).toFixed(1) + ' KB' : N(b) + ' B'; } // 构成环口径（存储字节）
  // 项目名：取最后一段目录名，兼容 Windows 反斜杠与 POSIX 斜杠（尾分隔符、盘符根都安全）
  function baseName(dir) {
    var parts = String(dir || '').split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(dir || '');
  }
  // 项目归并：数据层已把每个会话目录解析到 git 仓库根（projectMap）——
  // 子/孙目录的会话因此并入真实项目，不再出现 src/utils 这类叶子目录冒充项目名
  var PMAP = D.projectMap || {};
  function projKey(dir) { return PMAP[dir] || dir; }
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
  (D.compactions || []).forEach(function (c) { cmpMap[c[0]] = { cnt: c[1], pre: c[2], ts: c[3] || [], trg: c[4] || [] }; });
  (D.sessionTools || []).forEach(function (t) { (toolsMap[t[0]] || (toolsMap[t[0]] = [])).push([t[1], t[2], t[3]]); });

  var st = { p: -1, m: -1, s: -1, rng: 'today', day: null, proj: null, q: '', hidePv: {} };
  var sortS = { k: 4, d: -1 }, sortD = { k: 0, d: -1 };
  var page = 1, pageSize = 50, sessShown = 50, detailStat = -1, curMetric = 'req', costOn = false;
  var heatMode = 'hour', heatLastW = -1, sessExp = -1, detExp = -1;
  var insightsOpen = false; // 洞察区折叠状态：默认只露 6 项，重渲染（筛选/保存后）保持

  function cutOf() {
    if (st.rng === 'all') return 0;
    if (st.rng === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
    if (st.rng === 'yday') { var d2 = new Date(); d2.setHours(0, 0, 0, 0); return d2.getTime() - 864e5; }
    return maxTs - (st.rng === '7' ? 7 : 30) * 864e5;
  }
  // 「昨天」是有上界的区间：[昨天 0 点, 今天 0 点)；其余档位只有下界
  function cutTo() {
    if (st.rng !== 'yday') return 0;
    var d = new Date(); d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function frows(ignorePv) {
    var cut = cutOf(), cutUp = cutTo();
    var q = (st.q || '').toLowerCase();
    return R.filter(function (r) {
      if (!ignorePv && st.p >= 0 && r[3] !== st.p) return false;
      if (st.m >= 0 && r[2] !== st.m) return false;
      if (st.s >= 0 && r[0] !== st.s) return false;
      if (st.day && dayKey(r[1]) !== st.day) return false;
      if (cut && r[1] < cut) return false;
      if (cutUp && r[1] >= cutUp) return false;
      if (q) {
        // 文本筛选：会话标题 / 模型名 / 来源显示名（含 BYOK 真名）大小写不敏感包含
        var hay = (TL[r[0]] || '') + '\n' + (MD[r[2]] || '') + '\n' + (PVNAME_PV[r[3]] || PV[r[3]] || '');
        if (hay.toLowerCase().indexOf(q) < 0) return false;
      }
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
    $('ud-k1c').textContent = tr('完成 ') + fmtI(states[0]) + (states[3] ? tr(' · 进行中 ') + fmtI(states[3]) : '');
    $('ud-k2').textContent = fmt(a.inn);
    $('ud-k3').textContent = fmt(a.out);
    $('ud-k4').textContent = fmt(a.ca);
    $('ud-k4c').textContent = tr('缓存命中率 ') + (a.inn ? Math.round(a.ca / a.inn * 100) + '%' : '–');
    $('ud-meta').textContent = tr('本地快照 ') + (D.gen || '') + tr(' · 已加载 ') + fmtI(D.covered) + ' / ' + fmtI(D.total) + tr(' 条')
      + (D.covered < D.total ? tr('，统计仅含已加载记录') : '');
    var failures = states[1] + states[2];
    $('ud-failures').hidden = failures === 0;
    $('ud-failures').textContent = tr('查看失败 / 取消（') + fmtI(failures) + '）';
    $('ud-request-count').textContent = fmtI(rows.length) + tr(' 条');

    var groups = {}, models = {};
    rows.forEach(function (r) {
      var key = r[2] + ':' + r[3];
      var g = groups[key] || (groups[key] = { m: r[2], p: r[3], req: 0, inn: 0, out: 0, ca: 0 });
      g.req++; g.inn += N(r[4]); g.out += N(r[5]); g.ca += N(r[6]);
      models[r[2]] = true;
    });
    $('ud-model-count').textContent = Object.keys(models).length + tr(' 个模型');
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
    // 数字滚动动画（ease-out，值未变则跳过）：加载/切换筛选时更有生命感
    function anim(id, target, f) {
      var el = $(id);
      var from = N(el.__val);
      if (from === target) { el.textContent = f(target); return; }
      el.__val = target;
      var t0 = performance.now(), DUR = 420;
      (function tick(t) {
        var k = Math.min(1, (t - t0) / DUR);
        k = 1 - Math.pow(1 - k, 3);
        el.textContent = f(Math.round(from + (target - from) * k));
        if (k < 1) requestAnimationFrame(tick);
      })(t0);
    }
    anim('ud-k1', a.req, fmtI);
    anim('ud-k2', a.inn, fmt);
    anim('ud-k3', a.out, fmt);
    anim('ud-k4', a.sess, fmtI);
    $('ud-k1c').textContent = tr('日均 ') + fmt(a.req / dcount) + tr(' · 覆盖 ') + dcount + tr(' 天');
    $('ud-k2c').textContent = tr('缓存读 ') + fmt(a.ca) + tr(' · 缓存写 ') + fmt(a.ccw);
    $('ud-k3c').textContent = tr('输出 + 思考 token');
    $('ud-k4c').textContent = a.sub ? tr('含子代理请求 ') + fmtI(a.sub) + tr(' 次') : tr('合计 ') + fmt(a.tok) + ' token';
    $('ud-meta').textContent = tr('数据截至 ') + (D.gen || '') + tr(' · 已加载最近 ') + fmtI(D.covered) + ' / ' + fmtI(D.total) + tr(' 条 · 仅统计本机');
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
    // 用量首项（quota-peek 式环比徽章：上涨红 / 下降绿 / ±10% 平稳灰）。
    // 用全量 R 而非筛选后的 rows：默认筛选是「今天」，昨天的行会被滤掉，环比就没了基准。
    // 档位语义：today=今日 vs 昨日；yday=昨日 vs 前日；其余档位显示筛选期总量（无环比）
    (function () {
      var t0 = new Date(new Date().toDateString()).getTime();
      if (st.rng === 'yday') t0 -= 864e5; // 「昨天」档：对比窗口整体平移一天
      var y0 = t0 - 864e5;
      var today = 0, yest = 0, todayC = 0, yestC = 0;
      R.forEach(function (r) {
        var t = N(r[4]) + N(r[5]);
        if (r[1] >= t0) { today += t; var c1 = rowCost(r); if (c1 != null) todayC += c1; }
        else if (r[1] >= y0) { yest += t; var c2 = rowCost(r); if (c2 != null) yestC += c2; }
      });
      if (today > 0 || yest > 0) {
        var badge = '';
        if (yest > 0 && (st.rng === 'today' || st.rng === 'yday')) {
          var pct = Math.round((today - yest) / yest * 100);
          if (pct >= 10) badge = '<span class="ud-badge up">↑ ' + pct + '%</span>';
          else if (pct <= -10) badge = '<span class="ud-badge down">↓ ' + Math.abs(pct) + '%</span>';
          else badge = '<span class="ud-badge flat">→ 平稳</span>';
        }
        var rngLabel = { today: tr('今日用量'), yday: tr('昨日用量'), '7': tr('近 7 天用量'), '30': tr('近 30 天用量'), all: tr('累计用量') }[st.rng] || tr('今日用量');
        var prevLabel = st.rng === 'yday' ? tr('前日 ') : tr('昨日 ');
        items.push(row(rngLabel, fmt(today) + ' tok ' + badge, 'gold',
          (yestC > 0 && (st.rng === 'today' || st.rng === 'yday') ? prevLabel + fmtCost(yestC) : '')));
      }
    })();
    // 今日预算进度（设了日预算才显示）：恒按「今天」全量口径（不随筛选变化），阈值色呼应告警 80%/100%
    (function () {
      var bd = N(D.budgetDaily);
      if (!(bd > 0)) return;
      var t0 = new Date(new Date().toDateString()).getTime();
      var c = 0, hasCost = false;
      R.forEach(function (r) {
        if (r[1] >= t0) { var x = rowCost(r); if (x != null) { c += x; hasCost = true; } }
      });
      if (!hasCost || c <= 0) return;
      var pct = Math.min(999, Math.round(c / bd * 100));
      var color = pct >= 100 ? 'red' : pct >= 80 ? 'gold' : 'green';
      var sub = N(D.budgetMonthly) > 0 ? tr('月预算 ') + CURSYM + N(D.budgetMonthly).toFixed(0) : tr('达 80% / 100% 时系统提醒');
      items.push(row(tr('今日预算'), CURSYM + (c >= 100 ? Math.round(c) : c.toFixed(2)) + ' / ' + CURSYM + bd.toFixed(0) + ' · ' + pct + '%', color, sub));
      // 预算 hero 卡（对标 Current Context 层级）：今日成本大数字 / 日预算 + 进度条 + 月/燃烧率 pill
      var heroEl = $('ud-budget-hero');
      if (heroEl) {
        var bm = N(D.budgetMonthly);
        var monthCost = 0, m0 = new Date(); m0.setDate(1); m0 = new Date(m0.toDateString()).getTime();
        R.forEach(function (r) { if (r[1] >= m0) { var x = rowCost(r); if (x != null) monthCost += x; } });
        var r1h = 0, nowMs = Date.now();
        R.forEach(function (r) { if (r[1] >= nowMs - 3600e3 && r[1] <= nowMs + 60e3) r1h += N(r[4]) + N(r[5]); });
        var barColor = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--yellow)' : 'var(--green)';
        heroEl.innerHTML =
          '<div class="ud-kv-l">' + tr('今日预算') + '</div>' +
          '<div style="display:flex;align-items:baseline;gap:8px;margin:2px 0 6px;flex-wrap:wrap">' +
          '<span class="ud-hero-num">' + CURSYM + (c >= 100 ? Math.round(c) : c.toFixed(2)) + '</span>' +
          '<span class="text-muted text-small">/ ' + CURSYM + bd.toFixed(0) + '</span>' +
          '<span class="ud-hero-pct" style="margin-left:auto;color:' + barColor + '">' + pct + '%</span></div>' +
          '<div style="height:10px;border-radius:5px;background:var(--muted);overflow:hidden;margin:0 0 8px"><div style="width:' + Math.min(100, pct) + '%;height:100%;background:' + barColor + '"></div></div>' +
          '<div>' +
          (bm > 0 ? '<span class="ud-pill">' + tr('本月 ') + CURSYM + monthCost.toFixed(2) + ' / ' + CURSYM + bm.toFixed(0) + '</span>' : '') +
          (r1h > 0 ? '<span class="ud-pill" data-tip="' + fmtI(Math.round(r1h / 60)) + ' tok/min · ' + tr('近 1h 合计 ') + fmtI(r1h) + ' tok">' + tr('燃烧率 ') + fmt(Math.round(r1h / 60)) + ' tok/min</span>' : '') +
          '<span class="ud-pill">' + tr('达 80% / 100% 时系统提醒') + '</span>' +
          '</div>';
        heroEl.hidden = false;
      }
    })();
    items.push(row(tr('活跃天数'), days.length + tr(' 天'), 'blue'));
    items.push(row(tr('连续活跃'), cur + tr(' 天'), 'blue', tr('最长 ') + longest));
    // 燃烧率常驻前排（现在进行时的指标，ccusage burn rate / claude-monitor 标配）；
    // 节奏标记借鉴 coding-usage-bar：当前速率折算日耗 vs 近 7 天日均 → 放缓/平稳/加速。
    // 同样用全量 R：时间筛选成「今天」时近 7 天基准会失真
    (function () {
      var nowMs = Date.now(), r1h = 0;
      R.forEach(function (r) { if (r[1] >= nowMs - 3600e3 && r[1] <= nowMs + 60e3) { r1h += N(r[4]) + N(r[5]); } });
        if (r1h > 0) {
          var perMin = Math.round(r1h / 60);
          var pace = '';
          var perDay7 = {}, earliest = nowMs - 7 * 864e5;
          R.forEach(function (r) { if (r[1] >= earliest && r[1] < new Date(new Date().toDateString()).getTime()) { var k = dayKey(r[1]); perDay7[k] = (perDay7[k] || 0) + N(r[4]) + N(r[5]); } });
          var d7 = Object.keys(perDay7);
          if (d7.length >= 2) {
            var avg7 = d7.reduce(function (a, k) { return a + perDay7[k]; }, 0) / d7.length;
            var ratio = avg7 > 0 ? (r1h * 24) / avg7 : 0;
            pace = ratio < 0.5 ? tr('节奏：放缓') : ratio <= 1.5 ? tr('节奏：平稳') : tr('节奏：加速');
          }
          // 紧凑单位（36.5 万 tok/min）：原始六位数字不可读；悬停给精确值与近 1h 合计（含缓存读）
          items.push(row(tr('近 1h 燃烧率'), '<span data-tip="' + fmtI(perMin) + ' tok/min · ' + tr('近 1h 合计 ') + fmtI(r1h) + ' tok">' + fmt(perMin) + ' tok/min</span>', 'red', pace));
        }
    })();
    // 分时计价当前档：按系统当前时间判定（有 tariff 配置的模型才显示，取筛选内用量最大的一个为代表）
    (function () {
      var tok = {};
      rows.forEach(function (r) { tok[r[2]] = (tok[r[2]] || 0) + N(r[4]) + N(r[5]); });
      var pick = null, pickTok = 0;
      Object.keys(tok).forEach(function (mi) {
        var p = priceOf(mi); // priceOf 接收模型索引（内部转名字查价）
        if (p && p.tariff && p.tariff.tiers && tok[mi] > pickTok) { pick = { name: String(MD[mi] || ''), p: p }; pickTok = tok[mi]; }
      });
      if (!pick) return;
      var ct = curTier(pick.p.tariff, Date.now());
      if (!ct) return;
      var val = ct.name + (ct.mult === 1 ? '' : ' ' + ct.mult + '×');
      if (ct.until != null) val += tr(' · 至 ') + ct.until + ':00';
      var sub = esc(pick.name);
      if (ct.name === tr('周末价')) sub += tr(' · 周末全天空闲价');
      if (ct.name === tr('节假日价')) sub += tr(' · 法定节假日全天空闲价');
      items.push(row(tr('当前时段'), val, 'gold', sub));
    })();
    if (peak) items.push(row(tr('峰值日'), peak.slice(5), 'purple', fmt(peakV) + ' tok'));
    items.push(row(tr('缓存命中率'), hit + '%', 'green', tr('读 ') + fmt(a.ca)));
    if (a.ca + a.ccw > 0) items.push(row(tr('缓存量（读+写）'), fmt(a.ca + a.ccw), 'green'));
    if (D.todos && D.todos[1] > 0) items.push(row(tr('任务完成'), N(D.todos[0]) + '/' + D.todos[1], 'green', Math.round(N(D.todos[0]) / D.todos[1] * 100) + '%'));
    if (D.stability) items.push(row(tr('重试 / 取消'), fmtI(D.stability[0]) + ' / ' + fmtI(D.stability[1]), 'yellow'));
    if (a.req) items.push(row(tr('平均耗时'), (a.dur / a.req / 1000).toFixed(1) + ' s', 'blue'));
    if (a.sub) items.push(row(tr('主会话 / 子代理'), fmtI(a.req - a.sub) + ' / ' + fmtI(a.sub), 'purple'));
    if (D.hours) {
      var pk = -1, pv2 = -1;
      for (var hh = 0; hh < 24; hh++) { var kk2 = (hh < 10 ? '0' : '') + hh; var c2 = N(D.hours[kk2]); if (c2 > pv2) { pv2 = c2; pk = hh; } }
      if (pk >= 0) items.push(row(tr('峰值时段'), pk + tr(' 点'), 'blue', fmtI(pv2) + tr(' 次')));
    }
    if (D.disk && D.disk.logs) items.push(row(tr('数据体量'), fmtMB(D.disk.logs), 'gray', tr('导出 ') + fmtMB(D.disk.rollout) + tr(' · 库 ') + fmtMB(D.disk.db)));
    var totalCost = 0, anyCost = false, unpricedTok = 0;
    rows.forEach(function (r) { var c = rowCost(r); if (c != null) { totalCost += c; anyCost = true; } else unpricedTok += N(r[4]) + N(r[5]); });
    if (anyCost || unpricedTok > 0) { // 全部未定价也要给提示，不能整行消失
      var aTok = a.inn + a.out;
      items.push(row(tr('折算成本（API 牌价）'), anyCost ? fmtCost(totalCost) : '–', 'gold', unpricedTok > 0 && aTok ? tr('未定价 ') + Math.round(unpricedTok / aTok * 100) + '%' : ''));
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
      if (bd > 0) items.push(budgetRow(tr('今日折算 / 日预算'), fmtCost(dayCost), bd, Math.min(100, Math.round(dayCost / bd * 100))));
      if (bm > 0) items.push(budgetRow(tr('本月折算 / 月预算'), fmtCost(mCost), bm, Math.min(100, Math.round(mCost / bm * 100))));
    }
    // 浪费取证：失败/取消请求白耗的 token
    (function () {
      var wReq = 0, wTok = 0;
      rows.forEach(function (r) { if (r[8] === 1 || r[8] === 2) { wReq++; wTok += N(r[4]) + N(r[5]); } });
      if (wReq > 0) items.push(row(tr('浪费取证'), fmt(wTok) + ' tok', 'red', fmtI(wReq) + tr(' 次失败/取消')));
    })();
    var host = $('ud-insights');
    host.innerHTML = items.join('');
    // 降噪：默认只展示前 6 项，其余折叠进「展开全部」
    host.classList.toggle('ud-collapsed', !insightsOpen && items.length > 6);
    var more = $('ud-insights-more');
    more.hidden = items.length <= 6;
    if (items.length > 6) {
      more.innerHTML = '<button type="button" class="btn">' + (insightsOpen ? tr('收起洞察') : tr('展开全部 ') + items.length + tr(' 项')) + '</button>';
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
    if (tn) out += hrow(tr('平均首字'), (ttft / tn / 1000).toFixed(2) + ' s', 'yellow', tr('首个 token 延迟'));
    if (genMs > 0) out += hrow(tr('生成速率'), fmtI(Math.round(genTok / (genMs / 1000))) + ' tok/s', 'blue');
    if (D.stability && a) {
      var errPct = a.req ? Math.round(D.stability[2] / a.req * 1000) / 10 : 0;
      out += hrow(tr('错误率'), errPct + '%', 'red', tr('失败 / 全部'));
    }
    var peakCtx = 0;
    (D.compactions || []).forEach(function (c) { if (N(c[2]) > peakCtx) peakCtx = N(c[2]); });
    if (peakCtx > 0) out += hrow(tr('峰值上下文'), fmt(peakCtx), 'purple', tr('压缩前最高'));
    var toolMs = 0, toolC = 0;
    (D.sessionTools || []).forEach(function (t) { toolC += N(t[2]); toolMs += N(t[3]); });
    if (toolC) out += hrow(tr('工具调用'), fmtI(toolC) + tr(' 次'), 'gray', tr('累计 ') + fmtDur(toolMs));
    host.innerHTML = out;
  }

  function renderProviders(rows) {
    var per = PV.map(function (p, i) { return { i: i, req: 0, tok: 0, inn: 0, ca: 0, cost: 0, hasCost: false }; });
    rows.forEach(function (r) { var o = per[r[3]]; o.req++; o.tok += N(r[4]) + N(r[5]); o.inn += N(r[4]); o.ca += N(r[6]); var c = rowCost(r); if (c != null) { o.cost += c; o.hasCost = true; } });
    var tot = per.reduce(function (a, x) { return a + x.tok; }, 0);
    var act = per.filter(function (x) { return x.req > 0; }).sort(function (a, b) { return b.tok - a.tok; });
    if (!act.length) { $('ud-pv-stack').innerHTML = '<p class="text-muted">' + tr('当前筛选下暂无数据') + '</p>'; $('ud-pv-rows').innerHTML = ''; return; }
    $('ud-pv-stack').innerHTML = donut(act.slice(0, 6).map(function (x) {
      return { name: pvLabel(x.i), value: x.tok, color: pvColor(x.i), tip: pvLabel(x.i) + ' · ' + fmtI(x.req) + tr(' 次请求 · ') + fmt(x.tok) + tr(' tok · 缓存 ') + (x.inn ? Math.round(x.ca / x.inn * 100) : 0) + '%' + (costOn && x.hasCost ? ' · ' + fmtCost(x.cost) : '') };
    }), 'token');
    $('ud-pv-rows').innerHTML = act.map(function (x) {
      return '<div class="text-small" style="display:flex;justify-content:space-between;gap:8px;padding:3px 0">' +
        '<span><span class="ud-dot" style="background:' + pvColor(x.i) + '"></span>' + pvLabel(x.i) + '<span class="ud-tag">' + pvTag(x.i) + '</span></span>' +
        '<span class="tabular-nums text-muted">' + fmtI(x.req) + tr(' 次 · ') + fmt(x.tok) + ' token · ' + (tot ? (x.tok / tot * 100).toFixed(1) : 0) + tr('% · 缓存 ') + (x.inn ? Math.round(x.ca / x.inn * 100) : 0) + '%' + (costOn && x.hasCost ? ' · ' + fmtCost(x.cost) : '') + '</span></div>';
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
      return { name: String(MD[x.m]), value: x.tok, tip: MD[x.m] + ' · ' + fmtI(x.req) + tr(' 次请求 · ') + fmt(x.tok) + tr(' tok · 缓存 ') + x.hit + '%' };
    }), 'token') + list.map(function (x) {
      var p = tot ? Math.round(x.tok / tot * 100) : 0;
      return '<div class="text-small" style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>' + esc(MD[x.m]) + '</span><span class="tabular-nums text-muted">' + fmtI(x.req) + tr(' 次 · ') + fmt(x.tok) + ' token · ' + p + tr('% · 缓存 ') + x.hit + '%</span></div>';
    }).join('') : '<p class="text-muted">' + tr('当前筛选下暂无数据') + '</p>';
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
    // 行内 7 日 sparkline（claude-monitor / CCMeter 风格）：每会话近 7 天 token 序列
    var days7 = [];
    for (var i7 = 6; i7 >= 0; i7--) days7.push(dayKey(Date.now() - i7 * 864e5));
    var sp = {};
    rows.forEach(function (r) {
      var k = dayKey(r[1]);
      if (days7.indexOf(k) < 0) return;
      var o = sp[r[0]] || (sp[r[0]] = {});
      o[k] = (o[k] || 0) + N(r[4]) + N(r[5]);
    });
    function spark(g) {
      var vals = days7.map(function (k) { return N((sp[g] || {})[k]); });
      var mx = Math.max.apply(null, vals);
      if (!mx) return '<span class="text-muted">–</span>';
      var W = 72, Hh = 18, step = W / 6;
      var pts = vals.map(function (v, i) { return (i * step).toFixed(1) + ',' + (Hh - 2 - (Hh - 5) * v / mx).toFixed(1); }).join(' ');
      var last = vals[6];
      return '<svg width="' + W + '" height="' + Hh + '" style="display:block" role="img" aria-label="近 7 天趋势"><polyline points="' + pts + '" fill="none" stroke="var(--ud-accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/><circle cx="' + W + '" cy="' + (Hh - 2 - (Hh - 5) * last / mx).toFixed(1) + '" r="2.2" fill="var(--ud-accent)"/></svg>';
    }
    $('ud-top-sessions').innerHTML = list.length ? '<div class="table-responsive"><table class="table table-sm" style="min-width:520px;margin:0"><thead><tr><th>' + tr('会话') + '</th><th class="text-end">' + tr('请求数') + '</th><th class="text-end">' + tr('token 合计') + '</th><th>' + tr('近 7 天') + '</th><th class="text-end">' + tr('最后活动') + '</th></tr></thead><tbody>' +
      list.map(function (o) {
        return '<tr class="ud-click" data-sg="' + o.g + '" title="点击查看会话详情"><td>' + sessTitle(o) + '</td><td class="text-end tabular-nums">' + fmtI(o.req) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td><td>' + spark(o.g) + '</td><td class="text-end text-nowrap">' + fullTs(o.last) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="text-muted">' + tr('当前筛选下暂无数据') + '</p>';
    var donutEl = $('ud-tools-donut');
    if (donutEl) {
      donutEl.innerHTML = donut((D.tools || []).slice(0, 6).map(function (t) {
        return { name: String(t[0]).replace(/^mcp__/, ''), value: t[1], tip: String(t[0]).replace(/^mcp__/, '') + ' · ' + fmtI(t[1]) + tr(' 次调用') + (t[3] ? tr(' · 均 ') + fmtI(t[3]) + ' ms' : '') + (t[2] ? tr(' · 失败 ') + t[2] : '') };
      }), tr('调用'));
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
      out += '<rect x="' + x + '" y="' + (Hh - 18 - bh) + '" width="' + bw + '" height="' + bh + '" rx="2" fill="var(--viz-series-1)"' + (i3 === peak ? '' : ' fill-opacity="0.45"') + '><title>' + i3 + ':00–' + i3 + ':59 · ' + fmtI(reqArr[i3]) + tr(' 次请求 · ') + fmt(tokArr[i3]) + tr(' tok · 缓存 ') + cr + '</title></rect>';
      if (i3 % 3 === 0) out += '<text x="' + (x + bw / 2) + '" y="' + (Hh - 4) + '" text-anchor="middle" font-size="10" fill="var(--muted-foreground)">' + i3 + '</text>';
    }
    host.innerHTML = '<svg width="' + (cw * 24) + '" height="' + Hh + '" role="img" aria-label="24 小时用量分布"><desc>峰值 ' + peak + ' 点</desc>' + out + '</svg>';
    var note = $('ud-hours-note');
    if (note) note.textContent = hourMetric === 'tok' ? tr('峰值 ') + peak + tr(' 点 · ') + fmt(arr[peak]) + ' tok' : tr('峰值 ') + peak + tr(' 点 · ') + fmtI(arr[peak]) + tr(' 次请求');
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
    if (!days.length) { host.innerHTML = '<p class="text-muted">' + tr('当前筛选下暂无数据') + '</p>'; heatLastW = w; return; }
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
      var CG = 2, LX = 46, TY = 20;
      var CW = Math.max(4, Math.min(16, Math.floor((w - LX - 4 - 24 * CG) / 24))); // 格宽随容器自适应（380px 侧栏也能放下，宽屏封顶 16）
      var W4 = LX + 24 * (CW + CG) + 4, H4 = TY + 7 * (CW + CG) + 6;
      var out4 = '';
      [0, 6, 12, 18].forEach(function (hh) { out4 += '<text x="' + (LX + hh * (CW + CG)) + '" y="13" font-size="10" fill="var(--muted-foreground)">' + hh + tr('时') + '</text>'; });
      cells7.forEach(function (c, di) {
        var lbl = c.k.slice(5) + ' ' + tr('日一二三四五六')[new Date(c.k + 'T00:00:00').getDay()];
        out4 += '<text x="2" y="' + (TY + di * (CW + CG) + 12.5) + '" font-size="10" fill="var(--muted-foreground)">' + lbl + '</text>';
        for (var hh = 0; hh < 24; hh++) {
          var x = c.h[hh];
          out4 += rect(LX + hh * (CW + CG), TY + di * (CW + CG), CW, CW, shade(x.tok, hq),
            c.k + ' ' + (hh < 10 ? '0' : '') + hh + ':00 · ' + fmtI(x.req) + tr(' 次请求 · ') + fmt(x.tok) + ' token');
        }
      });
      host.innerHTML = '<svg width="' + W4 + '" height="' + H4 + '" role="img" aria-label="' + tr('近 7 天小时热力图') + '"><desc>' + tr('行=日期，列=0-23 时') + '</desc>' + out4 + '</svg>' +
        '<div class="text-muted text-small" style="margin-top:6px">' + tr('近 7 天，每天按 0–23 时切分；着色深浅按该小时 token 用量，悬停查看明细。') + '</div>';
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
        var g = '<div style="min-width:212px"><div class="text-small text-muted" style="margin:2px 0 4px">' + (m0.getFullYear() + tr(' 年 ') + (m0.getMonth() + 1) + tr(' 月')) + '</div><div style="display:grid;grid-template-columns:repeat(7,26px);gap:3px">';
        '一二三四五六'.split('').forEach(function (w) { g += '<div class="text-muted" style="font-size:10px;text-align:center">' + w + '</div>'; });
        for (var e = 0; e < lead; e++) g += '<div></div>';
        for (var dd = 1; dd <= dim; dd++) {
          var mk = m0.getFullYear() + '-' + pad(m0.getMonth() + 1) + '-' + pad(dd);
          var c = cells.find(function (x) { return x.k === mk; });
          var vv = c ? c.v : 0;
          var st2 = shade(vv, qs3);
          g += '<div class="ud-mcal-day" data-tip="' + mk + ' · ' + fmtI(c ? c.req : 0) + tr(' 次请求 · ') + fmt(vv) + ' token" style="width:26px;height:22px;border-radius:3px;background:' + st2.fill + ';opacity:' + (st2.op ? st2.op.replace(' fill-opacity="', '').replace('"', '') : (vv > 0 ? 1 : 0.35)) + ';font-size:9px;line-height:22px;text-align:center;color:var(--muted-foreground)">' + dd + '</div>';
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
        out += rect(x0, T, cw, ch, shade(x.v, wq), x.k + tr(' 当周 · ') + fmtI(x.req) + tr(' 次请求 · ') + fmt(x.v) + ' token');
      });
      host.innerHTML = '<svg width="' + W2 + '" height="' + H2 + '" role="img" aria-label="' + tr('活跃热力图（每周 token）') + '"><desc>' + tr('共 N 周').replace('N', weeks.length) + '</desc>' + out + '</svg>';
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
      out += rect(x, y, cw, ch, shade(c.v, dq), c.k + ' · ' + fmtI(c.req) + tr(' 次请求 · ') + fmt(c.v) + ' token');
    });
    host.innerHTML = '<svg width="' + W2 + '" height="' + H2 + '" role="img" aria-label="' + tr('活跃热力图（每日 token）') + '"><desc>' + tr('共 N 天，M 天有用量').replace('N', cells.length).replace('M', dv.length) + '</desc>' + out + '</svg>';
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
      return { name: k, value: mm[k], absLabel: '≈' + fmt(mm[k]), tip: k + ' · ' + fmt(mm[k]) + ' tok (' + Math.round(mm[k] / (mtot() || 1) * 100) + '%)' };
    }), 'token');
    function mtot() { var t = 0; for (var k2 in mm) t += mm[k2]; return t; }
    var pvm = Object.keys(pv2).map(function (k) { return '<span class="text-small text-muted">' + pvLabel(k) + ' ×' + pv2[k] + '</span>'; }).join(' · ');
    var tl = (toolsMap[o.g] || []).slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6)
      .map(function (t) { return '<span class="text-small text-muted">' + esc(String(t[0]).replace(/^mcp__/, '')) + ' ×' + fmtI(t[1]) + '</span>'; }).join(' · ');
    var cm = cmpMap[o.g];
    var cmpHtml = cm ? tr('压缩 ') + cm.cnt + tr(' 次 · 压缩前水位最高 ') + fmt(cm.pre) + ' token' : tr('无压缩记录');
    // 事件时间线：压缩事件（META 带时间）+ 模型切换（相邻请求模型变化推导），按时间归并
    var events = [];
    (cm ? cm.ts : []).forEach(function (t, i) {
      var trig = cm.trg && cm.trg[i] ? String(cm.trg[i]).replace(/^auto\//, tr('自动') + '/').replace(/^manual\//, tr('手动') + '/').replace(/\/$/, '') : '';
      events.push({ t: t, label: tr('上下文压缩') + (trig ? tr('（') + trig + tr('）') : ''), cls: 'ud-tl-c' });
    });
    var prevM = -1;
    rs.forEach(function (r) {
      if (prevM !== -1 && r[2] !== prevM) {
        var d = new Date(r[1]);
        events.push({ t: pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()), label: tr('切换模型 → ') + (MD[r[2]] || '?') });
      }
      prevM = r[2];
    });
    events.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var tl8 = events.length
      ? '<div class="ud-sec"><div class="ud-kv-l">' + tr('事件时间线') + '</div><div class="ud-timeline">' +
        events.slice(-12).map(function (e) {
          var cls = e.cls || (e.label.indexOf(tr('压缩')) >= 0 ? 'ud-tl-c' : 'ud-tl-m');
          return '<div class="ud-tl-item"><span class="ud-tl-dot ' + cls + '"></span><span class="ud-tl-t">' + esc(e.t) + '</span><span class="ud-tl-x">' + esc(e.label) + '</span></div>';
        }).join('') +
        (events.length > 12 ? '<div class="ud-tl-item"><span class="ud-tl-dot ud-tl-more"></span><span class="ud-tl-t">…</span><span class="ud-tl-x text-muted">' + tr('共 N 个事件').replace('N', events.length) + '</span></div>' : '') +
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
    // 上下文窗口上限（官方口径）：GLM-5.3 系 1M（docs.z.ai / docs.bigmodel.cn，2026-10 核实）。
    // 按会话内请求最多的模型取窗口；未知模型不画参考线，只显示峰值。
    // 窗口优先级：用户覆盖（设置里配置，全模型生效）> 该模型官方窗口（models.dev/内置表）> GLM-5.3 系内置 1M
    var modelCount = {};
    rs.forEach(function (r) { modelCount[r[2]] = (modelCount[r[2]] || 0) + 1; });
    var domModel = -1, domN = -1;
    for (var mk in modelCount) { if (modelCount[mk] > domN) { domN = modelCount[mk]; domModel = +mk; } }
    var domName = String(MD[domModel] || '');
    var ctxOverride = PRICE && Number(PRICE.ctxOverride) > 0 ? Number(PRICE.ctxOverride) : 0;
    var modelCtx = (PMODELS[domName] && Number(PMODELS[domName].ctx) > 0) ? Number(PMODELS[domName].ctx) : 0;
    var ctxLimit = ctxOverride || modelCtx || (/glm-5\.3/i.test(domName) ? 1048576 : 0);
    // 主会话点连线（子代理是独立上下文，只画散点，避免主线假性跳变）；压缩事件画竖线标记；
    // 轮次（turn_id）变化处画浅分隔：一个轮次 = 一次提问后的完整代理步骤（含其子代理尝试）
    var pts = [], dots = [], subDots = [], turnSeps = [];
    var turnIds = [], turnNo = {};
    rs.forEach(function (r) {
      var tid = r[14] == null ? '' : String(r[14]);
      if (tid && turnNo[tid] == null) { turnNo[tid] = turnIds.length + 1; turnIds.push(tid); }
    });
    var prevTurn = null;
    rs.forEach(function (r, i) {
      var x = rs.length > 1 ? i / (rs.length - 1) * (W - 8) + 4 : W / 2;
      var y = H - 8 - (H - 16) * N(r[4]) / maxIn;
      var tid = r[14] == null ? '' : String(r[14]);
      var turnLabel = tid && turnNo[tid] != null ? tr(' · 第 ') + turnNo[tid] + tr(' 轮') : '';
      if (prevTurn != null && tid && tid !== prevTurn) {
        turnSeps.push('<line x1="' + x.toFixed(1) + '" y1="4" x2="' + x.toFixed(1) + '" y2="' + (H - 4) + '" stroke="var(--border)" stroke-width="1" stroke-dasharray="2 4" opacity=".8"><title>新一轮请求</title></line>');
      }
      prevTurn = tid || prevTurn;
      var d = new Date(r[1]);
      var tt = pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var st = r[8] === 0 ? tr('完成') : r[8] === 1 ? tr('失败') : r[8] === 2 ? tr('已取消') : tr('进行中');
      var tip = '<title>' + esc(tt) + tr(' · 输入 ') + fmt(N(r[4])) + tr(' tok · 生成 ') + fmt(N(r[5])) + ' tok · ' + esc(MD[r[2]] || '?') + ' · ' + st + turnLabel + (r[9] === 1 ? tr(' · 子代理') : '') + '</title>';
      var over = r[15] === 1 || r[15] === true;
      if (over) tip = '<title>' + esc(tt) + tr(' · 已超上下文窗口 · 输入 ') + fmt(N(r[4])) + ' tok · ' + esc(MD[r[2]] || '?') + ' · ' + st + turnLabel + '</title>';
      if (r[9] === 1) { subDots.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (rs.length > 60 ? 2.2 : 3.2) + '" fill="' + (over ? 'var(--red)' : 'var(--viz-series-2)') + '" fill-opacity="0.9">' + tip + '</circle>'); return; }
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      dots.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (rs.length > 60 ? 2.4 : 3.4) + '" fill="' + (over ? 'var(--red)' : 'var(--viz-series-1)') + '" fill-opacity="0.85">' + tip + '</circle>');
    });
    // 压缩事件：按时间对齐到最近的请求位置，虚线竖线标注
    var cmpMarks = '';
    (cm ? (cm.ts || []) : []).forEach(function (tstr) {
      var tms = new Date(new Date().getFullYear() + '-' + tstr).getTime(); // tstr 形如 MM-DD HH:MM
      if (!isFinite(tms)) return;
      var best = -1, bestD = Infinity;
      rs.forEach(function (r, i) { var dd = Math.abs(r[1] - tms); if (dd < bestD) { bestD = dd; best = i; } });
      if (best < 0 || bestD > 30 * 60e3) return;
      var x = rs.length > 1 ? best / (rs.length - 1) * (W - 8) + 4 : W / 2;
      cmpMarks += '<line x1="' + x.toFixed(1) + '" y1="4" x2="' + x.toFixed(1) + '" y2="' + (H - 4) + '" stroke="var(--yellow)" stroke-width="1" stroke-dasharray="3 3" opacity=".9"><title>' + tr('压缩事件 ') + esc(tstr) + '</title></line>';
    });
    var limitLine = '';
    if (ctxLimit && maxIn > ctxLimit * 0.3) {
      var ly = H - 8 - (H - 16) * Math.min(1, ctxLimit / maxIn);
      limitLine = '<line x1="0" y1="' + ly.toFixed(1) + '" x2="' + W + '" y2="' + ly.toFixed(1) + '" stroke="var(--red)" stroke-width="1" stroke-dasharray="5 4" opacity=".8"><title>模型上下文窗口 ' + fmt(ctxLimit) + ' tok</title></line>';
    }
    var areaPath = pts.length > 1
      ? '<path d="M' + pts[0].split(',').join(' ') + pts.slice(1).map(function (p) { return ' L' + p.split(',').join(' '); }).join('') + ' L' + (W - 4) + ' ' + (H - 8) + ' L4 ' + (H - 8) + ' Z" fill="url(#udwl)" stroke="none"/>'
      : '';
    var curve = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="上下文水位曲线">' +
      '<defs><linearGradient id="udwl" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="var(--viz-series-1)" stop-opacity="0.3"/><stop offset="100%" stop-color="var(--viz-series-1)" stop-opacity="0.04"/></linearGradient></defs>' +
      areaPath + turnSeps.join('') + limitLine + cmpMarks +
      (pts.length > 1 ? '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--viz-series-1)" stroke-width="1.5"/>' : '') +
      dots.join('') + subDots.join('') + '</svg>';
    // 逐请求增量视图（对标 Delta 模式）：主会话相邻请求输入差值，正蓝负绿，压缩处可见净删
    var deltaSvg = (function () {
      var seq = [];
      rs.forEach(function (r) { if (r[9] !== 1) seq.push({ t: r[1], v: N(r[4]) }); });
      if (seq.length < 2 || seq.length > 2000) return ''; // 超大序列不构建增量视图（避免双倍 SVG DOM）
      var ds = seq.map(function (x, i) { return { t: x.t, d: i ? x.v - seq[i - 1].v : x.v }; });
      var maxAbs = 1;
      ds.forEach(function (x) { if (Math.abs(x.d) > maxAbs) maxAbs = Math.abs(x.d); });
      var y0 = H / 2, bw = Math.max(1.5, (W - 8) / ds.length - 1);
      var bars = ds.map(function (x, i) {
        var h = Math.abs(x.d) / maxAbs * (H / 2 - 10);
        var x0 = ds.length > 1 ? i / (ds.length - 1) * (W - 8) + 4 : W / 2;
        var up = x.d >= 0;
        var d = new Date(x.t);
        var tip = '<title>' + esc(pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())) + ' · ' + (up ? '+' : '−') + fmt(Math.abs(x.d)) + ' tok</title>';
        return '<rect x="' + (x0 - bw / 2).toFixed(1) + '" y="' + (up ? (y0 - h) : y0).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" fill="' + (up ? 'var(--viz-series-1)' : 'var(--viz-series-3)') + '" fill-opacity="0.85">' + tip + '</rect>';
      }).join('');
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="逐请求增量">' +
        '<line x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '" stroke="var(--border)" stroke-width="1"/>' + bars + '</svg>';
    })();
    var startT = fullTs(rs.length ? rs[0][1] : 0), endT = fullTs(o.last);
    // 起止时间直接标在水位曲线两端上方
    var curveWrap = '<div style="position:relative">' +
      '<span class="text-small text-muted" style="position:absolute;left:0;top:0">' + esc(startT) + '</span>' +
      '<span class="text-small text-muted" style="position:absolute;right:0;top:0;text-align:right">' + esc(endT) + '</span>' +
      '<div style="padding-top:16px"><div id="ud-curve-level">' + curve + '</div>' +
      (deltaSvg ? '<div id="ud-curve-delta" hidden>' + deltaSvg + '</div>' : '') + '</div></div>';
    var hasSub = subReq > 0;
    var hasOver = rs.some(function (r) { return r[15] === 1 || r[15] === true; });
    var curveHead = '<div class="ud-kv-l" style="margin:2px 0 2px">' +
      '<span class="ud-pill">' + tr('峰值 ') + fmt(maxIn) + ' tok</span>' +
      (ctxLimit ? '<span class="ud-pill">' + esc(MD[domModel]) + ' ' + Math.round(maxIn / ctxLimit * 100) + '%</span>' : '') +
      (hasSub ? '<span class="ud-pill"><span style="color:var(--viz-series-2)">●</span> ' + tr('子代理散点') + '</span>' : '') +
      (cm ? '<span class="ud-pill"><span style="color:var(--yellow)">┆</span> ' + tr('压缩事件') + '</span>' : '') +
      (hasOver ? '<span class="ud-pill" style="color:var(--red)">● ' + tr('超出窗口') + '</span>' : '') +
      (deltaSvg ? '<span class="viz-row" style="margin:0 6px;vertical-align:middle"><button type="button" class="ud-toggle" data-cmode="level" aria-pressed="true">' + tr('水位') + '</button><button type="button" class="ud-toggle" data-cmode="delta" aria-pressed="false">' + tr('增量') + '</button></span>' : '') +
      '<span class="text-muted">' + tr('悬停看点明细') + '</span></div>';
    var toolDonut = (toolsMap[o.g] || []).length
      ? donut((toolsMap[o.g] || []).slice().sort(function (a, b) { return b[1] - a[1]; }).slice(0, 6).map(function (t) {
          return { name: String(t[0]).replace(/^mcp__/, ''), value: t[1], absLabel: fmtI(t[1]) + tr(' 次'), tip: String(t[0]).replace(/^mcp__/, '') + ' · ' + fmtI(t[1]) + tr(' 次调用') + (t[3] ? tr(' · 累计 ') + fmtI(t[3]) + ' ms' : '') };
        }), tr('调用'))
      : '<span class="text-muted text-small">无工具调用</span>';
    function kv(l, v) { return '<div><div class="ud-kv-l">' + l + '</div><div class="ud-kv-v">' + v + '</div></div>'; }
    // 上下文构成环：按 part 存储字节近似（text/reasoning/tool/step/file/其他 → 五类），口径非 token
    var mixItems = (function () {
      var agg = {};
      (CTXMIX.filter(function (x) { return x[0] === o.g; })).forEach(function (x) {
        var t = String(x[1] || 'other');
        var cat = t === 'text' ? 'text' : t === 'reasoning' ? 'reasoning' : t === 'tool' ? 'tool'
          : (t === 'step-start' || t === 'step-finish') ? 'step' : t === 'file' ? 'file' : 'meta';
        agg[cat] = (agg[cat] || 0) + N(x[2]);
      });
      var spec = [
        ['text', tr('对话文本'), 'var(--viz-series-1)'],
        ['reasoning', tr('思考'), 'var(--viz-series-2)'],
        ['tool', tr('工具调用与结果'), 'var(--viz-series-3)'],
        ['step', tr('步骤骨架'), 'var(--viz-series-6)'],
        ['file', tr('附件'), 'var(--viz-series-4)'],
        ['meta', tr('元数据与其他'), 'var(--viz-series-5)']
      ];
      var out = [], tot = 0;
      spec.forEach(function (sp) { if (agg[sp[0]] > 0) { tot += agg[sp[0]]; } });
      if (!tot) return null;
      spec.forEach(function (sp) {
        if (agg[sp[0]] > 0) out.push({ name: sp[1], value: agg[sp[0]], color: sp[2], tip: sp[1] + ' · ' + fmtBytes(agg[sp[0]]) + ' (' + Math.round(agg[sp[0]] / tot * 100) + '%)' });
      });
      return out;
    })();
    var mixRing = mixItems ? donut(mixItems, tr('上下文构成')) : '<span class="text-muted text-small">' + tr('无分段数据') + '</span>';
    // 上下文 Top 下钻：按需拉取（serve 走 /api/ctx，侧栏走 usage_ctx_top 工具）；生成页无服务不显示
    var SID = (typeof D === 'object' && D && D.sessionIds) ? D.sessionIds : [];
    var canCtxTop = !!(window.__USAGE_SERVE__ || (window.zcode && typeof window.zcode.callTool === 'function'));
    var ctxTopBtn = (mixItems && canCtxTop && SID[o.g])
      ? '<button type="button" class="btn ud-ctx-top" data-sid="' + esc(String(SID[o.g])) + '" data-sg="' + o.g + '" style="margin:6px 0 0;padding:2px 10px;font-size:12px">' + tr('上下文 Top →') + '</button>'
      : '';
    // 上下文 Top 展开输出区（全宽：Fleet 时间轴 + 两榜），挂在详情底部
    var ctxTopOut = ctxTopBtn ? '<div class="ud-ctx-top-out"></div>' : '';
    // 当前上下文水位卡（hero）：最后一条请求的输入为「当前水位」，分段=缓存读/未命中输入，余量按窗口上限
    var hero = (function () {
      var cur = null;
      rs.forEach(function (r) { if (!cur || r[1] >= cur[1]) cur = r; });
      if (!cur) return '';
      var cin = N(cur[4]), cch = Math.min(N(cur[6]), cin), cmiss = Math.max(0, cin - cch);
      var d = new Date(cur[1]);
      var pct = ctxLimit ? Math.round(cin / ctxLimit * 100) : null;
      var base = ctxLimit ? Math.max(ctxLimit, cin) : cin;
      var segs = cin > 0
        ? (cch > 0 ? '<div title="' + tr('缓存读') + ' ' + fmt(cch) + ' tok" style="width:' + (cch / base * 100) + '%;background:var(--viz-series-1)"></div>' : '') +
          (cmiss > 0 ? '<div title="' + tr('未命中输入') + ' ' + fmt(cmiss) + ' tok" style="width:' + (cmiss / base * 100) + '%;background:var(--viz-series-4)"></div>' : '') +
          (ctxLimit && ctxLimit > cin ? '<div style="width:' + ((ctxLimit - cin) / base * 100) + '%;background:var(--muted)"></div>' : '')
        : '';
      var st = cur[8] === 0 ? tr('完成') : cur[8] === 1 ? tr('失败') : cur[8] === 2 ? tr('已取消') : tr('进行中');
      return '<div class="ud-sec" style="margin-top:14px"><div class="ud-kv-l">' + tr('当前上下文') +
        '<span class="text-muted" style="margin-left:8px;font-weight:400">' + esc(MD[cur[2]] || '?') + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' · ' + st + (cur[9] === 1 ? ' · ' + tr('子代理') : '') + '</span></div>' +
        '<div style="display:flex;align-items:baseline;gap:8px;margin:2px 0 6px;flex-wrap:wrap">' +
        '<span class="ud-hero-num">' + fmt(cin) + '</span><span class="text-muted text-small">' + (ctxLimit ? '/ ' + fmt(ctxLimit) + ' tok' : 'tok') + '</span>' +
        (pct != null ? '<span style="margin-left:auto" class="ud-hero-pct">' + Math.min(pct, 999) + '%</span><span class="text-muted text-small">' + tr('of context used') + '</span>' : '') +
        '</div>' +
        (segs ? '<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin:0 0 8px">' + segs + '</div>' : '') +
        '<div>' +
        (ctxLimit ? '<span class="ud-pill">' + tr('窗口上限 ') + fmt(ctxLimit) + ' tok</span>' : '') +
        (cm ? '<span class="ud-pill" style="color:var(--yellow)">' + tr('压缩 ') + cm.cnt + tr(' 次') + '</span>' : '<span class="ud-pill">' + tr('无压缩') + '</span>') +
        '<span class="ud-pill">' + tr('缓存率 ') + o.rate + '%</span>' +
        (cur[15] === 1 || cur[15] === true ? '<span class="ud-pill" style="color:var(--red)">' + tr('超出窗口') + '</span>' : '') +
        '</div></div>';
    })();
    var mixNote = mixItems ? '<div class="text-small text-muted" style="margin-top:4px">' + tr('按本地存储字节近似，非模型实际读取的 token 计量') + '</div>' : '';
    // Agent 团队：该会话子代理具名分布（strip zcode- 前缀；'-' 为未知来源）
    var sagRows = SAGENTS.filter(function (x) { return x[0] === o.g && N(x[2]) > 0; })
      .sort(function (a, b) { return N(b[3]) - N(a[3]); });
    var sagHtml = sagRows.length
      ? sagRows.map(function (x) {
          var nm = String(x[1]) === '-' ? tr('未知来源') : String(x[1]).replace(/^zcode-/, '');
          return '<div class="ud-kv"><div style="display:flex;justify-content:space-between;gap:8px;max-width:460px">' +
            '<span title="' + esc(String(x[1])) + '">' + esc(nm) + '</span>' +
            '<span class="text-muted text-small tabular-nums">' + fmtI(N(x[2])) + tr(' 次 · ') + fmt(N(x[3])) + ' tok</span></div></div>';
        }).join('')
      : '';
    // 耗时构成环（对标 Timing Stats）：首字等待 / 生成 / 工具执行三类，中心为总活跃时长
    var timingRing = (function () {
      var ttftMs = 0, genMs = 0, tt = 0;
      rs.forEach(function (r) { var t = N(r[11]); if (t > 0) ttftMs += t; var d = N(r[7]) - t; if (d > 0) genMs += d; });
      (toolsMap[o.g] || []).forEach(function (t) { tt += N(t[3]); });
      var parts = [
        [tr('首字等待'), ttftMs, 'var(--viz-series-2)'],
        [tr('生成'), genMs, 'var(--viz-series-1)'],
        [tr('工具执行'), tt, 'var(--viz-series-3)']
      ].filter(function (x) { return x[1] > 0; });
      if (!parts.length) return '';
      var tot4 = parts.reduce(function (a, x) { return a + x[1]; }, 0);
      return donut(parts.map(function (x) {
        return { name: x[0], value: x[1], color: x[2], absLabel: fmtDur(x[1]), tip: x[0] + ' · ' + fmtDur(x[1]) + ' (' + Math.round(x[1] / tot4 * 100) + '%)' };
      }), tr('活跃时长'));
    })();
    var ctxRow = (mixItems || sagRows.length || timingRing)
      ? '<div class="ud-grid3" style="margin-top:14px">' +
        (mixItems ? '<div><div class="ud-kv-l">' + tr('上下文构成') + '</div>' + mixRing + mixNote + ctxTopBtn + '</div>' : '<div></div>') +
        (timingRing ? '<div><div class="ud-kv-l">' + tr('耗时构成') + '</div>' + timingRing + '</div>' : '<div></div>') +
        (sagRows.length ? '<div><div class="ud-kv-l">' + tr('Agent 团队（子代理分布）') + '</div>' + sagHtml + '</div>' : '') +
        '</div>'
      : '';
    // 主/子代理 token 拆分条（双色堆叠，悬停看明细；rows r[9]：0 主会话 1 子代理）
    var tot2 = mainTok + subTok;
    var subBar = tot2 > 0
      ? '<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin:6px 0 6px;max-width:460px">' +
        (mainTok > 0 ? '<div data-tip="' + tr('主会话') + ' · ' + fmtI(mainReq) + tr(' 次 · ') + fmt(mainTok) + ' tok (' + Math.round(mainTok / tot2 * 100) + '%)" style="width:' + (mainTok / tot2 * 100) + '%;background:var(--viz-series-1)"></div>' : '') +
        (subTok > 0 ? '<div data-tip="' + tr('子代理') + ' · ' + fmtI(subReq) + tr(' 次 · ') + fmt(subTok) + ' tok (' + Math.round(subTok / tot2 * 100) + '%)" style="width:' + (subTok / tot2 * 100) + '%;background:var(--viz-series-3)"></div>' : '') +
        '</div><div class="text-small text-muted">' +
        (mainReq ? '<span style="color:var(--viz-series-1)">■</span> 主会话 ' + fmt(mainTok) + ' tok × ' + fmtI(mainReq) : '') +
        (subReq ? (mainReq ? '　' : '') + '<span style="color:var(--viz-series-3)">■</span> 子代理 ' + fmt(subTok) + ' tok × ' + fmtI(subReq) : '') + '</div>'
      : '';
    return hero + '<div class="ud-sec"><div class="ud-kv-l">' + tr('项目目录') + '</div><div class="ud-kv-v" style="word-break:break-all">' + dir + '</div>' +
      (subReq ? subBar : '') +
      (pvm ? '<div class="text-small text-muted" style="margin-top:4px">' + tr('来源：') + '' + pvm + '</div>' : '') + '</div>' +
      '<div class="ud-kv">' +
      kv(tr('请求 / 缓存率'), fmtI(o.req) + tr(' 次 · ') + o.rate + '%') +
      (function () {
        var gen = 0, ms = 0;
        rs.forEach(function (r) { gen += N(r[5]); ms += Math.max(1, N(r[7]) - (r[11] == null ? 0 : N(r[11]))); });
        return ms > 0 ? kv(tr('平均输出速率'), tpsHtml(Math.round(gen / ms * 1000)) + tr(' tok/s（加权）')) : '';
      })() +
      (subReq ? kv(tr('主会话 / 子代理'), fmtI(mainReq) + tr(' 次 · ') + fmt(mainTok) + ' tok <span class="text-muted">/</span> ' + fmtI(subReq) + tr(' 次 · ') + fmt(subTok) + ' tok') : '') +
      kv(tr('上下文压缩'), cmpHtml) +
      (costOn && o.hasCost ? kv(tr('折算成本'), fmtCost(o.cost)) : '') +
      '</div>' +
      '<div class="ud-grid3" style="margin-top:14px">' +
      '<div><div class="ud-kv-l">' + tr('模型占比（按 token）') + '</div>' + mix +
      '<button type="button" class="btn ud-sess-logs" data-sg="' + o.g + '" style="margin:8px 0 0;padding:2px 10px;font-size:12px">' + tr('查看该会话请求日志 →') + '</button></div>' +
      '<div><div class="ud-kv-l">' + tr('使用工具（调用次数占比）') + '</div>' + toolDonut + '</div>' +
      '<div>' + (tl8 || '<div class="ud-kv-l">' + tr('事件时间线') + '</div><span class="text-muted text-small">无压缩 / 模型切换事件</span>') + '</div>' +
      '</div>' +
      ctxRow + ctxTopOut +
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
    headEl.innerHTML = '<tr><th>' + tr('模型') + '</th><th class="text-end">' + tr('请求数') + '</th><th class="text-end">' + tr('平均 tok/s') + '</th><th class="text-end">' + tr('平均首字') + '</th><th class="text-end">' + tr('失败率') + '</th><th class="text-end">' + tr('平均产出') + '</th><th class="text-end">' + tr('输入 token') + '</th><th class="text-end">' + tr('生成 token') + '</th><th class="text-end">' + tr('合计') + '</th><th class="text-end">' + tr('缓存率') + '</th>' + (costOn ? '<th class="text-end">' + tr('折算成本') + '</th><th class="text-end">' + tr('成本 / 1k tok') + '</th>' : '') + '</tr>';
    bodyEl.innerHTML = list.length ? list.map(function (o) {
      var avgOut = o.req ? o.out / o.req : null;
      return '<tr><td class="ud-flink" data-k="m" data-v="' + o.m + '" title="点击只看该模型">' + esc(MD[o.m]) + '</td>' +
        '<td class="text-end tabular-nums">' + fmtI(o.req) + '</td>' +
        '<td class="text-end">' + (o.tps == null ? '–' : tpsHtml(o.tps)) + '</td>' +
        '<td class="text-end tabular-nums">' + (o.avgTtft == null ? '–' : durCell(o.avgTtft)) + '</td>' +
        '<td class="text-end tabular-nums" style="color:' + (o.errRate >= 10 ? 'var(--red)' : o.errRate > 0 ? 'var(--yellow)' : 'inherit') + '">' + o.errRate + '%</td>' +
        '<td class="text-end tabular-nums" title="' + tr('生成 token / 请求（单轮平均产出）') + '">' + (avgOut == null ? '–' : fmt(avgOut)) + '</td>' +
        '<td class="text-end tabular-nums">' + tokCell(o.inn) + '</td><td class="text-end tabular-nums">' + tokCell(o.out) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td>' +
        '<td class="text-end tabular-nums">' + o.rate + '%</td>' +
        (costOn ? '<td class="text-end tabular-nums">' + (o.hasCost ? fmtCost(o.cost) : '–') + '</td><td class="text-end tabular-nums">' + (o.per1k == null ? '–' : fmtCost(o.per1k)) + '</td>' : '') +
        '</tr>';
    }).join('') : '<tr><td colspan="11" class="text-muted">' + tr('当前筛选下暂无数据') + '</td></tr>';
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
    return '<span data-tip="' + tr('健康分 ') + h + tr('／100：失败率×60 + 取消率×25 + 重试率（封顶 15）加权扣分') + '" style="color:' + c + ';font-weight:600">' + h + '</span>';
  }
  // 项目用量：按会话目录聚合（ccusage project / CCMeter 项目卡片的本地版）
  function renderProjects(rows) {
    var headEl = $('ud-projects-head'), bodyEl = $('ud-projects-body');
    if (!headEl || !bodyEl) return;
    var per = {};
    rows.forEach(function (r) {
      var dir = projKey(SD[r[0]] || tr('（未知目录）'));
      var o = per[dir] || (per[dir] = { req: 0, inn: 0, out: 0, cost: 0, hasCost: false, last: 0, sess: {}, dirs: {}, tok: 0 });
      o.req++; o.inn += N(r[4]); o.out += N(r[5]); o.tok = o.inn + o.out;
      if (r[1] > o.last) o.last = r[1];
      o.sess[r[0]] = 1; o.dirs[SD[r[0]] || ''] = 1;
      var c = rowCost(r); if (c != null) { o.cost += c; o.hasCost = true; }
    });
    // 近 7 天 sparkline 序列（按项目）
    var days7 = [];
    for (var i7 = 6; i7 >= 0; i7--) days7.push(dayKey(Date.now() - i7 * 864e5));
    var sp = {};
    rows.forEach(function (r) {
      var k = dayKey(r[1]);
      if (days7.indexOf(k) < 0) return;
      var dir = projKey(SD[r[0]] || tr('（未知目录）'));
      var o = sp[dir] || (sp[dir] = {});
      o[k] = (o[k] || 0) + N(r[4]) + N(r[5]);
    });
    function spark(dir) {
      var vals = days7.map(function (k) { return N((sp[dir] || {})[k]); });
      var mx = Math.max.apply(null, vals);
      if (!mx) return '<span class="text-muted">–</span>';
      var W = 72, Hh = 18, step = W / 6;
      var pts = vals.map(function (v, i) { return (i * step).toFixed(1) + ',' + (Hh - 2 - (Hh - 5) * v / mx).toFixed(1); }).join(' ');
      var last = vals[6];
      return '<svg width="' + W + '" height="' + Hh + '" style="display:block" role="img" aria-label="近 7 天趋势"><polyline points="' + pts + '" fill="none" stroke="var(--ud-accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/><circle cx="' + W + '" cy="' + (Hh - 2 - (Hh - 5) * last / mx).toFixed(1) + '" r="2.2" fill="var(--ud-accent)"/></svg>';
    }
    var list = Object.keys(per).map(function (d) { var o = per[d]; o.dir = d; return o; })
      .sort(function (a, b) { return b.tok - a.tok; });
    headEl.innerHTML = '<tr><th>' + tr('项目') + '</th><th class="text-end">' + tr('会话数') + '</th><th class="text-end">' + tr('请求数') + '</th><th class="text-end">' + tr('token 合计') + '</th>' + (costOn ? '<th class="text-end">' + tr('折算成本') + '</th>' : '') + '<th>' + tr('近 7 天') + '</th><th class="text-end">' + tr('最后活动') + '</th></tr>';
    bodyEl.innerHTML = list.length ? list.map(function (o) {
      var base = baseName(o.dir);
      var sel = st.proj === o.dir;
      var dirs = Object.keys(o.dirs).filter(Boolean);
      var dirNote = dirs.length > 1 ? tr(' · 含 ') + dirs.length + tr(' 个目录') : '';
      return '<tr class="ud-click" data-proj="' + esc(o.dir) + '" title="' + tr('点击只看该项目的会话') + '\n' + esc(dirs.join('\n')) + '"><td class="text-nowrap">' + esc(base) + (sel ? ' <span class="ud-tag">' + tr('已选') + '</span>' : '') + '<div class="ud-kv-l" style="margin-top:1px">' + esc(o.dir) + (dirs.length > 1 ? ' <span class="ud-tag">' + dirNote + '</span>' : '') + '</div></td>' +
        '<td class="text-end tabular-nums">' + fmtI(Object.keys(o.sess).length) + '</td>' +
        '<td class="text-end tabular-nums">' + fmtI(o.req) + '</td>' +
        '<td class="text-end tabular-nums">' + tokCell(o.tok) + '</td>' +
        (costOn ? '<td class="text-end tabular-nums">' + (o.hasCost ? fmtCost(o.cost) : '–') + '</td>' : '') +
        '<td>' + spark(o.dir) + '</td>' +
        '<td class="text-end text-nowrap">' + fullTs(o.last) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="text-muted">' + tr('当前筛选下暂无数据') + '</td></tr>';
    Array.prototype.forEach.call(bodyEl.querySelectorAll('tr.ud-click'), function (tr) {
      tr.addEventListener('click', function () {
        var d = tr.getAttribute('data-proj');
        st.proj = st.proj === d ? null : d;
        var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-sessions"]');
        if (btn) btn.click();
        apply();
      });
    });
  }

  // 计费窗口（近似）：按相邻请求间隔 ≥5h 切分（ccusage blocks 同口径的本地近似，
  // 官方窗口起点在服务端，仅作节奏参考），展示最近 8 个窗口 + 活跃窗口投影
  function renderBlocks(rows) {
    var host = $('ud-blocks');
    if (!host) return;
    var ts = rows.map(function (r) { return r[1]; }).sort(function (a, b) { return a - b; });
    if (ts.length < 2) { host.innerHTML = '<p class="text-muted">数据不足，无法切分窗口</p>'; return; }
    var wins = [], cur = { start: ts[0], end: ts[0], tok: 0, req: 0 };
    var lastT = null;
    rows.slice().sort(function (a, b) { return a[1] - b[1]; }).forEach(function (r) {
      if (lastT != null && r[1] - lastT >= 5 * 3600e3) { wins.push(cur); cur = { start: r[1], end: r[1], tok: 0, req: 0 }; }
      cur.end = r[1]; cur.tok += N(r[4]) + N(r[5]); cur.req++;
      lastT = r[1];
    });
    wins.push(cur);
    var recent = wins.slice(-8);
    var mx = Math.max.apply(null, recent.map(function (w) { return w.tok; })) || 1;
    var nowMs = Date.now();
    host.innerHTML = '<div class="ud-win-list">' + recent.map(function (w, i) {
      var isActive = i === recent.length - 1 && (nowMs - w.end) < 5 * 3600e3;
      var pct = Math.min(100, Math.round(w.tok / mx * 100));
      var proj = '';
      if (isActive && w.end > w.start) {
        var elapsedMin = Math.max(1, (w.end - w.start) / 60e3);
        var projected = Math.round(w.tok / elapsedMin * 300);
        proj = tr(' · 预计全窗 ') + fmt(projected) + ' tok';
      }
      return '<div class="ud-win' + (isActive ? ' ud-win-active' : '') + '">' +
        '<div class="ud-win-t">' + fullTs(w.start).slice(5, -3) + ' – ' + pad(new Date(w.end).getHours()) + ':' + pad(new Date(w.end).getMinutes()) + (isActive ? ' <span class="ud-tag" style="color:var(--ud-accent)">' + tr('活跃') + proj + '</span>' : '') + '</div>' +
        '<div class="ud-win-bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="ud-win-v tabular-nums">' + fmt(w.tok) + ' <span class="fs">' + fmtI(w.req) + tr(' 次') + '</span></div></div>';
    }).join('') + '</div><p class="ud-kv-l" style="margin-top:6px">' + tr('近似口径：按相邻请求间隔 ≥5h 开新窗，官方窗口起点在服务端，仅作节奏参考。') + '</p>';
  }

  function renderSessions(rows) {
    var keys = { 1: 'req', 2: 'inn', 3: 'out', 4: 'tot', 5: 'last', 6: 'cost', 7: 'rate', 8: 'health' };
    var list = sessAgg(rows).filter(function (o) { return !st.proj || projKey(SD[o.g] || '') === st.proj; })
      .sort(function (a, b) { return ((a[keys[sortS.k]] || 0) - (b[keys[sortS.k]] || 0)) * sortS.d; });
    var hasCmp = (D.compactions || []).length > 0;
    var cols = [
      { h: tr('会话'), k: null }, { h: tr('请求数'), k: 1, end: 1 }, { h: tr('输入 token'), k: 2, end: 1 },
      { h: tr('生成 token'), k: 3, end: 1 }, { h: tr('token 合计'), k: 4, end: 1 },
      { h: tr('缓存率'), k: 7, end: 1 }, { h: tr('健康'), k: 8, end: 1 },
      hasCmp ? { h: tr('压缩'), k: null, end: 1 } : null,
      costOn ? { h: tr('折算成本'), k: 6, end: 1 } : null,
      { h: tr('最后活动'), k: 5, end: 1 }
    ].filter(Boolean);
    var span = cols.length;
    $('ud-sessions-head').innerHTML = '<tr>' + cols.map(function (c) {
      var arrow = sortS.k === c.k ? (sortS.d < 0 ? ' ↓' : ' ↑') : '';
      return c.k == null ? '<th>' + c.h + '</th>' : '<th class="ud-sortable' + (c.end ? ' text-end' : '') + '" data-k="' + c.k + '"' + (sortS.k === c.k ? ' aria-sort="' + (sortS.d < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + c.h + arrow + '</th>';
    }).join('') + '</tr>';
    var shown = list.slice(0, 30);
    var body = '';
    shown.forEach(function (o) {
      body += '<tr class="ud-click" data-sg="' + o.g + '"><td>' + sessTitle(o) + (o.sub ? '<span class="ud-tag">' + tr('子代理 ×') + fmtI(o.sub) + '</span>' : '') + '</td><td class="text-end tabular-nums">' + fmtI(o.req) + '</td><td class="text-end tabular-nums">' + tokCell(o.inn) + '</td><td class="text-end tabular-nums">' + tokCell(o.out) + '</td><td class="text-end tabular-nums">' + tokCell(o.tot) + '</td><td class="text-end tabular-nums">' + o.rate + '%</td><td class="text-end">' + healthBadge(o.health) + '</td>' + (hasCmp ? '<td class="text-end text-nowrap">' + (cmpMap[o.g] ? cmpMap[o.g].cnt + tr(' 次') : '–') + '</td>' : '') + (costOn ? '<td class="text-end tabular-nums">' + (o.hasCost ? fmtCost(o.cost) : '–') + '</td>' : '') + '<td class="text-end text-nowrap">' + fullTs(o.last) + '</td></tr>';
      if (o.g === sessExp) body += '<tr class="ud-exp"><td colspan="' + span + '">' + sessionDetailHTML(o) + '</td></tr>';
    });
    $('ud-sessions-body').innerHTML = body || '<tr><td colspan="' + span + '" class="text-muted">' + tr('当前筛选下暂无数据') + '</td></tr>';
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
      // 上下文 Top 下钻：点击后按需拉取（会话详情是 innerHTML 重渲染，事件挂在表体上）
      bodyEl.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.ud-ctx-top') : null;
        if (!btn) return;
        var out = btn.closest('.ud-exp').querySelector('.ud-ctx-top-out');
        if (!out) return;
        var sid = btn.getAttribute('data-sid');
        btn.disabled = true; btn.textContent = tr('加载中…');
        var draw = function (j) {
          btn.style.display = 'none';
          var rows2 = function (arr, total, labelFn) {
            return (arr || []).map(function (x) {
              var nm = String(x[0] || '');
              var pct = total > 0 ? Math.round(N(x[2]) / total * 100) : 0;
              return '<div style="display:flex;justify-content:space-between;gap:8px;max-width:460px" class="text-small">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(nm) + '">' + esc(labelFn(nm)) + '</span>' +
                '<span class="text-muted tabular-nums" style="flex:none">' + fmtI(N(x[1])) + tr(' 次 · ') + fmtBytes(N(x[2])) + ' · ' + pct + '%</span></div>';
            }).join('') || '<span class="text-muted text-small">' + tr('暂无数据') + '</span>';
          };
          var tt = 0; (j.tools || []).forEach(function (x) { tt += N(x[2]); });
          var tf = 0; (j.files || []).forEach(function (x) { tf += N(x[2]); });
          var base = function (p) { return p.replace(/^.*\//, '') || p; };
          // Fleet 泳道时间轴：每个具名子代理一行，区间条按 [started_at, +duration_ms] 映射到会话时间轴
          var fleet = j.fleet || [];
          var gantt = '';
          if (fleet.length) {
            var lanes = [];
            fleet.forEach(function (f) { var a = String(f[0] || '-'); if (lanes.indexOf(a) < 0) lanes.push(a); });
            var t0 = Infinity, t1 = 0;
            fleet.forEach(function (f) { var st = N(f[1]), du = Math.max(N(f[2]), 1000); if (st < t0) t0 = st; if (st + du > t1) t1 = st + du; });
            if (isFinite(t0) && t1 > t0) {
              var span = t1 - t0, W = 600, laneH = 22, H = lanes.length * laneH + 6;
              var bars = fleet.map(function (f) {
                var li = lanes.indexOf(String(f[0] || '-'));
                var st = N(f[1]), du = Math.max(N(f[2]), 1000);
                var x = (st - t0) / span * (W - 8) + 4;
                var w = Math.max(3, du / span * (W - 8));
                var dt = new Date(st);
                var tip = esc(String(f[0]).replace(/^zcode-/, '')) + ' · ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ' · ' + durCell(du) + ' · ' + fmt(N(f[3])) + ' tok';
                return '<rect class="ud-fleet-bar" data-sid="' + esc(String(f[4] || '')) + '" style="cursor:' + (f[4] ? 'pointer' : 'default') + '" x="' + x.toFixed(1) + '" y="' + (li * laneH + 3) + '" width="' + w.toFixed(1) + '" height="' + (laneH - 8) + '" rx="3" fill="' + PALETTE[li % PALETTE.length] + '" fill-opacity="0.85"><title>' + tip + (f[4] ? ' · ' + tr('点击看该子代理请求') : '') + '</title></rect>';
              }).join('');
              var seps = lanes.map(function (_, i) {
                return '<line x1="0" x2="' + W + '" y1="' + ((i + 1) * laneH + 3) + '" y2="' + ((i + 1) * laneH + 3) + '" stroke="var(--border)" stroke-width="1" opacity="0.45"/>';
              }).join('');
              var legend = lanes.map(function (ln, i) {
                return '<span class="text-small" style="margin-right:14px"><span style="color:' + PALETTE[i % PALETTE.length] + '">■</span> ' + esc(String(ln).replace(/^zcode-/, '')) + '</span>';
              }).join('');
              gantt = '<div class="ud-kv-l" style="margin-top:12px">' + tr('子代理并行时间轴') + '</div>' +
                '<div style="margin:2px 0 2px">' + legend + '</div>' +
                '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="Fleet">' + seps + bars + '</svg>';
            }
          }
          // 上下文浏览器（对标 dsh Context Browser）：类别行可展开逐条看内容摘要
          var br = '';
          (function () {
            var groups = j.bgroups || [], items = j.bitems || [];
            if (!groups.length) return;
            var CAT = {
              text: [tr('对话文本'), 'var(--viz-series-1)'],
              reasoning: [tr('思考'), 'var(--viz-series-2)'],
              tool: [tr('工具调用与结果'), 'var(--viz-series-3)'],
              file: [tr('附件'), 'var(--viz-series-4)'],
              compaction: [tr('压缩'), 'var(--viz-series-5)']
            };
            var btot = 0;
            groups.forEach(function (g) { btot += N(g[2]); });
            var byType = {};
            items.forEach(function (i) { (byType[i[0]] = byType[i[0]] || []).push(i); });
            var rowsHtml = '';
            groups.forEach(function (g) {
              var t = String(g[0]);
              var cat = CAT[t] || [t, 'var(--muted-foreground)'];
              var pct = btot ? Math.round(N(g[2]) / btot * 100) : 0;
              var r1c = N(g[3]), r1b = N(g[4]);
              var incBadge = r1c > 0 ? '<span class="ud-pill" style="color:var(--green);flex:none">+' + fmtI(r1c) + ' · ≈' + fmtBytes(r1b) + ' ' + tr('近 1h') + '</span>' : '';
              var itemsHtml = (byType[t] || []).map(function (i) {
                var d = new Date(N(i[1]));
                var sn = String(i[3] || '').replace(/\s+/g, ' ');
                var bodyRaw = String(i[4] == null ? '' : i[4]);
                var oneLine = (sn + (bodyRaw ? ' ' + bodyRaw.replace(/\s+/g, ' ') : '')).slice(0, 140);
                var fullHtml;
                if (t === 'tool') {
                  // 工具条目：参数 JSON → key/value 表；完整解析失败（800 字符截断）用容错逐 key 配对，再失败回退等宽原文
                  var pairs = null;
                  try {
                    var o = JSON.parse(bodyRaw);
                    if (o && typeof o === 'object' && !Array.isArray(o)) {
                      pairs = Object.keys(o).map(function (k) {
                        var v = o[k];
                        return [k, typeof v === 'string' ? v : JSON.stringify(v)];
                      });
                    }
                  } catch (e2) {}
                  if (!pairs) {
                    try {
                      var body2 = bodyRaw.replace(/^\s*\{/, '');
                      var re = /"((?:[^"\\]|\\.)*)"\s*:\s*/g, m, keys = [], last = 0;
                      while ((m = re.exec(body2))) {
                        var before = body2.slice(Math.max(0, m.index - 1), m.index);
                        if (before !== '' && before !== ',' && before !== '{') continue;
                        keys.push({ k: m[1], vs: m.index + m[0].length, at: m.index });
                      }
                      var ps = [];
                      for (var ik = 0; ik < keys.length; ik++) {
                        var end = ik + 1 < keys.length ? keys[ik + 1].at : body2.length;
                        var v = body2.slice(keys[ik].vs, end).replace(/,\s*$/, '').trim();
                        if (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"' && v.length > 1) v = v.slice(1, -1);
                        if (v.length > 1200) v = v.slice(0, 1200) + ' …';
                        else if (ik === keys.length - 1 && !/[}"0-9\]]$/.test(v)) v += ' …';
                        ps.push([keys[ik].k, v]);
                      }
                      if (ps.length) pairs = ps;
                    } catch (e3) {}
                  }
                  var kv = pairs ? pairs.map(function (pr) {
                    var vs = String(pr[1]).replace(/\\n/g, '\n');
                    if (vs.length > 1200) vs = vs.slice(0, 1200) + ' …';
                    return '<div class="ud-kvrow"><span class="k">' + esc(pr[0]) + '</span><span class="v">' + esc(vs) + '</span></div>';
                  }).join('') : '';
                  fullHtml = kv ? '<div class="ud-toolhead">' + esc(sn) + '</div><div class="ud-tooljson">' + kv + '</div>'
                    : '<div class="ud-toolhead">' + esc(sn) + '</div><pre class="ud-rawbody">' + esc(bodyRaw) + '</pre>';
                } else if (t === 'text' || t === 'reasoning') {
                  fullHtml = '<div class="ud-msgbody' + (t === 'reasoning' ? ' ud-reasoning' : '') + '">' + esc(String(i[4] == null ? '' : i[4])) + '</div>';
                } else {
                  fullHtml = esc(oneLine);
                }
                return '<div class="ud-brow-item"><span class="ts">' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</span><span class="sn" title="' + tr('点击展开/收起全文') + '">' + esc(oneLine) + '<span class="full">' + fullHtml + '</span></span><span class="abs">' + fmtBytes(N(i[2])) + '</span></div>';
              }).join('') || '';
              var shown = (byType[t] || []).length;
              var capNote = N(g[1]) > shown && shown > 0
                ? '<div class="ud-brow-item"><span class="ts"></span><span class="sn text-muted">' + tr('仅展示最大的前 30 条') + '</span><span class="abs"></span></div>'
                : '';
              rowsHtml += '<div class="ud-brow-row" data-bg="' + esc(t) + '"><span class="ud-brow-arrow">▸</span><span class="ud-dot" style="background:' + cat[1] + '"></span><span class="nm">' + esc(cat[0]) + '</span>' +
                '<span class="text-muted text-small tabular-nums" style="flex:none">' + fmtI(N(g[1])) + tr(' 条') + '</span>' +
                incBadge +
                '<span class="bar"><i style="width:' + pct + '%;background:' + cat[1] + '"></i></span>' +
                '<span class="abs">≈' + fmtBytes(N(g[2])) + '</span><span class="n">' + pct + '%</span></div>' +
                '<div class="ud-brow-items" data-bgp="' + esc(t) + '" hidden>' + itemsHtml + capNote + '</div>';
            });
            br = '<div class="ud-kv-l" style="margin-top:14px">' + tr('上下文浏览器') + '</div><div style="margin-top:2px">' + rowsHtml + '</div>';
          })();
          out.innerHTML = gantt + br +
            '<div class="ud-grid3" style="margin-top:' + (fleet.length ? '14px' : '8px') + '">' +
            '<div><div class="ud-kv-l">' + tr('工具字节 Top（存储字节）') + '</div>' + rows2(j.tools, tt, function (n) { return n.replace(/^mcp__/, ''); }) + '</div>' +
            '<div style="grid-column:span 2">' + (tf > 0 ? '<div class="ud-kv-l">' + tr('文件字节 Top（Read/Edit/Write）') + '</div>' + rows2(j.files, tf, base) : '') + '</div>' +
            '</div>';
        };
        var fail = function () { btn.disabled = false; btn.textContent = tr('上下文 Top →'); };
        if (window.__USAGE_SERVE__) {
          fetch('/api/ctx?session=' + encodeURIComponent(sid)).then(function (r) { return r.json(); }).then(draw).catch(fail);
        } else {
          try {
            Promise.resolve(window.zcode.callTool('usage_ctx_top', { session: sid })).then(function (r) { draw((r && r.structuredContent) || {}); }).catch(fail);
          } catch (e2) { fail(); }
        }
      });
      // 浏览器类别行展开/收起
      bodyEl.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('.ud-brow-row') : null;
        if (row) {
          var g = row.getAttribute('data-bg');
          var items = row.parentElement.querySelector('.ud-brow-items[data-bgp="' + (window.CSS && CSS.escape ? CSS.escape(g) : g) + '"]');
          if (!items) return;
          var open = items.hidden;
          items.hidden = !open;
          row.classList.toggle('ud-open', open);
          return;
        }
        // 条目点击：展开/收起全文（摘要默认单行截断）
        var it = e.target.closest ? e.target.closest('.ud-brow-item') : null;
        if (it) it.classList.toggle('ud-full');
      });
      // 水位曲线 水位/增量 切换（两个 svg 都在 DOM，切显隐）
      bodyEl.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.ud-toggle[data-cmode]') : null;
        if (!btn) return;
        var exp = btn.closest('tr.ud-exp');
        if (!exp) return;
        var mode = btn.getAttribute('data-cmode');
        var lv = exp.querySelector('#ud-curve-level'), dl = exp.querySelector('#ud-curve-delta');
        if (!lv || !dl) return;
        lv.hidden = mode !== 'level';
        dl.hidden = mode !== 'delta';
        Array.prototype.forEach.call(exp.querySelectorAll('.ud-toggle[data-cmode]'), function (b) {
          b.setAttribute('aria-pressed', b.getAttribute('data-cmode') === mode ? 'true' : 'false');
        });
      });
      // Fleet 泳道条点击：跳到该子会话的请求日志（子会话 id 在 sessionIds 索引表内才可跳）
      bodyEl.addEventListener('click', function (e) {
        var bar = e.target.closest ? e.target.closest('.ud-fleet-bar') : null;
        if (!bar) return;
        var fsid = bar.getAttribute('data-sid');
        var idx = (D.sessionIds || []).indexOf(fsid);
        if (!fsid || idx < 0) return;
        st.s = idx; page = 1; sessExp = -1; detExp = -1;
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
    return '<div class="text-small text-muted" style="line-height:1.9">生成耗时 ' + genMs + tr(' ms · 首字占比 ') + ttftpct +
      (window.__USAGE_SERVE__ ? tr(' · 以下为 provider 上报的原始用量') : '') + '</div>' +
      (window.__USAGE_SERVE__ ? '<div class="ud-sec" id="ud-reqraw"><div class="ud-kv-l">正在拉取 provider 上报的原始用量…</div></div>' : '');
  }
  function fillRawUsage(id) {
    var el = $('ud-reqraw');
    if (!el) return;
    fetch('/api/request?id=' + encodeURIComponent(id)).then(function (x) { return x.json(); }).then(function (j) {
      if (j.error) { el.innerHTML = '<div class="ud-kv-l">原始用量：' + esc(j.error) + '</div>'; return; }
      var usage = tr('(无)');
      try { usage = j.raw_usage_json ? JSON.stringify(JSON.parse(j.raw_usage_json), null, 1) : usage; } catch (e) { usage = j.raw_usage_json || usage; }
      var extra = [];
      if (j.finish_reason) extra.push('finish_reason: ' + j.finish_reason);
      if (j.error_code || j.error_message) extra.push(tr('错误: ') + (j.error_code || '') + ' ' + (j.error_message || ''));
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
      { h: tr('时间'), k: 0 }, { h: tr('会话'), k: null }, { h: tr('模型'), k: null }, { h: tr('来源'), k: null }, { h: tr('类型'), k: null },
      { h: tr('输入'), k: 4, end: 1 }, { h: tr('缓存读'), k: 6, end: 1 }, { h: tr('缓存写'), k: 10, end: 1 },
      { h: tr('生成'), k: 5, end: 1 }, { h: tr('合计'), k: 12, end: 1 }, { h: tr('耗时'), k: 7, end: 1 }, { h: tr('首字'), k: 11, end: 1 },
      { h: 'tok/s', k: 14, end: 1 },
      { h: tr('状态'), k: null },
      costOn ? { h: tr('成本'), k: 13, end: 1 } : null
    ].filter(Boolean);
    if (D.session) { cols = cols.filter(function (c) { return c.h !== tr('会话') && c.h !== tr('类型'); }); }
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
          '<td class="ud-flink" data-k="s" data-v="' + r[0] + '" title="' + tr('点击只看该会话') + '">' + (TL[r[0]] ? esc(TL[r[0]]) : '<span class="text-muted">（无标题）</span>') + '</td>' +
          '<td class="ud-flink" data-k="m" data-v="' + r[2] + '" title="' + tr('点击只看该模型') + '">' + esc(MD[r[2]]) + '</td><td>' + pvLabel(r[3]) + '</td><td>' + QT[r[9]] + '</td>' +
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
    $('ud-detail-body').innerHTML = body || '<tr><td colspan="' + span + '" class="text-muted">' + tr('当前筛选下暂无数据') + '</td></tr>';
    if (D.session) {
      var more = $('ud-more');
      if (more) {
        if (sessShown >= list.length) { more.hidden = true; }
        else { more.hidden = false; more.textContent = tr('加载更多（已显示 ') + sessShown + ' / ' + list.length + '）'; }
      }
    } else {
      var pageSel = '';
      if (totalPages > 1) {
        pageSel = '<select class="form-select" id="ud-page-sel" aria-label="' + tr('跳转到页') + '" style="max-width:110px">';
        for (var pi = 1; pi <= totalPages; pi++) pageSel += '<option value="' + pi + '"' + (pi === page ? ' selected' : '') + '>' + pi + ' / ' + totalPages + '</option>';
        pageSel += '</select>';
      }
      $('ud-pager').innerHTML = '<button type="button" class="btn" id="ud-prev"' + (page <= 1 ? ' disabled' : '') + '>' + tr('上一页') + '</button>' +
        pageSel +
        '<span class="text-small text-muted tabular-nums">' + tr('共 ') + fmtI(list.length) + tr(' 条') + '</span>' +
        '<button type="button" class="btn" id="ud-next"' + (page >= totalPages ? ' disabled' : '') + '>' + tr('下一页') + '</button>';
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
    if (!rows.length) { host.innerHTML = '<p class="text-muted">' + tr('当前筛选下暂无数据') + '</p>'; return; }
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
    });
    var defs = '', body = '';
    if (days.length < 2) {
      // 单日：面积退化，退回堆叠柱
      var o1 = perDay[days[0]] || {}, yBase1 = P.t + ih;
      pvs.forEach(function (p) {
        var v = N((o1[p] || {})[curMetric]);
        if (!v) return;
        var bh = Math.round(ih * v / ymax);
        var tip = days[0] + '\n' + pvLabel(p) + '\n请求 ' + fmtI((o1[p] || {}).req || 0) + tr(' · 输入 ') + fmt((o1[p] || {}).inn) + '\n生成 ' + fmt((o1[p] || {}).out) + tr(' · 缓存读 ') + fmt((o1[p] || {}).ca);
        body += '<rect x="' + (P.l + (slot - bw) / 2) + '" y="' + (yBase1 - bh) + '" width="' + bw + '" height="' + Math.max(bh, 1) + '" fill="' + pvColor(p) + '" rx="2"><title>' + esc(tip) + '</title></rect>';
        yBase1 -= bh;
      });
    } else {
      // 渐变堆叠面积图（现代统计面板风格）：每来源一层线性渐变填充，列命中区承载 tooltip
      var cum = days.map(function () { return 0; });
      pvs.forEach(function (p, si) {
        var top = cum.map(function (c, i) { return c + N(((perDay[days[i]] || {})[p] || {})[curMetric]); });
        var col = pvColor(p);
        defs += '<linearGradient id="udg' + si + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + col + '" stop-opacity="0.4"/><stop offset="100%" stop-color="' + col + '" stop-opacity="0.05"/></linearGradient>';
        var up = '', down = '';
        for (var i2 = 0; i2 < days.length; i2++) {
          var x = P.l + i2 * slot + slot / 2;
          up += (i2 ? 'L' : 'M') + x.toFixed(1) + ' ' + (P.t + ih - ih * top[i2] / ymax).toFixed(1);
          down = 'L' + x.toFixed(1) + ' ' + (P.t + ih - ih * cum[i2] / ymax).toFixed(1) + down;
        }
        body += '<path d="' + up + down + 'Z" fill="url(#udg' + si + ')" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>';
        cum = top;
      });
      days.forEach(function (k, di) {
        var o = perDay[k] || {}, req = 0, inn = 0, out2 = 0, ca = 0;
        pvs.forEach(function (p) { var m = o[p] || {}; req += m.req || 0; inn += N(m.inn); out2 += N(m.out); ca += N(m.ca); }); // 该天缺某来源时字段 undefined，NaN 会经 fmt 显示成 0 —— 与 req 同款保护
        var tip = k + '\n请求 ' + fmtI(req) + tr(' · 输入 ') + fmt(inn) + '\n生成 ' + fmt(out2) + tr(' · 缓存读 ') + fmt(ca);
        body += '<rect x="' + (P.l + di * slot) + '" y="' + P.t + '" width="' + slot + '" height="' + ih + '" fill="transparent"><title>' + esc(tip) + '</title></rect>';
      });
    }
    host.innerHTML = '<svg width="' + w + '" height="' + H + '" role="img" aria-label="每日用量趋势（按来源堆叠）"><desc>按天按来源堆叠展示 ' + days.length + ' 天数据</desc><defs>' + defs + '</defs>' + out + body + '</svg>';
    var total = agg(rows);
    $('ud-trend-readout').textContent = tr('当前指标合计：请求数 ') + fmtI(total.req) + tr(' · 输入 ') + fmt(total.inn) + tr(' · 生成 ') + fmt(total.out) + tr(' · 缓存读 ') + fmt(total.ca);
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
    $('ud-daily-wrap').innerHTML = '<h3 style="margin-top:18px">' + tr('每日明细') + '</h3><div class="table-responsive" style="max-height:420px;overflow:auto"><table class="table table-sm"><thead><tr><th>' + tr('日期') + '</th><th class="text-end">' + tr('请求') + '</th><th class="text-end">' + tr('输入') + '</th><th class="text-end">' + tr('生成') + '</th><th class="text-end">' + tr('缓存读') + '</th><th class="text-end">' + tr('缓存命中') + '</th><th class="text-end">' + tr('生成速率') + '</th></tr></thead><tbody>' + dayRows.join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:18px">' + tr('每月汇总') + '</h3><div class="table-responsive"><table class="table table-sm"><thead><tr><th>' + tr('月份') + '</th><th class="text-end">' + tr('请求') + '</th><th class="text-end">' + tr('输入') + '</th><th class="text-end">' + tr('生成') + '</th><th class="text-end">' + tr('缓存读') + '</th><th class="text-end">' + tr('缓存命中') + '</th>' + (costOn ? '<th class="text-end">折算成本</th>' : '') + '</tr></thead><tbody>' + mRows + '</tbody></table></div>';
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
      if (st.s >= 0) sf.textContent = tr('会话：') + (TL[st.s] ? TL[st.s].slice(0, 24) : '#' + st.s) + ' ✕';
    }
    var df = $('ud-day-filter');
    if (df) {
      df.hidden = !st.day;
      if (st.day) df.textContent = tr('日期：') + st.day + ' ✕';
    }
    var pf = $('ud-proj-filter');
    if (pf) {
      pf.hidden = !st.proj;
      if (st.proj) {
        var base = baseName(st.proj);
        pf.textContent = tr('项目：') + base + ' ✕';
      }
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
    renderProjects(rows);
    renderBlocks(rows);
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
  fillSelect($('ud-f-pv'), tr('全部来源'), PV.map(function (p, i) { return { v: i, label: pvLabel(i) + ' (' + pvTag(i) + ')' }; }));
  fillSelect($('ud-f-model'), tr('全部模型'), MD.map(function (m, i) { return { v: i, label: String(m) }; }));
  if (PRICE && Object.keys(PRICE).length) { $('ud-cost-wrap').hidden = false; }
  (function () {
    var sf = $('ud-sess-filter');
    if (sf) sf.addEventListener('click', function () { st.s = -1; page = 1; sessExp = -1; detExp = -1; apply(); });
  })();
  (function () {
    var df = $('ud-day-filter');
    if (df) df.addEventListener('click', function () { st.day = null; page = 1; sessExp = -1; detExp = -1; apply(); });
  })();
  (function () {
    var pf = $('ud-proj-filter');
    if (pf) pf.addEventListener('click', function () { st.proj = null; page = 1; sessExp = -1; detExp = -1; apply(); });
  })();
  $('ud-f-pv').addEventListener('change', function () { st.p = +this.value; page = 1; sessExp = -1; detExp = -1; apply(); });
  $('ud-f-model').addEventListener('change', function () { st.m = +this.value; page = 1; sessExp = -1; detExp = -1; apply(); });
  // 文本筛选：200ms 防抖（大数据集下每次按键全量 filter）
  var qTimer = null;
  $('ud-f-q').addEventListener('input', function () {
    clearTimeout(qTimer);
    var v = this.value;
    qTimer = setTimeout(function () { st.q = v; page = 1; sessExp = -1; detExp = -1; apply(); }, 200);
  });
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
    btn.textContent = tr('同步中…');
    if (window.__USAGE_SERVE__) {
      fetch('/api/sync-prices', { method: 'POST' }).then(function () { location.reload(); }).catch(function () {
        btn.textContent = tr('同步失败'); btn.disabled = false;
      });
      return;
    }
    var zc = window.zcode || null;
    var reset = function (t) { btn.textContent = t; setTimeout(function () { btn.textContent = tr('同步价格'); btn.disabled = false; }, 3000); };
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
    return '<tr data-m="' + esc(m) + '"><td class="text-nowrap">' + esc(m) + (used ? ' <span class="ud-tag">' + tr('当前用量') + '</span>' : '') + '</td>' +
      '<td class="ud-mgr-t"><input data-k="in" value="' + esc(e.in) + '" inputmode="decimal"></td>' +
      '<td class="ud-mgr-t"><input data-k="out" value="' + esc(e.out) + '" inputmode="decimal"></td>' +
      '<td class="ud-mgr-t"><input data-k="cache" value="' + esc(e.cache) + '" inputmode="decimal"></td>' +
      '<td class="ud-mgr-t"><input data-k="ctxOverride" value="' + esc(e.ctxOverride || '') + '" placeholder="' + (e.ctx ? esc(String(e.ctx)) : tr('自动')) + '" title="' + tr('上下文窗口 token 数，留空按模型自动检测（水印曲线用）') + '" inputmode="numeric"></td>' +
      '<td class="text-nowrap"><button type="button" class="btn ud-mgr-act ud-mgr-save" style="margin:0">' + tr('保存') + '</button> <button type="button" class="btn ud-mgr-act ud-mgr-del" style="margin:0" title="' + tr('删除该模型价') + '">' + tr('删除') + '</button></td></tr>';
  }
  function swRow(id, name, desc, on) {
    return '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">' + name + '</div><div class="ud-mgr-sub" style="margin:1px 0 0">' + desc + '</div></div>' +
      '<input type="checkbox" class="form-check-input" id="' + id + '"' + (on ? ' checked' : '') + '></div>';
  }
  function vendorRow(id, name, desc) {
    var v = (mgrState.vendors || {})[id] || {};
    return '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">' + name + (v.configured ? ' <span class="ud-tag">' + tr('已配置') + '</span>' : '') + '</div><div class="ud-mgr-sub" style="margin:1px 0 0">' + desc + '</div></div>' +
      '<input type="password" class="form-control form-control-sm" id="ud-vk-' + id + '" placeholder="' + (v.configured ? tr('已配置 · 输入新值更换') : tr('未配置')) + '" style="width:190px" autocomplete="off" spellcheck="false"></div>';
  }
  function renderMgr() {
    var body = $('ud-mgr-body');
    var p = mgrState.prices, b = mgrState.budget || {}, sw = mgrState.switches || {};
    // 语言回显：文件权威值（D.userLang）优先，localStorage 是本 origin 的旧显式选择
    var langPref = (function () {
      var ul = ''; try { ul = String(window.__USAGE_LANG__ || (typeof DATA === 'object' && DATA && DATA.userLang) || ''); } catch (e) {}
      if (ul === 'zh' || ul === 'en') return ul;
      try { return localStorage.getItem('ud-lang') || ''; } catch (e) { return ''; }
    })();
    var models = Object.keys(p.models || {});
    var used = {};
    frows(false).forEach(function (r) { used[String(MD[r[2]] || '').toLowerCase()] = 1; });
    var hit = models.filter(function (m) { return mgrState.q ? m.indexOf(mgrState.q) >= 0 : (used[m.toLowerCase()] || mgrState.builtins.indexOf(m) >= 0); });
    var list = (mgrState.q ? models.filter(function (m) { return m.indexOf(mgrState.q) >= 0; }) : hit).slice(0, 60);
    var tsMode = sw.turnstats || 'off';
    body.innerHTML =
      '<div class="ud-mgr-h">' + tr('成本单价（元 / 每百万 token）') + '</div>' +
      '<div class="ud-mgr-sub">' + tr('GLM 5.3 系为智谱官网权威价；其余来自 models.dev（USD 按 7.2 换算）。默认列出当前用量相关模型，搜索可查全量；修改保存后按新价重算。') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input class="form-control form-control-sm" id="ud-mgr-q" placeholder="' + tr('搜索模型…') + '" value="' + esc(mgrState.q) + '" style="max-width:260px"><span class="text-small text-muted">' + list.length + ' / ' + models.length + tr(' 个模型') + (p.modelsSlim && p.modelsTotal != null ? tr('（全量 ') + p.modelsTotal + tr('）') : '') + (list.length >= 60 ? tr('（仅显示前 60）') : '') + '</span></div>' +
      '<div class="table-responsive" id="ud-mgr-wrap" style="max-height:280px;overflow:auto;border:1px solid var(--border);border-radius:10px"><table class="table table-sm" style="margin:0"><thead><tr><th>' + tr('模型') + '</th><th>' + tr('输入') + '</th><th>' + tr('输出') + '</th><th>' + tr('缓存读') + '</th><th title="' + tr('上下文窗口 token 数，留空自动检测') + '">' + tr('窗口') + '</th><th></th></tr></thead><tbody id="ud-mgr-rows">' +
      list.map(function (m) { return mgrRow(m, p.models[m], !mgrState.q && used[m.toLowerCase()]); }).join('') +
      '</tbody></table></div>' +
      '<div class="ud-mgr-card" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="text-small text-muted">' + tr('新增模型价：') + '</span><input class="form-control form-control-sm" id="ud-mgr-newname" placeholder="' + tr('模型名（与请求记录一致）') + '" style="width:230px"><input class="form-control form-control-sm" id="ud-mgr-newin" placeholder="' + tr('输入') + '" style="width:76px" inputmode="decimal"><input class="form-control form-control-sm" id="ud-mgr-newout" placeholder="' + tr('输出') + '" style="width:76px" inputmode="decimal"><input class="form-control form-control-sm" id="ud-mgr-newcache" placeholder="' + tr('缓存读') + '" style="width:76px" inputmode="decimal"><button type="button" class="btn" id="ud-mgr-add" style="margin:0;padding:2px 10px;font-size:12px">' + tr('添加') + '</button></div>' +
      '<div class="ud-mgr-h">' + tr('通用') + '</div>' +
      '<div class="ud-mgr-card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label class="text-small text-muted">' + tr('USD→CNY 汇率') + '<input class="form-control form-control-sm" id="ud-mgr-rate" value="' + (p.usdCny == null ? '' : p.usdCny) + '" placeholder="默认 7.2" style="width:90px;margin-left:4px" inputmode="decimal"></label>' +
      '<label class="form-check form-switch text-small" style="margin:0">' + tr('每日自动同步模型价') + '<input type="checkbox" class="form-check-input" id="ud-sw-autosync"' + (p.autoSync !== false ? ' checked' : '') + ' style="margin-left:6px"></label>' +
      '<button type="button" class="btn" id="ud-mgr-gsave" style="margin:0;padding:2px 10px;font-size:12px">' + tr('保存通用') + '</button>' +
      '</div>' +
      '<div class="ud-mgr-h">' + tr('预算（折算金额，超 80% 黄色进度、100% 红色）') + '</div>' +
      '<div class="ud-mgr-card" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label class="text-small text-muted">' + tr('日预算 ¥') + '<input class="form-control form-control-sm" id="ud-mgr-bd" value="' + (N(b.daily) || '') + '" style="width:100px;margin-left:4px" inputmode="decimal"></label>' +
      '<label class="text-small text-muted">' + tr('月预算 ¥') + '<input class="form-control form-control-sm" id="ud-mgr-bm" value="' + (N(b.monthly) || '') + '" style="width:100px;margin-left:4px" inputmode="decimal"></label>' +
      '<button type="button" class="btn" id="ud-mgr-bsave" style="margin:0;padding:2px 10px;font-size:12px">' + tr('保存预算') + '</button>' +
      '</div>' +
      '<div class="ud-mgr-h">' + tr('通知（macOS 系统通知，全部本地计算、零模型开销）') + '</div>' +
      '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">界面语言 / Language</div><div class="ud-mgr-sub" style="margin:1px 0 0">' + tr('语言选择保存到本地文件，全面板共享：本地面板与生成页立即生效；侧栏面板重新打开后生效') + '</div></div>' +
      '<select class="form-select form-select-sm" id="ud-mgr-lang" style="width:auto;flex:none">' +
      '<option value=""' + (langPref === '' ? ' selected' : '') + '>跟随系统 / Auto</option>' +
      '<option value="zh"' + (langPref === 'zh' ? ' selected' : '') + '>中文</option>' +
      '<option value="en"' + (langPref === 'en' ? ' selected' : '') + '>English</option>' +
      '</select></div>' +
      swRow('ud-sw-permission', tr('权限等待提醒'), tr('Agent 弹出批准请求时通知你——挂机跑长任务不漏确认'), sw.permissionAlerts === true) +
      swRow('ud-sw-budget', tr('预算 / 燃烧告警'), tr('日折算成本达预算 80% / 100% 时提醒；今日用量超近 7 天日均 50% 也会提示'), sw.budgetAlerts !== false) +
      '<div class="ud-sw-row"><div><div style="font-size:13px;font-weight:500">' + tr('每轮用量统计') + '</div><div class="ud-mgr-sub" style="margin:1px 0 0">' + tr('每轮回合结束弹通知显示本轮速率 / 缓存率 / 耗时（不进入对话上下文）。选「关」时统计仍显示在侧栏面板顶部横幅') + '</div></div>' +
      '<select class="form-select form-select-sm" id="ud-sw-turnstats" style="width:auto;flex:none">' +
      '<option value="off"' + (tsMode === 'off' ? ' selected' : '') + '>' + tr('关') + '</option>' +
      '<option value="notify"' + (tsMode === 'notify' ? ' selected' : '') + '>' + tr('系统通知（推荐）') + '</option>' +
      '<option value="inject"' + (tsMode === 'inject' ? ' selected' : '') + '>' + tr('对话内统计行（约 0.3k token/轮）') + '</option>' +
      '</select></div>' +
      '<div class="ud-mgr-h">' + tr('厂商配额（可选）') + '</div>' +
      '<div class="ud-mgr-sub" style="margin:-2px 0 6px">' + tr('在总览页聚合显示各厂商套餐 / 额度用量。GLM 无需配置（自动读客户端日志）；') + tr('以下 Key 仅发送到对应厂商官方域名做只读查询，保存在本地') + ' <code>~/.zcode/usage-vendors.json</code>' + tr('（权限 0600）') + '</div>' +
      vendorRow('deepseek', 'DeepSeek', tr('官方账户余额')) +
      vendorRow('kimi', 'Kimi（Moonshot）', tr('5 小时 / 周窗口用量')) +
      vendorRow('openrouter', 'OpenRouter', tr('预付额度使用情况')) +
      vendorRow('minimax', 'MiniMax', tr('Token Plan 窗口用量')) +
      '<button type="button" class="btn" id="ud-mgr-vsave" style="margin:6px 0 0;padding:2px 10px;font-size:12px">' + tr('保存 Key') + '</button>' +
      '<div class="ud-mgr-sub" style="margin-top:8px">' + tr('权限提醒与每轮统计依赖会话钩子，修改后重开会话生效；预算告警立即生效。') + '</div>';
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
        var payload = { model: m, in: get('in'), out: get('out'), cache: get('cache'), ctxOverride: get('ctxOverride') };
        priceSave({ url: '/api/prices/set', data: payload, tool: { price: payload } }).then(afterPriceSave);
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
    // 界面语言：localStorage 持久化（'' = 跟随系统）；serve 模式整页 reload 即时生效，
    // 侧栏/file 模式 boot 不可重入，提示重开面板生效
    $('ud-mgr-lang').addEventListener('change', function () {
      var v = this.value; // '' 跟随系统 / zh / en
      if (window.__USAGE_SERVE__) {
        // 本地面板：文件与 localStorage 同步写，reload 后判定链拿到一致的新值
        try { localStorage.setItem('ud-lang', v); } catch (e) {}
        postJSON('/api/lang', { language: v }).catch(function () {}).then(function () { location.reload(); });
      } else if (window.zcode && typeof window.zcode.callTool === 'function') {
        // 侧栏：持久化到文件（跨面板权威，重开面板后 resources/read 重新生成即生效）；
        // 清本 WebView 的 localStorage 残留，防旧选择压制新文件值
        try { localStorage.removeItem('ud-lang'); } catch (e) {}
        settingsCall({ language: v }).catch(function () {});
        var tip = document.createElement('span');
        tip.className = 'ud-tag';
        tip.textContent = tr('已保存，重新打开面板后生效');
        this.replaceWith(tip);
      } else {
        // 生成页（file://）：localStorage 同源持久，直接刷新生效
        try { localStorage.setItem('ud-lang', v); } catch (e) {}
        location.reload();
      }
    });
    // 厂商配额 Key：只提交有输入的项；已配置项保持输入框为空即不变更
    $('ud-mgr-vsave').addEventListener('click', function () {
      var keys = {};
      ['deepseek', 'kimi', 'openrouter', 'minimax'].forEach(function (id) {
        var el = $('ud-vk-' + id);
        if (el && el.value.trim()) keys[id] = el.value.trim();
      });
      if (!Object.keys(keys).length) return;
      this.disabled = true;
      this.textContent = tr('保存中…');
      var btn = this;
      priceSave({ url: '/api/vendors/set', data: keys, tool: { vendorKeys: keys } }).then(function (sc) {
        if (sc && sc.vendors) mgrState.vendors = sc.vendors;
        renderMgr(); // 重建表单：清空已输入的 Key 明文，刷新「已配置」徽标
        var okEl = document.createElement('span');
        okEl.className = 'ud-tag';
        okEl.textContent = tr('已保存');
        btn.replaceWith(okEl);
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = tr('保存 Key');
      });
    });
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
    if (sc && sc.vendors) mgrState.vendors = sc.vendors; // Key 保存响应带回配置状态（不含明文）
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
  mgrState.builtins = ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'];
  $('ud-price-mgr').addEventListener('click', function () {
    mgrState.q = ''; // 重开弹框不残留上次搜索词（瘦身表按旧词过滤会得到空列表）
    $('ud-mgr-mask').hidden = false;
    var body = $('ud-mgr-body');
    var zc = window.zcode || null;
    function renderFrom(sc) {
      mgrState.prices = sc.prices || { currency: 'CNY', models: {} };
      mgrState.budget = sc.budget || {};
      mgrState.switches = sc.switches || {};
      if (sc.vendors) mgrState.vendors = sc.vendors;
      if (!st.budget) st.budget = mgrState.budget;
      renderMgr();
    }
    function loadServe() {
      body.innerHTML = '<p class="text-muted text-small">' + tr('加载中…') + '</p>';
      Promise.all([
        fetch('/api/prices').then(function (r) { return r.json(); }),
        fetch('/api/budget').then(function (r) { return r.json(); }),
        fetch('/api/switches').then(function (r) { return r.json(); }).catch(function () { return {}; }),
        fetch('/api/vendors').then(function (r) { return r.json(); }).catch(function () { return {}; })
      ]).then(function (rs) {
        renderFrom({ prices: rs[0], budget: rs[1], switches: rs[2] || {}, vendors: rs[3] || {} });
      });
    }
    if (window.__USAGE_SERVE__) { loadServe(); return; }
    // 侧栏（MCP App）：callTool 直调设置工具，不经模型
    if (zc && typeof zc.callTool === 'function') {
      body.innerHTML = '<p class="text-muted text-small">' + tr('加载中…') + '</p>';
      Promise.resolve(zc.callTool('usage_settings_get', {})).then(function (r) {
        renderFrom((r && r.structuredContent) || {});
      }).catch(function () { openPanelFallback(body, zc); });
      return;
    }
    openPanelFallback(body, zc);
  });
  function openPanelFallback(body, zc) {
    body.innerHTML =
      '<p class="text-small" style="margin:0 0 10px">' + tr('当前环境不支持面板内编辑。两种方式：') + '</p>' +
      '<ol class="text-small text-muted" style="margin:0 0 12px;padding-left:18px;line-height:1.9">' +
      '<li>' + tr('打开本地面板编辑（推荐，同样的界面）') + '</li>' +
      '<li>' + tr('直接编辑') + ' <code>~/.zcode/usage-prices.json</code>' + tr('（字段 in / out / cache，每百万 token）') + '</li></ol>' +
      '<button type="button" class="btn" id="ud-mgr-open-serve" style="margin:0 8px 0 0;padding:3px 14px;font-size:12px">' + tr('打开本地面板') + '</button>' +
      '<span class="text-small text-muted">' + tr('或运行') + ' <code>usage.sh serve</code></span>';
    var btn = $('ud-mgr-open-serve');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = tr('启动中…');
      var call = (zc && typeof zc.callTool === 'function')
        ? Promise.resolve(zc.callTool('open_full_panel', {}))
        : Promise.reject(new Error('no-calltool'));
      call.then(function () {
        btn.textContent = tr('已启动（浏览器将自动打开）');
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = tr('打开本地面板');
        alert(tr('启动失败：请在终端运行 usage.sh serve'));
      });
    });
  }
  $('ud-mgr-close').addEventListener('click', function () { $('ud-mgr-mask').hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('ud-mgr-mask').hidden) $('ud-mgr-mask').hidden = true; });
  $('ud-mgr-mask').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('ud-export-report').hidden = false;
  $('ud-export-report').addEventListener('click', function () {
    var btn = this;
    if (window.__USAGE_SERVE__) { location.href = '/report.html'; return; }
    // 侧栏（MCP App）禁止页面级导航（宿主会报 App page stopped）：
    // 确保本地 serve 面板运行后，交系统浏览器下载报表（Content-Disposition 附件）。
    btn.disabled = true;
    btn.textContent = tr('准备中…');
    var zc = window.zcode || null;
    var done = function () { setTimeout(function () { btn.disabled = false; btn.textContent = tr('导出报表'); }, 2500); };
    var call = (zc && typeof zc.callTool === 'function')
      ? Promise.resolve(zc.callTool('open_full_panel', {}))
      : Promise.reject(new Error('no-calltool'));
    call.then(function (r) {
      var base = ((r && r.structuredContent && r.structuredContent.url) || 'http://127.0.0.1:7741').replace(/\/$/, '');
      if (!(zc && typeof zc.openExternal === 'function')) { btn.textContent = tr('当前环境不支持导出'); return; }
      zc.openExternal({ href: base + '/report.html' });
      btn.textContent = tr('已交浏览器下载');
    }).catch(function () {
      btn.textContent = tr('导出失败（需本地面板）');
    }).then(done, done);
  });
  // 厂商配额卡（可选）：多厂商聚合，serve 走 /api/quota，侧栏经 callTool 直调 usage_quota。
  // 前端 60s 节流：面板每次刷新（切 tab/软刷新）都会进这里，避免频繁外网请求。
  (function () {
    var lastAt = 0;
    // GLM Coding Plan 积分峰谷（docs.bigmodel.cn/cn/coding-plan/overview，2026-10 核对）：
    // 工作日 14:00–18:00（UTC+8）按基础积分 1× 抵扣，其余时段 0.5×。法定节假日/调休周末不区分（无公开机器可读源）
    function glmPlanPeak(now) {
      var loc = new Date(now + 8 * 3600e3);
      var dow = loc.getUTCDay(), h = loc.getUTCHours();
      return dow >= 1 && dow <= 5 && h >= 14 && h < 18;
    }
    function render(j) {
      if (!j || !Array.isArray(j.vendors) || !j.vendors.length) return;
      var okCount = j.vendors.filter(function (v) { return v.ok; }).length;
      var host = $('ud-quota-card');
      if (!host) return;
      host.hidden = false;
      var html = '<h3 style="margin-top:16px">' + tr('厂商配额') + '</h3><div class="card" style="padding:4px 14px 10px">';
      j.vendors.forEach(function (v) {
        html += '<div style="margin:10px 0 0"><div style="display:flex;justify-content:space-between;align-items:baseline" class="text-small"><span style="font-weight:600">' + esc(v.name || v.id) + '</span>' +
          (v.stale ? '<span class="ud-tag">观测滞后</span>' : (!v.ok ? '<span class="text-muted">不可用</span>' : '')) + '</div>';
        if (!v.ok && v.error) html += '<div class="text-muted" style="font-size:11px;margin-top:1px">' + esc(String(v.error).slice(0, 110)) + '</div>';
        if (v.id === 'glm' && v.ok) {
          var peak = glmPlanPeak(Date.now());
          html += '<div style="display:flex;justify-content:space-between;gap:4px 12px;flex-wrap:wrap;margin:4px 0 0" class="text-small"><span style="flex:none">' + tr('积分时段') + '</span><span class="text-muted" style="text-align:right">' +
            (peak ? tr('高峰 1× · 18:00 后转半价') : tr('非高峰 0.5× · 工作日 14:00–18:00 为高峰')) + '</span></div>';
        }
        (v.items || []).forEach(function (it) {
          if (it.pct != null) {
            var pct = Math.max(0, Math.min(100, Math.round(it.pct)));
            html += '<div style="margin:6px 0"><div style="display:flex;justify-content:space-between" class="text-small"><span>' + esc(it.label || tr('配额')) + '</span><span class="tabular-nums text-muted">' + tr('已用 ') + pct + '%' + (it.resets ? ' · ' + esc(String(it.resets)) + tr(' 重置') : '') + '</span></div>' +
              '<div class="ud-budget-bar' + (pct >= 80 ? ' ud-over' : pct >= 60 ? ' ud-warn' : '') + '"><i style="width:' + pct + '%"></i></div></div>';
          } else if (it.text != null) {
            html += '<div style="display:flex;justify-content:space-between;margin:6px 0" class="text-small"><span>' + esc(it.label || '') + '</span><span class="tabular-nums text-muted">' + esc(String(it.text)) + '</span></div>';
          }
        });
        html += '</div>';
      });
      if (!okCount) html += '<div class="ud-mgr-sub" style="margin-top:8px">在设置里填写 DeepSeek / Kimi / OpenRouter / MiniMax 的 API Key 可启用更多厂商；GLM 支持零密钥（客户端日志源）。</div>';
      host.innerHTML = html + '</div>';
    }
    function load() {
      if (Date.now() - lastAt < 60000) return;
      lastAt = Date.now();
      if (window.__USAGE_SERVE__) fetch('/api/quota').then(function (r) { return r.json(); }).then(render).catch(function () {});
      else if (window.zcode && typeof window.zcode.callTool === 'function') {
        window.zcode.callTool('usage_quota', {}).then(function (r) { render(r && r.structuredContent); }).catch(function () {});
      }
    }
    load();
  })();
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
  // 页签切换（bash 生成版不经过 serve 壳的 TAB_JS，这里内嵌同款逻辑；缺了页签就是死按钮）
  Array.prototype.forEach.call(document.querySelectorAll('.nav-pills [role=tab]'), function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.nav-pills [role=tab]'), function (x) {
        x.classList.toggle('active', x === t);
        x.setAttribute('aria-selected', String(x === t));
      });
      Array.prototype.forEach.call(document.querySelectorAll('[role=tabpanel]'), function (p) {
        p.hidden = (p.id !== t.getAttribute('aria-controls'));
      });
    });
  });
  // 支持 #tab hash 定位（本地面板跳转：#trend/#sessions/#detail/#errors）
  var h = (location.hash || '').replace('#', '');
  if (h) {
    var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-' + h + '"]');
    if (btn) btn.click();
  }
  // 「本轮」兜底：从已加载数据聚合最新一轮（turn_id 相同的成功请求群，口径对齐 turn-stats.mjs：
  // 速率 = 生成 / (总耗时 − 首字)），不依赖 turnstats 钩子与资源订阅——
  // 侧栏订阅失败、钩子未开、file 版静默等任何情况下横幅都有数据可显；
  // 实时通道（订阅/轮询）拿到数据后会覆盖此兜底
  window.__udTurnFallback = function () {
    if (!R.length) return '';
    var lastTs = 0, lastTurn = null;
    R.forEach(function (r) { if (r[1] > lastTs) { lastTs = r[1]; lastTurn = r[14]; } });
    if (lastTurn == null || lastTurn === '') return ''; // 老库无 turn_id：无法分轮
    var reqs = 0, miss = 0, ca = 0, gen = 0, genMs = 0, ttft = 0, durMs = 0;
    R.forEach(function (r) {
      if (r[14] !== lastTurn || r[8] !== 0) return;
      reqs++;
      miss += Math.max(0, N(r[4]) - N(r[6]));
      ca += N(r[6]); gen += N(r[5]); durMs += N(r[7]);
      genMs += Math.max(1, N(r[7]) - N(r[11]));
      var t = N(r[11]); if (t > 0 && (ttft === 0 || t < ttft)) ttft = t;
    });
    if (!reqs) return '';
    var parts = [tr('本轮用量')];
    if (genMs > 0) parts.push('⚡ ' + Math.round(gen / genMs * 1000) + ' tok/s');
    parts.push(tr('输入') + ' ' + fmt(miss + ca) + ' tok (' + tr('缓存') + ' ' + (miss + ca ? Math.round(ca / (miss + ca) * 100) : 0) + '%)');
    if (gen > 0) parts.push(tr('生成') + ' ' + fmtI(gen) + ' tok');
    parts.push(fmtI(reqs) + ' ' + tr('次'));
    if (durMs > 0) parts.push(fmtDur(durMs));
    return parts.join(' · ') + ' (' + tr('截至') + ' ' + pad(new Date(lastTs).getHours()) + ':' + pad(new Date(lastTs).getMinutes()) + ')';
  };
  // 局部数据刷新（serve 手动同步/自动刷新）：只替换数据与派生引用，闭包状态、事件监听器、
  // 筛选与展开态全部保留——骨架不重建、无白屏。供 serve 注入段调用；返回 false 则调用方回退整页刷新。
  window.__udRefreshData = function (D2) {
    if (!D2 || typeof D2 !== 'object') return false;
    // 身份快照：索引型状态（来源/模型/会话筛选与展开）必须在新快照上按 id 找回——
    // session id 是随机 UUID、providers/models 按 id 排序编号，新条目插队会让纯索引漂移到别的对象
    var oldSID = (typeof D === 'object' && D && D.sessionIds) ? D.sessionIds : [];
    var idP = PV[st.p], idM = MD[st.m], idS = oldSID[st.s], expSid = sessExp >= 0 ? oldSID[sessExp] : null;
    normalizeModels(D2); // 与 boot 同款模型归一，防止大小写变体在刷新后重新分裂
    D = D2; // 参数重赋值：闭包内所有 D.xxx 访问自动跟随新快照
    PV = D.providers || []; MD = D.models || []; TL = D.sessions || []; R = D.rows || [];
    PVNAME = D.providerNames || {};
    PVNAME_PV = PV.map(function (id) { return PVNAME[id] || id; });
    TOOLS = D.tools || []; SD = D.sessionDirs || [];
    CTXMIX = D.ctxMix || []; SAGENTS = D.sessionAgents || [];
    maxTs = 0; R.forEach(function (r) { if (r[1] > maxTs) maxTs = r[1]; }); // 近 7/30 天窗口下界跟随新数据
    cmpMap = {}; toolsMap = {};
    (D.compactions || []).forEach(function (c) { cmpMap[c[0]] = { cnt: c[1], pre: c[2], ts: c[3] || [], trg: c[4] || [] }; });
    (D.sessionTools || []).forEach(function (t) { (toolsMap[t[0]] || (toolsMap[t[0]] = [])).push([t[1], t[2], t[3]]); });
    var np = D.projectMap || {};
    Object.keys(PMAP).forEach(function (k) { delete PMAP[k]; });
    Object.keys(np).forEach(function (k) { PMAP[k] = np[k]; });
    var p2 = (D.prices && typeof D.prices === 'object') ? D.prices : null;
    if (p2 && Object.keys(p2).length) {
      PRICE = p2;
      PMODELS = PRICE.models && typeof PRICE.models === 'object' ? PRICE.models : PRICE;
      var c2 = PRICE.currency;
      CURSYM = { USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥' }[c2] || (c2 ? c2 + ' ' : '$');
      if (Object.keys(PRICE).length) $('ud-cost-wrap').hidden = false;
    }
    if (!D.session) {
      // 全量仪表盘：重填来源/模型选项（新快照可能新增），并按 id 找回原选择
      fillSelect($('ud-f-pv'), tr('全部来源'), PV.map(function (x, i) { return { v: i, label: pvLabel(i) + ' (' + pvTag(i) + ')' }; }));
      fillSelect($('ud-f-model'), tr('全部模型'), MD.map(function (m, i) { return { v: i, label: String(m) }; }));
      st.p = idP != null ? PV.indexOf(idP) : -1;
      st.m = idM != null ? MD.indexOf(idM) : -1;
      $('ud-f-pv').value = String(st.p);
      $('ud-f-model').value = String(st.m);
    }
    var nsid = D.sessionIds || [];
    st.s = idS != null ? nsid.indexOf(idS) : -1;
    sessExp = expSid != null ? nsid.indexOf(expSid) : -1;
    detExp = -1; // 页行索引无稳定身份，刷新后诚实收起
    // 来源配色按新 token 排序重算（pvColor 闭包引用 pvOrder）
    var pvTot2 = PV.map(function (p, i) { var t = 0; R.forEach(function (r) { if (r[3] === i) t += N(r[4]) + N(r[5]); }); return { i: i, t: t }; })
      .sort(function (a, b) { return b.t - a.t; });
    pvOrder = pvTot2.map(function (x) { return x.i; });
    apply();
    return true;
  };
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
  // 实时横幅文本由 turn-stats.mjs 服务端生成（中文）；英文界面下按其固定格式重写
  function enTurn(t) {
    if (I18N_LANG !== 'en') return t;
    var u = function (n) { return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)); };
    return t
      .replace(/^本轮用量：?/, 'This turn: ')
      .replace(/（失败 (\d+)）/g, ' ($1 failed)')
      .replace(/首字 /g, 'TTFT ')
      .replace(/输入 /g, 'in ')
      .replace(/生成 /g, 'out ')
      .replace(/（缓存 /g, ' (cache ')
      .replace(/）/g, ')')
      .replace(/([\d.]+)亿/g, function (_, n) { return u(parseFloat(n) * 1e8); })
      .replace(/([\d.]+)万/g, function (_, n) { return u(parseFloat(n) * 1e4); })
      .replace(/ 次请求/g, ' reqs')
      .replace(/本轮 ([\d.]+)s/g, 'wall $1s')
      .replace(/会话累计 /g, 'session total ');
  }
  function render(text) {
    text = String(text || '').trim();
    if (!text) {
      // 实时通道无数据（turnstats 未开/无本轮标记/读取失败）：退回已加载数据的兜底聚合
      text = typeof window.__udTurnFallback === 'function' ? window.__udTurnFallback() : '';
      if (!text) { el.hidden = true; return; }
    }
    var d = new Date();
    var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
    text = enTurn(text);
    el.innerHTML = '<span>' + text.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }) +
      '</span><span class="ud-turn-t">' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ' ' + tr('更新') + '</span>';
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
  } else {
    render(''); // file 版（/usage-ui）：无实时通道，直接显示兜底
  }
})();
</script>
</div>
UD_TAIL
    } > "$out"
    echo "已生成用量界面：$out"
}

