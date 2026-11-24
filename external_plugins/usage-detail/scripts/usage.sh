#!/usr/bin/env bash
# 查询 ZCode 本地用量明细（只读）。数据源：客户端本地 SQLite 的 model_usage / tool_usage 表。
# 设计参考：ccusage（5小时窗口/成本）、DeepSeek Harness 社区用量插件（热力图/洞察/导出）。
set -euo pipefail

DB="${ZCODE_USAGE_DB:-$HOME/.zcode/cli/db/db.sqlite}"
PRICE_FILE="${ZCODE_USAGE_PRICES:-$HOME/.zcode/usage-prices.json}"
# 本插件脚本按层拆分在 lib/：common 基础 / session 定位 / 各子命令实现 / dashboard 仪表盘。
# 入口只负责 source 与子命令分发；外部调用方式（bash usage.sh <子命令>）保持不变。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/session.sh"
source "$SCRIPT_DIR/lib/cmd-query.sh"
source "$SCRIPT_DIR/lib/cmd-cost.sh"
source "$SCRIPT_DIR/lib/cmd-monitor.sh"
source "$SCRIPT_DIR/lib/cmd-doctor.sh"
source "$SCRIPT_DIR/lib/cmd-this.sh"
source "$SCRIPT_DIR/lib/dashboard.sh"

if [[ ! -f "$DB" ]]; then
  # dashboard 冷启动（ZCode 从未运行过）：建 0 字节库走空数据页；其余子命令仍明确报错
  if [[ "${1:-}" == dashboard || "${1:-}" == dashboard-this ]]; then
    mkdir -p "$(dirname "$DB")"
    touch "$DB"
  else
    echo "未找到 ZCode 本地数据库：$DB" >&2
    exit 1
  fi
fi

cmd="${1:-summary}"
case "$cmd" in
  this) cmd_this "$@" ;;
  summary) cmd_summary "$@" ;;
  providers) cmd_providers "$@" ;;
  blocks) cmd_blocks "$@" ;;
  months) cmd_months "$@" ;;
  projects) cmd_projects "$@" ;;
  tools) cmd_tools "$@" ;;
  cost) cmd_cost "$@" ;;
  prices) cmd_prices "$@" ;;
  live) cmd_live "$@" ;;
  export) cmd_export "$@" ;;
  recent) cmd_recent "$@" ;;
  day) cmd_day "$@" ;;
  days) cmd_days "$@" ;;
  sessions) cmd_sessions "$@" ;;
  models) cmd_models "$@" ;;
  errors) cmd_errors "$@" ;;
  dashboard|dashboard-this) cmd_dashboard "$@" ;;
  quota) cmd_quota "$@" ;;
  serve) cmd_serve "$@" ;;
  doctor) cmd_doctor "$@" ;;
  turnstats) cmd_turnstats "$@" ;;
  waste) cmd_waste "$@" ;;
  alerts) cmd_alerts "$@" ;;
  statusline) cmd_statusline "$@" ;;
  help|*)
    cat <<'EOF'
用法：usage.sh [子命令] [参数]
  this [--session ID | --directory DIR]
                           当前会话汇总、模型/来源与最近失败/取消请求（默认按最近请求推断）
  dashboard-this <输出.html> [--session ID | --directory DIR]
                           当前会话仪表盘（会话过滤后再取最近 3000 条）
  summary                  总览：累计 + 今日（默认）
  providers                按来源（官方套餐 / 自定义接入）汇总
  blocks                   5 小时窗口用量（末尾窗口若在 5h 内即进行中）
  waste [N]                浪费取证：近 N 天（默认 7）失败/取消/重试白耗的 token 与 Top 会话
  statusline               一行式用量摘要（今日 token/折算/燃烧率/预算%），供 tmux、SwiftBar 等状态栏挂载
  alerts <budget|permission> [on|off]  通知开关：预算/燃烧告警（默认开）、权限等待提醒（默认关）
  months                   按月汇总
  projects [N]             按项目目录汇总 Top N（默认 15）
  tools [N]                工具调用统计 Top N（默认 15）
  cost                     成本估算（默认用内置官方价，~/.zcode/usage-prices.json 可覆盖）
  prices [show|sync]       查看价格表 / 从 models.dev 同步官方价（保留自定义条目）
  live [秒]                终端实时燃烧率监控（默认 3s 刷新，Ctrl-C 退出；供用户在终端运行）
  export csv|json [路径]   导出全部记录（默认当前目录）
  recent [N]               最近 N 条逐条请求明细（默认 20）
  day [YYYY-MM-DD]         某天逐条明细（缺省今天）
  days [N]                 最近 N 天按天汇总（默认 14）
  sessions [N]             按会话用量 Top N（默认 15）
  models                   按模型汇总
  errors [N]               最近 N 条失败请求（默认 10）
  dashboard <输出.html> [条数]
                           生成交互式用量界面（HTML 片段，供 ZCode 内嵌渲染）；
                           条数默认全部（-1），可用 ZCODE_USAGE_LIMIT 覆盖，范围 1-20000
  serve [端口]             本地常驻面板（默认端口 7741），浏览器打开、5s 轮询实时燃烧率
  quota                    官方套餐配额（5小时/周/MCP 池用量百分比，凭据不可用时提示）
  turnstats [notify|inject|off|status]
                           每轮用量统计开关（默认关闭）：notify=系统通知零开销；inject=对话内统计行（每轮约 0.3k token）
环境变量：ZCODE_USAGE_DB 覆盖数据库路径；ZCODE_USAGE_PRICES 覆盖价格表路径；ZCODE_USAGE_LIMIT 覆盖默认内嵌条数；ZCODE_USAGE_NO_AUTOSYNC=1 关闭价格表每日自动同步。
EOF
    ;;
esac

