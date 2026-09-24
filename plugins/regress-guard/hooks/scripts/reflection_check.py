#!/usr/bin/env python3
"""Stop hook：AI 准备结束当前轮次时注入"反思提醒"。

不阻断（exit 0），只注入 additionalContext 提醒 AI 自查。

ZCode 的 Stop 事件在 AI 生成完回复准备结束时触发，
通过 additionalContext 注入反思清单，让 AI 自查后再输出最终回复。
"""
import sys
import os
import json
import glob
import re
import tempfile
import time
import urllib.request

_LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
from manifest_fields import ACTIVE_STATUS_RE as _MF_ACTIVE_STATUS_RE  # v1.20 单一来源


def _git_changed_files(project_dir, cap=50):
    """改动+未跟踪文件（git status --porcelain 一次拿全）。非 git 仓库返回空。"""
    import subprocess
    try:
        proc = subprocess.run(
            ["git", "status", "--porcelain", "-uall"],  # -uall：未跟踪目录展开到文件
            capture_output=True, text=True, timeout=5, cwd=project_dir,
        )
    except Exception:
        return []
    out = []
    for ln in (proc.stdout or "").splitlines():
        path = ln[3:].strip() if len(ln) > 3 else ""
        if " -> " in path:  # 重命名取新路径
            path = path.split(" -> ")[-1]
        path = path.strip('"').strip()
        if path and not path.startswith(".regress/"):
            out.append(path)
    return out[:cap]


def _in_manifest(path, manifest_entries):
    """路径是否落在清单条目里（支持相对/绝对差异与目录通配前缀）。"""
    p = path.strip("/")
    for ent in manifest_entries:
        e = ent.strip().strip('"').strip("/")
        if not e:
            continue
        if e.endswith("*"):
            if p.startswith(e[:-1]):
                return True
        elif p == e or p.endswith("/" + e) or e.endswith("/" + p):
            return True
    return False


def _recent_consult(window_min=15):
    """顾问审计（dsh 侧 audit.jsonl）近 window_min 分钟是否有咨询记录。"""
    path = (
        os.environ.get("ADVISOR_AUDIT_PATH")
        or os.path.join(os.path.expanduser("~"), ".dsh", "storages", "advisor", "audit.jsonl")
    )
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()[-50:]
    except (IOError, OSError):
        return False
    from datetime import datetime, timedelta
    cutoff = datetime.now() - timedelta(minutes=window_min)
    for ln in lines:
        try:
            if datetime.fromisoformat(json.loads(ln)["ts"][:19]) >= cutoff:
                return True
        except (ValueError, KeyError, IndexError, json.JSONDecodeError):
            continue
    return False


def _read_advisor_token():
    """本地 dsh 顾问 token：env 优先，fallback ~/.dsh/settings.yaml 的 advisor.token。"""
    tok = os.environ.get("ADVISOR_DSH_TOKEN")
    if tok:
        return tok
    try:
        path = os.path.join(os.path.expanduser("~"), ".dsh", "settings.yaml")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        parts = re.split(r"^advisor:\s*$", text, flags=re.M)
        if len(parts) < 2:
            return None
        seg = re.split(r"^[A-Za-z][\w-]*:\s*$", parts[1], flags=re.M)[0]
        m = re.search(r"^\s{2,}token:\s*['\"]?([^'\"\s]+)", seg, re.M)
        return m.group(1) if m else None
    except (IOError, OSError):
        return None


AUTO_CONSULT_COOLDOWN_S = 180  # Stop 钩子可能连续触发，3 分钟内不重复自动咨询

# v2.4 单次调用：服务端持有唯一权威超时（30 分钟，超时回 504），
# 客户端等 1805s 收下它——Stop 钩子注册闸已放宽到 1810s。
# 服务端默认路由：deepseek-official/deepseek-v4-flash（model 可省略；
# 设 ADVISOR_LOCAL_MODEL="provider/model" 可显式覆盖）
AUTO_CONSULT_TIMEOUT_S = 1805


