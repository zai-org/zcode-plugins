import sys, json, os, hashlib
from datetime import datetime

# relay_hook v3 —— TASK-010 卡片续接 + TASK-011 消息车道 + TASK-012 多项目标记路由（安全关键）
# v3 变更（其余同 v2）：
#   ROOT 解析：1) stdin cwd 下存在 relay/relay.enabled → ROOT=该 cwd（任意项目可启用，/relay-up 写标记）
#             2) 否则环境变量 RELAY_HOOK_ROOT（测试/显式指定）
#             3) 都没有 → 本轮静默退出（fail-closed；v1/v2 的"隔离区仅注册"随之取消，换取跨项目零配置激活）
# 事件分工：
#   SessionStart     → 会话注册（session_id / model / cwd），解决模型对账；不采正文
#   UserPromptSubmit → 消息 additionalContext 注入，由 runtime/ups-context-enabled 标志门控
#   Stop             → 自动续接：员工领卡（worker=any/zcode 或 sess:定向）+ 全员收消息，合并一次注入
# 安全阀：
#   1) 作用域：仅标记/指定的本项目根；其余会话静默
#   2) 领导会话排除清单 relay/runtime/leader-sessions.txt——不领卡，只收消息
#   3) 链长上限 MAX_CHAIN（默认 3，与平台 Stop 续写上限一致）；自然轮次重置；同 turnId 去重
#   4) 领取一律 os.rename 原子操作；消息 body_sha256 不一致移入 read/*.bad 隔离并记日志
# 输出合同：Stop 用 {"decision":"block","reason":...}（实测有效）；UPS 用 hookSpecificOutput.additionalContext（实测有效）；
#           其余一律空输出 exit 0（fail-open）

MAX_CHAIN = 3
BODY_PREVIEW = 120

# 路径依 ROOT 在 main() 内解析（v3 起无硬编码默认根）
RELAY = RUNTIME = REGISTRY = CHAIN_LOG = LEADER_DENY = ROLES = UPS_FLAG = CHAT = None


def done():
    sys.exit(0)


def append_jsonl(path, obj):
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def load_leaders():
    try:
        with open(LEADER_DENY, encoding="utf-8") as f:
            return set(l.strip() for l in f if l.strip())
    except Exception:
        return set()


def load_roles():
    try:
        with open(ROLES, encoding="utf-8") as f:
            v = json.load(f)
        return v if isinstance(v, dict) else {}
    except Exception:
        return {}


def short8(sid):
    return sid.replace("sess_", "")[:8] if sid else ""


def my_chat_dirs(sid, is_leader, roles):
    """本会话可领取的消息目录名列表（完整id > 短标识 > 角色）。"""
    dirs = []
    if sid:
        full = sid.replace("sess_", "")
        if full:
            dirs.append("to-sess-" + full)
    s8 = short8(sid)
    if s8:
        dirs.append("to-sess-" + s8)
    if is_leader:
        dirs.append("to-leader")
    else:
        emps = roles.get("employees")
        if isinstance(emps, dict):
            for label, info in emps.items():
                if not isinstance(info, dict):
                    continue
                if (s8 and info.get("short") == s8) or (sid and info.get("session_id") == sid):
                    dirs.append("to-" + label)
    return dirs


def claim_chat(dirs):
    """领取发给本会话的全部消息：sha 校验、pending→read 原子改名；坏消息隔离为 read/*.bad。"""
    got, bad = [], []
    for d in dirs:
        pend = os.path.join(CHAT, d, "pending")
        if not os.path.isdir(pend):
            continue
        for name in sorted(os.listdir(pend)):
            if not name.endswith(".json"):
                continue
            src = os.path.join(pend, name)
            try:
                with open(src, encoding="utf-8") as f:
                    msg = json.load(f)
                if not isinstance(msg, dict) or "body" not in msg:
                    raise ValueError("消息缺 body")
                sha = hashlib.sha256(msg["body"].encode("utf-8")).hexdigest()
                if sha != msg.get("body_sha256"):
                    raise ValueError("body_sha256 不一致")
            except Exception as exc:
                dest_dir = os.path.join(CHAT, d, "read")
                os.makedirs(dest_dir, exist_ok=True)
                try:
                    os.rename(src, os.path.join(dest_dir, name + ".bad"))
                    bad.append((d, name, str(exc)))
                except OSError:
                    pass
                continue
            dest_dir = os.path.join(CHAT, d, "read")
            os.makedirs(dest_dir, exist_ok=True)
            try:
                os.rename(src, os.path.join(dest_dir, name))
            except OSError:
                continue  # 被其他事件抢先
            got.append(msg)
    return got, bad


