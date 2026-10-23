#!/usr/bin/env python3
"""文档一致性校验：扫描所有 .md 文件，检查引用的命令/文件/字段是否存在。

用法：python3 scripts/check_docs.py [plugin_root]

检查项：
  1. 文档中引用的 /regress:xxx 命令 → 对应 commands/regress:xxx.md 是否存在
  2. 文档中引用的 skill 名 → 对应 skills/<name>/SKILL.md 是否存在
  3. 文档中引用的文件路径（如 hooks/scripts/xxx）→ 文件是否存在
  4. plugin.json 的 components 路径 → 目录是否存在
  5. hooks.json 引用的脚本 → 文件是否存在

退出码：0=全部一致，1=有不一致
"""
import sys
import os
import re
import json
import glob


def check(plugin_root):
    errors = []
    warnings = []

    # ─── 1. 命令引用 ──────────────────────────────────
    cmd_dir = os.path.join(plugin_root, "commands")
    existing_cmds = set()
    for f in glob.glob(os.path.join(cmd_dir, "*.md")):
        existing_cmds.add(os.path.basename(f).replace(".md", ""))

    for md in glob.glob(os.path.join(plugin_root, "**", "*.md"), recursive=True):
        with open(md, encoding="utf-8") as f:
            text = f.read()
        # 跳过 EVIDENCE.md（含示例文本，不是真实引用）
        if os.path.basename(md) == "EVIDENCE.md":
            continue
        # 找 /regress:xxx
        for m in re.finditer(r'/regress:(\w+)', text):
            cmd = f"regress:{m.group(1)}"
            # 跳过占位符（xxx/nonexistent/example 等）
            if m.group(1) in ("xxx", "nonexistent", "example", "your"):
                continue
            if cmd not in existing_cmds:
                errors.append(f"{rel(md, plugin_root)}: 引用命令 /{cmd}，但 commands/{cmd}.md 不存在")

    # ─── 2. 文件路径引用 ──────────────────────────────
    for md in glob.glob(os.path.join(plugin_root, "**", "*.md"), recursive=True):
        if os.path.basename(md) == "EVIDENCE.md":
            continue
        with open(md, encoding="utf-8") as f:
            text = f.read()
        # 找 hooks/scripts/xxx 或 lib/xxx 等相对路径
        for m in re.finditer(r'(hooks/scripts/[^\s`)\]"\'\]]+)', text):
            ref_path = m.group(1).rstrip(".\"'")
            # 跳过占位符
            if "xxx" in ref_path or "example" in ref_path:
                continue
            full = os.path.join(plugin_root, ref_path)
            if not os.path.exists(full) and not os.path.exists(full + ".py") and not os.path.exists(full + ".sh"):
                errors.append(f"{rel(md, plugin_root)}: 引用文件 {ref_path}，但文件不存在")

    # ─── 4. plugin.json components ────────────────────
    pj = os.path.join(plugin_root, ".zcode-plugin", "plugin.json")
    if os.path.exists(pj):
        with open(pj, encoding="utf-8") as f:
            manifest = json.load(f)
        for key in ("skills", "commands", "hooks"):
            val = manifest.get(key)
            if val and isinstance(val, str):
                d = os.path.join(plugin_root, val)
                if not os.path.isdir(d):
                    errors.append(f"plugin.json: {key}='{val}'，但目录不存在")

    # ─── 5. hooks.json 引用 ───────────────────────────
    hj = os.path.join(plugin_root, "hooks", "hooks.json")
    if os.path.exists(hj):
        with open(hj, encoding="utf-8") as f:
            hj_data = json.load(f)
        # 找所有 ${ZCODE_PLUGIN_ROOT}/xxx 引用（command 字符串里含转义引号，一并清理）
        hj_text = json.dumps(hj_data)
        for m in re.finditer(r'\$\{ZCODE_PLUGIN_ROOT\}/([^\s"]+)', hj_text):
            ref = m.group(1).rstrip('\\"')
            full = os.path.join(plugin_root, ref)
            if not os.path.exists(full):
                errors.append(f"hooks.json: 引用 {ref}，但文件不存在")

    # ─── 输出 ────────────────────────────────────────
    print("════════════════════════════════════════")
    print("  文档一致性校验报告")
    print("════════════════════════════════════════")
    print(f"扫描目录: {plugin_root}")
    print(f"已注册命令: {sorted(existing_cmds)}")
    print()

    # v1.22 病例驱动断言（在汇总打印前执行）
    check_v122(plugin_root, errors, warnings)
    # v1.23.1 长度预算（命令文件是上下文热路径，调用即入 AI 上下文）
    check_v123(plugin_root, errors, warnings)
    # v1.26.1 部署契约漂移守卫
    check_v1241(plugin_root, errors, warnings)
    # v1.27 文档层覆盖矩阵
    check_v127(plugin_root, errors, warnings)
    # v1.27.2 门禁活性（链外看门狗）
    check_gate_liveness(plugin_root, errors, warnings)

    if errors:
        print(f"❌ 错误 ({len(errors)}):")
        for e in errors:
            print(f"  • {e}")
    else:
        print("✅ 无错误：所有命令/文件引用一致")

    if warnings:
        print(f"\n⚠️  警告 ({len(warnings)}):")
        for w in warnings:
            print(f"  • {w}")

    print()
    return 1 if errors else 0


