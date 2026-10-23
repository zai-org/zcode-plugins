# 公共基础：数据库访问、参数校验、价格表定位、SQL 转义（由入口 usage.sh source）

# 价格表解析顺序：ZCODE_USAGE_PRICES → 用户文件 ~/.zcode/usage-prices.json → 插件内置官方价（models.dev）
price_file() {
  if [[ -n "${ZCODE_USAGE_PRICES:-}" && -f "$ZCODE_USAGE_PRICES" ]]; then
    echo "$ZCODE_USAGE_PRICES"; return
  fi
  if [[ -f "$HOME/.zcode/usage-prices.json" ]]; then
    echo "$HOME/.zcode/usage-prices.json"; return
  fi
  local d; d="$SCRIPT_DIR/default-prices.json"
  if [[ -f "$d" ]]; then echo "$d"; fi
}

if [[ ! -f "$DB" ]]; then
  # dashboard 冷启动（ZCode 从未运行过）：建 0 字节库走空数据页（入口已做同款豁免，此处兜底直接 source 场景）
  if [[ "${1:-}" == dashboard || "${1:-}" == dashboard-this ]]; then
    mkdir -p "$(dirname "$DB")"
    touch "$DB"
  else
    echo "未找到 ZCode 本地数据库：$DB" >&2
    exit 1
  fi
fi

# 数据库访问：优先本机 sqlite3 CLI；没有时（Windows Git Bash 常见）回退 node:sqlite 替身。
# ZCODE_USAGE_SQLITE=node 可强制走替身（测试跨实现一致性）。
if [[ "${ZCODE_USAGE_SQLITE:-}" == "node" ]] || ! command -v sqlite3 >/dev/null 2>&1; then
  q() { node "$SCRIPT_DIR/sqlite.mjs" -header "$DB" "$1"; }
  qr() { node "$SCRIPT_DIR/sqlite.mjs" "$DB" "$1"; }
  qc() { node "$SCRIPT_DIR/sqlite.mjs" -csv -header "$DB" "$1"; }
else
  q() { sqlite3 -readonly -header -column "$DB" "$1"; }
  # 输出原始单值（供 JSON 组装），不带表格格式化
  qr() { sqlite3 -readonly "$DB" "$1"; }
  qc() { sqlite3 -readonly -csv -header "$DB" "$1"; }
fi

is_num() { [[ "${1:-}" =~ ^[0-9]+$ ]]; }

# num_arg 默认值 实际参数 —— 校验数字参数，非法则报错退出
num_arg() {
  if [[ -n "${2:-}" ]]; then
    is_num "$2" || { echo "参数应为数字：$2" >&2; exit 1; }
    echo "$2"
  else
    echo "$1"
  fi
}

# 供应商标签：官方账号 / 自定义接入
PV_LABEL="CASE WHEN provider_id LIKE 'account:%' THEN '官方·'||substr(provider_id,9) ELSE '自定义·'||provider_id END"

# SQL 字符串字面量；会话 ID、目录、价格表路径都可能含单引号。
sql_quote() {
  local value="$1"
  # Bash 3.2 的替换表达式置于双引号内会保留多余反斜杠。
  # 仅限短字符串（会话 ID / 路径 / 价格表路径）；大文本禁止走此函数——
  # bash 3.2 的 ${var//} 在长串 + replacement 含反斜杠时是平方级（见 dashboard.sh META）。
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

# 定位一次后固定 ID，后续查询不会因其他窗口的新请求切换会话。
