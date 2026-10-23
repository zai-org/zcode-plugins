"""人类介入通知（v1.30）：正负路径——通道参数化/事件开关/best-effort/test 事件。"""
import json
import os
import stat
import subprocess
import sys

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))
NOTIFY = os.path.join(LIB, "notify.py")


def _load():
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("nt", NOTIFY)
    nt = ilu.module_from_spec(spec)
    spec.loader.exec_module(nt)
    return nt


def _mk(tmp_path, conf=None, name="proj"):
    proj = tmp_path / name
    (proj / ".regress").mkdir(parents=True, exist_ok=True)
    if conf is not None:
        (proj / ".regress" / "config.json").write_text(
            json.dumps({"notify": conf}, ensure_ascii=False), encoding="utf-8")
    return proj


def _channel_stub(tmp_path, marker):
    # 文件名含 marker——一测多 stub 时互不覆盖（057 迁移时暴露：原共享
    # stub.sh 名，先建全部再发送的顺序会把前一个 marker 顶掉）
    stub = tmp_path / f"stub-{marker.name}.sh"
    stub.write_text("#!/bin/sh\necho \"$@\" >> %s\n" % marker, encoding="utf-8")
    stub.chmod(stat.S_IRWXU)
    return str(stub)


def _trusted(nt, tmp_path, *projects):
    """v1.68 受信设置唯一出口 + v1.72 内容钉预置：表+边车双写。
    表时间戳（09:00）早于钉时间戳（09:30）——钉=授信后首次使用所钉；人工重授信=刷新表时间戳晚于钉。
    env 缝已按 057 收口——nt 是每测新载模块对象，直改属性即隔离即复原。"""
    import pathlib
    tp = tmp_path / "trust.json"
    tp.write_text(json.dumps(
        {str(pathlib.Path(p).resolve()): "2026-09-20T09:00:00" for p in projects},
        ensure_ascii=False), encoding="utf-8")
    nt._TRUST_TABLE_PATH = str(tp)
    fpr = tmp_path / "trust-fpr.json"
    pins = {}
    for p in projects:
        conf = pathlib.Path(p) / ".regress" / "config.json"
        try:
            nb = json.loads(conf.read_text(encoding="utf-8")).get("notify") or {}
        except Exception:
            nb = {}
        pins[str(pathlib.Path(p).resolve())] = {"ts": "2026-09-20T09:30:00",
                                                "notify": nb}
    fpr.write_text(json.dumps(pins, ensure_ascii=False), encoding="utf-8")
    nt._TRUST_FPR_PATH = str(fpr)