def chat_summary(msgs):
    lines = []
    for i, m in enumerate(msgs, 1):
        preview = m.get("body", "").replace("\n", " ")[:BODY_PREVIEW]
        lines.append("[%d] from=%s kind=%s ref=%s：%s" % (i, m.get("from", "?"), m.get("kind", "?"), m.get("ref", "-"), preview))
    return "；".join(lines)


def main():
    global RELAY, RUNTIME, REGISTRY, CHAIN_LOG, LEADER_DENY, ROLES, UPS_FLAG, CHAT

    event = sys.argv[1] if len(sys.argv) > 1 else ""
    raw = sys.stdin.buffer.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except Exception:
        done()
    if not isinstance(data, dict):
        done()

    def fld(snake):
        v = data.get(snake)
        if not isinstance(v, str) or not v:
            v = data.get({"session_id": "sessionId", "turn_id": "turnId",
                          "model": "model", "cwd": "cwd"}.get(snake, snake))
        return v if isinstance(v, str) else None

    cwd_raw = fld("cwd") or os.getcwd()
    norm = os.path.normcase(os.path.abspath(cwd_raw))

    # ---- v3 ROOT 解析：标记 > 环境变量 > 静默退出 ----
    if os.path.isfile(os.path.join(norm, "relay", "relay.enabled")):
        root = norm
    elif os.environ.get("RELAY_HOOK_ROOT"):
        root = os.path.normcase(os.path.abspath(os.environ["RELAY_HOOK_ROOT"]))
    else:
        root = None
    if root is None:
        done()
    if norm != root:
        done()  # 会话 cwd 与解析出的根不一致（如在别的目录闲聊）：静默

    RELAY = os.path.join(root, "relay")
    RUNTIME = os.path.join(RELAY, "runtime")
    REGISTRY = os.path.join(RUNTIME, "session-registry.jsonl")
    CHAIN_LOG = os.path.join(RUNTIME, "chain-log.jsonl")
    LEADER_DENY = os.path.join(RUNTIME, "leader-sessions.txt")
    ROLES = os.path.join(RUNTIME, "roles.json")
    UPS_FLAG = os.path.join(RUNTIME, "ups-context-enabled")
    CHAT = os.path.join(RELAY, "chat")

    sid = fld("session_id") or os.environ.get("CLAUDE_SESSION_ID") or ""
    os.makedirs(RUNTIME, exist_ok=True)

    if event == "SessionStart":
        append_jsonl(REGISTRY, {"ts": datetime.now().isoformat(), "session_id": sid,
                                "cwd": cwd_raw, "model": fld("model"), "scope": "root"})
        done()

    if event == "UserPromptSubmit":
        if not os.path.isfile(UPS_FLAG):
            done()
        leaders = load_leaders()
        msgs, bad = claim_chat(my_chat_dirs(sid, sid in leaders, load_roles()))
        ts = datetime.now().isoformat()
        for d, name, why in bad:
            append_jsonl(CHAIN_LOG, {"ts": ts, "session_id": sid,
                                     "action": "chat-quarantine", "dir": d, "file": name, "why": why})
        if not msgs:
            done()
        append_jsonl(CHAIN_LOG, {"ts": ts, "session_id": sid,
                                 "action": "chat-claim+ups", "count": len(msgs)})
        text = ("【relay 消息】本会话有 %d 条新消息（已移入 relay/chat/*/read/）：%s "
                "请按 .zcode/skills/relay-next/SKILL.md 的【消息模式】处理。"
                % (len(msgs), chat_summary(msgs)))
        sys.stdout.write(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
                                                             "additionalContext": text}},
                                    ensure_ascii=False))
        sys.exit(0)

    if event != "Stop":
        done()

    # ---- Stop：自动续接（卡片 + 消息合并一次注入） ----
    leaders = load_leaders()
    is_leader = bool(sid) and sid in leaders

    stop_active = data.get("stopHookActive", data.get("stop_hook_active"))
    turn = fld("turn_id") or ""

    state_path = os.path.join(RUNTIME, "chain-state-%s.json" % ((sid or "unknown")[:13]))
    try:
        st = json.load(open(state_path, encoding="utf-8"))
    except Exception:
        st = {"count": 0, "last_turn": None}
    if stop_active is not True:
        st["count"] = 0  # 新的自然轮次：链计数归零
    if turn and st.get("last_turn") == turn:
        done()
    if st["count"] >= MAX_CHAIN:
        done()

    card = None
    if not is_leader:
        inbox = os.path.join(RELAY, "inbox")
        if os.path.isdir(inbox):
            s8 = short8(sid)
            for name in sorted(os.listdir(inbox)):
                if not name.endswith(".json"):
                    continue
                try:
                    c = json.load(open(os.path.join(inbox, name), encoding="utf-8"))
                except Exception:
                    continue
                if not all(k in c for k in ("task_id", "prompt", "prompt_sha256")):
                    continue
                w = c.get("worker", "any")
                # v1/v3：any 卡，zcode 协议卡，或定向给本会话的卡（sess:<完整id> 或 sess:<8位短标识>）
                if w in ("any", "") or w == "zcode" or (sid and w == "sess:" + sid) or (s8 and w == "sess:" + s8):
                    card = (name, c)
                    break

    msgs, bad = claim_chat(my_chat_dirs(sid, is_leader, load_roles()))
    ts = datetime.now().isoformat()
    for d, name, why in bad:
        append_jsonl(CHAIN_LOG, {"ts": ts, "session_id": sid, "action": "chat-quarantine",
                                 "dir": d, "file": name, "why": why})
    if not card and not msgs:
        done()

    dest_name = None
    if card:
        name, c = card
        s8 = short8(sid) or "hook"
        dest_name = "%s.by-sess-%s.json" % (os.path.splitext(name)[0], s8)
        try:
            os.rename(os.path.join(RELAY, "inbox", name), os.path.join(RELAY, "claimed", dest_name))
        except OSError:
            dest_name = None  # 被其他会话抢先；消息照常投递
    if not dest_name and not msgs:
        done()

    st["count"] += 1
    st["last_turn"] = turn
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(st, f)

    parts = []
    if dest_name:
        append_jsonl(CHAIN_LOG, {"ts": ts, "session_id": sid, "turn_id": turn,
                                 "action": "claim+continue", "task_id": card[1]["task_id"],
                                 "chain_count": st["count"], "card": dest_name})
        parts.append("【relay 自动续接】本会话已自动领取下一张任务卡 %s（relay/claimed/%s）。"
                     "请立即按 .zcode/skills/relay-next/SKILL.md 的【续接模式】执行该卡：校验哈希 → "
                     "排空式执行（连同下方消息一并处理）→ 写回报 → 队列空后停止。不要自己去 inbox 抢卡。"
                     % (card[1]["task_id"], dest_name))
    if msgs:
        append_jsonl(CHAIN_LOG, {"ts": ts, "session_id": sid, "turn_id": turn,
                                 "action": "chat-claim+stop", "count": len(msgs),
                                 "chain_count": st["count"]})
        parts.append("【relay 消息】本会话有 %d 条新消息（已移入 relay/chat/*/read/）：%s "
                     "请按 SKILL.md 的【消息模式】处理（若同时收到任务卡，先做卡再处理消息）。"
                     % (len(msgs), chat_summary(msgs)))
    sys.stdout.write(json.dumps({"decision": "block", "reason": "\n".join(parts)}, ensure_ascii=False))
    sys.exit(0)


try:
    main()
except SystemExit:
    raise
except Exception:
    sys.exit(0)
