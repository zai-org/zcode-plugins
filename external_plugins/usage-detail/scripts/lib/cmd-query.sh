# 只读查询子命令实现（由入口 usage.sh source）

# 用量总览：累计 + 今日
cmd_summary() {
    q "SELECT count(*) AS 总请求数,
              datetime(min(started_at)/1000,'unixepoch','localtime') AS 首次请求,
              datetime(max(started_at)/1000,'unixepoch','localtime') AS 最近请求,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token
       FROM model_usage;"
    echo
    echo "—— 今日 ——"
    q "SELECT count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(CASE WHEN status<>'completed' THEN 1 ELSE 0 END) AS 失败数
       FROM model_usage
       WHERE date(started_at/1000,'unixepoch','localtime') = date('now','localtime');"
}

# 按来源（官方套餐 / 自定义接入）汇总
cmd_providers() {
    q "SELECT $PV_LABEL AS 来源,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token,
              round(sum(cache_read_input_tokens)*100.0/max(sum(input_tokens),1),1) AS 缓存率,
              datetime(min(started_at)/1000,'unixepoch','localtime') AS 首次,
              datetime(max(started_at)/1000,'unixepoch','localtime') AS 最近
       FROM model_usage GROUP BY provider_id ORDER BY sum(computed_total_tokens) DESC;"
}

# 5 小时窗口用量
cmd_blocks() {
    # 5 小时窗口：相邻请求间隔 >= 5h 即开启新窗口（与 ccusage 口径一致）。末尾窗口若仍在 5h 内即为进行中。
    q "WITH s AS (SELECT started_at, input_tokens, output_tokens+reasoning_tokens AS gen,
                         LAG(started_at) OVER (ORDER BY started_at) AS prev FROM model_usage),
            b AS (SELECT started_at, input_tokens, gen,
                         SUM(CASE WHEN prev IS NULL OR started_at-prev>=18000000 THEN 1 ELSE 0 END) OVER (ORDER BY started_at) AS blk FROM s)
       SELECT blk AS 窗口,
              datetime(min(started_at)/1000,'unixepoch','localtime') AS 开始,
              datetime(max(started_at)/1000,'unixepoch','localtime') AS 最近活动,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(gen) AS 生成token,
              CASE WHEN unixepoch()*1000 - max(started_at) < 18000000 THEN '进行中' ELSE '已结束' END AS 状态
       FROM b GROUP BY blk ORDER BY min(started_at) DESC LIMIT 15;"
}

# 按月汇总
cmd_months() {
    q "SELECT strftime('%Y-%m', started_at/1000,'unixepoch','localtime') AS 月份,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token,
              count(DISTINCT date(started_at/1000,'unixepoch','localtime')) AS 活跃天
       FROM model_usage GROUP BY 月份 ORDER BY 月份 DESC;"
}

# 按项目目录汇总
cmd_projects() {
    n=$(num_arg 15 "${2:-}")
    q "SELECT s.directory AS 项目目录,
              count(*) AS 请求数,
              sum(m.input_tokens) AS 输入token,
              sum(m.output_tokens+m.reasoning_tokens) AS 生成token,
              datetime(max(m.started_at)/1000,'unixepoch','localtime') AS 最后活动
       FROM model_usage m JOIN session s ON s.id = m.session_id
       GROUP BY s.directory ORDER BY sum(m.input_tokens+m.output_tokens+m.reasoning_tokens) DESC LIMIT $n;"
}

# 工具调用统计
cmd_tools() {
    n=$(num_arg 15 "${2:-}")
    q "SELECT tool_name AS 工具,
              count(*) AS 调用,
              sum(status<>'completed') AS 失败,
              CAST(round(avg(duration_ms)) AS int) AS 平均耗时ms,
              datetime(max(started_at)/1000,'unixepoch','localtime') AS 最近调用
       FROM tool_usage GROUP BY tool_name ORDER BY 调用 DESC LIMIT $n;"
}