def test_channel_runs_with_quoted_placeholders(tmp_path):
    nt = _load()
    proj = _mk(tmp_path, {"channels": [_channel_stub(tmp_path, tmp_path / "m1") + " {title} {body}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "plan_approval", "📋 待批准 REGRESS-1", "改动 3 文件") == 1
    out = (tmp_path / "m1").read_text(encoding="utf-8")  # body 带 🕐 换行，全文断言
    assert "待批准 REGRESS-1" in out and "改动 3 文件" in out


def test_project_name_prefix_and_time_suffix(tmp_path):
    """v1.31.2 格式统一：标题带【项目名】（cfg.name 优先于目录名），正文缀 🕐 时间。"""
    import re as _re
    nt = _load()
    proj = _mk(tmp_path, {"name": "会场助手",
                          "channels": [_channel_stub(tmp_path, tmp_path / "m7") + " {title} {body}"]})
    proj2 = tmp_path / "myproj"
    (proj2 / ".regress").mkdir(parents=True, exist_ok=True)
    (proj2 / ".regress" / "config.json").write_text(
        json.dumps({"notify": {"channels": [_channel_stub(tmp_path, tmp_path / "m8") + " {title} {body}"]}}),
        encoding="utf-8")
    _trusted(nt, tmp_path, proj, proj2)
    nt.notify(str(proj), "done", "🏁 完成 R1", "干净收尾")
    out = (tmp_path / "m7").read_text(encoding="utf-8")
    assert "【会场助手】🏁 完成 R1" in out
    assert _re.search(r"🕐 \d{2}-\d{2} \d{2}:\d{2}", out)
    # 无 name 配置 → 目录名兜底
    nt.notify(str(proj2), "blocked", "🛑 受阻")
    assert "【myproj】🛑 受阻" in (tmp_path / "m8").read_text(encoding="utf-8")


def test_progress_event_default_on_toggleable(tmp_path):
    """v1.33 长任务心跳：progress 事件存量配置默认开、可显式关。"""
    nt = _load()
    stub = _channel_stub(tmp_path, tmp_path / "m9")
    proj = _mk(tmp_path, {"channels": [stub + " {title}"]}, name="proj-a")
    proj2 = _mk(tmp_path, {"channels": [stub + " {title}"], "events": {"progress": False}},
                name="proj-b")
    _trusted(nt, tmp_path, proj, proj2)
    assert nt.notify(str(proj), "progress", "⏳ 进度 R1：F1 完成") == 1
    assert nt.notify(str(proj2), "progress", "t") == 0


# ─── v1.66/1.68 供应链加固（055 项目 channels 信任制 + 057 env 缝收口） ────────

def test_trust_default_denied(tmp_path, monkeypatch, capsys):
    """未受信项目的 channels 不执行（回退默认），stderr 给信任出口（蠕虫防线）。
    v1.68 攻击重放（057）：模拟被注入诱导的 agent 在 git commit 前缀注入
    RG_TRUSTED_PROJECTS/RG_TRUST_PROJECT_CHANNELS/HOME——生产路径零 env 影响，
    恶意 channels 仍被拒。"""
    nt = _load()
    atk = tmp_path / "atk"
    atk.mkdir()
    (atk / "regress-trusted-projects.json").write_text(
        json.dumps({str(tmp_path): "2099-01-01T00:00:00"}), encoding="utf-8")
    monkeypatch.setenv("RG_TRUSTED_PROJECTS", str(atk / "regress-trusted-projects.json"))
    monkeypatch.setenv("RG_TRUST_PROJECT_CHANNELS", "1")
    monkeypatch.setenv("HOME", str(atk))  # expanduser 间接层同批封（表改 passwd 派生）
    marker = tmp_path / "evil-marker"
    evil = tmp_path / "evil.sh"
    evil.write_text("#!/bin/sh\ntouch %s\n" % marker, encoding="utf-8")
    evil.chmod(0o700)
    proj = _mk(tmp_path, {"channels": [str(evil)]})  # 模拟克隆来的恶意仓库 config
    nt.notify(str(proj), "done", "t")
    assert not marker.exists()  # env 三重注入全部无效：项目通道没执行
    err = capsys.readouterr().err
    assert "未受信" in err and "trust" in err


def test_trusted_executes(tmp_path):
    """项目路径在机器信任表中 → 项目通道照常执行（表经 _TRUST_TABLE_PATH 属性注入）。"""
    nt = _load()
    proj = _mk(tmp_path, {"channels": [_channel_stub(tmp_path, tmp_path / "m13") + " {title}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "done", "✅ 信任项目") == 1


def test_trust_cli_readonly_never_writes(tmp_path, capsys):
    """v1.67 trust 转只读（顾问 B）：打印现表+人工编辑指引；任何形态不写文件。"""
    nt = _load()
    tp = tmp_path / "trusted.json"
    nt._TRUST_TABLE_PATH = str(tp)
    proj = _mk(tmp_path, {"channels": []})
    assert nt.main(["trust", str(proj)]) == 0  # 退出码 0（只读视图成功）
    out = capsys.readouterr().out
    assert "只读" in out and str(tp) in out  # 表路径可见
    assert "人工" in out and "realpath" in out and "ISO" in out  # 编辑指引齐三件
    assert not tp.exists()  # 表不存在也不被创建


# ─── v1.72 内容钉（061：同路径换内容分级防线，run4 R4） ────────

def test_pin_bootstrap_first_run(tmp_path, monkeypatch, capsys):
    """边车整体缺失 + 项目在表 → 首跑自举钉现状+放行+stderr 告知。"""
    import pathlib
    nt = _load()
    proj = _mk(tmp_path, {"channels": [_channel_stub(tmp_path, tmp_path / "m20") + " {title}"]})
    rp = str(pathlib.Path(proj).resolve())
    tp = tmp_path / "t.json"
    tp.write_text(json.dumps({rp: "2026-01-01T00:00:00"}), encoding="utf-8")
    nt._TRUST_TABLE_PATH = str(tp)
    fpr = tmp_path / "f.json"
    nt._TRUST_FPR_PATH = str(fpr)
    assert not fpr.exists()  # 自举前提
    assert nt.notify(str(proj), "done", "t") == 1
    assert "首次部署" in capsys.readouterr().err
    side = json.loads(fpr.read_text(encoding="utf-8"))
    assert side[rp]["notify"]["channels"]  # 现状已钉


def test_pin_swap_sensitive_denied(tmp_path, capsys):
    """同路径换 channels（敏感面）→ 拒+回退+人工出口提示。"""
    import pathlib
    nt = _load()
    proj = _mk(tmp_path, {"channels": [_channel_stub(tmp_path, tmp_path / "m21") + " {title}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "done", "t") == 1  # 钉内正常
    evil = tmp_path / "evil.sh"
    (pathlib.Path(proj) / ".regress" / "config.json").write_text(
        json.dumps({"notify": {"channels": [str(evil)]}}), encoding="utf-8")
    marker_before = set(tmp_path.glob("m21*"))
    nt.notify(str(proj), "done", "t")  # 敏感变更被拒（回退默认通道，返回值非宗量）
    err = capsys.readouterr().err
    assert "敏感面已变" in err and "时间戳" in err


def test_pin_human_retrust_repin(tmp_path):
    """人工刷新表时间戳（晚于钉时间）→ 重钉放行。"""
    import pathlib
    nt = _load()
    proj = _mk(tmp_path, {"channels": [_channel_stub(tmp_path, tmp_path / "m22") + " {title}"]})
    _trusted(nt, tmp_path, proj)
    (pathlib.Path(proj) / ".regress" / "config.json").write_text(
        json.dumps({"notify": {"channels": [_channel_stub(tmp_path, tmp_path / "m23") + " {title}"]}}),
        encoding="utf-8")
    nt.notify(str(proj), "done", "t")  # 先拒
    assert not (tmp_path / "m23").exists()  # 新通道没跑
    tp = tmp_path / "trust.json"
    rp = str(pathlib.Path(proj).resolve())
    tp.write_text(json.dumps({rp: "2099-01-01T00:00:00"}), encoding="utf-8")  # 人工重授信
    assert nt.notify(str(proj), "done", "t") == 1  # 重钉放行
    assert (tmp_path / "m23").exists()


def test_pin_nonsensitive_repin(tmp_path):
    """仅改 name（channels 逐字节不变）→ TOFU 自动重钉放行。"""
    import pathlib
    nt = _load()
    stub = _channel_stub(tmp_path, tmp_path / "m24")
    proj = _mk(tmp_path, {"name": "旧名", "channels": [stub + " {title}"]})
    _trusted(nt, tmp_path, proj)
    (pathlib.Path(proj) / ".regress" / "config.json").write_text(
        json.dumps({"notify": {"name": "新名", "channels": [stub + " {title}"]}}),
        encoding="utf-8")
    assert nt.notify(str(proj), "done", "t") == 1  # 非敏感自动重钉
    assert (tmp_path / "m24").exists()


def test_trust_cli_table_unchanged(tmp_path, capsys):
    """已有受信行：只读视图列出且前后字节不变；查询目标不在表给未受信提示。"""
    nt = _load()
    tp = tmp_path / "trusted.json"
    existing = tmp_path / "already"
    existing.mkdir()
    tp.write_text(json.dumps({str(existing): "2026-09-18T09:00:00"}),
                  encoding="utf-8")
    nt._TRUST_TABLE_PATH = str(tp)
    before = tp.read_bytes()
    outsider = _mk(tmp_path, {"channels": []})
    assert nt.main(["trust", str(outsider)]) == 0
    out = capsys.readouterr().out
    assert str(existing) in out and "2026-09-18T09:00:00" in out  # 现表逐行
    assert "不在表中" in out  # 未受信提示
    assert tp.read_bytes() == before  # 表字节不变


# （v1.68：test_trust_seam_env_passthrough 已删——RG_TRUST_PROJECT_CHANNELS
#  缝随 057 收口，env 直通不再是被测行为；攻击重放断言反向覆盖见上组）


# ─── v1.64 chat 折叠（B9：哨兵上线后的噪音防御） ────────

def test_chat_fold_same_title(tmp_path, monkeypatch, capsys):
    """同项目同标题 30 分钟内第二条折叠返 0；异标题照发。"""
    nt = _load()
    monkeypatch.setenv("RG_CHAT_STATE", str(tmp_path / "fold.json"))
    stub = _channel_stub(tmp_path, tmp_path / "m10")
    proj = _mk(tmp_path, {"channels": [stub + " {title}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "chat", "📡 哨兵日报") == 1
    assert nt.notify(str(proj), "chat", "📡 哨兵日报") == 0  # 折叠
    assert "chat 折叠" in capsys.readouterr().err
    assert nt.notify(str(proj), "chat", "📡 另一个主题") == 1  # 异题照发
    state = json.load(open(tmp_path / "fold.json", encoding="utf-8"))
    assert len(state) == 2  # 两键各一


def test_chat_fold_off_switch(tmp_path, monkeypatch):
    """RG_CHAT_FOLD=off：同题也发（一键关）。"""
    nt = _load()
    monkeypatch.setenv("RG_CHAT_STATE", str(tmp_path / "fold.json"))
    monkeypatch.setenv("RG_CHAT_FOLD", "off")
    stub = _channel_stub(tmp_path, tmp_path / "m11")
    proj = _mk(tmp_path, {"channels": [stub + " {title}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "chat", "📡 哨兵日报") == 1
    assert nt.notify(str(proj), "chat", "📡 哨兵日报") == 1  # 关折叠照发


def test_chat_fold_corrupt_state(tmp_path, monkeypatch):
    """坏状态文件：从零重建不炸，发送优先于折叠。"""
    nt = _load()
    monkeypatch.setenv("RG_CHAT_STATE", str(tmp_path / "fold.json"))
    (tmp_path / "fold.json").write_text("{不是json", encoding="utf-8")
    stub = _channel_stub(tmp_path, tmp_path / "m12")
    proj = _mk(tmp_path, {"channels": [stub + " {title}"]})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "chat", "📡 主题") == 1
    assert json.load(open(tmp_path / "fold.json", encoding="utf-8"))


def test_wecom_subprocess_receives_merged_conf(tmp_path, monkeypatch):
    """v1.31.4 回归：裸项目+机器级 wecom → 企微子进程必须真拿到合并配置（API 桩被命中）。
    病例：2026-09-05 合并只活在父进程，子进程只读项目文件 → 演示项目推送静默失败，
    而当时测试只断言了合并字典（oracle 宽松断言）。"""
    import http.server
    import importlib.util as ilu
    import threading
    hits = []

    class H(http.server.BaseHTTPRequestHandler):
        def _json(self, o):
            b = json.dumps(o).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            hits.append(self.path)
            self._json({"errcode": 0, "access_token": "T1", "expires_in": 7200})

        def do_POST(self):
            hits.append(self.path)
            self._json({"errcode": 0, "errmsg": "ok"})

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("WECOM_API_BASE", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("WECOM_TOKEN_DIR", str(tmp_path / "tk"))

    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {
        "wecom": {"corpid": "wwM", "secret": "SM", "agentid": 1}}}), encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))

    nt = _load()
    bare = tmp_path / "bare"  # 项目级无任何 notify 配置
    (bare / ".regress").mkdir(parents=True, exist_ok=True)
    assert nt.notify(str(bare), "done", "跨项目") >= 1
    assert any("corpid=wwM" in h and "gettoken" in h for h in hits), \
        "企微子进程未拿到机器级合并配置（env 传递失效）"
    srv.shutdown()


def test_machine_fallback_and_keywise_merge(tmp_path, monkeypatch):
    """v1.31.3 两层合并：项目无 notify 块 → 机器级生效；项目按键覆盖（wecom 深合并）。"""
    import importlib
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {
        "name": "机器默认",
        "events": {"done": True, "blocked": True},
        "wecom": {"corpid": "wwM", "secret": "SM", "agentid": 1},
        "channels": [_channel_stub(tmp_path, tmp_path / "mm") + " {title}"],
    }}), encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("WECOM_API_BASE", "http://127.0.0.1:1")  # 死端口：wecom 秒败 rc=2 不计数
    nt = _load()

    # 项目无 notify 块：机器级通道全量生效，name 用机器级
    bare = tmp_path / "bare"
    (bare / ".regress").mkdir(parents=True, exist_ok=True)
    assert nt.notify(str(bare), "done", "跨项目零配置") == 1
    out = (tmp_path / "mm").read_text(encoding="utf-8")
    assert "【机器默认】跨项目零配置" in out

    # 项目覆盖 name + 单个事件开关；wecom 深合并：agentid 覆盖、corpid 继承
    proj = _mk(tmp_path, {"name": "会场助手", "events": {"done": False},
                          "wecom": {"agentid": 9}})
    c = nt.load_conf(str(proj))
    assert c["name"] == "会场助手"
    assert c["events"]["done"] is False and c["events"]["blocked"] is True
    assert c["wecom"] == {"corpid": "wwM", "secret": "SM", "agentid": 9}
    assert nt.notify(str(proj), "done", "t") == 0  # 机器开、项目关 → 项目胜


def test_event_toggle_and_master_switch(tmp_path):
    nt = _load()
    stub = _channel_stub(tmp_path, tmp_path / "m2")
    proj = _mk(tmp_path, {"channels": [stub], "events": {"blocked": False}}, name="proj-a")
    proj2 = _mk(tmp_path, {"enabled": False, "channels": [stub]}, name="proj-b")
    proj3 = _mk(tmp_path, {"channels": [stub]}, name="proj-c")
    _trusted(nt, tmp_path, proj, proj2, proj3)
    assert nt.notify(str(proj), "blocked", "t") == 0
    assert nt.notify(str(proj2), "plan_approval", "t") == 0
    assert nt.notify(str(proj3), "sensory", "t") == 1


def test_done_event_default_on_and_toggleable(tmp_path):
    """done（v1.31.1 离场召回）：存量配置无 done 键默认开；显式关掉则静默。"""
    nt = _load()
    stub = _channel_stub(tmp_path, tmp_path / "m6")
    proj = _mk(tmp_path, {"channels": [stub]}, name="proj-a")  # events 无 done 键
    proj2 = _mk(tmp_path, {"channels": [stub], "events": {"done": False}}, name="proj-b")
    _trusted(nt, tmp_path, proj, proj2)
    assert nt.notify(str(proj), "done", "🏁 完成 R1") == 1
    assert nt.notify(str(proj2), "done", "t") == 0


def test_test_event_bypasses_toggles(tmp_path):
    """test 事件忽略事件开关——通道验收专用。"""
    nt = _load()
    stub = _channel_stub(tmp_path, tmp_path / "m5")
    proj = _mk(tmp_path, {"channels": [stub], "events": {"blocked": False, "sensory": False}})
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "test", "🔔 通道测试") == 1


def test_failing_channel_never_raises(tmp_path):
    nt = _load()
    proj = _mk(tmp_path, {"channels": ["definitely-not-a-command-xyz {title}",
                                       _channel_stub(tmp_path, tmp_path / "m3")]})
    _trusted(nt, tmp_path, proj)
    ran = nt.notify(str(proj), "finish_open", "t", "b")  # 不抛即过
    assert ran == 1


def test_cli_smoke(tmp_path, monkeypatch):
    proj = _mk(tmp_path, {})
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps(
        {"notify": {"channels": [_channel_stub(tmp_path, tmp_path / "m4") + " {title} {body}"]}}),
        encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))  # 子进程改走机器级（057 后项目级须信任表）
    r = subprocess.run([sys.executable, NOTIFY, str(proj), "blocked",
                        "--title", "🛑 受阻", "--body", "需要：白名单"],
                       capture_output=True, text=True, timeout=15)
    assert r.returncode == 0
    assert "受阻" in (tmp_path / "m4").read_text(encoding="utf-8")


def test_wecom_push_roundtrip(tmp_path, monkeypatch):
    """企业微信推送全链（桩服务器）：gettoken→send，token 缓存生效，未配置降级。"""
    import http.server
    import importlib.util as ilu
    import threading
    hits = []

    class H(http.server.BaseHTTPRequestHandler):
        def _json(self, o):
            b = json.dumps(o).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            hits.append(("GET", self.path))
            self._json({"errcode": 0, "access_token": "T1", "expires_in": 7200})

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            hits.append(("POST", self.path + " " + self.rfile.read(n).decode("utf-8")))
            self._json({"errcode": 0, "errmsg": "ok"})

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv("WECOM_API_BASE", f"http://127.0.0.1:{srv.server_port}")
    monkeypatch.setenv("WECOM_TOKEN_DIR", str(tmp_path / "tk"))
    spec = ilu.spec_from_file_location(
        "wn", os.path.join(LIB, "wecom_notify.py"))
    wn = ilu.module_from_spec(spec)
    spec.loader.exec_module(wn)
    proj = _mk(tmp_path, {"wecom": {"corpid": "wwX", "secret": "S",
                                    "agentid": 1000002, "touser": "@all"}})
    assert wn.main([str(proj), "📋 待批准 R1", "改动 3 文件"]) == 0
    assert any("gettoken" in h[1] for h in hits)
    posts = [h for h in hits if h[0] == "POST"]
    assert posts and "message/send" in posts[0][1] and "待批准 R1" in posts[0][1]
    # token 已缓存：第二次推送不再 GET
    hits.clear()
    wn.main([str(proj), "t2", "b2"])
    assert not any(h[0] == "GET" for h in hits)
    # 未配置项目：exit 1 不炸
    empty = tmp_path / "empty"
    (empty / ".regress").mkdir(parents=True, exist_ok=True)
    assert wn.main([str(empty), "t", "b"]) == 1


def test_wecom_proxy_roundtrip(tmp_path, monkeypatch):
    """proxy 配置（v1.30.1 可信IP中转）：流量必须真的过代理——错凭据 407 时桩不得被触达。"""
    import http.server
    import importlib.util as ilu
    import socket
    import subprocess
    import threading
    hits = []

    class H(http.server.BaseHTTPRequestHandler):
        def _json(self, o):
            b = json.dumps(o).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            hits.append(("GET", self.path))
            self._json({"errcode": 0, "access_token": "T1", "expires_in": 7200})

        def do_POST(self):
            hits.append(("POST", self.path))
            self._json({"errcode": 0, "errmsg": "ok"})

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    px_port = s.getsockname()[1]
    s.close()
    proxy = subprocess.Popen(
        [sys.executable, os.path.join(os.path.dirname(__file__), "..", "deploy", "vps_proxy.py"),
         str(px_port), "u1", "p1"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    import time
    for _ in range(50):  # 等代理完成 bind（Popen 后立即连会拒连）
        try:
            socket.create_connection(("127.0.0.1", px_port), 0.2).close()
            break
        except OSError:
            time.sleep(0.1)

    try:
        monkeypatch.setenv("WECOM_API_BASE", f"http://127.0.0.1:{srv.server_port}")
        spec = ilu.spec_from_file_location("wn2", os.path.join(LIB, "wecom_notify.py"))
        wn = ilu.module_from_spec(spec)
        spec.loader.exec_module(wn)
        base = {"corpid": "wwX", "secret": "S", "agentid": 1000002, "touser": "@all"}

        # 正确凭据：过代理送达桩
        monkeypatch.setenv("WECOM_TOKEN_DIR", str(tmp_path / "tk_ok"))
        proj = _mk(tmp_path, {"wecom": dict(base, proxy=f"http://u1:p1@127.0.0.1:{px_port}")})
        assert wn.main([str(proj), "t", "b"]) == 0
        assert any("gettoken" in h[1] for h in hits) and \
            any(h[0] == "POST" and "message/send" in h[1] for h in hits)

        # 错误凭据：代理 407，请求到不了桩（证明确实走了代理）
        hits.clear()
        monkeypatch.setenv("WECOM_TOKEN_DIR", str(tmp_path / "tk_bad"))
        proj2 = _mk(tmp_path, {"wecom": dict(base, proxy=f"http://u1:bad@127.0.0.1:{px_port}")})
        assert wn.main([str(proj2), "t", "b"]) == 2  # best-effort 不炸；rc=2=推送失败不计通道数
        assert not hits
    finally:
        proxy.terminate()
        srv.shutdown()


# ─── v1.70 wecom 凭据字段门 + API 基域钉住（059，run4 R2） ────────

def test_wecom_cred_fields_gated(tmp_path, monkeypatch, capsys):
    """未受信项目：corpid/secret 覆盖回退机器级，agentid 覆盖存活+stderr 提示。"""
    nt = _load()
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {"wecom": {
        "corpid": "wwM", "secret": "SM", "agentid": 1}}}), encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    proj = _mk(tmp_path, {"wecom": {"corpid": "EVIL", "secret": "ES", "agentid": 2}})
    cfg = nt.load_conf(str(proj))
    assert cfg["wecom"]["corpid"] == "wwM" and cfg["wecom"]["secret"] == "SM"
    assert cfg["wecom"]["agentid"] == 2  # 非凭据字段覆盖存活
    assert "凭据字段未受信" in capsys.readouterr().err


def test_wecom_cred_fields_trusted(tmp_path, monkeypatch, capsys):
    """受信项目：corpid 覆盖生效（多项目自有凭据的合法路径）。"""
    nt = _load()
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {"wecom": {
        "corpid": "wwM", "secret": "SM", "agentid": 1}}}), encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    proj = _mk(tmp_path, {"wecom": {"corpid": "wwP", "secret": "SP"}})
    _trusted(nt, tmp_path, proj)
    cfg = nt.load_conf(str(proj))
    assert cfg["wecom"]["corpid"] == "wwP"
    assert "凭据字段未受信" not in capsys.readouterr().err


def test_api_base_pinned(tmp_path, monkeypatch, capsys):
    """_api_base 四态：恶域钉回/本机放行/allowlist 放行/无 env 官方域。"""
    import importlib.util as ilu
    w = ilu.spec_from_file_location("wn", os.path.join(LIB, "wecom_notify.py"))
    wn = ilu.module_from_spec(w); w.loader.exec_module(wn)
    d = "https://qyapi.weixin.qq.com/cgi-bin"
    monkeypatch.setenv("WECOM_API_BASE", "https://evil.example/x")
    assert wn._api_base({}) == d  # 恶域钉回
    assert "钉回" in capsys.readouterr().err
    monkeypatch.setenv("WECOM_API_BASE", "http://127.0.0.1:9/x")
    assert wn._api_base({}).startswith("http://127.0.0.1")  # 本机桩放行
    monkeypatch.setenv("WECOM_API_BASE", "https://proxy.corp/x")
    assert wn._api_base({"api_base_allowlist": ["https://proxy.corp/x"]}) == "https://proxy.corp/x"
    monkeypatch.delenv("WECOM_API_BASE")
    assert wn._api_base({}) == d  # 无 env 官方域


# ─── v1.85.4 机器配置路径半收口（079）─────────────────

def test_machine_conf_path_home_injection_neutralized(tmp_path, monkeypatch):
    """攻击回放（v1.68 同族）：注入 HOME 指向 /tmp/pwn，默认路径仍 passwd 派生。"""
    nt = _load()
    monkeypatch.delenv("RG_MACHINE_NOTIFY", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "pwn"))
    p = nt.machine_conf_path()
    assert "pwn" not in p
    import pwd
    assert p == os.path.join(pwd.getpwuid(os.getuid()).pw_dir,
                             ".zcode", "regress-notify.json")


def test_machine_conf_path_env_seam_still_works(tmp_path, monkeypatch):
    """运维缝语义：RG_MACHINE_NOTIFY 显式覆盖仍生效（明文化保留，非漏洞）。"""
    nt = _load()
    mach = tmp_path / "ops-notify.json"
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    assert nt.machine_conf_path() == str(mach)


# ─── stats 缓存行（run8 083，波2-A：仪表盘单屏化）─────────────────

def _stats_env(monkeypatch, tmp_path, proj):
    """stats 用例公共隔离：机器台账 env 指到不存在的 tmp 路径 + 项目定位钉到 proj。
    _stats() 无参——数据源全靠 env（RG_SEND_LEDGER / pending 的 RG_PENDING_LEDGER
    同款）；缓存行的项目定位走 journal._find_project_dir，其 CLAUDE_* 优先级高于
    ZCODE_*——先 delenv 防宿主环境污染（钩子进程常带前者）。"""
    monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("RG_SEND_LEDGER", str(tmp_path / "no-send.log"))
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "no-pending.jsonl"))


def test_stats_cache_line_hit(tmp_path, monkeypatch, capsys):
    """1 次缓存命中的历史 → stats 末行输出缓存摘要（措辞同 history.py cache 分支）。"""
    nt = _load()
    proj = _mk(tmp_path, None)
    _stats_env(monkeypatch, tmp_path, proj)
    (proj / ".regress" / "history.jsonl").write_text(
        json.dumps({"event": "commit_passed", "cached": True,
                    "timestamp": "2026-09-21T10:00:00"},
                   ensure_ascii=False) + "\n", encoding="utf-8")
    nt._stats()
    assert "缓存命中：1 次过门禁｜命中 1（100.0%）｜估算节省 118s" \
        in capsys.readouterr().out


def test_stats_cache_line_empty_history_no_crash(tmp_path, monkeypatch, capsys):
    """空（缺席）历史 → stats 照常输出不崩，缓存行如实报 0（增强不是依赖）。"""
    nt = _load()
    proj = _mk(tmp_path, None)
    _stats_env(monkeypatch, tmp_path, proj)
    nt._stats()  # .regress/ 在而 history.jsonl 缺席
    out = capsys.readouterr().out
    assert "观察仪表盘" in out  # 其余行照常输出
    assert "缓存命中：0 次过门禁｜命中 0（0.0%）｜估算节省 0s" in out
