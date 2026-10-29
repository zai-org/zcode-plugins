# 实时监控与本地服务子命令（由入口 usage.sh source）

# 终端实时燃烧率监控
cmd_live() {
    # 实时燃烧率监控（终端）：每 N 秒刷新（默认 3），Ctrl-C 退出。
    # 只查询最近 5h 与近 48h 数据，走 started_at 索引，开销极低。
    interval=$(num_arg 3 "${2:-}")
    while true; do
      printf '\033[H\033[2J'
      echo "── ZCode 用量实时监控 · 每 ${interval}s 刷新 · Ctrl-C 退出 · $(date '+%H:%M:%S') ──"
      echo
      q "WITH cur AS (SELECT count(*) AS req,
                            COALESCE(sum(input_tokens),0) AS inn,
                            COALESCE(sum(output_tokens+reasoning_tokens),0) AS gen,
                            min(started_at) AS st
                     FROM model_usage WHERE started_at > (unixepoch()*1000 - 18000000)),
            s AS (SELECT started_at, input_tokens, output_tokens+reasoning_tokens AS gen,
                         LAG(started_at) OVER (ORDER BY started_at) AS prev
                  FROM model_usage WHERE started_at > (unixepoch()*1000 - 172800000)),
            b AS (SELECT started_at, input_tokens, gen,
                         SUM(CASE WHEN prev IS NULL OR started_at-prev>=18000000 THEN 1 ELSE 0 END) OVER (ORDER BY started_at) AS blk
                  FROM s),
            hist AS (SELECT blk, sum(input_tokens)+sum(gen) AS tok
                     FROM b GROUP BY blk
                     HAVING min(started_at) <= (unixepoch()*1000 - 18000000)
                     ORDER BY min(started_at) DESC LIMIT 3)
       SELECT c.req AS 本窗请求,
              c.inn+c.gen AS 本窗token,
              CAST(round((c.inn+c.gen) / max(0.1,(unixepoch()*1000 - COALESCE(c.st, unixepoch()*1000))/3600000.0)) AS int) AS 燃烧率token每小时,
              (SELECT CAST(round(avg(tok)) AS int) FROM hist) AS 近3窗口均值token,
              (SELECT count(*) FROM hist) AS 均值样本数
       FROM cur c;"
      echo
      q "SELECT $PV_LABEL AS 来源, count(*) AS 近24h请求, sum(input_tokens+output_tokens+reasoning_tokens) AS token
         FROM model_usage WHERE started_at > (unixepoch()*1000 - 86400000)
         GROUP BY provider_id ORDER BY 近24h请求 DESC;"
      sleep "$interval"
    done
}

# 官方套餐配额（quota.mjs）
cmd_quota() {
    # 官方配额：5 小时/周/MCP 池用量百分比（凭据解析见 quota.mjs）
    command -v node >/dev/null 2>&1 || { echo "quota 需要 node" >&2; exit 1; }
    exec node "$SCRIPT_DIR/quota.mjs"
}

# 本地常驻面板（serve.mjs）
cmd_serve() {
    # 本地常驻面板：浏览器打开，自动轮询燃烧率（只监听 127.0.0.1，只读）
    command -v node >/dev/null 2>&1 || { echo "serve 需要 node" >&2; exit 1; }
    port=$(num_arg 7741 "${2:-}")
    exec node "$SCRIPT_DIR/serve.mjs" "$port"
}


# 每轮统计行开关（写 ~/.zcode/usage-turnstats.json；hook 每次提交/结束时读取）
# off（默认）| notify（每轮结束弹系统通知，零模型开销零上下文）| inject（对话内统计行，每轮约 0.3k token）
cmd_turnstats() {
    local f="$HOME/.zcode/usage-turnstats.json"
    case "${2:-status}" in
      on|notify)
        mkdir -p "$(dirname "$f")"
        echo '{"enabled":true,"mode":"notify"}' > "$f"
        echo "已开启：通知模式——每轮回复结束弹 macOS 系统通知显示本轮统计。"
        echo "统计由本地脚本计算、经系统通知展示，不进入对话上下文，零模型开销。"
        echo "（需重开会话生效；通知在系统设置里可关。对话内统计行：usage.sh turnstats inject，每轮约 0.3k token）"
        ;;
      inject)
        echo '{"enabled":true,"mode":"inject"}' > "$f"
        echo "已开启：注入模式——每轮回复末尾附统计行（统计行必须经由模型输出）。"
        echo "开销提示：每轮注入指令约 0.15k token（持续保留在上下文）+ 一次工具调用（结果约 0.1k）+ 统计行输出约 0.05k；"
        echo "相对百万级上下文占比 <0.1%，短会话约 1-2%。零开销替代：usage.sh turnstats notify"
        ;;
      off)
        echo '{"enabled":false}' > "$f"
        echo "已关闭：不再注入指令、不再发通知（侧栏面板的请求明细仍可查看每轮速率/首字/缓存率）。"
        ;;
      status)
        local mode='关闭（默认）'
        if [[ -f "$f" ]] && grep -q '"enabled"[: ]*true' "$f" 2>/dev/null; then
          if grep -q '"mode"[: ]*"notify"' "$f" 2>/dev/null; then mode='通知模式（零模型开销）'; else mode='注入模式（每轮约 0.3k token）'; fi
        fi
        echo "当前：$mode"
        echo "可选：usage.sh turnstats notify（零开销通知）/ inject（对话内统计行）/ off（关闭）"
        ;;
      *)
        echo "用法：usage.sh turnstats [notify|inject|off|status]" >&2
        exit 1
        ;;
    esac
}