# 最近 N 条逐条明细
cmd_recent() {
    n=$(num_arg 20 "${2:-}")
    q "SELECT datetime(m.started_at/1000,'unixepoch','localtime') AS 时间,
              substr(s.title,1,28) AS 会话,
              m.model_id AS 模型,
              $PV_LABEL AS 来源,
              CASE m.query_source WHEN 'subagent' THEN '子代理' WHEN 'main_turn' THEN '主会话' ELSE '系统' END AS 类型,
              m.input_tokens AS 输入,
              m.output_tokens+m.reasoning_tokens AS 生成,
              m.cache_read_input_tokens AS 缓存读,
              m.cache_creation_input_tokens AS 缓存写,
              m.duration_ms AS 耗时ms,
              m.status AS 状态
       FROM model_usage m LEFT JOIN session s ON s.id = m.session_id
       ORDER BY m.started_at DESC LIMIT $n;"
}

# 某天逐条明细
cmd_day() {
    d="${2:-$(date +%F)}"
    [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "日期格式应为 YYYY-MM-DD：$d" >&2; exit 1; }
    q "SELECT datetime(m.started_at/1000,'unixepoch','localtime') AS 时间,
              substr(s.title,1,28) AS 会话,
              m.model_id AS 模型,
              $PV_LABEL AS 来源,
              CASE m.query_source WHEN 'subagent' THEN '子代理' WHEN 'main_turn' THEN '主会话' ELSE '系统' END AS 类型,
              m.input_tokens AS 输入,
              m.output_tokens+m.reasoning_tokens AS 生成,
              m.cache_read_input_tokens AS 缓存读,
              m.cache_creation_input_tokens AS 缓存写,
              m.duration_ms AS 耗时ms,
              m.status AS 状态
       FROM model_usage m LEFT JOIN session s ON s.id = m.session_id
       WHERE date(m.started_at/1000,'unixepoch','localtime')='$d'
       ORDER BY m.started_at;"
}

# 最近 N 天按天汇总
cmd_days() {
    n=$(num_arg 14 "${2:-}")
    q "SELECT date(started_at/1000,'unixepoch','localtime') AS 日期,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token,
              CAST(round(avg(duration_ms)) AS int) AS 平均耗时ms
       FROM model_usage WHERE status='completed'
       GROUP BY 日期 ORDER BY 日期 DESC LIMIT $n;"
}

# 会话用量排行
cmd_sessions() {
    n=$(num_arg 15 "${2:-}")
    q "SELECT substr(s.title,1,32) AS 会话,
              count(*) AS 请求数,
              sum(m.input_tokens) AS 输入token,
              sum(m.output_tokens+m.reasoning_tokens) AS 生成token,
              sum(CASE WHEN m.query_source='subagent' THEN 1 ELSE 0 END) AS 子代理请求,
              round(sum(m.cache_read_input_tokens)*100.0/max(sum(m.input_tokens),1),1) AS 缓存率,
              datetime(max(m.started_at)/1000,'unixepoch','localtime') AS 最后活动
       FROM model_usage m JOIN session s ON s.id = m.session_id
       GROUP BY m.session_id
       ORDER BY sum(m.input_tokens+m.output_tokens+m.reasoning_tokens) DESC LIMIT $n;"
}

# 按模型汇总
cmd_models() {
    q "SELECT max(model_id) AS 模型,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token,
              round(sum(cache_read_input_tokens)*100.0/max(sum(input_tokens),1),1) AS 缓存率
       FROM model_usage WHERE status='completed'
       GROUP BY lower(model_id) ORDER BY sum(computed_total_tokens) DESC;"
}

# 最近失败/取消请求
cmd_errors() {
    n=$(num_arg 10 "${2:-}")
    q "SELECT datetime(started_at/1000,'unixepoch','localtime') AS 时间,
              model_id AS 模型,
              status AS 状态,
              coalesce(error_code,'-') AS 错误码,
              substr(coalesce(error_message,'-'),1,60) AS 错误信息
       FROM model_usage WHERE status<>'completed'
       ORDER BY started_at DESC LIMIT $n;"
}

