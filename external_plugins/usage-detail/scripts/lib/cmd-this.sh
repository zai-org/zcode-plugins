# 当前会话子命令（由入口 usage.sh source）

cmd_this() {
    resolve_session "${@:2}"
    session_info
    echo
    echo "—— 会话汇总（全部状态；输入含缓存读，生成=输出+思考）——"
    q "SELECT count(*) AS 总请求数,
              coalesce(sum(status='completed'),0) AS 完成数,
              coalesce(sum(status='error'),0) AS 失败数,
              coalesce(sum(status='cancelled'),0) AS 取消数,
              coalesce(sum(status NOT IN ('completed','error','cancelled')),0) AS 其他状态数,
              coalesce(sum(input_tokens),0) AS 输入token,
              coalesce(sum(output_tokens+reasoning_tokens),0) AS 生成token,
              coalesce(sum(cache_read_input_tokens),0) AS 缓存读token
       FROM model_usage WHERE session_id=$SESSION_SQL;"
    echo
    echo "—— 按模型与来源（全部状态）——"
    q "SELECT model_id AS 模型, $PV_LABEL AS 来源,
              count(*) AS 请求数,
              sum(input_tokens) AS 输入token,
              sum(output_tokens+reasoning_tokens) AS 生成token,
              sum(cache_read_input_tokens) AS 缓存读token
       FROM model_usage WHERE session_id=$SESSION_SQL
       GROUP BY model_id, provider_id ORDER BY sum(input_tokens+output_tokens+reasoning_tokens) DESC;"
    echo
    echo "—— 最近失败/取消请求（最多 10 条）——"
    q "SELECT datetime(started_at/1000,'unixepoch','localtime') AS 时间,
              model_id AS 模型, $PV_LABEL AS 来源, status AS 状态,
              coalesce(error_code,'-') AS 错误码,
              substr(coalesce(error_message,'-'),1,60) AS 错误信息
       FROM model_usage WHERE session_id=$SESSION_SQL AND status IN ('error','cancelled')
       ORDER BY started_at DESC, id DESC LIMIT 10;"
}

