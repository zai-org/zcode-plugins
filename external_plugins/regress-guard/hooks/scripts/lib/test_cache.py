#!/usr/bin/env python3
"""门禁测试结果缓存（v1.85，074）。

病例：重试场景同一棵树三跑全量（run4-R1 实证 118s×3）——重试多因门禁规则
（staging 丢失/验收格式），树本身没动，全量是纯重复。

立场（顾问已裁）：优化位，非安全边界。伪造缓存跳测者本有更廉价的
/regress:bypass；命中必须大声可审计（stderr ♻️ + commit_passed 事件带
cached/cache_key），TTL 收窄 4h 兜环境漂移窗。

键设计：测试目录所在 git 仓的**内容规范形**——tracked ∪ 未跟踪全路径排序，逐文
件哈希工作树内容。与暂存态/git diff 输出格式/HEAD 彻底解耦（074 两个狗粮标本
的教训：porcelain 状态列与 diff 补丁格式都随暂存态变，同内容会误判不同树）。
.regress/ 整体排除——治理运行时产物（含本缓存文件自身与 history.jsonl）不得
入键，否则写缓存即改键、永不命中（死循环）。只缓存通过结果（失败前必改树，
fail 条目无消费者）。任何异常 = 旁路，行为与无缓存完全一致（缓存是增强不是
依赖）。
"""
import hashlib
import json
import os
import subprocess
import time

_CACHE_FILE = "test-cache.jsonl"
_DEFAULT_TTL_MIN = 240   # 顾问：24h→4h（覆盖分钟级重试窗，收窄环境漂移暴露）
_MAX_ENTRIES = 50


def _cfg(project_dir):
    try:
        with open(os.path.join(project_dir, ".regress", "config.json"),
                  encoding="utf-8") as f:
            return json.load(f).get("test_cache") or {}
    except Exception:
        return {}


def enabled(project_dir):
    """默认开；RG_TEST_CACHE=off 或 config test_cache.enabled=false 关。"""
    if os.environ.get("RG_TEST_CACHE", "").lower() in ("off", "0", "false"):
        return False
    return bool(_cfg(project_dir).get("enabled", True))


def _run_git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args),
                       capture_output=True, text=True, timeout=10)
    return r.stdout if r.returncode == 0 else None


def tree_key(test_dir):
    """测试目录所在 git 仓的内容规范形哈希；非 git 仓/任何失败 → None（旁路）。

    键只认"哪些文件、什么内容"：tracked（ls-files）∪ 未跟踪（porcelain ??）
    全路径排序后逐文件哈希工作树内容，缺失记 absent。与暂存态、git diff 输出
    格式、HEAD 完全解耦——074 两个狗粮标本的根治：①porcelain 状态列区分暂存/
    未暂存，②未跟踪以路径+哈希入键而暂存后以 unified diff 入键（格式不对称），
    两种形态下"同内容不同暂存态"都会误判为不同树、门禁白跑全量。.regress/
    整体排除（治理运行时产物：缓存自身/history/清单 done 戳——它们变了不算树变）。
    """
    try:
        repo = _run_git(test_dir, "rev-parse", "--show-toplevel")
        if not repo or not repo.strip():
            return None
        repo = repo.strip()
        paths = set()
        tracked = _run_git(repo, "ls-files") or ""
        for p in tracked.splitlines():
            p = p.strip().strip('"')
            if p:
                paths.add(p)
        status = _run_git(repo, "status", "--porcelain", "-uall") or ""
        for line in status.splitlines():
            if not line.startswith("??"):
                continue  # tracked 变更的文件已在 ls-files 集合里（键看内容不看状态）
            p = line[3:].strip().strip('"')
            if p:
                paths.add(p)
        h = hashlib.sha256()
        for p in sorted(paths):
            if p == ".regress" or p.startswith(".regress/"):
                continue
            fp = os.path.join(repo, p)
            if os.path.isfile(fp):
                with open(fp, "rb") as f:
                    h.update(f"{p}:{hashlib.sha256(f.read()).hexdigest()}\n".encode())
            else:
                h.update(f"{p}:absent\n".encode())  # tracked 已删（工作树缺失）
        return h.hexdigest()[:16]
    except Exception:
        return None


def _detect_test_dir(project_dir):
    """测试实际运行目录（run_tests 的探测结果，键必须跟着测试走）。"""
    try:
        from test_runner import _detect
        _runner, _cmd, rcwd = _detect(project_dir)
        return rcwd
    except Exception:
        return project_dir


def lookup(project_dir, regress_dir):
    """命中返回 {key, ts, age_min, result}；未命中/关闭/异常 → None。"""
    if not enabled(project_dir):
        return None
    key = tree_key(_detect_test_dir(project_dir))
    if not key:
        return None
    ttl = _cfg(project_dir).get("ttl_minutes") or _DEFAULT_TTL_MIN
    path = os.path.join(regress_dir, _CACHE_FILE)
    try:
        with open(path, encoding="utf-8") as f:
            lines = [l for l in f.read().splitlines() if l.strip()]
    except (IOError, OSError):
        return None
    for line in reversed(lines):  # 最新优先
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("key") != key or e.get("status") != "pass":
            continue
        age_min = (time.time() - float(e.get("ts") or 0)) / 60
        if age_min > ttl:
            continue
        return {"key": key, "ts": e.get("ts"), "age_min": round(age_min),
                "result": e.get("result") or {}}
    return None


def record(project_dir, regress_dir, result):
    """pass 才落账；append jsonl + 裁剪到上限（丢最老）。"""
    if result.get("status") != "pass":
        return False
    key = tree_key(_detect_test_dir(project_dir))
    if not key:
        return False
    entry = {
        "key": key, "ts": time.time(), "status": "pass",
        "runner": result.get("runner"), "passed": result.get("passed"),
        "total": result.get("total"),
        "result": {k: v for k, v in result.items()
                   if k not in ("failures", "raw_snippet")},
    }
    path = os.path.join(regress_dir, _CACHE_FILE)
    try:
        os.makedirs(regress_dir, exist_ok=True)
        lines = []
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                lines = [l for l in f.read().splitlines() if l.strip()]
        lines.append(json.dumps(entry, ensure_ascii=False))
        cap = _cfg(project_dir).get("max_entries") or _MAX_ENTRIES
        lines = lines[-int(cap):]
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.replace(tmp, path)
        return True
    except Exception:
        return False
