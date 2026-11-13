#!/usr/bin/env python3
"""dsh 桌面版安装轨道（批166，REGRESS-2026-164：special/dsh-desktop）。

把 regress-guard 挂上 DeepSeek dsh 桌面版（DeepSeek Harness）：
  1. 生成 CC 方言钩子清单 hooks.cc.json（ZCODE→CLAUDE 变量替换）入已装根
  2. 确保 @deepseek-ai/dsh-hooks-claude-code 桥包装入目标 profile
     （dsh plugin --profile <p> add …；已在位则跳过）
  3. profile 用户层 cordis.patch.yml 幂等插入桥配置条目
     （configPath=hooks.cc.json，pluginRoot=已装根；projectDir 省略=会话
     cwd——桥文档契约，项目目录随会话走）

接线先例=本机 dsh-advisor（本地插件同走用户 patch 层）。
幂等律：重复安装=无操作；--remove=精确移除本批条目（不动他人条目）；
--check=只诊断不动刀。退出码：0=成功/已在位，1=环境缺件（DSH_HOME/桥包
安装失败），2=用法错。
"""
import argparse
import json
import glob
import os
import subprocess
import sys

BRIDGE_PKG = "@deepseek-ai/dsh-hooks-claude-code"
PROTOCOL_PKG = "@deepseek-ai/dsh-hook-protocol"  # 桥的 peerDependency——宿主侧须显式装
PATCH_ENTRY_ID = "regress-guard-hooks"  # patch 层条目 id（幂等锚）

# matcher 双方言展宽（批166 侦察实证）：桥的 matcher 匹配宿主工具名——
# dsh 注册名是小写 bash/read/write/edit 另有 pwsh（dsh-tool-bash README:
# "registers the `bash` tool"；dsh-tool-fs：read/write/edit）；CC 系是
# Bash/Read/Write/Edit。载荷字段名两家一致（dsh-tool-fs README 明示
# snake_case 对齐 Claude Code——file_path/command 均同）。
MATCHER_WIDEN = {
    "Bash": "Bash|bash|pwsh",
    "Edit|Write|ApplyPatch": "Edit|Write|ApplyPatch|edit|write",
    "Bash|Edit|Write": "Bash|bash|pwsh|Edit|Write|edit|write",
    "Read": "Read|read",  # read_image 不计读（图像不授文本认知，文档留痕）
}

# patch 层语法（dsh schema $defs.includePatch 实证）：顶层条目须 id 定向
# 覆盖既有行或带 insert 列表追加新行——裸新条目会被 warned-and-skipped
# （"entry not found"，批166 活体标本）。insert 无 id=追加到根。
PATCH_ENTRY = """- insert:
  - id: {eid}
    name: "@deepseek-ai/dsh-hooks-claude-code"
    config:
      configPath: {config}
      pluginRoot: {root}
""".format


def _installed_root():
    """已装副本根（与 install.sh 同位）——桥的 pluginRoot/configPath 锚。"""
    return os.path.expanduser("~/.zcode/regress-guard-hooks")


def _hooks_cc_source():
    """源仓 hooks/hooks.json 原文（变量替换的原材料）。"""
    src = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), "hooks", "hooks.json")
    with open(src, encoding="utf-8") as f:
        return f.read()