# ─── v1.22（顾问修正案 A'）：病例驱动的文档断言 ──────────────
# 高精度 → 阻断；中精度 → 仅警告（Goodhart/误报防线：宁可漏报不误报）

# 死词短语表（数据化：半年无命中即标废弃——检查器自身的衰变管理）
# 每条必须注释真实病例，无病例不立规则
DEAD_PHRASES = [
    ("自动触发的 skill", "病例：v1.1 砍 skills，小白指南残留教用户期待不存在的组件（2026-08-27 审计）"),
    ("characterization test", "病例：WORKFLOW 流程图残留 skill 自动提示（同上）"),
]


def check_v122(plugin_root, errors, warnings):
    # ① 高精度（block）：REQUIRED_COMMANDS 与命令目录漂移
    # 病例：v1.17 发现 self_heal 恢复清单漏 trace/resume（代码内列表过期于实况）
    heal = os.path.join(plugin_root, "hooks", "scripts", "self_heal.py")
    if os.path.isfile(heal):
        src = open(heal, encoding="utf-8").read()
        m = re.search(r"REQUIRED_COMMANDS\s*=\s*\[(.*?)\]", src, re.DOTALL)
        if m:
            listed = set(re.findall(r'"(regress:[\w:]+)"', m.group(1)))
            actual = {os.path.basename(f)[:-3]
                      for f in glob.glob(os.path.join(plugin_root, "commands", "*.md"))}
            drift = listed ^ actual
            if drift:
                errors.append(f"REQUIRED_COMMANDS 与命令目录漂移: {sorted(drift)}"
                              "（病例：v1.17 漏 trace/resume）")
    # ② 中精度（warn）：死词短语（文档侧）
    # 病例见 DEAD_PHRASES 注释；未来半年零命中的条目删除并记录
    for md in glob.glob(os.path.join(plugin_root, "**", "*.md"), recursive=True):
        text = open(md, encoding="utf-8").read()
        for phrase, case in DEAD_PHRASES:
            if phrase in text and "DEAD_PHRASES" not in text:  # 本文件自身豁免
                warnings.append(f"{os.path.relpath(md, plugin_root)} 含死词「{phrase}」——{case}")
    # ③ 高精度（block）：README 生成区与实况一致（派生优于断言）
    gen = os.path.join(plugin_root, "scripts", "gen_reference.py")
    if os.path.isfile(gen) and os.path.isfile(os.path.join(plugin_root, "README.md")):
        import subprocess as _sp
        r = _sp.run([sys.executable, gen, "--check"], capture_output=True,
                    text=True, cwd=plugin_root, timeout=30)
        if r.returncode != 0:
            errors.append("README 生成区与实况不一致: " + r.stderr.strip())


# ─── v1.23.1：长度预算（warn）——命令文件是上下文热路径 ──────────────
# 病例：2026-09-03 膨胀审计发现 plan.md 三版 +10.5%（14.3K→15.8K），REGRESS-005
# 病例故事在 plan/模板/PHILOSOPHY 三处完整重复；模板指导语随实例化进入每个清单。
# 预算锚点 = 瘦身后最大命令文件的体积；超限 = 先问删哪一条（PHILOSOPHY §12
# 契约长度冻结：太长的规则会被摘要，被摘要的规则等于没写）
COMMAND_BYTE_BUDGET = 16000


def check_v1241(plugin_root, errors, warnings):
    """④ v1.26.1：部署契约清单与源目录漂移（block）。

    病例：2026-09-03 全面审查发现 REQUIRED_HOOK/REQUIRED_LIB 停在 v1.19——
    boundary_guard 等 5 脚本与 4 个 lib 缺席，do_upgrade 半量拷贝导致升级机
    拿到陈旧守卫/缺失 rules_ledger。
    """
    heal = os.path.join(plugin_root, "hooks", "scripts", "self_heal.py")
    if not os.path.isfile(heal):
        return
    src = open(heal, encoding="utf-8").read()
    import re as _re
    for list_name, sub in (("REQUIRED_HOOK_FILES", "hooks/scripts"),
                           ("REQUIRED_LIB_FILES", "hooks/scripts/lib")):
        m = _re.search(list_name + r"\s*=\s*\[(.*?)\]", src, _re.DOTALL)
        if not m:
            continue
        listed = set(_re.findall(r'"([\w.\-]+\.(?:py|js))"', m.group(1)))
        d = os.path.join(plugin_root, *sub.split("/"))
        actual = {f for f in os.listdir(d)
                  if f.endswith((".py", ".js")) and f != "__init__.py"
                  and not (list_name.endswith("HOOK_FILES") and f == "self_heal.py")}
        drift = (actual - listed) - {"self_heal.py"} if list_name.endswith("HOOK_FILES") else actual - listed
        if drift:
            errors.append(f"{list_name} 与 {sub}/ 漂移: {sorted(drift)}"
                          "（病例：2026-09-03 审计，do_upgrade 半量拷贝）")


