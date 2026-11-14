#!/usr/bin/env python3
"""facts — 机器事实卡（跨项目地层）v1.32：三层结构。

SKILL.md = 薄索引+路由话（触发时只加载这层，索引每次 record 后机械重建）；
事实本体按域落 references/<域>.md（按需整文件读）——平台三层加载的正形，
形状由构造保证，不靠纪律散文/阈值报警维持（调研定稿，见 REGRESS-2026-017）。

行业对照：Claude Auto Memory=学习时刻自动记（finish 代谢缝）；Cursor 可见面=
索引可扫可删；Generative Agents=recency 一等公民（索引日期倒序，新近在顶）。
铁律：事实带日期=最后一次验证为真；只当线索，动手前照旧取证。
同键（域内标题）重录=刷新日期+以最新表述为准；卡不是审计日志。
v1.31 单文件卡由重录迁移（仅本机存在过一天）。

用法：
  facts.py record "<标题>" "<内容>" [域]
  facts.py health
路径：$RG_FACTS_CARD（指 SKILL.md；references/ 在其同级目录，缺省
~/.zcode/skills/machine-facts/）
"""
import datetime
import os
import re
import sys

STALE_DAYS = 180
RETIRE_DAYS = 270  # v1.51 退场档：>270 天零刷新=死重候选（机制也要代谢）
_HEADING = re.compile(r"^### (\d{4}-\d{2}-\d{2}) · (.+)$")
_FRONTMATTER = """---
name: machine-facts
description: 涉服务器(VPS/SSH/端口/隧道/代理)、通知通道、本机环境与工具坑(zsh/Debian/浏览器自动化/frp)或任何"这台机器踩过的坑"时先读——跨项目沉淀、带日期验证过的机器事实。哪怕只是疑似相关，也值得花十秒扫一眼索引。
---

# 机器事实卡（跨项目地层）

索引按域分文件，本页只是目录——相关域整文件读 references/<域>.md。
事实带日期=最后一次验证为真；只当线索，动手前照旧取证。

<!-- index:begin -->
<!-- index:end -->
"""


def _paths():
    skill = os.environ.get("RG_FACTS_CARD") or os.path.expanduser(
        "~/.zcode/skills/machine-facts/SKILL.md")
    return skill, os.path.join(os.path.dirname(skill), "references")


def _ensure(skill):
    os.makedirs(os.path.dirname(skill), exist_ok=True)
    if not os.path.isfile(skill) or "<!-- index:begin -->" not in open(
            skill, encoding="utf-8").read():
        with open(skill, "w", encoding="utf-8") as f:
            f.write(_FRONTMATTER)  # v1.31 无标记旧卡一次性归零（事实本体已在重录迁移里）


def _domain_file(domain, refs_dir):
    safe = re.sub(r"[^\w\-]+", "_", domain) or "通用"
    return os.path.join(refs_dir, safe + ".md")


def record(title, body, domain="通用", when=None):
    """同键重录=刷新日期+最新表述；返回 'appended'/'refreshed'；随后重建索引。"""
    skill, refs = _paths()
    _ensure(skill)
    os.makedirs(refs, exist_ok=True)
    day = (when or datetime.date.today()).isoformat()
    df = _domain_file(domain, refs)
    try:
        with open(df, encoding="utf-8") as f:
            text = f.read()
    except (IOError, OSError):
        text = f"# {domain}\n"
    lines = text.split("\n")
    action = "appended"
    for i, ln in enumerate(lines):
        m = _HEADING.match(ln)
        if m and m.group(2).strip() == title:
            j = i + 1
            while j < len(lines) and not lines[j].startswith("### "):
                j += 1
            lines = lines[:i] + [f"### {day} · {title}"] + body.strip().split("\n") + [""] + lines[j:]
            action = "refreshed"
            break
    else:
        lines = text.rstrip("\n").split("\n") + ["", f"### {day} · {title}"] + body.strip().split("\n") + [""]
    with open(df, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip("\n") + "\n")
    _rebuild_index(skill, refs)
    return action


def _entries(refs):
    out = []
    if not os.path.isdir(refs):
        return out
    for fn in sorted(os.listdir(refs)):
        if not fn.endswith(".md"):
            continue
        domain = fn[:-3]
        try:
            with open(os.path.join(refs, fn), encoding="utf-8") as f:
                for ln in f:
                    m = _HEADING.match(ln)
                    if m:
                        out.append((m.group(1), domain, m.group(2)))
        except (IOError, OSError):
            pass
    return out


def _rebuild_index(skill, refs):
    entries = sorted(_entries(refs), key=lambda e: (e[0], e[1]), reverse=True)
    rows = [f"- {d} · [{dom}] {t}（references/{dom}.md）" for d, dom, t in entries]
    with open(skill, encoding="utf-8") as f:
        body = f.read()
    new = re.sub(r"<!-- index:begin -->.*?<!-- index:end -->",
                 "\n".join(["<!-- index:begin -->"] + rows + ["<!-- index:end -->"]),
                 body, flags=re.S)
    with open(skill, "w", encoding="utf-8") as f:
        f.write(new)


def health():
    """返回 dict(count, oldest_days, stale=[...], retire=[...])。

    两档代谢（v1.51，B9——机制也要代谢）：stale(>STALE_DAYS)=待验证；
    retire(>RETIRE_DAYS 零刷新)=退场候选——重验/确认失效/退场三选一，
    永不自动删（凝固不删原则不变，考古地层里有史）。"""
    today = datetime.date.today()
    entries = _entries(_paths()[1])
    stale, retire, oldest = [], [], 0
    for date_s, domain, title in entries:
        try:
            age = (today - datetime.date.fromisoformat(date_s)).days
        except ValueError:
            continue
        oldest = max(oldest, age)
        if age > RETIRE_DAYS:
            retire.append((date_s, domain, title))
        elif age > STALE_DAYS:
            stale.append((date_s, domain, title))
    return {"count": len(entries), "oldest_days": oldest,
            "stale": stale, "retire": retire}


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) >= 2 and args[0] == "record":
        title, body = args[1], args[2]
        domain = args[3] if len(args) > 3 else "通用"
        print(record(title, body, domain))
        return 0
    if args and args[0] == "health":
        h = health()
        print(f"机器事实卡：{h['count']} 条 | 最老 {h['oldest_days']} 天 | "
              f"陈旧(>{STALE_DAYS}d) {len(h['stale'])} 条")
        for date_s, domain, title in h["stale"]:
            # 凝固不删（v1.34，sunset 启示）：过期≠失效，先当"待验证"线索用——
            # 验证仍真→重录刷新日期；确证失效→整条删（考古地层里有史）
            print(f"  🧊 {date_s} · {domain} · {title}"
                  f"（待验证：真则重录刷新日期，假则删除）")
        for date_s, domain, title in h["retire"]:
            # v1.51 退场档（B9）：零刷新超龄=死重候选——重验/确认失效/从索引退场
            # 三选一，永不自动删
            print(f"  🥀 {date_s} · {domain} · {title}"
                  f"（退场候选：长期零刷新——重验、删除、或退场三选一）")
        return 0
    print("用法: facts.py record <标题> <内容> [域] | health", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
