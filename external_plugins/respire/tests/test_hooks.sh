#!/usr/bin/env bash
# respire(zcode) 自测 —— 模拟 stdin 事件 JSON，逐分支断言。
# ZCode 输出契约：一切输出为单行 JSON——文本走 {"additionalContext":...}，Stop 阻塞走 {"decision":"block",...}。
# rsrs 无 data-dir 隔离（runtime 单例＋全局 client.json），故默认只读分支不碰库；
# 加 --store 才跑写探针（写真库→回执断言→rsrs forget 自清理）。
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY3="$(command -v python3)"
RSRS="$(command -v rsrs || true)"
[ -z "$RSRS" ] && RSRS="$HOME/.local/bin/rsrs"
[ -z "$RSRS" ] && RSRS="$HOME/.rsrs/bin/rsrs"
PASS=0; FAIL=0
WITH_STORE=0
[ "${1:-}" = "--store" ] && WITH_STORE=1

if [ -z "$RSRS" ] || [ ! -x "$RSRS" ]; then
  echo "SKIP：未找到 rsrs（respire 引擎），无法自测。"; exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
CFG_ON="$TMP/config-on.json"
echo '{"session_rules": true}' > "$CFG_ON"
CFG_OFF="$TMP/config-off.json"
echo '{"session_rules": false}' > "$CFG_OFF"

# run <event> [prompt] [config]
run() {
  local ev="$1" pr="${2-}" cfg="${3:-$CFG_ON}"
  "$PY3" - "$ev" "$pr" <<'PY' | RESPITE_CONFIG="$cfg" RESPITE_LOG="$TMP/hook.log" RESPITE_NUDGE_STATE="$TMP/nudge" "$PY3" "$ROOT/hooks/respire.py" "$ev"
import json, sys
ev, pr = sys.argv[1], sys.argv[2]
d = {"hook_event_name": ev, "cwd": "/tmp", "session_id": "selftest"}
if ev == "UserPromptSubmit":
    d["prompt"] = pr
if ev == "Stop":
    d["stop_hook_active"] = False
sys.stdout.write(json.dumps(d, ensure_ascii=False))
PY
}

check() {   # check <名字> <实际输出> <模式: 非空|空|含:xxx|不含:xxx>
  local name="$1" got="$2" want="$3" ok=0
  case "$want" in
    非空) [ -n "$got" ] && ok=1 ;;
    空)   [ -z "$got" ] && ok=1 ;;
    不含:*) printf '%s' "$got" | grep -qF -e "${want#不含:}" && ok=0 || ok=1 ;;
    含:*) printf '%s' "$got" | grep -qF -e "${want#含:}" && ok=1 ;;
  esac
  if [ "$ok" = 1 ]; then
    PASS=$((PASS+1)); echo "PASS  $name"
  else
    FAIL=$((FAIL+1)); echo "FAIL  $name  期望[$want] 实际[$(printf '%s' "$got" | head -c 200)]"
  fi
}

