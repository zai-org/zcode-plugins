#!/usr/bin/env python3
"""AGENT-HOOKS-0.1 适配层（批158，v1.107.0）：把 regress-guard 提交门禁
暴露为跨框架 interceptor——一次适配，任何实现该契约的宿主可装
（LangGraph/OpenAI Agents SDK/MS Agent Framework/Semantic Kernel/
LlamaIndex/CrewAI/Claude Agent SDK/裸参考宿主）。

契约钉 AGENT-HOOKS-0.1（github.com/responsibleai/agent-hooks，
spec/AGENT-HOOKS-0.1.md）：interceptor 鸭子类型 intercept(context)->Verdict，
零 SDK 依赖（中间件由宿主侧安装）；本模块只声明 pre_tool_call 提交门禁子集
（能力声明全文 docs/AGENT-HOOKS.md）。

设计（顾问四问四答全采纳）：
- 三档路径防漏检（反转白名单制）：A=已知非 shell 工具且无命令键 → 零开销
  allow；B=args 有命令类键 → 进程内跑门禁的提交检测（非提交 → allow）；
  C=其余未知形态（含新框架新工具名）→ 慢路径子进程让门禁自判——**不确定
  一律放慢**，宁可多付一次快退出的子进程，不冒漏拦提交的险。
- 子进程包装而非进程内重构：对现有门禁零手术+进程隔离+与部署形态一致。
  非 0 一律 deny（不只认 2，fail-closed）；reason 用 regress_guard: 前缀
  （host_error: 是宿主合成词，拦截器禁用）。
- evidence 增强且不存原始命令（可能含密钥）：只存摘要与元数据，主动截到
  spec 上限 10KB 内。
- 按 tool_call.id 去重（宿主多点重派不重跑门禁）；非 UTF-8 容错
  （errors=replace）；无命令形态显式 allow（无命令即无提交）。
"""
import hashlib
import json
import os
import subprocess
import sys
import time

# 已知非 shell 工具（读侧/检索侧）——仅这些且无命令键才零开销快放。
# 名单宁缺毋滥：不在名单=走慢路径（多付开销不冒漏检险）。
_KNOWN_NON_SHELL = frozenset({
    "Read", "Grep", "Glob", "LS", "List", "ls", "TodoRead", "TodoWrite",
    "WebFetch", "WebSearch",
})
# 命令类键（B 档探测）：命中即做进程内提交检测。
_COMMAND_KEYS = ("command", "cmd", "bash", "script", "sh", "code",
                 "command_line", "cmdline", "expr")

_EVIDENCE_MAX = 10240  # spec §5：evidence canonical JSON ≤ 10240 字节

_ADAPTER_VERSION = "0.1.0"


def _default_guard_path():
    # lib/agent_hooks_adapter.py → ../pre_commit_guard.py
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "pre_commit_guard.py")


def _looks_commit_like(text):
    """进程内快检测（B 档）：复用门禁同源的提交命令判定。"""
    try:
        scripts_dir = os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))  # lib/ → scripts/（门禁所在）
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        from pre_commit_guard import is_git_commit  # 门禁同源判定
        return bool(is_git_commit(json.dumps({"command": text})))
    except Exception:
        return True  # 检测器自身故障=保守按提交处理（放慢路径让门禁自判）


