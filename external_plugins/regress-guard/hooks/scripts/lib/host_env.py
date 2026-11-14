"""host_env —— 宿主环境垫片（批166，REGRESS-2026-164：dsh 桌面版支持）。

不同宿主给钩子传会话身份的方式不同：
- ZCode / Claude Code 系：CLAUDE_SESSION_ID / ZCODE_SESSION_ID 环境变量
- dsh（经 dsh-hooks-claude-code 桥）：**不设该 env**——会话身份在 stdin
  payload 的 session_id 字段（桥契约：every agent-scoped stdin payload
  carries session_id）

无此垫片时 dsh 上全部会话落 default 键：read_before_edit 计数跨会话串味
（P2#17 病理——批159 曾因共享键在并行档翻车）、提交归因全混一桶。
错归属比无归属糟，垫片只补缺不覆盖（已有 env=宿主明示，尊重之）。
"""
import os
import re
import sys
import tempfile


# ─── 批191（v2.8.0）：Windows 10+ 路径/编码垫片 ────────────────────

def ensure_utf8_stdio() -> None:
    """stdout/stderr 重配为 UTF-8（批191）。

    中文 Windows 默认 cp936：GBK 编不了守卫输出的 emoji（21 处），
    UnicodeEncodeError 不属 OSError 系——既有 except (IOError, OSError)
    捕不住 → 钩子进程异常退出。errors="replace" 保证输出永不炸。
    幂等无害；流不可重配（被测试替换/已关闭/非 TextIO）时静默跳过。
    双保险另一层：launcher 给子进程注入 PYTHONUTF8=1（本函数覆盖
    直调/测试路径）。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError, OSError):
            pass


def is_root(p: str) -> bool:
    """目录树根判定（批191）：dirname(p)==p 即根（空串不是任何根）。

    POSIX "/"、Windows 盘符 "C:\\\\"、UNC "\\\\\\\\server\\\\share" 三态通用——
    逐字串比较（p == "/"）在 Windows 上恒假。"""
    return bool(p) and p == os.path.dirname(p)


_WIN_FORM = re.compile(r"^[A-Za-z]:[\\/]|^\\\\")


def is_abs_any(p: str) -> bool:
    """跨平台绝对路径判定（批195）：宿主 os.path.isabs 或 Windows 形态
    （盘符 X:\\ / X:/ 、UNC \\\\\\\\server）任一即真。

    Linux 宿主判 Windows 命令串（公网 issue#2 场景：CI/测试机跑 Windows
    语义用例）时 os.path.isabs("C:\\\\data") 恒假 → 被当项目内相对路径
    放行——路径的绝对性是字符串属性，不应随宿主漂移。"""
    return os.path.isabs(p) or bool(_WIN_FORM.match(p))


def win_form(p: str) -> bool:
    """是否 Windows 形态路径（批195）——供方言分支用（Windows 形态目标
    不进宿主 realpath/abspath：POSIX 宿主会折进 cwd 成幻影路径）。"""
    return bool(_WIN_FORM.match(p))


def normcase_abspath(p: str) -> str:
    """绝对化 + 平台归一（批191）：Windows 上 normcase 折叠大小写与斜杠
    （C:\\\\Foo ≡ c:/foo——env 给的盘符大小写与 realpath 实际大小写可能
    不一致），POSIX 上恒等。供路径前缀比较统一入口。"""
    return os.path.normcase(os.path.abspath(p))


def path_within(child: str, parent: str) -> bool:
    """child 是否在 parent 目录内（含相等）。

    盘符大小写归一比较；parent 为根（"/"或"C:\\\\"）时任何绝对 child 都
    在其内（根的前缀拼接 "C:\\\\" + os.sep 会得到幻影路径，须特判）。"""
    c, p = normcase_abspath(child), normcase_abspath(parent)
    if c == p:
        return True
    if p.endswith(os.sep):  # 根路径自带分隔符（POSIX "/"、盘符 "C:\\"）
        return c.startswith(p)
    return c.startswith(p + os.sep)


def materialize_tool_input(payload):
    """tool_input 字符串→对象就地物化（批168：demo 抓真穿门根修）。

    dsh 某些模型通道（实证 GLM/zai pi-ai）把 tool-call arguments 序列化
    为 JSON 字符串而非对象——钩子端 tool_input 非 dict → 命令键提取落空
    → 提交门禁判"非提交"放行=越界提交穿门（会话 b948e95d seq229 铁证，
    2026-10-31 桌面端真实 demo）。物化失败（非法 JSON）保持原值=既有
    语义（无命令可判的放行路径不变）。"""
    if isinstance(payload, dict):
        ti = payload.get("tool_input")
        if isinstance(ti, str) and ti.strip():
            try:
                import json
                obj = json.loads(ti)
                if isinstance(obj, dict):
                    payload["tool_input"] = obj
            except ValueError:
                pass
    return payload


def sandbox_aware_state_dir():
    """跨调用状态文件目录（批167 终版：项目亲和，免探测）。

    e2e 活体（2026-10-30）：dsh 沙箱给每个钩子进程**私有 tmpfs /tmp**——
    探测"成功"、写入"成功"、跨进程全丢（journal 走工作区才存活）——
    探测法测不出这种沙箱。故改为确定性规则，不探测：
      1. RG_STATE_DIR env（测试钉位/运维覆盖）
      2. CLAUDE_PROJECT_DIR 在场且其 .regress 存在（=已接入治理的项目）
         → 项目 .regress/tmp（工作区=两宿主皆可写且持久；状态随项目走
         语义上更正确）
      3. 否则 tempfile.gettempdir()（旧语义：未接入项目/无 env 的调用面）
    dsh 桥按契约设 CLAUDE_PROJECT_DIR；ZCode 亦然——主战场（治理项目内）
    两宿主统一走项目内。"""
    override = os.environ.get("RG_STATE_DIR")
    if override:
        return override
    # run61 批183：ZCODE_ 先于 CLAUDE_（宿主原生优先，兼容别名在后）——
    # 双变量异值时（会话带 CLAUDE_ 指真项目 + 测试覆写 ZCODE_ 指 tmp）
    # 旧序把探针事件吸进真项目账本（12 条串位标本）
    proj = (os.environ.get("ZCODE_PROJECT_DIR")
            or os.environ.get("CLAUDE_PROJECT_DIR"))
    if proj and os.path.isdir(os.path.join(proj, ".regress")):
        d = os.path.join(proj, ".regress", "tmp")
        try:
            os.makedirs(d, exist_ok=True)
        except OSError:
            pass  # 写者自有 except 静默（既有语义）
        return d
    return tempfile.gettempdir()

# dsh 工具名→CC 规范名（批166 侦察实证：dsh 注册小写 bash/read/write/edit
# 另有 pwsh；钩子内部分支按 CC 大小写匹配——不规范化则 dsh 会话全线漏判，
# 表现为"放行"实为"没认出来"的假阴性）。pwsh→Bash：同属命令执行语义
# （守卫按 Bash 形态提命令串）。read_image 不映射：matcher 层已排除
# （图像不授文本认知，docs/dsh-support.md 留痕）。
_CANON_TOOL = {"bash": "Bash", "pwsh": "Bash", "read": "Read",
               "write": "Write", "edit": "Edit"}


def canonicalize_tool_names(payload):
    """把 dsh 小写工具名规范化为 CC 形态（原地改写 tool_name，幂等）。

    仅映射已知 dsh 名；其余（CC 名/未知名）不动——未知工具交给各守卫
    既有语义（C 档让门禁自判，不在此猜测）。"""
    if isinstance(payload, dict):
        t = payload.get("tool_name")
        if isinstance(t, str) and t in _CANON_TOOL:
            payload["tool_name"] = _CANON_TOOL[t]
    return payload


def absorb_session(payload):
    """从 stdin payload 吸收 session_id 到 env（仅当 env 无会话键时）。

    payload 非 dict / 无 session_id / env 已有键 → 不动（fail-open 垫片，
    缺身份回退 default 键是既有语义）。返回最终生效的会话键（教学位）。
    """
    if not isinstance(payload, dict):
        return os.environ.get("CLAUDE_SESSION_ID") \
            or os.environ.get("ZCODE_SESSION_ID") or "default"
    sid = payload.get("session_id")
    if not sid or not isinstance(sid, str):
        return os.environ.get("CLAUDE_SESSION_ID") \
            or os.environ.get("ZCODE_SESSION_ID") or "default"
    if not (os.environ.get("CLAUDE_SESSION_ID")
            or os.environ.get("ZCODE_SESSION_ID")):
        os.environ["CLAUDE_SESSION_ID"] = sid
    return os.environ.get("CLAUDE_SESSION_ID") \
        or os.environ.get("ZCODE_SESSION_ID") or "default"