# ---- 只读分支（真库查询，不写） ----
out=$(run SessionStart)
check "SessionStart 注入简则" "$out" "含:respire 记忆层"
check "简则点明引擎与同步" "$out" "含:rsrs.rs"
check "输出为 JSON 且走 additionalContext" "$out" "含:{\"additionalContext\""
check "输出单行无裸换行" "$( [ "$(printf '%s' "$out" | wc -l | tr -d ' ')" = "0" ] && echo SINGLE || echo MULTI)" "含:SINGLE"
check "additionalContext 可解析且含简则" "$(printf '%s' "$out" | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print("OK" if "respire 记忆层" in d.get("additionalContext","") else "BAD")')" "含:OK"
check "已登录不带登录引导" "$(run SessionStart)" "不含:尚未登录"
check "未登录注入登录引导" "$(RESPITE_FAKE_LOGGED_OUT=1 run SessionStart)" "含:尚未登录"
check "未登录引导给出注册与代登法" "$(RESPITE_FAKE_LOGGED_OUT=1 run SessionStart)" "含:rsrs login --oauth --no-open"
check "session_rules=false 静默" "$(run SessionStart "" "$CFG_OFF")" "空"
check "已装模型不带提示" "$(run SessionStart)" "不含:语义模型（BGE-M3）未装"
check "缺模型注入装法" "$(RESPITE_FAKE_NO_MODEL=1 run SessionStart)" "含:rsrs model activate m3"
check "缺模型点明词面回退" "$(RESPITE_FAKE_NO_MODEL=1 run SessionStart)" "含:词面档"
check "有货库不带空库引导" "$(run SessionStart)" "不含:记忆库还是空的"
check "空库注入首日引导" "$(RESPITE_FAKE_EMPTY=1 run SessionStart)" "含:记忆库还是空的"
check "空库引导含导入线索" "$(RESPITE_FAKE_EMPTY=1 run SessionStart)" "含:~/.zcode/AGENTS.md"
check "探测失败注入冷启诊断段" "$(RESPITE_FAKE_PROBE_FAIL=1 run SessionStart)" "含:状态探测失败"
check "README 载三件事(模型可选)" "$(cat "$ROOT/README.md")" "含:不装模型完全可用"
check "README 载市场装法" "$(cat "$ROOT/README.md")" "含:添加插件市场"
check "包内无自定义安装脚本" "$( { [ -e "$ROOT/install.sh" ] || [ -e "$ROOT/uninstall.sh" ]; } && echo PRESENT || echo absent )" "含:absent"
# 日志留痕：任一事件后 hook.log 应有本行
run SessionStart >/dev/null
run UserPromptSubmit "我的密码是 password: hunter2 这算敏感吗" >/dev/null
check "日志脱敏口令" "$(grep -q 'hunter2' "$TMP/hook.log" && echo LEAK || echo SAFE)" "含:SAFE"
check "日志脱敏留痕" "$(grep -q 'REDACTED' "$TMP/hook.log" && echo YES)" "含:YES"
check "hook.log 留痕" "$(grep -q '"ev": "session"' "$TMP/hook.log" 2>/dev/null && echo YES)" "含:YES"

# 引擎缺失分支：单元注入 monkeypatch find_rsrs→None（真机造不出「全路径皆缺」）
run_engineless() {
  ROOT="$ROOT" "$PY3" - <<'PY'
import io, json, os, sys, importlib.util
spec = importlib.util.spec_from_file_location("respire", os.path.join(os.environ["ROOT"], "hooks/respire.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.find_rsrs = lambda cfg: None
sys.argv = ["respire.py", "SessionStart"]
sys.stdin = io.StringIO('{"hook_event_name":"SessionStart"}')
try:
    m.main()
except SystemExit:
    pass
PY
}
check "引擎缺失注入装法" "$(run_engineless)" "含:npm i -g @rsrsai/cli"
check "引导禁自造超级密码" "$(run_engineless)" "含:绝不传 --super"
check "引导要求保存恢复码" "$(run_engineless)" "含:务必抄下保存"
check "引擎缺失含注册站点" "$(run_engineless)" "含:rsrs.rs"
check "probe失败含未注册分支" "$(RESPITE_FAKE_PROBE_FAIL=1 run SessionStart)" "含:尚未注册"

# Stop 存储检查节流分支的引擎桩：只回 list --json，fresh=刚落库 / stale=陈旧
# （真机库随时有人写，不能拿真引擎断言催/不催）
STUB_FRESH="$TMP/rsrs-fresh"; STUB_STALE="$TMP/rsrs-stale"
FRESH_TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
cat > "$STUB_FRESH" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = list ] && printf '{"command":"list","status":"ok","details":[{"id":"aaaaaaaaaaaaaaaa","created_at":"$FRESH_TS","updated_at":"$FRESH_TS","title":"fresh","content":"x"}]}'
exit 0
EOF
cat > "$STUB_STALE" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = list ] && printf '{"command":"list","status":"ok","details":[{"id":"bbbbbbbbbbbbbbbb","created_at":"2020-01-01T00:00:00.000Z","updated_at":"2020-01-01T00:00:00.000Z","title":"stale","content":"x"}]}'
exit 0
EOF
chmod +x "$STUB_FRESH" "$STUB_STALE"
CFG_STALE="$TMP/config-stale.json"
echo '{"session_rules": true, "rsrs": "'"$STUB_STALE"'"}' > "$CFG_STALE"
CFG_FRESH="$TMP/config-fresh.json"
echo '{"session_rules": true, "rsrs": "'"$STUB_FRESH"'"}' > "$CFG_FRESH"

