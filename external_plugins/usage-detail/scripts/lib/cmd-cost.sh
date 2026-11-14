# 成本估算与价格表子命令（由入口 usage.sh source）

# 成本估算（价格表 × 分时计价 tariff）
cmd_cost() {
    # 成本估算：默认用插件内置官方价（models.dev），用户文件 ~/.zcode/usage-prices.json 可覆盖/扩展
    pf=$(price_file)
    if [[ -z "$pf" ]]; then
      echo "未找到价格表（应随插件内置 scripts/default-prices.json）" >&2
      exit 1
    fi
    q "WITH src AS (SELECT replace(CAST(readfile($(sql_quote "$pf")) AS text), char(65279), '') AS j),
            n AS (SELECT CASE WHEN json_type(j,'\$.models')='object' THEN j ELSE json_object('models',json(j)) END AS j2,
                         COALESCE(json_extract(j,'\$.currency'),'CNY') AS cur FROM src),
            p AS (SELECT je.key AS model,
                         CAST(json_extract(je.value,'\$.in') AS real) AS pin,
                         CAST(json_extract(je.value,'\$.out') AS real) AS pout,
                         CAST(json_extract(je.value,'\$.cache') AS real) AS pcache
                  FROM n, json_each(n.j2,'\$.models') je)
       SELECT m.model_id AS 模型,
              count(*) AS 请求数,
              -- input_tokens 已包含缓存命中：未命中段按牌价 in、命中段按 cache，不重复计费
              round(sum(max(m.input_tokens - m.cache_read_input_tokens, 0))/1000000.0*p.pin, 2) AS 输入成本,
              round(sum(m.output_tokens+m.reasoning_tokens)/1000000.0*p.pout, 2) AS 生成成本,
              round(sum(m.cache_read_input_tokens)/1000000.0*p.pcache, 2) AS 缓存读成本,
              round(sum(max(m.input_tokens - m.cache_read_input_tokens, 0))/1000000.0*p.pin
                  + sum(m.output_tokens+m.reasoning_tokens)/1000000.0*p.pout
                  + sum(m.cache_read_input_tokens)/1000000.0*p.pcache, 2) AS 合计,
              (SELECT cur FROM n) AS 币种
       FROM model_usage m JOIN p ON lower(p.model) = lower(m.model_id)
       GROUP BY m.model_id ORDER BY 合计 DESC;"
    echo
    echo "（折算口径：API 牌价（CNY）× 本地记录 token；含分时费率的模型按标准价折算，精确分时请在面板查看；订阅套餐内请求实际不按 token 计费，此金额仅表示等量 API 用量的牌价价值）"
}

# prices show|sync
cmd_prices() {
    # 官方价格表：show 查看 / sync 从 models.dev 同步（保留自定义条目）
    sub="${2:-show}"
    case "$sub" in
      show)
        pf=$(price_file)
        [[ -n "$pf" ]] || { echo "未找到价格表" >&2; exit 1; }
        echo "生效价格表：$pf"
        echo
        q "WITH src AS (SELECT replace(CAST(readfile($(sql_quote "$pf")) AS text), char(65279), '') AS j),
                n AS (SELECT CASE WHEN json_type(j,'\$.models')='object' THEN j ELSE json_object('models',json(j)) END AS j2 FROM src)
           SELECT je.key AS 模型,
                  json_extract(je.value,'\$.in') AS 输入,
                  json_extract(je.value,'\$.out') AS 生成,
                  json_extract(je.value,'\$.cache') AS 缓存读,
                  COALESCE(json_extract(j2.j2,'\$.currency'),'CNY') AS 币种
           FROM n j2, json_each(j2.j2,'\$.models') je
           ORDER BY 模型;"
        echo
        echo "（单位：每百万 token）自定义请编辑 ~/.zcode/usage-prices.json；同步官方价：usage.sh prices sync"
        ;;
      sync)
        command -v node >/dev/null 2>&1 || { echo "prices sync 需要 node（同步仅是可选操作，内置价格表已可用）" >&2; exit 1; }
        tmp=$(mktemp)
        trap 'rm -f "$tmp"' EXIT  # node 解析失败（set -e 中断）也不残留 TMPDIR 里的 MB 级下载物
        curl -fsSL --max-time 30 https://models.dev/api.json -o "$tmp" || { echo "下载 models.dev 失败" >&2; rm -f "$tmp"; exit 1; }
        node - "$tmp" "${ZCODE_USAGE_PRICES:-$HOME/.zcode/usage-prices.json}" "$SCRIPT_DIR/default-prices.json" <<'NODE'
const fs = require('fs');
const md = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const user = process.argv[3];
let out = { currency: 'CNY', models: {} };
try {
  const old = JSON.parse(fs.readFileSync(user, 'utf8'));
  if (old && typeof old.models === 'object') out = old;
  else if (old && typeof old === 'object') out.models = old;
} catch (e) {}
out.currency = out.currency || 'CNY';
// models.dev 全部是 USD 价；表是 CNY 口径时按汇率换算入库（ZCODE_USAGE_USD_CNY 覆盖）
const RATE = out.currency === 'CNY' ? (Number(process.env.ZCODE_USAGE_USD_CNY) || Number(out.usdCny) || 7.2) : 1;
// 智谱官方 CNY 权威价（与 bigmodel 官网定价页核对），models.dev 的全球口径与之有偏差，不同步覆盖
const PINNED = ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx',
  // DeepSeek 官方 CNY 高峰牌价 + 峰谷 tariff（2026-10 核对官方价目页：工作日 9-12/14-18 高峰，周末节假日空闲半价）
  'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro'];
// 官方权威条目以内置表为准种子进用户文件：models.dev 的 DeepSeek 价已过期（且无 tariff），
// 重跑 sync 即把现行官方牌价 + 分时计价配置带给老用户
let seeded = 0;
try {
  const bn = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).models || {};
  for (const m of PINNED) {
    if (bn[m]) { out.models[m] = JSON.parse(JSON.stringify(bn[m])); seeded++; }
  }
} catch (e) {}
// BYOK：全量同步所有供应商的所有带价模型；同名模型先到先得，自定义条目不会被覆盖
let n = 0;
for (const prov of Object.keys(md)) {
  for (const [m, v] of Object.entries((md[prov] || {}).models || {})) {
    const p = v.price || v.cost;
    if (!p || (!p.input && !p.output)) continue; // 跳过订阅占位（全 0 价）
    const ctx = v.limit && v.limit.context ? v.limit.context : undefined;
    if (out.models[m]) { if (!out.models[m].ctx && ctx) out.models[m].ctx = ctx; continue; }
    if (PINNED.includes(m.toLowerCase())) continue; // 官方权威价不覆盖；其 ctx 由内置表提供
    out.models[m] = { in: (p.input || 0) * RATE, out: (p.output || 0) * RATE, cache: (p.cache_read || 0) * RATE, ...(ctx ? { ctx } : {}) };
    n++;
  }
}
out.source = 'models.dev';
out.updated = new Date().toISOString().slice(0, 10);
fs.mkdirSync(require('path').dirname(user), { recursive: true });
fs.writeFileSync(user, JSON.stringify(out, null, 2) + '\n');
console.log('已同步 ' + n + ' 个官方模型价到 ' + user + '（币种 ' + out.currency + (RATE !== 1 ? '，USD 按 ' + RATE + ' 换算' : '') + '；官方权威条目 ' + seeded + ' 个按内置表更新）');
NODE
        rm -f "$tmp"
        ;;
      *)
        echo "用法：usage.sh prices [show|sync]" >&2
        exit 1
        ;;
    esac
}

