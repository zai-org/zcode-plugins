#!/usr/bin/env python3
# v1.32.5 金丝雀：任何调用尝试都先落痕（连 import 崩溃也可见）——定位客户端是否真的调了本钩子
try:
    import os as _os, sys as _sys, time as _time, tempfile as _tf
    with open(_os.path.join(_tf.gettempdir(), "regress-guard-stop-notify.log"), "a") as _f:
        _f.write(f"{_time.strftime('%m-%d %H:%M:%S')} CANARY argv={_sys.argv[1:3]}\n")
except Exception:
    pass
"""stop_notify — 轮末推送（v1.32.2：正常对话也推，用户令）。

病：done 事件只接在 /regress:finish（清单任务收尾），问答/分析/长自主轮不经过
任何推送点——用户离场等待时三度沉默（通道本身健康，双证据复验）。
v1.32.2：018 的"正常对话静音"设计被用户推翻——离场人类的任何轮次结束都是
"回来收货"信号。活跃对话的密集轮次由 90s 冷却天然吸收（隔 >90s 才再响）。

设计：UserPromptSubmit 已把最后一条用户输入存入状态文件
（prompt_intercept.load_last_prompt），Stop 时读它：
- 含授权词（自决策|自决|你决定|自主决|自动做|直接做|放手做）→
  chat「🏁 阶段完成：<指令摘要>」
- 不含 → chat「💬 回复完成：<指令摘要>」（v1.38 起独立 chat 事件，
  曾冒充 done 把发送台账刷成 done×375——真 done 只有 3 次）
- 90s 冷却（标记文件）防 finish 仪式推送后立即双响

Stop 钩子无 matcher（v1.27.1 空 matcher 掀翻整机的教训）。stdin 未用但保持读空。
"""
import os
import re
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB_DIR = os.path.join(_HERE, "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

from notify import notify  # noqa: E402

AUTONOMY_RE = re.compile(r"自决策|自决|你决定|自主决|自动做|直接做|放手做")
COOLDOWN_S = 90


def _project_dir():
    return (os.environ.get("CLAUDE_PROJECT_DIR")
            or os.environ.get("ZCODE_PROJECT_DIR")
            or os.getcwd())


def _last_prompt():
    """v1.32.3：优先读全局接力文件——按项目哈希的路径在钩子进程间目录解析漂移时
    会读空（三报沉默根因），全局单文件最后写入者生效；回落旧路径保兼容。"""
    import tempfile
    g = os.path.join(tempfile.gettempdir(), "regress-guard-last-prompt.global.txt")
    try:
        with open(g, encoding="utf-8") as f:
            t = f.read().strip()
        if t:
            return t
    except OSError:
        pass
    sys.path.insert(0, _HERE)
    from prompt_intercept import load_last_prompt
    return load_last_prompt()


def _log(decision, extra=""):
    """决策日志（append-only）：下次沉默报告一眼定位断点。"""
    import tempfile
    try:
        with open(os.path.join(tempfile.gettempdir(), "regress-guard-stop-notify.log"), "a") as f:
            f.write(f"{time.strftime('%m-%d %H:%M:%S')} pd={_project_dir()[-24:]} "
                    f"cooled={_cooled()} {decision} {extra}\n")
    except OSError:
        pass


def _marker_path():
    import hashlib
    key = hashlib.md5(_project_dir().encode()).hexdigest()[:8]
    import tempfile
    return os.path.join(tempfile.gettempdir(),
                        f"regress-guard-stop-notify-{key}.ts")


def _cooled():
    try:
        age = time.time() - os.path.getmtime(_marker_path())
        return age > COOLDOWN_S
    except OSError:
        return True


def _mark():
    try:
        with open(_marker_path(), "w") as f:
            f.write(str(time.time()))
    except OSError:
        pass


def should_notify(last_prompt, cooled=True):
    """v1.32.4 根治：推送与消息文本彻底解耦（图片/空文本轮也响——用户令"根治"）。
    冷却是唯一节流；last_prompt 仅作摘要装饰，不参与决策。"""
    return bool(cooled)




def _drift_notice_once():
    """v1.78（067）：Stop 级版本漂移警示——SessionStart 每会话只跑一次（宿主
    源码证实 resume 不重发），热会话全程旧版把关无人知（2026-09-20 夜宿主
    3.14.0→3.14.1 漂移，次晨巡检才发现）。每对版本只警一次：stderr 当轮可见
    （顾问精化④），chat 一条滞后可见；状态 tmp+rename 原子写（精化②）；
    版本比较规范化（精化③，self_heal._ver_key）。全程 best-effort（精化①）。"""
    try:
        sys.path.insert(0, _HERE)
        from self_heal import _drift_pair, _ver_key
        pair = _drift_pair()
        if not pair or _ver_key(pair[0]) == _ver_key(pair[1]):
            return
        installed, source_v = pair
        import json as _json
        import tempfile
        state = os.path.join(tempfile.gettempdir(), "regress-drift-noticed.json")
        key = f"{installed}->{source_v}"
        try:
            with open(state, encoding="utf-8") as f:
                if _json.load(f).get("pair") == key:
                    return  # 同对已警过：静默（零噪音）
        except (OSError, ValueError):
            pass
        print(f"REGRESS-GUARD: ⚠️ 版本漂移（轮末巡检）：已装 v{installed} vs 源仓 "
              f"v{source_v}——重启会话或跑 bash install.sh 激活；"
              f"消除漂移前本轮警示不重复",
              file=sys.stderr)
        try:
            tmp = state + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                _json.dump({"pair": key, "ts": time.strftime("%F %T")}, f)
            os.replace(tmp, state)  # 原子写防并发会话撕裂
        except OSError:
            pass
        try:
            notify(_project_dir(), "chat", "⚠️ 插件版本漂移",
                   f"已装 v{installed} 源仓 v{source_v}——重启会话或 install.sh 激活")
        except Exception:
            pass  # chat 滞后可见也行（stderr 已当轮可见）
    except Exception:
        pass  # 警示是增强不是依赖：不改退出码不阻塞


def main():
    try:
        _ = sys.stdin.read()
    except Exception:
        pass
    _drift_notice_once()  # v1.78：轮末漂移警示（自带节流，先于冷却判断）
    lp = _last_prompt()
    if not should_notify(lp, _cooled()):
        _log("SKIP", f"prompt={'有' if lp else '空'}")
        sys.exit(0)
    pd = _project_dir()
    excerpt = (lp or "").strip()[:24]
    if not excerpt:
        excerpt = "[图片或无文本消息]"
    if AUTONOMY_RE.search(lp or ""):
        title, body = f"🏁 阶段完成：{excerpt}", "授权轮已收尾，可下发下一步或回来验收"
    else:
        title, body = f"💬 回复完成：{excerpt}", "本轮对话已收尾，可继续追问或离场"
    try:
        notify(pd, "chat", title, body)  # v1.38：独立 chat 事件，不再冒充 done 污染统计
        _mark()
        _log("PUSH", title[:40])
    except Exception as e:  # 推送是增强不是依赖
        _log("ERROR", str(e)[:60])
        print(f"stop_notify: 推送失败（忽略）: {e}", file=sys.stderr)
    sys.exit(0)


if __name__ == "__main__":
    sys.exit(main())