def _consult_post_once(url, token, prompt, timeout_s):
    """单次请求，返回 (answer, finish_reason) 或 None（网络层失败/空答）。"""
    body = {"messages": [{"role": "user", "content": prompt}]}
    override = os.environ.get("ADVISOR_LOCAL_MODEL")
    if override:
        body["model"] = override
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as r:
            data = json.load(r)
    except Exception:
        return None
    ch = (data.get("choices") or [{}])[0]
    answer = ((ch.get("message") or {}).get("content") or "").strip()
    return (answer, ch.get("finish_reason")) if answer else None


def _auto_consult(question, ferry_body):
    """钩子直接向本地顾问求第二意见——"智商在线"的机器层。

    与主AI自行 consult 的区别：摆渡包是钩子采集的客观数据（失败清单/git 改动/
    命令普查），未经主AI筛选——主AI的盲区恰好会漏掉最关键的那条，这层绕开它。
    安全边界：仅本地 dsh 端点（上下文不出机器），绝不自动走云端/scout。
    失败返回 None → 降级为指示主AI自行 consult（可 scout，可外发但那是主AI的显式决策）。
    """
    if os.environ.get("REGRESS_AUTO_CONSULT", "").lower() in ("off", "0", "false"):
        return None
    session = (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or "default"
    )
    cool_path = os.path.join(
        tempfile.gettempdir(), f"regress-guard-lastconsult-{session}")
    now = time.time()
    try:
        if now - float(open(cool_path).read().strip()) < AUTO_CONSULT_COOLDOWN_S:
            return None
    except (IOError, ValueError):
        pass
    token = _read_advisor_token()
    if not token:
        return None
    url = os.environ.get("ADVISOR_DSH_URL", "http://127.0.0.1:3080/v1/chat/completions")
    prompt = (
        "你是主AI编码助手的第二意见顾问。主AI在任务中卡住；下面是治理钩子机器采集的"
        "客观数据（失败清单/git改动/命令普查），未经主AI筛选。\n"
        "请：1)诊断最可能根因 2)给出与已失败方法根本不同的推荐方案 3)注明确定程度。"
        "诚实义务：无把握时第一句声明\"低把握\"，禁止虚构API/参数。总长≤300字。\n\n"
        f"【卡点】{question}\n\n【客观数据】\n{ferry_body}"
    )
    answer, truncated = None, False
    # P1#9 尝试戳先行：发起前就写冷却——顾问进程 hang 时**每个 Stop 不再重等
    # 1805s**（单次深度等待是设计，重复等待才是病；顾问预审定论：超时本身保留）。
    # 失败也进冷却 = 失败的自动咨询 3 分钟内不重试（Stops 连发场景不雪崩）。
    try:
        with open(cool_path, "w", encoding="utf-8") as f:
            f.write(str(now))
    except (IOError, OSError):
        pass
    got = _consult_post_once(url, token, prompt, AUTO_CONSULT_TIMEOUT_S)
    if got is not None:
        answer, finish = got
        truncated = finish == "length"
    if not answer or len(answer) < 10:
        return None
    if truncated:
        answer += "\n（注：顾问意见疑似被 max_tokens 截断，仅采纳已完整表述的部分）"
    return answer


def _git_diff_stat(project_dir, max_lines=15, cap=900):
    """客观数据摆渡：未提交改动概览。非 git 仓库 / 超时 / 无改动返回空。"""
    import subprocess
    try:
        proc = subprocess.run(
            ["git", "diff", "--stat", "HEAD"],
            capture_output=True, text=True, timeout=5, cwd=project_dir,
        )
    except Exception:
        return ""
    stat = (proc.stdout or "").strip()
    if not stat:
        return ""
    body = "\n".join(f"       {ln}" for ln in stat.splitlines()[:max_lines])
    return body[:cap]


def _stable_failure_sigs(project_dir):
    """考古地层里跨会话重复的失败签名（慢性已知，归 /regress:learn 管，不当急性卡死）。"""
    try:
        lib_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
        if lib_dir not in sys.path:
            sys.path.insert(0, lib_dir)
        from journal import journal_digest
        return {d.get("sig") for d in journal_digest(project_dir)}
    except Exception:
        return set()


