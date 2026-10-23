#!/usr/bin/env python3
"""官方市场提交包蒸馏（v1.88.0，099）。

生成 dist/plugins/regress-guard/——市场契约要求插件目录逐字上 CDN，故剥离
机器专属与开发工具件；同时产出市场条目 JSON（写入对方根 marketplace.json 用）。

排除面（ CONTRIBUTING「禁止机器专属路径」+ dev 工具不面向用户）：
- scripts/publish.py（含凭据文件本机路径）、gen_reference/check_docs（dev 派生）
- tests/、pytest.ini、validate.sh（引用 tests）
- deploy/（VPS 私有运维件）
- 根 marketplace.json（对方市场即注册处，自带一份反而混淆）
- .git、__pycache__、dist
保留 scripts/post_install_check.py——install.sh 的运行时依赖。
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist", "plugins", "regress-guard")

# 注意：.zcode-plugin/ 以点开头但必须保留（清单所在）——只点名排除真 dev 件
EXCLUDE_TOP = {"tests", "deploy", "dist", ".git", ".github", "marketplace.json",
               "pytest.ini", "validate.sh", "__pycache__", ".gitignore",
               ".gitattributes", ".regress"}
EXCLUDE_SCRIPTS = {"publish.py", "gen_reference.py", "check_docs.py",
                   "prepare_marketplace.py"}
EXCLUDE_SUFFIX = (".pyc",)


def build():
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST, exist_ok=True)
    n = 0
    for name in sorted(os.listdir(ROOT)):
        src = os.path.join(ROOT, name)
        if name in EXCLUDE_TOP:
            continue
        if os.path.isdir(src):
            for dirpath, dirnames, filenames in os.walk(src):
                dirnames[:] = [d for d in dirnames
                               if d not in ("__pycache__", ".git")]
                rel_dir = os.path.relpath(dirpath, ROOT)
                for fn in sorted(filenames):
                    if fn.endswith(EXCLUDE_SUFFIX) or fn == ".DS_Store":
                        continue
                    if rel_dir == "scripts" and fn in EXCLUDE_SCRIPTS:
                        continue
                    dst = os.path.join(DIST, rel_dir, fn)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copy2(os.path.join(dirpath, fn), dst)
                    n += 1
        else:
            shutil.copy2(src, os.path.join(DIST, name))
            n += 1
    print(f"dist 就绪：{n} 文件 -> {DIST}")
    return n


def entry():
    """市场条目（写进对方根 marketplace.json 的 plugins 数组）。"""
    m = json.load(open(os.path.join(ROOT, ".zcode-plugin", "plugin.json"),
                       encoding="utf-8"))
    return {
        "name": m["name"],
        "source": "./plugins/regress-guard",
        "description": m["description"],
        "description_i18n": m["description_i18n"],
        "version": m["version"],
        "author": m["author"],
        "category": m.get("category", "developer-tools"),
        "keywords": m.get("keywords", []),
    }


if __name__ == "__main__":
    n = build()
    e = entry()
    out = os.path.join(ROOT, "dist", "marketplace-entry.json")
    json.dump(e, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(out, "a", encoding="utf-8").write("\n")
    print("市场条目：", json.dumps(e, ensure_ascii=False)[:160], "...")
    bad = [p for p in ("publish.py", "gen_reference.py") if os.path.exists(
        os.path.join(DIST, "scripts", p))]
    if bad or n < 60:
        print(f"自检失败：泄漏 {bad} 或文件数异常 {n}", file=sys.stderr)
        sys.exit(1)
    print("自检过：无 dev 工具泄漏，文件数", n)
