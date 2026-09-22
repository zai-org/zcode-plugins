#!/usr/bin/env python3
"""wecom_notify — 企业微信自建应用消息推送（v1.30 人类介入通知·体验最优通道）。

为什么是企业微信（用户令：体验最优）：Android 上腾讯系推送不被厂商电池策略
虐待；自建应用免费无限量；不占用业务服务号（运维流量与业务资产隔离）。
若"微信插件"路线可用，消息可直达微信主 APP（配置后实测即知）。

配置（.regress/config.json）：
  "notify": { "wecom": { "corpid": "ww...", "secret": "...",
                          "agentid": 1000002, "touser": "@all",
                          "proxy": "http://user:pass@ip:port" } }
  ——有 wecom 凭据时 notify() 自动把它插为第一通道（手机优先，机内声音/桌面次之）。
  proxy 可选：出口走固定 IP 中转（企业可信IP 白名单的机器，家宽动态 IP 场景）。

机制：access_token 缓存 $WECOM_TOKEN_DIR（默认 /tmp，key=cropid+secret 哈希），
过期前 300s 刷新；markdown 消息。best-effort：失败只 stderr、exit 0/1，不抛异常
（通知是增强不是依赖）。可测性：WECOM_API_BASE 指向桩服务器。

用法：wecom_notify.py <project_dir> <title> <body>
"""
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def _conf(project_dir):
    """env 优先（v1.31.4）：notify 层把两层合并后的 wecom 块经
    RG_NOTIFY_WECOM_JSON 传入——机器级回退对子进程才生效；无 env 回落项目文件。"""
    raw = os.environ.get("RG_NOTIFY_WECOM_JSON")
    if raw:
        try:
            c = json.loads(raw)
            return c if isinstance(c, dict) else {}
        except json.JSONDecodeError:
            pass
    try:
        with open(os.path.join(project_dir, ".regress", "config.json"),
                  encoding="utf-8") as f:
            cfg = json.load(f)
        return (cfg.get("notify") or {}).get("wecom") or {}
    except (IOError, OSError, json.JSONDecodeError):
        return {}


def _token_path(c):
    h = hashlib.sha1((str(c.get("corpid", "")) + str(c.get("secret", ""))).encode()).hexdigest()[:10]
    return os.path.join(os.environ.get("WECOM_TOKEN_DIR", "/tmp"), f"wecom_token_{h}.json")


def _opener(c):
    """有 proxy 配置时走固定 IP 中转（可信 IP 白名单），否则直连。"""
    proxy = c.get("proxy")
    if proxy:
        return urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
    return urllib.request.build_opener()


def get_token(c, api):
    p = _token_path(c)
    now = time.time()
    try:
        with open(p, encoding="utf-8") as f:
            t = json.load(f)
        if t.get("expires_at", 0) > now + 300:
            return t["access_token"]
    except (IOError, OSError, json.JSONDecodeError):
        pass
    q = urllib.parse.urlencode({"corpid": c["corpid"], "corpsecret": c["secret"]})
    with _opener(c).open(f"{api}/gettoken?{q}", timeout=4) as r:  # P1#8：内层预算 4s×2，父进程 12s 兜住
        d = json.load(r)
    if d.get("errcode"):
        raise RuntimeError(f"gettoken {d.get('errcode')}: {d.get('errmsg')}")
    tok = d["access_token"]
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"access_token": tok,
                       "expires_at": now + int(d.get("expires_in", 7200))}, f)
    except (IOError, OSError):
        pass
    return tok


def push(c, title, body, api):
    tok = get_token(c, api)
    payload = {"touser": c.get("touser", "@all"), "msgtype": "markdown",
               "agentid": int(c["agentid"]),
               "markdown": {"content": f"**{title}**\n{body}"}}
    req = urllib.request.Request(
        f"{api}/message/send?access_token={tok}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    with _opener(c).open(req, timeout=4) as r:  # P1#8
        d = json.load(r)
    # 发送台账（v1.32.6）：所有推送的唯一咽喉——不依赖调用方日志习惯，
    # 钩子环境 TMPDIR 漂移也不失明（2026-09-05 22:19 推送送达但调用方零痕迹的盲区补口）。
    # WECOM_API_BASE 指向桩（测试环境）时不记，防 pytest 噪音污染台账。
    # v1.34：event= 维度（notify 层经 RG_NOTIFY_EVENT 注入）+ RG_SEND_LEDGER 可重定向（测试）。
    if not os.environ.get("WECOM_API_BASE"):
        try:
            import time as _t
            ledger = os.path.expanduser(
                os.environ.get("RG_SEND_LEDGER") or "~/.zcode/wecom-send.log")
            with open(ledger, "a") as f:
                f.write(f"{_t.strftime('%m-%d %H:%M:%S')} errcode={d.get('errcode')} "
                        f"event={os.environ.get('RG_NOTIFY_EVENT') or '-'} "
                        f"agent={c.get('agentid')} {title[:50]}\n")
        except Exception:
            pass
    if d.get("errcode"):
        raise RuntimeError(f"send {d.get('errcode')}: {d.get('errmsg')}")


def _api_base(wecom_conf):
    """API 基域钉住（v1.70，059）：凭据会被 POST 到该域，重定向=凭据外泄面
    （顾问字段级裁定）——WECOM_API_BASE 仅许本机测试桩（127.0.0.1/localhost/
    ::1）或机器配置 wecom.api_base_allowlist 条目（URL 或 host 精确匹配；
    allowlist 键本身在 notify.load_conf 属凭据类，未受信项目注入无效）。"""
    env = os.environ.get("WECOM_API_BASE")
    default = "https://qyapi.weixin.qq.com/cgi-bin"
    if not env:
        return default
    try:
        import urllib.parse
        host = urllib.parse.urlparse(env).hostname or ""
    except ValueError:
        host = ""
    allow = set(wecom_conf.get("api_base_allowlist") or [])
    if host in ("127.0.0.1", "localhost", "::1") or env in allow or host in allow:
        return env
    print(f"wecom_notify: WECOM_API_BASE={env} 非本机且未在 allowlist，"
          "已钉回官方域（凭据外泄防护）", file=sys.stderr)
    return default


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 3:
        print("用法: wecom_notify.py <project_dir> <title> <body>", file=sys.stderr)
        return 1
    project_dir, title, body = args[0], args[1], args[2]
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from journal import _find_project_dir
    pd = _find_project_dir(project_dir) or project_dir
    c = _conf(pd)
    if not (c.get("corpid") and c.get("secret") and c.get("agentid")):
        print("wecom_notify: notify.wecom 未配置（corpid/secret/agentid）", file=sys.stderr)
        return 1
    api = _api_base(c)
    try:
        push(c, title, body, api)
    except Exception as e:  # best-effort：不炸调用方
        print(f"wecom_notify: 推送失败（忽略）: {e}", file=sys.stderr)
        return 2  # 失败不计入 notify 的 ran 计数（rc=0 才算通道跑通）
    return 0


if __name__ == "__main__":
    sys.exit(main())
