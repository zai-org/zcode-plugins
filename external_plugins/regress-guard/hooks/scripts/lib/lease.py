#!/usr/bin/env python3
"""lease — 任务租约域的单一来源（v1.109 批161：异步多执行体治理·步一）。

语义（行业对标 SQS visibility timeout 本地化；顾问预审 2026-10-30）：
- 过期 = 收回**跨会话保护**（门禁 mine/others 分桶 + 边界守卫 foreign 拦截 +
  哨兵 ⏳ 展示），不改 status 不处置清单（self_heal「清单不过期」公理）。
- 无 lease 块 = 旧语义逐位不变（存量清单 back-compat）。
- 格式坏 = 过期（bypass_until 先例——fail-safe 向，坏租约不许继续占边界）。
- input_hash = 边界文件内容钉（顾问使能件）：接管者重算比对即知
  「我接手时边界文件是否已被动过」——非盲接管。

消费方：plan_approve（盖章）/ pre_commit_guard（分桶收回）/ boundary_guard
（编辑拦截收回）/ sentinel（展示+漂移）。本模块只做判定与钉算，不做拦截。
"""
import hashlib
import os
import re
from datetime import datetime, timedelta

TTL_HOURS_DEFAULT = 72.0
_LEASE_BLOCK = re.compile(r"^lease:\s*\n(?:[ \t]+.*\n?)*", re.M)


def ttl_hours(regress_dir):
    """租约 TTL（小时）：config lease.ttl_hours 覆写，坏值回默认 72。"""
    try:
        import json
        with open(os.path.join(regress_dir, "config.json"),
                  encoding="utf-8") as f:
            v = (json.load(f).get("lease") or {}).get("ttl_hours")
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            return float(v)
    except Exception:
        pass
    return TTL_HOURS_DEFAULT


def _git_toplevel(mdir):
    """清单文件相对声明空间的根（提交所在仓 toplevel；无 git 回 .regress 父级）。"""
    try:
        import subprocess
        r = subprocess.run(["git", "-C", mdir, "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def input_hash(manifest_path):
    """边界文件内容钉：声明文件逐个内容哈希（缺失记 absent、读不动记
    unreadable），聚合 sha1[:12]。同机同布局重算确定性——漂移检测的前提。"""
    from manifest_parser import get_all_changed_files
    mdir = os.path.dirname(os.path.abspath(manifest_path))    # .../manifests
    regress_dir = os.path.dirname(mdir)                       # .../.regress
    root = _git_toplevel(mdir) or os.path.dirname(regress_dir)  # 仓根或项目根
    h = hashlib.sha1()
    for f in sorted(get_all_changed_files(manifest_path)):
        fp = os.path.join(root, f.replace("/", os.sep))
        if os.path.isfile(fp):
            try:
                with open(fp, "rb") as fh:
                    h.update(f"{f}:{hashlib.sha1(fh.read()).hexdigest()}\n"
                             .encode())
            except OSError:
                h.update(f"{f}:unreadable\n".encode())
        else:
            h.update(f"{f}:absent\n".encode())
    return h.hexdigest()[:12]


def expired(content):
    """清单全文判定：无块/无 expires_at=False（旧语义）；格式坏=True。"""
    from manifest_fields import block_value
    exp = block_value(content, "lease", "expires_at")
    if not exp:
        return False
    try:
        return datetime.now() >= datetime.fromisoformat(exp)
    except ValueError:
        return True


def expired_from_dict(lease):
    """已解析 frontmatter 的 lease dict 判定（门禁消费 parsed dict，免二次读盘）。"""
    if not isinstance(lease, dict):
        return False
    exp = str(lease.get("expires_at") or "").strip().strip("\"'")
    if not exp:
        return False
    try:
        return datetime.now() >= datetime.fromisoformat(exp)
    except ValueError:
        return True


def drift(content, manifest_path):
    """输入漂移：lease.input_hash 与当前重算不符（无钉=False——不诬告存量清单）。"""
    from manifest_fields import block_value
    pinned = block_value(content, "lease", "input_hash")
    if not pinned:
        return False
    try:
        return pinned != input_hash(manifest_path)
    except Exception:
        return False


def stamp(content, manifest_path, holder):
    """盖/重盖 lease 块（plan_approve 三转写点调用；重盖=接管或续租——
    接管者重跑转写即成新 holder）。无 holder 或钉算失败返回原文
    （租约是增强不是依赖）。插入位：既有 lease 块原位替换，否则插在
    session 行后（无 session 行则 status 行后——与 session 戳同位）。"""
    if not holder:
        return content
    try:
        ih = input_hash(manifest_path)
        mdir = os.path.dirname(os.path.abspath(manifest_path))   # .../manifests
        regress_dir = os.path.dirname(mdir)                      # .../.regress
        expires = (datetime.now()
                   + timedelta(hours=ttl_hours(regress_dir))
                   ).isoformat(timespec="seconds")
    except Exception:
        return content
    block = (f"lease:\n"
             f"  holder: {holder}\n"
             f"  expires_at: \"{expires}\"\n"
             f"  input_hash: {ih}")
    if _LEASE_BLOCK.search(content):
        return _LEASE_BLOCK.sub(block + "\n", content, count=1)
    anchor = (re.search(r"^session:\s*\S+.*$", content, re.M)
              or re.search(r"^status:\s*\S+.*$", content, re.M))
    if anchor:
        return (content[:anchor.start()] + anchor.group(0) + "\n"
                + block + "\n" + content[anchor.end():])
    return content + "\n" + block + "\n"
