#!/usr/bin/env python3
"""UserPromptSubmit hook：用户提交输入时自动检测需求特征。

不阻断（exit 0），通过 additionalContext 注入提醒：
  - 需求太短（<20字）→ 提醒先解析
  - 含模糊词 → 提醒歧义检测
  - 像"改/加/修"类变更 → 提醒先 /regress:plan
  - 重复提交（和上一条一样）→ 提醒可能重复

这是"需求进来时的第一道关口"。
"""
import sys
import os
import json
import re
import tempfile

# 考古地层（公理三）：用户纠正是最稀缺的化石（"自信地错"的唯一信号）
_LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
try:
    from journal import journal_append
except ImportError:  # lib 缺失时地层降级关闭
    def journal_append(*a, **k):
        return False


# 模糊词模式（触发歧义检测提醒）
AMBIGUOUS_PATTERNS = [
    r'(大概|差不多|那种|类似的|好像|应该|可能)',
    r'(全部|所有|都)',
    r'(优化|改进|完善|调整)',
    r'(那个|这个|之前|上次)',
    r'(弄一下|搞一下|处理一下|看看)',
]

# 变更类动词（触发 plan 提醒）
CHANGE_VERBS = r'(改|加|修|删|重构|新增|去掉|替换|迁移)'

# 最小需求长度
MIN_REQUIREMENT_LEN = 15


def _state_path():
    """状态文件路径——按项目隔离（避免跨项目污染重复检测）。"""
    import hashlib
    project_dir = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    key = hashlib.md5(project_dir.encode()).hexdigest()[:8]
    return os.path.join(tempfile.gettempdir(), f"regress-guard-last-prompt-{key}.txt")


def load_last_prompt():
    """读取本项目上一条用户输入（检测重复提交）。"""
    try:
        with open(_state_path(), encoding="utf-8") as f:
            return f.read().strip()
    except (IOError, OSError):
        return ""


def save_prompt(text):
    """保存当前输入（供下次比对）。同时写全局接力文件（v1.32.3）：
    stop_notify 经它读最后输入——按项目哈希隔离在钩子进程间目录解析漂移时会
    读空导致推送永远静默（2026-09-05 三报沉默根因），全局单文件最后写入者生效。
    v1.32.4：空文本也如实写入（推送决策已与文本解耦，空值让占位标题生效）。"""
    try:
        with open(_state_path(), "w") as f:
            f.write(text[:500])
        with open(os.path.join(tempfile.gettempdir(),
                               "regress-guard-last-prompt.global.txt"), "w") as f:
            f.write(text[:500])
    except (IOError, OSError):
        pass


# ── 卡死自动触发（"自己爬出来"的最后一环）──
# 用户连续无信息催促 = 当前路线无进展的信号。第 2 次即注入 scout 升级指令。

PROD_THRESHOLD = 2

def _prod_count_path():
    key = _state_path().replace("last-prompt", "prod-count")
    return key

def is_content_free_prod(text):
    """无信息催促：归一化后 ≤12 字符且以继续类词开头（覆盖"继续攻克，自决策"）。

    授权词豁免（病例：2026-09-03 活体误判——"继续，自决策"是批准语不是空催促，
    连续两次批准触发误报 scout 升级）：含授权/委派语义的短语带实际指令，不算无信息。
    """
    t = re.sub(r"[\s，。！？,.!?]", "", text).lower()
    if not t or len(t) > 12:
        return False
    if re.search(r"自决策|自决|你决定|自主决|自动做|直接做|放手做", t):
        return False
    return t.startswith(("继续", "接着", "go", "ok", "加油", "搞起", "弄完"))

def bump_prod_count(is_prod):
    """催促计数：prod 则 +1 并返回新值；实质输入则清零并返回 0。"""
    path = _prod_count_path()
    try:
        n = int(open(path, encoding="utf-8").read().strip() or 0)
    except (IOError, ValueError):
        n = 0
    n = n + 1 if is_prod else 0
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(str(n))
    except (IOError, OSError):
        pass
    return n

def _scout_fire_path():
    return _state_path().replace("last-prompt", "scout-fires")

def _bump_scout_fires(reset=False):
    path = _scout_fire_path()
    try:
        n = int(open(path, encoding="utf-8").read().strip() or 0)
    except (IOError, ValueError):
        n = 0
    n = 0 if reset else n + 1
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(str(n))
    except (IOError, OSError):
        pass
    return n

