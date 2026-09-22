#!/usr/bin/env python3
"""安装后自检（v1.76，065）：三查一屏——公网用户装完即知好坏。

①语法面：已装目录全部 *.py py_compile 零错（半拷贝/截断文件当场现形）
②注册面：hooks.json 引用的每个脚本文件在已装目录存在（注册了却缺文件=首次
  使用才炸的最阴形态）
③版本面：.source 戳 source_version 与源仓 plugin.json 一致（装旧不知旧）
任一红 → exit 1 + 修复指引——装坏要大声失败（顾问"勿砍"项）。

用法：post_install_check.py [源仓根] [已装目录]
缺省：源仓=脚本上两级；已装=~/.zcode/regress-guard-hooks
"""
import json
import os
import sys


def _referenced_scripts(src_root):
    """hooks.json 里 command 串引用到的脚本文件名集合（递归遍历嵌套结构）。"""
    names = set()

    def scan(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "command" and isinstance(v, str):
                    for tok in v.replace('"', " ").split():
                        if tok.endswith((".py", ".js")) and "/" in tok:
                            names.add(os.path.basename(tok))
                else:
                    scan(v)
        elif isinstance(node, list):
            for item in node:
                scan(item)

    try:
        with open(os.path.join(src_root, "hooks", "hooks.json"),
                  encoding="utf-8") as f:
            scan(json.load(f))
    except (OSError, json.JSONDecodeError):
        pass
    return names


def main(src_root=None, installed=None):
    src_root = src_root or os.path.abspath(
        os.path.join(os.path.dirname(__file__), ".."))
    installed = installed or os.path.join(
        os.path.expanduser("~/.zcode"), "regress-guard-hooks")
    fails = []

    # ① 语法面
    py_files = []
    for base, _dirs, files in os.walk(installed):
        if "__pycache__" in base:
            continue
        py_files += [os.path.join(base, f) for f in files if f.endswith(".py")]
    syntax_bad = []
    for p in py_files:
        try:
            with open(p, encoding="utf-8") as f:
                compile(f.read(), p, "exec")  # 纯语法检，不写 pyc
        except Exception as e:
            syntax_bad.append(f"{os.path.relpath(p, installed)}: {e}")
    if syntax_bad:
        fails.append("语法面")
        print(f"❌ 语法面：{len(syntax_bad)} 个文件编译失败")
        for b in syntax_bad[:5]:
            print(f"   · {b}")
    else:
        print(f"✅ 语法面：{len(py_files)} 个 .py 全部编译通过")

    # ② 注册面
    missing = [n for n in sorted(_referenced_scripts(src_root))
               if not os.path.exists(os.path.join(installed, n))]
    if missing:
        fails.append("注册面")
        print(f"❌ 注册面：hooks.json 引用但已装目录缺失 {len(missing)} 个：")
        for n in missing[:5]:
            print(f"   · {n}")
    else:
        refs = _referenced_scripts(src_root)
        print(f"✅ 注册面：hooks.json 引用的 {len(refs)} 个脚本全部在位")

    # ③ 版本面
    try:
        src_ver = json.load(open(
            os.path.join(src_root, ".zcode-plugin", "plugin.json"),
            encoding="utf-8"))["version"]
    except Exception as e:
        src_ver = None
        fails.append("版本面")
        print(f"❌ 版本面：源仓 plugin.json 读不了：{e}")
    stamp_ver = None
    try:
        for line in open(os.path.join(installed, ".source"), encoding="utf-8"):
            if line.startswith("source_version="):
                stamp_ver = line.split("=", 1)[1].strip()
    except OSError:
        pass
    form = ".source 戳"
    if stamp_ver is None:
        # 插件形态（v1.84，市场源安装无戳）：比已装 plugin.json（顾问缓：
        # 探测不到软提示不计红）
        try:
            stamp_ver = json.load(open(
                os.path.join(installed, ".zcode-plugin", "plugin.json"),
                encoding="utf-8"))["version"]
            form = "plugin.json"
        except Exception:
            if src_ver:
                print("⚠️ 版本面：无 .source 戳也无已装 plugin.json"
                      "（非本插件安装形态？）——软提示不计红")
    if src_ver and stamp_ver == src_ver:
        tag = f"（{form}）" if stamp_ver else ""
        print(f"✅ 版本面：已装 v{stamp_ver} == 源仓 v{src_ver}{tag}")
    elif src_ver and stamp_ver:
        fails.append("版本面")
        print(f"❌ 版本面：已装 v{stamp_ver}（{form}） != 源仓 v{src_ver}")

    if fails:
        print(f"\n自检未过（{'/'.join(fails)}）——请重跑 bash "
              f"{os.path.join(src_root, 'install.sh')}；仍红则 "
              f"bash {os.path.join(src_root, 'uninstall.sh')} 后重装", file=sys.stderr)
        return 1
    print("自检三查全绿")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None,
                  sys.argv[2] if len(sys.argv) > 2 else None))
