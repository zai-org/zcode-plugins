# -*- coding: utf-8 -*-
"""Token 用量查询库（多宿主，只读）。

宿主（--host / 配置 host / ZUSAGE_HOST，见 §宿主适配）：
- zcode（默认）= 本地用量库的 model_usage 逐请求表（路径经 resolve_db_path 镜像宿主 agent 会话库解析，兼容 dataBaseDir 迁移目录并仲裁陈旧候选）；
- workbuddy = ~/.workbuddy/workbuddy.db 的 session_usage 会话级表（上下文用量 + credit）。

既可作 CLI（python zusage.py [now|today|days N|sessions [N]|models [days]|workspace 关键词|session id前缀|watch [sec]|host]），
也可被 usage_mcp.py import 为查询库。
"""
import hashlib
import fnmatch
import json
import os
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

# 宿主路径合法值：绝对路径（POSIX 绝对 / Windows 盘符 / UNC）——相对值宿主无稳定基准，不采纳
_DB_BASE_ABS_RE = re.compile(r"^(?:[a-z]:[\\/]|\\\\|/)", re.IGNORECASE)


def _mirror_agent_db_path(value, home):
    """宿主 localUsageEvidence.resolveMirroredSessionDbPath 镜像：~/ 展开与绝对
    路径采纳；相对路径按 agent 工作区 cwd 解析、宿主视为无法镜像，返回 None 逐级回落。"""
    v = str(value or "").strip()
    if not v:
        return None
    if v.startswith("~/"):
        return home / v[2:]
    if _DB_BASE_ABS_RE.match(v):
        return Path(v)
    return None


def _db_write_fresh(path):
    """库写入新鲜度：db.sqlite 与 -wal 的最新 mtime；-shm 只读连接也会更新，不入仲裁。"""
    fresh = 0.0
    for suffix in ("", "-wal"):
        try:
            fresh = max(fresh, Path(str(path) + suffix).stat().st_mtime)
        except OSError:
            pass
    return fresh


def _adopt_migration_candidate(candidate, home):
    """issue #294 陈旧迁移库仲裁：3.18.0 宿主源码复核写库方（agent 链）恒写 HOME
    默认库、不消费 dataBaseDir，迁移目录库与 HOME 库并存时可能是历史遗留（候选
    「存在」不再等于「真实写入位」）。两库并存按写入新鲜度取舍：候选不落后（>=）
    才采纳；HOME 库未建仍采纳候选（#279 真迁移：那种用户的候选库才是被持续写入
    的一边，或全部数据只在迁移目录）。token_rate.py 内联同款，改动两处同步。"""
    home_db = home / ".zcode" / "cli" / "db" / "db.sqlite"
    if not home_db.exists():
        return True
    return _db_write_fresh(candidate) >= _db_write_fresh(home_db)


def resolve_db_path(env=None, home=None):
    """本地用量库路径（issue #279 及查漏补缺）：镜像宿主 agent 会话库解析
    （v3.17.1 onboarding/localUsageEvidence.resolveAgentSessionDbPath——写库方是
    agent 进程，其链不消费 dataBaseDir），并兼容 3.17.x 迁移目录两态：
      1) env ZCODE_SESSION_DB_PATH / ZCODE_SESSION_DB（宿主双别名按 env 键序取后）
      2) <home>/.zcode/cli/config.json 的 storage.sessionDbPath（CLI config 恒在
         HOME 不随迁移；缺文件/损坏/相对值忽略继续）
      3) setting.json dataBaseDir（绝对）或 ZCODE_DATA_BASE_DIR，且
         <base>/.zcode/cli/db/db.sqlite 已存在、写入新鲜度不落后 HOME 默认库——
         3.17.x 实测迁移用户库在迁移目录（宿主 copyDataDirectory 不搬 .zcode/cli）；
         但 3.18.0 宿主源码复核写库方恒写 HOME，「存在」不等于「真实写入位」
         （issue #294 陈旧迁移库），两库并存按 db.sqlite/-wal mtime 仲裁（-shm 不算）
      4) 默认 <home>/.zcode/cli/db/db.sqlite
    与宿主的差异：宿主「无法确定」（相对路径/project 级覆盖）按未知跳过证据源，
    本查询链必须落到一个库，故逐级回落；project 级覆盖同宿主属已知限制。
    token_rate.py 的默认路径与本函数同源，改动两处同步。"""
    env = os.environ if env is None else env
    home = Path.home() if home is None else Path(home)
    picked = ""
    for key, value in env.items():
        if key in ("ZCODE_SESSION_DB_PATH", "ZCODE_SESSION_DB"):
            picked = value or ""   # 宿主双别名按 env 键序取后（含空值，空即弃用该来源）
    candidate = _mirror_agent_db_path(picked, home)
    if candidate:
        return candidate
    try:
        file = home / ".zcode" / "cli" / "config.json"
        if file.exists():
            raw = json.loads(file.read_text(encoding="utf-8-sig"))
            storage = raw.get("storage") if isinstance(raw, dict) else None
            candidate = _mirror_agent_db_path(
                storage.get("sessionDbPath") if isinstance(storage, dict) else None, home)
            if candidate:
                return candidate
    except Exception:
        pass   # 缺文件/损坏忽略（宿主读不出按默认），不拖垮查询链
    try:
        file = home / ".zcode" / "v2" / "setting.json"
        if file.exists():
            raw = json.loads(file.read_text(encoding="utf-8-sig"))
            base = str((raw.get("dataBaseDir") if isinstance(raw, dict) else "") or "").strip()
        else:
            base = ""
    except Exception:
        base = ""   # 损坏按无迁移处理；env 迁移标记不受其连累（与 Node 侧同构）
    if not base or not _DB_BASE_ABS_RE.match(base):
        base = str(env.get("ZCODE_DATA_BASE_DIR") or "").strip()
    if base and _DB_BASE_ABS_RE.match(base):
        candidate = Path(base) / ".zcode" / "cli" / "db" / "db.sqlite"
        if candidate.exists() and _adopt_migration_candidate(candidate, home):
            return candidate
    return home / ".zcode" / "cli" / "db" / "db.sqlite"


DB_PATH = resolve_db_path()
CONFIG_PATH = Path(__file__).parent / "config.json"

try:
    import token_pricing as _pricing
except ImportError:   # 旧运行目录未部署新文件：预估费用整特性降级，快照无 cost/fx 字段
    _pricing = None

try:
    from usage_stats import (
        MIN_GEN_MS as _TPS_MIN_GEN_MS,
        MAX_GEN_MS as _TPS_MAX_GEN_MS,
        hides_reasoning as _shared_hides_reasoning,
        query_first_token_covers as _query_first_token_covers,
        row_gen_ms as _shared_row_gen_ms,
    )
except ImportError:   # 远端单文件直跑等无 usage_stats.py 场景：本模块内联兜底
    _TPS_MIN_GEN_MS = 200
    _TPS_MAX_GEN_MS = 3_600_000
    _shared_hides_reasoning = None
    _query_first_token_covers = None
    _shared_row_gen_ms = None


def load_config():
    cfg = {"context_window": 128000, "poll_ms": 2000}
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


# ---------- 宿主适配（host）：ZCode / WorkBuddy ----------
# 本项目原生面向 ZCode：用量是 ~/.zcode/cli/db/db.sqlite 里 model_usage 的逐请求行
# （input/output/思考/缓存/耗时齐备，可算速度、工具调用与预估费用）。
# WorkBuddy 是另一套宿主：用量落在 ~/.workbuddy/workbuddy.db 的 session_usage 会话级表，
# 只有「当前上下文已用 token + 每请求 credit 累计」，**没有**逐请求 token 分项与耗时。
# 因此两个宿主的指标集合不同：由 HOST_CAPS 声明，快照/报表按能力降级，
# 不把「取不到的 0」当真实值展示（速度、工具、费用在 workbuddy 上标为不可用）。
HOST_ZCODE, HOST_WORKBUDDY = "zcode", "workbuddy"
HOSTS = (HOST_ZCODE, HOST_WORKBUDDY)
_HOST_ALIASES = {"zcode": HOST_ZCODE, "z-code": HOST_ZCODE, "workbuddy": HOST_WORKBUDDY,
                 "work-buddy": HOST_WORKBUDDY, "wb": HOST_WORKBUDDY}
_HOST_LABELS = {HOST_ZCODE: "ZCode", HOST_WORKBUDDY: "WorkBuddy"}
HOST_CAPS = {
    HOST_ZCODE: {"tokens": True, "tps": True, "tools": True, "cost": True,
                 "context": True, "credits": False, "transcript": True},
    # WorkBuddy 的逐请求用量在会话正文里（providerData.rawUsage），因此 token/速度/工具
    # 都可得；费用靠 token_pricing 的牌价，未收录的模型按「不可得」处理（见 host_caps
    # 的运行时回退与 wb_usage.model_cost）。
    HOST_WORKBUDDY: {"tokens": True, "tps": True, "tools": True, "cost": True,
                     "context": True, "credits": True, "transcript": True},
}
_HOST_OVERRIDE = None   # 进程内最高优先（CLI --host；MCP 的 host 参数按次走 connect，不经这里）


def normalize_host(value):
    """宿主名归一（大小写/别名）；空值返回 None，未知值也返回 None（调用方给提示）。"""
    key = str(value or "").strip().lower()
    return _HOST_ALIASES.get(key) if key else None


def set_host(value):
    """进程内覆盖当前宿主（CLI --host、MCP 参数）；None/"" 清除覆盖。"""
    global _HOST_OVERRIDE
    host = normalize_host(value)
    if str(value or "").strip() and host is None:
        raise ValueError(f"unknown host: {value!r} (expected one of {', '.join(HOSTS)})")
    _HOST_OVERRIDE = host


def _sub_cfg(cfg, name):
    """config.<name> 下的对象；缺省/损坏一律当空 dict（不因坏配置整个查询失败）。"""
    sub = cfg.get(name) if isinstance(cfg, dict) else None
    return sub if isinstance(sub, dict) else {}


def host_config():
    """宿主相关配置（只取 host / hosts 两键）：脚本目录 config.json → 标准数据目录
    config.json，后者只补前者缺的键（与 _load_lang 同款两跳——标准安装的 config 在
    运行目录，不在插件目录）。不改 load_config() 的既有语义：context_window / poll_ms
    仍只读脚本目录，避免顺带改变老行为。"""
    merged = {}
    for base in (CONFIG_PATH, Path.home() / ".zcode" / "zcode-token-usage-statusbar" / "config.json"):
        try:
            data = json.loads(Path(base).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        if isinstance(data.get("host"), str):     # 先到者优先，后面只补缺
            merged.setdefault("host", data["host"])
        for key in ("hosts", "agents"):     # 同款逐键合并：先到者优先，后者只补缺
            sub = data.get(key)
            if isinstance(sub, dict):
                acc = merged.setdefault(key, {})
                for name, entry in sub.items():
                    if isinstance(entry, dict) and name not in acc:
                        acc[name] = entry
    return merged


def _effective_host_cfg(cfg=None):
    """生效的宿主配置 = 文件两跳结果，再叠调用方显式传入的 cfg（MCP/快照自己的 cfg 优先）。"""
    eff = host_config()
    if isinstance(cfg, dict):
        if isinstance(cfg.get("host"), str) and cfg["host"].strip():
            eff["host"] = cfg["host"]
        for key in ("hosts", "agents"):
            sub = cfg.get(key)
            if isinstance(sub, dict):
                acc = dict(eff.get(key) or {})
                acc.update({k: v for k, v in sub.items() if isinstance(v, dict)})
                eff[key] = acc
    return eff


def workbuddy_db_path(cfg=None):
    """WorkBuddy 用量库：环境变量 ZUSAGE_WORKBUDDY_DB > config.hosts.workbuddy.db_path > 默认。
    允许带 ~ 与 %VAR%（Windows）/ $VAR（POSIX）展开，方便多机共用同一份配置。"""
    raw = os.environ.get("ZUSAGE_WORKBUDDY_DB") or _sub_cfg(
        _sub_cfg(_effective_host_cfg(cfg), "hosts"), "workbuddy").get("db_path")
    if isinstance(raw, str) and raw.strip():
        return Path(os.path.expandvars(raw.strip())).expanduser()
    return Path.home() / ".workbuddy" / "workbuddy.db"


def zcode_db_path(cfg=None):
    """ZCode 用量库：config.hosts.zcode.db_path（可选，覆盖默认）> 模块级 DB_PATH。
    默认路径仍走 DB_PATH 这个可被测试/调用方替换的模块量（既有约定，不改成不可变常量）。"""
    raw = _sub_cfg(_sub_cfg(_effective_host_cfg(cfg), "hosts"), "zcode").get("db_path")
    if isinstance(raw, str) and raw.strip():
        return Path(os.path.expandvars(raw.strip())).expanduser()
    return Path(DB_PATH)


def host_db_path(host=None, cfg=None):
    host = normalize_host(host) or resolve_host(cfg=cfg)
    return workbuddy_db_path(cfg) if host == HOST_WORKBUDDY else zcode_db_path(cfg)


def resolve_host(override=None, cfg=None):
    """宿主判定优先级：显式 override > 环境变量 ZUSAGE_HOST > config.host > 默认 zcode。

    "auto" 是可选的自动探测（ZCode 库存在即选 zcode，否则 ZCode 库缺失且 WorkBuddy 库
    存在时选 workbuddy）。**默认不用 auto**：装了 WorkBuddy 的机器上原 ZCode 行为必须
    一字不变，想按机器自动选宿主的用户显式写 "host": "auto"。"""
    host = normalize_host(override) or normalize_host(_HOST_OVERRIDE)
    if host:
        return host
    host = normalize_host(os.environ.get("ZUSAGE_HOST"))
    if host:
        return host
    eff = _effective_host_cfg(cfg)
    choice = normalize_host(eff.get("host"))
    if choice:
        return choice
    # 没有任何显式配置时跟随客户端：WorkBuddy 构建默认读 WorkBuddy 库
    # （ZCode 构建里 detect_agent 恒为 zcode，行为与以前完全一致）。
    if detect_agent() == AGENT_WORKBUDDY:
        return HOST_WORKBUDDY
    if str(eff.get("host") or "").strip().lower() == "auto":
        if zcode_db_path(cfg).exists():
            return HOST_ZCODE
        if workbuddy_db_path(cfg).exists():
            return HOST_WORKBUDDY
    return HOST_ZCODE


def host_source(override=None, cfg=None):
    """当前宿主的判定来源（host 子命令/诊断用）：cli | env | config | agent | auto | default。"""
    if normalize_host(override) or normalize_host(_HOST_OVERRIDE):
        return "cli"
    if normalize_host(os.environ.get("ZUSAGE_HOST")):
        return "env"
    eff = _effective_host_cfg(cfg)
    if normalize_host(eff.get("host")):
        return "config"
    if detect_agent() == AGENT_WORKBUDDY:
        return "agent"
    if str(eff.get("host") or "").strip().lower() == "auto":
        return "auto"
    return "default"


def host_label(host=None):
    return _HOST_LABELS.get(normalize_host(host) or resolve_host(), HOST_ZCODE)


def host_caps(host=None):
    """宿主能力表。WorkBuddy 的逐请求指标依赖会话正文解析、费用还依赖价表，
    两者都是可选文件（精简部署/旧包里可能没有）——按运行时实际可用性回退，
    不承诺拿不到的指标。ZCode 侧全静态，与以前一致。"""
    key = normalize_host(host) or resolve_host()
    caps = dict(HOST_CAPS.get(key, HOST_CAPS[HOST_ZCODE]))
    if key == HOST_WORKBUDDY:
        if _wb_usage is None:
            caps.update(tokens=False, tps=False, tools=False, transcript=False)
        if _wb_usage is None or getattr(_wb_usage, "_pricing", None) is None:
            caps["cost"] = False
    return caps


def host_of(con):
    """连接所属宿主（连接由 connect() 打标记；外部自建连接按当前判定回退）。"""
    return getattr(con, "zusage_host", None) or resolve_host()


class _HostConn(sqlite3.Connection):
    """带宿主标记的连接：render_*/snapshot 按连接分派，不按全局猜测——
    serve 常驻进程复用同一连接跨请求，标记跟着连接走才不会张冠李戴。"""
    zusage_host = HOST_ZCODE


def _open_ro(path, probe):
    """只读连接优先；WAL shm 不可用时退回普通连接（全程只 SELECT）。
    fallback 前先确认文件存在：sqlite3.connect 对不存在的路径会新建空库，
    可能与尚未初始化的宿主产生交互（v32 审查修复）。"""
    path = Path(path)
    try:
        con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=3,
                              factory=_HostConn)
        con.execute(probe).fetchone()
    except sqlite3.OperationalError:
        if not path.exists():
            raise
        con = sqlite3.connect(str(path), timeout=3, factory=_HostConn)
    con.row_factory = sqlite3.Row
    return con


def connect(host=None):
    """按宿主打开只读连接；连接上带 zusage_host 标记供上层分派。"""
    target = resolve_host(host)
    if target == HOST_WORKBUDDY:
        con = _open_ro(workbuddy_db_path(), "select 1 from session_usage limit 1")
    else:
        con = _open_ro(zcode_db_path(), "select 1 from model_usage limit 1")
    con.zusage_host = target
    return con


# ---------- 宿主客户端（agent）与启动策略 ----------
# host（读哪个库）与 agent（在哪个客户端里跑、用哪种展示）是两件事：
# 同一份代码被两个客户端安装，但浮层形态不同——ZCode 走原来的 asar 注入，
# WorkBuddy 没有 asar 注入链，改走 CDP（客户端自带 --remote-debugging-port）。
# 启动策略集中在这里，调用方（MCP/hook）只问「这个 agent 该干什么」。
AGENT_ZCODE, AGENT_WORKBUDDY, AGENT_CLI = "zcode", "workbuddy", "cli"
AGENTS = (AGENT_ZCODE, AGENT_WORKBUDDY)
AGENT_STRATEGY = {
    AGENT_ZCODE: {"overlay": "asar", "mcp": True, "commands": True,
                  "rate_line": True, "updater": True},
    AGENT_WORKBUDDY: {"overlay": "cdp", "mcp": True, "commands": True,
                      "rate_line": False, "updater": False},
    AGENT_CLI: {"overlay": None, "mcp": True, "commands": True,
                "rate_line": False, "updater": False},
}
_OVERLAY_MODES = ("asar", "cdp", "off")


def detect_agent(env=None):
    """当前客户端。判定顺序（前者优先，全部可解释）：
    1. ZUSAGE_AGENT 显式指定（调试/测试）；
    2. 插件根环境变量：CODEBUDDY_PLUGIN_ROOT → WorkBuddy，ZCODE_PLUGIN_ROOT → ZCode；
    3. 插件目录里的 manifest 目录：.codebuddy-plugin → WorkBuddy，
       .zcode-plugin/.claude-plugin → ZCode；
    4. 默认 zcode——老安装（独立安装器 + 运行目录）没有 plugin 根变量，必须保持不变。

    刻意不看 CLIENT_INFO_PLATFORM 这类客户端指纹：它会被子进程继承，
    在 WorkBuddy 的终端里跑 ZCode 那份代码时会造成误判。"""
    env = env if env is not None else os.environ
    explicit = _agent_key(env.get("ZUSAGE_AGENT"))
    if explicit:
        return explicit
    if str(env.get("CODEBUDDY_PLUGIN_ROOT") or "").strip():
        return AGENT_WORKBUDDY
    if str(env.get("ZCODE_PLUGIN_ROOT") or "").strip():
        return AGENT_ZCODE
    here = Path(__file__).parent
    if (here / ".codebuddy-plugin").is_dir():
        return AGENT_WORKBUDDY
    if (here / ".zcode-plugin").is_dir() or (here / ".claude-plugin").is_dir():
        return AGENT_ZCODE
    return AGENT_ZCODE


def _agent_key(value):
    """agent 名归一：zcode/workbuddy 走别名表，cli/terminal 单列（不在 host 别名里）。"""
    key = str(value or "").strip().lower()
    if key in ("cli", "terminal", "none", "headless"):
        return AGENT_CLI
    return normalize_host(key)


def agent_strategy(agent=None):
    """该客户端的启动策略（副本，调用方可改）：overlay=asar|cdp|None、mcp、commands、
    rate_line（逐问速率行只有 ZCode 有渲染桥）、updater（插件更新器只有 ZCode 插件链有）。"""
    key = _agent_key(agent) or detect_agent()
    return dict(AGENT_STRATEGY.get(key, AGENT_STRATEGY[AGENT_CLI]))


def overlay_mode(agent=None, cfg=None):
    """生效的浮层模式：config.agents.<agent>.overlay（true/false/asar/cdp/off）覆盖策略表。
    false/off → None（不启动）；true → 策略表默认值。"""
    key = _agent_key(agent) or detect_agent()
    raw = _sub_cfg(_sub_cfg(_effective_host_cfg(cfg), "agents"), key).get("overlay")
    default = AGENT_STRATEGY.get(key, AGENT_STRATEGY[AGENT_CLI])["overlay"]
    if isinstance(raw, bool):
        return default if raw else None
    if isinstance(raw, str):
        value = raw.strip().lower()
        if value in ("off", "none", "no", "false", "0"):
            return None
        if value in ("asar", "cdp"):
            return value
        if value in ("on", "auto", "true", "1"):
            return default
    return default


def node_candidates():
    """node 可执行候选：PATH 优先，其次 WorkBuddy 自带（版本目录降序）。
    浮层注入器只在 WorkBuddy 用，自带 node 一定存在且带全局 WebSocket（22+）。"""
    found, seen = [], set()

    def add(path):
        key = os.path.normcase(os.path.abspath(str(path)))
        if key not in seen and os.path.isfile(str(path)):
            seen.add(key)
            found.append(str(path))

    add(shutil.which("node") or "")
    home = Path(os.environ.get("WORKBUDDY_HOME") or (Path.home() / ".workbuddy"))
    versions = home / "binaries" / "node" / "versions"
    if versions.is_dir():
        for d in sorted(versions.iterdir(), reverse=True):
            add(d / ("node.exe" if os.name == "nt" else "bin/node"))
    return found


def overlay_entrypoint():
    """CDP 浮层注入器路径（与 usage_mcp.py 同目录；ZCode 构建里不存在）。"""
    return Path(__file__).parent / "wb-overlay.cjs"



def _ts(ms):
    return datetime.fromtimestamp(ms / 1000) if ms else None


def _day_start(d=None):
    d = d or datetime.now()
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _epoch_ms(dt):
    return int(dt.timestamp() * 1000)


def _load_lang():
    """CLI/MCP 输出语言：config.json 的 "lang"（zh/en，缺省 zh）——与安装器/监控窗口同源。
    查找顺序：脚本目录（--dev/仓库直跑）→ 标准数据目录（标准安装的 config 不在脚本目录）。"""
    for base in (CONFIG_PATH,
                 Path.home() / ".zcode" / "zcode-token-usage-statusbar" / "config.json"):
        try:
            lang = json.loads(base.read_text(encoding="utf-8")).get("lang")
            if lang in ("zh", "en"):
                return lang
        except (OSError, ValueError):
            pass
    return "zh"


_LANG = _load_lang()


def L(zh, en):
    """双语输出（与 install.py / overlay.js 的 L 同款约定）。"""
    return en if _LANG == "en" else zh


def fmt(n):
    n = n or 0
    if n >= 1_000_000_000:
        return f"{n / 1e9:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.2f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


SESSION_TIMEOUT_MS = 30 * 60 * 1000  # 最近30分钟有请求视为活跃会话
# _TPS_MIN_GEN_MS / _TPS_MAX_GEN_MS 已从 usage_stats 导入（远端单文件直跑带内联兜底）
_TPS_LOOKBACK = 20             # first_token_at 缺失时向前找有效请求的扫描条数上限
_SPEED_SEGS_MAX = 10           # 速度柱状图分段上限（v240 用户规格：17→10）
# v253 速度 Tooltip 范围/时间/维度筛选：一次有界扫描出统一轮表（真实库），渲染端据此
# 推导全部 20 种组合，快照帧不随 hover 反复查询。上限是性能护栏，不是伪造补位数据。
_SPEED_HISTORY_MAX_TURNS = 6000   # 扫描窗口数与输出轮数上限（防超大库把 JSON 帧撑大）
_SPEED_HISTORY_TTL_MS = 2000      # 2s 短缓存（常驻泵 1.5s 拉一次，同帧同库免重扫）
# v257：全库扫描偶发失败（完成轮瞬间的 WAL 写窗口/连接重建）时回退最近一次成功轮表的
# 陈旧上限。轮表是历史统计，分钟级陈旧远好于整帧缺字段让 Tooltip 闪回旧版；下一帧成功即刷新。
_SPEED_HISTORY_STALE_MS = 10 * 60 * 1000
_SPEED_CACHE = {}                 # 独立缓存：不与 _cached_agg 的 scan/today 共用上限 8 的 _AGG_CACHE
_SPEED_WM = {}                    # 轮表缓存的 model_usage 水位（TTL 过期后水位未变续用，见 _WM_MAX_AGE_MS）
# v384（specs/speed-tooltip-v3.md §1.2）：全历史按本地自然日聚合，解决 6000 轮截断。
_SPEED_DAYS_MAX_DAYS = 550        # 覆盖窗口：截至今天（含）往前 N 个本地日；truncated 时渲染端明示
_SPEED_DAYS_MAX_MODELS = 8        # 日桶 msl 每模型条目上限（超出 capFlag=1，日级总量仍精确）
_DAYS_CACHE = {}                  # speed_days 缓存：与轮表 _SPEED_CACHE 同款独立缓存（不挤 _AGG_CACHE）
_DAYS_WM = {}                     # speed_days 缓存的 model_usage 水位（同款续用语义）


_AGG_TTL_MS = 2000   # 聚合短缓存：今日合计/会话池是慢变量，2s 陈旧无感；泵 1.5s 拉一次省约一半全表聚合
_AGG_CACHE = {}

# 卡顿治理（specs/perf-lag-reduction.md §8）：model_usage 水位延长聚合缓存。
# 宿主请求完成才一次性 INSERT、运行中无行（实测零 running 行），流式生成期间 model_usage 恒定不变，
# 但纯 TTL(2s) 仍每 ~3s 全量重算项目累计/速度轮表/今日合计（大库未命中帧 0.7~1.1s，占 25~45% 单核）。
# 现在 TTL 过期后若水位 (库身份, max(rowid)) 未变且距上次计算 <_WM_MAX_AGE_MS，继续复用；一旦有新请求
# 完成水位即变、TTL 一过立即重算（TTL 内行为不变）。水位未覆盖的变化（会话改名、尾行被删后 rowid 复用等）
# 由 _WM_MAX_AGE_MS 兜底。max(rowid) 是 B 树末端查找（微秒级），不做额外记忆——精确优先。
# 内存库/桩连接取不到水位 → 退回纯 TTL。
_WM_MAX_AGE_MS = 20 * 1000
_AGG_WM = {}


def _usage_watermark(con):
    """(库身份, max(rowid))；取不到（内存库/列漂移/桩连接）返回 None。"""
    try:
        dbkey = _db_cache_key(con)
        if dbkey is None:
            return None
        return (dbkey, con.execute("select max(rowid) from model_usage").fetchone()[0])
    except Exception:
        return None


def _wm_alive(wm_store, key, hit, con, now):
    """TTL 已过期后的二次判定：水位未变且未超 _WM_MAX_AGE_MS 则缓存仍可复用。"""
    if con is None or now - hit[0] >= _WM_MAX_AGE_MS:
        return False
    old = wm_store.get(key)
    return old is not None and _usage_watermark(con) == old


class _WmFn:
    """携带连接的计算闭包：让 _cached_agg 保持 (key, fn) 二参签名（既有测试以二参 lambda 替身该函数），
    同时把水位校验所需的连接带进来。未包装的 fn（无连接）退回纯 TTL。"""
    __slots__ = ("fn", "wm_con")

    def __init__(self, fn, con):
        self.fn = fn
        self.wm_con = con

    def __call__(self):
        return self.fn()


def _cached_agg(key, fn):
    con = getattr(fn, "wm_con", None)
    now = int(time.time() * 1000)
    hit = _AGG_CACHE.get(key)
    if hit:
        if now - hit[0] < _AGG_TTL_MS:
            return hit[1]
        if _wm_alive(_AGG_WM, key, hit, con, now):
            return hit[1]
    wm = _usage_watermark(con) if con is not None else None   # 必须先于 fn()：期间新写入只会让存下的水位偏旧→下次重算（安全方向）
    val = fn()
    if len(_AGG_CACHE) > 8:
        _AGG_CACHE.clear()   # 键固定只有几个，正常到不了；保险防膨胀
        _AGG_WM.clear()
    _AGG_CACHE[key] = (now, val)
    if wm is None:
        _AGG_WM.pop(key, None)
    else:
        _AGG_WM[key] = wm
    return val


_PROJ_CACHE = {}
_PROJ_WM = {}


def _db_cache_key(con):
    """v177：项目累计缓存的库身份键——文件库取 (path, dev, ino)，同路径换文件（删除重建/
    被替换）键随 stat 变化；内存库（:memory:，测试夹具）返回 None 不做跨调用缓存。
    sqlite3.Connection 不支持弱引用，连接级缓存不可行；按文件身份跨连接共享是安全的
    （同一文件即同一数据库，TTL 2s 约束陈旧度）。"""
    try:
        for row in con.execute("pragma database_list").fetchall():
            if row[1] == "main":
                path = row[2]
                break
        else:
            return None
    except (sqlite3.Error, AttributeError, TypeError):
        # 桩连接（测试替身游标无 fetchall / Mock 返回非序列）：契约本就是「取不到库身份→None→
        # 调用方退回不缓存」。_usage_watermark 同款宽捕获；这里补上以免新增调用点击穿整帧快照。
        return None
    if not path:
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (path, st.st_dev, st.st_ino)


