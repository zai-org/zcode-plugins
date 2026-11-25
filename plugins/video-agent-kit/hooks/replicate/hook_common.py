"""hook 公共层: stdin JSON 读取 / 状态目录 / 三振放行计数器。

原则 (迁移方案 §3):
- hook 只查客观布尔条件, 不查质量;
- 拒绝消息复述"缺什么、写到哪、什么格式" (被拦一次等于被重新教一遍);
- 同一规则连拦 3 次放行并记录违规 (计数器落 ${V2C_HOOK_STATE}, 次选
  ${ZCODE_PLUGIN_DATA}, 兜底 <project>/.v2c/hook_state), 避免把会话楔死。

harness 归一化 (260908, Codex 适配): 各 hook 脚本只认 CC 的事件形态 (tool_name =
Write/Edit/Bash/Agent, tool_input.file_path/command/prompt/subagent_type)。Codex 0.146.0 的
hook 事件 (源码 codex-rs/core/src/tools/hook_names.rs + handlers/*, P0 实跑印证):
  shell / exec_command → tool_name "Bash", tool_input {"command": str}   (与 CC 同名同形)
  apply_patch 独立工具  → tool_name "apply_patch", tool_input {"command": <patch 正文>}
  exec 模式常见形态     → "Bash" 载着 `apply_patch <<'PATCH' …` heredoc, 或 shell 重定向写文件
  spawn_agent           → tool_name "spawn_agent", tool_input {"agent_type", "message"}
  MCP                   → "mcp__<server>__<tool>" 与 CC 一字不差
  view_image            → tool_name "view_image", tool_input {"path": str}, 只发 PreToolUse (260909 本机实测)
若不归一, apply_patch/spawn_agent 会在各 hook 首行 `tool_name != "Write"/"Agent"` 处静默放行,
Bash 里的 heredoc 写文件也不会被当成 Write。所以 read_stdin_json() 在 V2C_AGENT=codex 时把
事件翻成 CC 形态再交给脚本 (原件留 data["_raw"]), rewrite_input() 再把改写翻回 Codex 形态。
这是**唯一**的 harness 感知点; hook 脚本本体一份不分叉。首 N 个原始事件 dump 到
hook_state/codex_events.jsonl 供核对。

Codex 多代理与 CC Agent 的语义对齐也全在 read_stdin_json (260909, E2E 复盘):
  send_input / resume_agent  → PreToolUse 一律 deny (CC 每次委托都是全新上下文, 没有"追加/复活"原语)
  spawn_agent PostToolUse    → 只登记 agent_id↔工单, 不进规则 (CC 的 PostToolUse(Agent) 是委托**完成**时刻)
  wait_agent PostToolUse     → 已登记子代理 completed → 改写成 CC 的 PostToolUse(Agent) 事件 (轮次由 check_workorder 按 out/verify/ 文件数判)
  子代理任何 PreToolUse      → 按 agents/<role>.md 的 tools 白名单放行/deny (CC 靠这份白名单裁子代理工具表,
                               Codex 角色无此机制)。入口: 派生 hooks.json 里的 catch-all 组 → codex_tool_gate.py
"""
from __future__ import annotations
import json
import os
import re
import sys
from pathlib import Path

# --- harness 归一化 ---------------------------------------------------------