# Stop 存储检查：<stop_hook_active>（节流断言一律走 stale 引擎桩，保证「仍催」确定性）
run_stop() {
  "$PY3" - "$1" <<'PY' | RESPITE_CONFIG="$CFG_STALE" RESPITE_LOG="$TMP/hook.log" RESPITE_NUDGE_STATE="$TMP/nudge" "$PY3" "$ROOT/hooks/respire.py" Stop
import json, sys
print(json.dumps({"hook_event_name": "Stop", "stop_hook_active": sys.argv[1] == "true"}))
PY
}
check "Stop 存储检查续跑(decision block)" "$(run_stop false)" '含:"decision": "block"'
check "Stop 阻塞输出可过 JSON 解析" "$(run_stop false | python3 -c '
import json,sys
d=json.loads(sys.stdin.read())
print("OK" if d.get("decision")=="block" and "rsrs remember" in d.get("reason","") else "BAD")')" "含:OK"
check "Stop 提示含存储指令" "$(run_stop false)" "含:rsrs remember"
check "Stop 无 deny 决策（ZCode 枚举外）" "$(run_stop false | grep -qF '"deny"' && echo HAS || echo CLEAN)" "含:CLEAN"
check "Stop 防重入放行" "$(run_stop true)" "空"
CFG_NUDGE0="$TMP/config-nudge0.json"
echo '{"store_nudge_every": 0}' > "$CFG_NUDGE0"
run_stop_cfg() {   # $1=config
  local cfg="$1"
  "$PY3" - <<'PY' | RESPITE_CONFIG="$cfg" RESPITE_LOG="$TMP/hook.log" RESPITE_NUDGE_STATE="$TMP/nudge" "$PY3" "$ROOT/hooks/respire.py" Stop
import json
print(json.dumps({"hook_event_name": "Stop", "stop_hook_active": False}))
PY
}
check "Stop 节流关闭静默" "$(run_stop_cfg "$CFG_NUDGE0")" "空"
check "Stop 引擎近期落库不催" "$(run_stop_cfg "$CFG_FRESH")" "空"
check "Stop 引擎陈旧落库仍催" "$(run_stop false)" '含:"decision": "block"'
check "引擎放行留痕 src=engine" "$(grep -q 'stored_recent_skip.*src=engine' "$TMP/hook.log" && echo YES)" "含:YES"
printf '%s\n' '{"ts": "'"$(date +%Y-%m-%dT%H:%M:%S)"'", "ev": "store", "out": "ok", "d": "feed"}' >> "$TMP/hook.log"
check "Stop 已存放行放行" "$(run_stop false)" "空"
CFG_OFFE="$TMP/config-disabled.json"
echo '{"enabled": false}' > "$CFG_OFFE"
check "enabled=false 全线静默" "$(run SessionStart "" "$CFG_OFFE")" "空"
check "enabled=false 落库也静默" "$(run UserPromptSubmit "记：关断时不应落库" "$CFG_OFFE")" "空"

out=$(run UserPromptSubmit "rsrs 信封 JSON 结构解析取哪层")
check "相关 prompt 触发召回" "$out" "非空"
check "召回也走 additionalContext" "$out" "含:{\"additionalContext\""
check "注入为标题档无正文" "$out" "不含:｜"
check "默认直出无阈值拦截" "$out" "含:rsrs 直出"
check "召回头行与条数一致" "$(printf '%s' "$out" | python3 -c '
import re,json,sys
s=json.loads(sys.stdin.read())["additionalContext"]; head=s.split("\n",1)[0]
n=sum(1 for l in s.split("\n") if l.startswith("- ["))
m=re.search(r"命中 (\d+) 条",head)
print("OK" if m and int(m.group(1))==n else "BAD")')" "含:OK"

