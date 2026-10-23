# 会话定位：按最近请求推断 / --session / --directory（由入口 usage.sh source）
resolve_session() {
  local requested='' directory='' directory_sql=''
  SESSION_MODE='最近请求推断（多窗口时请核对）'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --session|--directory)
        [[ $# -ge 2 && -n "$2" ]] || { echo "$1 需要非空参数" >&2; exit 1; }
        [[ -z "$requested$directory" ]] || { echo "--session 与 --directory 只能指定一个且不能重复" >&2; exit 1; }
        if [[ "$1" == --session ]]; then requested="$2"; else directory="$2"; fi
        shift 2
        ;;
      *) echo "未知会话参数：${1}（可用 --session ID 或 --directory DIR）" >&2; exit 1 ;;
    esac
  done
  # 全新环境表还不存在（ZCode 尚未写入）：没有任何会话可定位，明确报错而不是让 SQL 崩
  if [[ "$(qr "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_usage','session')")" != "2" ]]; then
    echo "未找到可用于定位会话的模型请求（数据库尚未初始化，先在 ZCode 里跑一轮对话）${directory:+（目录：${directory}）}" >&2; exit 1
  fi
  if [[ -n "$requested" ]]; then
    SESSION_ID="$requested"
    SESSION_MODE='显式指定会话'
    SESSION_SQL=$(sql_quote "$SESSION_ID")
    [[ "$(qr "SELECT EXISTS(SELECT 1 FROM session WHERE id=$SESSION_SQL) OR EXISTS(SELECT 1 FROM model_usage WHERE session_id=$SESSION_SQL);")" == 1 ]] || {
      echo "未找到指定会话：$SESSION_ID" >&2; exit 1;
    }
  else
    if [[ -n "$directory" ]]; then
      directory_sql="AND session_id IN (SELECT id FROM session WHERE directory=$(sql_quote "$directory"))"
      SESSION_MODE='指定目录内最近请求推断（多窗口时请核对）'
    fi
    SESSION_ID=$(qr "SELECT session_id FROM model_usage WHERE session_id IS NOT NULL AND session_id<>'' $directory_sql ORDER BY started_at DESC, id DESC LIMIT 1;")
    [[ -n "$SESSION_ID" ]] || { echo "未找到可用于定位会话的模型请求${directory:+（目录：${directory}）}；可用 --session ID 指定会话" >&2; exit 1; }
    SESSION_SQL=$(sql_quote "$SESSION_ID")
  fi
}

session_info() {
  q "SELECT $SESSION_SQL AS 会话ID,
            coalesce(nullif(s.title,''),'（无标题或会话已删除）') AS 会话标题,
            coalesce(s.directory,'-') AS 项目目录,
            datetime(s.time_created/1000,'unixepoch','localtime') AS 创建时间,
            (SELECT datetime(max(started_at)/1000,'unixepoch','localtime') FROM model_usage WHERE session_id=$SESSION_SQL) AS 最近请求
     FROM (SELECT 1) LEFT JOIN session s ON s.id=$SESSION_SQL;"
  echo "定位方式：${SESSION_MODE}；仅统计该 session_id 的记录。"
}

cmd="${1:-summary}"