# Codex hook 事件里的工具名 → CC 工具名 (hooks.json 的 matcher 由管线 staging 翻译, 这里翻 stdin)。
# "Bash" 是 Codex 0.146 给 shell 类工具的正式 hook 名 (hook_names.rs HookToolName::bash()), 与 CC
# 同名 —— 仍列进来是因为 Codex 下的 Bash 命令要再按内容分成 Write (apply_patch heredoc) / Bash。
_CODEX_TOOL_MAP = {
    "apply_patch": "Write",
    "Bash": "Bash", "shell": "Bash", "exec_command": "Bash", "shell_command": "Bash", "local_shell": "Bash",
    "write_stdin": "Bash", "unified_exec": "Bash",
    "spawn_agent": "Agent",
    # multi_agent_v1 的其余原语 (0.146 首请求 tools 实拍: close_agent/resume_agent/send_input/wait_agent):
    #   send_input / resume_agent 往旧子代理塞新工单或复活已关子代理 —— CC 无此原语, PreToolUse 一律 deny;
    #   wait_agent 返回 completed 的那一刻才等于 CC 的 Agent 工具返回 (PostToolUse 归一化见 _codex_wait_result);
    #   close_agent 无 CC 对应也无规则, 只为白名单判定归到 Agent
    "send_input": "Agent", "resume_agent": "Agent", "wait_agent": "Agent", "close_agent": "Agent",
    "update_plan": "TodoWrite",
    "view_image": "Read",
}
_CODEX_REUSE_AGENT_TOOLS = ("send_input", "resume_agent")
# Codex hook 事件的 tool_name 带 namespace 前缀且无分隔符 (0.146 与 0.154 同一探针实拍): v1 的
# wait_agent/send_input/close_agent/resume_agent 到 hook 时叫 multi_agent_v1wait_agent 等, 只有
# spawn_agent 有不带前缀的别名; v2 全带 collaboration 前缀。剥掉后才落得进 _CODEX_TOOL_MAP。
_CODEX_TOOL_NAMESPACES = ("multi_agent_v1", "collaboration")


def _codex_short_name(raw_name: str) -> str:
    short = raw_name.rsplit("/", 1)[-1]
    if short in _CODEX_TOOL_MAP:
        return short
    for ns in _CODEX_TOOL_NAMESPACES:
        if short.startswith(ns) and short[len(ns):] in _CODEX_TOOL_MAP:
            return short[len(ns):]
    return short
# CC 的 Agent 每次委托都是全新上下文, 验收官不带上一轮的判决/图片。Codex 多出 send_input 能往同一个
# 验收官里塞新工单 —— 260908 E2E 实拍: 模型 spawn 一次后三次 sweep 全走 send_input, 单个验收官线程
# 涨到 621 条 item / 97 图, 一人吃掉 300 次调用预算的 82%, 且绕过 check_workorder (matcher 只罩
# spawn_agent)。resume_agent 同病 (复活已 close 的线程连同全部旧上下文)。Codex 侧要与 CC 表现一致, 只能禁掉。
_CODEX_SEND_INPUT_DENY = (
    "{tool} is not available: every verification needs a fresh verifier (as with a Claude Code Agent "
    "delegation, it carries no verdicts or images from the previous round). Close the old verifier with "
    "close_agent, then start a new one with spawn_agent(agent_type=\"v2c-verifier\", message=<new work order>); "
    "wait for the result with wait_agent.")