def generate_hooks_cc(root=None):
    """生成 hooks.cc.json（CC 方言 + dsh 工具名 matcher 展宽）。

    返回写入路径。内容先过 JSON 解析校验（坏替换=坏 JSON 会当场炸，不留
    半成品给桥在运行时拒载）。"""
    root = root or _installed_root()
    text = _hooks_cc_source()
    # 两处方言替换：①变量 ZCODE→CLAUDE（桥契约）；②布局源仓→已装摊平
    # （install.py 把 hooks/scripts/* 拷到已装根——hooks/scripts/ 前缀须剥，
    # 否则钩子进程找不到文件、桥静默含错放行=批166 e2e 活体标本）。
    # 批191 起命令全走 node launcher.js <script>——self_heal.py 之类脚本名
    # 是 launcher 参数而非路径，摊平布局的 lib/ 落位由 launcher 的布局自愈
    # 回退解析（__dirname/<s> 不存在则 __dirname/lib/<s>），此处无需特例。
    text = text.replace("${ZCODE_PLUGIN_ROOT}/hooks/scripts/",
                        "${CLAUDE_PLUGIN_ROOT}/")
    text = text.replace("${ZCODE_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}")
    data = json.loads(text)  # 校验位：替换后必须仍是合法清单
    for _event, groups in data.get("hooks", {}).items():
        for g in groups:
            m = g.get("matcher")
            if m in MATCHER_WIDEN:
                g["matcher"] = MATCHER_WIDEN[m]
    # 批167（dsh 100%）：PostToolUseFailure 无桥点——fail_watch 复挂到
    # PostToolUse 自筛失败（fail_watch.main 的 tool_response 启发式）。
    # 只搬 fail_watch（观察谁在买保险）；plan_bridge 的 ExitPlanMove 无
    # dsh 对应（宿主无计划模式）不搬。
    ptu = data["hooks"].setdefault("PostToolUse", [])
    for g in data.get("hooks", {}).get("PostToolUseFailure", []):
        for h in g.get("hooks", []):
            if "fail_watch" in h.get("command", ""):
                ptu.append({"matcher": g.get("matcher", ""),
                            "hooks": [dict(h)]})
    dest = os.path.join(root, "hooks.cc.json")
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, dest)
    return dest


def _profile_patch_path(dsh_home, profile):
    return os.path.join(dsh_home, "profiles", profile, "cordis.patch.yml")


def patch_entry_present(text, eid=PATCH_ENTRY_ID):
    return f"id: {eid}\n" in text


def install_patch_entry(dsh_home, profile, root=None, config_path=None):
    """用户 patch 层幂等插入桥条目。返回 (changed, path)。"""
    root = root or _installed_root()
    config_path = config_path or os.path.join(root, "hooks.cc.json")
    p = _profile_patch_path(dsh_home, profile)
    text = open(p, encoding="utf-8").read() if os.path.exists(p) else "[]\n"
    if patch_entry_present(text):
        return False, p
    entry = PATCH_ENTRY(eid=PATCH_ENTRY_ID, config=config_path, root=root)
    with open(p, "a", encoding="utf-8") as f:
        if not text.endswith("\n"):
            f.write("\n")
        f.write(entry)
    return True, p


def remove_patch_entry(dsh_home, profile):
    """精确移除本批 insert 条目（'- insert:' 行到下一顶格 '- ' 前，含尾）。"""
    p = _profile_patch_path(dsh_home, profile)
    if not os.path.exists(p):
        return False, p
    lines = open(p, encoding="utf-8").readlines()
    out, i, removed = [], 0, False
    while i < len(lines):
        if lines[i].startswith("- insert:") and i + 1 < len(lines) \
                and f"id: {PATCH_ENTRY_ID}" in lines[i + 1]:
            removed = True
            i += 2
            while i < len(lines) and not lines[i].startswith("- "):
                i += 1
            continue
        out.append(lines[i])
        i += 1
    if removed:
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.writelines(out)
        os.replace(tmp, p)
    return removed, p


def _dsh_version(dsh_bin="dsh"):
    r = subprocess.run([dsh_bin, "-V"], capture_output=True, text=True, timeout=30)
    return (r.stdout or r.stderr).strip()


def _pkg_installed(home, profile, pkg, version=None):
    """实体在位判定：node_modules 里真有包（lock 字符串会被 peerDependency
    声明行误中=批166 假绿活体——桥 peer 声明让 lock 检查恒真）。
    批168：给 version 则须版本精确配对——存在≠正确（web 桥 0.0.1 滞留而
    检查恒过的活体：首装钉死 package.json 版本号，后续 add 同名新版本被
    存在性检查短路）。"""
    pj = os.path.join(home, "profiles", profile, "node_modules", pkg,
                      "package.json")
    if not os.path.isfile(pj):
        return False
    if version is None:
        return True
    try:
        with open(pj, encoding="utf-8") as f:
            import json as _json
            return _json.load(f).get("version") == version
    except (OSError, ValueError):
        return False


