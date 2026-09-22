#!/usr/bin/env python3
"""notify — 人类介入通知（v1.30：人类的一寸的最后一段）。

决策点到、人不在屏前：计划待批准 / 受阻待输入 / 感官终验 / 收尾 open——
往配置的通道发通知（桌面通知、声音、手机推送……通道=命令，参数化到头）。

设计（用户令：可配置化、参数化先）：
- 通道 = .regress/config.json 的 notify.channels：命令字符串列表，{title}/{body}
  占位符会被 shlex.quote 后替换（模板里不要再加引号）；无占位符的命令原样跑
  （声音类）。默认自动探测：notify-send 在装则桌面通知；aplay+wav 在则提示音
  （声音出口由系统音频层决定——蓝牙耳机连着即走蓝牙）。
- 事件 = notify.events 开关（plan_approval/blocked/sensory/finish_open/done/
  progress，默认全开）；test 事件是**手动验收通道**（`notify.py . test` 全链
  验收用，豁免开关）——不是自动发送点。notify.enabled=false 一刀关。
- 纪律：best-effort——任一通道失败只 stderr 一行，绝不非零退出（通知是增强，
  不是依赖；不许让通知故障阻塞主流程）。

用法：
  notify.py . plan_approval --title "📋 REGRESS-x 待批准" --body "改动 3 文件"
  notify.py . blocked --title "🛑 受阻" --body "需要：开 Redis 白名单"
"""
import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time

EVENTS = ("plan_approval", "blocked", "sensory", "finish_open", "done",
          "progress", "chat", "test")
# 决策型事件（v1.34 推送闭环）：送出即落待决台账，人类 outcome 回流成误报率——
# 广播升级为闭环（collar 启示：误报标注反过来校准告警策略本身，防 alert fatigue）
DECISION_EVENTS = ("plan_approval", "blocked", "sensory", "finish_open")
# chat（v1.38）：轮末提醒独立事件——stop_notify 曾冒充 done，发送台账 done×375
# 几乎全是轮末提醒（真 done 仅 3 次），统计失真；拆开后 done 恢复纯净语义
# blocked 合并窗口（v1.38 降噪）：同键未决 30 分钟内折叠不重发（病例：同清单
# 6 分钟 6 连推主动制造 alert fatigue，污染误报率校准）
BLOCKED_COALESCE_S = 30 * 60
# chat 折叠窗（v1.64，B9）：同项目+同主题 30 分钟纯去重（哨兵/固化候选/轮末
# 提醒叠加时防刷屏）。chat 无待决生命周期——不进 pending，机器级小状态文件
CHAT_COALESCE_S = 30 * 60


def _chat_fold_check(pname, title):
    """chat 同键窗口去重（v1.64）：键=项目+标题指纹。哨兵日频天然不受影响；
    坏状态文件从零重建、时间解析失败按过期处理——发送优先于折叠。"""
    if os.environ.get("RG_CHAT_FOLD") == "off":
        return False
    import datetime as _dt
    import hashlib as _hl
    key = _hl.sha1(f"{pname}|{title}".encode("utf-8", "ignore")).hexdigest()[:12]
    path = os.path.expanduser(
        os.environ.get("RG_CHAT_STATE") or "~/.zcode/regress-chat-fold.json")
    now = _dt.datetime.now()

    def _age(v):
        try:
            return (now - _dt.datetime.fromisoformat(str(v))).total_seconds()
        except ValueError:
            return float("inf")

    try:
        state = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
        if not isinstance(state, dict):
            state = {}
    except Exception:
        state = {}
    hit = state.get(key)
    if hit is not None and _age(hit) < CHAT_COALESCE_S:
        return True
    try:  # 写回顺手 prune >24h，状态文件不无限长
        fresh = {k: v for k, v in state.items() if _age(v) < 86400}
        fresh[key] = now.isoformat(timespec="seconds")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fresh, f, ensure_ascii=False)
    except Exception:
        pass
    return False

_SND_CANDIDATES = (
    "/usr/share/sounds/alsa/Front_Center.wav",
    "/usr/share/sounds/freedesktop/stereo/complete.oga",
)