# spawn_agent 返回的 agent_id → 工单/角色 (state_dir()/codex_agents.json)。CC 的 PostToolUse(Agent) 在委托
# 委托**完成**时触发 (轮次由 check_workorder 按 out/verify/ 文件数判); Codex 的 spawn_agent 一返回就触发 PostToolUse, 磁盘上还没有本轮
# 文件。所以 spawn 的 PostToolUse 只登记不进规则,
# wait_agent 返回 {"status": {<id>: {"completed": <报告>}}} 时再翻成 CC 的 Agent 完成事件。
_CODEX_AGENTS_FILE = "codex_agents.json"
# apply_patch 正文里的文件头 (codex apply_patch 语法)
_PATCH_FILE_RE = re.compile(r"^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$", re.M)
_PATCH_MOVE_RE = re.compile(r"^\*\*\* Move to: (.+?)\s*$", re.M)
# exec 模式下模型常用 exec_command 跑 `apply_patch <<'PATCH' ... PATCH` (Codex 拦截执行), hook 里是 "Bash";
# 其余写文件走 shell 重定向。apply_patch 只认**命令位** (行首 / ; & | ( 之后, 可带 VAR=x 前缀), 且只在
# 剥掉 heredoc 正文之后的命令骨架上找 —— 260908 P0 第三轮: 模型把 hook 的拒绝原文 (内含被拒的
# apply_patch 命令全文) `cat > out/probe_hook_deny.txt <<'EOF'` 写进笔记, 正文里的 "apply_patch <<'PATCH'
# *** Add File: app/src/..." 被当成真写 app/src 拦了两次, 连带把 plan_before_code 的三振打满释放,
# 后面真写 app/src 的重定向反而放行。
_APPLY_PATCH_CMD_RE = re.compile(r"(?:^|[;&|(`]|\$\()[ \t]*(?:\w+=\S*[ \t]+)*apply_patch\b", re.M)
# heredoc: <<[-]['"]?TAG['"]? ... 独占一行的 TAG 结束 (<<- 允许前导 tab)
_HEREDOC_OPEN_RE = re.compile(r"<<(-?)[ \t]*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\2")
# shell 覆盖写目标: 单个 > (>> 追加不算) 与 tee 无 -a; `->` 箭头不是重定向 (260918 首跑: 注释里的
# "apex f28 -> apex f64" 被当成写 apex, 白烧 strike)
_REDIRECT_RE = re.compile(r"(?<![>&\d-])>(?!>)\s*(?:\||&)?\s*([^\s;&|<>()]+)")
_TEE_RE = re.compile(r"\btee\s+(?!-a\b)((?:-\S+\s+)*)([^\s;&|<>()-][^\s;&|<>()]*)")
_SHELL_WRITE_IGNORE = ("/dev/null", "/dev/stderr", "/dev/stdout", "&1", "&2")
# 骨架里整行的 shell 注释 (行首可选空白 + # 到行尾) 是数据不是命令。只剥整行: 行内 `#` 可能在引号里
# (python -c "print('a # b')" > x.log), 剥了会连真目标一起吞掉
_SHELL_COMMENT_RE = re.compile(r"^[ \t]*#[^\n]*", re.M)
# 命令里第一个 `cd <dir>`: 之后的相对重定向目标以它为基 (260918 首跑: `cd out/cmp/r1 && cat > x.py`
# 被按项目根解析成 x.py 拦下)。目标是变量/`-`/`~` 时不解析
_CD_RE = re.compile(r"(?:^|[;&|(]|&&|\|\|)\s*cd\s+([^\s;&|()]+)", re.M)
_CODEX_DUMP_MAX = int(os.environ.get("V2C_CODEX_EVENT_DUMP_MAX", "0"))   # 每容器最多留多少条原始事件 (P0 核对用, 不是常驻日志; 探针可调大)

_LAST_EVENT: dict = {}   # rewrite_input 反翻译要用原件; 一个 hook 进程只处理一个事件


def harness() -> str:
    return (os.environ.get("V2C_AGENT") or "cc").strip().lower() or "cc"


def under_zcode() -> bool:
    """ZCode 宿主 (harness 没有用 V2C_AGENT 指定时): 插件进程能读到 ZCODE_PLUGIN_ROOT / ZCODE_PLUGIN_DATA。"""
    if (os.environ.get("V2C_AGENT") or "").strip():
        return False
    return bool(os.environ.get("ZCODE_PLUGIN_ROOT") or os.environ.get("ZCODE_PLUGIN_DATA"))


def _shell_command_text(v) -> str:
    """Codex shell 的 command 可能是 argv 列表 (["bash","-lc","<script>"]); 取脚本本体。"""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        parts = [str(x) for x in v]
        if len(parts) >= 3 and parts[0].rsplit("/", 1)[-1] in ("bash", "sh", "zsh") \
                and parts[1] in ("-lc", "-c"):
            return parts[2]
        return " ".join(parts)
    if isinstance(v, dict):
        return _shell_command_text(v.get("command") or v.get("cmd") or "")
    return str(v or "")


