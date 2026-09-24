#!/usr/bin/env python3
"""解析和更新 .regress/ 回归清单的 YAML frontmatter。

优先使用 PyYAML（鲁棒），fallback 到手写解析器（零依赖）。
"""
import sys
import os
import re
import json
import glob

# ─── 尝试加载 PyYAML ──────────────────────────────────
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


def parse_frontmatter(filepath):
    """解析 Markdown 文件的 YAML frontmatter，返回 dict。

    fail-safe 语义（评审批次一 P0-1b）：
    - 读文件 errors="replace"——非 UTF-8 清单不再让 UnicodeDecodeError 穿透
      到门禁主流程翻成 exit 1（放行）；替换字符解析出的假 status 不在活跃
      词表里，走"无活跃清单"路径，由门禁顶层兜底与调用方校验把关
    - 手写 fallback 的结果若连 id 和 status 都没有，视同解析失败返回 None
      ——坏 YAML 清单必须交阻断（pre_commit_guard 的 None 分支），
      不能静默混成"无活跃清单"放行（2026-09-08 评审 P0 活体路径）
    """
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except (IOError, OSError):
        return None

    fm_match = re.match(r"^---\s*\n(.*?)\n---", content, re.DOTALL)
    if not fm_match:
        # 容错：有开头 --- 但没结尾 ---（用户忘加闭合标记）
        # 尝试取 --- 后到文件尾的全部内容当 YAML
        loose_match = re.match(r"^---\s*\n(.+)", content, re.DOTALL)
        if not loose_match:
            return None
        yaml_text = loose_match.group(1)
    else:
        yaml_text = fm_match.group(1)

    if HAS_YAML:
        try:
            data = yaml.safe_load(yaml_text)
            if isinstance(data, dict):
                return data
            if data is not None:  # YAML 顶层是列表/标量 = 坏清单
                return None
        except yaml.YAMLError:
            pass  # fallback 到手写

    fallback = _parse_fallback(yaml_text)
    if not fallback.get("id") and not fallback.get("status"):
        return None  # 手写解析也拿不到任何字段 → 解析失败，交阻断
    return fallback


def read_frontmatter(filepath, line_cap=200):
    """只读文件的 frontmatter（到闭合 --- 为止），返回文本。

    长寿扫描（v1.23.2）：done 清单逐年堆积后，守卫/反思钩子每次触发仍只付
    O(frontmatter) 而非 O(整文件)；同时天然只搜 frontmatter，正文中引用
    状态词（如报错自救表里写着 status: in-progress）不会让 done 清单诈尸回
    active——旧实现 ACTIVE_STATUS_RE.search(全文) 两头都吃亏。
    无闭合 --- 的容错文件读到 line_cap 行为止（与 parse_frontmatter 的容错语义对齐）。
    """
    out = []
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                out.append(line)
                if i > 0 and line.strip() == "---":
                    break
                if i >= line_cap:
                    break
    except (IOError, OSError):
        return ""
    return "".join(out)


def update_frontmatter(filepath, updates):
    """更新清单的 frontmatter 字段（保留正文不变，加文件锁防并发竞争）。

    Args:
        filepath: 清单文件路径
        updates: dict，要更新/新增的字段
    """
    from filelock import file_lock

    try:
        with file_lock(filepath):
            return _do_update_frontmatter(filepath, updates)
    except Exception:
        # 锁失败时仍尝试写入（降级，不阻断主流程）
        return _do_update_frontmatter(filepath, updates)


def _do_update_frontmatter(filepath, updates):
    """update_frontmatter 的实际实现（无锁）。"""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
    except (IOError, OSError):
        return False

    fm_match = re.match(r"^(---\s*\n)(.*?)(\n---)", content, re.DOTALL)
    if not fm_match:
        return False

    yaml_text = fm_match.group(2)
    body = content[fm_match.end():]

    # 解析现有数据
    if HAS_YAML:
        try:
            data = yaml.safe_load(yaml_text) or {}
        except yaml.YAMLError:
            data = _parse_fallback(yaml_text) or {}
    else:
        data = _parse_fallback(yaml_text) or {}

    # 合并更新
    data.update(updates)

    # 序列化回 YAML
    if HAS_YAML:
        new_yaml = yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)
    else:
        new_yaml = _dump_fallback(data)

    new_content = f"---\n{new_yaml}---{body}"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    return True


def find_active_manifest(regress_dir):
    """找到最新的活跃清单。

    语义反转：只有明确的"活跃" status 才算活跃（本框架自己写的词），
    其余任何词（done/completed/analysis-done/AI自造词）都视为非活跃。
    原因：status 是开放词表，AI 会自造词（如 analysis-done），
    封闭终态表会把自造词误判为活跃 → 误卡提交。
    """
    manifests_dir = os.path.join(regress_dir, "manifests")
    files = sorted(glob.glob(os.path.join(manifest_dir := manifests_dir, "*.md")), reverse=True)
    active_statuses = ("planning", "in-progress", "verifying", "blocked")
    for f in files:
        data = parse_frontmatter(f)
        if data and data.get("status") in active_statuses:
            return f
    return None