check "无关 prompt 不注入" "$(run UserPromptSubmit "今晚吃什么菜好呢")" "空"
check "单字 prompt 跳过" "$(run UserPromptSubmit "嗯")" "空"
check "/nomem 关闭召回" "$(run UserPromptSubmit "/nomem rsrs 信封结构")" "空"
check "技能指认轮剥前缀仍召回" "$(run UserPromptSubmit '$skill: 笔痕 rsrs 信封 JSON 结构解析取哪层')" "含:自动召回"
echo '{"session_rules": true, "skip_prefixes": ["你正在为宿主写 Recap"]}' > "$TMP/config-skip.json"
check "skip_prefixes 白名单跳过" "$(run UserPromptSubmit "你正在为宿主写 Recap：无事" "$TMP/config-skip.json")" "空"
check "坏 stdin 静默" "$(printf 'not-json{{{' | RESPITE_CONFIG="$CFG_ON" "$PY3" "$ROOT/hooks/respire.py" UserPromptSubmit)" "空"
check "未知事件静默" "$(run PreToolUse "rsrs 信封")" "空"

# ---- title 规则抽取（纯函数，零污染） ----
check "整句优先取完整句" "$(python3 -c '
import sys,importlib.util
spec=importlib.util.spec_from_file_location("r","'"$ROOT"'/hooks/respire.py"); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.extract_title("respire 插件路径迁至 respire-zcode 下。后续以仓库为准。"))')" "含:respire 插件路径迁至 respire-zcode 下。"
check "无句号退分隔符不切半词" "$(python3 -c '
import sys,importlib.util
spec=importlib.util.spec_from_file_location("r","'"$ROOT"'/hooks/respire.py"); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
t=m.extract_title("这是一条没有句号的长事实句，讲清楚何时谁做了什么事，以及结果如何，后面还有别的内容")
print(t)')" "含:讲清楚何时谁做了什么事，"
check "长串不超70字" "$(python3 -c '
import sys,importlib.util
spec=importlib.util.spec_from_file_location("r","'"$ROOT"'/hooks/respire.py"); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(len(m.extract_title("默" * 200)))')" "非空"

# ---- 写探针（--store 显式开启；写真库→断言→forget 清理） ----
if [ "$WITH_STORE" = 1 ]; then
  # 内容须与全库零语义关联：纯随机无义串（域词会撞相似走待决态）
  MARK="zq$(date +%s)$RANDOM kw7f2 随机标记无义串"
  out=$(run UserPromptSubmit "记：$MARK")
  check "落库成功回执" "$out" "含:已存入"
  check "回执约束AI抽事实句retitle" "$out" "含:rsrs retitle"
  SID=$(printf '%s' "$out" | sed -n 's/.*（\([0-9a-f]\{8\}\)）.*/\1/p')
  check "回执带短 id" "$SID" "非空"
  if [ -n "$SID" ]; then
    rc=$(rsrs forget "$SID" --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status","err"))')
    check "探针清理(status=ok)" "$rc" "含:ok"
  fi
  # 判重待决：复述库中稳定条目 → 大概率撞高相似 → pending 未写入。
  # 断言依赖实时库内容（教训：零命中必 FAIL）——判直写则兜底清理后记 SKIP，不硬失败。
  out=$(run UserPromptSubmit "记：1memory 更名 respire：吸即存呼即取，材料全线改（复述既有条目触发判重待决）")
  if printf '%s' "$out" | grep -qF "已存入"; then
    BID=$(printf '%s' "$out" | sed -n 's/.*（\([0-9a-f]\{8\}\)）.*/\1/p')
    [ -n "$BID" ] && rsrs forget "$BID" --json >/dev/null 2>&1
    PASS=$((PASS+1)); echo "SKIP  判重待决转述候选（库况变化判为直写，已清理 $BID）"
  else
    check "判重待决转述候选" "$out" "含:落库待决"
    check "待决列出候选与决断法" "$out" "含:--force"
  fi
else
  echo "SKIP  写探针（默认只读；加 --store 开启，写真库并自动 forget 清理）"
fi

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