def _split_heredocs(cmd: str) -> tuple[str, list[str]]:
    """把 shell 命令拆成 (命令骨架, [heredoc 正文...]): 骨架里每段 heredoc 正文换成占位, 正文按出现
    顺序返回。骨架用来找命令位的 apply_patch / 重定向目标 (正文里的 `>` / "apply_patch" 都是数据不是命令);
    正文用来取 apply_patch 的 patch 文本。找不到结束 TAG 时正文取到末尾。"""
    bodies: list[str] = []
    out: list[str] = []
    lines = cmd.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        m = _HEREDOC_OPEN_RE.search(line)
        if not m:
            out.append(line)
            i += 1
            continue
        dash, tag = m.group(1), m.group(3)
        out.append(line[:m.end()] + f" __HEREDOC_{len(bodies)}__" + line[m.end():])
        body: list[str] = []
        i += 1
        while i < len(lines):
            probe = lines[i].lstrip("\t") if dash else lines[i]
            if probe.rstrip() == tag:
                i += 1
                break
            body.append(lines[i])
            i += 1
        bodies.append("\n".join(body))
    return "\n".join(out), bodies


def _apply_patch_text(cmd: str) -> str | None:
    """命令位有 apply_patch → 返回它的 patch 文本 (紧随其后的 heredoc 正文; 没有 heredoc 时退回整条命令);
    命令位没有 apply_patch → None。"""
    skeleton, bodies = _split_heredocs(cmd)
    m = _APPLY_PATCH_CMD_RE.search(skeleton)
    if not m:
        return None
    tail = skeleton[m.end():].split("\n", 1)[0]
    h = re.search(r"__HEREDOC_(\d+)__", tail)
    if h:
        return bodies[int(h.group(1))]
    return cmd


def shell_write_targets(cmd: str) -> list[str]:
    """Overwrite targets of a shell command: `>` redirections (not `>>`) and `tee` without -a, found
    on the command skeleton with heredoc bodies and shell comments stripped (a `>` inside either is
    data). Relative targets are joined onto the command's first `cd <dir>` when it has one, so the
    caller resolves them against the directory the shell will actually be in."""
    skeleton, _ = _split_heredocs(cmd)
    skeleton = _SHELL_COMMENT_RE.sub("", skeleton)
    targets = [t.strip("'\"") for t in _REDIRECT_RE.findall(skeleton)]
    targets += [m[1].strip("'\"") for m in _TEE_RE.findall(skeleton)]
    targets = [t for t in targets if t and not t.startswith(_SHELL_WRITE_IGNORE) and not t.startswith("$")]
    cd = _CD_RE.search(skeleton)
    base = cd.group(1).strip("'\"") if cd else ""
    if base and not base.startswith(("$", "-", "~")):
        targets = [t if t.startswith("/") else f"{base.rstrip('/')}/{t}" for t in targets]
    return targets


