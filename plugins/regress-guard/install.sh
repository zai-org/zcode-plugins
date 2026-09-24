#!/usr/bin/env bash
# regress-guard 一键安装器
#
# 用法：bash install.sh
#
# 做的事：
#   1. 把 3 个 skill 复制到 ~/.zcode/skills/
#   2. 把所有命令复制到 ~/.zcode/commands/
#   3. 把 hook 脚本复制到 ~/.zcode/regress-guard-hooks/
#   4. 在 ~/.zcode/cli/config.json 注册 PreToolUse hook
#   5. 在 ~/.zcode/AGENTS.md 注入回归契约
#
# 幂等：重复运行不会重复添加，只会更新。

set -euo pipefail

# ─── 定位插件根目录 ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="${SCRIPT_DIR}"

ZCODE_HOME="${HOME}/.zcode"
SKILLS_DIR="${ZCODE_HOME}/skills"
COMMANDS_DIR="${ZCODE_HOME}/commands"
HOOK_HOME="${ZCODE_HOME}/regress-guard-hooks"
CONFIG_FILE="${ZCODE_HOME}/cli/config.json"
AGENTS_FILE="${ZCODE_HOME}/AGENTS.md"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠️${NC} $1"; }
error() { echo -e "${RED}❌${NC} $1"; }

echo "════════════════════════════════════════════"
echo "  regress-guard 一键安装"
echo "════════════════════════════════════════════"
echo ""

# ─── 前置检查 ─────────────────────────────────────────
if [ ! -d "${ZCODE_HOME}" ]; then
    error "未找到 ~/.zcode/ 目录。请确认已安装 ZCode。"
    exit 1
fi

# 检查 node 和 python3
if ! command -v node >/dev/null 2>&1; then
    error "未找到 node。ZCode 需要 Node.js 运行时。"
    exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
    warn "未找到 python3，hook 将无法运行。请安装 Python 3.6+。"
fi

echo "插件源: ${PLUGIN_ROOT}"
echo "目标:   ${ZCODE_HOME}"
echo ""