def scout_escalation_reminder(n):
    base = (
        f"🚨 卡死检测：用户已第 {n} 次无信息催促——当前路线大概率无进展。"
        f"立即行动：调用 mcp__advisor__consult，参数 mode=\"scout\"、"
        f"question=<当前核心问题一句话>、context=<已试方案与结果摘要>，"
        f"由带实时搜索的顾问调查后给出新方案，按其意见调整路线后再继续。"
        f"（顾问工具不可用则自行判断并标注「未获第二意见」；"
        f"禁止不改方法地重复原路线）"
    )
    fires = _bump_scout_fires()
    if fires >= 2:
        base += (
            f"\n⚠️ 升级：scout 意见已第 {fires} 轮仍未破局——上下文可能已耗尽。"
            f"先运行 /handoff 生成会话交接（含顾问意见与当前状态），"
            f"建议用户新开会话读交接文件后继续，而不是在本会话继续堆上下文。"
        )
    return base


# ── 纠错检测（"自信地错"的唯一信号）──
# 流畅地走错方向不产生工具失败、不触发卡死计数，只有用户的纠正能暴露。
# 负向后顾排除"报错了/出错了/崩错了"等描述性用法（那是工具报错，不是纠正）。
CORRECTION_RE = re.compile(
    r"(?<![报出崩闪])错了|不对|不是这样|理解错|方向错|搞反了|弄反了|又错|wrong"
)

# ── 硬约束检测（v1.94.0，122：约束语式只埋点不提醒）──
# "发布到公网之前一定要人类审查、作者署名要对"这类红线只活在对话里，
# 机械上不可见（0158a98b 标本：授权与红线全靠 AI 自觉写 decisions.md）。
# 方向词共现做粗防泛化：单独"必须努力"式自述不埋，约束指向动作/产物才埋。
CONSTRAINT_RE = re.compile(r"一定|必须|不许|不能|只能|禁止|绝不|红线")
CONSTRAINT_DIRECTION_RE = re.compile(
    r"你|发布|推送|提交|开源|公网|作者|删除|执行|审查|写|改"
)

# ── 重任务检测（v1.94.0，122：f77a+0158a98b 两标本=钩子在场清单缺席）──
# 发布/开源类任务风险集中（不可逆+外发），M/L 档的验收+深查纪律全部
# 空转——一行提醒把"要不要开清单"摆到台面，不拦。
HEAVY_TASK_RE = re.compile(r"发布|开源|推送|公网|删.{0,6}历史|重建仓|推到.{0,6}上")


def correction_reminder(text):
    """检测到用户纠正 → 注入"先向顾问求证方向，再动手"。"""
    m = CORRECTION_RE.search(text)
    if not m:
        return None
    return (
        f"🔁 用户在纠正方向（检测到「{m.group(0)}」）——之前的方案可能\"自信地错\"："
        f"这类错误没有失败信号，只有用户能察觉。先别急着按字面小修，"
        f"调用 mcp__advisor__consult，把【用户纠正原文＋你刚才的方案与理由＋"
        f"关键代码位置】原样发给顾问，判断是方向性错误（推倒重来）还是细节偏差"
        f"（局部修正），判断清楚再动手。"
        f"（顾问工具不可用则自行判断并标注「未获第二意见」）"
    )