def _normalize_codex(data: dict) -> None:
    """就地把 Codex 事件翻成 CC 形态。原件存 data["_raw"] = {tool_name, tool_input, keymap};
    keymap 记录 归一化键 → 原键 (含 command 的 argv 形态), 供 rewrite_input 反翻译。"""
    raw_name = str(data.get("tool_name") or "")
    raw_input = data.get("tool_input")
    raw_input = raw_input if isinstance(raw_input, dict) else {}
    short = _codex_short_name(raw_name)
    if short not in _CODEX_TOOL_MAP:
        return   # MCP 全名 (mcp__plugin_video-agent-kit_*) 与 CC 一致, 其余未知名原样
    cc_name = _CODEX_TOOL_MAP[short]
    ti: dict = dict(raw_input)
    keymap: dict = {}
    if cc_name == "Write":
        # apply_patch 独立工具: 0.146 源码把 patch 正文放在 "command" 键; 其余键名兼容别的版本
        patch = ""
        for k in ("command", "input", "patch", "content", "diff"):
            if isinstance(raw_input.get(k), str):
                patch = raw_input[k]
                keymap["_patch_key"] = k
                break
        paths = _PATCH_FILE_RE.findall(patch) + _PATCH_MOVE_RE.findall(patch)
        ti["file_paths"] = paths
        ti["file_path"] = paths[0] if paths else (raw_input.get("file_path") or raw_input.get("path") or "")
    elif cc_name == "Bash":
        src_key = next((k for k in ("command", "cmd", "script") if k in raw_input), "command")
        keymap["command"] = src_key
        cmd = _shell_command_text(raw_input.get(src_key))
        ti["command"] = cmd
        patch = _apply_patch_text(cmd)
        if patch is not None and "*** Begin Patch" in patch:
            # 命令位跑 apply_patch heredoc = CC 的 Write/Edit (路径只从它的 patch 正文取)
            cc_name = "Write"
            paths = _PATCH_FILE_RE.findall(patch) + _PATCH_MOVE_RE.findall(patch)
            ti["file_paths"] = paths
            ti["file_path"] = paths[0] if paths else ""
        else:
            # plain shell **overwrite** targets also count as writing a file (scope gate uses them);
            # only > and tee, never >> appends; found on the skeleton with heredoc bodies stripped
            targets = shell_write_targets(cmd)
            if targets:
                ti["file_paths"] = targets
    elif cc_name == "Agent":
        pk = next((k for k in ("message", "prompt", "task", "instructions", "input")
                   if isinstance(raw_input.get(k), str)), "message")
        ak = next((k for k in ("agent_type", "subagent_type", "role", "agent") if k in raw_input), "agent_type")
        keymap["prompt"], keymap["subagent_type"] = pk, ak
        ti["prompt"] = str(raw_input.get(pk) or "")
        ti["subagent_type"] = str(raw_input.get(ak) or "")
    elif cc_name == "Read":
        ti["file_path"] = raw_input.get("path") or raw_input.get("file_path") or ""
    data["_raw"] = {"tool_name": raw_name, "tool_input": raw_input, "keymap": keymap}
    data["tool_name"] = cc_name
    data["tool_input"] = ti