# ─── 1. 复制 commands ─────────────────────────────────
mkdir -p "${COMMANDS_DIR}"
for cmd_file in "${PLUGIN_ROOT}"/commands/*.md; do
    [ -f "$cmd_file" ] || continue
    cp "$cmd_file" "${COMMANDS_DIR}/"
    info "command: $(basename "$cmd_file" .md)"
done

# ─── 3. 复制 hook 脚本 ────────────────────────────────
# 放到固定位置（不走插件根，因为用户级 config.json 不支持 ${ZCODE_PLUGIN_ROOT}）
mkdir -p "${HOOK_HOME}/lib"
cp "${PLUGIN_ROOT}/hooks/scripts/launcher.js" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/pre_commit_guard.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/read_before_edit_guard.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/prompt_intercept.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/reflection_check.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/fail_watch.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/risk_watch.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/compact_notice.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/execution_valve.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/boundary_guard.py" "${HOOK_HOME}/"
cp "${PLUGIN_ROOT}/hooks/scripts/stop_notify.py" "${HOOK_HOME}/"  # P0-2(评审2026-023)：注册了却从不拷贝——安装到自愈前每轮 Stop 报文件不存在
cp "${PLUGIN_ROOT}/hooks/scripts/plan_bridge.py" "${HOOK_HOME}/"  # v1.39 原生计划桥（同族教训预防）
cp "${PLUGIN_ROOT}/hooks/scripts/self_heal.py" "${HOOK_HOME}/lib/"
cp "${PLUGIN_ROOT}/hooks/scripts/lib/"*.py "${HOOK_HOME}/lib/"
mkdir -p "${HOOK_HOME}/templates"
cp "${PLUGIN_ROOT}/templates/"*.md "${HOOK_HOME}/templates/"   # v1.26.1：全部模板（product-context 缺部署会断 init 链）
chmod +x "${HOOK_HOME}/pre_commit_guard.py" "${HOOK_HOME}/read_before_edit_guard.py" "${HOOK_HOME}/risk_watch.py" "${HOOK_HOME}/compact_notice.py" "${HOOK_HOME}/execution_valve.py" "${HOOK_HOME}/boundary_guard.py" "${HOOK_HOME}/lib/"*.py 2>/dev/null || true
info "hook 脚本 → ${HOOK_HOME}"

# ─── 4. 注册 hook 到 config.json ──────────────────────
# 用户级 config.json 的 hooks 格式（注意 events wrapper + enabled: true）
mkdir -p "$(dirname "${CONFIG_FILE}")"

# 用 python3 安全地合并 JSON（避免 jq 依赖）
# 用引号包裹 PYEOF 防止 bash 展开变量，用环境变量传值
CONFIG_FILE="${CONFIG_FILE}" HOOK_HOME="${HOOK_HOME}" python3 << 'PYEOF'
import json, os, sys

config_path = os.environ["CONFIG_FILE"]
hook_home = os.environ["HOOK_HOME"]

# hook 配置（用户级，用绝对路径）
hook_entry = {
    "type": "process",
    "command": "node",
    "args": [os.path.join(hook_home, "launcher.js")],
    "timeoutMs": 180000,
    "statusMessage": "regress-guard: 运行测试验证..."
}

new_hooks_block = {
    "enabled": True,
    "events": {
        "PreToolUse": [
            {
                "matcher": "Bash",
                "hooks": [hook_entry]
            }
        ]
    }
}

# 读取现有配置（如果有）
config = {}
if os.path.exists(config_path):
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
        if not isinstance(config, dict):
            config = {}
    except Exception:
        config = {}

# 确保 hooks.enabled = True
if "hooks" not in config:
    config["hooks"] = {}
config["hooks"]["enabled"] = True

# 合并 events（不覆盖其他 hook）
if "events" not in config["hooks"]:
    config["hooks"]["events"] = {}

events = config["hooks"]["events"]

# 检查是否已有 regress-guard 的 hook（避免重复）
pretool = events.get("PreToolUse", [])
already_installed = False
for entry in pretool:
    for h in entry.get("hooks", []):
        args = h.get("args", [])
        if any("launcher.js" in str(a) and "regress-guard" in str(a) for a in args):
            already_installed = True
            break

if not already_installed:
    # 先移除旧的 regress-guard 条目（幂等更新）
    cleaned = []
    for entry in pretool:
        hooks = entry.get("hooks", [])
        filtered = [h for h in hooks
                     if not any("regress-guard" in str(a) for a in h.get("args", []))]
        if filtered:
            cleaned.append({**entry, "hooks": filtered})
    cleaned.append({"matcher": "Bash", "hooks": [hook_entry]})
    events["PreToolUse"] = cleaned

# SessionStart 自愈 hook（每次启动检查文件完整性）
selfheal_entry = {
    "type": "command",
    "command": f'python3 "{os.path.join(hook_home, "lib", "self_heal.py")}"',
    "timeout": 5,
    "statusMessage": "regress-guard: 检查完整性..."
}
session_hooks = events.get("SessionStart", [])
session_cleaned = [h for h in session_hooks
                   if "self_heal" not in json.dumps(h)]
session_cleaned.append({"matcher": "startup", "hooks": [selfheal_entry]})
events["SessionStart"] = session_cleaned

# 先读后改门禁（PreToolUse 拦 Edit/Write + PostToolUse 记 Read）
rbe_path = os.path.join(hook_home, "read_before_edit_guard.py")
pre_edit_entry = {
    "type": "command",
    "command": f'python3 "{rbe_path}" pre',
    "timeout": 5,
    "statusMessage": "regress-guard: 先读后改检查..."
}
post_read_entry = {
    "type": "command",
    "command": f'python3 "{rbe_path}" post',
    "timeout": 5,
    "statusMessage": "regress-guard: 记录读取..."
}
# 加到 PreToolUse（匹配 Edit|Write|ApplyPatch）
pretool2 = events.get("PreToolUse", [])
pretool2 = [e for e in pretool2 if "read_before_edit" not in json.dumps(e)]
pretool2.append({"matcher": "Edit|Write|ApplyPatch", "hooks": [pre_edit_entry]})
events["PreToolUse"] = pretool2
# 加 PostToolUse（匹配 Read）
posttool = events.get("PostToolUse", [])
posttool = [e for e in posttool if "read_before_edit" not in json.dumps(e)]
posttool.append({"matcher": "Read", "hooks": [post_read_entry]})
events["PostToolUse"] = posttool

# UserPromptSubmit hook：需求入口检查
prompt_path = os.path.join(hook_home, "prompt_intercept.py")
prompt_entry = {
    "type": "command",
    "command": f'python3 "{prompt_path}"',
    "timeout": 5,
    "statusMessage": "regress-guard: 需求入口检查..."
}
submit_hooks = events.get("UserPromptSubmit", [])
submit_hooks = [e for e in submit_hooks if "prompt_intercept" not in json.dumps(e)]
submit_hooks.append({"hooks": [prompt_entry]})  # 全匹配=省略 matcher（空串违反 schema ≥1 字符，会致整份 config 被丢弃）
events["UserPromptSubmit"] = submit_hooks

# PostToolUseFailure: 失败信号采集
failwatch_path = os.path.join(hook_home, "fail_watch.py")
fail_entry = {"type": "command", "command": f'python3 "{failwatch_path}"',
              "timeout": 5, "statusMessage": "regress-guard: 失败信号采集..."}
fw_hooks = events.get("PostToolUseFailure", [])
fw_hooks = [e for e in fw_hooks if "fail_watch" not in json.dumps(e)]
fw_hooks.append({"matcher": "Bash|Edit|Write", "hooks": [fail_entry]})
events["PostToolUseFailure"] = fw_hooks

# PostToolUse: 风险与重复信号采集（成功执行后：破坏性动作 + Bash 命令普查）
riskwatch_path = os.path.join(hook_home, "risk_watch.py")
risk_entry = {"type": "command", "command": f'python3 "{riskwatch_path}"',
              "timeout": 5, "statusMessage": "regress-guard: 风险与重复信号采集..."}
rw_hooks = events.get("PostToolUse", [])
rw_hooks = [e for e in rw_hooks if "risk_watch" not in json.dumps(e)]
rw_hooks.append({"matcher": "Bash|Edit|Write", "hooks": [risk_entry]})
events["PostToolUse"] = rw_hooks

# SessionStart(compact): 压缩记忆降级警告
compact_path = os.path.join(hook_home, "compact_notice.py")
compact_entry = {"type": "command", "command": f'python3 "{compact_path}"',
                 "timeout": 5, "statusMessage": "regress-guard: 压缩检查..."}
sc_hooks = events.get("SessionStart", [])
sc_hooks = [h for h in sc_hooks if "compact_notice" not in json.dumps(h)]
sc_hooks.append({"matcher": "compact", "hooks": [compact_entry]})
events["SessionStart"] = sc_hooks

# Stop: 反思检查 + 钩子层自动第二意见（本地顾问，卡死时客观数据直送，
# 未经主AI筛选；超时 1810s 是为自动咨询留余量——正常路径 <1s 返回）
reflect_path = os.path.join(hook_home, "reflection_check.py")
reflect_entry = {"type": "command", "command": f'python3 "{reflect_path}"',
                 "timeout": 90, "statusMessage": "regress-guard: 反思检查..."}
# v1.32 授权门控轮末推送：授权语（自决策…）触发的自主轮收尾推手机"阶段完成"
stopn_path = os.path.join(hook_home, "stop_notify.py")
stopn_entry = {"type": "command", "command": f'python3 "{stopn_path}"',
               "timeout": 8, "statusMessage": "regress-guard: 阶段完成推送(授权轮)..."}
stop_hooks = events.get("Stop", [])
stop_hooks = [h for h in stop_hooks if "reflection_check" not in json.dumps(h)]
stop_hooks.append({"hooks": [reflect_entry, stopn_entry]})  # 同上：v1.27.1 修复——空 matcher 曾致全机钩子零装载
events["Stop"] = stop_hooks

# PreToolUse(Edit|Write|ApplyPatch): 开发边界守卫（检测→拦截：越界编辑在发生前阻断）
boundary_path = os.path.join(hook_home, "boundary_guard.py")
boundary_entry = {"type": "command", "command": f'python3 "{boundary_path}"',
                  "timeout": 5, "statusMessage": "regress-guard: 边界检查..."}
bg_hooks = events.get("PreToolUse", [])
for e in bg_hooks:
    if e.get("matcher") == "Edit|Write|ApplyPatch":
        kept = [h for h in e.get("hooks", []) if "boundary_guard" not in json.dumps(h)]
        e["hooks"] = kept + [boundary_entry]
        break
else:
    bg_hooks.append({"matcher": "Edit|Write|ApplyPatch", "hooks": [boundary_entry]})
# v1.29 旁路收口：Bash 写目标（rm/mv/tee/重定向/sed -i）同样过边界判定
for e in bg_hooks:
    if e.get("matcher") == "Bash":
        kept = [h for h in e.get("hooks", []) if "boundary_guard" not in json.dumps(h)]
        e["hooks"] = kept + [dict(boundary_entry,
                                  statusMessage="regress-guard: 边界检查(Bash)...")]
        break
else:
    bg_hooks.append({"matcher": "Bash", "hooks": [boundary_entry]})
events["PreToolUse"] = bg_hooks

# PreToolUse(Bash): 执行阀（公理四——不可逆命令需显式令牌 REGRESS_CONFIRM=YES）
valve_path = os.path.join(hook_home, "execution_valve.py")
valve_entry = {"type": "command", "command": f'python3 "{valve_path}"',
               "timeout": 5, "statusMessage": "regress-guard: 执行阀检查..."}
pt_hooks = events.get("PreToolUse", [])
# 幂等：逐条目摘除旧阀（保留条目内其他 hook，如 launcher/pre_commit_guard），
# 再把新阀挂进 Bash matcher 的条目（无则新建）——不能按条目整删，会连带丢测试卡点
for e in pt_hooks:
    e["hooks"] = [h for h in e.get("hooks", [])
                  if "execution_valve" not in json.dumps(h)]
for e in pt_hooks:
    if e.get("matcher") == "Bash" and e.get("hooks"):
        e["hooks"].append(valve_entry)
        break
else:
    pt_hooks.append({"matcher": "Bash", "hooks": [valve_entry]})
events["PreToolUse"] = pt_hooks

# v1.39 原生计划模式桥（REGRESS-2026-028）：ExitPlanMode 批准转录 / 拒绝化石。
# 单钩子原子；注册漂移由 self_heal 警示（不自动改用户 config）。
bridge_path = os.path.join(hook_home, "plan_bridge.py")
bridge_post = {"type": "command", "command": f'python3 "{bridge_path}" post',
               "timeout": 5, "statusMessage": "regress-guard: 原生计划转录..."}
bridge_fail = {"type": "command", "command": f'python3 "{bridge_path}" fail',
               "timeout": 5, "statusMessage": "regress-guard: 拒绝计划化石..."}
pb_hooks = events.get("PostToolUse", [])
pb_hooks = [e for e in pb_hooks if "plan_bridge" not in json.dumps(e)]
pb_hooks.append({"matcher": "ExitPlanMode", "hooks": [bridge_post]})
events["PostToolUse"] = pb_hooks
fb_hooks = events.get("PostToolUseFailure", [])
fb_hooks = [e for e in fb_hooks if "plan_bridge" not in json.dumps(e)]
fb_hooks.append({"matcher": "ExitPlanMode", "hooks": [bridge_fail]})
events["PostToolUseFailure"] = fb_hooks

config["hooks"]["events"] = events

# 写回
with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print("hook 已注册到 " + config_path)
PYEOF

info "hook 注册 → ${CONFIG_FILE}"

# ─── 5. 注入 AGENTS.md 回归契约 + 灵魂 ────────────────
AGENTS_FILE="${AGENTS_FILE}" python3 << 'PYEOF'
import os, re

agents_path = os.environ["AGENTS_FILE"]
SOUL_START = "<!-- regress-guard soul start -->"
SOUL_END = "<!-- regress-guard soul end -->"
CONTRACT_START = "<!-- regress-guard start -->"
CONTRACT_END = "<!-- regress-guard end -->"

SOUL = f"""{SOUL_START}
## 工作原则

1. **能推断就别问**——代码/日志/上下文里有答案，直接用
2. **有默认就别选**——给用户"否决权"而非"选择题"
3. **做完了汇报**——别中途请示，做完说结果
4. **自己犯的错自己修**——测试失败自己改，别甩给用户
5. **只问改变交付性质的事**——"做什么"问人，"怎么做"自己定
{SOUL_END}"""

# 契约长度冻结（v1.20 决策）：13 条封顶——每加一条必须并掉一条；长契约会被摘要，被摘要的规则等于没写
CONTRACT = f"""{CONTRACT_START}
## 回归契约

0. **先读后改**：改代码前至少读 2 个相关文件（hook 强制；读后被外部改过的文件指纹不匹配，hook 会拦）
1. **需求解析优先**：从代码推断上下文、检测歧义、自决消歧；计划（planning 状态）须人类批准后才实施——批准前边界守卫拦编辑，不认同就继续对话完善；批准走 lib/plan_approve.py（approved 落产物+漂移检查），人类也可直接填清单 approved.at（产物直通）；**原生计划模式批准由 plan_bridge 钩子自动转录（钩子未生效时 AI 补转录，幂等）**；断点续作用 /regress:resume 从产物层重建现场
2. 开发完跑 /regress:track 发现 F3，直接回写
3. 提交时 hook 自跑测试，被拦后自己修；**脆弱点 open 状态的清单禁止提交**（先 verify 拿证据转 locked，或显式 flagged 挂牌）
4. 紧急用 /regress:bypass <分钟> 临时绕过
5. 改 >=3 个文件时 hook 会触发 pre-mortem：假设出bug最可能是什么？
6. **不可逆命令要令牌**：mkfs/dd if=/force push/DROP/TRUNCATE/项目外 rm -rf 会被执行阀拦，确要执行须显式加 REGRESS_CONFIRM=YES 前缀（禁止习惯性携带）
7. **失败/风险/用户纠正自动入地层**（.regress/journal/，append-only）——别删，那是未来会话的考古资产；重大决策（含否决过的方案）写 .regress/decisions.md
8. **开发边界**：活跃清单外/边界外的文件 Edit/Write 会被 hook **事前拦截**——别绕，扩界的唯一出口是 /regress:track 回写（留痕）；边界不是拖慢，是把 token 和质量都省下来（6B→1B 实证）
9. **受阻是一等状态**：卡住别硬磨别绕过——`plan_approve.py <清单> --block --reason --need` 四问落产物并转达人类（受阻期间边界守卫拦编辑）；解阻后 `--unblock`
10. **假设被证伪别悄悄改**：verify 实测推翻清单推测时，追加「假设失效记录」（was→reality→evidence）+ `journal.py . add assumption_broken`——失效过程比结论值钱
11. **顾问预审（伪全自动）**：计划卡片送顾问预审——顾问有一票否决权（有方向性异议必等人，即使已预授权）无一票批准权；预授权任务无异议才 `--provisional --advisor` 临行（否决窗内 `--cancel` 可停）；知识型受阻先问顾问再 --block；预审意见必须来自真实 consult（audit 可查），不得代笔
12. **验证主权（AVS）**：测试替身的宽松断言（oracle：模拟器不校验什么/mock 不查什么）入脆弱点拓扑单列——单测假阴性之源；感官终验问人只收通过/不通过并落 human_check 化石（verify=human_check:<vid>，门禁验化石存在性不复跑感官）；环境脆弱点落启动预检（含跨服务契约往返断言），禁止"请确保 Redis 已启动"式人读指令；真机联调自主完成，仅感官终验时叫人（"你自己弄！成功后再叫人类！"）

脚本路径（命令文档中 `<插件路径>` 的解析）：lib 脚本一律用已安装路径
`~/.zcode/regress-guard-hooks/lib/`（journal.py / plan_approve.py / history.py 都在），
`<插件路径>/hooks/scripts/lib/` 是源码等价路径。

可用命令：/regress:init, /regress:plan, /regress:track, /regress:verify,
/regress:quick, /regress:bypass, /regress:learn, /regress:evolve,
/regress:trace, /regress:resume, /regress:finish,
/regress:install, /regress:uninstall, /regress:update
{CONTRACT_END}"""

FULL_BLOCK = SOUL + "\n\n" + CONTRACT

if os.path.exists(agents_path):
    content = open(agents_path, encoding="utf-8").read()
    # 先清理旧版标记块（兼容升级）
    for marker_s, marker_e in [(SOUL_START, SOUL_END), (CONTRACT_START, CONTRACT_END)]:
        pattern = re.escape(marker_s) + r".*?" + re.escape(marker_e) + r"\n*"
        content = re.sub(pattern, '', content, flags=re.DOTALL)
    new = content.rstrip() + "\n\n" + FULL_BLOCK + "\n"
else:
    new = "# 用户级指令\n\n" + FULL_BLOCK + "\n"

with open(agents_path, "w", encoding="utf-8") as f:
    f.write(new)
print("AGENTS.md 已注入（含灵魂原则）")
PYEOF

info "AGENTS.md 回归契约已注入"

# ─── 6. 复制 check_docs.py 和 小白指南 ────────────────
mkdir -p "${ZCODE_HOME}/regress-guard-docs"
cp "${PLUGIN_ROOT}/scripts/check_docs.py" "${ZCODE_HOME}/regress-guard-docs/" 2>/dev/null || true
cp "${PLUGIN_ROOT}/docs/小白指南.md" "${ZCODE_HOME}/regress-guard-docs/" 2>/dev/null || true
cp "${PLUGIN_ROOT}/docs/WORKFLOW.md" "${ZCODE_HOME}/regress-guard-docs/" 2>/dev/null || true

# ─── 7. 记录源路径和版本（供自动升级用）────────────────
SOURCE_VERSION="$(python3 -c "import json; print(json.load(open('${PLUGIN_ROOT}/.zcode-plugin/plugin.json')).get('version','0.0.0'))" 2>/dev/null || echo "unknown")"
cat > "${HOOK_HOME}/.source" << META
source_path=${PLUGIN_ROOT}
source_version=${SOURCE_VERSION}
installed_at=$(date -Iseconds)
META
info "版本标记: v${SOURCE_VERSION}（源: ${PLUGIN_ROOT}）"

# ─── v1.76 安装后自检：三查一屏，红即大声失败（装坏当场知） ──
echo ""
if ! python3 "${PLUGIN_ROOT}/scripts/post_install_check.py" \
     "${PLUGIN_ROOT}" "${HOME}/.zcode/regress-guard-hooks"; then
  echo ""
  echo -e "${RED}❌ 安装后自检未过——按上方指引修复后再使用${NC}"
  exit 1
fi

# ─── 完成 ────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}  ✅ regress-guard 安装完成！${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "已安装："
echo "  • 11 个命令（/regress:init 等）"
echo "  • commit 卡点 hook（自动跑测试）"
echo "  • 先读后改门禁 + 文件指纹（读后被外部改过 → 强制重读）"
echo "  • pre-mortem 反思（改≥3文件时触发）"
echo "  • SessionStart 自愈（自动修复缺失文件）"
echo "  • 全自动无感层：失败风暴→scout / 破坏性动作未过审→补审 / 打转检测 / 方向漂移（清单外改动）"
echo "  • SessionStart(compact) 压缩记忆降级警告"
echo "  • 四公理机制："
echo "      公理一 脆弱点挂牌（fragile_points open 禁提交，verify 拿证据转 locked）"
echo "      公理二 认知物质化（决策日志 decisions.md + 文件指纹校验）"
echo "      公理三 考古地层（journal/events.jsonl，失败/风险/纠正化石随 git 入库）"
echo "      公理四 执行阀（不可逆命令需显式令牌 REGRESS_CONFIRM=YES）"
    echo "  • 开发边界守卫（越界编辑事前拦截，track 回写即扩界——6B→1B 的关键机制）"
echo "  • AGENTS.md 回归契约"
echo ""
echo "现在在任意项目中对 AI 说："
echo "  /regress:init    ← 初始化项目"
echo ""
echo "卸载：bash ${PLUGIN_ROOT}/uninstall.sh"
