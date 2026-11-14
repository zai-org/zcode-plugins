# 环境自检：统计不见了吗？逐项排查数据源、依赖与配置（/usage doctor）
cmd_doctor() {
  local ok=1 warn=0
  say() { printf '  %s\n' "$2"; [[ "$1" == ok ]] || { [[ "$1" == warn ]] && warn=$((warn+1)) || ok=0; }; }
  echo "—— ZCode 用量明细 · 环境自检 ——"
  # 1. 数据库
  if [[ -f "$DB" ]]; then
    local cnt; cnt=$(qr "SELECT count(*) FROM model_usage;" 2>/dev/null) && cnt=${cnt:-0}
    local latest; latest=$(qr "SELECT datetime(max(started_at)/1000,'unixepoch','localtime') FROM model_usage;" 2>/dev/null)
    say ok "1. 数据库：${DB}（${cnt} 条请求，最新 ${latest}）"
    for t in session tool_usage todo part; do
      qr "SELECT 1 FROM $t LIMIT 1;" >/dev/null 2>&1 && say ok "   表 $t 存在" || say warn "   表 $t 不存在（旧版客户端？相关洞察将缺失）"
    done
  else
    say bad "1. 数据库不存在：${DB}（ZCODE_USAGE_DB 可覆盖路径）"
  fi
  # 2. 价格表
  local pf; pf=$(price_file)
  if [[ -n "$pf" ]]; then
    local mtime age
    mtime=$(stat -f %m "$pf" 2>/dev/null || stat -c %Y "$pf" 2>/dev/null || echo 0)
    age=$(( $(date +%s) - mtime ))
    say ok "2. 价格表：${pf}（${age} 秒前更新）"
    [[ $age -ge 86400 ]] && say warn "   价格表超过 1 天未更新（下次生成仪表盘时将自动同步）"
  else
    say bad "2. 找不到任何价格表（内置 default-prices.json 缺失？）"
  fi
  # 3. 配额数据源
  if command -v node >/dev/null 2>&1; then
    local qout
    qout=$(node "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/quota.mjs" 2>&1 | head -1 || true)
    if [[ "$qout" == "{"*'"ok":true'* ]]; then
      local src; src=$(printf '%s' "$qout" | sed -n 's/.*"source":"\([^"]*\)".*/\1/p')
      say ok "3. 配额：可用（来源 ${src:-未知}）"
    else
      say warn "3. 配额：暂不可用（客户端日志尚无额度观测，也未配置 API 凭据；不影响用量统计）"
    fi
  else
    say bad "3. 未安装 node（配额、价格同步、serve 面板不可用）"
  fi
  # 4. 常驻面板依赖
  command -v node >/dev/null 2>&1 && say ok "4. 本地面板：node 可用（usage.sh serve 启动，默认 127.0.0.1:7741）"
  # 5. 结果
  if [[ $ok -eq 1 && $warn -eq 0 ]]; then echo "—— 全部正常 ——"
  elif [[ $ok -eq 1 ]]; then echo "—— 基本正常（${warn} 项提示）——"
  else echo "—— 存在不可用项，请按上面信息处理 ——"; return 1; fi
}