def _dump_codex_event(data: dict) -> None:
    """首 N 条原始事件留痕 (P0 核对 Codex hook stdin 形态; 图片类大字段截断)。"""
    try:
        d = state_dir()
        f = d / "codex_events.jsonl"
        n = sum(1 for _ in f.open()) if f.exists() else 0
        if n >= _CODEX_DUMP_MAX:
            return
        slim = json.loads(json.dumps(data, ensure_ascii=False, default=str))
        for k in ("tool_response",):
            if k in slim:
                slim[k] = str(slim[k])[:1500]
        ti = slim.get("tool_input")
        if isinstance(ti, dict):
            for k, v in ti.items():
                if isinstance(v, str) and len(v) > 1500:
                    ti[k] = v[:1500] + f"...(+{len(v) - 1500})"
        with f.open("a") as fh:
            fh.write(json.dumps(slim, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _json_or_none(v):
    """字符串形态的 JSON → 对象; 其余原样 (Codex 的 tool_response 对函数工具是输出字符串, CC 给结构)。"""
    if isinstance(v, str) and v.lstrip()[:1] in ("{", "["):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return v if isinstance(v, (dict, list)) else None


def _codex_agents_load() -> dict:
    try:
        return json.loads((state_dir() / _CODEX_AGENTS_FILE).read_text())
    except (OSError, ValueError):
        return {}


def _codex_agents_save(d: dict) -> None:
    try:
        (state_dir() / _CODEX_AGENTS_FILE).write_text(json.dumps(d, ensure_ascii=False))
    except OSError:
        pass


def _codex_remember_spawn(data: dict) -> None:
    """PostToolUse(spawn_agent): 登记 agent_id → {agent_type, prompt} (工单已被 check_workorder 规范化)。"""
    resp = _json_or_none(data.get("tool_response"))
    aid = str((resp or {}).get("agent_id") or "") if isinstance(resp, dict) else ""
    if not aid:
        return
    ti = data.get("tool_input") or {}
    agents = _codex_agents_load()
    agents[aid] = {"agent_type": str(ti.get("subagent_type") or ""), "prompt": str(ti.get("prompt") or ""),
                   "reported": False}
    _codex_agents_save(agents)


def _codex_wait_result(data: dict) -> bool:
    """PostToolUse(wait_agent): 有已登记的子代理刚 completed → 就地改写成 CC 的 PostToolUse(Agent) 事件
    (tool_input = 当初的工单, tool_response = 子代理最终报告), 返回 True; 否则 (timed_out / errored /
    不认识的 id / 已经报过一次) 返回 False。同一个 completed 只报一次: wait_agent 对已完成线程可重复查询。"""
    resp = _json_or_none(data.get("tool_response"))
    status = (resp or {}).get("status") if isinstance(resp, dict) else None
    if not isinstance(status, dict) or not status:
        return False
    agents = _codex_agents_load()
    for aid, st in status.items():
        rec = agents.get(str(aid))
        if not rec or rec.get("reported") or not isinstance(st, dict) or "completed" not in st:
            continue
        rec["reported"] = True
        _codex_agents_save(agents)
        data["tool_input"] = {"prompt": rec["prompt"], "subagent_type": rec["agent_type"]}
        data["tool_response"] = st["completed"]
        data["tool_name"] = "Agent"
        return True
    return False


_ROLE_TOOLS_CACHE: dict[str, frozenset | None] = {}


def _role_tools(agent_type: str) -> frozenset | None:
    """agents/<agent_type>.md 头部的 tools 白名单 (CC 子代理的工具授权); 没有该角色/没写 tools → None。"""
    if agent_type in _ROLE_TOOLS_CACHE:
        return _ROLE_TOOLS_CACHE[agent_type]
    out = None
    md = Path(__file__).resolve().parents[2] / "agents" / f"{agent_type}.md"
    try:
        text = md.read_text(encoding="utf-8")
        if text.startswith("---\n"):
            head = text[4:text.find("\n---\n", 4)]
            for line in head.splitlines():
                if line.startswith("tools:"):
                    out = frozenset(t.strip() for t in line.split(":", 1)[1].split(",") if t.strip())
                    break
    except (OSError, ValueError):
        pass
    _ROLE_TOOLS_CACHE[agent_type] = out
    return out


def _codex_enforce_role_tools(data: dict) -> None:
    """PreToolUse: 子代理只能用 CC 侧 agents/<role>.md `tools:` 列出的工具。

    CC 按这份白名单裁子代理的工具表 (验收官没有 Write/Edit/Agent/deploy/get_asset/ingest_video);
    Codex 0.146 的角色配置没有按角色工具白名单, 子代理看到会话全部工具 —— 这里用 hook 在调用前补上
    同一份约束。比对口径: 归一化后的 CC 工具名 (Bash/Write/Read/Agent/TodoWrite; 验收官的 apply_patch 与
    apply_patch heredoc 都归 Write, view_image 归 Read) 或 MCP 全名 (与 CC 一字不差)。"""
    atype = str(data.get("agent_type") or "")
    if not atype:
        return
    allowed = _role_tools(atype)
    if allowed is None:
        return
    tool = str(data.get("tool_name") or "")
    if tool in allowed:
        return
    raw = str((data.get("_raw") or {}).get("tool_name") or tool)
    record("role_tool_denied", {"agent_type": atype, "tool": raw, "cc_tool": tool})
    deny(f"{raw} is not in the tool whitelist of {atype} (same grant as this subagent has under Claude "
         f"Code, which has no {'file-writing' if tool == 'Write' else 'such'} tool). You may use only: "
         + ", ".join(sorted(t.rsplit('__', 1)[-1] if t.startswith('mcp__') else t for t in allowed))
         + ". Write your record with shell redirection into out/verify/r<k>.md and evidence under "
           "out/cmp/r<k>/; do not touch the replica, do not serve, do not spawn subagents.")


def read_stdin_json(*, legacy_policy: bool = True) -> dict:
    global _LAST_EVENT
    try:
        data = json.load(sys.stdin)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    _LAST_EVENT = data   # 先登记: state_dir()/project_dir() 的 cwd 兜底要用事件里的 cwd
    if harness() == "codex":
        _dump_codex_event(data)
        raw_name = _codex_short_name(str(data.get("tool_name") or ""))
        event = data.get("hook_event_name")
        _normalize_codex(data)
        if not legacy_policy:
            return data
        if event == "PreToolUse":
            if raw_name in _CODEX_REUSE_AGENT_TOOLS:
                record(f"{raw_name}_denied",
                       {"target": str((data.get("_raw") or {}).get("tool_input", {}).get("target", ""))})
                deny(_CODEX_SEND_INPUT_DENY.format(tool=raw_name))
            if raw_name in ("wait_agent", "close_agent"):
                allow()   # 等待/关闭不是委托, CC 无对应动作, 不进任何规则
            _codex_enforce_role_tools(data)
        elif event == "PostToolUse":
            if raw_name.startswith("mcp__") and isinstance(data.get("tool_response"), str):
                parsed = _json_or_none(data["tool_response"])
                if parsed is not None:
                    data["tool_response"] = parsed   # MCP 结果 CC 给的是结构 (content 列表), 对齐
            if raw_name == "spawn_agent":
                _codex_remember_spawn(data)
                allow()   # 委托尚未完成 —— CC 的 PostToolUse(Agent) 时刻是 wait_agent 拿到 completed
            if raw_name == "wait_agent" and not _codex_wait_result(data):
                allow()
            if raw_name in _CODEX_REUSE_AGENT_TOOLS + ("close_agent",):
                allow()
    return data


def denormalize_input(tool_input: dict, data: dict | None = None) -> dict:
    """把 hook 改写过的 CC 形态入参翻回 harness 原生形态 (updatedInput 必须是原生形态,
    否则 Codex 的 spawn_agent 收到的是 prompt/subagent_type 这种它不认的键)。CC 下原样返回。"""
    data = data if data is not None else _LAST_EVENT
    raw = (data or {}).get("_raw")
    if not raw:
        return tool_input
    out = dict(raw["tool_input"])
    keymap = raw.get("keymap") or {}
    for norm_key, raw_key in keymap.items():
        if norm_key.startswith("_") or norm_key not in tool_input:
            continue
        if norm_key == "command" and isinstance(out.get(raw_key), list):
            argv = list(out[raw_key])
            if len(argv) >= 3 and argv[1] in ("-lc", "-c"):
                argv[2] = tool_input["command"]
            else:
                argv = ["bash", "-lc", tool_input["command"]]
            out[raw_key] = argv
        else:
            out[raw_key] = tool_input[norm_key]
    # 归一化时新造的键 (file_paths) 与 CC 专属键 (run_in_background) 不回写
    return out


def project_dir() -> Path:
    p = (os.environ.get("VE_PROJECT_DIR") or "").strip()
    if p and "${" not in p:
        return Path(p)
    # 宿主事件自带 cwd (= 项目根; ZCode 与 Codex 都不注入项目目录变量): 用它, 再退回进程 cwd
    ev_cwd = _LAST_EVENT.get("cwd") if isinstance(_LAST_EVENT, dict) else None
    return Path(ev_cwd) if ev_cwd else Path.cwd()


def state_dir() -> Path:
    # 优先自定义 V2C_HOOK_STATE: 宿主会按插件覆写插件数据目录变量, 管线注入的钉桩值
    # 到不了 hook, 留痕随容器销毁且导出指标恒 0。自定义变量宿主不认识、原样继承, 才穿得透。
    # ZCODE_PLUGIN_DATA (宿主的插件数据目录) 为次选, 无注入的本地会话按它落盘。
    d = os.environ.get("V2C_HOOK_STATE") or os.environ.get("ZCODE_PLUGIN_DATA")
    root = Path(d) if d else project_dir() / ".v2c" / "hook_state"
    root.mkdir(parents=True, exist_ok=True)
    return root


def strike(rule: str, limit: int = 3) -> tuple[int, bool]:
    """规则 rule 拦截计数 +1。返回 (当前次数, 是否已到放行线)。

    到线时在 violations.jsonl 记一笔 (导出侧可据此过滤/审查轨迹), 计数清零。"""
    d = state_dir()
    f = d / f"strike_{rule}.count"
    try:
        n = int(f.read_text().strip())
    except Exception:
        n = 0
    n += 1
    released = n >= limit
    if released:
        f.write_text("0")
        with (d / "violations.jsonl").open("a") as vf:
            vf.write(json.dumps({"rule": rule, "strikes": n}, ensure_ascii=False) + "\n")
    else:
        f.write_text(str(n))
    return n, released


def clear_strike(rule: str) -> None:
    f = state_dir() / f"strike_{rule}.count"
    if f.exists():
        f.write_text("0")


def deny(message: str) -> None:
    """PreToolUse: 拒绝本次工具调用, stderr 回给模型。"""
    print(message, file=sys.stderr)
    sys.exit(2)


def feedback(message: str) -> None:
    """PostToolUse: 不拦截 (工具已执行), 把提醒作为反馈回给模型。

    CC: exit 2 + stderr = 工具结果照给, 反馈附加。Codex 0.146 (hooks/src/events/post_tool_use.rs):
    exit 2 + stderr 是 should_block —— 用反馈**替换**工具结果, 模型看不到原结果 (260908 E2E 实拍:
    fix_budget 的反馈顶掉了 spawn_agent 的 {agent_id}, 模型拿不到 id 又 spawn 两次撞 thread limit)。
    Codex 下改走 exit 0 + hookSpecificOutput.additionalContext: 结果保留, 反馈作为附加上下文进模型。
    ZCode 同理: exit 2 是 block 快捷方式 (docs/PLUGIN_DEVELOPMENT.md §4.6), 而 PostToolUse 只能追加
    模型可见的上下文, 所以也走 additionalContext。"""
    if harness() == "codex" or under_zcode():
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                                 "additionalContext": message}}, ensure_ascii=False))
        sys.exit(0)
    print(message, file=sys.stderr)
    sys.exit(2)


