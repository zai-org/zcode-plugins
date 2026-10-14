#!/usr/bin/env python3
"""glm-routing-suite 核心：任务 → 推理模式路由（零依赖，纯函数）。

移植自 yjh051108/dsh-routing-suite (MIT) 的
preset/router-standard/router-core.mjs。实测背景（上游 P1-P23，21 点 × n=2，
v4-pro）：模型行为沿 react↔spec 轴坍缩为三段稳定区而非连续谱——
spec [0, 0.15]、过渡带 [0.2, 0.45]（不稳定混合，回避）、react [0.5, 1.0]
（11 个 mode 值行为一致）。第四模式 weak = 模型自路由（P8/P11 判别 +5.0；
pro 最优 weak persona = spec 句 + few-shot 路由指令，flash = 中性 + 先分类，
spec 句 persona 在 flash 上反向路由）。

行为带语义：
  mode 0    → spec   计划优先、集体式、读优先工具
  mode 0.3  → mixed  过渡带（陷阱；仅显式选择）
  mode 1    → react  执行者，产出-验证-修复，抑制测试仪式
  mode weak → weak   模型按任务自路由

本文件不做任何文件读写与网络访问。
"""
import re

MODE_SPEC = 0
MODE_MIXED = 0.3
MODE_REACT = 1
MODE_WEAK = "weak"

SPEC_PERSONA = "You are a helpful software engineer assistant."

MIXED_PERSONA = (
    "You are a helpful software engineer assistant.\n"
    "Work directly: prefer writing or editing code over describing plans. "
    "Verify your changes by reading and running them."
)

REACT_PERSONA = (
    "You are a hands-on software engineer who delivers working output fast.\n"
    "Work directly: write or edit code, then verify it by reading and running. "
    "Keep the loop tight — produce, verify, fix — and do not build test "
    "harnesses, scaffolding, or ceremony the user did not ask for. "
    "Finish with a usable deliverable and a short summary."
)

# weak（自路由）persona——按模型分最优（上游 P11/P24 实测）：
#   pro:   spec 句 + 分类指令（few-shot 变体和回顾/收敛锚点在 pro 上反而掉分）
#   flash: 中性 + 分类 + 回顾/收敛/反跑题锚点（单任务完成率 0% → 100%，P23）
WEAK_PRO = (
    "You are a helpful software engineer assistant.\n"
    "Before acting, decide the task type (build or fix) and adopt the matching "
    "style: build → hands-on production; fix → inspect-and-plan."
)

WEAK_FLASH = (
    "You are a helpful assistant.\n"
    "Before acting, decide the task type (build or fix) and adopt the matching "
    "style: build → hands-on production; fix → inspect-and-plan.\n"
    "Before acting, briefly review what you have already done in this session "
    "and continue from where you left off; do not repeat completed steps. Do not "
    "run environment checks (echo, whoami, uname, node --version, date) or "
    "exhaustive grep/glob scans.\n"
    "Think deeply first, then produce."
)

# 复杂度启发（上游 v19，深度自适应）：长任务或架构性措辞 → COMPLEX。
COMPLEX_RE = re.compile(
    r"(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|"
    r"refactor|comprehensive|detailed|design|system|optimize|analyze)", re.I)

# 任务分类关键词（上游实测产物，中英双语，原样保留）。
REACT_RE = re.compile(
    r"(开发|创建|写一个|生成|从零|做一个|游戏|网页|网站|构建|新项目|搭建|实现|"
    r"做出|上线|落地|脚本|工具|应用|build|create|develop|generate|implement|"
    r"make a|new project)", re.I)

SPEC_RE = re.compile(
    r"(修复|修一下|调试|重构|维护|排查|报错|出错|崩溃|优化|审查|review|fix|"
    r"debug|refactor|maintain|repair|broken|break|为什么|异常|故障|迁移|升级|兼容)",
    re.I)