def _cached_project(dbkey, key, fn, con=None):
    """v177：_project_usage 专用缓存，键挂库文件身份 + (project_id, 目录键, with_models)——常驻泵
    跨请求复用连接时吃到 2s TTL 的跨帧免重扫（实测无缓存大库单项目聚合 ~40ms，池内多行
    一帧可达数百 ms）。独立于 _AGG_CACHE：项目键随使用增长，混进共享缓存会把它顶过上限
    触发整体 clear、连带丢掉 scan/today 热条目。"""
    now = int(time.time() * 1000)
    full = (dbkey, key)
    hit = _PROJ_CACHE.get(full)
    if hit:
        if now - hit[0] < _AGG_TTL_MS:
            return hit[1]
        if _wm_alive(_PROJ_WM, full, hit, con, now):   # 流式期间 model_usage 恒定：水位未变续用（见 _WM_MAX_AGE_MS）
            return hit[1]
    wm = _usage_watermark(con) if con is not None else None
    val = fn()
    if len(_PROJ_CACHE) > 64:
        _PROJ_CACHE.clear()   # 保险防膨胀：清空只损失缓存，不损正确性
        _PROJ_WM.clear()
    _PROJ_CACHE[full] = (now, val)
    if wm is None:
        _PROJ_WM.pop(full, None)
    else:
        _PROJ_WM[full] = wm
    return val


_SESS_CACHE = {}
_SESS_WM = {}


def _cached_session(con, sid, kind, fn):
    """会话级聚合缓存（specs/perf-lag-reduction.md 规则 13）：键 (库身份, sid, kind)。
    长会话的 session_usage / 会话均速（全会话 fetchall + Python 逐行）/ 耗时均值原先
    每帧对每份完整快照全量重算（8,237 条消息的会话即每帧数万次逐行运算），是活跃期
    占空比主因。与 _cached_project 同款 2s TTL + 水位续用；取不到库身份时每次真算。"""
    dbkey = _db_cache_key(con)
    if dbkey is None:
        return fn()
    now = int(time.time() * 1000)
    full = (dbkey, sid, kind)
    hit = _SESS_CACHE.get(full)
    if hit:
        if now - hit[0] < _AGG_TTL_MS:
            return hit[1]
        if _wm_alive(_SESS_WM, full, hit, con, now):
            return hit[1]
    wm = _usage_watermark(con)   # 先于 fn()：期间新写入只让存下的水位偏旧→下次重算（安全方向）
    val = fn()
    if len(_SESS_CACHE) > 32:
        _SESS_CACHE.clear()   # 保险防膨胀：清空只损失缓存，不损正确性
        _SESS_WM.clear()
    _SESS_CACHE[full] = (now, val)
    if wm is None:
        _SESS_WM.pop(full, None)
    else:
        _SESS_WM[full] = wm
    return val


def _scan_session_ids(con):
    """全库 session_id → max(completed_at) 一次分组扫描（731MB 库 ~55ms）。
    最新会话与 recent 池原先各自独立做同样的全表 group by（3 次 118ms），
    合并为一次扫描并挂 2s TTL。"""
    def run():
        # coalesce：崩溃残留的未完成行 completed_at 为 NULL，全会话皆 NULL 时
        # max() 返回 NULL，下游 max()/sorted() 比较会 TypeError 击穿整帧快照。
        return con.execute(
            """select session_id, max(coalesce(completed_at, 0)) as m
               from model_usage group by session_id""").fetchall()
    return _cached_agg("scan", _WmFn(run, con))


def session_usage(con, sid):
    # last_request_input 取最近一次 completed 请求的 input_tokens（= 当前上下文容量）。
    # 不能用 max(input_tokens)：会话压缩后 input 骤降，峰值永远不回落（v28 修复）。
    # 规则 13：按 (库身份, sid) 缓存——本函数在长会话上每帧被多份快照重复调用。
    def run():
        r = con.execute(
            """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                      coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
                      coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                      coalesce(sum(tool_call_count),0),
                      (select m2.input_tokens from model_usage m2
                        where m2.session_id = m.session_id and m2.status = 'completed'
                        order by m2.completed_at desc, m2.id desc limit 1),
                      count(distinct turn_id), coalesce(sum(retry_count),0)
               from model_usage m where m.session_id=? and status='completed'""",
            (sid,),
        ).fetchone()
        return {
            "requests": r[0], "input": r[1], "output": r[2], "reasoning": r[3],
            "cache_read": r[4], "cache_write": r[5], "total": r[6], "tool_calls": r[7],
            "last_request_input": r[8] or 0, "turns": r[9], "retries": r[10],
        }
    return dict(_cached_session(con, sid, "usage", run))   # 浅拷贝出缓存：调用方改动不污染


def _norm_path_key(d):
    """目录归一化键：正反斜杠统一、去尾分隔、小写（Windows 不区分大小写，宿主 slug 亦
    小写化）。空串=缺失/根目录（issue #248 聚合过滤锚点，与 v229 项目名共用归一前段）。"""
    return (d or "").replace("\\", "/").rstrip("/").lower()


def _canon_model_name(existing, candidate):
    """同一模型大小写归一化时的优先展示名判定。
    优先保留含大写字母或大写字符较多者（如 'GLM-5.3' 优于 'glm-5.3'）。"""
    if not existing:
        return candidate or ""
    if not candidate:
        return existing
    if existing.islower() and not candidate.islower():
        return candidate
    if sum(1 for c in candidate if c.isupper()) > sum(1 for c in existing if c.isupper()):
        return candidate
    return existing


def _project_usage(con, sid, with_models=False):
    """项目累计（v159）：当前会话所属项目（session.project_id，与宿主 --continue 同一
    项目身份）下全部会话的 completed 用量聚合，口径与 session_usage 一致；计入主会话与
    其全部派生会话（parent_id 指向主会话的子代理、辅助对话、Fork 等——比「仅子代理」宽，
    都是本项目的真实消耗）。
    issue #248：宿主 project_id slug 剥非 ASCII（纯中文目录名整段被剥），同父目录多个
    中文项目坍缩共享父目录 project_id。主会话追加归一化目录等值过滤（_norm_path_key），
    碰撞时只统计同目录会话；派生会话经 parent_id 随主会话自动正确。同 project_id 本应
    同目录（worktree 等不同目录 project_id 不同），正常项目数值不变；当前会话 directory
    缺失（锚点为空）时不过滤，保持原全量口径。
    sessions/turns 取实际参与消耗的会话与轮（session_id+turn_id 组合去重）；会话不在
    本地库或无 project_id 时返回 None（渲染端判空不渲染该格）。
    with_models（v163）：附按模型明细（v164 起全量降序），轻量行不取。
    name（v229）：启动目录末段作项目名（正反斜杠归一；缺失/根目录为空串，渲染端判空不渲染）。
    v177：按库文件身份 + (project_id, 目录键, with_models) 挂 2s TTL 缓存（同帧同项目
    多会话共享、常驻泵跨帧免重扫；内存库不缓存）；聚合 IN 分片 500/批（老 SQLite <3.32
    变量上限 999，大项目会话数可超）。分片按 session_id 切——同一会话只落一片，distinct
    计数与求和跨片直接累加不重不漏，min/max 取跨片极值。"""
    prow = con.execute(
        "select project_id, directory from session where id=?", (sid,)).fetchone()
    if not prow or not prow[0]:   # 位置取值：con 可能没有 row_factory（远端链复用连接）
        return None
    # v229：项目名=启动目录末段（正反斜杠归一后取末段，Windows 路径在 POSIX 解析也正确）
    pdir = (prow[1] or "").replace("\\", "/").rstrip("/")
    pname = pdir.rsplit("/", 1)[-1] if pdir else ""
    pkey = _norm_path_key(pdir)

    def run():
        # issue #248：目录过滤在 Python 侧做（尾分隔/大小写归一无法可靠下推 SQL）；
        # 一次取回 id+directory，量级=项目主会话数。锚点为空（pkey=""）不过滤。
        rows = con.execute(
            """select id, directory from session where project_id=?
               and parent_id is null and substr(id,1,?)!='sess_subagent'""",
            (prow[0], _SUB_PREFIX_LEN)).fetchall()
        mains = [r[0] for r in rows
                 if not pkey or _norm_path_key(r[1]) == pkey]
        all_ids = list(mains)
        for i in range(0, len(mains), 500):
            part = mains[i:i + 500]
            qm = ",".join("?" * len(part))
            all_ids += [r[0] for r in con.execute(
                f"select id from session where parent_id in ({qm})", part)]
        if not all_ids:
            return None
        sessions = turns = requests = input_t = output_t = reasoning = 0
        cache_read = cache_write = total = tool_calls = retries = 0
        started = last_at = None
        # v303 项目级耗时/速度聚合（项目累计 tooltip 四行 KPI 第三/四行）：avg 口径同
        # v300 会话（>0 样本过滤）；总耗时=Σduration_ms（含全部 completed 行，与卡片
        # 「全部请求·含子代理」范围一致）；平均输出速度跨分片累加 _turn_rate 分量后
        # 合成（rated_output/gen_ms 可加和，不能对分片 tps 再平均）。
        dur_sum = dur_pos_sum = dur_pos_n = ttft_pos_sum = ttft_pos_n = 0
        rated_acc = gen_acc = 0
        covers = _provider_first_token_covers(con)
        proj_per_model = {}   # v375 逐模型速度（跨分片累加，main_turn 同口径）
        models_acc = {}
        model_names = {}
        raw_groups = []   # v202 预估费用分组（与 with_models 无关恒产出，轻量行项目格同款）
        for i in range(0, len(all_ids), 500):
            part = all_ids[i:i + 500]
            qm = ",".join("?" * len(part))
            r = con.execute(
                f"""select count(distinct m.session_id),
                           count(distinct m.session_id||'/'||coalesce(m.turn_id,'')), count(*),
                           coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                           coalesce(sum(m.reasoning_tokens),0),
                           coalesce(sum(m.cache_read_input_tokens),0),
                           coalesce(sum(m.cache_creation_input_tokens),0),
                           coalesce(sum(m.computed_total_tokens),0),
                           coalesce(sum(m.tool_call_count),0), coalesce(sum(m.retry_count),0),
                           min(m.started_at), max(m.completed_at),
                           coalesce(sum(m.duration_ms),0),
                           sum(case when m.duration_ms > 0 then m.duration_ms end),
                           sum(case when m.duration_ms > 0 then 1 else 0 end),
                           sum(case when m.time_to_first_token_ms > 0 then m.time_to_first_token_ms end),
                           sum(case when m.time_to_first_token_ms > 0 then 1 else 0 end)
                    from model_usage m where m.status='completed' and m.session_id in ({qm})""",
                part).fetchone()
            sessions += r[0]
            turns += r[1] or 0
            requests += r[2]
            input_t += r[3]
            output_t += r[4]
            reasoning += r[5]
            cache_read += r[6]
            cache_write += r[7]
            total += r[8]
            tool_calls += r[9]
            retries += r[10]
            if r[11] is not None and (started is None or r[11] < started):
                started = r[11]
            if r[12] is not None and (last_at is None or r[12] > last_at):
                last_at = r[12]
            dur_sum += r[13] or 0
            dur_pos_sum += r[14] or 0
            dur_pos_n += r[15] or 0
            ttft_pos_sum += r[16] or 0
            ttft_pos_n += r[17] or 0
            tr = _turn_rate(con.execute(
                f"""select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id, provider_id
                    from model_usage where status='completed' and (query_source is null or query_source='main_turn')
                    and session_id in ({qm})""", part).fetchall(), covers, proj_per_model)
            rated_acc += tr["rated_output"]
            gen_acc += tr["gen_ms"]
            # v202：模型分组查询从 with_models 分支提为恒跑（费用与模型明细同源一条 SQL），
            # 聚合到 (model_id, provider_id)——同模型不同 provider 牌价不同，费用分组计；
            # models_acc 仍只在 with_models 时累积（轻量行项目聚合不带 models，v163 契约不变）
            for mm in con.execute(
                f"""select m.model_id, m.provider_id, count(*),
                           coalesce(sum(m.computed_total_tokens),0),
                           coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                           coalesce(sum(m.cache_read_input_tokens),0),
                           coalesce(sum(m.cache_creation_input_tokens),0)
                    from model_usage m where m.status='completed' and m.session_id in ({qm})
                    group by m.model_id, m.provider_id""", part).fetchall():
                raw_m = mm[0] or ""
                m_key = raw_m.lower()
                model_names[m_key] = _canon_model_name(model_names.get(m_key), raw_m)
                if with_models:
                    acc = models_acc.setdefault(m_key, [0, 0])
                    acc[0] += mm[2]
                    acc[1] += mm[3]
                raw_groups.append((raw_m, mm[1] or "", mm[4], mm[5], mm[6], mm[7]))
        models = [{"model": model_names[k], "requests": v[0], "total": v[1]}
                  for k, v in models_acc.items()]
        _attach_model_tps(models, proj_per_model)
        if _pricing is not None:
            try:
                canon_groups = [(model_names[(m or "").lower()], prov, inp, out, cr, cw)
                                for m, prov, inp, out, cr, cw in raw_groups]
                proj_cost, per_cost = _pricing.merge_model_costs(canon_groups)
                prov_of = {}
                for model, prov, *_ in canon_groups:
                    prov_of.setdefault(model, prov)
                for m in models:
                    m["cost_usd"] = per_cost.get(m["model"], 0.0)
                    m["rates"] = _model_rates(m["model"], prov_of.get(m["model"], "")).get("rates")
            except Exception:
                proj_cost = None   # 费用失败不拖垮项目聚合（可选增强字段口径）
        else:
            proj_cost = None
        models.sort(key=lambda m: -m["total"])
        return {
            "sessions": sessions, "turns": turns, "requests": requests,
            "input": input_t, "output": output_t, "reasoning": reasoning,
            "cache_read": cache_read, "cache_write": cache_write, "total": total,
            "tool_calls": tool_calls, "retries": retries,
            "started": started or 0, "last_at": last_at or 0,
            # v303 可选增强字段：消费端按 >0 门控，旧缓存/失败自然降级不伪造
            "avg_duration_ms": round(dur_pos_sum / dur_pos_n) if dur_pos_n else 0,
            "avg_ttft_ms": round(ttft_pos_sum / ttft_pos_n) if ttft_pos_n else 0,
            "duration_ms": dur_sum,
            "avg_tps": round(rated_acc / (gen_acc / 1000), 1) if gen_acc else 0,
            "name": pname,
            "models": models,
            # None（价表模块缺失）→ JSON null，消费端按缺字段口径隐藏
            "cost_usd": proj_cost,
        }

    dbkey = _db_cache_key(con)
    if dbkey is None:   # 内存库（database_list 的 file 列为空的连接）：不缓存，就地聚合
        return run()
    # 缓存键带 pkey：同 project_id 的碰撞项目（issue #248）各自目录结果不同，不得互串
    return _cached_project(dbkey, (prow[0], pkey, bool(with_models)), run, con)


_ALLPROJ_CACHE_KEY = ("__all_projects__",)   # _PROJ_CACHE 内的全局聚合专属键（project_id 均为宿主 slug，不撞）
_ALLPROJ_MAX_PROJECTS = 500   # 项目明细条目上限（totals 恒为全量真值，超出置 projects_truncated）


def _all_projects_usage(con):
    """全部项目聚合（v331，specs/all-projects-usage.md）：本地统计数据源所有项目的
    completed 请求累计——全局 KPI + 按项目明细 + 按模型全局明细，供项目累计 Tooltip
    「全部项目」Tab。归属单元=会话：派生会话沿 parent_id 链上行取根会话的项目身份
    （环守卫、父缺失按自身）；项目键=(project_id, 归一化目录) 与 _project_usage 的
    issue #248 语义一致（碰撞项目互不混入）；project_id 为空或会话已删的请求单列
    未归属桶（unattributed），保证 totals==Σ projects 对账恒成立。每条请求只经其
    会话参与一次统计，主会话/子代理不重复计入。缓存复用 _cached_project（水位/2s TTL
    同款，实测 2.6GB 库 ~210ms/次、载荷 ~6KB，仅水位变化帧重算）；任何列漂移抛
    sqlite3.Error 由调用方按可选增强降级省略。"""
    def run():
        sess = {}
        for r in con.execute("select id, project_id, directory, parent_id from session"):
            sess[r[0]] = (r[1] or "", r[2] or "", r[3])
        proj_of = {}   # sid -> (key, name, directory, unattributed)
        meta = {}      # key -> (name, directory, unattributed)（同键多会话同值，setdefault 幂等）
        for sid, (pid, pdir, _parent) in sess.items():
            cur, seen = sid, set()
            while True:   # 派生会话沿 parent 链上行取根。环守卫只保证终止（宿主数据损坏
                # 防御）：环上各起点的"根"互不相同，归属可能错位但不死循环、账本仍恒成立
                nxt = sess[cur][2]
                if not nxt or nxt in seen or nxt not in sess:
                    break
                seen.add(cur)
                cur = nxt
            rpid, rdir = sess[cur][0], sess[cur][1]
            if not rpid:
                # project_id 为空（含带目录的）：目录不足以安全归属（宿主正常会话恒有
                # project_id，缺失即数据残缺）——全部并入单一未归属桶，不按目录拆多桶
                proj_of[sid] = (("", ""), "", "", True)
                meta.setdefault(("", ""), ("", "", True))
                continue
            rdir_n = rdir.replace("\\", "/").rstrip("/")
            name = rdir_n.rsplit("/", 1)[-1] if rdir_n else ""
            proj_of[sid] = ((rpid, _norm_path_key(rdir_n)), name, rdir_n, False)
            meta.setdefault((rpid, _norm_path_key(rdir_n)), (name, rdir_n, False))

        def key_of(sid):
            hit = proj_of.get(sid)
            # 会话表缺失（session 已删）的请求：未归属桶，不丢也不并入任何项目
            return hit if hit is not None else (("", ""), "", "", True)

        agg = {}      # key -> [sessions,turns,requests,input,output,reasoning,cache_read,
                      #          cache_write,total,tool_calls,retries,dur_sum,dur_pos,dur_n,
                      #          ttft_pos,ttft_n,started,last_at]
        groups = {}   # key -> {(model_lower, provider): [input, output, cache_read, cache_write]}
        mnames = {}   # key -> {model_lower: 规范展示名}
        for r in con.execute(
            """select session_id, count(*), count(distinct coalesce(turn_id,'')),
                      coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                      coalesce(sum(reasoning_tokens),0),
                      coalesce(sum(cache_read_input_tokens),0),
                      coalesce(sum(cache_creation_input_tokens),0),
                      coalesce(sum(computed_total_tokens),0),
                      coalesce(sum(tool_call_count),0), coalesce(sum(retry_count),0),
                      coalesce(sum(duration_ms),0),
                      sum(case when duration_ms > 0 then duration_ms end),
                      sum(case when duration_ms > 0 then 1 else 0 end),
                      sum(case when time_to_first_token_ms > 0 then time_to_first_token_ms end),
                      sum(case when time_to_first_token_ms > 0 then 1 else 0 end),
                      min(started_at), max(completed_at)
               from model_usage where status='completed' group by session_id"""):
            a = agg.setdefault(key_of(r[0])[0], [0] * 16 + [None, None])
            a[0] += 1
            a[1] += r[2] or 0
            a[2] += r[1]
            for i in range(3, 16):
                a[i] += r[i] or 0
            if r[16] is not None and (a[16] is None or r[16] < a[16]):
                a[16] = r[16]
            if r[17] is not None and (a[17] is None or r[17] > a[17]):
                a[17] = r[17]
        # 模型分组（会话粒度取回后按项目分桶）：计价需 (model, provider) × 项目拆分；
        # 全局模型明细与各项目费用同源这条 SQL，不再回表。全局聚合器独立累积——
        # groups/mnames 按项目分桶，未归属桶只是其中一个 key，不能当全局读。
        gnames = {}
        ggroups = {}
        greq = {}
        gtot = {}
        for r in con.execute(
            """select session_id, model_id, provider_id, count(*),
                      coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                      coalesce(sum(cache_read_input_tokens),0),
                      coalesce(sum(cache_creation_input_tokens),0),
                      coalesce(sum(computed_total_tokens),0)
               from model_usage where status='completed'
               group by session_id, model_id, provider_id"""):
            key = key_of(r[0])[0]
            raw_m = r[1] or ""
            m_key = raw_m.lower()
            names = mnames.setdefault(key, {})
            names[m_key] = _canon_model_name(names.get(m_key), raw_m)
            gacc = groups.setdefault(key, {}).setdefault((m_key, r[2] or ""), [0, 0, 0, 0])
            gacc[0] += r[4]
            gacc[1] += r[5]
            gacc[2] += r[6]
            gacc[3] += r[7]
            gnames[m_key] = _canon_model_name(gnames.get(m_key), raw_m)
            gacc_g = ggroups.setdefault((m_key, r[2] or ""), [0, 0, 0, 0])
            for i in range(4):
                gacc_g[i] += r[4 + i]
            greq[m_key] = greq.get(m_key, 0) + r[3]
            gtot[m_key] = gtot.get(m_key, 0) + r[8]
        # 平均输出速度（全局）：Σ有效输出 ÷ Σ有效生成窗口，_project_usage 同源口径
        covers = _provider_first_token_covers(con)
        rate_rows = con.execute(
            """select output_tokens, first_token_at, completed_at, started_at,
                      reasoning_tokens, model_id, provider_id
               from model_usage where status='completed'
                 and (query_source is null or query_source='main_turn')""").fetchall()
        ap_per_model = {}   # v375 逐模型速度（全部项目，main_turn 同口径）
        tr = _turn_rate(rate_rows, covers, ap_per_model)

        def canon_groups(gg, names):
            return [(names[ml], prov, v[0], v[1], v[2], v[3]) for (ml, prov), v in gg.items()]

        def cost_of(key):
            """按 (model, provider) 分组计价；价表缺失/失败返回 None（消费端按缺失降级）"""
            if _pricing is None or not groups.get(key):
                return None
            try:
                return _pricing.merge_model_costs(canon_groups(groups[key], mnames.get(key, {})))[0]
            except Exception:
                return None

        gmodels = [{"model": gnames[ml], "requests": greq[ml], "total": gtot[ml]} for ml in gnames]
        _attach_model_tps(gmodels, ap_per_model)
        g_cost = None
        if _pricing is not None and ggroups:
            try:
                g_cost, per_cost = _pricing.merge_model_costs(canon_groups(ggroups, gnames))
                prov_of = {}
                for model_name, prov, *_ in canon_groups(ggroups, gnames):
                    prov_of.setdefault(model_name, prov)
                for m1 in gmodels:
                    m1["cost_usd"] = per_cost.get(m1["model"], 0.0)
                    m1["rates"] = _model_rates(m1["model"], prov_of.get(m1["model"], "")).get("rates")
            except Exception:
                g_cost = None   # 计价失败不拖垮明细（cost 字段缺失，消费端显 —，不冒充 0）
        gmodels.sort(key=lambda m1: -m1["total"])

        projects = []
        for key, a in agg.items():
            name, directory, unattr = meta.get(key, ("", "", True))
            projects.append({
                "name": name, "directory": directory, "total": a[8], "requests": a[2],
                "cost_usd": cost_of(key),
                **({"unattributed": True} if unattr else {}),
            })
        projects.sort(key=lambda p: (-p["total"], p["name"], p["directory"]))
        truncated = len(projects) > _ALLPROJ_MAX_PROJECTS

        sessions = turns = requests = total = 0
        input_t = output_t = reasoning = cache_read = cache_write = 0
        tool_calls = retries = dur_sum = dur_pos = dur_n = ttft_pos = ttft_n = 0
        started = last_at = None
        for a in agg.values():
            sessions += a[0]
            turns += a[1]
            requests += a[2]
            input_t += a[3]
            output_t += a[4]
            reasoning += a[5]
            cache_read += a[6]
            cache_write += a[7]
            total += a[8]
            tool_calls += a[9]
            retries += a[10]
            dur_sum += a[11]
            dur_pos += a[12]
            dur_n += a[13]
            ttft_pos += a[14]
            ttft_n += a[15]
            if a[16] is not None and (started is None or a[16] < started):
                started = a[16]
            if a[17] is not None and (last_at is None or a[17] > last_at):
                last_at = a[17]
        out = {
            "sessions": sessions, "turns": turns, "requests": requests,
            "input": input_t, "output": output_t, "reasoning": reasoning,
            "cache_read": cache_read, "cache_write": cache_write, "total": total,
            "tool_calls": tool_calls, "retries": retries,
            "started": started or 0, "last_at": last_at or 0,
            "avg_duration_ms": round(dur_pos / dur_n) if dur_n else 0,
            "avg_ttft_ms": round(ttft_pos / ttft_n) if ttft_n else 0,
            "duration_ms": dur_sum,
            "avg_tps": round(tr["rated_output"] / (tr["gen_ms"] / 1000), 1) if tr["gen_ms"] else 0,
            "models": gmodels,
            "cost_usd": g_cost,
            "projects": projects[:_ALLPROJ_MAX_PROJECTS],
        }
        if truncated:
            out["projects_truncated"] = True
            out["projects_total"] = len(projects)   # 截断前的真实项目数（明细表提示用）
        return out

    dbkey = _db_cache_key(con)
    if dbkey is None:   # 内存库（测试夹具）：不缓存，就地聚合
        return run()
    return _cached_project(dbkey, _ALLPROJ_CACHE_KEY, run, con)


def _all_projects_usage_safe(con):
    """可选增强字段统一入口：查询失败/旧库缺列/无本地连接返回 None（渲染端判空显
    「暂不可用」），不拖垮整帧快照；捕获面与 _speed_history_safe 同款（含 TypeError 等
    数据形状异常）。失败只损失本帧该字段，水位缓存未命中下一帧自然重试。"""
    if con is None:
        return None
    try:
        return _all_projects_usage(con)
    except (sqlite3.Error, TypeError, ValueError, KeyError, IndexError, OverflowError, AttributeError):
        return None


def range_usage(con, start_ms, end_ms):
    # 末尾三列（reasoning/retry/cache_write）是 v30/v31 追加，CLI 老代码按索引 0-4 取值不受影响
    return con.execute(
        """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(cache_read_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(duration_ms),0), coalesce(sum(reasoning_tokens),0),
                  coalesce(sum(retry_count),0), coalesce(sum(cache_creation_input_tokens),0)
           from model_usage where status='completed' and completed_at between ? and ?""",
        (start_ms, end_ms),
    ).fetchone()


def _today_usage(con, start_ms, end_ms):
    # v298.1：补 count(distinct turn_id)（今日轮数，条面今日格「N 轮 · M 次」展示）
    # v301：补今日级平均耗时/平均首字延迟两列（>0 样本过滤，同 v211 本轮 / v300 会话口径；
    # review 修复起两列过滤 main_turn——与 _today_rate 的 avg_tps 同口径，子代理/辅助行
    # 稀释均值会让同卡「平均耗时」与「平均输出速度」不可比）；
    # v302.2：补今日发起过请求的去重会话数与 Σ工具调用数（今日合计 tooltip
    # 行二「请求会话」与模型明细标题行右侧「工具调用 N 次」，同本轮/会话形态）。
    # 旧远端元组按长度守卫降级。
    return con.execute(
        """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(cache_read_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(duration_ms),0), coalesce(sum(reasoning_tokens),0),
                  coalesce(sum(retry_count),0), coalesce(sum(cache_creation_input_tokens),0),
                  min(started_at), max(completed_at),
                  count(distinct turn_id),
                  avg(case when duration_ms > 0 and (query_source is null or query_source='main_turn') then duration_ms end),
                  avg(case when time_to_first_token_ms > 0 and (query_source is null or query_source='main_turn') then time_to_first_token_ms end),
                  count(distinct session_id),
                  coalesce(sum(tool_call_count),0)
           from model_usage where status='completed' and completed_at between ? and ?""",
        (start_ms, end_ms),
    ).fetchone()


def daily_usage(con, days):
    """近 N 天（含今天），按本地日聚合。返回 [(date, row), ...] 旧→新。"""
    out = []
    for i in range(days - 1, -1, -1):
        d0 = _day_start(datetime.now() - timedelta(days=i))
        r = range_usage(con, _epoch_ms(d0), _epoch_ms(d0 + timedelta(days=1)))
        out.append((d0.strftime("%m-%d %a"), r))
    return out


def recent_sessions(con, limit=10):
    return con.execute(
        """select s.id, coalesce(s.title,'(无标题)'), coalesce(s.directory,''),
                  count(m.id), coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                  coalesce(sum(m.computed_total_tokens),0), max(m.completed_at)
           from model_usage m left join session s on s.id = m.session_id
           where m.status='completed'
           group by m.session_id order by max(m.completed_at) desc limit ?""",
        (limit,),
    ).fetchall()


def model_usage(con, days=7):
    since = _epoch_ms(datetime.now() - timedelta(days=days))
    return con.execute(
        """select provider_id, model_id, count(*), coalesce(sum(input_tokens),0),
                  coalesce(sum(output_tokens),0), coalesce(sum(computed_total_tokens),0)
           from model_usage where status='completed' and completed_at >= ?
           group by provider_id, model_id order by sum(computed_total_tokens) desc""",
        (since,),
    ).fetchall()