def ensure_bridge_pkg(profile, dsh_bin="dsh", home=None):
    """桥+其 peer（protocol）装入 profile workspace——**版本配对 dsh 运行时**。

    批166 e2e 活体标本三连：①裸 add 解析到旧线 0.0.1-rc（与运行时 API 错配
    ——session.events 不可迭代，所有 bash 调用恒错）；②桥把 protocol 声明
    为 peerDependency，宿主不装则桥 import 失败=静默含错放行；③rc 版须
    allow-version 显式接受。故：钉桥@dsh版本 + 先 allow 后装 + peer 同装。
    在位判定走 lock（含两包名才免装）。失败返回 (False, stderr 摘要)。"""
    home = home or os.path.expanduser("~/.dsh")
    ver = None
    try:
        ver = _dsh_version(dsh_bin)
    except Exception:
        ver = None
    if _pkg_installed(home, profile, BRIDGE_PKG, ver) and \
            _pkg_installed(home, profile, PROTOCOL_PKG, ver):
        return True, "已在位（node_modules 实体双包" + (
            f"，版本配对 {ver}" if ver else "") + "）"
    if not ver:
        return False, "无 dsh 可执行——无法确定版本配对目标"
    for act in ("allow", "add"):
        for pkg in (BRIDGE_PKG, PROTOCOL_PKG):
            if act == "add" and _pkg_installed(home, profile, pkg, ver):
                continue
            args = [dsh_bin, "plugin", "--profile", profile]
            if act == "allow":
                args += ["allow-version", f"{pkg}@{ver}",
                         "--dsh-version", ver, "--accept-risk"]
            else:
                args += ["add", f"{pkg}@{ver}"]
            r = subprocess.run(args, capture_output=True, text=True, timeout=600)
            if r.returncode != 0 and act == "add":
                return False, (r.stderr or r.stdout)[-300:]
    return True, f"已安装（版本配对 {ver}）"


NATIVE_PKG = "dsh-regress-guard"
NATIVE_LOCAL_DIR = "local-plugins/dsh-regress-guard"
PLUGIN_SRC = os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "deploy", "dsh-native")


def commands_surface(root=None):
    """命令面实况（批205，公网 issue#3）：已装命令 md 数——dsh 斜杠菜单的
    注册来源（插件扫 ~/.zcode/commands/regress-*.md）。0=命令面缺位
    （install.py 未跑），此时 dsh 只有钩子拦截面、无 /regress-* 入口。"""
    root = root or _installed_root()
    cdir = os.path.join(os.path.dirname(root), "commands")
    try:
        n = [f for f in os.listdir(cdir)
             if f.startswith("regress-") and f.endswith(".md")]
    except OSError:
        return 0, cdir
    return len(n), cdir


def _profile_pkg_json(dsh_home, profile):
    return os.path.join(dsh_home, "profiles", profile, "package.json")


def native_bundle_present(dsh_home, profile):
    p = _profile_pkg_json(dsh_home, profile)
    if not os.path.exists(p):
        return False
    d = json.load(open(p, encoding="utf-8"))
    return NATIVE_PKG in d.get("dsh", {}).get("profile", {}).get("bundles", []) \
        and NATIVE_PKG in d.get("dependencies", {})