def _default_channels():
    ch = []
    if shutil.which("notify-send"):
        ch.append("notify-send -a regress-guard -u critical {title} {body}")
    wav = next((p for p in _SND_CANDIDATES
                if p.endswith(".wav") and os.path.exists(p)), None)
    if wav and shutil.which("aplay"):
        ch.append(f"aplay -q {wav}")
    return ch


def _read_notify_block(path):
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        block = cfg.get("notify") if isinstance(cfg, dict) else None
        return block if isinstance(block, dict) else {}
    except (IOError, OSError, json.JSONDecodeError):
        return {}


def machine_conf_path():
    """机器级通知配置路径（v1.85.4，079 半收口）。

    默认路径走 _pwuid_home()（passwd 账本）而非 expanduser——HOME env 可注入，
    v1.68 同族旁路在此调用点的最后一处未转换债（docstring 点名过）。RG_MACHINE_NOTIFY
    env 覆盖保留为明文运维缝（顾问裁）：生产钩子路径 launcher 白名单已剥离该变量
    （tests/test_launcher_env.py 25 用例钉死），env 注入仅直连 CLI 可达，而能跑 CLI
    者本可直接写真实配置文件——同效更响亮，env 不新增攻击面。改选全拆（信任表式
    env 零影响）的触发条件：出现 env 可达但文件写不可达的新调用面，或采纳安全
    配置统一 env 零影响审计口径。"""
    return os.environ.get("RG_MACHINE_NOTIFY") or os.path.join(
        _pwuid_home(), ".zcode", "regress-notify.json")


def _pwuid_home():
    """家目录取 passwd 数据库而非 HOME env（v1.68）——expanduser('~') 读
    HOME，被注入诱导的 agent 前缀 HOME=/tmp/x git commit 即可换信任表/
    机器配置路径（同族旁路）；getpwuid 是系统账本不受进程环境操纵。
    非 POSIX 兜底 expanduser（本插件面向 Linux/mac 用户级）。"""
    try:
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except (ImportError, KeyError):
        return os.path.expanduser("~")


_TRUST_TABLE_PATH = os.path.join(_pwuid_home(), ".zcode",
                                 "regress-trusted-projects.json")


def trusted_projects_path():
    """机器侧信任表（v1.66 供应链加固）：abs 路径 → 信任时间。
    v1.68 起零环境覆盖（顾问裁定：env 缝=生产旁路——RG_TRUSTED_PROJECTS
    可被 git commit 前缀注入换表自授信，HOME 间接层同罪）。测试控制=
    monkeypatch 本模块 _TRUST_TABLE_PATH 属性，不留 env 缝。"""
    return _TRUST_TABLE_PATH


def _trusted_projects():
    """读信任表（坏 JSON 从零重建；realpath 防软链绕过比较）。"""
    try:
        data = json.load(open(trusted_projects_path(), encoding="utf-8"))
        return {os.path.realpath(k): v for k, v in data.items()} \
            if isinstance(data, dict) else {}
    except Exception:
        return {}


# v1.72 内容钉（run4 R4，顾问部署期自举裁定）：同路径静默换内容防线
_TRUST_FPR_PATH = os.path.join(_pwuid_home(), ".zcode",
                               "regress-trusted-projects.fpr.json")
_PIN_SENSITIVE = ("channels",)
_PIN_WECOM_SENSITIVE = ("corpid", "secret", "api_base_allowlist")


def _notify_block_of(project_dir):
    try:
        return _read_notify_block(
            os.path.join(project_dir, ".regress", "config.json")) or {}
    except Exception:
        return {}


def _sensitive_changed(old, new):
    """敏感面（执行通道+凭据+外发域名单）是否变动——含出现/消失。"""
    for k in _PIN_SENSITIVE:
        if old.get(k) != new.get(k):
            return True
    ow, nw = old.get("wecom") or {}, new.get("wecom") or {}
    return any(ow.get(k) != nw.get(k) for k in _PIN_WECOM_SENSITIVE)