# 导出 csv/json
cmd_export() {
    kind="${2:-csv}"
    out="${3:-}"
    case "$kind" in
      csv)
        out="${out:-zcode-usage-export.csv}"
        # 全新环境表还不存在：导出表头空 CSV，而不是让 SQL 报 no such table（与 json 分支同守卫）
        if [[ "$(qr "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')")" != "2" ]]; then
          printf 'time,session,project,model,provider,input_tokens,output_tokens,cache_read_tokens,duration_ms,status\n' > "$out"
          echo "已导出 CSV（空库）：$out"
          return
        fi
        # qc()：CLI 用 sqlite3 -csv，无 sqlite3 环境（Windows 常见）走 node 替身的 -csv 模式
        qc "
          -- 文本列防公式注入：Excel 会把 = + - @ 开头的单元格当公式执行，前缀单引号（真实数据可含用户输入标题）
          SELECT datetime(m.started_at/1000,'unixepoch','localtime') AS time,
                 CASE WHEN substr(coalesce(s.title,''),1,1) IN ('=','+','-','@') THEN '''' || substr(coalesce(s.title,''),1,80) ELSE substr(coalesce(s.title,''),1,80) END AS session,
                 CASE WHEN substr(coalesce(s.directory,''),1,1) IN ('=','+','-','@') THEN '''' || s.directory ELSE s.directory END AS project,
                 CASE WHEN substr(coalesce(m.model_id,''),1,1) IN ('=','+','-','@') THEN '''' || m.model_id ELSE m.model_id END AS model,
                 CASE WHEN substr(coalesce(m.provider_id,''),1,1) IN ('=','+','-','@') THEN '''' || m.provider_id ELSE m.provider_id END AS provider,
                 m.input_tokens AS input_tokens,
                 m.output_tokens+m.reasoning_tokens AS output_tokens,
                 m.cache_read_input_tokens AS cache_read_tokens,
                 m.duration_ms AS duration_ms, m.status AS status
          FROM model_usage m LEFT JOIN session s ON s.id = m.session_id
          ORDER BY m.started_at;" > "$out"
        echo "已导出 CSV：$out"
        ;;
      json)
        out="${out:-zcode-usage-export.json}"
        # 全新环境表还不存在：导出空数据而不是让 SQL 崩
        if [[ "$(qr "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')")" != "2" ]]; then
          printf '{"providers":[],"models":[],"sessions":[],"sessionDirs":[],"total":0,"covered":0,"rows":[]}\n' > "$out"
          echo "已导出 JSON（空库）：$out"
          return
        fi
        # turn_id 是较新 ZCode 才有的列：老库直接 SELECT 会 prepare 失败，先探测再拼表达式
        turn_expr="NULL"
        [[ "$(qr "SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='turn_id'")" == "1" ]] && turn_expr="R.turn_id"
        ctx_exc_expr="NULL"
        [[ "$(qr "SELECT count(*) FROM pragma_table_info('model_usage') WHERE name='context_exceeded'")" == "1" ]] && ctx_exc_expr="R.context_exceeded"
        qr "
          WITH P AS (SELECT provider_id AS v, row_number() OVER (ORDER BY provider_id)-1 AS i FROM (SELECT DISTINCT provider_id FROM model_usage)),
               M AS (SELECT model_id AS v, row_number() OVER (ORDER BY model_id)-1 AS i FROM (SELECT DISTINCT model_id FROM model_usage)),
               S AS (SELECT session_id AS v, row_number() OVER (ORDER BY session_id)-1 AS i FROM (SELECT DISTINCT session_id FROM model_usage)),
               R AS (SELECT * FROM model_usage ORDER BY started_at DESC LIMIT 20000)
          SELECT json_object(
            'providers',(SELECT json_group_array(v) FROM (SELECT v,i FROM P ORDER BY i)),
            'models',(SELECT json_group_array(v) FROM (SELECT v,i FROM M ORDER BY i)),
            'sessions',(SELECT json_group_array(coalesce(se.title,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
        'sessionDirs',(SELECT json_group_array(COALESCE(se.directory,'')) FROM (SELECT v,i FROM S ORDER BY i) SI LEFT JOIN session se ON se.id=SI.v),
            'total',(SELECT count(*) FROM model_usage),
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
                    LEFT JOIN P PI ON PI.v = R.provider_id));" > "$out"
        echo "已导出 JSON：$out"
        ;;
      *)
        echo "用法：usage.sh export <csv|json> [输出路径]" >&2
        exit 1
        ;;
    esac
}