def block_stop(reason: str) -> None:
    """Stop: 阻止收尾, reason 回给模型继续工作。"""
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))
    sys.exit(0)


def allow() -> None:
    sys.exit(0)


# --- 会话身份与入参改写 (subagent 迁移后新增) ---

def caller(data: dict) -> tuple[str, str, bool]:
    """(ns, agent_type, is_verifier) —— 本次工具调用是谁发的。

    CC 的 hook 入参带 session_id / agent_id / agent_type: 主会话没有 agent_id,
    每次 Agent 委托的 subagent 各有一个。ns 取 8 位, 用作产物目录命名空间 ——
    MCP server 拿不到会话身份 (它被主会话和 subagent 共用), 只有 hook 拿得到,
    所以由 hook 转交。
    """
    raw = str(data.get("agent_id") or data.get("session_id") or "main")
    ns = re.sub(r"[^A-Za-z0-9]", "", raw)[:8] or "main"
    atype = str(data.get("agent_type") or "")
    return ns, atype, "v2c-verifier" in atype


def rewrite_input(tool_input: dict, reason: str = "") -> None:
    """PreToolUse: 改写本次调用的入参后放行 —— 模型无感, 不花轮次。

    只用于本插件自己的工具 (跑批里本就放行的那些); 不拿它去 allow 别的工具,
    以免绕过管线的 disallowed_tools。updatedInput 按 harness 原生形态发回
    (Codex 下由 denormalize_input 翻回 spawn_agent 的 message/agent_type 等键)。"""
    spec = {"hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": denormalize_input(tool_input)}
    if reason:
        spec["permissionDecisionReason"] = reason
    print(json.dumps({"hookSpecificOutput": spec}, ensure_ascii=False))
    sys.exit(0)


def record(rule: str, payload: dict) -> None:
    """把一次越界/剥离原样记进 violations.jsonl —— 灰度复盘的数据源。

    被 hook 拦掉或改写的东西必须留痕: 否则"白名单漏了一个新字段"这类回归
    是静默的 (剥掉了, 谁也不知道)。"""
    try:
        with (state_dir() / "violations.jsonl").open("a") as f:
            f.write(json.dumps({"rule": rule, **payload}, ensure_ascii=False) + "\n")
    except Exception:
        pass
