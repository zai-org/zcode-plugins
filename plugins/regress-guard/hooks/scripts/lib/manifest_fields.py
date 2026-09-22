#!/usr/bin/env python3
"""manifest_fields — 清单 frontmatter 字段读取的单一来源（v1.20 解析收敛）。

历史教训（v1.13–v1.19）：approved/blocked/provisional 块解析正则散布五处，
每加一个状态块要五处同步——4 元组解包 bug（v1.14）与漏改一处（v1.18 冒烟）
都是这笔债的利息。本库只统一"读"；改写（plan_approve 的正则替换）保持本地。

架构守卫：validate.sh 检查 hooks/scripts/*.py（lib 之外）不得出现块解析正则。
"""
import re

FM_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
STATUS_RE = re.compile(
    r"^status:\s*[\"']?(planning|in-progress|verifying|done|completed|cancelled|blocked)",
    re.M)
ACTIVE_STATUS_RE = re.compile(r"status:\s*(planning|in-progress|verifying|blocked)")
ACTIVE_STATUSES = ("planning", "in-progress", "verifying", "blocked")
_OPEN_FP_RE = re.compile(r"^\s+status:\s*open\s*(?:#.*)?$", re.M)  # P1#12：容忍行尾注释（旧模板带注释的清单 open 检测不再恒不中）


def frontmatter(content):
    """frontmatter 原文（不含 --- 包裹）；无则 None。"""
    m = FM_RE.match(content)
    return m.group(1) if m else None


def field(text, key):
    """顶层标量字段（id / base_head / …）。"""
    m = re.search(rf"^{key}:\s*[\"']?([^\"'\n#]*)", text, re.M)
    return m.group(1).strip() if m else ""


def block_value(text, block, key):
    """状态块内字段（approved.at / blocked.need / provisional.at …）；空串=未填。"""
    m = re.search(rf"^{block}:\s*\n((?:[ \t]+.*\n?)+)", text, re.M)
    if not m:
        return ""
    vm = re.search(rf"^[ \t]+{key}:\s*[\"']?([^\"'\n#]*)", m.group(1), re.M)
    return vm.group(1).strip() if vm else ""


def filled(text, block, key="at"):
    """块字段非空（approved.at 非空 = 人类产物直通批准）。"""
    return bool(block_value(text, block, key))


def parse_core(content):
    """一次读全。返回 {id, status, approved_at, provisional_at,
    blocked_reason, blocked_need, open_fragiles}；非清单返回 {}。"""
    fm = frontmatter(content)
    if fm is None:
        return {}
    sm = STATUS_RE.search(fm)
    return {
        "id": field(fm, "id"),
        "status": sm.group(1) if sm else "",
        "approved_at": block_value(fm, "approved", "at"),
        "provisional_at": block_value(fm, "provisional", "at"),
        "blocked_reason": block_value(fm, "blocked", "reason"),
        "blocked_need": block_value(fm, "blocked", "need"),
        "open_fragiles": len(_OPEN_FP_RE.findall(fm)),
    }


def editable(status, approved_at):
    """该清单当前是否允许边界内编辑——可编辑性判定的单一来源。

    in-progress/verifying 可编辑；planning 仅当 approved.at 非空（人类产物直通）；
    blocked 一律拦（批准赋予的编辑权在受阻期间冻结）。
    """
    if status in ("in-progress", "verifying"):
        return True
    if status == "planning":
        return bool(approved_at)
    return False