class RegressGuardInterceptor:
    """AGENT-HOOKS-0.1 interceptor：pre_tool_call 点上的提交门禁。

    宿主注册（Python SDK 形态）：
        kind("dev.regress-guard.commit_gate",
             lambda config, ctx: RegressGuardInterceptor(**config))
    config 可带 project_dir（门禁治理的项目根；缺省=宿主进程 cwd）/timeout。
    """

    def __init__(self, project_dir=None, guard_path=None, timeout=600):
        self.project_dir = project_dir or os.getcwd()
        self.guard_path = os.path.abspath(guard_path or _default_guard_path())
        self.timeout = int(timeout)
        self._verdict_cache = {}  # tool_call.id -> verdict（去重，上限丢弃）

    # ── 契约入口 ────────────────────────────────────────────
    def intercept(self, context):
        try:
            return self._intercept(context or {})
        except Exception as e:  # 自身故障显式 fail-closed（宿主另有兜底）
            return {"decision": "deny",
                    "reason": "regress_guard:adapter_crashed",
                    "message": f"adapter internal error: {type(e).__name__}"}

    def to_envelope(self, verdict, extensions=None):
        """§5.5 响应信封形：{verdict, extensions}（宿主/SDK 也会归一化）。"""
        return {"verdict": verdict,
                "extensions": {"regress_guard":
                               {"adapter_version": _ADAPTER_VERSION,
                                **(extensions or {})}}}

    # ── 三档路径 ────────────────────────────────────────────
    def _intercept(self, ctx):
        if ctx.get("interception_point") != "pre_tool_call":
            return {"decision": "allow"}  # 声明子集：仅此点有逻辑
        tc = ctx.get("tool_call") or {}
        tcid = str(tc.get("id") or "")
        if tcid and tcid in self._verdict_cache:
            return self._verdict_cache[tcid]  # 多点重派去重
        name = str(tc.get("name") or "")
        args = tc.get("args")
        args = args if isinstance(args, dict) else {}

        cmd = self._extract_command(name, args)
        verdict = self._decide(name, cmd, ctx)
        if tcid:
            if len(self._verdict_cache) > 64:
                self._verdict_cache.clear()
            self._verdict_cache[tcid] = verdict
        return verdict

    def _extract_command(self, name, args):
        """三档命令抽取：A 档 None-fast / B 档键命中 / C 档最长字符串兜底。"""
        has_cmd_key = any(k in args for k in _COMMAND_KEYS)
        if name in _KNOWN_NON_SHELL and not has_cmd_key:
            return None, "A"   # 已知读侧工具且无命令键 → 零开销放行
        for k in _COMMAND_KEYS:
            v = args.get(k)
            if isinstance(v, str) and v.strip():
                return v, "B"  # 命令键命中 → 进程内检测
        # C 档：未知形态——取最长字符串值当候选命令（宁可疑不漏检）
        best = ""
        for v in args.values():
            if isinstance(v, str) and len(v) > len(best):
                best = v
            elif isinstance(v, dict):
                for vv in v.values():
                    if isinstance(vv, str) and len(vv) > len(best):
                        best = vv
        return (best or None), "C"

    def _decide(self, name, cmd_tier, ctx):
        cmd, tier = cmd_tier
        if tier == "A" or not cmd:
            # A 档快放；任何档抽不到命令 → 显式 allow（无命令即无提交）
            return {"decision": "allow",
                    "evidence": self._evidence(tier=tier, note="no-command")}
        if tier == "B" and not _looks_commit_like(cmd):
            return {"decision": "allow",
                    "evidence": self._evidence(tier=tier, note="non-commit")}
        # B 档提交形 / C 档一切未知 → 慢路径真门禁
        return self._run_guard(name, cmd, ctx, tier)

    # ── 慢路径：子进程真门禁 ────────────────────────────────
    def _run_guard(self, name, cmd, ctx, tier):
        payload = json.dumps({"tool_name": name or "Bash",
                              "tool_input": {"command": cmd}})
        # 批195：+SYSTEMROOT（Windows python.exe 无它 PRNG 初始化失败，
        # 表现为 Fatal _Py_HashRandomization_Init——launcher.js ENV_KEEP
        # 早有此认知，此处同步）；+PYTHONUTF8=1（守卫中文/emoji 输出，
        # 与 launcher 非 guard 策略一致）
        env = {k: v for k, v in os.environ.items()
               if k in ("PATH", "HOME", "LANG", "TERM", "TMPDIR", "SYSTEMROOT")}
        env["PYTHONUTF8"] = "1"
        env["ZCODE_PROJECT_DIR"] = self.project_dir
        sess = (ctx.get("session") or {}).get("id")
        env["ZCODE_SESSION_ID"] = str(sess or "agent-hooks")
        t0 = time.time()
        try:
            p = subprocess.run(
                [sys.executable, self.guard_path], input=payload,
                capture_output=True, text=True, encoding="utf-8",
                errors="replace",
                cwd=self.project_dir, env=env, timeout=self.timeout)
            rc, err = p.returncode, p.stderr or ""
        except subprocess.TimeoutExpired:
            return {"decision": "deny", "reason": "regress_guard:guard_timeout",
                    "message": f"guard exceeded {self.timeout}s",
                    "evidence": self._evidence(tier=tier, timeout=True)}
        except OSError as e:
            return {"decision": "deny", "reason": "regress_guard:guard_crash",
                    "message": f"guard not runnable: {e}",
                    "evidence": self._evidence(tier=tier, exit_code=-1)}
        dur_ms = int((time.time() - t0) * 1000)
        if rc == 0:
            return {"decision": "allow",
                    "warnings": self._warnings(err),
                    "evidence": self._evidence(tier=tier, exit_code=rc,
                                               duration_ms=dur_ms,
                                               stderr_tail=err[-200:])}
        # 非 0 一律 deny（不只认 2——fail-closed；2=门禁语义拦，他=异常态）
        return {"decision": "deny",
                "reason": "regress_guard:blocked" if rc == 2
                else "regress_guard:gate_error",
                "message": err.strip()[-600:] or f"guard exit {rc}",
                "evidence": self._evidence(tier=tier, exit_code=rc,
                                           duration_ms=dur_ms,
                                           stderr_tail=err[-200:])}

    # ── evidence / warnings（隐私律：不存原始命令，存摘要）──
    def _evidence(self, tier, exit_code=None, duration_ms=None,
                  stderr_tail=None, timeout=False, note=None):
        try:
            with open(self.guard_path, "rb") as f:
                guard_sha = hashlib.sha256(f.read()).hexdigest()[:12]
        except OSError:
            guard_sha = "unavailable"
        ev = {"runner": "regress-guard", "adapter_version": _ADAPTER_VERSION,
              "guard_sha256": guard_sha, "path_tier": tier}
        if exit_code is not None:
            ev["exit_code"] = exit_code
        if duration_ms is not None:
            ev["duration_ms"] = duration_ms
        if timeout:
            ev["timeout"] = True
        if note:
            ev["note"] = note
        if stderr_tail:
            ev["stderr_sha256"] = hashlib.sha256(
                stderr_tail.encode("utf-8", "replace")).hexdigest()[:12]
        # spec §5：canonical JSON ≤ 10240 字节——先序列化再主动截
        s = json.dumps(ev, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"))
        return ev if len(s.encode("utf-8")) <= _EVIDENCE_MAX else {
            "runner": "regress-guard", "truncated": True,
            "path_tier": tier}

    @staticmethod
    def _warnings(stderr):
        """门禁 stderr 的 ⚠️ 行转 spec warnings（可观测性透传）。"""
        out = []
        for line in stderr.splitlines():
            line = line.strip()
            if "⚠️" in line:
                out.append({"message": line[:200]})
                if len(out) >= 8:
                    break
        return out