def analyze_prompt(text):
    """分析用户输入，返回需要注入的提醒列表。"""
    if not text:
        return []

    # 去掉命令前缀
    clean = re.sub(r'^/\S+\s*', '', text).strip()
    reminders = []

    # 0. 卡死自动触发（最高优先级，先于一切提醒）
    if is_content_free_prod(clean):
        n = bump_prod_count(True)
        if n >= PROD_THRESHOLD:
            reminders.append(scout_escalation_reminder(n))
            bump_prod_count(False)  # 触发后重置，再积 2 次才重触（防每条催促都刷）
            save_prompt(clean)
            return reminders  # 卡死信号独占注入，避免与其他提醒混杂
    else:
        bump_prod_count(False)  # 实质输入 → 清零
        _bump_scout_fires(reset=True)  # 实质进展也重置 scout 未破局计数

    # 0.5 纠错检测（"自信地错"不产生失败信号，用户纠正词是唯一探测器）
    cr = correction_reminder(clean)
    if cr:
        reminders.append(cr)
        journal_append("user_correction", excerpt=clean[:200])  # 纠正化石入地层

    # 0.6 硬约束埋点（v1.94.0，122）：约束语式+方向词共现 → user_constraint
    # 化石（红线机械可见）。不注入提醒——约束已在用户原话里，AI 天然可见；
    # 埋点为的是 Stop 侧"红线落盘"提醒和 /regress:learn 考古有据可挖。
    if (CONSTRAINT_RE.search(clean) and CONSTRAINT_DIRECTION_RE.search(clean)):
        journal_append("user_constraint", excerpt=clean[:200])

    # 1. 重复提交检测
    last = load_last_prompt()
    if last and clean == last:
        reminders.append(
            "⚠️ 这条需求和上一条完全相同——如果是在等待 AI 响应，"
            "可能是模型慢导致的重复发送。AI 已经在处理了。"
        )

    # 2. 需求太短
    if len(clean) < MIN_REQUIREMENT_LEN and re.search(CHANGE_VERBS, clean):
        reminders.append(
            f"💡 需求描述较短（{len(clean)}字）。"
            f"建议先 /regress:plan 让 AI 解析需求、补全上下文后再动手。"
        )

    # 3. 模糊词检测
    found_ambiguous = []
    for pattern in AMBIGUOUS_PATTERNS:
        m = re.search(pattern, clean)
        if m:
            found_ambiguous.append(m.group(0))
    if found_ambiguous:
        reminders.append(
            f"💡 需求含模糊词（{', '.join(set(found_ambiguous))}）——"
            f"AI 会先解析歧义、做假设、只问关键分歧。"
            f"如果你有明确预期，建议直接说出来能减少返工。"
        )

    # 4. 变更类需求 → 提醒 plan（4.5 重任务共用 .regress 探测，故门条件并联
    #    HEAVY_TASK_RE——"把这个项目开源"不含变更动词，纯 CHANGE_VERBS 门会漏）
    if ((re.search(CHANGE_VERBS, clean) and len(clean) >= MIN_REQUIREMENT_LEN)
            or HEAVY_TASK_RE.search(clean)):
        # 检查是否有 .regress/
        project_dir = (
            os.environ.get("CLAUDE_PROJECT_DIR")
            or os.environ.get("ZCODE_PROJECT_DIR")
            or os.getcwd()
        )
        # 向上查找
        has_regress = False
        search_dir = project_dir
        for _ in range(10):
            if os.path.isdir(os.path.join(search_dir, ".regress")):
                has_regress = True
                break
            parent = os.path.dirname(search_dir)
            if parent == search_dir:
                break
            search_dir = parent

        if (has_regress and "/regress:" not in text
                and re.search(CHANGE_VERBS, clean)
                and len(clean) >= MIN_REQUIREMENT_LEN):
            reminders.append(
                "📋 检测到变更需求——AI 会先解析需求+分析改动点（/regress:plan 逻辑），"
                "不需要你手动触发。"
            )

        # 4.5 重任务无清单提醒（v1.94.0，122）：发布/开源类任务+无活跃清单 →
        # 一行建议开 M 档（验收+深查纪律恰是这类任务的止血位）。同会话只提
        # 一次（tmp 冷却），不刷屏。
        if has_regress and "/regress:" not in text and HEAVY_TASK_RE.search(clean):
            if not _active_manifests(project_dir, limit=1) and not _heavy_reminded():
                reminders.append(
                    "🚀 重任务检测（发布/开源/公网类）且当前无活跃清单——此类任务"
                    "不可逆+外发，建议开 M 档清单（验收 EARS 行+深查节会拦"
                    "「只读头部就下判定」和「自信错判」；0158a98b 标本实证）。"
                    "不需要则忽略本行。"
                )
                _mark_heavy_reminded()

    save_prompt(clean)
    return reminders


def _heavy_task_state_path():
    """重任务提醒冷却文件——按会话隔离，存在即已提醒过。"""
    session = (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or "default"
    )
    return os.path.join(
        tempfile.gettempdir(), f"regress-guard-heavy-reminded-{session}.flag")


def _heavy_reminded():
    try:
        open(_heavy_task_state_path(), encoding="utf-8").read()
        return True
    except (IOError, OSError):
        return False


def _mark_heavy_reminded():
    try:
        with open(_heavy_task_state_path(), "w", encoding="utf-8") as f:
            f.write("1")
    except (IOError, OSError):
        pass