# 浪费取证：失败/取消请求与重试的 token 消耗（本地只读聚合，灵感：codeburn optimize）
cmd_waste() {
    local days="${2:-7}"
    is_num "$days" || { echo "参数应为数字：$days" >&2; exit 1; }
    local since=$(( ($(date +%s) - days * 86400) * 1000 ))
    local row
    row=$(qr "
      WITH W AS (SELECT * FROM model_usage WHERE started_at >= ${since})
      SELECT
        (SELECT count(*) FROM W WHERE status='error') ||'|'||
        (SELECT COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0) FROM W WHERE status='error') ||'|'||
        (SELECT count(*) FROM W WHERE status='cancelled') ||'|'||
        (SELECT COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0) FROM W WHERE status='cancelled') ||'|'||
        (SELECT COALESCE(sum(retry_count),0) FROM W) ||'|'||
        (SELECT count(*) FROM W WHERE retry_count>0) ||'|'||
        (SELECT COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0) FROM W WHERE retry_count>0) ||'|'||
        (SELECT COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0) FROM W)
      FROM (SELECT 1)")
    local err_req err_tok cc_req cc_tok retries retry_req retry_tok all_tok
    IFS='|' read -r err_req err_tok cc_req cc_tok retries retry_req retry_tok all_tok <<< "$row"
    err_req=${err_req:-0}; err_tok=${err_tok:-0}; cc_req=${cc_req:-0}; cc_tok=${cc_tok:-0}
    retries=${retries:-0}; retry_req=${retry_req:-0}; retry_tok=${retry_tok:-0}; all_tok=${all_tok:-0}
    local waste_tok=$((err_tok + cc_tok))
    local pct=0
    [[ "$all_tok" -gt 0 ]] && pct=$(awk -v w="$waste_tok" -v a="$all_tok" 'BEGIN{printf "%.1f", w/a*100}')
    echo "近 ${days} 天浪费取证（token 口径：失败/取消请求的输入与生成 token 同样已消耗）"
    echo "----------------------------------------------------------"
    echo "失败请求：${err_req} 次 · 白耗 $(fmt_n "$err_tok") token"
    echo "取消请求：${cc_req} 次 · 白耗 $(fmt_n "$cc_tok") token"
    echo "重试：${retries} 次（涉及 ${retry_req} 条请求 / $(fmt_n "$retry_tok") token）"
    echo "合计浪费：$(fmt_n "$waste_tok") token（占同期 $pct%）"
    echo ""
    echo "反复失败会话 Top 5："
    local t
    t=$(qr "
      SELECT COALESCE((SELECT title FROM session WHERE id=m.session_id),'（无标题）') ||' | '||
        count(*) ||' 次失败 · '|| COALESCE(sum(input_tokens+output_tokens+reasoning_tokens),0) ||' tok'
      FROM model_usage m WHERE m.status='error' AND m.started_at >= ${since} AND m.session_id IS NOT NULL
      GROUP BY m.session_id ORDER BY count(*) DESC LIMIT 5")
    [[ -n "$t" ]] && echo "$t" | sed 's/ | /：/;s/^/  · /' || echo "  · 无"
    echo ""
    echo "重试最多的模型 Top 3："
    t=$(qr "
      SELECT model_id ||'：'|| sum(retry_count) ||' 次重试'
      FROM model_usage WHERE started_at >= ${since} AND retry_count > 0
      GROUP BY model_id ORDER BY sum(retry_count) DESC LIMIT 3")
    [[ -n "$t" ]] && echo "$t" | sed 's/^/  · /' || echo "  · 无"
    echo ""
    echo "提示：失败/取消多为网络或权限问题；重试偏高常与超时相关，可关注对应时段稳定性。"
}
fmt_n() { printf '%s\n' "$1" | awk '{ n = $1; s = ""; while (length(n) > 3) { s = "," substr(n, length(n) - 2) s; n = substr(n, 1, length(n) - 3) } print n s }'; }

# 通知类开关（~/.zcode/usage-alerts.json）：
#   budget  日预算 80%/100% 与用量偏高提醒（serve 常驻时本地检查，默认开）
#   permission  Agent 等待权限批准时弹系统提醒（默认关）
cmd_alerts() {
    local f="$HOME/.zcode/usage-alerts.json"
    local what="${2:-budget}" act="${3:-status}"
    # 白名单校验：what/act 都是拼接进 node -e 的值，且 alerts 无参时缺省应显示 budget 状态
    case "$what" in budget|permission) ;; *)
      echo "用法：usage.sh alerts <budget|permission> [on|off|status]" >&2; exit 1 ;; esac
    case "$act" in on|off|status) ;; *)
      echo "用法：usage.sh alerts <budget|permission> [on|off|status]" >&2; exit 1 ;; esac
    [[ -f "$f" ]] || echo '{}' > "$f"
    local cur
    cur=$(node -e "const v=JSON.parse(require('fs').readFileSync('$f','utf8'));console.log(v['$what']==null?'(默认)':v['$what'])" 2>/dev/null || echo '(默认)')
    case "$act" in
      on|off)
        local bv cn='开启'; [[ "$act" == off ]] && { bv=false; cn='关闭'; } || bv=true
        ALERTS_VAL="$bv" node -e "
          const fs=require('fs');
          const p='$f';
          let v={};try{v=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){}
          v['$what']=process.env.ALERTS_VAL==='true';
          fs.writeFileSync(p,JSON.stringify(v)+'\n');"
        echo "已${cn}：${what}"
        ;;
      status)
        local def='开（默认）'; [[ "$what" == permission ]] && def='关（默认）'
        local d="$def"; [[ "$cur" == false ]] && d='关'; [[ "$cur" == true ]] && d='开'
        echo "${what}：${d}"
        ;;
      *)
        echo "用法：usage.sh alerts <budget|permission> [on|off|status]" >&2
        exit 1
        ;;
    esac
}
# 一行式用量摘要（状态栏/终端提示通用）：无色彩、单行、稳定字段。
# 供 tmux status-right、SwiftBar、或任何接受一行文本的状态栏挂载；
# ZCode CLI 暂无 statusline 挂载点，留作通用出口。
cmd_statusline() {
  ZCODE_USAGE_LIMIT=1 node - <<'JS' 2>/dev/null
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const DB = process.env.ZCODE_USAGE_DB || path.join(os.homedir(), '.zcode/cli/db/db.sqlite');
const { DatabaseSync } = require('node:sqlite');
let prices = { models: {}, usdCny: null, currency: 'CNY' };
const stripBom = (t) => String(t).replace(/^\uFEFF/, '');
try { const v = JSON.parse(stripBom(fs.readFileSync(path.join(os.homedir(), '.zcode/usage-prices.json'), 'utf8'))); prices.models = v.models || {}; prices.usdCny = v.usdCny; prices.currency = v.currency || 'CNY'; } catch (e) {}
let budget = { daily: 0, monthly: 0 };
try { budget = { ...budget, ...JSON.parse(stripBom(fs.readFileSync(path.join(os.homedir(), '.zcode/usage-budget.json'), 'utf8'))) }; } catch (e) {}
const rate = Number(process.env.ZCODE_USAGE_USD_CNY) || Number(prices.usdCny) || 7.2;
const db = new DatabaseSync(DB, { readOnly: true });
const now = Date.now(), t0 = new Date(new Date().toDateString()).getTime();
const q = (sql, ...a) => db.prepare(sql).all(...a);
const tok = q("SELECT COALESCE(SUM(input_tokens+output_tokens+reasoning_tokens),0) AS v FROM model_usage WHERE started_at >= ?", t0)[0].v;
const burn = q("SELECT COALESCE(SUM(input_tokens+output_tokens+reasoning_tokens),0) AS v FROM model_usage WHERE started_at >= ?", now - 3600e3)[0].v;
let cost = 0;
// 模型名归一匹配：精确 → 小写 → 遍历小写（与面板 rowCost/priceOf 同口径）；
// 真实库存在 GLM-5.3-Flash 等大小写形态，直查会 miss 导致折算恒 0、预算告警失效
const P = prices.models;
const priceOf = (n) => {
  n = String(n || '');
  let p = P[n] || P[n.toLowerCase()];
  if (!p) { const l = n.toLowerCase(); for (const k in P) { if (k.toLowerCase() === l) { p = P[k]; break; } } }
  return p;
};
for (const r of q("SELECT input_tokens, output_tokens, reasoning_tokens, cache_read_input_tokens, model_id FROM model_usage WHERE started_at >= ?", t0)) {
  const p = priceOf(r.model_id);
  if (!p || !p.in) continue;
  const inBillable = Math.max(0, (r.input_tokens || 0) - (r.cache_read_input_tokens || 0));
  cost += (inBillable * p.in + (r.output_tokens || 0) * p.out + (r.cache_read_input_tokens || 0) * (p.cache || 0)) / 1e6;
}
const f = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(Math.round(n));
const parts = ['今日 ' + f(tok) + ' tok'];
// 价格表已是 CNY 牌价时直接使用；仅 USD 价目（models.dev 同步）才乘汇率折算——
// 否则 CNY 价 × usdCny 重复换算，金额虚高一个汇率倍数
const kRate = String(prices.currency).toUpperCase() === 'USD' ? rate : 1;
if (cost > 0) parts.push('¥' + (cost * kRate).toFixed(2));
if (burn > 0) parts.push('近1h ' + f(burn / 60) + ' tok/min');
if (budget.daily > 0 && cost > 0) parts.push('日预算 ' + Math.min(999, Math.round(cost * kRate / budget.daily * 100)) + '%');
console.log(parts.join(' · '));
JS
}