def _load_fpr():
    """读边车；None=文件整体缺失（部署自举信号），{}=存在但空。"""
    try:
        with open(_TRUST_FPR_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except Exception:
        return {}


def _save_fpr(side):
    try:
        os.makedirs(os.path.dirname(_TRUST_FPR_PATH), exist_ok=True)
        with open(_TRUST_FPR_PATH, "w", encoding="utf-8") as f:
            json.dump(side, f, ensure_ascii=False, indent=1, sort_keys=True)
    except Exception:
        pass  # 边车是增强：写不进=下次重判，不阻断通知


def _dt_now():
    import datetime as _dt
    return _dt.datetime.now().isoformat(timespec="seconds")


def _pin_entry(side, key, notify_block):
    side[key] = {"ts": _dt_now(), "notify": notify_block}
    _save_fpr(side)


def _project_channels_allowed(project_dir):
    """项目级 channels 是否可执行（v1.66，哨兵首轮 055）。

    2026-04 PyPI 蠕虫同款攻击面：克隆仓库携带 .regress/config.json，其
    notify.channels 模板会被 shell=True 执行——信任决定必须落机器侧
    （顾问否决项目内 trust 开关：攻击者自授权）。v1.68 起唯一判据=表内
    realpath（RG_TRUST_PROJECT_CHANNELS 直通缝已删——env 可被
    git commit 前缀注入，缝即旁路；同族 RG_TRUSTED_PROJECTS 同批收口）。
    v1.72 内容钉：表内还须过边车指纹——敏感面（channels/wecom 凭据/外发
    名单）变更即拒，人工出口=刷新信任表时间戳；非敏感变更 TOFU 重钉；
    部署自举=边车整体缺失时一次钉住现状（攻击窗口=部署前换内容，记档）。"""
    key = os.path.realpath(os.path.abspath(project_dir))
    table = _trusted_projects()
    if key not in table:
        return False
    new = _notify_block_of(key)
    side = _load_fpr()
    if side is None:  # v1.72 首跑：一次钉住全部受信项目现状（顾问高把握）
        side = {k: {"ts": _dt_now(), "notify": _notify_block_of(k)}
                for k in table}
        _save_fpr(side)
        print(f"notify: 信任指纹边车首次部署——已钉住 {len(side)} 项受信项目配置"
              f"现状（{_TRUST_FPR_PATH}）；此后敏感面变更将被拒",
              file=sys.stderr)
    ent = side.get(key)
    if ent is None:  # 自举后又新增授信的项目：人工刚授信，钉住现状
        _pin_entry(side, key, new)
        return True
    if _sensitive_changed(ent.get("notify") or {}, new):
        # 人工出口：信任表时间戳晚于钉时间 = 人工重授信信号
        if str(table.get(key, "")) > str(ent.get("ts", "")):
            _pin_entry(side, key, new)
            return True
        print(f"notify: 受信项目配置的敏感面已变（{key}）——已拒并回退机器级"
              "（v1.72 内容钉，防同路径换内容）。人工重授信=编辑信任表刷新"
              "该项目时间戳", file=sys.stderr)
        return False
    if (ent.get("notify") or {}) != new:  # 非敏感变更：TOFU 自动重钉
        _pin_entry(side, key, new)
    return True


def load_conf(project_dir):
    """两层合并（v1.31.3）：机器级 ~/.zcode/regress-notify.json 为底，
    项目 .regress/config.json 按键覆盖——其他项目零配置即得手机推送。
    wecom/events 按键深合并（项目可只覆盖 agentid/单个开关），其余浅合并项目胜；
    项目级只该放差异键（name/事件微调），凭据放机器级一处改处处生效。
    channels 是唯一执行面（v1.66）：未受信项目的 channels 在 notify() 里回退。"""
    merged = _read_notify_block(machine_conf_path())
    proj = _read_notify_block(os.path.join(project_dir, ".regress", "config.json"))
    for k, v in proj.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            sub = dict(merged[k])
            sub.update(v)
            merged[k] = sub
        else:
            merged[k] = v
    # v1.70 wecom 凭据字段门（run4 R2，顾问字段级裁定）：corpid/secret/
    # api_base_allowlist 三键=凭据与外发目标决定，未受信项目的覆盖回退机器级
    # （机器无该键则剔除）——克隆仓库携假凭据把通知发往自己企微的洞就此关闭；
    # agentid/touser/name/事件开关不受限（绑机器凭据的合法差异覆盖）。
    _pw = proj.get("wecom") or {}
    _SENS = ("corpid", "secret", "api_base_allowlist")
    if any(k in _pw for k in _SENS) and not _project_channels_allowed(project_dir):
        _mw = _read_notify_block(machine_conf_path()).get("wecom") or {}
        _wec = dict(merged.get("wecom") or {})
        for k in _SENS:
            if k in _pw:
                if k in _mw:
                    _wec[k] = _mw[k]
                else:
                    _wec.pop(k, None)
        merged["wecom"] = _wec
        print("notify: 项目级 wecom 凭据字段未受信已回退机器级（v1.70 供应链加固）——"
              "corpid/secret/allowlist 覆盖须项目先受信（人工编辑信任表）；"
              "agentid/touser/事件开关不受限",
              file=sys.stderr)
    return merged


def notify(project_dir, event, title, body="", source_id=""):
    """发通知（best-effort）。返回实际执行的通道数。

    格式统一在层内注入（v1.31.2，用户令"应含项目名/任务名/时间"）：
    标题加【项目名】前缀（cfg notify.name，缺省目录名）；正文缀 🕐 本地时间。
    调用方只写任务名——五个事件的推送点分散，约定放调用方必然漏。
    source_id（P0-3 回流接线）：清单 id——入待决台账的 ref 字段，
    plan_approve 批准/取消时按它精确自动 resolve。
    """
    cfg = load_conf(project_dir)
    if cfg.get("enabled", True) is False:
        return 0
    # v1.66 供应链加固（哨兵 055）：项目级 channels 是执行面，未受信即回退
    # 机器级/默认——克隆来的仓库携带 config 不再能借推送执行任意命令
    if cfg.get("channels") and not _project_channels_allowed(project_dir):
        mconf = _read_notify_block(machine_conf_path())
        cfg["channels"] = mconf.get("channels")  # None → 走 _default_channels()
        print("notify: 项目级通道未受信已回退（v1.66 供应链加固）——"
              "信任出口：python3 notify.py trust <项目目录>（仿 direnv allow，"
              "写 ~/.zcode/regress-trusted-projects.json）；克隆来的仓库别信任",
              file=sys.stderr)
    events = cfg.get("events", {})
    if event != "test" and events and not events.get(event, True):
        return 0
    pname = cfg.get("name") or os.path.basename(os.path.abspath(project_dir))
    title = f"【{pname}】{title}"
    if event == "chat" and _chat_fold_check(pname, title):
        print(f"notify: chat 折叠（同项目同主题 {CHAT_COALESCE_S // 60} 分钟内已发）",
              file=sys.stderr)
        return 0
    if event in DECISION_EVENTS:
        # v1.38 blocked 合并（降噪，顾问指纹修正）：同「项目+ref+原因指纹」未决
        # 且窗口内 → 折叠（不重发不重记账不刷新窗口——持续失败最多每 30 分钟
        # 重推一次；首推即使通道失败也是锚点：台账记决策不记送达）。
        # 已知边界：窗口内提交成功后同因再拦仍被折叠（首推已告知，最多延迟
        # 半小时重提）；查账异常则照旧发送（合并是增强不是依赖）。
        fp = ""
        if event == "blocked":
            import datetime as _dt
            import hashlib as _hl
            fp = _hl.sha1(body.encode("utf-8", "ignore")).hexdigest()[:8]
            try:
                from pending import merge_note, newest_open
                prev = newest_open(pname, source_id, fp)
                if prev:
                    age = (_dt.datetime.now()
                           - _dt.datetime.fromisoformat(prev["ts"])
                           ).total_seconds()
                    if age < BLOCKED_COALESCE_S:
                        merge_note(prev["id"])
                        print(f"notify: blocked 推送合并（同键 "
                              f"{int(age // 60)} 分钟内已推，待决#{prev['id']}）",
                              file=sys.stderr)
                        return 0
            except Exception:
                pass
        # 预分配待决号进正文（v1.34）：人类裁决时对着号说话，agent 记 pending。
        # 台账记决策不记送达——决策点真实存在（计划在等批准），通道失败也留账。
        try:
            from pending import add as _padd
            body += f"\n〔待决#{_padd(pname, event, title, ref=source_id, fp=fp)}〕处理后回「有用/误报/忽略」"
        except Exception:
            pass
    if body:
        body = f"{body}\n🕐 {time.strftime('%m-%d %H:%M')}"
    else:
        body = f"🕐 {time.strftime('%m-%d %H:%M')}"
    channels = list(cfg.get("channels") or _default_channels())
    wc = cfg.get("wecom") or {}
    env = dict(os.environ, RG_NOTIFY_EVENT=event)
    if wc.get("corpid") and wc.get("secret") and wc.get("agentid"):
        # 企业微信自动第一通道（体验最优：手机先响，机内声音/桌面次之）。
        # 合并后的 wecom 块经 env 传给子进程——wecom_notify 自己只读项目级文件，
        # 不传则机器级回退在子进程失效（2026-09-05 演示项目静默失败病例）。
        lib = os.path.dirname(os.path.abspath(__file__))
        channels.insert(0, 'python3 "%s" "%s" {title} {body}'
                        % (os.path.join(lib, "wecom_notify.py"), project_dir))
        env["RG_NOTIFY_WECOM_JSON"] = json.dumps(wc, ensure_ascii=False)
    ran = 0
    for tpl in channels:
        # P2#20：format 进逐通道 try——坏模板（如 awk 花括号）只跳过自身，
        # 不再废掉全部通道含企微（评审实测 KeyError 中断整个循环）
        try:
            cmd = tpl.format(title=shlex.quote(title), body=shlex.quote(body)) \
                if ("{title}" in tpl or "{body}" in tpl) else tpl
            # P1#8 超时预算：wecom 内层 4s×2(gettoken+push)+余量 → 12s；
            # 其他通道保持 5s（旧行为 5s 处决 2×10s 内层=结构性永远失败）
            tmo = 12 if "wecom_notify" in tpl else 5
            r = subprocess.run(cmd, shell=True, timeout=tmo,
                               capture_output=True, text=True, env=env)
            if r.returncode == 0:
                ran += 1
            else:
                print(f"notify: 通道失败 rc={r.returncode}（忽略）: {cmd.split()[0]}",
                      file=sys.stderr)
        except (OSError, subprocess.SubprocessError) as e:
            print(f"notify: 通道失败（忽略）: {cmd.split()[0]}: {e}",
                  file=sys.stderr)
    if ran == 0 and channels:
        # 全通道失败兜底（v1.33 企业级）：手机不通至少本机响一声——
        # 通道故障期不再完全静默，回来的人从桌面/声音知道出过事
        for tpl in _default_channels():
            try:
                cmd = tpl.format(title=shlex.quote(title), body=shlex.quote(body)) \
                    if ("{title}" in tpl or "{body}" in tpl) else tpl
                subprocess.run(cmd, shell=True, timeout=5)
            except (OSError, subprocess.SubprocessError):
                pass
    return ran


def _stats():
    """观察仪表盘（v1.34）：发送台账 + 待决台账聚合——观察期的数字层。
    北极星候选：送达率（可达段）、未决数与最老悬停（闭环段）、误报率（校准段）。
    台账行格式见 wecom_notify；event= 维度 v1.34 起有（旧行归"旧格式"）。
    末行缓存命中摘要（083，仪表盘单屏化）：history.cache_stats 只读聚合，
    项目定位走 journal._find_project_dir（同 main 的单一来源）。"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    print("═══ regress-guard 观察仪表盘 ═══")
    ledger = os.path.expanduser(
        os.environ.get("RG_SEND_LEDGER") or "~/.zcode/wecom-send.log")
    total = ok = 0
    by_event = {}
    try:
        with open(ledger, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^\d{2}-\d{2} \d{2}:\d{2}:\d{2} errcode=(\d+)", line)
                if not m:
                    continue
                total += 1
                ok += m.group(1) == "0"
                ev = re.search(r" event=(\S+)", line)
                k = ev.group(1) if ev else "旧格式"
                by_event[k] = by_event.get(k, 0) + 1
    except (IOError, OSError):
        pass
    if total:
        print(f"企微发送：{total} 条｜送达 {ok}｜送达率 {ok / total:.0%}")
        for k in sorted(by_event, key=lambda x: -by_event[x]):
            print(f"  {k:<14} ×{by_event[k]}")
    else:
        print("企微发送：暂无记录（v1.32.6 起真实发送入台账）")
    from pending import stats as _pstats
    s = _pstats()
    fp = "—" if s["fp_rate"] is None else f"{s['fp_rate']:.0%}"
    print(f"待决闭环：未决 {s['pending']}（最老 {s['oldest_pending'] or '—'}）｜"
          f"裁决 有用{s['resolved']['useful']}/误报{s['resolved']['fp']}/"
          f"忽略{s['resolved']['ignored']}｜误报率 {fp}")
    if s.get("merged"):
        print(f"blocked 折叠：{s['merged']} 次（同键 30 分钟窗口内降噪）")
    if s.get("auto_resolved"):
        print(f"自动闭环：{s['auto_resolved']} 笔（同清单过门禁自动 resolve，"
              f"不计入误报率）")
    for e in s["open"][-5:]:
        print(f"  ⏳ #{e['id']} {e['ts'][:16]} [{e['event']}] {e['title'][:40]}")
    # 缓存行（083）：巡检二看一眼即得缓存健康，不必另跑 history.py cache。
    # 增强不是依赖——history 缺席/损坏/项目未接入时静默跳行，其余行照常输出。
    try:
        from history import cache_stats
        from journal import _find_project_dir
        pd = _find_project_dir()
        if pd:
            c = cache_stats(os.path.join(pd, ".regress"))
            print(f"缓存命中：{c['total']} 次过门禁｜命中 {c['hits']}"
                  f"（{c['rate']:.1%}）｜估算节省 {c['est_saved_seconds']}s")
    except Exception:
        pass


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "stats":
        _stats()
        return 0
    if argv and argv[0] == "trust":
        # v1.67 trust 转只读（顾问高置信 B）：授信=人的决定，CLI 不留写路径——
        # 被提示注入诱导的 agent 一句 trust 自授信的洞（llms.txt/克隆仓库注入野外
        # 实证）就此关闭。共残差（A/B 同有，如实记档不做假承诺）：agent 直接
        # Write 表文件仍在台面（transcript 可见；缓解=人侧定期 diff 此表）。
        path = trusted_projects_path()
        target = (os.path.realpath(os.path.abspath(argv[1]))
                  if len(argv) > 1 else None)
        table = _trusted_projects()
        print(f"信任表（只读视图）：{path}")
        if not table:
            print("（空——尚无受信项目）")
        for k in sorted(table):
            mark = " ←" if target and k == target else ""
            print(f"  {k}  授信于 {table[k]}{mark}")
        print(
            "\n授信是人的决定，本命令不写表。人工授信/撤销：直接编辑上述文件，\n"
            f'  授信一行：  "<项目 realpath>": "<ISO 时间>"\n'
            "  （JSON 对象，键=项目绝对路径，值=授信时间；删行即撤销）")
        if target and target not in table:
            print(f"\n提示：{target} 当前不在表中（未受信）")
        return 0
    ap = argparse.ArgumentParser(description="人类介入通知")
    ap.add_argument("project_dir", help="项目目录（. 通常够用）")
    ap.add_argument("event", choices=EVENTS)
    ap.add_argument("--title", required=True)
    ap.add_argument("--body", default="")
    ap.add_argument("--ref", default="",
                    help="来源清单 id（P0-3 回流接线：批准/取消时自动 resolve 同 ref 待决）")
    args = ap.parse_args(argv)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from journal import _find_project_dir  # 项目定位单一来源
    project_dir = _find_project_dir(args.project_dir)
    if not project_dir:
        return 0  # 未接入项目：静默（通知是增强不是依赖）
    notify(project_dir, args.event, args.title, args.body, source_id=args.ref)
    return 0


if __name__ == "__main__":
    sys.exit(main())
