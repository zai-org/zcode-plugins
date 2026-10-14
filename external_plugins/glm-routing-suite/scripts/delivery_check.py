#!/usr/bin/env python3
"""delivery_check：交付门禁（上游 dsh-routing-suite v1.23-v1.28 语义的移植）。

在向用户宣告"完成"之前必须跑本检查。校验：
  1. file-exists / file-nonempty / encoding-utf8（交付物文件必查三项）
  2. delivery-evidence（证据清单，8 种 kind）

evidence 结构（与上游 schema 同构）：
  {"items": [{"label": ..., "kind": "file|page|image|run|test|text|external|numeric",
              "target": "路径（file/page/image/test 必填）",
              "result": "文本（run/text 必填；external 与 target 二选一）",
              "reviewed": true（page/image 视觉类必须人工复核过）}]}
规则：页面交付物（--url）要求至少一项 reviewed:true 的视觉证据（page/image/external）；
数值不变量（kind=numeric）缺省时给非阻断提示。全部 PASS 才允许宣告完成。

用法：
  python delivery_check.py --file <交付物路径> [--url <页面地址>] --evidence <evidence.json>
  cat evidence.json | python delivery_check.py --file <路径>

纯本地校验：只读文件、只写 stdout，无网络。
"""
import argparse
import json
import os
import sys

ALLOWED_KINDS = {"file", "page", "image", "run", "test", "text", "external", "numeric"}


def check_file(path):
    checks = []
    try:
        st = os.stat(path)
        checks.append({"name": "file-exists", "pass": True,
                       "detail": "%s (%d bytes)" % (path, st.st_size)})
        checks.append({"name": "file-nonempty", "pass": st.st_size > 0,
                       "detail": "%d bytes" % st.st_size})
    except OSError as e:
        checks.append({"name": "file-exists", "pass": False, "detail": str(e)})
        return checks
    try:
        with open(path, "rb") as f:
            head = f.read(65536)
        head.decode("utf-8")  # 严格解码，非法字节抛异常
        checks.append({"name": "encoding-utf8", "pass": True,
                       "detail": "UTF-8 decode OK (head 64KB)"})
    except UnicodeDecodeError as e:
        checks.append({"name": "encoding-utf8", "pass": False, "detail": str(e)})
    return checks


def is_valid_number(s):
    s = s.strip()
    if not s:
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


def check_evidence(ev, has_url):
    checks = []
    items = (ev or {}).get("items")
    if not isinstance(items, list) or not items:
        checks.append({"name": "delivery-evidence", "pass": False,
                       "detail": "missing evidence items — 至少一项：{label, kind, target?, result?, reviewed?}"})
        return checks
    failures = []
    for it in items:
        label = str(it.get("label") or "").strip()
        kind = str(it.get("kind") or "").strip()
        if not label:
            failures.append("empty label")
            continue
        if kind not in ALLOWED_KINDS:
            failures.append("bad kind: %s" % kind)
            continue
        result = str(it.get("result") or "").strip()
        if kind in ("run", "text"):
            if not result:
                failures.append("%s evidence without result" % kind)
            continue
        if kind == "numeric":
            if not is_valid_number(result):
                failures.append("numeric evidence needs a numeric result (e.g. minr=2.07 中的 2.07)")
            continue
        if kind == "external":
            target = str(it.get("target") or "").strip()
            if not target and not result:
                failures.append("external evidence needs target (file) or result (output summary)")
            if target:
                if not os.path.isfile(target) or os.path.getsize(target) <= 0:
                    failures.append("external target not valid file: %s" % target)
            continue
        target = str(it.get("target") or "").strip()
        if not target:
            failures.append("%s evidence without target" % kind)
            continue
        if not os.path.isfile(target) or os.path.getsize(target) <= 0:
            failures.append("target not valid file: %s" % target)
        if kind in ("page", "image") and it.get("reviewed") is not True:
            failures.append("visual not reviewed: %s" % label)
    if has_url:
        has_reviewed_visual = any(
            str(it.get("kind")) in ("page", "image", "external") and it.get("reviewed") is True
            for it in items)
        if not has_reviewed_visual:
            failures.append("page deliverable needs at least one reviewed visual evidence (page/image/external)")
    checks.append({"name": "delivery-evidence", "pass": not failures,
                   "detail": "evidence accepted (%d item(s))" % len(items) if not failures
                   else "; ".join(failures)})
    # v1.28：数值不变量提示（引导，不强杀）
    if all(str(it.get("kind")) != "numeric" for it in items):
        checks.append({"name": "numeric-assertion", "pass": True,
                       "detail": "hint: 若交付物有可测不变量（守恒量/计数/编译通过），加一项 numeric 证据"
                                 "（kind=numeric, result=<数字>）把「我认为对」变成「我验证过」。非阻断。"})
    return checks


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="交付物文件路径")
    ap.add_argument("--url", default=None, help="页面交付物地址（触发视觉证据要求）")
    ap.add_argument("--evidence", default=None, help="evidence JSON 文件路径；缺省从 stdin 读")
    args = ap.parse_args()

    ev = {}
    ev_error = None
    if args.evidence:
        with open(args.evidence, encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = sys.stdin.read()
    if raw.strip():
        try:
            ev = json.loads(raw)
        except ValueError as e:
            ev_error = "evidence JSON 解析失败：%s（Windows 路径请用正斜杠或双反斜杠转义）" % e
    else:
        ev_error = "stdin 为空且未给 --evidence"

    checks = check_file(args.file)
    if ev_error:
        checks.append({"name": "delivery-evidence", "pass": False, "detail": ev_error})
    else:
        checks += check_evidence(ev, bool(args.url))
    ok = all(c["pass"] for c in checks)
    out = {"ok": ok, "checks": checks,
           "verdict": ("PASS — 门禁满足，可以向用户报告完成" if ok
                       else "FAIL — 不得宣告完成；修复未通过项后重跑")}
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
