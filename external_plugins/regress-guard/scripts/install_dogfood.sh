#!/usr/bin/env bash
# install_dogfood — 陌生用户首装 30 分钟路径的机器可跑子集（批138）。
#
# 全链：fresh ZCODE_HOME（真安装零污染本机）→ 四查 → 夹具项目 →
# 已装钩子三面（边界拦/执行阀拦/launcher 门禁过）→ 摩擦清单。
# AI 驱动的 /regress:init 不可自动化——夹具清单代位（planning+approved 形态）。
#
# 用法：bash scripts/install_dogfood.sh；exit 0=全链绿；任何一步红即停并
# 列摩擦点。哨兵轮日跑（顾问：slow 测试缺省跳，此脚本是日跑位）。
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d /tmp/rg-dogfood-XXXXXX)"
export REGRESS_ZCODE_HOME="${TMP}/zcode-home"
mkdir -p "${REGRESS_ZCODE_HOME}/cli"
FRICTION="${TMP}/friction.log"; : > "${FRICTION}"
note() { echo "$1" | tee -a "${FRICTION}"; }
die() { note "❌ $1"; echo "── 摩擦清单 ──"; cat "${FRICTION}"; echo "工作目录保留：${TMP}"; exit 1; }

note "── 1/6 fresh HOME 安装（REGRESS_ZCODE_HOME=${REGRESS_ZCODE_HOME}）"
bash "${SRC}/install.sh" > "${TMP}/install.out" 2>&1 || die "安装失败（见 ${TMP}/install.out）"
note "   安装输出 $(wc -l < "${TMP}/install.out") 行"

note "── 2/6 四查自检"
python3 "${SRC}/scripts/post_install_check.py" "${SRC}" \
    "${REGRESS_ZCODE_HOME}/regress-guard-hooks" \
    "${REGRESS_ZCODE_HOME}/cli/config.json" > "${TMP}/check.out" 2>&1 \
    || die "四查未过（见 ${TMP}/check.out）"
note "   $(tail -1 "${TMP}/check.out")"

note "── 3/6 夹具项目（approved 清单声明全部 staged 文件——F3 逐文件单列纪律）"
PROJ="${TMP}/proj"
mkdir -p "${PROJ}/.regress/manifests" "${PROJ}/src"
git -C "${PROJ}" init -q
git -C "${PROJ}" config user.email t@t.com
git -C "${PROJ}" config user.name t
printf '%s\n' '[pytest]' > "${PROJ}/pytest.ini"
printf '%s\n' 'def test_ok():' '    assert True' > "${PROJ}/test_smoke.py"
printf '%s\n' 'x = 1' > "${PROJ}/src/app.js"
printf '%s\n' 'x = 1' > "${PROJ}/src/other.js"
printf '%s\n' 'x = 1' > "${PROJ}/src/outside.js"   # 越界靶：不 stage 不声明
cat > "${PROJ}/.regress/manifests/R1.md" << 'MF'
---
id: R1
requirement: "dogfood fixture"
status: in-progress
tier: S
rollback: git revert
approved:
  at: "2026-10-23T00:00:00"
  note: "dogfood 夹具"
planned_changes:
  - {id: F1, file: "src/app.js", note: "改一行"}
  - {id: F2, file: "src/other.js", note: "配套"}
  - {id: F3, file: "pytest.ini", note: "测试配置"}
  - {id: F4, file: "test_smoke.py", note: "冒烟测试"}
actual_changes: []
---
MF
# 选择性暂存（src/outside.js 留边界外——git add -A 会把它带进 F3）
git -C "${PROJ}" add .regress pytest.ini test_smoke.py src/app.js src/other.js
note "   夹具就绪（R1 声明 4 文件；src/outside.js 是边界外靶）"

HOOKS="${REGRESS_ZCODE_HOME}/regress-guard-hooks"
run_hook() {  # run_hook <script> <stdin-json> [argv...]
    local script="$1" payload="$2"; shift 2
    printf '%s' "${payload}" | \
        env -u CLAUDE_SESSION_ID -u ZCODE_SESSION_ID \
            CLAUDE_PROJECT_DIR="${PROJ}" \
            "$(command -v python3)" -E "${HOOKS}/${script}" "$@"
}

note "── 4/6 边界守卫：越界编辑（src/outside.js 不在 R1 边界）应拦"
CODE=$(run_hook boundary_guard.py \
    '{"tool_name":"Edit","tool_input":{"file_path":"src/outside.js"}}' \
    >/dev/null 2>&1; echo $?)
[ "${CODE}" = "2" ] || die "越界编辑未被拦（exit=${CODE}）——边界守卫失守"
note "   ✓ exit 2"

note "── 5/6 执行阀：mkfs 应拦"
CODE=$(run_hook execution_valve.py \
    '{"tool_name":"Bash","tool_input":{"command":"mkfs.ext4 /dev/sdz9"}}' \
    >/dev/null 2>&1; echo $?)
[ "${CODE}" = "2" ] || die "灾难命令未被拦（exit=${CODE}）——执行阀失守"
note "   ✓ exit 2"

note "── 6/6 提交门禁：分立提交（launcher 全链：真跑夹具测试）"
CODE=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git commit -m fixture（R1）"}}' \
    | env -u CLAUDE_SESSION_ID -u ZCODE_SESSION_ID \
        CLAUDE_PROJECT_DIR="${PROJ}" \
        node "${HOOKS}/launcher.js" >/dev/null 2>&1; echo $?)
[ "${CODE}" = "0" ] || die "合法提交未过门禁（exit=${CODE}，launcher/门禁日志 ${TMP}）"
note "   ✓ exit 0（门禁跑夹具测试后放行）"

echo ""
echo "═══ 狗粮全链绿（6/6）═══"
echo "摩擦清单（人工复核位）："
cat "${FRICTION}"
rm -rf "${TMP}"
exit 0