def check_context(project_dir):
    """检查本轮工作状态，返回需要反思的点。"""
    regress_dir = os.path.join(project_dir, ".regress")
    if not os.path.isdir(regress_dir):
        return None  # 未接入

    reminders = []

    # 0. 轮内失败检测（用户无感层）—— v2 信号融合：3 次失败 ≠ 一定卡死。
    #    两个降级信号（任一命中即从"急性风暴"降为软提示，不烧顾问）：
    #      ① 迭代中：失败签名在窗口内也有**成功**执行（TDD 红绿循环、修一步跑一步）
    #      ② 慢性已知：签名在考古地层里跨会话重复（稳定经验，归 /regress:learn 管）
    #    只有"全新签名 + 零成功 + ≥3 次"才是急性卡死（强注入 + 机器摆渡咨询）。
    #    摆渡包自组装：失败清单原文 + git diff --stat 直接附在注入里——
    #    客观工件不经过 AI 的相关性过滤（自举问题）。
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from fail_watch import recent_failures
        from risk_watch import recent_usage
        fails = recent_failures(10)
        if len(fails) >= 3:
            success_sigs = {u.get("sig") for u in recent_usage(15)}
            stable_sigs = _stable_failure_sigs(project_dir)
            acute = [f for f in fails
                     if f.get("sig", "?") not in success_sigs
                     and f.get("sig", "?") not in stable_sigs]
            if len(acute) >= 3:
                from collections import Counter
                sig_counts = Counter(f.get("sig", "?") for f in acute)
                fail_lines = "\n".join(
                    f"       - {sig} ×{n}" for sig, n in sig_counts.most_common(5)
                )
                lines = [
                    f"⚙️ 轮内失败检测：近 10 分钟 {len(acute)} 次工具失败——"
                    f"当前方法大概率错误，禁止原样重试同一命令。",
                    "   失败清单（原文逐条摆渡，禁止自行过滤/压缩）：",
                    fail_lines,
                ]
                diff_stat = _git_diff_stat(project_dir)
                if diff_stat:
                    lines.append("   未提交改动（git diff --stat）：")
                    lines.append(diff_stat)
                lines.append(
                    "   → 立即调用 mcp__advisor__consult（mode=\"scout\"）："
                    "question=当前核心问题，context 必须原样携带上面全部条目＋报错原文。"
                    "顾问看不到你的屏幕，摆渡包缺一条它就瞎一条；它不掌握的领域知识"
                    "（本仓库私有上下文、你正在用的工具/版本行为）全部依赖你摆渡。"
                )
                reminders.append("\n".join(lines))
                # 机器层第二意见：客观数据直接送本地顾问，不经主AI筛选（绕开盲区）
                ferry_body = fail_lines + (("\n" + diff_stat) if diff_stat else "")
                opinion = _auto_consult(
                    f"近10分钟 {len(acute)} 次工具失败，当前方法大概率错误，禁止原样重试",
                    ferry_body,
                )
                if opinion:
                    reminders.append(
                        "🧠 自动第二意见（本地顾问已收到机器摆渡包，未经你筛选）：\n"
                        "   【顾问意见·仅供参考·决策权在你】\n" + opinion +
                        "\n   若不可行：mcp__advisor__consult（mode=\"scout\"）带搜索重问；"
                        "采纳与否必须在回复中标注。"
                    )
            else:
                mitigated = len(fails) - len(acute)
                reasons = []
                if success_sigs & {f.get("sig", "?") for f in fails}:
                    reasons.append("失败签名窗口内也有成功执行（迭代/TDD 推进中）")
                if stable_sigs & {f.get("sig", "?") for f in fails}:
                    reasons.append("属考古地层跨会话慢性失败（/regress:learn 的领域）")
                reminders.append(
                    f"ℹ️ 失败信号 {len(fails)} 次已观察，但非急性卡死"
                    f"（{'; '.join(reasons) or '证据不足'}）——继续当前节奏推进；"
                    f"若真卡死会升级为急性警报（零成功+全新签名）。"
                )
    except Exception:
        pass  # 探测器不可用不阻断反思

    # 1. 检查是否有未提交的改动但没跑 track
    #    活跃状态 = 封闭活跃集（planning/in-progress/verifying），与 manifest_parser 语义一致
    manifests_dir = os.path.join(regress_dir, "manifests")
    active_manifests = []
    manifest_files = set()
    if os.path.isdir(manifests_dir):
        for f in sorted(glob.glob(os.path.join(manifests_dir, "*.md")), reverse=True):
            # v1.23.2 长寿扫描：只读 frontmatter（done 堆积后 O(frontmatter)；
            # 正文引用状态词不再诈尸；file: 条目全在 frontmatter 的 planned/actual 里）
            try:
                from manifest_parser import read_frontmatter
                content = read_frontmatter(f)
                if _MF_ACTIVE_STATUS_RE.search(content):
                    active_manifests.append(os.path.basename(f))
                    for m in re.finditer(r'file:\s*["\']?([^"\'\n#]+)', content):
                        manifest_files.add(m.group(1).strip())
            except (IOError, OSError):
                pass

    if active_manifests:
        reminders.append(
            f"📋 有活跃的回归清单（{', '.join(active_manifests[:3])}），"
            f"确认已跑 /regress:track 检查 F3 了吗？"
        )

        # 1.5 方向漂移自动检测（计划-实现对齐，无需人类开口）
        # git 改动不在任何活跃清单的 planned/actual 里 = F3 嫌疑或需求漂移
        changed = _git_changed_files(project_dir)
        drift = [c for c in changed if not _in_manifest(c, manifest_files)]
        if drift:
            reminders.append(
                f"🧭 方向漂移检测：git 改动里有 {len(drift)} 个文件不在活跃清单的 "
                f"planned/actual 中（如 {', '.join(drift[:4])}）——要么是 F3"
                f"（改了计划外的东西），要么需求已变。先 /regress:track 回写清单，"
                f"或调 mcp__advisor__consult 把【原始需求＋漂移文件列表】发给顾问"
                f"判断是否偏离需求，判断后再继续。"
            )

    # 2. 检查是否有 bypass 债务
    config_path = os.path.join(regress_dir, "config.json")
    try:
        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
        if config.get("bypass_until"):
            reminders.append(
                "⚠️ 当前处于 bypass 模式——本轮的改动未经测试验证，"
                "记得事后补 /regress:verify"
            )
    except (IOError, json.JSONDecodeError):
        pass

    # 3. 检查 bypass.log 是否有未还的债
    bypass_log = os.path.join(regress_dir, "bypass.log")
    if os.path.exists(bypass_log):
        try:
            with open(bypass_log, encoding="utf-8") as f:
                lines = f.readlines()
            if len(lines) > 0:
                reminders.append(
                    f"📝 bypass.log 有 {len(lines)} 条记录，"
                    f"确认这些绕过的改动是否已补回归测试。"
                )
        except (IOError, OSError):
            pass

    # 4. 检查"没读代码就改代码"
    # Stop hook 的 stdin 含 response preview，检查本轮是否 Read 过但改了代码
    # 用 read_before_edit_guard 的计数状态判断
    state_file = _get_read_counter_path()
    session_id = os.environ.get("CLAUDE_SESSION_ID", os.environ.get("ZCODE_SESSION_ID", "default"))
    try:
        import json as _json
        with open(state_file, encoding="utf-8") as f:
            state = _json.load(f)
        sess = state.get(session_id, {})
        read_count = sess.get("read_count", 0)
        edit_count = sess.get("edit_count", 0)
        # 如果改了代码但读的很少
        if edit_count > 0 and read_count < edit_count:
            reminders.append(
                f"📚 本轮改了 {edit_count} 个文件但只读了 {read_count} 个——"
                f"确认你理解了被改代码的上下文吗？"
            )

        # 5. Pre-mortem：改了核心文件时触发经验预判
        if edit_count >= 3:
            reminders.append(
                f"🤔 Pre-mortem 检查：本轮改了 {edit_count} 个文件。"
                f"假设这次提交上线后出bug，最可能是什么？花10秒预判一下。"
            )
    except (IOError, _json.JSONDecodeError, KeyError):
        pass

    # 6. 高风险动作无第二意见（决策点自动覆盖，无需人类开口）
    #    破坏性/不可逆操作近 15 分钟有执行、顾问审计零记录 → 注入补审指令
    try:
        from risk_watch import recent_risks
        risks = recent_risks(15)
        if risks and not _recent_consult(15):
            details = "；".join(sorted({r.get("detail", "?") for r in risks})[:3])
            reminders.append(
                f"⚠️ 高风险动作未过审：近 15 分钟执行了破坏性/不可逆操作（{details}）"
                f"但顾问零咨询记录。补一次 mcp__advisor__consult：把【动作＋理由＋"
                f"回滚方案】发给顾问确认必要性；若明确安全（如清单内清理），"
                f"在回复中写明依据。"
            )
    except Exception:
        pass  # 探测器不可用不阻断反思

    # 7. 打转检测（成功但无进展的"变体重试硬闯"，无需失败风暴触发）
    #    同一命令 15 分钟 ≥4 次且其中 ≥2 次失败 = 在用小变体撞同一堵墙
    try:
        from risk_watch import recent_usage
        from fail_watch import recent_failures
        usage = recent_usage(15)
        if usage:
            from collections import Counter
            use_counts = Counter(u.get("sig", "?") for u in usage)
            fail_counts = Counter(f.get("sig", "?") for f in recent_failures(15))
            for sig, n in use_counts.most_common(3):
                fails_n = fail_counts.get(sig, 0)
                if n >= 4 and fails_n >= 2:
                    reminders.append(
                        f"🔄 打转检测：命令「{sig}」15 分钟内执行 {n} 次、"
                        f"失败 {fails_n} 次——你在用小变体硬闯同一条路。"
                        f"立即 mcp__advisor__consult（mode=\"scout\"，"
                        f"摆渡全部失败输出）换根本不同的方法，"
                        f"禁止再产生第 {n + 1} 个变体。"
                    )
                    churn_ferry = (
                        f"重复命令: {sig} ×{n}（失败 {fails_n} 次）\n"
                        "同期失败签名: " + ", ".join(f"{s}×{c}" for s, c in fail_counts.most_common(5))
                    )
                    opinion = _auto_consult(
                        f"命令「{sig}」15分钟执行{n}次失败{fails_n}次，疑似变体硬闯同一条路",
                        churn_ferry,
                    )
                    if opinion:
                        reminders.append(
                            "🧠 自动第二意见（本地顾问，机器摆渡包）：\n"
                            "   【顾问意见·仅供参考·决策权在你】\n" + opinion
                        )
                    break  # 一条足够，避免注入刷屏
                if n >= 6 and fails_n == 0:
                    reminders.append(
                        f"🔄 打转自查：命令「{sig}」已成功执行 {n} 次——"
                        f"确认每次都在推进（轮询/等待属正常），"
                        f"否则同上换方法或 consult。"
                    )
                    break
    except Exception:
        pass  # 探测器不可用不阻断反思

    # 8. 意图复述主动提示（半无感层：人类只需扫一眼，无需对话触发）
    #    "计划本身就理解错"会静默传播，机器无法替代人类意图——唯一能做的是
    #    让 AI 定期把理解亮出来供人扫视，把"做完才发现方向错"提前到"扫一眼就发现"
    if active_manifests:
        interval_s = os.environ.get("REGRESS_RESTATE_INTERVAL_S", "600")
        try:
            interval = float(interval_s)
        except ValueError:
            interval = 600.0
        if interval > 0:
            newest = active_manifests[0]  # 文件名倒序，第一个是最新清单
            try:
                state_p = os.path.join(
                    tempfile.gettempdir(),
                    "regress-guard-lastrestate-{}.txt".format(
                        os.environ.get("CLAUDE_SESSION_ID")
                        or os.environ.get("ZCODE_SESSION_ID")
                        or "default"),
                )
                now_s = time.time()
                need = True
                try:
                    prev = open(state_p, encoding="utf-8").read().strip().split("|")
                    if len(prev) == 2 and prev[0] == newest and now_s - float(prev[1]) < interval:
                        need = False
                except (IOError, ValueError):
                    pass
                if need:
                    reminders.append(
                        "🎯 意图复述（主动提示层）：在回复末尾附三行块，供人类扫一眼纠偏：\n"
                        "       当前理解：<一句话复述任务目标，含边界（做什么/不做什么）>\n"
                        "       进度：<清单 F 项状态一行>\n"
                        "       下一步：<即将做的具体动作>\n"
                        "       若理解有偏差，人类只需回「不对」即触发顾问对质；"
                        "不要等做完才发现方向错。"
                    )
                    with open(state_p, "w", encoding="utf-8") as f:
                        f.write(f"{newest}|{now_s}")
            except Exception:
                pass  # 状态读写失败不阻断反思

    # 9. 决策落盘提醒（公理二：决策链物质化——契约约定 AI 手写 decisions.md
    #    全靠自觉，这里是机器层补口。两类最该刻进石头的决策点：
    #    ① 用户纠正（地层里有 user_correction 化石）：错误方向必须留下尸体，
    #       防未来会话把否决路线再走一遍
    #    ② 顾问意见刚被消费（audit 近期有咨询）：采纳标注的 durable 半边
    #       ——audit.jsonl 里 adopted 是 null，落 decisions.md 才闭环）
    try:
        from datetime import datetime as _dt
        lib_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
        if lib_dir not in sys.path:
            sys.path.insert(0, lib_dir)
        from journal import load_journal
        from datetime import timedelta as _td
        cutoff = _dt.now() - _td(minutes=10)

        def _ev_ts(e):
            try:
                return _dt.fromisoformat(e["ts"][:19])
            except (ValueError, KeyError, TypeError):
                return None
        recent_correction = any(
            e.get("kind") == "user_correction" and (_ev_ts(e) or cutoff) >= cutoff
            for e in load_journal(project_dir)[-20:]
        )
        triggers = []
        if recent_correction:
            triggers.append((
                "correction",
                "✍️ 决策落盘（用户纠正）：把【错误方向＋修正后的方向＋一句理由】"
                "append 进 .regress/decisions.md（否决过的方案必须留下尸体，"
                "防未来会话重走）；文件不存在按 init 模板创建。",
            ))
        if _recent_consult(10):
            triggers.append((
                "consult",
                "✍️ 决策落盘（顾问意见）：把【已咨询→采纳/部分采纳/不采纳＋一句依据】"
                "append 进 .regress/decisions.md——审计闭环的 durable 半边"
                "（audit.jsonl 的 adopted 字段仍是 null，聊天里的标注会随上下文蒸发）。",
            ))
        session = (
            os.environ.get("CLAUDE_SESSION_ID")
            or os.environ.get("ZCODE_SESSION_ID")
            or "default"
        )
        for kind, msg in triggers:
            cool_p = os.path.join(
                tempfile.gettempdir(),
                f"regress-guard-lastdecision-{session}-{kind}")
            try:
                if time.time() - float(open(cool_p).read().strip()) < 1200:
                    continue  # 同类 20 分钟冷却，防唠叨
            except (IOError, ValueError):
                pass
            reminders.append(msg)
            with open(cool_p, "w", encoding="utf-8") as f:
                f.write(str(time.time()))
    except Exception:
        pass  # 决策提醒失败不阻断反思

    return reminders if reminders else None


def _get_read_counter_path():
    import tempfile
    return os.path.join(tempfile.gettempdir(), "regress-guard-read-counter.json")


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)

    project_dir = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )

    reminders = check_context(project_dir)
    if reminders:
        reflection_prompt = (
            "【regress-guard 反思检查】在结束本轮回复前，确认：\n"
            + "\n".join(f"  • {r}" for r in reminders)
            + "\n\n如果以上有遗漏，先补做再结束。"
        )
        print(json.dumps({"additionalContext": reflection_prompt}))
    # exit 0 = 不阻断，可以继续（最多 3 次继续请求）
    sys.exit(0)


if __name__ == "__main__":
    main()