def clamp01(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        n = 0.0
    return min(1.0, max(0.0, n))


def is_complex_task(text):
    return isinstance(text, str) and (len(text) > 120 or bool(COMPLEX_RE.search(text)))


def is_flash_model(model_id):
    return isinstance(model_id, str) and bool(re.search(r"flash", model_id, re.I))


def band_of(mode):
    """把 mode 量化到四个实测行为带之一。"""
    if mode == "weak":
        return "weak"
    m = clamp01(mode)
    if m < 0.2:
        return "spec"        # 实测稳定 spec 区（0..0.15）
    if m < 0.5:
        return "transition"  # 实测不稳定带——回避
    return "react"           # 实测稳定 react 区（0.5..1 行为一致）


def band_for(mode):
    b = band_of(mode)
    return "mixed" if b == "transition" else b


def persona_for(mode, model_id):
    b = band_of(mode)
    if b == "spec":
        return SPEC_PERSONA
    if b == "transition":
        return MIXED_PERSONA
    if b == "weak":
        return WEAK_FLASH if is_flash_model(model_id) else WEAK_PRO
    return REACT_PERSONA


def core_for(mode):
    """各带的工具面偏好（上游 v0.2.0：weak 走 RL 形状——shell+编辑器）。"""
    b = band_of(mode)
    if b == "spec":
        return ["read", "edit", "glob", "grep"]          # 读优先
    if b == "transition":
        return ["read", "edit", "write", "glob", "grep"]  # 并集
    if b == "weak":
        return ["str_replace_editor"]                     # RL 形状：shell + 编辑器
    return ["read", "write", "edit"]                      # 写优先


def testiness_for(mode):
    b = band_of(mode)
    if b == "react":
        return "suppressed"
    if b == "spec":
        return "normal"
    return "light"


def _count_hits(regex, text):
    return len(regex.findall(text or ""))


def classify_task(text):
    """任务文本 → mode。明确关键词证据选稳定带（1 react / 0 spec）；
    含糊或无匹配返回 weak——模型自路由（上游 P11 最优）。"""
    react = _count_hits(REACT_RE, text)
    spec = _count_hits(SPEC_RE, text)
    if react > spec:
        return MODE_REACT
    if spec > react:
        return MODE_SPEC
    return MODE_WEAK


def task_class_of(text):
    """人读的任务类型名：build / fix / weak。"""
    mode = classify_task(text)
    if mode == MODE_REACT:
        return "build"
    if mode == MODE_SPEC:
        return "fix"
    return "weak"


def parse_mode(token):
    """解析用户/模型给的 mode 记号：数字 0-100、0.0-1.0、带名或 auto。"""
    if token is None:
        return None
    t = str(token).strip().lower()
    if t == "auto":
        return "auto"
    if t in ("weak", "router"):
        return "weak"
    if t in ("spec", "spec-lean"):
        return 0
    if t in ("balanced", "mixed"):
        return 0.3  # 过渡带中心
    if t in ("react", "react-lean"):
        return 1
    try:
        n = float(t)
    except ValueError:
        return None
    if "." in t:
        return clamp01(n)
    return clamp01(n / 100.0)


def auto_advance(stage, tool_names):
    """完成信号驱动晋级（上游 v1.19 严格 workflow 的移植，取代已废弃的
    v0.8"工具调用即晋级"语义）：
      0→1：ask_user_question（已澄清）/ todo_write / exit_plan_mode（已计划）
      1→2：todo_write（计划已记录）/ exit_plan_mode（计划已呈现）
      2→3：delivery_check（产物自检/交付准备）
    工具名不跨档跳级；工具使用本身绝不跳级。
    """
    if stage >= 3:
        return stage
    names = set(tool_names if isinstance(tool_names, list) else [])
    if stage == 0 and names & {"ask_user_question", "todo_write", "exit_plan_mode"}:
        return 1
    if stage == 1 and names & {"todo_write", "exit_plan_mode"}:
        return 2
    if stage == 2 and "delivery_check" in names:
        return 3
    return stage


STAGE_NAMES = ["了解/对齐", "拟合方案", "开发", "验证/交付"]