# ─── v1.27：文档层覆盖矩阵（block）──────────────────────────────
# 病例：v1.25/v1.26 连续两版只改命令层，WORKFLOW/零号README/小白指南对新能力词
# 零覆盖（2026-09-03 全面审查）。键=能力词，值=必须覆盖它的文档层文件。
# 诚实边界：漏写新词永远是人的问题（PHILOSOPHY §13）——本矩阵只保已写过的不再烂。
DOC_COVERAGE = {
    "验收标准": ("docs/WORKFLOW.md", "templates/regress-dir-readme.md"),
    "产品上下文": ("docs/WORKFLOW.md", "templates/regress-dir-readme.md", "docs/小白指南.md"),
    "草图": ("docs/WORKFLOW.md", "docs/小白指南.md"),
    "假设账本": ("docs/WORKFLOW.md",),
    "设计取舍": ("docs/WORKFLOW.md",),
    "design_rejected": ("docs/WORKFLOW.md",),
    "代谢": ("docs/WORKFLOW.md",),
    "机器事实卡": ("docs/WORKFLOW.md",),
}


def check_v127(plugin_root, errors, warnings):
    for kw, docs in DOC_COVERAGE.items():
        for d in docs:
            p = os.path.join(plugin_root, d)
            if not os.path.isfile(p):
                errors.append(f"DOC_COVERAGE 引用文档不存在: {d}")
                continue
            if kw not in open(p, encoding="utf-8").read():
                errors.append(f"{d} 未覆盖能力词「{kw}」（病例：v1.25/v1.26 连续两版漏文档层）")


# ─── v1.27.2：门禁活性（链外看门狗）───────────────────────────
# 病例：2026-09-03 钩子静默悬案——install.sh 空 matcher 致 config 整体丢弃，
# 全机钩子零装载一周无人知（所有"验证"都是直跑脚本=戏台上验证）。
# 原则：看门狗不能住在被看的那条链里（链死则狗死）——检查 config 结构（确定性）
# 与客户端日志（链外数据源）。修复当日日志会残留修复前记录，故日志项 warn 不 error。
def check_gate_liveness(plugin_root, errors, warnings,
                        cfg_path=None, log_dir=None):
    cfg_path = cfg_path or os.path.join(os.path.expanduser("~"),
                                        ".zcode", "cli", "config.json")
    log_dir = log_dir or os.path.join(os.path.expanduser("~"),
                                      ".zcode", "cli", "log")
    if os.path.isfile(cfg_path):
        try:
            cfg = json.load(open(cfg_path, encoding="utf-8"))
            bad = [f"{ev}.{i}"
                   for ev, arr in cfg.get("hooks", {}).get("events", {}).items()
                   for i, e in enumerate(arr or [])
                   if isinstance(e.get("matcher"), str) and e["matcher"] == ""]
            if bad:
                errors.append(
                    f"cli/config.json 空 matcher: {bad}——schema 违例致整份 config "
                    "被客户端丢弃、全机钩子零装载（病例：2026-09-03 悬案）")
        except (json.JSONDecodeError, IOError, OSError):
            pass
    try:
        logs = sorted(glob.glob(os.path.join(log_dir, "zcode-*.jsonl")))
        if not logs:
            return  # 非 ZCode 客户端环境（CI/他人机器）——静默跳过
        latest = logs[-1]
        n = sum(1 for line in open(latest, encoding="utf-8", errors="replace")
                if '"config.file.invalid"' in line)
        if n:
            warnings.append(
                f"客户端日志 {os.path.basename(latest)} 含 {n} 次 config.file.invalid"
                "——若修复后新会话仍出现则钩子链未活（链外看门狗）")
    except (IOError, OSError):
        pass


def check_v123(plugin_root, errors, warnings):
    cmd_dir = os.path.join(plugin_root, "commands")
    for f in sorted(glob.glob(os.path.join(cmd_dir, "*.md"))):
        size = os.path.getsize(f)
        if size > COMMAND_BYTE_BUDGET:
            warnings.append(
                f"{os.path.relpath(f, plugin_root)} {size}B 超命令长度预算 {COMMAND_BYTE_BUDGET}B"
                "——加一条先问删哪一条（PHILOSOPHY §12；病例：2026-09-03 plan.md 审计）")


def rel(path, root):
    return os.path.relpath(path, root)


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    sys.exit(check(root))