def _active_manifests(project_dir, limit=3):
    """活跃清单行（v1.80，069）：id+status+tier+边界文件数——治理上下文前置。"""
    import glob
    lines = []
    try:
        for path in sorted(glob.glob(
                os.path.join(project_dir, ".regress", "manifests", "*.md"))):
            try:
                with open(path, encoding="utf-8") as f:
                    head = f.read(4000)
            except OSError:
                continue
            m = re.search(r"^status:\s*(\S+)", head, re.M)
            if not m or m.group(1) not in ("planning", "in-progress"):
                continue
            mid = re.search(r"^id:\s*(\S+)", head, re.M)
            tier = re.search(r"^tier:\s*(\S+)", head, re.M)
            n_files = len(re.findall(r"^\s*-\s*id:\s*F\d+", head, re.M))
            lines.append(f"📋 {mid.group(1) if mid else path}（{m.group(1)}"
                         f"{',' + tier.group(1) if tier else ''}，"
                         f"边界 {n_files} 文件）")
            if len(lines) >= limit:
                break
    except Exception:
        pass
    return lines


def _rule_recall_line(project_dir, prompt_text):
    """规律召回 TOP-1（v1.80）：match 现成地板 min_shared=3 兜噪声，
    再要求 top hits>=3 才出（顾问缓解：假阳性高就退边界单行）。
    v1.88.2（101）量测位：命中即落 note rule_recall_fired——哨兵巡检二
    watch 的"rule_recall 首次开火"从此有通道（此前结构性盲：不写任何事件）。"""
    try:
        from rules_ledger import match
        hits = match(project_dir, prompt_text[:200], top=1)
        if hits:
            top = hits[0]
            if (top.get("hits") or 0) >= 3:
                sig = str(top.get("sig") or "")[:60]
                try:
                    from history import record
                    record(os.path.join(project_dir, ".regress"), "note",
                           note="rule_recall_fired", sig=sig,
                           hits=top.get("hits"))
                except Exception:
                    pass  # 量测位永不破坏钩子（101 FP2）
                return [f"📚 相似规律：{sig}（hits {top['hits']}——开工前看一眼历史教训）"]
    except Exception:
        pass
    return []


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    # 会话中继（v1.34 会话作用域）：本钩子进程带会话 env（Bash 工具进程不带——
    # agent 侧无法自证身份），每轮把「当前在本项目说话的会话」落中继文件，
    # 供 plan_approve 盖 session 戳。早于 "/" 命令早退：命令轮也是本会话的轮。
    try:
        from session_relay import write_relay
        write_relay(os.environ.get("CLAUDE_PROJECT_DIR")
                    or os.environ.get("ZCODE_PROJECT_DIR") or os.getcwd())
    except Exception:
        pass

    # UserPromptSubmit 的 match value 是 prompt 文本
    prompt_text = ""
    if isinstance(data, dict):
        prompt_text = data.get("prompt", data.get("text", data.get("message", "")))
        if not prompt_text:
            # 可能直接是字符串
            prompt_text = str(data)

    if not isinstance(prompt_text, str):
        prompt_text = str(prompt_text)

    # 跳过命令自身（/regress:xxx）
    if prompt_text.strip().startswith("/"):
        sys.exit(0)

    # 跳过系统消息
    if "<task-" in prompt_text or "<system" in prompt_text:
        sys.exit(0)

    reminders = analyze_prompt(prompt_text)
    gov_lines = []
    if os.environ.get("RG_PROMPT_CONTEXT", "").lower() not in ("off", "0", "false"):
        # v1.80（069）治理上下文前置：活跃清单边界+规律召回——防线从拦截点前移到开工前
        pd = (os.environ.get("CLAUDE_PROJECT_DIR")
              or os.environ.get("ZCODE_PROJECT_DIR") or os.getcwd())
        gov_lines = _active_manifests(pd) + _rule_recall_line(pd, prompt_text)
    parts = []
    if gov_lines:
        parts.append("【regress-guard 治理上下文】\n" + "\n".join(f"  {l}" for l in gov_lines))
    if reminders:
        parts.append("【regress-guard 需求入口检查】\n" + "\n".join(f"  {r}" for r in reminders))
    if parts:
        print(json.dumps({"additionalContext": "\n".join(parts)}, ensure_ascii=False))

    sys.exit(0)


if __name__ == "__main__":
    main()