def get_all_changed_files(manifest_path):
    """提取所有改动文件（planned + actual）。"""
    data = parse_frontmatter(manifest_path)
    if not data:
        return []
    files = []
    for key in ("planned_changes", "actual_changes"):
        for change in data.get(key, []) or []:
            if isinstance(change, dict) and change.get("file"):
                files.append(change["file"])
    return files


def get_manifest_status(manifest_path):
    data = parse_frontmatter(manifest_path)
    return data.get("status") if data else None


def get_fragile_points(manifest_path):
    """提取脆弱点条目（公理一：脆弱性前置挂牌）。

    每条: {id, kind, description, verify, status}
    status 语义（封闭词表）：
      open    = 已识别但既没锁死也没挂牌 → 禁止提交（pre_commit_guard 拦）
      locked  = verify 命令通过，已锁死
      flagged = 显式带病挂牌（写明知悉原因）
    未列出的脆弱点 = 真正的未知风险（/regress:plan 负责穷举）。
    """
    data = parse_frontmatter(manifest_path)
    if not data:
        return []
    return [fp for fp in (data.get("fragile_points") or []) if isinstance(fp, dict)]


# ─── 手写 fallback 解析器 ─────────────────────────────

def _parse_fallback(yaml_text):
    """零依赖的 YAML frontmatter 解析（处理我们定义的有限结构）。"""
    result = {}
    current_list_key = None
    current_list_item = None

    def flush_item():
        nonlocal current_list_item
        if current_list_key is not None and current_list_item is not None:
            result.setdefault(current_list_key, []).append(current_list_item)
            current_list_item = None

    for line in yaml_text.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped.startswith("- "):
            item_body = stripped[2:]
            if ":" in item_body:
                flush_item()
                key, _, val = item_body.partition(":")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                current_list_item = {}
                if val:
                    current_list_item[key] = (
                        _parse_list(val) if key == "tests_required" else _parse_scalar(val)
                    )
            else:
                if current_list_key is not None:
                    flush_item()
                    result.setdefault(current_list_key, []).append(_parse_scalar(item_body))
            continue

        if current_list_item is not None and line.startswith(" ") and ":" in stripped:
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()
            if key == "tests_required":
                current_list_item[key] = _parse_list(val)
            elif val:
                current_list_item[key] = _parse_scalar(val)
            continue

        if ":" in stripped and not stripped.startswith("-"):
            flush_item()
            key, _, val = stripped.partition(":")
            key = key.strip()
            val = val.strip()
            if val == "":
                result[key] = []
                current_list_key = key
                current_list_item = None
            elif val == "[]":
                result[key] = []
                current_list_key = None
            else:
                result[key] = _parse_scalar(val)
                current_list_key = None

    flush_item()
    return result


def _dump_fallback(data):
    """把手写解析的 dict 序列化回 YAML（简单格式）。"""
    lines = []
    for key, val in data.items():
        if isinstance(val, list):
            if not val:
                lines.append(f"{key}: []")
            else:
                lines.append(f"{key}:")
                for item in val:
                    if isinstance(item, dict):
                        first = True
                        for k, v in item.items():
                            if first:
                                lines.append(f"  - {k}: {_fmt_scalar(v)}")
                                first = False
                            else:
                                lines.append(f"    {k}: {_fmt_scalar(v)}")
                    else:
                        lines.append(f"  - {_fmt_scalar(item)}")
        elif isinstance(val, bool):
            lines.append(f"{key}: {'true' if val else 'false'}")
        elif val is None:
            lines.append(f"{key}: null")
        else:
            lines.append(f"{key}: {_fmt_scalar(val)}")
    return "\n".join(lines) + "\n"


def _fmt_scalar(val):
    if isinstance(val, str):
        return val if val.isdigit() or val in ("true", "false") else f'"{val}"'
    return str(val)


def _parse_scalar(val):
    if val.lower() == "true": return True
    if val.lower() == "false": return False
    if val.lower() in ("null", ""): return None
    try: return int(val)
    except ValueError: pass
    return val.strip('"').strip("'")


def _parse_list(val):
    val = val.strip("[]").strip()
    return [_parse_scalar(v.strip()) for v in val.split(",")] if val else []


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: manifest_parser.py <file> [cmd]"}))
        sys.exit(1)
    path = sys.argv[1]
    cmd = sys.argv[2] if len(sys.argv) > 2 else "full"
    if cmd == "all-changed-files":
        print(json.dumps(get_all_changed_files(path)))
    elif cmd == "status":
        print(json.dumps({"status": get_manifest_status(path)}))
    elif cmd == "yaml-status":
        print("PyYAML: " + ("available" if HAS_YAML else "NOT available, using fallback"))
    else:
        print(json.dumps(parse_frontmatter(path), ensure_ascii=False, indent=2, default=str))