def native_install(dsh_home, profile, dsh_bin="dsh"):
    """原生轨道（批169 默认）：本地插件装载 + profile 注册 + 撤桥防双门禁。

    原生优于桥（桥 README 自述）：无序列化边界/无沙箱挂载缺口（进程内
    spawn=真实 fs）/无参数形态方差/失败判定原生。python 钩子链仍是单一
    事实源，插件只是类型化适配层（deploy/dsh-native/lib/index.js）。"""
    dest = os.path.join(dsh_home, NATIVE_LOCAL_DIR)
    # 1. 拷插件体（lib/package.json/cordis.patch.yml——源仓 deploy/dsh-native）
    os.makedirs(dest, exist_ok=True)
    import shutil
    for name in ("package.json", "cordis.patch.yml"):
        shutil.copy2(os.path.join(PLUGIN_SRC, name), os.path.join(dest, name))
    shutil.rmtree(os.path.join(dest, "lib"), ignore_errors=True)
    shutil.copytree(os.path.join(PLUGIN_SRC, "lib"), os.path.join(dest, "lib"))
    # 1.5 装后自验（批216，issue#6）：语法坏则回滚拒装——"装了不能载"从此
    # 不可能过关（标本：块注释内星号斜杠相邻序列提前闭合 → SyntaxError →
    # 插件 100% 拒载，发布后 25 分钟被外部用户抓回）
    for js in sorted(glob.glob(os.path.join(dest, "lib", "*.js"))):
        r = subprocess.run(["node", "--check", js], capture_output=True,
                           text=True, timeout=30)
        if r.returncode != 0:
            shutil.rmtree(os.path.join(dest, "lib"), ignore_errors=True)
            raise SystemExit(f"install_dsh: 装后自验失败（语法坏拒装已回滚）——{js}\n"
                             + (r.stderr or "")[:300])
    # 3.0 插件自有依赖落地（advisor 先例：本地插件目录自带 node_modules——
    # pnpm link 不为 link: 目标装依赖，缺此步=插件 import 失败=拦截静默缺位）
    if not os.path.isdir(os.path.join(dest, "node_modules", "@deepseek-ai")):
        for pm in ("pnpm", "npm"):
            r = subprocess.run([pm, "install", "--silent"], cwd=dest,
                               capture_output=True, text=True, timeout=600)
            if r.returncode == 0:
                break
    # 2. profile 注册：deps link + bundles（advisor 先例同构）
    p = _profile_pkg_json(dsh_home, profile)
    d = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {
        "name": f"dsh-profile-{profile}", "private": True,
        "dependencies": {}, "dsh": {"profile": {"bundles": []}}}
    changed = False
    deps = d.setdefault("dependencies", {})
    if NATIVE_PKG not in deps:
        deps[NATIVE_PKG] = f"link:{dest}"
        changed = True
    bundles = d.setdefault("dsh", {}).setdefault("profile", {}).setdefault("bundles", [])
    if NATIVE_PKG not in bundles:
        bundles.append(NATIVE_PKG)
        changed = True
    if changed:
        tmp = p + ".tmp"
        json.dump(d, open(tmp, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        os.replace(tmp, p)
        r = subprocess.run([dsh_bin, "plugin", "--profile", profile, "install"],
                           capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            return False, f"pnpm install 失败：{(r.stderr or r.stdout)[-200:]}"
    # 3. 撤桥条目（防双门禁；桥包保留在位但无注册=惰性）
    remove_patch_entry(dsh_home, profile)
    return True, "已装载" if changed else "已在位"


def native_remove(dsh_home, profile):
    p = _profile_pkg_json(dsh_home, profile)
    if not os.path.exists(p):
        return False
    d = json.load(open(p, encoding="utf-8"))
    changed = False
    deps = d.get("dependencies", {})
    if NATIVE_PKG in deps:
        deps.pop(NATIVE_PKG)
        changed = True
    bundles = d.get("dsh", {}).get("profile", {}).get("bundles", [])
    if NATIVE_PKG in bundles:
        bundles.remove(NATIVE_PKG)
        changed = True
    if changed:
        tmp = p + ".tmp"
        json.dump(d, open(tmp, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
        os.replace(tmp, p)
    return changed


def main():
    ap = argparse.ArgumentParser(
        description="regress-guard → dsh 桌面版安装轨道（批166 桥/批169 原生）")
    ap.add_argument("--profile", default="web",
                    help="目标 profile（默认 web=桌面版运行形态）")
    ap.add_argument("--dsh-home", default="~/.dsh")
    ap.add_argument("--mode", choices=["native", "bridge"], default="native",
                    help="native=原生插件（批169 默认，无序列化边界/无沙箱挂载缺口）；"
                         "bridge=CC 方言桥（批166 兼容路径）")
    ap.add_argument("--remove", action="store_true",
                    help="移除本批接线（不动他人条目）")
    ap.add_argument("--check", action="store_true",
                    help="只诊断不动刀")
    args = ap.parse_args()
    dsh_home = os.path.expanduser(args.dsh_home)

    if not os.path.isdir(dsh_home):
        print(f"install_dsh: 无 {dsh_home}——本机未装 dsh，无需接入", file=sys.stderr)
        return 1
    profile_dir = os.path.join(dsh_home, "profiles", args.profile)
    if not os.path.isdir(profile_dir):
        print(f"install_dsh: profile {args.profile} 不存在（有："
              + ", ".join(os.listdir(os.path.join(dsh_home, 'profiles')))
              + "）", file=sys.stderr)
        return 2

    if args.mode == "native":
        if args.remove:
            changed = native_remove(dsh_home, args.profile)
            print(f"原生插件注册：{'已移除' if changed else '本无'}"
                  f"（本地插件目录 {NATIVE_LOCAL_DIR} 保留可复用）")
            return 0
        native_here = native_bundle_present(dsh_home, args.profile)
        if args.check:
            bridge_left = patch_entry_present(
                open(_profile_patch_path(dsh_home, args.profile),
                     encoding="utf-8").read()) if os.path.exists(
                _profile_patch_path(dsh_home, args.profile)) else False
            n_cmds, cdir = commands_surface()
            print(f"原生插件：{'在位' if native_here else '缺'} | 桥残留条目："
                  f"{'有（双门禁风险）' if bridge_left else '无'} | "
                  f"命令面：{n_cmds} 个 regress-*.md（{cdir}）")
            if native_here and n_cmds == 0:
                print("install_dsh: 命令面 0——dsh 侧 /regress-* 不会注册"
                      "（钩子面可独立工作）；先跑 python install.py", file=sys.stderr)
                return 1
            return 0 if (native_here and not bridge_left) else 1
        ok, msg = native_install(dsh_home, args.profile)
        n_cmds, cdir = commands_surface()
        print(f"原生插件：{msg}（本地目录 ~/.dsh/{NATIVE_LOCAL_DIR}；"
              "桥条目已撤防双门禁）")
        if n_cmds:
            print(f"命令面：{n_cmds} 个 /regress-* 将注册进 dsh 斜杠菜单"
                  f"（来源 {cdir}；重启 dsh 生效，运行中安装的新命令"
                  "下次 session-start 自动对账入册）")
        else:
            print("⚠️  命令面 0（~/.zcode/commands/ 无 regress-*.md）——"
                  "dsh 侧只有钩子拦截面、无 /regress-* 入口；跑 python install.py 补齐")
        return 0 if ok else 1

    if args.remove:
        removed, p = remove_patch_entry(dsh_home, args.profile)
        print(f"{'已移除' if removed else '本无'}条目：{p}")
        return 0

    root = _installed_root()
    cc = generate_hooks_cc(root)
    print(f"hooks.cc.json 已生成：{cc}")
    patch = _profile_patch_path(dsh_home, args.profile)
    present = (os.path.exists(patch)
               and patch_entry_present(open(patch, encoding="utf-8").read()))
    try:
        _ver = _dsh_version("dsh")
    except Exception:
        _ver = None
    pkg_ok = (_pkg_installed(dsh_home, args.profile, BRIDGE_PKG, _ver)
              and _pkg_installed(dsh_home, args.profile, PROTOCOL_PKG, _ver))

    if args.check:
        print(f"桥+protocol：{'在位' if pkg_ok else '缺'} | patch 条目："
              f"{'在位' if present else '缺'} | hooks.cc.json：在位")
        return 0 if (pkg_ok and present) else 1

    if not pkg_ok:
        ok, msg = ensure_bridge_pkg(args.profile, home=dsh_home)
        print(f"桥包：{msg}")
        if not ok:
            print(f"install_dsh: 桥包安装失败——{msg}", file=sys.stderr)
            return 1
    changed, p = install_patch_entry(dsh_home, args.profile, root)
    print(f"patch 条目：{'已插入' if changed else '已在位'}（{p}）")
    print("完成：dsh 桌面版下次启动会话即载 regress-guard 钩子"
          "（PreToolUse 门禁/边界/先读后改…）；卸载 --remove")
    return 0


if __name__ == "__main__":
    sys.exit(main())
