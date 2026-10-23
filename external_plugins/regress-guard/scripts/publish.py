#!/usr/bin/env python3
"""发布脚本（v1.87.2，095）——手写发布样板的固化 + 发布消息三查。

为什么固化：发布消息是全插件唯一绕过门禁的提交面——语言分裂（本地中文/
公网英文 9 条）就是从这里漂出来的（2026-09-21 人类抓到）。治漂移靠机器
不靠记性（同 091 套路）。

固化进脚本的既有教训（11 次手写换来的）：
- 发布从 HEAD git 对象取（ls-tree + cat-file），不从工作树——并行臂在途
  改动不会漏上公网；
- 必须带 ls-tree 的真实 mode（15 个 100755 全发 100644 树 sha 必不等）；
- 全树替换（无 base_tree）自动剪除陈旧残留；
- 等值校验走 ref→commit→tree 两跳链——GET /git/trees/main 回显请求对象
  sha 非根树 sha，直查必伪报 MISMATCH。

消息三查（发布面的 092 延伸）：中文在场（2026-09-21 受众裁决）/批号在场
（（NNN）或全 ID）/禁尖括号（发布 JSON 与运营双坑）。--mirror-since 的素材
是本地提交主题——它们已过门禁三查，天然合规。

token 从凭据文件读入只进内存，永不回显。未知参数直接拒绝（gen_reference
静默吞未知 flag 的 #14 教训——argparse 默认行为即所需）。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request

API = "https://api.github.com"
OWNER, REPO = "1339190177", "regress-guard"


def _has_cjk(s):
    return any("\u4e00" <= c <= "\u9fff" for c in s)


def check_message(msg):
    """发布消息三查（095）：返回错误列表（空=通过）。"""
    errs = []
    if not msg or not msg.strip():
        errs.append("消息为空")
    if msg and not _has_cjk(msg):
        errs.append("缺中文（2026-09-21 受众裁决：发布面跟随中文受众，"
                    "外部贡献者出现时再切增量）")
    if msg and not re.search(r"[（(]\d{3}|REGRESS-\d{4}-\d{3}", msg):
        errs.append("缺批号（（NNN 缩写——含「（096，附注）」形态——或全 ID）")
    if "<" in msg or ">" in msg:
        errs.append("含尖括号（发布 JSON 与重定向误判双坑）")
    return errs


def mirror_since(rev):
    """拼接 rev..HEAD 的本地提交主题为发布消息（天然过门禁三查的素材）。"""
    r = subprocess.run(["git", "log", "--format=%s", f"{rev}..HEAD"],
                       capture_output=True, text=True, check=True)
    subjects = [l for l in r.stdout.splitlines() if l.strip()]
    if not subjects:
        return ""
    return "\n".join(subjects)


def _read_token(path):
    with open(os.path.expanduser(path), encoding="utf-8") as f:
        for line in f:
            m = re.search(r'GITHUB_TOKEN:\s*"?([^"\s]+)"?', line)
            if m:
                return m.group(1)
    return None


def _api(tok, path, data=None, method=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(data).encode() if data else None,
        method=method or ("POST" if data else "GET"),
        headers={"Authorization": f"token {tok}",
                 "Accept": "application/vnd.github+json",
                 "User-Agent": "regress-guard-publish"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def _head_tree_items():
    """HEAD 的树条目（真实 mode），从 git 对象取——免疫工作树在途改动。"""
    out = subprocess.run(
        ["git", "-c", "core.quotepath=off", "ls-tree", "-r", "HEAD"],
        capture_output=True, text=True, check=True).stdout.splitlines()
    items = []
    for line in out:
        meta, path = line.split("\t", 1)
        mode, typ, sha = meta.split()
        content = subprocess.run(["git", "cat-file", "blob", sha],
                                 capture_output=True, check=True).stdout
        items.append((mode, path, content))
    return items


def _state_path():
    """状态文件放工作区 .regress（治理状态的家）——不进嵌套仓：
    未跟踪文件会进 test_cache.tree_key，写状态即改缓存键=永不命中死循环。"""
    d = os.getcwd()
    while d != "/":
        cand = os.path.join(d, ".regress")
        if os.path.isdir(cand):
            return os.path.join(cand, "publish-state.json")
        d = os.path.dirname(d)
    return None


def read_state():
    p = _state_path()
    if not p or not os.path.exists(p):
        return {}
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}


def write_state(last_local_head, remote_commit):
    p = _state_path()
    if not p:
        return
    import time
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"last_local_head": last_local_head,
                   "remote_commit": remote_commit,
                   "ts": time.time()}, f, ensure_ascii=False)
    os.replace(tmp, p)


def publish(msg, dry=False, token_file="~/.dsh/.credentials.yaml"):
    items = _head_tree_items()
    local_tree = subprocess.run(
        ["git", "rev-parse", "HEAD^{tree}"],
        capture_output=True, text=True, check=True).stdout.strip()
    if dry:
        print(f"[dry-run] blob 数：{len(items)}")
        print(f"[dry-run] 本地 HEAD 树：{local_tree}")
        print(f"[dry-run] 消息预览：{msg[:80]}...")
        print("[dry-run] 零网络零 token——未发布")
        return 0
    tok = _read_token(token_file)
    if not tok:
        print("publish: 未取到 token（凭据文件无 GITHUB_TOKEN 行）", file=sys.stderr)
        return 1
    tree_items = []
    for mode, path, content in items:
        b = _api(tok, f"/repos/{OWNER}/{REPO}/git/blobs",
                 {"content": content.decode("utf-8", "surrogateescape"),
                  "encoding": "utf-8"})
        tree_items.append({"path": path, "mode": mode, "type": "blob",
                           "sha": b["sha"]})
    t = _api(tok, f"/repos/{OWNER}/{REPO}/git/trees", {"tree": tree_items})
    parent = _api(tok, f"/repos/{OWNER}/{REPO}/git/ref/heads/main")[
        "object"]["sha"]
    c = _api(tok, f"/repos/{OWNER}/{REPO}/git/commits",
             {"tree": t["sha"], "parents": [parent], "message": msg})
    _api(tok, f"/repos/{OWNER}/{REPO}/git/refs/heads/main",
         {"sha": c["sha"]}, method="PATCH")
    ref = _api(tok, f"/repos/{OWNER}/{REPO}/git/ref/heads/main")[
        "object"]["sha"]
    remote_tree = _api(tok, f"/repos/{OWNER}/{REPO}/git/commits/{ref}")[
        "tree"]["sha"]
    if local_tree == remote_tree:
        print(f"SUCCESS 等值：{local_tree[:12]}（本地 HEAD 树 == 公网根树，两跳链）")
        head = subprocess.run(["git", "rev-parse", "HEAD"],
                              capture_output=True, text=True,
                              check=True).stdout.strip()
        write_state(head, ref)
        print(f"状态已记：{head[:12]} → 下次 --mirror-since 缺省即取此点")
        return 0
    print(f"MISMATCH local={local_tree} remote={remote_tree}——停手排查",
          file=sys.stderr)
    return 1


def main():
    ap = argparse.ArgumentParser(
        description="regress-guard 公网发布（Git Data API 全树替换）")
    ap.add_argument("-m", "--message", default="",
                    help="发布消息（须过三查：中文+批号+无尖括号）")
    ap.add_argument("--mirror-since", default="",
                    help="以 rev..HEAD 的本地提交主题拼接为消息（天然合规）")
    ap.add_argument("--dry-run", action="store_true",
                    help="只打印计划，零网络零 token")
    ap.add_argument("--token-file",
                    default="~/.dsh/.credentials.yaml",
                    help="token 凭据文件路径（默认本机约定路径）")
    args = ap.parse_args()
    msg = args.message
    mirror_rev = args.mirror_since
    if not msg and not mirror_rev:
        # 缺省镜像（096）：状态文件的 last_local_head 即上次发布点——免手填 rev
        st = read_state()
        mirror_rev = str(st.get("last_local_head") or "")
        if mirror_rev:
            print(f"镜像区间自动取状态：{mirror_rev[:12]}..HEAD")
        else:
            print("publish: 无 --mirror-since 且状态文件无 last_local_head——"
                  "不空猜区间。给 --mirror-since <rev> 或 -m 显式消息",
                  file=sys.stderr)
            return 2
    if not msg and mirror_rev:
        msg = mirror_since(mirror_rev)
    errs = check_message(msg)
    if errs:
        for e in errs:
            print(f"publish: 消息不合规——{e}", file=sys.stderr)
        print("补法：--mirror-since <rev> 用本地合规主题拼接，或 -m 给中文+"
              "批号（（NNN））+无尖括号的消息", file=sys.stderr)
        return 2
    return publish(msg, dry=args.dry_run, token_file=args.token_file)


if __name__ == "__main__":
    sys.exit(main())