# ---------- 展示 ----------

def render_current(con):
    """当前会话 = _scan_session_ids 最近活跃的会话（普通子代理会话也在候选内；
    工作流 actor 会话 sess_dwf-* 除外——run 进行中多个 actor 轮流活跃且标题是
    run 视角，成为「当前会话」属误报，specs/workflow-support.md）。"""
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_current(con)
    rows = [r for r in _scan_session_ids(con) if not _is_sub_kind_workflow(r[0])]
    sess, last_at = None, 0
    if rows:
        sid, last_at = max(rows, key=lambda r: r[1])
        sess = con.execute("select * from session where id=?", (sid,)).fetchone()
    lines = []
    if sess is not None:
        u = session_usage(con, sess["id"])
        active = last_at and (int(time.time() * 1000) - last_at) < SESSION_TIMEOUT_MS
        mark = L("🟢 活跃", "🟢 active") if active else L("⚪ 闲置", "⚪ idle")
        lines.append(L(f"■ 当前会话 [{mark}]  ", f"■ Current session [{mark}]  ") + (sess["title"] or ""))
        if sess["directory"]:
            lines.append(L(f"  目录: {sess['directory']}", f"  dir: {sess['directory']}"))
        lines.append(
            L(f"  {u['turns']} 轮 / {u['requests']} 次请求 / {u['tool_calls']} 次工具调用",
              f"  {u['turns']} turns / {u['requests']} requests / {u['tool_calls']} tool calls")
        )
        lines.append(
            L(f"  input {fmt(u['input'])} (其中 cache read {fmt(u['cache_read'])})  "
              f"output {fmt(u['output'])}  合计 {fmt(u['total'])}",
              f"  input {fmt(u['input'])} (incl. cache read {fmt(u['cache_read'])})  "
              f"output {fmt(u['output'])}  total {fmt(u['total'])}")
        )
        lines.append(L(f"  上下文容量 ≈ {fmt(u['last_request_input'])} tokens (最近一次请求输入)",
                       f"  context capacity ≈ {fmt(u['last_request_input'])} tokens (latest request input)"))
        if last_at:
            la = _ts(last_at)
            lines.append(L(f"  最后活动: {la:%H:%M:%S}",
                           f"  last activity: {la:%H:%M:%S}"))
        lines.append("")
    today = range_usage(con, _epoch_ms(_day_start()), _epoch_ms(_day_start() + timedelta(days=1)))
    lines.append(L(f"■ 今日 ({datetime.now():%Y-%m-%d %a})", f"■ Today ({datetime.now():%Y-%m-%d %a})"))
    lines.append(
        L(f"  {today[0]} 次请求  input {fmt(today[1])} (cache read {fmt(today[3])})  "
          f"output {fmt(today[2])}  合计 {fmt(today[4])}",
          f"  {today[0]} requests  input {fmt(today[1])} (cache read {fmt(today[3])})  "
          f"output {fmt(today[2])}  total {fmt(today[4])}")
    )
    return "\n".join(lines)


def render_days(con, days):
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_days(con, days)
    lines = [L(f"■ 近 {days} 天每日用量 (合计=input+output)", f"■ Last {days} days (total=input+output)")]
    for label, r in daily_usage(con, days):
        bar = "█" * max(0, min(30, int(r[4] / 200_000)))
        lines.append(
            L(f"  {label}  {r[0]:>4} 次  in {fmt(r[1]):>8}  out {fmt(r[2]):>7}  合计 {fmt(r[4]):>8}  {bar}",
              f"  {label}  {r[0]:>4} req  in {fmt(r[1]):>8}  out {fmt(r[2]):>7}  total {fmt(r[4]):>8}  {bar}")
        )
    return "\n".join(lines)


def render_sessions(con, limit=10):
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_sessions(con, limit)
    lines = [L(f"■ 最近 {limit} 个会话", f"■ Last {limit} sessions")]
    for sid, title, d, n, inp, outp, total, last in recent_sessions(con, limit):
        t = _ts(last)
        if _LANG == "en" and title == "(无标题)":
            title = "(untitled)"
        dname = d.replace("\\", "/").rsplit("/", 1)[-1] if d else "?"
        lines.append(
            L(f"  {t:%m-%d %H:%M}  {fmt(total):>8}  ({fmt(inp)} in / {fmt(outp)} out, {n} 请求)  ",
              f"  {t:%m-%d %H:%M}  {fmt(total):>8}  ({fmt(inp)} in / {fmt(outp)} out, {n} requests)  ")
            + f"[{dname}]  {title[:32]}  [{sid[:13]}]"
        )
    return "\n".join(lines)


def render_models(con, days=7):
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_models(con, days)
    lines = [L(f"■ 近 {days} 天按模型", f"■ Last {days} days by model")]
    for prov, model, n, inp, outp, total in model_usage(con, days):
        lines.append(
            L(f"  {model:<22} {n:>5} 次  in {fmt(inp):>8}  out {fmt(outp):>7}  合计 {fmt(total):>8}  ({prov})",
              f"  {model:<22} {n:>5} req  in {fmt(inp):>8}  out {fmt(outp):>7}  total {fmt(total):>8}  ({prov})")
        )
    return "\n".join(lines)


# ---------- 工作区报表 ----------
# 口径：主会话 = directory 命中且无父且非 sess_subagent 前缀；子代理按 parent_id 归并去重。
# 子代理会话（sess_subagent_*）的 directory 字段也等于工作区目录，直接按 directory 聚合会把
# 主/子重复计数，必须走 parent_id 归并。报表单连接一次算齐——库实时写入，分次查询之间对不上账。
# 会话迁移过工作区时历史用量全部记在当前目录名下（model_usage 无工作区维度）。

_SUB_PREFIX_LEN = 13   # len("sess_subagent")
# 工作流子代理会话（宿主动态工作流 dwfrun-* 派生，task_type='workflow_child'，
# 规格见 specs/workflow-support.md）：与 sess_subagent 同属子代理类——不进主会话池、
# is_sub=true；runId 段可直接前缀匹配（dwfrun-<uuid> 无 `_`，宿主 sanitize 折叠恒等）。
_WF_PREFIX = "sess_dwf-"


def _is_sub_sid(sid):
    """子代理类会话判定：普通子代理（sess_subagent_*）+ 工作流 actor（sess_dwf-*）。"""
    s = str(sid)
    return s.startswith("sess_subagent") or s.startswith(_WF_PREFIX)


def _sub_kind_of(sid):
    """子代理类细分（快照行 sub_kind 字段）：agent=普通子代理 / workflow=工作流 actor / 空串。"""
    s = str(sid)
    if s.startswith("sess_subagent"):
        return "agent"
    if s.startswith(_WF_PREFIX):
        return "workflow"
    return ""


def _is_sub_kind_workflow(sid):
    """仅工作流 actor 会话判定：普通子代理（sess_subagent_*）保持既有候选语义，
    sess_dwf-* 从 latest/current 候选排除（run 进行中多个 actor 轮流活跃且标题是
    run 视角，成为「当前会话」属误报）。"""
    return str(sid).startswith(_WF_PREFIX)


def _usage_rows(con, sids):
    """一批会话的 completed 用量（口径与 session_usage 一致），返回 session_id → row。"""
    qm = ",".join("?" * len(sids))
    per = {}
    for r in con.execute(
        f"""select session_id, count(*) n,
                   coalesce(sum(input_tokens),0) inp, coalesce(sum(output_tokens),0) outp,
                   coalesce(sum(reasoning_tokens),0) reas,
                   coalesce(sum(cache_read_input_tokens),0) crd,
                   coalesce(sum(computed_total_tokens),0) tot,
                   min(completed_at) first_at, max(completed_at) last_at
            from model_usage where status='completed' and session_id in ({qm})
            group by session_id""", sids):
        per[r["session_id"]] = r
    return per


def _match_workspaces(con, pattern):
    """工作区目录匹配：子串（SQLite LIKE 对 ASCII 大小写不敏感）或单词首字母缩写
    （abc → **A**pple **B**anana **C**herry）。用户对工作区的称呼常是缩写而非子串。
    返回 [(directory, 会话数)]，按会话数降序。"""
    pat = pattern.lower()
    out = []
    for d, n in con.execute(
            "select directory, count(*) n from session group by directory order by n desc"):
        if pat in d.lower():
            out.append((d, n))
            continue
        initials = "".join(w[0] for w in re.split(r"[^A-Za-z0-9]+", d) if w).lower()
        if len(pat) >= 2 and pat in initials:
            out.append((d, n))
    return out


def render_workspace(con, pattern, top=15):
    """workspace:<目录关键词>：按工作区聚合主会话+子代理，含按会话与按模型两张明细。"""
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_workspace(con, pattern, top)
    pattern = (pattern or "").strip()
    dirs = _match_workspaces(con, pattern) if pattern else []
    if not dirs:
        lines = [L(f"未找到目录含 {pattern!r} 的工作区。现有工作区（按会话数前 10）：",
                   f"No workspace with directory matching {pattern!r}. Existing workspaces (top 10 by sessions):")]
        for d, n in con.execute(
                "select directory, count(*) n from session group by directory order by n desc limit 10"):
            lines.append(f"  {n:>4}  {d}")
        return "\n".join(lines)

    dir_names = [d for d, _ in dirs]
    qd = ",".join("?" * len(dir_names))
    mains = con.execute(
        f"""select id, title, time_created from session
           where directory in ({qd}) and parent_id is null and substr(id,1,{_SUB_PREFIX_LEN})!='sess_subagent'
           order by time_created""", dir_names).fetchall()
    main_ids = [r["id"] for r in mains]
    subs = []
    if main_ids:
        qm = ",".join("?" * len(main_ids))
        subs = con.execute(
            f"select id, title, parent_id from session where parent_id in ({qm})", main_ids).fetchall()
    all_ids = list(dict.fromkeys(main_ids + [r["id"] for r in subs]))
    per = _usage_rows(con, all_ids) if all_ids else {}
    qm = ",".join("?" * len(all_ids))
    models = con.execute(
        f"""select model_id, count(*) n,
                   coalesce(sum(input_tokens),0) inp, coalesce(sum(output_tokens),0) outp,
                   coalesce(sum(computed_total_tokens),0) tot
            from model_usage where status='completed' and session_id in ({qm})
            group by model_id order by tot desc""", all_ids).fetchall() if all_ids else []

    def agg(ids):
        rows = [per[i] for i in ids if i in per]
        return {k: sum(r[k] for r in rows)
                for k in ("n", "inp", "outp", "reas", "crd", "tot")}

    sub_of = {}
    for s in subs:
        sub_of.setdefault(s["parent_id"], []).append(s["id"])
    sub_ids = [i for ids in sub_of.values() for i in ids]
    tm, ts, ta = agg(main_ids), agg(sub_ids), agg(all_ids)

    if len(dirs) == 1:
        lines = [L(f"■ 工作区 {dirs[0][0]}", f"■ Workspace {dirs[0][0]}")]
    else:
        lines = [L(f"■ 工作区（匹配 {pattern!r}，命中 {len(dirs)} 个）",
                   f"■ Workspaces matching {pattern!r} ({len(dirs)} dirs)")]
        for d, n in dirs[:5]:
            lines.append(f"  {n:>4}  {d}")
    if not per:
        lines.append(L("该工作区暂无 completed 请求。", "No completed requests in this workspace yet."))
        return "\n".join(lines)
    firsts = [r["first_at"] for r in per.values() if r["first_at"]]
    lasts = [r["last_at"] for r in per.values() if r["last_at"]]
    lines.append(L(
        f"主会话 {len(main_ids)} 个（其中无请求 {len(main_ids) - len([i for i in main_ids if i in per])} 个）"
        f" + 子代理 {len(subs)} 个 ｜ "
        f"{_ts(min(firsts)):%m-%d %H:%M} ~ {_ts(max(lasts)):%m-%d %H:%M}",
        f"{len(main_ids)} main sessions ({len(main_ids) - len([i for i in main_ids if i in per])} without requests)"
        f" + {len(subs)} subagents ｜ {_ts(min(firsts)):%m-%d %H:%M} ~ {_ts(max(lasts)):%m-%d %H:%M}"))
    lines.append(L(
        f"请求 {ta['n']:,}（主 {tm['n']:,} / 子 {ts['n']:,}）  "
        f"input {ta['inp']:,}（缓存读 {ta['crd']:,}）  "
        f"output {ta['outp']:,}（含 reasoning {ta['reas']:,}）",
        f"{ta['n']:,} requests (main {tm['n']:,} / sub {ts['n']:,})  "
        f"input {ta['inp']:,} (cache-read {ta['crd']:,})  "
        f"output {ta['outp']:,} (incl. reasoning {ta['reas']:,})"))
    lines.append(L(
        f"合计（=input+output，缓存读已含在 input 内） {ta['tot']:,}",
        f"Total (=input+output; cache-read already inside input) {ta['tot']:,}"))

    ranked = []
    for m in mains:
        if m["id"] in per:
            su = agg(sub_of.get(m["id"], []))
            ranked.append((m, per[m["id"]], su))
    ranked.sort(key=lambda x: -(x[1]["tot"] + x[2]["tot"]))
    lines.append(L(f"■ 按会话（含其子代理，按含子合计降序，前 {top}）",
                   f"■ By session (incl. subagents, top {top} by combined total)"))
    for m, u, su in ranked[:top]:
        nsub = len(sub_of.get(m["id"], []))
        subtxt = (L(f" +子{nsub}个 {su['tot']:,}", f" +{nsub} sub {su['tot']:,}") if nsub else "")
        t = (m["title"] or L("(无标题)", "(untitled)")).replace("\n", " ")
        lines.append(
            f"  {_ts(u['last_at']):%m-%d %H:%M}  {u['n']:,}req  in {u['inp']:,}  out {u['outp']:,}  "
            f"{L('合计', 'total')} {u['tot']:,}{subtxt}  {t[:26]}")
    if len(ranked) > top:
        rest = agg([m["id"] for m, _, _ in ranked[top:]])
        lines.append(L(f"  （另有 {len(ranked) - top} 个会话 合计 {rest['tot']:,}）",
                       f"  (…plus {len(ranked) - top} sessions totalling {rest['tot']:,})"))

    lines.append(L("■ 按模型", "■ By model"))
    for r in models:
        lines.append(
            f"  {r['model_id']:<24} {r['n']:,}req  in {r['inp']:,}  out {r['outp']:,}  "
            f"{L('合计', 'total')} {r['tot']:,}")
    return "\n".join(lines)


# ---------- 机器可读快照（悬浮条数据源） ----------


def _prompt_matches(title, prompt):
    """子会话 title 是否为 Agent part prompt 的截断头（ZCode 规则：prompt 前 57 字符 + "..."）。"""
    t = (title or "").strip()
    if not t or not prompt:
        return False
    if t.endswith("..."):
        base = t[:-3]
        return len(base) >= 15 and prompt.startswith(base)
    return prompt.startswith(t)


# 任务名解析缓存（serve 常驻进程内）：like 扫描父会话全部 part 的 data（本会话可达
# 2456 行大 JSON，实测 29ms/次，泵 1.5s 拉一次全付）。失效键 = 父会话 part 的
# 行数+最新 time_updated（索引聚合，<1ms）；普通消息 part 新增也会失效，宁多算不漏算。
_TASK_CACHE = {}
_TASK_AT = {}                  # sid → 上次实际扫描时刻（规则 15 的最小重扫间隔判定）
_TASK_RESCAN_MS = 3000         # 快照热路径最小重扫间隔：任务名最长陈旧 3s


def _sub_item(con, r, sub_tasks, sub_gen, sub_timing=None, sid_model_gen=None):
    """sub.list 单项（v217 统一浮层任务页）：基础聚合 + 可选每任务模型明细/费用。
    模型明细按子会话 id 分组查询（与 _session_models_cost 同构口径）；价表缺失
    或分组为空时字段省略，消费端按缺省处理不造零值。
    sid_model_gen（(子会话 sid, 小写模型) → [rated_output, gen_ms]）可选：挂 avg_tps 供模型明细平均速度列。"""
    t = sub_timing.get(r[0]) or [0, 0, 0, 0, 0, set()]
    item = {"sid": r[0], "agent": r[1], "title": r[2], "task": sub_tasks.get(r[0], ""),
            "requests": r[3], "total": r[4],
            "input": r[5], "output": r[6], "cache_read": r[7], "reasoning": r[8],
            "cache_write": r[9], "last": (r[10] or 0), "started": (r[12] or 0),
            "tps_avg": _rated_tps(*sub_gen.get(r[0], [0, 0])),
            # 工作流支持（specs/workflow-support.md）：速率聚合分量原样下发，渲染端对
            # run 内多 actor 求 Σout ÷ Σgen 加权（不能对各 tps_avg 平均）；旧快照缺字段
            # 消费端按缺失降级为不显速率。
            "tps_out": sub_gen.get(r[0], [0, 0])[0],
            "tps_gen": sub_gen.get(r[0], [0, 0])[1],
            # v304 单任务耗时/轮数（该子会话真实聚合，>0 门控降级同上）
            "avg_duration_ms": round(t[1] / t[2]) if t[2] else 0,
            "avg_ttft_ms": round(t[3] / t[4]) if t[4] else 0,
            "duration_ms": t[0],
            "turns": len(t[5]),
            "active": bool(r[10] and int(time.time() * 1000) - r[10] < 30000)}
    item_model_gen = ({k[1]: v for k, v in sid_model_gen.items() if k[0] == r[0]}
                      if sid_model_gen else None)
    m1, c1 = _scope_models_cost(con, "session_id=?", (r[0],), item_model_gen)
    if c1 is not None:
        item["cost_usd"] = c1
    if m1:
        item["models"] = m1
    return item


def _sub_agent_tasks(con, sid):
    stamp = con.execute(
        "select count(*), coalesce(max(time_updated),0) from part where session_id=?", (sid,)
    ).fetchone()
    # dwf_actor 新增/改名不动 part：工作流运行中动态创建 actor 且其 ask 完成落库时，
    # 父会话可能无新 part 行——失效键补 dwf_actor 维度（greatest 覆盖纯改名只动
    # time_updated 的形态），旧库无表按 0（同款 fail-closed）。
    try:
        astamp = con.execute(
            """select coalesce(max(max(a.time_created, coalesce(a.time_updated,0))),0)
               from dwf_actor a join session s2 on a.session_id = s2.id where s2.parent_id=?""",
            (sid,)).fetchone()[0]
    except sqlite3.Error:
        astamp = 0
    key = (stamp[0], stamp[1], astamp)
    hit = _TASK_CACHE.get(sid)
    if hit and hit[0] == key:
        return hit[1]
    sub_rows_titles = {r[0]: r[1] for r in con.execute(
        "select id, title from session where parent_id=?", (sid,))}
    agent_parts = []
    for prow in con.execute(
        """select data, time_created from part
           where session_id=? and data like '%"tool":"Agent"%' order by time_created""",
        (sid,),
    ):
        try:
            o = json.loads(prow[0])
            st = o.get("state") or {}
            inp = st.get("input") or {}
            desc = str(inp.get("description") or "").strip()
            if desc:
                agent_parts.append((desc, str(inp.get("prompt") or "").strip(),
                                    str(st.get("output") or "")))
        except Exception:
            continue   # part.data 解析失败跳过该条，不影响其余
    tasks = {}
    for desc, _prompt, out in agent_parts:
        m = re.search(r"(?:^|\n)agentId:\s*([^\s(]+)", out)
        if m:
            tasks["sess_subagent_" + m.group(1)] = desc
    used = set(tasks)
    for desc, prompt, out in agent_parts:
        if re.search(r"(?:^|\n)agentId:\s*([^\s(]+)", out):
            continue   # 已走回执关联
        cands = [s for s, t in sub_rows_titles.items()
                 if s not in used and _prompt_matches(t, prompt)]
        if len(cands) == 1:
            tasks[cands[0]] = desc
            used.add(cands[0])
    # 工作流 actor 显示名（specs/workflow-support.md）：dwf_actor.name 是 agent() 创建时的
    # 用户可见名，session_id 直连子会话。dwf_* 表随 3.18+ 宿主建，旧库/WorkBuddy 无表时
    # sqlite3.Error fail-closed 跳过；键前缀与 sess_subagent_ 不相交，不会覆盖回执映射。
    try:
        for ar in con.execute(
            """select a.session_id, a.name from dwf_actor a
               join session s2 on a.session_id = s2.id where s2.parent_id=?""", (sid,)):
            if ar[0] and ar[1]:
                tasks[ar[0]] = str(ar[1])
    except sqlite3.Error:
        pass
    if len(_TASK_CACHE) > 32:   # 防长驻膨胀：会话数有限，正常到不了；超了整表清掉
        _TASK_CACHE.clear()
        _TASK_AT.clear()
    _TASK_CACHE[sid] = (key, tasks)
    _TASK_AT[sid] = int(time.time() * 1000)
    return tasks


def _sub_agent_tasks_hot(con, sid):
    """快照热路径包装（specs/perf-lag-reduction.md 规则 15）：part 在流式期间持续新增，
    _sub_agent_tasks 的失效键每帧失配，正文 LIKE 扫描随帧重复。距上次计算不足
    _TASK_RESCAN_MS 时直接复用上次结果（任务名最长陈旧 3s）；无缓存时才走精确路径。
    CLI 文本报表仍用 _sub_agent_tasks，不受此节流影响。"""
    hit = _TASK_CACHE.get(sid)
    at = _TASK_AT.get(sid)
    if hit is not None and at is not None and int(time.time() * 1000) - at < _TASK_RESCAN_MS:
        return hit[1]
    return _sub_agent_tasks(con, sid)


def render_session_detail(con, prefix):
    """session:<id前缀>：会话总量 + 按模型 + 子代理明细（任务名与状态条"子智能体目录"同源）。"""
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_session_detail(con, prefix)
    prefix = (prefix or "").strip()
    if not prefix:
        return L("session 需要一个非空 id 前缀（session:<前缀>）",
                 "session requires a non-empty id prefix (session:<prefix>)")
    # 真实会话 id 形如 session_<hex>，含 LIKE 通配符 _/%；不转义会把 session_ab 前缀
    # 匹配到任意第三字符，且无 ORDER BY 时 rows[0] 可能选错会话。
    esc_prefix = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = esc_prefix + "%"
    rows = con.execute("select id from session where id like ? escape '\\'", (pattern,)).fetchall()
    if not rows:
        rows = con.execute(
            "select distinct session_id from model_usage where session_id like ? escape '\\'",
            (pattern,)).fetchall()
    if not rows:
        return L(f"未找到 id 前缀为 {prefix!r} 的会话",
                 f"No session found with id prefix {prefix!r}")
    sid = rows[0][0]
    sess = con.execute("select * from session where id=?", (sid,)).fetchone()
    u = session_usage(con, sid)
    head = L(f"■ 会话 {sid}", f"■ Session {sid}")
    if sess is not None:
        head += f"  {sess['title']}"
        if sess["directory"]:
            head += L(f"\n  目录: {sess['directory']}", f"\n  dir: {sess['directory']}")
    body = L(
        f"  {u['turns']} 轮 / {u['requests']} 次请求\n"
        f"  input {fmt(u['input'])} (其中 cache read {fmt(u['cache_read'])})  "
        f"output {fmt(u['output'])}  合计 {fmt(u['total'])}（合计=input+output，缓存读已含在 input 内）\n"
        f"  上下文容量 ≈ {fmt(u['last_request_input'])} tokens",
        f"  {u['turns']} turns / {u['requests']} requests\n"
        f"  input {fmt(u['input'])} (incl. cache read {fmt(u['cache_read'])})  "
        f"output {fmt(u['output'])}  total {fmt(u['total'])} (total=input+output; cache-read already inside input)\n"
        f"  context capacity ≈ {fmt(u['last_request_input'])} tokens")
    lines = [head, body]
    last = con.execute(
        "select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()[0]
    if last:
        lines.append(L(f"  最后活动: {_ts(last):%m-%d %H:%M}",
                       f"  last activity: {_ts(last):%m-%d %H:%M}"))
    mrows = con.execute(
        """select model_id, count(*) n, coalesce(sum(input_tokens),0),
                  coalesce(sum(output_tokens),0), coalesce(sum(computed_total_tokens),0)
           from model_usage where session_id=? and status='completed'
           group by model_id order by sum(computed_total_tokens) desc limit 6""",
        (sid,)).fetchall()
    if mrows:
        lines.append(L("  按模型:", "  By model:"))
        for r in mrows:
            lines.append(
                f"    {r['model_id']:<24} {r['n']:,}req  in {fmt(r[2])}  out {fmt(r[3])}  "
                f"{L('合计', 'total')} {fmt(r[4])}")
    sub_rows = con.execute(
        """select m.session_id, coalesce(s2.title,''), count(*),
                  coalesce(sum(m.computed_total_tokens),0), max(m.completed_at)
           from model_usage m join session s2 on m.session_id = s2.id
           where m.query_source in ('subagent','workflow_child') and s2.parent_id=? and m.status='completed'
           group by m.session_id order by max(m.completed_at) desc""", (sid,)).fetchall()
    if sub_rows:
        tasks = _sub_agent_tasks(con, sid)
        lines.append(L(
            f"  子代理: {len(sub_rows)} 个 / {sum(r[2] for r in sub_rows):,}req / "
            f"合计 {sum(r[3] for r in sub_rows):,}",
            f"  Subagents: {len(sub_rows)} / {sum(r[2] for r in sub_rows):,}req / "
            f"total {sum(r[3] for r in sub_rows):,}"))
        for r in sub_rows[:8]:
            name = tasks.get(r[0]) or r[1] or r[0]
            lines.append(
                f"    {fmt(r[3]):>8}  {r[2]:>3}req  {str(name).replace(chr(10), ' ')[:30]}  [{r[0][-6:]}]")
        if len(sub_rows) > 8:
            lines.append(L(f"    （另有 {len(sub_rows) - 8} 个）", f"    (…plus {len(sub_rows) - 8} more)"))
    return "\n".join(lines)


def _session_start_ms(con, sid, srow=None):
    """会话起点：首个已完成请求的 started_at；无请求（纯新建/纯问答）回退会话创建时间。
    供悬浮条「会话累计」tooltip 的起始时间展示用。"""
    r = con.execute(
        "select min(started_at) from model_usage where session_id=? and status='completed'",
        (sid,),
    ).fetchone()
    if r and r[0]:
        return int(r[0])
    if srow is None:
        srow = con.execute("select time_created from session where id=?", (sid,)).fetchone()
    return int(srow["time_created"]) if srow and srow["time_created"] else 0


def _model_cost_groups(con, where, args):
    """completed 行按 (model_id, provider_id) 聚合的 token 分项分组（费用计算输入）。
    同模型经不同 provider 计费价不同，故聚合到二元组；展示层再按 model_id 合并。"""
    rows = con.execute(
        f"""select model_id, provider_id, coalesce(sum(input_tokens),0),
                   coalesce(sum(output_tokens),0), coalesce(sum(cache_read_input_tokens),0),
                   coalesce(sum(cache_creation_input_tokens),0)
            from model_usage where status='completed' and {where} group by model_id, provider_id""",
        args,
    ).fetchall()
    return [(r[0] or "", r[1] or "", r[2], r[3], r[4], r[5]) for r in rows]


def _session_models_cost(con, sid, per_model=None):
    """模型明细 + 会话预估费用（v202）：单条 GROUP BY 查询同时产出计数/总量/费用。
    返回 (models 列表（按 total 降序，价表模块可用时带 cost_usd）, 会话总费用或 None)。
    价表模块缺失（旧运行目录未部署 token_pricing.py）时退回 v163 结构、总费用 None。
    per_model（小写模型键 → [rated_output, gen_ms]）可选：挂 avg_tps 供模型明细平均速度列。"""
    models_acc = {}
    model_names = {}
    raw_groups = []
    for r in con.execute(
        """select model_id, provider_id, count(*), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(cache_read_input_tokens),0), coalesce(sum(cache_creation_input_tokens),0)
           from model_usage where session_id=? and status='completed'
           group by model_id, provider_id""", (sid,)).fetchall():
        raw_m = r[0] or ""
        m_key = raw_m.lower()
        model_names[m_key] = _canon_model_name(model_names.get(m_key), raw_m)
        a = models_acc.setdefault(m_key, [0, 0])
        a[0] += r[2]
        a[1] += r[3]
        raw_groups.append((raw_m, r[1] or "", r[4], r[5], r[6], r[7]))
    models = [{"model": model_names[k], "requests": v[0], "total": v[1]} for k, v in models_acc.items()]
    _attach_model_tps(models, per_model)
    if _pricing is None:
        models.sort(key=lambda m: -m["total"])
        return models, None
    groups = [(model_names[(m or "").lower()], prov, inp, out, cr, cw)
              for m, prov, inp, out, cr, cw in raw_groups]
    total, per = _pricing.merge_model_costs(groups)
    prov_of = {}
    for model, prov, *_ in groups:
        prov_of.setdefault(model, prov)
    for m in models:
        m["cost_usd"] = per.get(m["model"], 0.0)
        m["rates"] = _model_rates(m["model"], prov_of.get(m["model"], "")).get("rates")
    models.sort(key=lambda m: -m["total"])
    return models, total


def _model_rates(model_id, provider_id):
    """当前模型牌价（预估费用说明气泡展示）：价目表命中条目四价 + 命中键。
    可选增强字段：模块缺失/查询任何失败返回 {}（字段省略，消费端隐藏该行）。"""
    if _pricing is None:
        return {}
    try:
        rates, key, _ = _pricing.lookup_full(model_id or "", provider_id or "")
        return {"rates": {"input": rates["input"], "output": rates["output"],
                          "cache_read": rates["cache_read"], "cache_write": rates["cache_write"],
                          "key": key}}
    except Exception:
        return {}


def _scope_models_cost(con, where, args, per_model=None):
    """按范围（本轮/今日/子代理）产出 (models 明细, 费用总额)，结构与 _session_models_cost 一致。
    v202：本轮/今日/子代理 tooltip 的模型明细块与费用行共用这一条分组查询。
    per_model（小写模型键 → [rated_output, gen_ms]）可选：挂 avg_tps 供模型明细平均速度列。"""
    if _pricing is None:
        return None, None
    try:
        rows = con.execute(
            f"""select model_id, provider_id, count(*), coalesce(sum(computed_total_tokens),0),
                       coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                       coalesce(sum(cache_read_input_tokens),0), coalesce(sum(cache_creation_input_tokens),0)
                from model_usage where status='completed' and {where} group by model_id, provider_id""",
            args,
        ).fetchall()
    except Exception:
        return None, None
    models_acc = {}
    model_names = {}
    raw_groups = []
    for r in rows:
        raw_m = r[0] or ""
        m_key = raw_m.lower()
        model_names[m_key] = _canon_model_name(model_names.get(m_key), raw_m)
        a = models_acc.setdefault(m_key, [0, 0])
        a[0] += r[2]
        a[1] += r[3]
        raw_groups.append((raw_m, r[1] or "", r[4], r[5], r[6], r[7]))
    groups = [(model_names[(m or "").lower()], prov, inp, out, cr, cw)
              for m, prov, inp, out, cr, cw in raw_groups]
    try:
        total, per = _pricing.merge_model_costs(groups)
    except Exception:
        return None, None
    prov_of = {}
    for model, prov, *_ in groups:
        prov_of.setdefault(model, prov)
    models = [{"model": model_names[k], "requests": v[0], "total": v[1], "cost_usd": per.get(model_names[k], 0.0),
               "rates": _model_rates(model_names[k], prov_of.get(model_names[k], "")).get("rates")}
              for k, v in models_acc.items()]
    _attach_model_tps(models, per_model)
    models.sort(key=lambda m: -m["total"])
    return models, total


def _scope_cost(con, where, args):
    """指定范围（本轮/今日）的预估费用总额。可选增强字段：模块缺失或查询/计价任何
    失败都返回 None（字段省略），不拖垮快照（同 provider_fallback 口径）。"""
    if _pricing is None:
        return None
    try:
        return _pricing.merge_model_costs(_model_cost_groups(con, where, args))[0]
    except Exception:
        return None


def _light_snapshot(con, sid, cfg):
    """recent 池轻量行（v8 瘦身）：两条聚合 SQL 出齐顶层计数，明细字段给空结构。
    状态条只渲染 1 个会话，recent 长尾行仅作会话切换兜底；兜底候选（force + latest +
    最近活跃前 2）恒为完整快照，轻量行只在极端长尾被兜底选中时降级显示（缺明细不缺计数）。
    sub.list 聚合数字置 0 而非缺失：overlay 的子代理面板/汇总按字段渲染，结构必须完整。"""
    u = session_usage(con, sid)
    srow = con.execute(
        "select title, summary_additions, summary_deletions, summary_files, parent_id, time_created from session where id=?",
        (sid,),
    ).fetchone()
    lr = con.execute("select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()
    now_ms = int(time.time() * 1000)
    return {
        "sid": sid,
        "title": (srow["title"] if srow is not None else "") or "",
        "active": bool(lr[0] and now_ms - lr[0] < SESSION_TIMEOUT_MS),
        "turns": u["turns"], "requests": u["requests"], "input": u["input"],
        "output": u["output"], "reasoning": u["reasoning"], "cache_read": u["cache_read"],
        "cache_write": u["cache_write"], "total": u["total"], "tool_calls": u["tool_calls"],
        "retries": u["retries"], "ctx": u["last_request_input"],
        # v202 预估费用（可选增强字段，旧快照消费端按缺字段容错；模块缺失时省略）
        **({"cost_usd": _scope_cost(con, "session_id=?", (sid,))} if _pricing is not None else {}),
        "updated": (_ts(lr[0]).strftime("%H:%M:%S") if lr[0] else ""),
        "started": _session_start_ms(con, sid, srow),
        "avg_tps": 0,
        "speed_segs": [],
        "sub": {"requests": 0, "total": 0, "input": 0, "output": 0, "cache_read": 0,
                "reasoning": 0, "cache_write": 0, "active": False, "rate_avg": 0, "list": []},
        "tools": {"total": u["tool_calls"], "errors": 0, "list": []},
        "last_turn": dict(_EMPTY_TURN),
        "last": {"duration_ms": 0, "ttft_ms": 0, "model": "", "provider_id": "", "tps": 0, "startedAt": 0, "endedAt": 0},
        "code": {"add": (srow["summary_additions"] if srow is not None else None),
                 "del": (srow["summary_deletions"] if srow is not None else None),
                 "files": (srow["summary_files"] if srow is not None else None)},
        "ctx_exc": 0,
        "context_window": cfg["context_window"], "context_auto": False,
        "last_at": con.execute(
            "select max(completed_at) from model_usage where session_id=? and status='completed'", (sid,),
        ).fetchone()[0] or 0,
        "is_sub": _is_sub_sid(sid),
        "sub_kind": _sub_kind_of(sid),   # 工作流支持（specs/workflow-support.md）：agent/workflow/空串，消费端按缺省容错
        "parent": (srow["parent_id"] if srow is not None else None),
    }


def hides_reasoning(model_id):
    """Claude 系列不单独上报思考 token：reasoning_tokens 恒为 0，output_tokens 却已含思考，
    且思考在 first_token_at 之前流出。按首字窗口计时会把思考期漏出分母（2026-10-15 真库：
    claude-opus-5-5 有 35% 请求按首字窗口超过 300 tok/s），须同含思考段一样从 started_at 起算。
    与 usage_stats.hides_reasoning 同源（支持远端单文件直跑兜底）。"""
    if _shared_hides_reasoning is not None:
        return _shared_hides_reasoning(model_id)
    return "claude" in (model_id or "").lower()


_COVERS_TTL_S = 60.0
_COVERS_CACHE = {"ts": 0.0, "set": frozenset()}   # 首块落章 provider 集合缓存（原地更新）


def _provider_first_token_covers(con):
    """「首块即落章」的 provider 集合（底层计算委派 usage_stats.query_first_token_covers，
    与 token_rate.first_token_covers 同源；常驻进程加 60s TTL 缓存摊薄全表扫描）。
    测试改库后须重置 _COVERS_CACHE（ts=0.0 表示未缓存）。"""
    now = time.monotonic()
    if _COVERS_CACHE["ts"] > 0.0 and now - _COVERS_CACHE["ts"] < _COVERS_TTL_S:
        return _COVERS_CACHE["set"]
    if _query_first_token_covers is not None:
        res = _query_first_token_covers(con)
    else:
        out = set()
        if con is not None:
            try:
                rows = con.execute(
                    """select provider_id, count(*) n,
                              sum(reasoning_tokens) sx, sum(time_to_first_token_ms) sy,
                              sum(reasoning_tokens * time_to_first_token_ms) sxy,
                              sum(reasoning_tokens * reasoning_tokens) sxx
                       from model_usage
                       where reasoning_tokens > 0 and time_to_first_token_ms is not null
                         and provider_id is not null
                       group by provider_id""").fetchall()
                for r in rows:
                    n = r[1] or 0
                    sx = r[2] or 0
                    denom = n * (r[5] or 0) - sx * sx
                    if n < 5 or denom <= 0:
                        continue
                    slope = (n * (r[4] or 0) - sx * (r[3] or 0)) / denom
                    if slope < 2.0:
                        out.add(r[0])
            except sqlite3.Error:
                out = set()
        res = frozenset(out)
    _COVERS_CACHE.update(ts=now, set=res)
    return _COVERS_CACHE["set"]


def _row_gen_ms(r, covers=frozenset()):
    """按 usage_stats.row_gen_ms / token_rate.py 同款口径算一行 model_usage 的生成时长；
    first_token_at 缺失或窗口非正则不可信，返回 None（该请求不参与 last.tps 计算）。
    底层计算委派 usage_stats.row_gen_ms（支持远端单文件直跑无 usage_stats.py 时的内联兜底）。"""
    if _shared_row_gen_ms is not None:
        return _shared_row_gen_ms(r, covers, hides_reasoning_fn=hides_reasoning)
    ft, ct, st = r["first_token_at"], r["completed_at"], r["started_at"]
    if not ft or not ct or ct <= ft:
        return None
    gen_ms = ct - ft
    if (r["reasoning_tokens"] or hides_reasoning(r["model_id"])) and st and ct > st:
        try:
            pid = r["provider_id"]
        except (KeyError, IndexError):
            pid = None
        if pid not in covers:
            gen_ms = ct - st   # 推理前置/Claude/判定缺证据：窗口前移到 started_at
    return gen_ms


def _rate_sample(row, covers=frozenset()):
    if row and (row["output_tokens"] or 0) > 0:
        gen_ms = _row_gen_ms(row, covers)
        if gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
            return {"tps": round(row["output_tokens"] / (gen_ms / 1000), 1),
                    "startedAt": row["started_at"] or 0, "endedAt": row["completed_at"] or 0}
    return None


def _last_valid_rate(con, sid, last, covers=frozenset()):
    """最近有效生成速度及同一请求的起止；最多回查 3 倍扫描窗（60 条），缺有效样本时隐藏。"""
    sample = _rate_sample(last, covers)
    if sample is not None:
        return sample
    rows = con.execute(
        """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id, provider_id
           from model_usage where session_id=? and status='completed'
           order by completed_at desc limit ?""",
        (sid, _TPS_LOOKBACK * 3),
    ).fetchall()
    for row in rows:
        sample = _rate_sample(row, covers)
        if sample is not None:
            return sample
    return {"tps": 0, "startedAt": 0, "endedAt": 0}


def _turn_rate(rows, covers=frozenset(), per_model=None):
    """加权速度聚合：Σ有效输出 ÷ Σ有效生成窗口。per_model 可选——传字典则同遍循环
    按 model_id 小写累加 {rated_output, gen_ms}（与范围总量同口径，仅有效段进分子分母；
    逐模型均速=该两项经 _rated_tps 合成），供模型明细「平均速度」列复用，零新增扫描。"""
    output, unrated, duration = 0, 0, 0
    for row in rows:
        tokens = row["output_tokens"] or 0
        gen_ms = _row_gen_ms(row, covers)
        if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
            output += tokens
            duration += gen_ms
            if per_model is not None:
                acc = per_model.setdefault((row["model_id"] or "").lower(), [0, 0])
                acc[0] += tokens
                acc[1] += gen_ms
        else:
            unrated += tokens
    return {"tps": round(output / (duration / 1000), 1) if duration else 0,
            "rated_output": output, "unrated_output": unrated, "gen_ms": duration}


def _rated_tps(tokens, gen_ms):
    """加权平均 t/s：Σ有效 output ÷ Σ有效生成窗口；窗口为 0（无有效样本）时返回 0。"""
    return round(tokens / (gen_ms / 1000), 1) if gen_ms else 0


def _attach_model_tps(models, per_model):
    """把 per_model（小写模型键 → [rated_output, gen_ms]）的加权均挂到模型明细行。
    模型对象已按小写键归一，键对齐即可；无有效段（gen_ms=0）写 0，消费端显 —。"""
    if per_model is None:
        return models
    for m in models:
        key = (m.get("model") or "").lower()
        out, ms = per_model.get(key, (0, 0))
        m["avg_tps"] = _rated_tps(out, ms)   # 无有效段（含空字典）=0，消费端显 —
    return models


def _speed_turns(con, session_ids, covers):
    """v253：按会话集合取真实已完成 main_turn 轮，按轮完成时间升序。

    每行 = 一次用户提问对应的完整模型轮（turn_id 分组；NULL turn_id 的旧行按会话各自
    归并一组）。速度分子/分母严格复用 _speed_segments 同款口径：_row_gen_ms 生成窗口 +
    200ms–1h 有效段过滤、辅助 query_source 与子代理行不计、碎段只计 i/o/n 不进分母；
    轮归属取轮内最后完成时间，跨时间边界不重复计入两个桶。
    v253 轮字段（短键 + 索引表压缩帧体积）：s=会话 id、t=轮完成时刻、b=轮起始（hover
    卡显示完整区间）、out=Σ有效输出（速度分子）、ms=Σ有效生成窗口（速度分母）、
    i/o=轮内已完成行输入/输出合计（input 已含缓存、output 已含思考，不重复相加）、
    n=请求数、msl=按有效输出排序的 [模型, 输出, 生成窗口ms, 请求数] 明细（v384 四元组：
    ms=该模型通过窗口过滤行的 Σ窗口毫秒、n=该模型本轮已完成行数含无效窗口行，仅 out>0
    入列；_speed_history 转索引时按 (model, provider) 建身份表并剥掉末位 provider）、
    c=轮预估费用 USD（价表可能含兜底均价，展示层恒标「含兜底估价」，不冒充完整牌价）。
    刻意不存 v（单点 t/s）：渲染端所有柱/桶/均值一律按 Σout÷Σms 重算，杜绝算术平均。
    返回 (turns, session_rows)：session_rows 供顶部名称表一次性取会话名/项目归属。"""
    if not session_ids:
        return [], {}
    ids = list(session_ids)
    # 有界：先按库全局取最近 N 个完成轮窗口，再只取这些 (sid,turn_id) 的行——不整表捞行
    windows = [tuple(r) for r in con.execute(
        """select session_id, turn_id, max(completed_at) as ct
           from model_usage where status='completed'
             and (query_source is null or query_source='main_turn')
             and completed_at is not null
           group by session_id, turn_id order by ct desc limit ?""",
        (_SPEED_HISTORY_MAX_TURNS,))]
    wanted = set(ids)
    windows = [w for w in windows if w[0] in wanted]
    if not windows:
        return [], {}
    groups, null_pairs = {}, []
    for sid, tid, _ in windows:
        if tid is None:
            null_pairs.append(sid)
        groups.setdefault(sid, {})[tid] = []
    for sid, tids in groups.items():
        real = [t for t in tids if t is not None]
        for i in range(0, len(real), 400):
            part = real[i:i + 400]
            qm = ",".join("?" * len(part))
            for row in con.execute(
                f"""select turn_id, output_tokens, input_tokens, cache_read_input_tokens,
                           cache_creation_input_tokens, first_token_at, completed_at, started_at,
                           reasoning_tokens, model_id, provider_id
                    from model_usage where session_id=? and status='completed'
                      and (query_source is null or query_source='main_turn') and turn_id in ({qm})""",
                (sid, *part)):
                groups[sid][row["turn_id"]].append(row)
    # turn_id 缺失的旧行：按会话归并一组（与 _speed_segments 的 NULL 轮同款防御上限）
    for sid in dict.fromkeys(null_pairs):
        rows = con.execute(
            """select output_tokens, input_tokens, cache_read_input_tokens,
                      cache_creation_input_tokens, first_token_at, completed_at, started_at,
                      reasoning_tokens, model_id, provider_id
               from model_usage where session_id=? and status='completed'
                 and (query_source is null or query_source='main_turn') and turn_id is null
               order by completed_at desc, rowid desc limit 500""",
            (sid,)).fetchall()
        if rows:
            groups[sid][None] = rows
    srows = {}
    try:
        for i in range(0, len(ids), 400):
            part = ids[i:i + 400]
            qm = ",".join("?" * len(part))
            for r in con.execute(
                    f"select id, title, project_id, directory from session where id in ({qm})", part):
                srows[r["id"]] = r
    except sqlite3.Error:
        srows = {}   # 旧库/列漂移：元数据降级为 sid 自身，不拖垮可选增强字段
    out = []
    for sid, by_tid in groups.items():
        for tid, rows in by_tid.items():
            if not rows:
                continue
            valid_out = valid_ms = tin = tout = 0
            models, cost_groups = {}, {}
            t0 = None
            t1 = max((r["completed_at"] or 0) for r in rows)
            for row in rows:
                tokens = row["output_tokens"] or 0
                inp = row["input_tokens"] or 0
                tin += inp
                tout += tokens
                st = row["started_at"] or 0
                if st and (t0 is None or st < t0):
                    t0 = st
                key = (row["model_id"] or "", row["provider_id"] or "")
                cg = cost_groups.setdefault(key, [0, 0, 0, 0])
                cg[0] += inp
                cg[1] += tokens
                cg[2] += row["cache_read_input_tokens"] or 0
                cg[3] += row["cache_creation_input_tokens"] or 0
                gen_ms = _row_gen_ms(row, covers)
                # v384 模型级速度：每行都登记模型——n 计该模型本轮全部已完成行（含无效
                # 窗口行），ms 只累加通过窗口过滤的有效行（渲染端按 Σout÷Σms 算模型速度）
                m = models.setdefault(key, {"out": 0, "ms": 0, "n": 0})
                m["n"] += 1
                if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
                    valid_out += tokens
                    valid_ms += gen_ms
                    m["out"] += tokens
                    m["ms"] += gen_ms
            if not valid_ms or not t1:
                continue   # 无有效生成窗口的轮不参与任何速度统计（不显误导性 0 t/s）
            # 短键 + 顶部名称/模型表：每轮只带索引，避免长 sid/项目名/模型名在千轮帧里重复
            t = {"s": sid, "t": t1, "b": t0 or t1,
                 "out": valid_out, "ms": valid_ms,
                 "i": tin, "o": tout, "n": len(rows)}
            ml = sorted(models.items(), key=lambda kv: -kv[1]["out"])
            # 预索引条目末位带 provider_id：_speed_history 以 (model, provider) 二元组建
            # mnames/mkeys 身份表，转索引后剥掉——同名牌不同 provider 不再共享身份
            t["msl"] = [[k[0], v["out"], int(v["ms"]), v["n"], k[1]]
                        for k, v in ml if v["out"] > 0][:8]
            if _pricing is not None:
                try:
                    groups_in = [(k[0], k[1], g[0], g[1], g[2], g[3])
                                 for k, g in cost_groups.items()]
                    if groups_in:
                        t["c"] = _pricing.merge_model_costs(groups_in)[0]
                        # 价表对未命中模型用 DEFAULT_RATES 兜底均价，且 merge_model_costs
                        # 不回传命中层级——无法证明"完整牌价"。不置 cf：渲染端一律标
                        # 「含兜底估价」，绝不把可能含兜底的费用冒充完整价格。
                except Exception:
                    pass   # 计价失败省略费用字段，展示层显"暂无估价"
            out.append(t)
    out.sort(key=lambda x: (x["t"], x["s"], x["b"]))
    return out, srows


def _speed_history(con, sid=""):
    """v254：速度 Tooltip 统一数据面——始终产出本库**全部**会话的有界轮表。

    同一帧快照会推给所有窗口/分栏，所以这里不做 pane 级过滤：渲染端按本 pane 可信
    sid + pids 项目表自行判定「会话/项目/全部」范围（多窗互不串数据）。sid 仅作诊断。
    全库是「全部」范围的必然要求；远端身份下渲染端禁用「全部」并明示降级，不借本地
    冒充远端历史。本地与远端不跨库拼接：远端旧版无本字段时整块不渲染。"""
    covers = _provider_first_token_covers(con)
    try:
        all_ids = [r[0] for r in con.execute("select id from session")]
    except sqlite3.Error:
        all_ids = []
    turns, srows = _speed_turns(con, all_ids, covers)
    try:
        window_n = con.execute(
            """select count(*) from (select session_id, turn_id from model_usage
               where status='completed' and (query_source is null or query_source='main_turn')
               group by session_id, turn_id limit ?)""",
            (_SPEED_HISTORY_MAX_TURNS + 1,)).fetchone()[0]
    except sqlite3.Error:
        window_n = len(turns)
    # 名称表：sid → [会话名, project_id, 项目名]；只在轮里出现过的会话才输出，
    # 渲染端按会话/项目比较维度取标签与归属，长字符串不随千轮重复进帧。
    # 索引表：长 sid/项目名/模型名各只存一份，轮里改存整数下标——帧体积从 ~540KB
    # 降到 ~160KB，避免 1.5s 泵每窗重复推长字符串（渲染端按表还原，数值零损失）。
    # v384：模型身份键从名牌改为 (model, provider) 二元组——mnames 仍存显示名 model_id，
    # 平行的 mkeys[i] = provider_id + "\x1f" + model_id（provider 缺失用空串），同名牌
    # 不同 provider 的模型获得独立身份；缺席 mkeys 的旧帧渲染端退化为按名称识别。
    sid_idx, sids, snames, pids, mname_idx, mnames, mkeys = {}, [], [], [], {}, [], []
    for t in turns:
        k = t["s"]
        if k not in sid_idx:
            sid_idx[k] = len(sids)
            sids.append(k)
        sr = srows.get(k)
        sn = (sr["title"] if sr is not None else "") or k
        # snames/pids 都按 sid 下标一一对应（渲染端 spdUnpack 用 snames[r.s]/pids[r.s]）
        while len(snames) <= sid_idx[k]:
            snames.append("")
        snames[sid_idx[k]] = sn[:120]
        pid = (sr["project_id"] if sr is not None else "") or ""
        pdir = ((sr["directory"] if sr is not None else "") or "").replace("\\", "/").rstrip("/")
        pn = pdir.rsplit("/", 1)[-1] if pdir else (pid or k)
        # pids 按 sid 下标一一对应（渲染端 spdUnpack 用 pids[r.s] 取项目归属）
        while len(pids) <= sid_idx[k]:
            pids.append(["", ""])
        pids[sid_idx[k]] = [pid, pn]
        for p in t["msl"]:
            mk = (p[0], p[4])
            if mk not in mname_idx:
                mname_idx[mk] = len(mnames)
                mnames.append(p[0])
                mkeys.append((p[4] or "") + "\x1f" + (p[0] or ""))
    for t in turns:
        t["s"] = sid_idx[t["s"]]
        t["msl"] = [[mname_idx[(p[0], p[4])], p[1], p[2], p[3]] for p in t["msl"]]
    # 轮按 (完成时间, 会话, 起始) 升序；相邻时间差通常 < 2^31 ms，delta 编码省掉大整数
    prev = 0
    for t in turns:
        cur = t["t"]
        t["t"] = cur - prev
        prev = cur
    return {
        "source": "local",               # 数据源边界：远端身份下渲染端禁用「全部」
        "sids": sids,                    # 会话 id 索引表
        "snames": snames,                # 会话名索引表（按 sid 下标取）
        "pids": pids,                    # [project_id, 项目名] 索引表（按 sid 下标取）
        "mnames": mnames,                # 模型名索引表（显示名=model_id）
        "mkeys": mkeys,                  # 模型身份索引表（provider_id+"\x1f"+model_id，与 mnames 平行）
        "turns": turns,                  # 单一事实源：全部筛选/聚合在渲染端按同一公式推导
        "truncated": window_n > _SPEED_HISTORY_MAX_TURNS,
    }


def _speed_history_cached(con, sid=""):
    """按库文件身份的 2s 短缓存。轮表是全库统一数据、与 pane 无关，key 不含 sid
    （避免会话切换产生新键）；内存库不缓存。独立 _SPEED_CACHE 不挤掉 _AGG_CACHE
    里的 scan/today/todaydetail 热条目（_cached_project 同款教训）。"""
    dbkey = _db_cache_key(con)
    if dbkey is None:
        return _speed_history(con, sid)
    key = dbkey
    hit = _SPEED_CACHE.get(key)
    now = int(time.time() * 1000)
    if hit:
        if now - hit[0] < _SPEED_HISTORY_TTL_MS:
            return hit[1]
        # 冷算 0.15~0.7s（大库）：流式期间 model_usage 恒定，水位未变就别重扫（泵 1.5s < TTL 2s 曾致约一半帧重算）
        if _wm_alive(_SPEED_WM, key, hit, con, now):
            return hit[1]
    wm = _usage_watermark(con)
    val = _speed_history(con, sid)
    if len(_SPEED_CACHE) > 4:
        _SPEED_CACHE.clear()
        _SPEED_WM.clear()
    _SPEED_CACHE[key] = (now, val)
    if wm is None or not (isinstance(val, dict) and val.get("turns")):
        _SPEED_WM.pop(key, None)   # 空轮表可能是查询降级（session 表读失败等）的结果：不延长，仍按 TTL 重试
    else:
        _SPEED_WM[key] = wm
    return val

def _speed_history_stale():
    """v257：跨 dbkey 取缓存里最近一份成功轮表（写库后 mtime/ino 变键，按键取不到旧值；
    条目最多 5 个，遍历廉价）。轮表是全库统一数据、与 pane 无关，库文件被替换的极端场景
    下分钟级陈旧也可接受（渲染端历史统计，下一帧成功即覆盖）。"""
    now = int(time.time() * 1000)
    best = None
    for hit in _SPEED_CACHE.values():
        if now - hit[0] <= _SPEED_HISTORY_STALE_MS and (best is None or hit[0] > best[0]):
            best = hit
    return best[1] if best else None


def _speed_history_safe(con, sid=""):
    """可选增强字段的统一入口：查询失败/旧库缺列/无本地连接返回 None（渲染端判空），
    不拖垮整帧快照；与 provider_fallback/project 的可选字段降级同款口径。
    v257：失败先短重试一次（新常驻进程首查撞上完成轮写窗口时，50ms 后 WAL 多半已放行；
    缓存 TTL 内不重扫，失败路径本就低频），再失败回退最近一次成功轮表（stale 上限见常量）
    ——热重载后的首帧若恰逢失败，渲染端粘性缓存为空会闪回旧版整卡。"""
    if con is None:
        return None
    try:
        return _speed_history_cached(con, sid)
    except (sqlite3.Error, TypeError, ValueError, KeyError, IndexError, OverflowError, AttributeError):
        pass
    try:
        time.sleep(0.05)
        return _speed_history_cached(con, sid)
    except (sqlite3.Error, TypeError, ValueError, KeyError, IndexError, OverflowError, AttributeError):
        pass
    try:
        return _speed_history_stale()
    except Exception:
        return None


def _speed_days(con):
    """v384（specs/speed-tooltip-v3.md §1.2）：全历史按**本地自然日**聚合的日桶帧——
    解决轮表 6000 轮上限对「全部」视图的截断。聚合口径与 _speed_turns 完全同源：已完成
    main_turn 行、_row_gen_ms 生成窗口 + 200ms–1h 有效段过滤、covers 特例，辅助
    query_source 与子代理行不计。日界一律 datetime.fromtimestamp 本地日历推导（DST/
    月末/跨年由标准库保证），禁止按固定 86400000 毫秒整除推日。
    日桶 [out, ms, n, turns, capFlag, msl]：out/ms=当日通过窗口过滤行的 Σ有效输出/Σ窗口
    （分母分子完整精确）；n=当日已完成行数（含无效窗口行）；turns=当日 distinct 轮数，
    非空 turn_id 按 (sid, turn_id) 复合键去重，turn_id 为 NULL 的旧行按每行一个独立计次
    （_speed_turns 把 NULL 行按会话归并一组，这里逐行计次是更细的可控口径，渲染端只做
    展示不做跨帧对账）；capFlag=1 表示当日模型列表 >_SPEED_DAYS_MAX_MODELS(8) 条被截断
    （日级总量不受影响）；msl 为**打平五元组序列** [mIdx,out,ms,n,tn, mIdx,out,ms,n,tn,
    ...]——每模型 5 个元素连续排列、省掉内层括号压帧体积（≤8 模型即 ≤40 个数字；旧版
    嵌套形态 msl[0] 是数组、新形态是数字，JS 端按 Array.isArray(msl[0]) 区分新旧）。
    条目按 out 降序、仅 out>0 的模型入列（与 _speed_turns 一致；out=0 的模型只计入日级
    总量不进身份列表），tn=当日含该模型已完成行（不论窗口有效性）的 distinct 轮数，
    与日级 turns 同款 NULL 行逐行计次。
    truncated=1 表示存在早于窗口起点（今天往前 _SPEED_DAYS_MAX_DAYS 个本地日）的已完成
    行，渲染端据此明示「已截断」；早于起点/晚于今天的时间戳行（时钟偏移）不进任何桶，
    不伪造未来日。mnames/mkeys 与 speed_history 同款 (model, provider) 身份表。"""
    covers = _provider_first_token_covers(con)
    today0 = _day_start()
    start0 = today0 - timedelta(days=_SPEED_DAYS_MAX_DAYS - 1)
    start_ms = _epoch_ms(start0)
    start_date, today_date = start0.date(), today0.date()
    probe = con.execute(
        """select min(completed_at) from model_usage where status='completed'
             and (query_source is null or query_source='main_turn')
             and completed_at is not null""").fetchone()
    truncated = 1 if probe and probe[0] is not None and probe[0] < start_ms else 0
    days = {}   # 本地 date → [out, ms, n, 轮键集合, 模型字典]；空日不建桶，装配时补零
    mname_idx, mnames, mkeys = {}, [], []
    for row in con.execute(
            """select rowid, output_tokens, completed_at, turn_id, session_id,
                      model_id, provider_id, first_token_at, started_at, reasoning_tokens
               from model_usage where status='completed'
                 and (query_source is null or query_source='main_turn')
                 and completed_at is not null"""):
        ct = row["completed_at"]
        if ct < start_ms:
            continue
        day = datetime.fromtimestamp(ct / 1000).date()
        if day > today_date or day < start_date:
            continue   # 未来时间戳（时钟偏移）不伪造日桶；起点判定冗余防御
        b = days.get(day)
        if b is None:
            b = days[day] = [0, 0, 0, set(), {}]
        # 轮身份：非空 turn_id 用 (sid, turn_id)；NULL 旧行每行一个独立计次（rowid 唯一）
        tk = (row["session_id"], row["turn_id"]) if row["turn_id"] is not None else (None, row["rowid"])
        b[3].add(tk)
        mk = (row["model_id"] or "", row["provider_id"] or "")
        if mk not in mname_idx:
            mname_idx[mk] = len(mnames)
            mnames.append(mk[0])
            mkeys.append(mk[1] + "\x1f" + mk[0])
        macc = b[4].get(mk)
        if macc is None:
            macc = b[4][mk] = [0, 0, 0, set()]
        b[2] += 1            # n：当日已完成行数（含无效窗口行）
        macc[2] += 1
        macc[3].add(tk)      # tn 与日级 turns 同款 NULL 逐行计次
        gen_ms = _row_gen_ms(row, covers)
        tokens = row["output_tokens"] or 0
        if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
            b[0] += tokens
            b[1] += gen_ms
            macc[0] += tokens
            macc[1] += gen_ms
    buckets = []
    for i in range(_SPEED_DAYS_MAX_DAYS):
        b = days.get(start_date + timedelta(days=i))
        if b is None:
            buckets.append([0, 0, 0, 0, 0, 0])   # 空日：msl 槽位恒 0（无记录）
            continue
        ml = sorted((kv for kv in b[4].items() if kv[1][0] > 0), key=lambda kv: -kv[1][0])
        top = ml[:_SPEED_DAYS_MAX_MODELS]
        msl = []
        for k, v in top:
            msl += [mname_idx[k], v[0], int(v[1]), v[2], len(v[3])]   # 打平五元组，省内层括号
        buckets.append([b[0], b[1], b[2], len(b[3]),
                        1 if len(ml) > _SPEED_DAYS_MAX_MODELS else 0, msl])
    return {
        "v": 1,
        "source": "local",               # 数据源边界：远端身份下渲染端禁用「全部」
        "start": start_ms,               # 首日（最旧）本地 00:00 epoch ms，days[i]=start+i*864e5
        "days": buckets,                 # 连续本地自然日，旧→新，末位=今天
        "mnames": mnames,
        "mkeys": mkeys,
        "truncated": truncated,
    }


def _speed_days_cached(con):
    """speed_days 的 2s 短缓存：完整镜像 _speed_history_cached（独立 _DAYS_CACHE 不挤
    _AGG_CACHE/_SPEED_CACHE，dbkey 键、TTL 内直取、过期后 model_usage 水位未变续用、
    内存库不缓存）。日桶同样是全库统一数据、与 pane 无关，key 不含 sid。"""
    dbkey = _db_cache_key(con)
    if dbkey is None:
        return _speed_days(con)
    key = dbkey
    hit = _DAYS_CACHE.get(key)
    now = int(time.time() * 1000)
    if hit:
        if now - hit[0] < _SPEED_HISTORY_TTL_MS:
            return hit[1]
        if _wm_alive(_DAYS_WM, key, hit, con, now):
            return hit[1]
    wm = _usage_watermark(con)
    val = _speed_days(con)
    if len(_DAYS_CACHE) > 4:
        _DAYS_CACHE.clear()
        _DAYS_WM.clear()
    _DAYS_CACHE[key] = (now, val)
    if wm is None or not any(d[2] for d in val["days"]):
        _DAYS_WM.pop(key, None)   # 空帧可能是查询降级的结果：不延长，仍按 TTL 重试
    else:
        _DAYS_WM[key] = wm
    return val


def _speed_days_stale():
    """跨 dbkey 取缓存里最近一份成功日桶帧：与 _speed_history_stale 同款（库文件被替换
    的极端场景下分钟级陈旧可接受，下一帧成功即覆盖）。"""
    now = int(time.time() * 1000)
    best = None
    for hit in _DAYS_CACHE.values():
        if now - hit[0] <= _SPEED_HISTORY_STALE_MS and (best is None or hit[0] > best[0]):
            best = hit
    return best[1] if best else None


def _speed_days_safe(con):
    """可选增强字段统一入口：完整镜像 _speed_history_safe（失败先 50ms 短重试一次，
    再回退最近成功帧，stale 上限共用 _SPEED_HISTORY_STALE_MS；捕获面同款宽捕获）。
    查询失败/旧库缺列/无本地连接返回 None（渲染端判空），不拖垮整帧快照。"""
    if con is None:
        return None
    try:
        return _speed_days_cached(con)
    except (sqlite3.Error, TypeError, ValueError, KeyError, IndexError, OverflowError, AttributeError):
        pass
    try:
        time.sleep(0.05)
        return _speed_days_cached(con)
    except (sqlite3.Error, TypeError, ValueError, KeyError, IndexError, OverflowError, AttributeError):
        pass
    try:
        return _speed_days_stale()
    except Exception:
        return None


def _speed_segments(con, sid, covers=frozenset()):
    """当前会话最近 ≤10 轮（可跨天）已完成 main_turn 有效速度段（速度 tooltip 柱状图）。
    v250 起按轮（turn_id）聚合：一次提问的全部模型请求合并为一柱——v = 轮内有效行
    Σoutput ÷ Σ生成窗口（_row_gen_ms 窗口 + 200ms–1h 过滤，辅助 query_source 与子代理
    行不计，与回答末尾逐问口径同源）；v 保留原始浮点不 round（柱高与档位判断用原始
    值，显示层才取一位小数）。随段携带悬停卡明细：m=轮内最大输出有效行的模型、
    i/o=轮内已完成行输入/输出合计、n=轮内已完成请求数、c=轮预估费用 USD（价表模块
    缺失或计价失败省略字段）。t 为轮内最后完成时间毫秒；先取最近 3×10 个轮窗口再取
    行，无效轮顺延补位，按轮完成时间升序返回。"""
    windows = con.execute(
        """select turn_id, max(completed_at) from model_usage
           where session_id=? and status='completed'
             and (query_source is null or query_source='main_turn')
           group by turn_id order by 2 desc, turn_id limit ?""",
        (sid, _SPEED_SEGS_MAX * 3),
    ).fetchall()
    if not windows:
        return []
    ids = [w[0] for w in windows if w[0] is not None]
    groups = {}
    if ids:
        marks = ",".join("?" * len(ids))
        for row in con.execute(
            f"""select turn_id, output_tokens, input_tokens, cache_read_input_tokens,
                       cache_creation_input_tokens, first_token_at, completed_at, started_at,
                       reasoning_tokens, model_id, provider_id
                from model_usage where session_id=? and status='completed'
                  and (query_source is null or query_source='main_turn') and turn_id in ({marks})""",
            (sid, *ids),
        ):
            groups.setdefault(row["turn_id"], []).append(row)
    if any(w[0] is None for w in windows):
        # turn_id 缺失的旧行归并为一组（SQLite group by 同样把 NULL 归为一类）
        for row in con.execute(
            """select turn_id, output_tokens, input_tokens, cache_read_input_tokens,
                      cache_creation_input_tokens, first_token_at, completed_at, started_at,
                      reasoning_tokens, model_id, provider_id
               from model_usage where session_id=? and status='completed'
                 and (query_source is null or query_source='main_turn') and turn_id is null
               order by completed_at desc, rowid desc limit 500""",
            (sid,),
        ):
            groups.setdefault(None, []).append(row)   # 防御上限 500 行（取最近）：turn_id 缺失的存量超长会话截断聚合（n/i/o 为截断内合计，t 仍为全组最后完成）
    out = []
    for tid, _ in windows:
        rows = groups.get(tid)
        if not rows:
            continue
        valid_out = valid_ms = 0
        best_out, best_model = -1.0, ""
        tin = tout = 0
        cost_groups = {}
        for row in rows:
            tokens = row["output_tokens"] or 0
            tin += row["input_tokens"] or 0
            tout += tokens
            key = (row["model_id"] or "", row["provider_id"] or "")
            acc = cost_groups.setdefault(key, [0, 0, 0, 0])
            acc[0] += row["input_tokens"] or 0
            acc[1] += tokens
            acc[2] += row["cache_read_input_tokens"] or 0
            acc[3] += row["cache_creation_input_tokens"] or 0
            gen_ms = _row_gen_ms(row, covers)
            if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
                valid_out += tokens
                valid_ms += gen_ms
                if tokens > best_out:
                    best_out, best_model = tokens, row["model_id"] or ""
        if not valid_ms:
            continue
        seg = {"v": valid_out / (valid_ms / 1000), "t": max(r["completed_at"] or 0 for r in rows)}
        if best_model:
            seg["m"] = best_model
        seg["i"], seg["o"], seg["n"] = tin, tout, len(rows)
        if _pricing is not None:
            try:
                seg["c"] = _pricing.merge_model_costs(
                    [(k[0], k[1], g[0], g[1], g[2], g[3]) for k, g in cost_groups.items()])[0]
            except Exception:
                pass   # 计价失败省略费用字段，不拖垮快照（同 _scope_cost 口径）
        out.append(seg)
        if len(out) >= _SPEED_SEGS_MAX:
            break
    out.reverse()
    return out


def _session_snapshot(con, sid, cfg):
    """单个会话的完整快照（最新会话与 recent 列表共用一份结构）。"""
    srow = con.execute("select * from session where id=?", (sid,)).fetchone()
    u = session_usage(con, sid)
    last = con.execute(
        """select coalesce(duration_ms,0) as duration_ms, coalesce(time_to_first_token_ms,0), completed_at, turn_id, model_id,
                  output_tokens, first_token_at, started_at, reasoning_tokens, provider_id
           from model_usage where session_id=? and status='completed'
             and (query_source is null or query_source='main_turn')
           order by completed_at desc limit 1""",
        (sid,),
    ).fetchone()
    covers = _provider_first_token_covers(con)
    # 会话平均生成速度：全会话已完成 main_turn 段的加权平均——Σ有效输出 ÷ Σ有效生成窗口
    # （_turn_rate 同款口径：_row_gen_ms 窗口 + 200ms–1h 有效段过滤，无效段不进分母；
    # 子代理与辅助 query_source 行不计）。状态栏完成态主数字（平均为主，
    # 最近一段退到 tooltip）；与子代理 rate_avg 同构。
    # 规则 13：全会话 fetchall + 逐行窗口运算，长会话每帧数万次——按 (库身份, sid) 缓存。
    def _sess_rate():
        per_model = {}
        tr = _turn_rate(con.execute(
            """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id, provider_id
               from model_usage where session_id=? and status='completed'
                 and (query_source is null or query_source='main_turn')""",
            (sid,),
        ).fetchall(), covers, per_model)
        return {"tps": tr["tps"], "per_model": per_model}
    sess_rate = _cached_session(con, sid, "avg_tps", _sess_rate)
    sess_avg = sess_rate["tps"]
    # v300 会话级耗时聚合（会话累计 tooltip 三行 KPI 第二行）：对全会话已完成 main_turn
    # 请求求平均耗时/平均首字延迟（>0 样本过滤，同 v211 本轮口径）；总耗时 = Σ生成耗时
    # （真实生成时间，非墙钟跨度）。旧快照/缺字段时消费端按 >0 门控整行收起。
    sess_av = _cached_session(con, sid, "sess_av", lambda: con.execute(
        """select avg(case when duration_ms > 0 then duration_ms end),
                  avg(case when time_to_first_token_ms > 0 then time_to_first_token_ms end),
                  coalesce(sum(duration_ms),0)
           from model_usage where session_id=? and status='completed'
             and (query_source is null or query_source='main_turn')""",
        (sid,),
    ).fetchone())
    # 本轮数据源 = turn_usage 表的每轮完整聚合（v30 起，替代从 model_usage 手工按轮求和）：
    # 自带请求/重试/工具/工具错误计数与 reasoning 拆分，一轮一行。
    lt = {"requests": 0, "retries": 0, "tool_calls": 0, "tool_errors": 0, "input": 0,
          "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
          "total": 0, "duration_ms": 0, "ttft_ms": 0, "avg_duration_ms": 0, "avg_ttft_ms": 0,
          "started": 0, "ended": 0,
          "tps": 0, "rated_output": 0, "unrated_output": 0, "gen_ms": 0}
    if last and last["turn_id"]:
        t = con.execute(
            """select coalesce(model_request_count,0), coalesce(model_retry_count,0),
                      coalesce(tool_call_count,0), coalesce(tool_error_count,0),
                      coalesce(input_tokens,0), coalesce(output_tokens,0), coalesce(reasoning_tokens,0),
                      coalesce(cache_read_input_tokens,0), coalesce(cache_creation_input_tokens,0),
                      coalesce(computed_total_tokens,0),
                      coalesce(duration_ms,0), coalesce(time_to_first_token_ms,0)
               from turn_usage where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchone()
        # 本轮起止：首个请求的 started_at / 最后完成请求的 completed_at（tooltip 时间范围用）
        ts_row = con.execute(
            """select min(started_at), max(completed_at) from model_usage
               where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchone()
        turn_started = (ts_row[0] or 0) if ts_row else 0
        turn_ended = (ts_row[1] or 0) if ts_row else 0
        if t:
            lt = {"requests": t[0], "retries": t[1], "tool_calls": t[2], "tool_errors": t[3],
                  "input": t[4], "output": t[5], "reasoning": t[6], "cache_read": t[7],
                  "cache_write": t[8], "total": t[9], "duration_ms": t[10], "ttft_ms": t[11],
                  "started": turn_started, "ended": turn_ended}
        else:
            # 轮进行中 turn_usage 还没落 completed 行：回退 model_usage 现场聚合，保持实时显示
            r = con.execute(
                """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                          coalesce(sum(computed_total_tokens),0), coalesce(sum(duration_ms),0),
                          coalesce(sum(cache_read_input_tokens),0), coalesce(sum(reasoning_tokens),0),
                          coalesce(sum(cache_creation_input_tokens),0)
                   from model_usage where session_id=? and turn_id=? and status='completed'""",
                (sid, last["turn_id"]),
            ).fetchone()
            lt = {"requests": r[0], "retries": 0, "tool_calls": 0, "tool_errors": 0,
                  "input": r[1], "output": r[2], "reasoning": r[6], "cache_read": r[5],
                  "cache_write": r[7], "total": r[3], "duration_ms": r[4], "ttft_ms": 0,
                  "started": turn_started, "ended": turn_ended}
        # 本轮平均耗时/平均首字延迟（v211 用户规格）：对 model_usage 该轮已完成 main_turn 行
        # 直接求均值——turn_usage 的 ttft_ms 聚合列实测既非 Σ 也非 μ（宿主口径不明），不可依赖；
        # >0 过滤无效样本（缺首字/零耗时行不进均值，同测速无效段哲学）
        av = con.execute(
            """select avg(case when duration_ms > 0 then duration_ms end),
                      avg(case when time_to_first_token_ms > 0 then time_to_first_token_ms end)
               from model_usage where session_id=? and turn_id=? and status='completed'
                 and (query_source is null or query_source='main_turn')""",
            (sid, last["turn_id"]),
        ).fetchone()
        lt["avg_duration_ms"] = round(av[0] or 0)
        lt["avg_ttft_ms"] = round(av[1] or 0)
        turn_per_model = {}
        lt.update(_turn_rate(con.execute(
            """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id, provider_id
               from model_usage where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchall(), covers, turn_per_model))
        # v202 本轮预估费用：按轮内 model_usage 行（turn_usage 无模型维度）计价
        turn_models, turn_cost = _scope_models_cost(
            con, "session_id=? and turn_id=?", (sid, last["turn_id"]), turn_per_model)
        if turn_cost is not None:
            lt["cost_usd"] = turn_cost
        if turn_models:
            lt["models"] = turn_models   # v202：本轮 tooltip 模型明细块（与项目累计同构）
    lr = con.execute("select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()
    active = bool(lr and lr[0] and int(time.time() * 1000) - lr[0] < SESSION_TIMEOUT_MS)
    rate = _last_valid_rate(con, sid, last, covers)
    sub_rows = con.execute(
        """select m.session_id, coalesce(m.agent,''), coalesce(s2.title,''), count(*),
                  coalesce(sum(m.computed_total_tokens),0),
                  coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                  coalesce(sum(m.cache_read_input_tokens),0), coalesce(sum(m.reasoning_tokens),0),
                  coalesce(sum(m.cache_creation_input_tokens),0), max(m.completed_at), s2.time_created,
                  min(m.started_at)
           from model_usage m join session s2 on m.session_id = s2.id
           where m.query_source in ('subagent','workflow_child') and s2.parent_id=? and m.status='completed'
           group by m.session_id order by max(m.completed_at) desc""",
        (sid,),
    ).fetchall()
    # 子代理任务名：Agent 工具调用 part 的 input.description（与右侧"子智能体目录"面板同源）。
    # 主关联用官方回执：完成后 part.state.output 尾部带 "agentId: agent_xxx" 行，
    # 子会话 id 即 "sess_subagent_"+agentId（客户端自己的硬关联，无歧义）。
    # 兜底只给运行中尚未出现回执的条目：prompt 前缀匹配且候选唯一才绑（同前缀多候选宁可
    # 无名，不做时间猜测——历史 part 不带 childSessionId，时间最近邻存在错位风险）。
    sub_tasks = _sub_agent_tasks_hot(con, sid) if sub_rows else {}
    # 子代理已完成段速率（v97）：每子会话 Σ有效 output / Σ有效生成窗口的加权平均，
    # 口径与 _turn_rate 完全一致（first_token_at 缺失即无窗、含思考段窗口用 started_at）；
    # 无效段不进分母。运行中的请求未入库，这里只有已完成段。
    sub_gen = {}
    # v375 子代理逐模型速度：汇总按模型、单任务按 (子会话, 模型) 两粒度累加，
    # 数据源与 sub_gen 同（已完成 subagent/workflow_child 行），供模型明细平均速度列。
    sub_model_gen = {}
    sub_sid_model_gen = {}
    # v304 子代理级耗时/轮数聚合（子代理面板四行 KPI 第三行）：按子会话累加
    # duration/ttft 分量（avg 口径同 v300 会话：>0 样本过滤）与 Σduration（总耗时，
    # 全部 completed 行）+ distinct turn_id（请求轮数，轮=turn_id 分组）。全部在既有
    # sub_gen 扫描内顺带完成，零额外查询；旧快照缺字段消费端按 >0 门控降级。
    sub_timing = {}
    if sub_rows:
        for r in con.execute(
            """select m.session_id, m.output_tokens, m.first_token_at, m.completed_at,
                      m.started_at, m.reasoning_tokens, m.model_id, m.provider_id,
                      m.duration_ms, m.time_to_first_token_ms, m.turn_id
               from model_usage m join session s2 on m.session_id = s2.id
               where m.query_source in ('subagent','workflow_child') and s2.parent_id=? and m.status='completed'""",
            (sid,),
        ):
            g = sub_gen.setdefault(r["session_id"], [0, 0])
            tokens = r["output_tokens"] or 0
            gen_ms = _row_gen_ms(r, covers)
            if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
                g[0] += tokens
                g[1] += gen_ms
                mkey = (r["model_id"] or "").lower()
                sm = sub_model_gen.setdefault(mkey, [0, 0])
                sm[0] += tokens
                sm[1] += gen_ms
                ssm = sub_sid_model_gen.setdefault((r["session_id"], mkey), [0, 0])
                ssm[0] += tokens
                ssm[1] += gen_ms
            t = sub_timing.setdefault(r["session_id"], [0, 0, 0, 0, 0, set()])
            t[0] += r["duration_ms"] or 0
            if (r["duration_ms"] or 0) > 0:
                t[1] += r["duration_ms"]
                t[2] += 1
            if (r["time_to_first_token_ms"] or 0) > 0:
                t[3] += r["time_to_first_token_ms"]
                t[4] += 1
            t[5].add(r["turn_id"])
    now_ms = int(time.time() * 1000)
    # v304 汇总级耗时/轮数（子代理面板四行 KPI）：全部子代理行聚合（>0 样本过滤同
    # 会话口径；轮数=session+turn 组合去重求和；sessions=子会话去重数由 list 长度
    # 承载不下发）。无子代理时全 0，消费端按 >0 门控降级。
    sub_turns = sum(len(t[5]) for t in sub_timing.values())
    sub_dur_ms = sum(t[0] for t in sub_timing.values())
    sub_dur_n = sum(t[2] for t in sub_timing.values())
    sub_dur_pos = sum(t[1] for t in sub_timing.values())
    sub_ttft_n = sum(t[4] for t in sub_timing.values())
    sub_ttft_pos = sum(t[3] for t in sub_timing.values())
    sub_avg_dur = round(sub_dur_pos / sub_dur_n) if sub_dur_n else 0
    sub_avg_ttft = round(sub_ttft_pos / sub_ttft_n) if sub_ttft_n else 0
    sub_models, sub_cost = _scope_models_cost(
        con, "query_source in ('subagent','workflow_child') and session_id in (select id from session where parent_id=?)", (sid,),
        sub_model_gen)
    sub = {
        "requests": sum(r[3] for r in sub_rows),
        "total": sum(r[4] for r in sub_rows),
        "input": sum(r[5] for r in sub_rows),
        "output": sum(r[6] for r in sub_rows),
        "cache_read": sum(r[7] for r in sub_rows),
        "reasoning": sum(r[8] for r in sub_rows),
        "cache_write": sum(r[9] for r in sub_rows),
        "active": any(r[10] and now_ms - r[10] < 30000 for r in sub_rows),
        "rate_avg": _rated_tps(sum(g[0] for g in sub_gen.values()),
                               sum(g[1] for g in sub_gen.values())),
        # v304 汇总级耗时/轮数（见上方 sub_timing 聚合注释）
        "turns": sub_turns,
        "avg_duration_ms": sub_avg_dur,
        "avg_ttft_ms": sub_avg_ttft,
        "duration_ms": sub_dur_ms,
        # v202 子代理群的预估费用与模型明细（可选增强字段，缺失省略）
        **({"cost_usd": sub_cost} if sub_cost is not None else {}),
        **({"models": sub_models} if sub_models else {}),
        "list": [
            _sub_item(con, r, sub_tasks, sub_gen, sub_timing, sub_sid_model_gen)
            for r in sub_rows
        ],
    }
    # 工具调用明细（tool_usage 表，本会话按工具分组；status=running 的行不计入）
    tool_rows = con.execute(
        """select tool_name, count(*), coalesce(sum(duration_ms),0),
                  sum(case when status='error' then 1 else 0 end)
           from tool_usage where session_id=? and status in ('completed','error')
           group by tool_name order by count(*) desc, tool_name""",
        (sid,),
    ).fetchall()
    tools = {
        "total": sum(r[1] for r in tool_rows),
        "errors": sum(r[3] or 0 for r in tool_rows),
        "list": [
            {"name": r[0], "count": r[1], "duration_ms": r[2], "errors": r[3] or 0}
            for r in tool_rows
        ],
    }
    # 模型明细（v163，v164 起全量不截断）：按模型分组的 completed 用量，tooltip
    # 「会话累计/项目累计」列出；轻量行不带（_light_snapshot 无此键，与 tools 瘦身同款）。
    # v202 起同一条 GROUP BY (model_id, provider_id) 查询顺带产出预估费用。
    models, sess_cost = _session_models_cost(con, sid, sess_rate["per_model"])
    return {
        "sid": sid,
        "title": (srow["title"] if srow is not None else "") or "",
        "active": active,
        "turns": u["turns"] if u else 0,
        "requests": u["requests"] if u else 0,
        "input": u["input"] if u else 0,
        "output": u["output"] if u else 0,
        "reasoning": u["reasoning"] if u else 0,
        "cache_read": u["cache_read"] if u else 0,
        "cache_write": u["cache_write"] if u else 0,
        "total": u["total"] if u else 0,
        "tool_calls": u["tool_calls"] if u else 0,
        "retries": u["retries"] if u else 0,
        "ctx": u["last_request_input"] if u else 0,
        # v202 预估费用（USD 原值，展示层乘快照 fx 汇率；模块缺失时字段省略）
        **({"cost_usd": sess_cost} if sess_cost is not None else {}),
        "updated": (_ts(lr[0]).strftime("%H:%M:%S") if lr and lr[0] else ""),
        "started": _session_start_ms(con, sid, srow),
        "avg_tps": sess_avg,
        # v300 会话级耗时（会话累计 tooltip 第二行）：口径见上方 sess_av 注释
        "avg_duration_ms": round(sess_av[0] or 0),
        "avg_ttft_ms": round(sess_av[1] or 0),
        "duration_ms": int(sess_av[2] or 0),
        "speed_segs": _speed_segments(con, sid, covers),
        "sub": sub,
        "tools": tools,
        "models": models,
        "last_turn": lt,
        "last": {
            "duration_ms": last["duration_ms"] if last else 0,
            "ttft_ms": last[1] if last else 0,
            "model": last["model_id"] if last else "",
            # v94：当前模型归属（额度 chip 按 provider 段选数据源）。可选字段——远端
            # 旧版 zusage.py 不返回它，消费端按缺省 "" 容错（last.startedAt 同款先例）。
            "provider_id": (last["provider_id"] or "") if last else "",
            # v202 当前模型牌价（预估费用说明气泡展示用）：价目表命中条目的四价与键。
            # 可选增强字段：模块缺失/查询失败省略，消费端按缺字段隐藏该行。
            **(_model_rates(last["model_id"], last["provider_id"] or "") if last else {}),
            **rate,
        },
        # 代码变更统计（session 表 summary_* 列，ZCode 目前未填充、全库为 NULL，有值才会显示）
        "code": {
            "add": (srow["summary_additions"] if srow is not None else None),
            "del": (srow["summary_deletions"] if srow is not None else None),
            "files": (srow["summary_files"] if srow is not None else None),
        },
        # 最近一次"上下文超限被拒"的时刻（该请求 status=error，不会进 completed 统计）；
        # 晚于最近成功请求 = 仍处于超限状态，进度条亮红告警
        "ctx_exc": con.execute(
            """select coalesce(max(coalesce(completed_at, started_at)),0)
               from model_usage where session_id=? and context_exceeded=1""",
            (sid,),
        ).fetchone()[0],
        "context_window": cfg["context_window"],
        "context_auto": False,
        "last_at": con.execute(
            "select max(completed_at) from model_usage where session_id=? and status='completed'", (sid,),
        ).fetchone()[0] or 0,
        "is_sub": _is_sub_sid(sid),
        "sub_kind": _sub_kind_of(sid),   # 工作流支持（specs/workflow-support.md）：agent/workflow/空串，消费端按缺省容错
        "parent": (srow["parent_id"] if srow is not None else None),
    }


# ---------- SCNet 超算互联网（阶段 3：外部快照优先，缺失时按官方 Credits 抵扣表本地估算） ----------
# 抵扣表转写自 dsh-cost-meter（MIT，lib/coding-plans.js SCNET_CREDIT_RATES）；
# 单位 = Credits / 百万 tokens，数值可能随官方调整，执行/发版前按官方最新核对。
SCNET_CREDIT_RATES = {
    "GLM-5.2": (7543, 189, 26400), "GLM-5.1": (8743, 175, 32057), "GLM-5": (8743, 175, 32057),
    "DeepSeek-V4-Pro": (10286, 86, 20571), "DeepSeek-V4-Flash": (1200, 24, 2400),
    "DeepSeek-V4-Flash-0731": (1543, 31, 3086),
    "Kimi-K3": (34286, 343, 171429), "Kimi-K2.7-Code": (8357, 167, 34714),
    "Kimi-K2.6": (8357, 167, 34714), "Kimi-K2.5": (5143, 103, 27000),
    "MiniMax-M3": (3600, 72, 14400), "MiniMax-M2.7": (3600, 72, 14400),
    "MiniMax-M2.5": (2520, 50, 10080), "Qwen3.8-max": (18514, 231, 49371),
}


def _scnet_source_cfg():
    """quota-secrets.json 的 scnet 段（与 config.json 同目录）。未启用/未配 planCredits 返回 None。"""
    try:
        d = json.loads((Path(__file__).parent / "quota-secrets.json").read_text(encoding="utf-8"))
        src = ((d.get("sources") or {}).get("scnet") or {})
    except Exception:
        return None
    credits = src.get("planCredits")
    if src.get("enabled") is not True or not isinstance(credits, (int, float)) or credits <= 0:
        return None
    return src


def _scnet_period(src):
    """计费周期 [start_ms, end_ms)：planStart(YYYY-MM-DD) 锚日每月同日；缺省自然月。
    月末锚日（29/30/31）在短月按当月最后一天收敛（2 月不抛 ValueError、不早移周期）。"""
    import calendar
    from datetime import datetime

    tz = datetime.now().astimezone()
    anchor = None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            anchor = datetime.strptime(str(src.get("planStart") or ""), fmt)
            break
        except Exception:
            continue

    def clamp_day(year, month, day):
        return min(day, calendar.monthrange(year, month)[1])

    def add_months(year, month, n):
        idx = (year * 12 + (month - 1)) + n
        return idx // 12, idx % 12 + 1

    now_local = tz.replace(tzinfo=None)
    if anchor is None:
        y, m = now_local.year, now_local.month
        sd = 1
    else:
        sd = anchor.day
        y, m = now_local.year, now_local.month
    # 从当前月往回找：第一个"锚日（或短月收敛日）"不晚于 now 的月即周期起始月
    while True:
        d = clamp_day(y, m, sd)
        cand = datetime(y, m, d)
        if cand <= now_local or (anchor is None and m == now_local.month and y == now_local.year):
            start = cand
            break
        y, m = add_months(y, m, -1)
    ny, nm = add_months(start.year, start.month, 1)
    end = datetime(ny, nm, clamp_day(ny, nm, sd))
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _scnet_snapshot(src):
    """外部控制台额度快照：scnet_official.json（≤16KB、24h 内有效；resetsAt 缺省须落在本周期内）。"""
    path = Path(__file__).parent / "scnet_official.json"
    try:
        if path.stat().st_size > 16 * 1024:
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        used, total = d.get("used"), d.get("total")
        fetched = d.get("fetchedAt") or d.get("at")
        if not all(isinstance(v, (int, float)) and v > 0 for v in (used, total)):
            return None
        if not isinstance(fetched, (int, float)) or fetched < 1000 or time.time() * 1000 - fetched > 24 * 3600 * 1000:
            return None
        resets = d.get("resetsAt")
        if resets is None:
            s_ms, e_ms = _scnet_period(src)
            if not (s_ms <= fetched < e_ms):
                return None
        return {"used": used, "total": total, "resetsAt": resets}
    except Exception:
        return None


def _scnet_estimate(con):
    """快照优先；无快照按抵扣表 × 本地账本估算（main_turn 的 input/cacheRead/output 分费率求和）。"""
    if con is None:
        return None
    src = _scnet_source_cfg()
    if src is None:
        return None
    plan_credits = float(src["planCredits"])
    snap = _scnet_snapshot(src)
    s_ms, e_ms = _scnet_period(src)
    if snap is not None and snap["total"] > 0:
        return {"source": "snapshot", "credits_used": round(float(snap["used"]), 2),
                "plan_credits": round(float(snap["total"]), 2), "resets_at": snap["resetsAt"]}
    patterns = src.get("modelPatterns") or {}
    if not isinstance(patterns, dict) or not patterns:
        return None
    compiled = []
    for pat, key in patterns.items():
        rate = SCNET_CREDIT_RATES.get(str(key))
        if rate:
            compiled.append((re.compile(fnmatch.translate(str(pat)), re.IGNORECASE), rate))
    if not compiled:
        return None
    credits = 0.0
    try:
        rows = con.execute(
            """select model_id, coalesce(input_tokens,0), coalesce(cache_read_input_tokens,0),
                      coalesce(cache_creation_input_tokens,0), coalesce(output_tokens,0)
               from model_usage
               where status='completed' and (query_source is null or query_source='main_turn')
                 and completed_at>=? and completed_at<?""",
            (s_ms, e_ms)).fetchall()
    except Exception:
        # 聚合 SQL 失败（列漂移等）按未配置软隐藏：quota 侧 fetchOne 对缺失估算走 no_plan，
        # 不能以 0.00 额度的"全新套餐"呈现（fail-closed 口径，与额度链"绝不显示 0%"同向）。
        return None
    for model_id, tin, tcache_r, tcache_w, tout in rows:
        for rx, (r_in, r_cached, r_out) in compiled:
            if rx.match(str(model_id or "")):
                credits += ((tin + tcache_w) * r_in + tcache_r * r_cached + tout * r_out) / 1e6
                break
    return {"source": "estimate", "credits_used": round(credits, 2),
            "plan_credits": round(plan_credits, 2), "resets_at": e_ms - 1}


_EMPTY_TURN = {"requests": 0, "retries": 0, "tool_calls": 0, "tool_errors": 0, "input": 0,
               "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
               "total": 0, "duration_ms": 0, "ttft_ms": 0, "avg_duration_ms": 0, "avg_ttft_ms": 0,
               "started": 0, "ended": 0,
               "tps": 0, "rated_output": 0, "unrated_output": 0, "gen_ms": 0}


# ---------- 远端数据源：identity 路由与目标隔离 ----------

_REMOTE_NEG = {}                        # (sid, 目标键) -> [查询时刻ms, 生效TTLms]
_REMOTE_NEG_TTL_OK = 2 * 60 * 1000      # 远端确认"无此会话"后多久内不再问（远端新会话极少数竞态下最迟 2 分钟自愈）
_REMOTE_NEG_TTL_ERR = 60 * 1000         # ssh 失败/超时：短退避，尽快自愈
_REMOTE_TARGET_KEY_RE = re.compile(r"[a-z][a-z0-9]{0,31}")
_REMOTE_SID_RE = re.compile(r"[A-Za-z0-9_-]{1,80}")

_DESKTOP_SETTING_SUBPATH = (".zcode", "v2", "setting.json")
_CLIENT_STATE_CACHE = {"sig": None, "entries": []}


def _desktop_home():
    """客户端 setting.json 的 HOME 基准：dev 实例可用 ZCODE_DESKTOP_HOME_DIR 改写
    （与客户端 packages/services/src/setting 的解析顺序对齐），否则当前用户家目录。"""
    return (os.environ.get("ZCODE_DESKTOP_HOME_DIR", "").strip()
            or os.environ.get("HOME", "").strip()
            or os.environ.get("USERPROFILE", "").strip() or str(Path.home()))


def _desktop_setting_path():
    return Path(_desktop_home()).joinpath(*_DESKTOP_SETTING_SUBPATH)


def _read_client_remote_entries():
    """客户端持久化的远程工作区条目（lastWorkspaceSession，兼容旧键 remoteWorkspaceHistory）。
    带 mtime 缓存（文件每次变更整写一遍，stat 开销可忽略）；解析失败一律返回 []，只读不写。"""
    sig = None
    try:
        p = _desktop_setting_path()
        sig = (str(p), p.stat().st_mtime_ns)
    except OSError:
        pass
    if sig is None:
        _CLIENT_STATE_CACHE["sig"] = None
        _CLIENT_STATE_CACHE["entries"] = []
        return []
    if _CLIENT_STATE_CACHE["sig"] == sig:
        return _CLIENT_STATE_CACHE["entries"]
    entries = []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return []
        raw = data.get("lastWorkspaceSession")
        legacy = data.get("remoteWorkspaceHistory")
        legacy = legacy if isinstance(legacy, list) else []
        if isinstance(raw, list):
            by_id = {e.get("id"): e for e in legacy if isinstance(e, dict)}
            raw = [by_id.get(e.get("historyId"), e) if isinstance(e, dict) else e for e in raw]
        else:
            raw = legacy
        if isinstance(raw, list):
            entries = [e for e in raw if isinstance(e, dict)]
    except (OSError, ValueError):
        entries = []
    _CLIENT_STATE_CACHE["sig"] = sig
    _CLIENT_STATE_CACHE["entries"] = entries
    return entries


def _read_client_server_history():
    """3.16 起客户端把会话握手升级出的 remote:server:<serverId>:/路径 存活身份单独记在
    sourceServerWorkspaceHistory，lastWorkspaceSession 持久化的仍是传输级 legacy 身份，
    两者只共享 workspacePath。与 _read_client_remote_entries 同文件同 mtime 缓存模式；
    解析失败返回 []，只读不写。"""
    sig = None
    try:
        p = _desktop_setting_path()
        sig = (str(p), p.stat().st_mtime_ns)
    except OSError:
        pass
    if sig is None:
        _CLIENT_STATE_CACHE["server_sig"] = None
        _CLIENT_STATE_CACHE["server_hist"] = []
        return []
    if _CLIENT_STATE_CACHE.get("server_sig") == sig:
        return _CLIENT_STATE_CACHE["server_hist"]
    hist = []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        raw = data.get("sourceServerWorkspaceHistory") if isinstance(data, dict) else None
        if isinstance(raw, list):
            hist = [e for e in raw if isinstance(e, dict)]
    except (OSError, ValueError):
        hist = []
    _CLIENT_STATE_CACHE["server_sig"] = sig
    _CLIENT_STATE_CACHE["server_hist"] = hist
    return hist


def _server_idents_by_path():
    """归一路径 → 握手升级身份列表。只采 remote:server: 前缀且带 sourceServerId 的条目；
    同一路径混入多个 sourceServerId 时无法唯一归属服务器，整路径放弃（fail-closed）。"""
    by_path, owners = {}, {}
    for e in _read_client_server_history():
        ident = str(e.get("workspaceIdentity") or "").strip()
        server = str(e.get("sourceServerId") or "").strip()
        if not ident.startswith("remote:server:") or not server:
            continue
        # 缺 workspacePath 的条目无法按路径与传输条目关联（客户端字段 optional），
        # 跳过，避免与同样缺路径的传输条目在归一 "/" 上跨条目碰撞。
        if not str(e.get("workspacePath") or "").strip():
            continue
        path = _normalize_identity_path(e.get("workspacePath"))
        idents = by_path.setdefault(path, [])
        if ident not in idents:
            idents.append(ident)
        owners.setdefault(path, set()).add(server)
    return {p: idents for p, idents in by_path.items() if len(owners[p]) == 1}


def _normalize_identity_path(p):
    """客户端 normalizeWorkspacePathForIdentity 同款：反斜杠归一、折叠重复斜杠、去尾补头。"""
    s = str(p or "").replace("\\", "/")
    while "//" in s:
        s = s.replace("//", "/")
    s = s.rstrip("/") or "/"
    return s if s.startswith("/") else "/" + s


def _ssh_identity(host, port, username, path):
    """客户端 workspaceIdentity 构造算法（remote-workspace-identity.ts）的 Python 版：
    remote:ssh:<host小写>:<port>:<username>:<归一路径>。重连换代（remoteSessionId 变）不影响它，
    是 sid→目标路由的稳定键。"""
    try:
        port = int(port or 22)
    except (TypeError, ValueError):
        port = 22
    return "remote:ssh:{}:{}:{}:{}".format(
        str(host).strip().lower(), port, str(username).strip(), _normalize_identity_path(path))


def _wsl_identity(distro, user, path):
    """客户端 buildRemoteWorkspaceIdentity wsl 分支同款：
    remote:wsl:<distro>[:<user>]:<归一路径>。user 段可选（旧版客户端无 user 格式，靠
    路径必以 / 开头区分）；v3.16 起握手后客户端会把会话身份升级为 remote:server:，
    但持久化条目里拿到的就是当时身份，优先原样采用，这里只兜底构造。
    客户端固有歧义：缺省 distro 与字面 "default" 构造出同一身份（bss 的 ||"default"），
    两者对应不同通道时路由随条目顺序漂移，客户端自身无法区分，接受。"""
    d = str(distro or "").strip() or "default"
    u = str(user or "").strip()
    if u:
        return "remote:wsl:{}:{}:{}".format(d, u, _normalize_identity_path(path))
    return "remote:wsl:{}:{}".format(d, _normalize_identity_path(path))


def _docker_identity(container, path):
    """客户端 buildRemoteWorkspaceIdentity docker 分支同款：remote:docker:<container>:<归一路径>。"""
    return "remote:docker:{}:{}".format(str(container or "").strip(), _normalize_identity_path(path))


def _auto_targets(cfg):
    """客户端 setting.json → 自动远端目标列表。auto:false 或递归子查询（ZUSAGE_REMOTE_CHILD=1）
    时返回 []。ssh 按连接（别名/密钥+主机+端口+用户）合并；wsl 按（发行版+用户）、docker 按
    容器合并为一条通道，多工作区聚合 identities；纯密码凭据（passwordCredentialKey 且无密钥/
    别名）的 ssh 无法免交互，跳过。workspaceIdentity 一律原样采用（客户端会透传到 DOM/IPC，
    路由按整串相等），缺失时才按同款算法兜底构造。server 类型没有免交互 exec 通道，不生成。
    3.16 起存活会话身份握手后升级为 remote:server:<serverId>:/路径，记在
    sourceServerWorkspaceHistory，与 lastWorkspaceSession 只共享 workspacePath：按归一路径
    把 server 身份并进路径匹配的传输通道，使 3.15/3.16 两种身份形态都能路由；同一路径命中
    多条通道或多个服务器视为歧义，不并（fail-closed）。"""
    r = cfg.get("remote")
    if isinstance(r, dict) and r.get("auto") is False:
        return []
    if os.environ.get("ZUSAGE_REMOTE_CHILD") == "1":
        return []
    # wsl --exec / docker exec 不经登录 shell，进程 CWD 不可靠，自动通道的默认脚本
    # 必须带 ~ 前缀（exec 端 runpy bootstrap 展开）；用户显式 remote.script 优先。
    explicit_script = isinstance(r, dict) and bool(r.get("script"))
    server_idents = _server_idents_by_path()
    path_channels = {}
    merged = {}
    for e in _read_client_remote_entries():
        t = e.get("target")
        if not isinstance(t, dict):
            continue
        ident = str(e.get("workspaceIdentity") or "").strip()
        kind = t.get("kind")
        if kind == "ssh":
            host = str(t.get("host") or "").strip()
            username = str(t.get("username") or "").strip()
            if not host or not username:
                continue
            alias = str(t.get("sshConfigAlias") or "").strip()
            key_path = str(t.get("privateKeyPath") or "").strip()
            if not alias and not key_path and t.get("passwordCredentialKey"):
                continue   # 密码认证拿不到明文，ssh 也无法免交互
            try:
                port = int(t.get("port") or 22)
            except (TypeError, ValueError):
                port = 22
            ident = ident or _ssh_identity(host, port, username, e.get("workspacePath"))
            ck = (kind, alias, host.lower(), port, username, key_path)
            ent = merged.get(ck)
            if ent is None:
                argv = ["ssh", "-o", "BatchMode=yes"]
                if alias:
                    argv.append(alias)   # 别名交给用户 ssh_config 解析 host/port/密钥
                else:
                    if port != 22:
                        argv += ["-p", str(port)]
                    if key_path:
                        argv += ["-i", key_path, "-o", "IdentitiesOnly=yes"]
                    argv.append(f"{username}@{host}")
                ent = {"ssh_argv": argv, "host_label": alias or host, "identities": []}
                merged[ck] = ent
        elif kind == "wsl":
            distro = str(t.get("distro") or "").strip()
            user = str(t.get("user") or "").strip()
            ident = ident or _wsl_identity(distro, user, e.get("workspacePath"))
            # distro 匹配大小写不敏感能并通道；user 是 Linux 用户名、大小写敏感不能并。
            ck = (kind, distro.lower(), user)
            ent = merged.get(ck)
            if ent is None:
                # --exec 对齐客户端 v3.16.1 buildWslArgs：绕过发行版默认 shell 的
                # 变量/管道展开，argv（含 runpy bootstrap 的分号引号）原样到达；
                # -d/-u 仅在真值时附加（distro 缺省走默认发行版，客户端同款）。
                argv = ["wsl.exe"]
                if distro:
                    argv += ["-d", distro]
                if user:
                    argv += ["-u", user]
                argv.append("--exec")
                ent = {"ssh_argv": argv, "host_label": f"wsl:{distro or 'default'}", "identities": []}
                if not explicit_script:
                    ent["script"] = "~/.zcode/zcode-token-usage-statusbar/zusage.py"
                merged[ck] = ent
        elif kind == "docker":
            container = str(t.get("container") or "").strip()
            if not container:
                continue
            ident = ident or _docker_identity(container, e.get("workspacePath"))
            # Docker 容器名大小写敏感（与 ssh host 不同），原样作键避免不同容器误并。
            ck = (kind, container)
            ent = merged.get(ck)
            if ent is None:
                ent = {"ssh_argv": ["docker", "exec", "-i", container],
                       "host_label": f"docker:{container}", "identities": []}
                if not explicit_script:
                    ent["script"] = "~/.zcode/zcode-token-usage-statusbar/zusage.py"
                merged[ck] = ent
        else:
            continue
        if ident not in ent["identities"]:
            ent["identities"].append(ident)
        path_key = _normalize_identity_path(e.get("workspacePath"))
        if path_key in server_idents:
            # 先只登记路径→通道归属，循环结束后统一并入：同一路径命中多条通道
            # 时无法唯一归属，整路径放弃（fail-closed），不按条目顺序猜首条。
            path_channels.setdefault(path_key, set()).add(ck)
    for path_key, cks in path_channels.items():
        if len(cks) != 1:
            continue
        ent = merged[next(iter(cks))]
        for idn in server_idents[path_key]:
            if idn not in ent["identities"]:
                ent["identities"].append(idn)
    return sorted(merged.values(), key=lambda x: (x["host_label"], x["identities"]))


def _normalize_remote_entry(ent):
    """单目标条目 → 归一化 rcfg 或 None。字段同旧 _remote_cfg，另收 identities[]（路由键）。"""
    if not isinstance(ent, dict):
        return None
    ssh = ent.get("ssh")
    if ssh is None:
        ssh = ent.get("ssh_argv") or []
    if isinstance(ssh, list):
        ssh_argv = [str(x) for x in ssh]
    else:
        try:
            ssh_argv = shlex.split(str(ssh))
        except ValueError:
            ssh_argv = str(ssh).split()
    if not ssh_argv:
        return None
    idents = ent.get("identities")
    if not isinstance(idents, list):
        idents = [ent.get("identity")] if ent.get("identity") else []
    return {
        "ssh_argv": ssh_argv,
        "script": str(ent.get("script") or ".zcode/zcode-token-usage-statusbar/zusage.py"),
        "python": str(ent.get("python") or "python3"),
        "timeout_s": min(6.0, max(1.0, float(ent.get("timeout_s") or 6))),
        "host_label": str(ent.get("host_label") or (ssh_argv[-1] if len(ssh_argv) > 1 else "remote")),
        "identities": [str(x).strip() for x in idents if str(x).strip()],
    }


def _remote_setup(cfg):
    """自动目标只接受 identity 路由；enabled:true 保留旧单通道兜底。"""
    if os.environ.get("ZUSAGE_REMOTE_CHILD") == "1":
        return None
    r = cfg.get("remote")
    r = r if isinstance(r, dict) else {}
    if r.get("auto") is False and r.get("enabled") is not True:
        return None
    targets, identities = {}, {}
    default = None

    def add(ent):
        defaults = {k: r[k] for k in ("script", "python", "timeout_s") if k in r}
        try:
            rc = _normalize_remote_entry({**defaults, **ent})
        except (TypeError, ValueError):
            return None
        if not rc:
            return None
        fingerprint = json.dumps([rc["ssh_argv"], rc["python"], rc["script"]], ensure_ascii=True)
        key = "t" + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        if key in targets:
            rc["identities"] = list(dict.fromkeys(targets[key]["identities"] + rc["identities"]))
        targets[key] = rc
        for ident in rc["identities"]:
            identities[ident] = key
        return key

    if r.get("auto") is not False:
        for ent in _auto_targets(cfg):
            add(ent)
    # 后加入的手动 identity 覆盖自动连接参数，不依赖目标列表顺序。
    for ent in (r.get("targets") or []):
        if isinstance(ent, dict):
            key = add(ent)
            if r.get("enabled") is True and default is None:
                default = key
    if r.get("enabled") is True and r.get("ssh"):
        default = add({"ssh": r["ssh"], "identities": [], "host_label": r.get("host_label")})
    if not targets:
        return None
    return {"targets": targets, "default": default, "identities": identities,
            "auto": r.get("auto") is not False}


def _parse_routes(s):
    """路由段 'sid@key,sid2@key2' → {sid: key}。逐 token 白名单校验（泵侧同款），脏 token 忽略。"""
    routes = {}
    for tok in str(s or "").split(","):
        if "@" not in tok:
            continue
        sid, key = tok.split("@", 1)
        sid, key = sid.strip(), key.strip()
        if _REMOTE_SID_RE.fullmatch(sid) and _REMOTE_TARGET_KEY_RE.fullmatch(key):
            routes[sid] = key
    return routes


def _parse_query(line):
    """兼容旧逗号协议与携带 workspaceIdentity 的 JSON 请求。"""
    if line.lstrip().startswith("{"):
        data = json.loads(line)
        if not isinstance(data, dict):
            raise ValueError("query must be an object")
        sids = data.get("sids") or []
        if not isinstance(sids, list):
            raise ValueError("sids must be an array")
        return ",".join(str(s) for s in sids), data.get("scopes") or []
    if "|" in line:
        sids, rstr = line.split("|", 1)
        return sids.strip(), _parse_routes(rstr)
    return line.strip(), {}


def _query_lean(line):
    """请求内 lean 开关（手机中继）：只接受 JSON 对象内显式布尔 true。

    手机 projection 不消费 speed_history/all_projects 两个 ~200KB 桌面增强字段，
    请求体带 lean:true 时 serve 与一次性 json 都跳过计算与传输。单独解析而不改
    _parse_query 的二元组签名（远端/测试按其返回形状断言）；也**不**复用
    ZUSAGE_REMOTE_CHILD=1——该环境变量承担远端 scope 子查询语义，混用会破坏远端查询。
    """
    line = (line or "").lstrip()
    if not line.startswith("{"):
        return False
    try:
        data = json.loads(line)
    except ValueError:
        return False
    return isinstance(data, dict) and data.get("lean") is True


def _remote_exec(sids, rcfg, key):
    """执行通道返回 (by_sid, today, error)，远端子查询禁止再次访问远端。"""
    argv = ["env", "ZUSAGE_REMOTE_CHILD=1", rcfg["python"], rcfg["script"], "json", ",".join(sids)]
    channel = rcfg["ssh_argv"]
    if Path(channel[0]).stem.lower() == "ssh":
        # OpenSSH 将参数重新拼成 shell 文本，必须在远端边界引用，而非依赖本地 argv。
        def quote(arg):
            if arg.startswith("~/"):
                return '"$HOME"/' + shlex.quote(arg[2:])
            return shlex.quote(arg)
        cmd = channel + [" ".join(quote(arg) for arg in argv)]
    else:
        # docker/wsl/kubectl 的 exec 接口直接接收 argv，不解析 shell assignment。
        script = rcfg["script"]
        if script.startswith("~/"):
            bootstrap = "import os,runpy,sys;p=os.path.expanduser(sys.argv[1]);sys.argv=sys.argv[1:];runpy.run_path(p,run_name='__main__')"
            argv = ["env", "ZUSAGE_REMOTE_CHILD=1", rcfg["python"], "-c", bootstrap, script, "json", ",".join(sids)]
        cmd = channel + argv
    err = None
    payload = None
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=rcfg["timeout_s"],
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))   # issue #227：无控制台宿主里 ssh 会新分配可见控制台；POSIX 取 0 与不传等价
        out = p.stdout.decode("utf-8", "replace")
        if p.returncode != 0:
            err = f"ssh rc={p.returncode}: {p.stderr.decode('utf-8', 'replace').strip()[:160]}"
        else:
            # 取最后一行能解析的 JSON 对象：容忍远端登录 banner 混进 stdout
            for line in reversed(out.splitlines()):
                line = line.strip()
                if line.startswith("{"):
                    try:
                        payload = json.loads(line)
                        break
                    except ValueError:
                        continue
            if payload is None:
                err = "remote returned no JSON payload"
    except subprocess.TimeoutExpired:
        err = f"ssh timeout after {rcfg['timeout_s']:g}s"
    except OSError as e:
        err = f"ssh spawn failed: {e}"
    if payload is None:
        return {}, None, err or "remote query failed"
    if payload.get("error") or payload.get("local_error"):
        return {}, None, "remote query failed: " + str(payload.get("error") or payload["local_error"])[:160]
    # known_sids = 远端库里真实存在的 force 会话（session 行或任一 usage 行）。
    # 远端对未知 sid 也会产出零值快照，不按它过滤的话"确无此会话"永远判不了，
    # 负缓存失效 → 本地新会话每轮都白跑一次 ssh。缺 known_sids 字段 = 远端是旧版
    # 脚本：退化为按活跃度识别（零值快照 requests/last_at 恒为 0）。
    known = payload.get("known_sids")
    legacy = not isinstance(known, list)
    known = set(known or [])
    by = {}
    for rec in payload.get("recent") or []:
        if not isinstance(rec, dict) or rec.get("sid") not in sids:
            continue
        # 远端旧版脚本（无 known_sids）退化为按活跃度识别：零值快照 requests/last_at 恒为 0
        found = (rec["sid"] in known) if not legacy else (
            (rec.get("requests") or 0) > 0 or (rec.get("last_at") or 0) > 0)
        if found:
            rec["remote"] = True
            rec["remote_host"] = rcfg["host_label"]
            rec["remote_target"] = key
            by[rec["sid"]] = rec
    return by, payload.get("today"), err


def _remote_fetch(force_sids, have_local, setup, routes=None, scopes=None):
    """按 identity 查目标；旧请求仅手动默认兜底，负缓存按 (sid, target) 隔离。"""
    now_ms = int(time.time() * 1000)
    routes = routes or {}
    default = setup.get("default")

    def resolve(s):
        key = routes.get(s)
        return key if key in setup["targets"] else default   # 未知/过期目标键回退默认通道

    missing = []
    for s in force_sids:
        if s in have_local:
            continue
        ent = _REMOTE_NEG.get((s, resolve(s)))
        if ent and now_ms - ent[0] < ent[1]:
            continue
        missing.append(s)
    if not missing and scopes is None:
        # None 键（目标未解析）不进错误表：json.dumps 会把 None 键序列化成 "null"，
        # overlay 按目标键匹配错误条目时挂错归属。
        errs = {resolve(s): _REMOTE_NEG[(s, resolve(s))][2] for s in force_sids
                if resolve(s) is not None and (s, resolve(s)) in _REMOTE_NEG
                and len(_REMOTE_NEG[(s, resolve(s))]) > 2
                and _REMOTE_NEG[(s, resolve(s))][2]}
        return {}, {}, errs
    groups = {}
    scoped_keys = {}
    if scopes is not None:
        for sid, ident in scopes:
            if not ident.startswith("remote:"):
                continue
            key = setup["identities"].get(ident)
            scoped_keys[(sid, ident)] = key
            if key and (not _REMOTE_NEG.get((sid, key)) or
                        now_ms - _REMOTE_NEG[(sid, key)][0] >= _REMOTE_NEG[(sid, key)][1]):
                bucket = groups.setdefault(key, [])
                if sid not in bucket:
                    bucket.append(sid)
    else:
        for s in missing:
            key = resolve(s)
            if key in setup["targets"]:
                groups.setdefault(key, []).append(s)
    by, today, errs = {}, {}, {}
    per_target = {}
    selected = {(sid, key) for (sid, _), key in scoped_keys.items()} if scopes is not None else {
        (sid, resolve(sid)) for sid in force_sids}
    for sid, key in selected:
        cached = _REMOTE_NEG.get((sid, key))
        if key is not None and cached and now_ms - cached[0] < cached[1] and len(cached) > 2 and cached[2]:
            errs[key] = cached[2]
    # 各目标独立执行；总预算6秒，排队目标不再启动，避免超过桌面15秒看门狗。
    deadline = time.monotonic() + 6.0
    def bounded_query(item):
        key, sids = item
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return key, sids, ({}, None, "remote query budget exhausted")
        rc = dict(setup["targets"][key], timeout_s=min(setup["targets"][key]["timeout_s"], remaining))
        try:
            result = _remote_exec(sids, rc, key)
        except Exception as exc:
            result = ({}, None, "remote query failed: " + str(exc)[:160])
        return key, sids, result

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(bounded_query, groups.items()))
    for key, sids, (by_sid, t, err) in results:
        per_target[key] = by_sid
        by.update(by_sid)
        if isinstance(t, dict):
            today[key] = t
        if err and key is not None:
            errs[key] = err
        for s in sids:
            if s in by_sid:
                _REMOTE_NEG.pop((s, key), None)
            else:
                _REMOTE_NEG[(s, key)] = (int(time.time() * 1000), _REMOTE_NEG_TTL_ERR if err else _REMOTE_NEG_TTL_OK, err)
    if scopes is not None:
        by = {}
        for (sid, ident), key in scoped_keys.items():
            rec = dict(per_target.get(key, {}).get(sid) or {})
            rec.update(sid=sid, workspace_identity=ident, remote=True,
                       remote_target=key or "", remote_host=setup["targets"].get(key, {}).get("host_label", ""))
            if not per_target.get(key, {}).get(sid):
                error = (errs.get(key) or "remote session not found") if key else "remote target not configured"
                rec.update(remote_missing=True, remote_error=error)
            by[(sid, ident)] = rec
    if len(_REMOTE_NEG) > 512:
        _REMOTE_NEG.clear()   # 防长驻膨胀（多目标下键数翻倍，上限同步放宽）
    return by, today, errs


def _empty_snapshot(sid, cfg):
    return {"sid": sid, "title": "", "active": False, "turns": 0, "requests": 0,
            "input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
            "total": 0, "tool_calls": 0, "retries": 0, "ctx": 0, "updated": "", "last_at": 0, "started": 0, "avg_tps": 0,
            "speed_segs": [],
            "last_turn": dict(_EMPTY_TURN), "last": {"duration_ms": 0, "ttft_ms": 0, "model": "", "tps": 0, "startedAt": 0, "endedAt": 0},
            "code": {"add": None, "del": None, "files": None}, "ctx_exc": 0,
            "tools": {"total": 0, "errors": 0, "list": []},
            "sub": {"requests": 0, "total": 0, "input": 0, "output": 0, "cache_read": 0,
                    "reasoning": 0, "cache_write": 0, "active": False, "rate_avg": 0, "list": []},
            "context_window": cfg["context_window"], "context_auto": False}


def _provider_fallback(con):
    """额度 chip 的会话无历史回退（见 snapshot 内注释）；旧库列漂移时按空串降级。
    规则 14：全表 order by completed_at desc 每帧必跑，挂 _cached_agg（2s TTL + 水位）。
    键必须带库身份：同进程内可能先后查不同库（测试夹具/远端），裸键会跨库串值。"""
    if con is None:
        return ""
    dbkey = _db_cache_key(con)
    if dbkey is None:
        return _provider_fallback_uncached(con)
    return _cached_agg(("provfbk", dbkey), _WmFn(lambda: _provider_fallback_uncached(con), con))


def _provider_fallback_uncached(con):
    try:
        row = con.execute(
            """select provider_id from model_usage
               where status='completed' and (query_source is null or query_source='main_turn')
                 and provider_id like 'account:%'
               order by completed_at desc limit 1""").fetchone()
    except sqlite3.Error:
        return ""
    return (row or ("",))[0] or ""


def snapshot(force_sid="", routes=None, serve_con=None, include_speed_history=False,
             include_all_projects=False, include_speed_days=False):
    """单次快照：最新会话 + 最近 6+6 会话池 + 今日。
    force_sid：各窗口当前会话 id，逗号分隔（泵按窗口汇总上报：主进程 IPC 映射的焦点会话 +
    overlay localStorage 键兜底），全部强制纳入快照——不在 6+6 池里的会话（新开的、久远的）
    也能被各窗口找到自己的会话并显示（v32 起；v34 改为多窗口多 sid）。
    routes：sid→目标键（泵按窗口 workspaceIdentity 路由）；未路由会话走默认目标。
    serve_con：serve 常驻进程传入的复用连接（None = 自建自关，CLI/json 一次性路径）。
    include_speed_history：桌面快照链（serve 常驻 + legacySpawn 一次性 json）显式开启，
    产出 v254 速度 Tooltip 统一轮表；CLI 报表 / MCP / 远端子查询 / zusage json 默认不带
    这份 ~200KB 增强字段，保持各自 stdout 契约。
    include_all_projects（v331）：同门控产出全部项目聚合（specs/all-projects-usage.md，
    挂顶层 all_projects，~6KB 量级）；任何 sqlite3.Error/列漂移省略字段不拖垮整帧。
    include_speed_days（v384，specs/speed-tooltip-v3.md §1.2）：同门控产出全历史按日聚合
    日桶帧（挂顶层 speed_days，≤550 日；550 日×8 模型满桶实测 ~105-120KB，与数值位数相关）；开关点与 include_speed_history
    完全一致，失败降级 None 不拖垮整帧。
    连接所有权归调用方：serve 模式下查询期出错会就地 close（调用方下次探活重建），
    finally 不重复关闭。"""
    cfg = load_config()
    # 价表配置要在宿主分流之前：WorkBuddy 分支会提前 return，放后面会让它的快照
    # 读不到 pricing-cache.json（汇率与运行时更新的牌价都落在这个文件里）。
    if _pricing is not None:
        try:
            _pricing.configure(cfg)   # 定位 pricing-cache.json（config.json 同目录优先）
        except Exception:
            pass
    if resolve_host(cfg=cfg) == HOST_WORKBUDDY:
        # WorkBuddy：上下文来自 session_usage，逐请求指标来自会话正文（见 wb_snapshot）；
        # 结构见 host_caps —— 缺什么就声明不可用，不伪造 0 值
        return wb_snapshot(force_sid, cfg=cfg, serve_con=serve_con)
    scopes = None
    if isinstance(routes, list):
        scopes = []
        for scope in routes:
            if not isinstance(scope, dict):
                continue
            sid, ident = str(scope.get("sid") or ""), str(scope.get("workspaceIdentity") or "").strip()
            if _REMOTE_SID_RE.fullmatch(sid) and ident and (sid, ident) not in scopes:
                scopes.append((sid, ident))
        force_sid = ",".join([str(force_sid)] + [s for s, _ in scopes])
        routes = {}
    con = serve_con
    owns_con = serve_con is None
    local_error = None
    try:
        if owns_con:
            con = connect()
    except sqlite3.Error as exc:
        local_error = str(exc)[:200]
    try:
        force_sids = []
        for fs in str(force_sid).split(","):
            fs = fs.strip()
            if fs and re.fullmatch(r"[A-Za-z0-9_-]+", fs) and fs not in force_sids:
                force_sids.append(fs)
        try:
            day = _day_start()
            start_ms, end_ms = _epoch_ms(day), _epoch_ms(day + timedelta(days=1))
            today = _cached_agg(("today", start_ms), _WmFn(lambda: _today_usage(
                con, start_ms, end_ms), con)) if con else (0,) * 16
            # v301 今日平均输出速度 + v375 逐模型速度 + v202 费用/明细：合并为单一缓存条目。
            # 速度口径=_turn_rate（_row_gen_ms 生成窗口 + 200ms–1h 有效段过滤；子代理/
            # 辅助行不计），与会话均 avg_tps 同源不同范围；per_model 在同遍循环累加，
            # 挂到模型明细「平均速度」列，KPI 与模型明细读同一份，零新增扫描。
            # 缓存仍经 _WmFn 带连接（水位续用不失效）；任何失败（含最小桩连接无 fetchall）
            # 速度降 0、明细降空，消费端 >0 门控显「—」，不拖垮整帧（同 project/cost 口径）。
            def _today_detail():
                per_model = {}
                try:
                    rate = _turn_rate(con.execute(
                        """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id, provider_id
                           from model_usage where status='completed' and completed_at between ? and ?
                             and (query_source is null or query_source='main_turn')""",
                        (start_ms, end_ms),
                    ).fetchall(), _provider_first_token_covers(con), per_model)["tps"]
                except Exception:
                    rate = 0
                models, cost = _scope_models_cost(
                    con, "completed_at between ? and ?", (start_ms, end_ms), per_model)
                return {"cost": cost, "models": models if models else [], "tps": rate}
            try:
                today_detail = _cached_agg(("todaydetail", start_ms), _WmFn(_today_detail, con)) if con else None
            except Exception:
                today_detail = None
            today_rate = today_detail["tps"] if today_detail else 0
            today_cost = today_detail["cost"] if today_detail else None
            rows = _scan_session_ids(con) if con else []
            have_local = set()
            if con and force_sids:
                qmarks = ",".join("?" * len(force_sids))
                have_local = {r[0] for r in con.execute(
                    f"select id from session where id in ({qmarks})", force_sids)}
                have_local |= {r[0] for r in con.execute(
                    f"select distinct session_id from model_usage where session_id in ({qmarks})", force_sids)}
        except sqlite3.Error as exc:
            local_error = str(exc)[:200]
            con.close()
            con = None
            today, rows, have_local, today_rate = (0,) * 16, [], set(), 0
        known_sids = [s for s in force_sids if s in have_local]
        # 远端补齐（v12）：本地不存在的 force 会话按路由分组查各自远端库
        setup = _remote_setup(cfg)
        remote_by, remote_today, remote_errs = {}, {}, {}
        if force_sids and (setup or scopes is not None):
            remote_by, remote_today, remote_errs = _remote_fetch(
                force_sids, have_local, setup or {"targets": {}, "identities": {}, "default": None}, routes, scopes)
        remote_err = next(iter(remote_errs.values()), None)   # 兼容旧单错误字段（第一个目标）
        # 本地库里没有的 force 会话（远端/他机会话，或数据还没落库）。渲染端据此给提示：
        # 零值不再只能靠用户猜"插件坏了"（issue #14），也区分"远端也没查到"（issue #10）。
        not_local = [s for s in force_sids if s not in have_local] if force_sids else []
        def local_snapshot(sid, light=False):
            nonlocal local_error
            if con is None:
                return _empty_snapshot(sid, cfg)
            try:
                return (_light_snapshot if light else _session_snapshot)(con, sid, cfg)
            except sqlite3.Error as exc:
                # 本地明细表缺失不能丢弃已成功的远端分片，失败行单独降级。
                local_error = str(exc)[:200]
                return _empty_snapshot(sid, cfg)

        # 工作流 actor 会话（sess_dwf-*）不进 latest 候选：run 进行中多个 actor 轮流活跃，
        # 全库 max(completed_at) 几乎恒被它们占据，顶层 session/CLI current 会被顶成 run
        # 视角（specs/workflow-support.md）。普通子代理（sess_subagent_*）保持既有候选语义。
        ranked = sorted((r for r in rows if not _is_sub_kind_workflow(r[0])),
                        key=lambda r: -r[1])
        latest_sid = ranked[0][0] if ranked else None
        base = local_snapshot(latest_sid) if latest_sid else _empty_snapshot("", cfg)
        # 池分桶：normal 恒为主会话独占（子代理放进来会挤占主会话 top-6 甚至把主会话
        # 挤出完整快照层——issue #22 症状面）；sess_dwf 与普通子代理同入子代理桶。
        normal = [r for r in ranked if not _is_sub_sid(r[0])][:6]
        suba = sorted((r for r in rows if _is_sub_sid(r[0])),
                      key=lambda r: -r[1])[:6]
        ids = [r[0] for r in normal] + [r[0] for r in suba]
        seen = set()
        ids = [x for x in ids if not (x in seen or seen.add(x))]
        if latest_sid and latest_sid not in ids:
            ids.insert(0, latest_sid)
        # 远端命中的会话不进本地 ids 循环（本地 _session_snapshot 查不到只会产出零值行）
        remote_ids = [s for s in force_sids if s in remote_by]
        for fs in reversed(force_sids):
            if fs not in ids and fs not in remote_ids:
                ids.insert(0, fs)
        # recent 池瘦身（v8）：状态条只渲染 1 个会话，完整快照只给兜底候选
        # （force + latest + 最近活跃前 2），其余长尾行走轻量查询（单会话 38ms→2ms）。
        # force 会话按 sid 判定恒为完整快照，不能只看池内位置：force 会话若本来就排在
        # 最近池里（插入被跳过、原位保留），按 i < full_n 分层会把它误降级成轻量行——
        # last_turn/last/tools.list 全空，正是上游 issue #22「只显示总 token、其余全空」
        # 的成因；远端会话走同一条 json 子命令，同样中招。
        force_set = set(force_sids)
        full_n = len(force_sids) + 3
        rec = []
        for i, sid in enumerate(ids):
            if sid == latest_sid:
                rec.append(base)
            else:
                rec.append(local_snapshot(sid, light=i >= full_n and sid not in force_set))
        # 项目累计（v159）：为池内本地行注入所属项目全部会话的聚合，overlay 在
        # 「会话累计」右侧渲染「项目累计」格。latest 行与顶层 base 是同一对象，
        # 顶层 session 键自动获得；scopes 插入的本地行经 {...row} 展开同样携带。
        # 可选增强字段：任何失败按无字段降级，不拖垮整帧（同 provider_fallback 口径）。
        if con is not None:
            proj_cache = {}
            for row in rec:
                psid = row.get("sid")
                if not psid or row.get("remote") or "project" in row:
                    continue
                if psid not in proj_cache:
                    try:
                        # 模型明细跟随行粒度：轻量行不带（与 _light_snapshot 无 models 键同款）
                        proj_cache[psid] = _project_usage(con, psid, with_models="models" in row)
                    except sqlite3.Error:
                        proj_cache[psid] = None
                if proj_cache[psid]:
                    row["project"] = proj_cache[psid]
        # rec 建好后把远端快照挂到池首：overlay 按 sid 匹配 mine，顺序只影响兜底展示
        rec = ([remote_by[s] for s in reversed(remote_ids)] + rec) if scopes is None else (
            [{**_empty_snapshot(sid, cfg), **row} for (sid, _), row in remote_by.items()] + rec)
        if scopes is not None:
            local_rows = {row["sid"]: row for row in rec if not row.get("remote")}
            for sid, ident in scopes:
                if not ident.startswith("remote:"):
                    rec.insert(0, {**local_rows.get(sid, _empty_snapshot(sid, cfg)), "workspace_identity": ident})
        # v331 全部项目聚合（specs/all-projects-usage.md）：桌面快照链显式开启；
        # 失败按无字段降级，不拖垮整帧（与 provider_fallback 同款口径）
        all_proj = _all_projects_usage_safe(con) if include_all_projects else None
        return {
            # 宿主与能力声明（v241）：消费端据此选择可用指标，不再靠字段缺失猜数据源；
            # 旧消费端忽略未知键，不影响既有渲染。
            "host": HOST_ZCODE,
            "caps": host_caps(HOST_ZCODE),
            "local_error": local_error,
            "session": base,
            "last_turn": base["last_turn"],
            "last": base["last"],
            "today": {
                "requests": today[0], "input": today[1], "output": today[2],
                "cache_read": today[3], "total": today[4],
                "reasoning": today[6], "retries": today[7], "cache_write": today[8],
                "started": today[9] or 0, "last_at": today[10] or 0,
                # v298.1：今日轮数（turn_id 去重）；旧测试桩/远端行元组可能只有 11 列，长度守卫
                "turns": (today[11] or 0) if len(today) > 11 else 0,
                # v301 今日级平均耗时/平均延迟（_today_usage 附加列，长度守卫兼容旧元组）
                # 与今日加权平均输出速度（消费端均按 >0 门控，缺字段诚实降级不伪造）
                "avg_duration_ms": round(today[12] or 0) if len(today) > 12 else 0,
                "avg_ttft_ms": round(today[13] or 0) if len(today) > 13 else 0,
                "avg_tps": today_rate,
                # v302.2 今日请求规模行：今日去重会话数 + Σ生成耗时（总耗时，真实生成时间非墙钟）
                "sessions": (today[14] or 0) if len(today) > 14 else 0,
                "duration_ms": int(today[5] or 0),
                # v302.3 今日模型明细标题行右侧：Σ工具调用（重试已在 today[7]）
                "tool_calls": (today[15] or 0) if len(today) > 15 else 0,
                # v202 预估费用+模型明细（可选增强字段；价表模块缺失时省略）
                **({"cost_usd": today_cost} if today_cost is not None else {}),
                **({"models": today_detail["models"]} if today_detail and today_detail["models"] else {}),
            },
            # 远端数据源（v12）：显示远端会话时 overlay 按其 remote_target 取对应主机的今日值；
            # dict 键=目标键。remote_error 保留首个错误（旧字段），remote_errors 按目标细分。
            "remote_today": remote_today,
            "remote_error": remote_err,
            "remote_errors": remote_errs,
            # 目标清单（泵路由用）：identity → 键；host_label 供日志/诊断
            "remote_targets": [
                {"key": k, "host_label": rc["host_label"], "identities": rc["identities"]}
                for k, rc in (setup or {}).get("targets", {}).items()
            ],
            "not_local": not_local,               # 不在本地库的 force 会话 id（issue #14 提示用）
            # v96 额度 chip 的会话无历史回退：全局最近一个完成的套餐档请求（账号级数据，
            # 与会话无关）。会话自身没有任何请求历史（新会话/刚切模型还没发请求）时，
            # 渲染端用它跟随账号当前套餐档，消除"切模型到首个请求完成之间 chip 空窗"。
            # 只取 account:*（内置套餐档）；最近请求是自定义 provider 时为空串，不回退。
            # 可选回退字段不拖垮整帧：旧库缺列时按未配置降级（与单会话降级同款口径）。
            "provider_fallback": _provider_fallback(con),
            # SCNet 账本估算（无凭据）：主进程注入 quota-client 的 scnet 源；未配置为 None
            "scnet_estimate": _scnet_estimate(con),
            # v202 预估费用汇率视图（USD→CNY，供展示层换算 ¥）：None=无有效汇率，
            # 展示层诚实降级 USD 原值，不编造汇率。与额度/SCNet 链互不推导。
            "fx": (_pricing.fx_view() if _pricing is not None else None),
            # v254 速度 Tooltip 统一轮表（真实库有界扫描、2s 缓存）：桌面快照链产出
            # （serve 常驻与 legacySpawn 一次性 json 都显式带桌面标记，避免常驻进程空闲
            # 回收/重启交替期偶发缺字段而回退旧版整卡）。CLI / MCP / 远端子查询的 stdout
            # 契约不夹带这份 ~200KB 增强字段；旧远端/无本地连接/缺列降级时省略，渲染端判空回退。
            **({"speed_history": _speed_history_safe(con, latest_sid)} if include_speed_history else {}),
            # v384 全历史按日聚合（specs/speed-tooltip-v3.md §1.2）：与 speed_history 同款
            # 门控/降级（None=失败，渲染端判空）；CLI / MCP / 远端子查询 stdout 不夹带
            **({"speed_days": _speed_days_safe(con)} if include_speed_days else {}),
            # v331 全部项目聚合（specs/all-projects-usage.md）：桌面快照链顶层可选字段；
            # 无连接/缺列降级时省略，渲染端判空显「暂不可用」，不借当前项目数据冒充
            **({"all_projects": all_proj} if all_proj is not None else {}),
            "remote_enabled": bool(setup),        # 是否存在可用远端目标（区分"没配"与"配了没查到"）
            "known_sids": known_sids,
            "context_window": base["context_window"],
            "context_auto": base["context_auto"],
            "code": base["code"],
            "ctx_exc": base["ctx_exc"],
            "tools": base["tools"],
            "recent": rec,
        }
    finally:
        if con is not None and owns_con:
            con.close()


# ---------- WorkBuddy 数据源（会话级上下文 + 正文逐请求用量） ----------
# 两路数据拼起来才是完整口径：
#   1) ~/.workbuddy/workbuddy.db 的 session_usage —— 当前上下文用量 used / 窗口 size；
#   2) projects/<项目>/<sid>.jsonl 的 providerData.rawUsage —— 每次模型调用的
#      prompt/completion/思考/缓存/credit，以及轮次、工具调用与生成时间窗口。
# 正文解析放在 wb_usage.py；旧构建可能没有这个文件，缺失时退回「只有上下文 + credit」。
try:
    import wb_usage as _wb_usage
except ImportError:
    _wb_usage = None

_WB_SCAN_LIMIT = 2000     # session_usage 单次扫描上限（按最后活动倒序）
_WB_ENRICH = 6            # 只为最近 N 个会话解析正文（状态条只渲染 1 个，其余作兜底）
_WB_SQL = """
select u.session_id as sid, u.used, u.size, u.updated_at as usage_at, u.credit_json,
       s.cwd, s.title, s.custom_title, s.status, s.model, s.context_window,
       s.created_at, s.last_activity_at, s.updated_at as session_at,
       s.is_playground, s.is_background_automation
  from session_usage u
  left join sessions s on s.id = u.session_id
 where s.deleted_at is null
 order by max(coalesce(u.updated_at, 0), coalesce(s.last_activity_at, 0),
              coalesce(s.updated_at, 0)) desc
 limit %d
""" % _WB_SCAN_LIMIT


def _wb_credit_total(raw):
    """credit_json = {计价条目 id: credit}（宿主口径：一轮一条）。

    正文里拿不到 credit 时的回退来源；损坏 JSON / 非数值按跳过处理，不整行失败。"""
    if not raw:
        return 0.0, 0
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return 0.0, 0
    if not isinstance(data, dict):
        return 0.0, 0
    total, n = 0.0, 0
    for value in data.values():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        total += float(value)
        n += 1
    return round(total, 4), n


def _wb_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _wb_window(row, cfg):
    """上下文窗口：session_usage.size > sessions.context_window > 配置默认。
    第二项 = 是否回退值（size 命中是权威值，只有后两级才是回退）。"""
    window = _wb_int(row["size"])
    if window > 0:
        return window, False
    window = _wb_int(row["context_window"])
    if window > 0:
        return window, True
    return _wb_int(cfg.get("context_window")) or 128000, True


def _wb_stats(sid):
    """会话正文解析（含逐请求用量/轮次/工具）。文件不存在或无 wb_usage 时返回 None。"""
    if _wb_usage is None or not sid:
        return None
    try:
        path = _wb_usage.session_file(sid)
        if not path:
            return None
        parsed = _wb_usage.parse_transcript(path)
        if not parsed.get("requests"):
            return None
        return {
            "parsed": parsed,
            "sum": _wb_usage.summarize(parsed),
            "turn": _wb_usage.last_turn(parsed),
            "path": str(path),
        }
    except Exception:   # noqa: BLE001 — 单个会话正文坏掉不能拖垮整帧
        return None


def _wb_row(row, cfg, stats=None):
    """session_usage 行（+可选正文统计）→ 与 ZCode 快照同构的会话行。"""
    sid = row["sid"] or ""
    window, auto = _wb_window(row, cfg)
    credits, credit_entries = _wb_credit_total(row["credit_json"])
    used = _wb_int(row["used"])
    last_at = max(_wb_int(row["usage_at"]), _wb_int(row["last_activity_at"]), _wb_int(row["session_at"]))
    status = str(row["status"] or "")
    model = str(row["model"] or "")
    out = _empty_snapshot(sid, {"context_window": window})
    out.update({
        "host": HOST_WORKBUDDY,
        "title": (row["custom_title"] or row["title"] or "") or "",
        "active": bool(status.lower() in ("working", "running", "streaming")
                       or (last_at and int(time.time() * 1000) - last_at < SESSION_TIMEOUT_MS)),
        "ctx": used,
        "context_window": window,
        "context_auto": auto,
        "updated": (_ts(last_at).strftime("%H:%M:%S") if last_at else ""),
        "last_at": last_at,
        "started": _wb_int(row["created_at"]),
        "model": model,
        "cwd": str(row["cwd"] or ""),
        "status": status,
        "credits": credits,
        "credit_entries": credit_entries,
        "is_sub": False,
        "parent": None,
        "is_playground": bool(_wb_int(row["is_playground"])),
        "is_background": bool(_wb_int(row["is_background_automation"])),
        "last": {"duration_ms": 0, "ttft_ms": 0, "model": model, "tps": 0,
                 "startedAt": 0, "endedAt": last_at},
    })
    if not stats:
        return out
    summ, turn, parsed = stats["sum"], stats["turn"], stats["parsed"]
    # 逐请求口径覆盖会话级兜底（正文才是真数据源；session_usage 只补上下文与窗口）
    out.update({
        "turns": summ["turns"],
        "requests": summ["requests"],
        "input": summ["input"],
        "output": summ["output"],
        "reasoning": summ["reasoning"],
        "cache_read": summ["cache_read"],
        "cache_write": summ["cache_write"],
        "total": summ["total"],
        "tool_calls": summ["tool_calls"],
        "retries": 0,
        "avg_tps": summ["avg_tps"],
        "started": summ["started"] or out["started"],
        "last_at": max(out["last_at"], summ["last_at"]),
        "model": parsed.get("model") or model,
        "title": out["title"] or parsed.get("title") or "",
        "cwd": out["cwd"] or parsed.get("cwd") or "",
        # 正文 credit 合计为 0 时回退宿主 credit_json（正文不记 credit 的部署仍有会话级值）
        "credits": summ["credits"] if summ["credits"] else credits,
        # 费用按模型分组计（价表命中的才计入）；未定价模型进 cost_unknown，
        # 上层显示「部分预估」，拿不到就不写 0。
        "cost_usd": summ.get("cost_usd"),
        "cost_partial": bool(summ.get("cost_partial")),
        "cost_unknown": list(summ.get("cost_unknown") or []),
        "cost_models": summ.get("cost_models") or [],
        "models": summ.get("cost_models") or [],
        "tool_errors": summ.get("tool_errors", 0),
        "speed_segs": [r["tps"] for r in parsed["requests"] if r.get("gen_ms")][-_SPEED_SEGS_MAX:],
        # 悬停速度卡要画柱状图：每段带时间与用量，光有数值无法标时间轴
        "speed_points": [{"tps": r["tps"], "ts": r["ts"], "output": r["output"],
                          "total": r["prompt"] + r["output"]}
                         for r in parsed["requests"] if r.get("gen_ms")][-_SPEED_SEGS_MAX:],
    })
    out["last_turn"] = dict(_EMPTY_TURN, **{k: v for k, v in turn.items() if k in _EMPTY_TURN})
    out["last_turn"]["cost_usd"] = turn.get("cost_usd")
    out["last_turn"]["cost_unknown"] = list(turn.get("cost_unknown") or [])
    out["last_turn"]["cost_models"] = list(turn.get("cost_models") or [])
    out["last_turn"]["credits"] = turn.get("credits", 0)
    out["last"] = {"duration_ms": turn.get("duration_ms", 0), "ttft_ms": 0,
                   "model": out["model"], "tps": summ["last_tps"],
                   "startedAt": turn.get("started", 0), "endedAt": turn.get("ended", 0)}
    out["tools"] = {"total": parsed.get("tool_calls", 0),
                    "errors": parsed.get("tool_errors", 0),
                    "list": parsed.get("tools", [])[:12]}
    return out


def _wb_rows(con, cfg=None):
    """可用会话行（最近 N 个补正文统计，其余只带上下文），按最后活动倒序。"""
    _wb_ready_pricing()
    cfg = cfg if cfg is not None else load_config()
    raw = con.execute(_WB_SQL).fetchall()
    rows = []
    for i, r in enumerate(raw):
        stats = _wb_stats(r["sid"]) if i < _WB_ENRICH else None
        rows.append(_wb_row(r, cfg, stats))
    rows.sort(key=lambda r: (-r["last_at"], r["sid"]))
    return rows


def _wb_empty_row(cfg):
    row = _empty_snapshot("", cfg)
    row.update({"host": HOST_WORKBUDDY, "model": "", "cwd": "", "status": "",
                "credits": 0.0, "credit_entries": 0, "is_sub": False, "parent": None})
    return row


def _wb_pct(row):
    window = row["context_window"] or 0
    return (row["ctx"] / window * 100) if window else 0.0


def _wb_stamp(ms, fmt="%Y-%m-%d %H:%M:%S"):
    t = _ts(ms)
    return t.strftime(fmt) if t else "?"


def wb_snapshot(force_sid="", cfg=None, serve_con=None):
    """WorkBuddy 快照：顶层键与 ZCode 快照对齐。

    会话/本轮/工具/速度来自正文逐请求记录，上下文来自 session_usage，
    今日与项目累计为跨会话聚合；费用按价表逐模型估算，未收录模型记 None 并带 cost_unknown。"""
    cfg = cfg if cfg is not None else load_config()
    if _pricing is not None:
        try:
            _pricing.configure(cfg)   # 让直接调用者也能读到 pricing-cache.json 的汇率
        except Exception:
            pass
    con, owns, local_error = serve_con, False, None
    if con is None or host_of(con) != HOST_WORKBUDDY:
        try:
            con = connect(HOST_WORKBUDDY)
            owns = True
        except sqlite3.Error as exc:
            con, local_error = None, str(exc)[:200]
    try:
        rows = _wb_rows(con, cfg) if con is not None else []
        by_sid = {r["sid"]: r for r in rows}
        force = []
        for fs in str(force_sid).split(","):
            fs = fs.strip()
            if fs and re.fullmatch(r"[A-Za-z0-9_-]+", fs) and fs not in force:
                force.append(fs)
        known_sids = [s for s in force if s in by_sid]
        not_local = [s for s in force if s not in by_sid]
        base = by_sid[known_sids[0]] if known_sids else (rows[0] if rows else _wb_empty_row(cfg))
        rec, seen = [], set()
        for row in [by_sid[s] for s in known_sids] + rows:
            if row["sid"] in seen:
                continue
            seen.add(row["sid"])
            rec.append(row)
            if len(rec) >= max(6, len(known_sids) + 6):
                break
        start_ms = _epoch_ms(_day_start())
        active_today = [r for r in rows if r["last_at"] >= start_ms]
        new_today = [r for r in rows if r["started"] >= start_ms]
        agg = {}
        if _wb_usage is not None:
            try:
                agg = _wb_usage.aggregate_since(start_ms)
            except Exception:   # noqa: BLE001 — 今日聚合失败只影响今日格
                agg = {}
        today = {
            "requests": agg.get("requests", 0),
            "input": agg.get("input", 0),
            "output": agg.get("output", 0),
            "cache_read": agg.get("cache_read", 0),
            "cache_write": agg.get("cache_write", 0),
            "total": agg.get("total", 0),
            "reasoning": agg.get("reasoning", 0),
            "retries": 0,
            "started": start_ms,
            "sessions": len(active_today),
            "new_sessions": len(new_today),
            "credits": round(agg.get("credits", 0.0), 4),
            "first_at": agg.get("first_at", 0),
            "last_at": agg.get("last_at", 0) or max([r["last_at"] for r in active_today], default=0),
            "tool_calls": agg.get("tool_calls", 0),
            "tool_errors": agg.get("tool_errors", 0),
            "cost_usd": agg.get("cost_usd"),
            "cost_partial": bool(agg.get("cost_partial")),
            "cost_unknown": list(agg.get("cost_unknown") or []),
            "ctx_max": max([r["ctx"] for r in active_today], default=0),
            "models": agg.get("by_model", []),
        }
        project = {}
        if _wb_usage is not None and base.get("cwd"):
            try:
                project = _wb_usage.aggregate_cwd(base["cwd"])
            except Exception:   # noqa: BLE001
                project = {}
        return {
            "host": HOST_WORKBUDDY,
            "caps": host_caps(HOST_WORKBUDDY),
            "local_error": local_error,
            "session": base,
            "last_turn": base["last_turn"],
            "last": base["last"],
            "today": today,
            "project": project,
            "remote_today": {}, "remote_error": None, "remote_errors": {},
            "remote_targets": [], "not_local": not_local,
            "provider_fallback": "", "scnet_estimate": None,
            "db_path": str(workbuddy_db_path(cfg)),
            "fx": (_pricing.fx_view() if _pricing is not None else None),
            "remote_enabled": False, "known_sids": known_sids,
            "context_window": base["context_window"], "context_auto": base["context_auto"],
            "code": base["code"], "ctx_exc": 0, "tools": base["tools"],
            "recent": rec,
        }
    finally:
        if con is not None and owns:
            con.close()


def _wb_hit_pct(cache_read, total_in):
    return round(cache_read / total_in * 100) if total_in else 0


_WB_PRICING_READY = False


def _wb_ready_pricing():
    """渲染入口调用一次：定位 pricing-cache.json。报表可能不经过 snapshot()，
    不在这里补一次就会丢掉缓存里的汇率与运行时更新的牌价（只用到内置表）。"""
    global _WB_PRICING_READY
    if _WB_PRICING_READY or _pricing is None:
        return
    try:
        _pricing.configure(load_config())
    except Exception:   # noqa: BLE001 — 配置失败只影响币种/新价，不拖垮报表
        pass
    _WB_PRICING_READY = True


def _wb_money(usd):
    """USD 金额 → 显示串：有汇率走 ¥（与渲染端 fmtMoney 同口径），否则 $。
    缺失/不可得返回「—」，绝不写 0 冒充。"""
    if not isinstance(usd, (int, float)):
        return "—"
    fx = _pricing.fx_view() if _pricing is not None else None
    rate = float((fx or {}).get("rate") or 0)
    if rate > 0:
        v = usd * rate
        return "<¥0.01" if 0 < v < 0.01 else f"¥{v:.2f}"
    return "<$0.01" if 0 < usd < 0.01 else f"${usd:.2f}"


def _wb_cost_note(unknown, en=False):
    """未定价模型的说明后缀（表明「部分预估」的范围）；空列表返回空串。"""
    names = [n for n in (unknown or []) if n]
    if not names:
        return ""
    joined = (", " if en else "、").join(names)
    return f" (excl. unpriced {joined})" if en else f"（不含未收录模型 {joined}）"


def wb_render_current(con):
    rows = _wb_rows(con)
    if not rows:
        return L("■ WorkBuddy：本地还没有会话记录（先在 WorkBuddy 里跑一轮对话）。",
                 "■ WorkBuddy: no local session usage yet (run one turn in WorkBuddy first).")
    r = rows[0]
    lt = r.get("last_turn") or {}
    lines = [L(f"■ WorkBuddy 当前会话 · {r['title'] or '(无标题)'}",
               f"■ WorkBuddy current session · {r['title'] or '(untitled)'}"),
             L(f"  模型 {r['model'] or '?'}  状态 {r['status'] or '?'}  "
               f"轮 {r['turns']} / 请求 {r['requests']} / 工具 {r['tool_calls']}",
               f"  model {r['model'] or '?'}  status {r['status'] or '?'}  "
               f"turns {r['turns']} / requests {r['requests']} / tools {r['tool_calls']}"),
             L(f"  上下文 {fmt(r['ctx'])} / {fmt(r['context_window'])} ({_wb_pct(r):.1f}%)  "
               f"credit {r['credits']:.2f}",
               f"  context {fmt(r['ctx'])} / {fmt(r['context_window'])} ({_wb_pct(r):.1f}%)  "
               f"credits {r['credits']:.2f}")]
    if r["total"]:
        lines.append(L(f"  token 入 {fmt(r['input'])}（缓存命中 {_wb_hit_pct(r['cache_read'], r['input'])}%）"
                       f" 出 {fmt(r['output'])}（思考 {fmt(r['reasoning'])}） 合计 {fmt(r['total'])}",
                       f"  tokens in {fmt(r['input'])} (cache {_wb_hit_pct(r['cache_read'], r['input'])}%)"
                       f" out {fmt(r['output'])} (thinking {fmt(r['reasoning'])}) total {fmt(r['total'])}"))
        lines.append(L(f"  速度 会话均 {r['avg_tps']} t/s · 最近一段 {lt.get('tps', 0)} t/s（按模型响应窗口近似）",
                       f"  rate avg {r['avg_tps']} t/s · latest {lt.get('tps', 0)} t/s (model response window)"))
        lines.append(L(f"  本轮 {fmt(lt.get('total', 0))} / {lt.get('requests', 0)} 次"
                       f" · 会话累计 {r['turns']} 轮",
                       f"  latest turn {fmt(lt.get('total', 0))} / {lt.get('requests', 0)} req"
                       f" · session {r['turns']} turns"))
    else:
        lines.append(L("  （没有会话正文记录：只能显示上下文与 credit）",
                       "  (no transcript records: only context and credits available)"))
    if r.get("cost_usd") is not None:
        lines.append(L(f"  预估费用 会话 {_wb_money(r['cost_usd'])}"
                       f" · 本轮 {_wb_money(lt.get('cost_usd'))}"
                       f"{_wb_cost_note(r.get('cost_unknown') if r.get('cost_partial') else [])}"
                       f"（按价表牌价，非账单）",
                       f"  est. cost session {_wb_money(r['cost_usd'])}"
                       f" · latest turn {_wb_money(lt.get('cost_usd'))}"
                       f"{_wb_cost_note(r.get('cost_unknown') if r.get('cost_partial') else [], en=True)}"
                       f" (price table, not a bill)"))
    else:
        lines.append(L("  预估费用 不可得（价表未收录该模型；不按兜底均价冒充）",
                       "  est. cost unavailable (model not in price table; no fallback rates)"))
    if r["cwd"]:
        lines.append(L(f"  目录 {r['cwd']}", f"  cwd {r['cwd']}"))
    lines.append(L("  注：token 来自会话正文的逐次调用记录；速度为模型响应窗口近似值。",
                   "  Note: tokens come from per-call records in the transcript; "
                   "rate is approximated from response windows."))
    return "\n".join(lines)


def wb_render_today(con):
    rows = _wb_rows(con)
    start_ms = _epoch_ms(_day_start())
    active = [r for r in rows if r["last_at"] >= start_ms]
    agg = {}
    if _wb_usage is not None:
        try:
            agg = _wb_usage.aggregate_since(start_ms)
        except Exception:   # noqa: BLE001
            agg = {}
    peak = max([_wb_pct(r) for r in active], default=0.0)
    head = L(f"■ 今日 ({datetime.now():%Y-%m-%d %a})  [WorkBuddy]",
             f"■ Today ({datetime.now():%Y-%m-%d %a})  [WorkBuddy]")
    lines = [head,
             L(f"  {agg.get('sessions', 0)} 个会话 · {agg.get('requests', 0)} 次请求 · "
               f"{fmt(agg.get('total', 0))} tokens",
               f"  {agg.get('sessions', 0)} sessions · {agg.get('requests', 0)} requests · "
               f"{fmt(agg.get('total', 0))} tokens"),
             L(f"  入 {fmt(agg.get('input', 0))}（缓存 {fmt(agg.get('cache_read', 0))}）"
               f" 出 {fmt(agg.get('output', 0))}（思考 {fmt(agg.get('reasoning', 0))}）"
               f" credit {agg.get('credits', 0):.2f}",
               f"  in {fmt(agg.get('input', 0))} (cache {fmt(agg.get('cache_read', 0))})"
               f" out {fmt(agg.get('output', 0))} (thinking {fmt(agg.get('reasoning', 0))})"
               f" credits {agg.get('credits', 0):.2f}"),
             L(f"  工具 {agg.get('tool_calls', 0)} 次（错误 {agg.get('tool_errors', 0)}）"
               f" · 峰值上下文 {peak:.1f}%",
               f"  tools {agg.get('tool_calls', 0)} (errors {agg.get('tool_errors', 0)})"
               f" · peak context {peak:.1f}%")]
    if agg.get("cost_usd") is not None:
        lines.append(L(f"  预估费用 {_wb_money(agg.get('cost_usd'))}"
                       f"{_wb_cost_note(agg.get('cost_unknown') if agg.get('cost_partial') else [])}"
                       f"（按请求时间归属，非账单）",
                       f"  est. cost {_wb_money(agg.get('cost_usd'))}"
                       f"{_wb_cost_note(agg.get('cost_unknown') if agg.get('cost_partial') else [], en=True)}"
                       f" (by request time, not a bill)"))
    else:
        lines.append(L("  预估费用 不可得（价表未收录今日所用模型）",
                       "  est. cost unavailable (today's models not in price table)"))
    for m in (agg.get("by_model") or [])[:5]:
        cost_txt = _wb_money(m.get("cost_usd")) if m.get("priced") else "—"
        lines.append(L(f"  {m['model']:<24} {m['requests']:>5} 次  {fmt(m['total']):>8}  "
                       f"credit {m['credits']:.2f}  费用 {cost_txt}",
                       f"  {m['model']:<24} {m['requests']:>5} req  {fmt(m['total']):>8}  "
                       f"credit {m['credits']:.2f}  cost {cost_txt}"))
    return "\n".join(lines)


def wb_render_days(con, days):
    _wb_ready_pricing()
    days = max(1, int(days))
    since = int(time.time() * 1000) - days * 86400000
    buckets = {}
    if _wb_usage is not None:
        for path in _wb_usage.transcript_paths():
            try:
                if path.stat().st_mtime * 1000 < since:
                    continue   # 窗口外的文件不解析（窗口内有请求的文件必然在窗口内写过）
            except OSError:
                continue
            parsed = _wb_usage.parse_transcript(path)
            for r in parsed.get("requests") or []:
                if not r["ts"]:
                    continue
                key = _ts(r["ts"]).date()
                b = buckets.setdefault(key, {"requests": 0, "total": 0, "credits": 0.0, "reqs": []})
                b["requests"] += 1
                b["total"] += r["prompt"] + r["output"]
                b["credits"] += r["credit"]
                b["reqs"].append(r)
    lines = [L(f"■ 近 {days} 天每日（按请求时间归属）",
               f"■ Last {days} days (by request time)")]
    today = _day_start().date()
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        b = buckets.get(d, {"requests": 0, "total": 0, "credits": 0.0, "reqs": []})
        bar = "█" * max(0, min(30, int((b["total"] or 0) / 2_000_000)))
        day_cost, _, _ = _wb_usage.cost_of_requests(b["reqs"]) if (_wb_usage and b["reqs"]) else (None, [], [])
        cost_txt = f"  {_wb_money(day_cost):>8}" if day_cost is not None else "        —"
        lines.append(L(f"  {d:%Y-%m-%d}  {b['requests']:>4} 次  {fmt(b['total']):>8}  "
                       f"credit {b['credits']:>7.2f}{cost_txt}  {bar}",
                       f"  {d:%Y-%m-%d}  {b['requests']:>4} req  {fmt(b['total']):>8}  "
                       f"credit {b['credits']:>7.2f}{cost_txt}  {bar}"))
    return "\n".join(lines)


def wb_render_sessions(con, limit=10):
    limit = max(1, int(limit))
    rows = _wb_rows(con)[:limit]
    lines = [L(f"■ 最近 {limit} 个 WorkBuddy 会话（tokens / 请求 / 上下文）",
               f"■ Last {limit} WorkBuddy sessions (tokens / requests / context)")]
    if not rows:
        lines.append(L("  （本地还没有会话记录）", "  (no local sessions yet)"))
    for r in rows:
        cost_txt = f"  {_wb_money(r.get('cost_usd')):>8}" if r.get("cost_usd") is not None else "        —"
        lines.append(L(f"  {_wb_stamp(r['last_at'], '%m-%d %H:%M')}  {fmt(r['total']):>8}  "
                       f"{r['requests']:>4} 次{cost_txt}  {_wb_pct(r):>5.1f}%  {(r['model'] or '?'):<20} "
                       f"{r['title'] or '(无标题)'}  [{r['sid'][:8]}]",
                       f"  {_wb_stamp(r['last_at'], '%m-%d %H:%M')}  {fmt(r['total']):>8}  "
                       f"{r['requests']:>4} req{cost_txt}  {_wb_pct(r):>5.1f}%  {(r['model'] or '?'):<20} "
                       f"{r['title'] or '(untitled)'}  [{r['sid'][:8]}]"))
    return "\n".join(lines)


def wb_render_models(con, days=7):
    days = max(1, int(days))
    since = int(time.time() * 1000) - days * 86400000
    agg = {}
    if _wb_usage is not None:
        try:
            agg = _wb_usage.aggregate_since(since)
        except Exception:   # noqa: BLE001
            agg = {}
    lines = [L(f"■ 近 {days} 天按模型", f"■ Last {days} days by model")]
    models = agg.get("by_model") or []
    if not models:
        lines.append(L("  （该时间窗内没有请求）", "  (no requests in this window)"))
    for m in models:
        cost_txt = _wb_money(m.get("cost_usd")) if m.get("priced") else "不可得"
        lines.append(L(f"  {m['model']:<24} {m['requests']:>5} 次  {fmt(m['total']):>9}  "
                       f"credit {m['credits']:.2f}  费用 {cost_txt}",
                       f"  {m['model']:<24} {m['requests']:>5} req  {fmt(m['total']):>9}  "
                       f"credit {m['credits']:.2f}  cost {cost_txt}"))
    return "\n".join(lines)


def wb_render_workspace(con, pattern, top=15):
    pattern = (pattern or "").strip()
    rows = _wb_rows(con)
    dirs = sorted({r["cwd"] for r in rows if r["cwd"] and pattern.lower() in r["cwd"].lower()})
    if not dirs:
        lines = [L(f"未找到目录含 {pattern!r} 的工作区。现有工作区（按会话数前 10）：",
                   f"No workspace with directory matching {pattern!r}. Existing workspaces (top 10):")]
        counts = {}
        for r in rows:
            if r["cwd"]:
                counts[r["cwd"]] = counts.get(r["cwd"], 0) + 1
        for d, n in sorted(counts.items(), key=lambda kv: -kv[1])[:10]:
            lines.append(f"  {n:>3}  {d}")
        return "\n".join(lines)
    target = dirs[0]
    agg = {}
    if _wb_usage is not None:
        try:
            agg = _wb_usage.aggregate_cwd(target)
        except Exception:   # noqa: BLE001
            agg = {}
    hit = [r for r in rows if r["cwd"] == target]
    cost_txt = _wb_money(agg.get("cost_usd"))
    lines = [L(f"■ 工作区 {target}  [WorkBuddy]", f"■ Workspace {target}  [WorkBuddy]"),
             L(f"  {agg.get('sessions', len(hit))} 个会话 · {agg.get('requests', 0)} 次请求 · "
               f"{fmt(agg.get('total', 0))} tokens · credit {agg.get('credits', 0):.2f}"
               f" · 预估费用 {cost_txt}",
               f"  {agg.get('sessions', len(hit))} sessions · {agg.get('requests', 0)} requests · "
               f"{fmt(agg.get('total', 0))} tokens · {agg.get('credits', 0):.2f} credits"
               f" · est. cost {cost_txt}")]
    for r in hit[:max(1, int(top))]:
        row_cost = f"  {_wb_money(r.get('cost_usd')):>8}" if r.get("cost_usd") is not None else "        —"
        lines.append(L(f"  {_wb_stamp(r['last_at'], '%m-%d %H:%M')}  {fmt(r['total']):>8}  "
                       f"{r['requests']:>4} 次{row_cost}  {_wb_pct(r):>5.1f}%  {r['title'] or '(无标题)'}",
                       f"  {_wb_stamp(r['last_at'], '%m-%d %H:%M')}  {fmt(r['total']):>8}  "
                       f"{r['requests']:>4} req{row_cost}  {_wb_pct(r):>5.1f}%  {r['title'] or '(untitled)'}"))
    return "\n".join(lines)


def wb_render_session_detail(con, prefix):
    prefix = (prefix or "").strip()
    if not prefix:
        return L("session 需要一个非空 id 前缀（session:<前缀>）",
                 "session requires a non-empty id prefix (session:<prefix>)")
    hits = [r for r in _wb_rows(con) if r["sid"].startswith(prefix)]
    if not hits:
        return L(f"WorkBuddy 本地库中没有 id 以 {prefix!r} 开头的会话。",
                 f"No WorkBuddy session id starts with {prefix!r}.")
    if len(hits) > 1:
        lines = [L(f"{prefix!r} 命中 {len(hits)} 个会话，请给出更长的前缀：",
                   f"{prefix!r} matches {len(hits)} sessions, use a longer prefix:")]
        for r in hits:
            lines.append(f"  {r['sid']}  {_wb_stamp(r['last_at'])}  {r['title'] or ''}")
        return "\n".join(lines)
    r = hits[0]
    lt = r.get("last_turn") or {}
    tools = r.get("tools") or {}
    lines = [L(f"■ WorkBuddy 会话 {r['sid']}", f"■ WorkBuddy session {r['sid']}"),
             L(f"  标题 {r['title'] or '(无标题)'}", f"  title {r['title'] or '(untitled)'}"),
             L(f"  模型 {r['model'] or '?'}  状态 {r['status'] or '?'}",
               f"  model {r['model'] or '?'}  status {r['status'] or '?'}")]
    if r["cwd"]:
        lines.append(L(f"  目录 {r['cwd']}", f"  cwd {r['cwd']}"))
    lines += [
        L(f"  时间 {_wb_stamp(r['started'])} → {_wb_stamp(r['last_at'])}",
          f"  time {_wb_stamp(r['started'])} → {_wb_stamp(r['last_at'])}"),
        L(f"  上下文 {fmt(r['ctx'])} / {fmt(r['context_window'])} ({_wb_pct(r):.1f}%)",
          f"  context {fmt(r['ctx'])} / {fmt(r['context_window'])} ({_wb_pct(r):.1f}%)"),
        L(f"  轮 {r['turns']} · 请求 {r['requests']} · 工具 {r['tool_calls']}（错误 {r.get('tools', {}).get('errors', 0)}）",
          f"  turns {r['turns']} · requests {r['requests']} · tools {r['tool_calls']}"),
        L(f"  token 入 {fmt(r['input'])}（缓存 {fmt(r['cache_read'])}）出 {fmt(r['output'])}"
          f"（思考 {fmt(r['reasoning'])}）合计 {fmt(r['total'])}",
          f"  tokens in {fmt(r['input'])} (cache {fmt(r['cache_read'])}) out {fmt(r['output'])}"
          f" (thinking {fmt(r['reasoning'])}) total {fmt(r['total'])}"),
        L(f"  速度 会话均 {r['avg_tps']} t/s · 最近一段 {lt.get('tps', 0)} t/s"
          f" · credit {r['credits']:.2f}",
          f"  rate avg {r['avg_tps']} t/s · latest {lt.get('tps', 0)} t/s"
          f" · credits {r['credits']:.2f}"),
        (L(f"  预估费用 会话 {_wb_money(r.get('cost_usd'))}"
           f" · 本轮 {_wb_money(lt.get('cost_usd'))}"
           f"{_wb_cost_note(r.get('cost_unknown') if r.get('cost_partial') else [])}",
           f"  est. cost session {_wb_money(r.get('cost_usd'))}"
           f" · latest turn {_wb_money(lt.get('cost_usd'))}"
           f"{_wb_cost_note(r.get('cost_unknown') if r.get('cost_partial') else [], en=True)}")
         if r.get("cost_usd") is not None else
         L("  预估费用 不可得（价表未收录该模型）",
           "  est. cost unavailable (model not in price table)")),
    ]
    if tools.get("list"):
        top = "　".join(f"{t['name']} {t['count']}" for t in tools["list"][:6])
        lines.append(L(f"  工具明细 {top}", f"  tools {top}"))
    lines.append(L("  注：费用按价表牌价估算，非账单；速度为模型响应窗口近似值。",
                   "  Note: cost is estimated from list prices, not a bill; rate is approximated from response windows."))
    return "\n".join(lines)


def describe_host(cfg=None):
    """`zusage.py host`：当前宿主、判定来源、两侧库位置与可用指标（接入自检入口）。"""
    cfg = cfg if cfg is not None else load_config()
    host = resolve_host(cfg=cfg)
    source = host_source(cfg=cfg)
    src_label = {"cli": "--host", "env": "ZUSAGE_HOST", "config": "config.host",
                 "agent": L("跟随客户端构建", "follows client build"),
                 "auto": "config.host=auto", "default": L("默认值", "default")}[source]
    caps = host_caps(host)
    lines = [L(f"■ 宿主 {host_label(host)}（{host}；判定来源：{src_label}）",
               f"■ Host {host_label(host)} ({host}; source: {src_label})")]
    for name in HOSTS:
        path = host_db_path(name, cfg)
        mark = L("← 当前", "← active") if name == host else ""
        if not path.exists():
            lines.append(f"  {name:<10} {path}  {L('不存在', 'missing')}  {mark}")
            continue
        detail = ""
        try:
            con = _open_ro(path, "select 1 from session_usage limit 1" if name == HOST_WORKBUDDY
                           else "select 1 from model_usage limit 1")
            try:
                table = "session_usage" if name == HOST_WORKBUDDY else "model_usage"
                n = con.execute(f"select count(*) from {table}").fetchone()[0]
                detail = L(f"{n} 条用量记录", f"{n} usage rows")
            finally:
                con.close()
        except sqlite3.Error as exc:
            detail = L(f"打不开：{exc}", f"unreadable: {exc}")
        lines.append(f"  {name:<10} {path}  {detail}  {mark}")
    usable = [k for k, v in caps.items() if v]
    missing = [k for k, v in caps.items() if not v]
    lines.append(L(f"  可用指标 {', '.join(usable)}；不可用 {', '.join(missing) or '-'}",
                   f"  metrics available {', '.join(usable)}; unavailable {', '.join(missing) or '-'}"))
    return "\n".join(lines)


# ---------- CLI ----------

_SERVE_IDLE_S = 60.0   # serve 复用连接的空闲重建阈值（测试把它调成负数即可覆盖回收分支）


def serve():
    """常驻查询服务（v8 泵配套）：省每次 ~60-100ms 的解释器启动+模块加载费。
    stdin 每行一个请求（空行 = 无强制会话），stdout 每行一个 JSON 快照。
    stdin EOF = 泵已退出（管道断开），随即 exit——孤儿进程自清理。
    本地库连接跨请求复用（fork perf/only 同源收编，326MB 库实测单查询 22.6→5.4ms）：
    全部 SELECT 走 autocommit 且游标迭代到穷尽，空闲连接不持读锁、不碍 WAL checkpoint；
    连接在空闲超 60s 后的下一次请求前、库文件被替换（st_dev/st_ino 变化）时、
    探活失败或查询异常后重建。json 一次性路径仍每请求开-关。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    # v202 价表/汇率 12h 定时同步（daemon 线程随本进程退出终止）；一次性 json 路径不启动。
    # 同步失败静默保留旧值，不拖垮快照链。
    if _pricing is not None:
        try:
            _pricing.start_refresh(load_config())
        except Exception:
            pass
    con = None
    stamp = None
    last_used = 0.0

    def _drop():
        nonlocal con
        if con is not None:
            try:
                con.close()
            except sqlite3.Error:
                pass
            con = None

    while True:
        line = sys.stdin.readline()
        if not line:
            _drop()
            return
        now = time.monotonic()
        fresh = False
        try:
            st = os.stat(host_db_path())
            stamp_now = (st.st_dev, st.st_ino)
            fresh = stamp_now == stamp
        except OSError:
            stamp_now = None
        if con is not None and (not fresh or now - last_used > _SERVE_IDLE_S):
            _drop()   # 长空闲后的旧连接/被替换的库文件：宁可重开一次也不带病复用
        if con is not None:
            try:
                con.execute("select 1")
            except sqlite3.Error:
                _drop()   # 上一轮查询期出错被 snapshot 就地 close：探活即重建
        if con is None:
            try:
                con = connect()
                if stamp_now is not None:
                    stamp = stamp_now
            except sqlite3.Error:
                con = None
        try:
            force_sid, routes = _parse_query(line.strip())
            # 手机中继请求体显式 lean:true：跳过两个桌面增强字段（手机 projection 不消费），
            # 其余 CLI/MCP/桌面调用不带该键，行为不变。
            lean = _query_lean(line)
            # v384：紧凑分隔符（默认 ", " 每帧 ~2.5 万个多余空格；纯字节布局变化，
            # JSON 语义不变，speed_days 满帧实测 105→81KiB）
            out = json.dumps(snapshot(force_sid, routes, serve_con=con,
                                      include_speed_history=not lean,
                                      include_all_projects=not lean,
                                      include_speed_days=not lean), separators=(",", ":"))
        except Exception as e:
            out = json.dumps({"error": str(e)[:200]})   # 单次查询失败不杀常驻进程
            _drop()   # 异常路径下连接状态未知：弃用，下轮重建
        last_used = time.monotonic()
        sys.stdout.write(out + "\n")
        sys.stdout.flush()


def _cli_count(argv, default):
    """CLI 正整数参数（days/sessions/models/watch 的 N/秒）：非数字或 <1 给可读提示
    退出，不再 ValueError traceback 或 watch 0 忙循环。缺省走 default。"""
    if len(argv) <= 1:
        return default
    try:
        v = int(argv[1])
    except ValueError:
        print(L(f"无效参数：{argv[1]!r} 应为正整数", f"invalid argument: {argv[1]!r} expects a positive integer"))
        raise SystemExit(2)
    if v < 1:
        print(L(f"无效参数：{argv[1]!r} 应为正整数", f"invalid argument: {argv[1]!r} expects a positive integer"))
        raise SystemExit(2)
    return v


def _extract_host_flag(argv):
    """摘出全局开关 --host X / --host=X（可出现在任意位置，不占子命令位）。
    返回 (剩余参数, 宿主值或 None)；非法值与缺值都抛 ValueError。"""
    rest, host, i = [], None, 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--host":
            if i + 1 >= len(argv):
                raise ValueError("--host needs a value (zcode|workbuddy)")
            host = argv[i + 1]
            i += 2
            continue
        if arg.startswith("--host="):
            host = arg.split("=", 1)[1]
            i += 1
            continue
        rest.append(arg)
        i += 1
    return rest, host


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    try:
        argv, host_flag = _extract_host_flag(list(argv or []))
    except ValueError as exc:
        print(str(exc))
        return 2
    if host_flag is not None:
        try:
            set_host(host_flag)
        except ValueError as exc:
            print(exc)
            return 2
    cmd = argv[0] if argv else "now"
    try:
        if cmd == "host":
            print(describe_host())
            return 0
        if cmd == "json":
            raw = argv[1] if len(argv) > 1 else ""
            force_sid, routes = _parse_query(raw)
            if len(argv) > 2 and not isinstance(routes, list):
                routes = _parse_routes(argv[2])
            # v255：桌面快照链常驻 serve 的回退帧（resident 空闲回收/重启/不稳定降级）
            # 也必须带统一轮表，否则那一帧缺 speed_history 会让速度 Tooltip 闪回旧版整卡。
            # 远端子进程显式置 ZUSAGE_REMOTE_CHILD=1，不带这 ~200KB 增强字段（stdout 契约）；
            # 手机中继请求体显式 lean:true 时同样关闭这两个桌面增强字段（projection 不消费）。
            # CLI 手工 json / MCP 走 render_* 文本链，均不受影响。
            desktop = os.environ.get("ZUSAGE_REMOTE_CHILD") != "1" and not _query_lean(raw)
            print(json.dumps(snapshot(force_sid, routes, include_speed_history=desktop,
                                      include_all_projects=desktop,
                                      include_speed_days=desktop), separators=(",", ":")))   # v384 同上
            return 0
        if cmd == "serve":
            serve()
            return 0
        con = connect()
        if cmd == "now":
            print(render_current(con))
        elif cmd == "today":
            print(render_today(con))
        elif cmd == "days":
            print(render_days(con, _cli_count(argv, 7)))
        elif cmd == "sessions":
            print(render_sessions(con, _cli_count(argv, 10)))
        elif cmd == "models":
            print(render_models(con, _cli_count(argv, 7)))
        elif cmd == "workspace":
            print(render_workspace(con, argv[1] if len(argv) > 1 else ""))
        elif cmd == "session":
            print(render_session_detail(con, argv[1] if len(argv) > 1 else ""))
        elif cmd == "watch":
            sec = _cli_count(argv, 5)
            while True:
                print("\x1b[2J\x1b[H", end="")
                print(render_current(con), flush=True)
                print(L(f"\n(每 {sec}s 刷新, Ctrl+C 退出)", f"(refreshes every {sec}s, Ctrl+C to quit)"), flush=True)
                time.sleep(sec)
        else:
            print(__doc__)
        con.close()
    except sqlite3.DatabaseError as e:
        # 列/表变更不在 connect 的表存在性探测内（那会破坏按需裁剪的测试夹具库），
        # 在入口统一转换成可行动提示，替代整段查询栈回溯。宿主名按当前判定取值，
        # 避免把 WorkBuddy 的库结构漂移说成 ZCode 升级。
        label = host_label()
        print(L(f"查询失败：{e}", f"query failed: {e}"))
        print(L(f"多半是 {label} 升级改了用量库结构（表/列变更）。请更新本插件后再查询；"
                "已落库的历史数据不受影响。",
                f"Most likely {label} changed the usage DB schema in an update. "
                "Update this plugin before querying; stored history is unaffected."))
        return 1
    return 0


def render_today(con):
    if host_of(con) == HOST_WORKBUDDY:
        return wb_render_today(con)
    today = range_usage(con, _epoch_ms(_day_start()), _epoch_ms(_day_start() + timedelta(days=1)))
    head = L(f"■ 今日 ({datetime.now():%Y-%m-%d %a})", f"■ Today ({datetime.now():%Y-%m-%d %a})")
    row = L(f"  {today[0]} 次请求  input {fmt(today[1])} (cache read {fmt(today[3])})  "
            f"output {fmt(today[2])}  合计 {fmt(today[4])}",
            f"  {today[0]} requests  input {fmt(today[1])} (cache read {fmt(today[3])})  "
            f"output {fmt(today[2])}  total {fmt(today[4])}")
    return head + "\n" + row


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
