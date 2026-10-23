#!/usr/bin/env python3
"""held-out 验收门（v1.90.0，批 106：稳定性条件 1 的补法）。

真 held-out 的判定：期望值不住在可被本批合法改写的 tests/ 里。本门的八场景
冻结束直连 hooks/scripts 各脚本（run_guard 契约：JSON stdin + CLAUDE_PROJECT_DIR
subprocess），期望与实况对账；基线住工作区 .regress/heldout-baseline.json
（树键排除面），束摘要哈希钉住——改场景必须显式 --refreeze（journal 留痕），
防静默削弱=Goodhart 锁（稳定性条件表第 1 行 Absent→Partial 的实体）。

exit 语义：0=对账通过（含首跑自动冻结/改善只报不拦）；3=退化（过→不过）；
4=束哈希变（需显式重冻）；其它=束自身故障（调用方 fail-open 记 note）。
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# v1.92.8（119）：钩子目录解析序列——源码布局 ../hooks/scripts 在场用它
# （开发态），否则 dirname(__file__) 平铺（部署态——恰测线上钩子副本，
# 语义更真：held-out 测的是"现在生效的钩子还满足期望吗"）。部署副本旧于
# 源码时束 digest 与工作区基线不匹配自然触发 exit 4 锁（无需显式哈希校验）。
_HOOKS_CANDIDATES = [
    os.path.join(ROOT, "hooks", "scripts"),
    os.path.dirname(os.path.abspath(__file__)),
]
_HOOKS = next((d for d in _HOOKS_CANDIDATES
               if os.path.exists(os.path.join(d, "pre_commit_guard.py"))),
              os.path.join(ROOT, "hooks", "scripts"))
GUARD = os.path.join(_HOOKS, "pre_commit_guard.py")
VALVE = os.path.join(_HOOKS, "execution_valve.py")  # 120：119 解析序列漏网（部署位 ROOT 断链致 H6 假 fail，部署位束逮住）
RGUARD = os.path.join(_HOOKS, "read_before_edit_guard.py")

_S_MANIFEST = ("---\nid: R1\nstatus: in-progress\ntier: S\n"
               "rollback: git revert\nplanned_changes:\n  - id: F1\n"
               "    file: src/app.js\nactual_changes: []\n---\n")
_M_MANIFEST = ("---\nid: R1\nstatus: in-progress\ntier: M\n"
               "rollback: git revert\n"
               "understood_intent:\n"
               "  复述: \"补 held-out 束\"\n"
               "  边界: \"只测门禁契约\"\n"
               "  判据: \"验收全过\"\n"
               "scan:\n"
               "  entry: \"hooks/scripts/pre_commit_guard.py\"\n"
               "  test: \"python3 -m pytest test_smoke.py -q\"\n"
               "  card: \"钩子拦截链\"\n"
               "planned_changes:\n  - id: F1\n"
               "    file: src/app.js\nactual_changes: []\n---\n"
               "\n## 验收标准\n\n"
               "- When 发起请求，则 返回 200（验：python3 -m pytest test_smoke.py -q）✅\n"
               "\n## 深查节\n"  # 121：6.5b 在场性——M 档 fixture 随规格变更（105 先例）
               "- 反问一·验证位错位：束直连钩子即运行位无错位\n"
               "- 反问二·判据外推：场景期望词随措辞漂移的风险已有 has 断言\n"
               "- 反问三·心虚探测：fixture 与门禁演进的耦合依赖用例同步\n")


def _git(p, *args):
    subprocess.run(["git", *args], cwd=str(p), check=True,
                   capture_output=True)


def _mk_project(root, name="proj", manifest=_S_MANIFEST, runner=False,
                stage="src/app.js", content="x = 1\n"):
    p = root / name
    (p / "src").mkdir(parents=True)
    (p / ".regress" / "manifests").mkdir(parents=True)
    _git(p, "init", "-q")
    _git(p, "config", "user.email", "t@t.com")
    _git(p, "config", "user.name", "t")
    (p / ".regress" / "manifests" / "R1.md").write_text(
        manifest, encoding="utf-8")
    if runner:
        (p / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
        (p / "test_smoke.py").write_text(
            "def test_ok():\n    assert True\n", encoding="utf-8")
    if stage:
        (p / stage).write_text(content, encoding="utf-8")
        _git(p, "add", "-A")
    return p


def _mk_sub(root, name, files):
    p = root / name
    p.mkdir(parents=True)
    _git(p, "init", "-q")
    _git(p, "config", "user.email", "t@t.com")
    _git(p, "config", "user.name", "t")
    for rel, text in files.items():
        f = p / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    _git(p, "add", "-A")
    _git(p, "commit", "-qm", "init")
    return p


def _sh(script, command, project, argv=None, env_extra=None, payload=None):
    """run_guard 契约：JSON stdin、剥离会话变量、钉 PROJECT_DIR。
    v1.92.3（114）扩：argv（读门禁等需 mode 参数的脚本）、env_extra（会话隔离——
    读门禁状态按会话键隔离，场景必须各用独立会话防串场）、payload
    （stdin 的 tool_input 覆写——Edit/Write 形态场景用）。"""
    env = dict(os.environ)
    env.pop("CLAUDE_SESSION_ID", None)
    env.pop("ZCODE_SESSION_ID", None)
    env["CLAUDE_PROJECT_DIR"] = str(project)
    env.update(env_extra or {})
    ti = payload if payload is not None else {"command": command}
    inp = json.dumps({"tool_name": ti.get("_tool", "Bash"),
                      "tool_input": {k: v for k, v in ti.items()
                                     if not k.startswith("_")}})
    proc = subprocess.run(
        ["python3", script] + (argv or []), input=inp, capture_output=True,
        text=True, env=env, cwd=str(project), timeout=30)
    return proc.returncode, proc.stderr


def _sc_h1(root):  # 复合暂存+提交拦（091）
    p = _mk_project(root, "h1")
    return GUARD, "git add src/app.js && git commit -m 改动（R1）", p


def _sc_h2(root):  # M 计数缺席拦（105）
    p = _mk_project(root, "h2", manifest=_M_MANIFEST, runner=True)
    return GUARD, "git commit -m 改动（R1）说明", p


def _sc_h3(root):  # 计数不符拦（092）
    p = _mk_project(root, "h3", manifest=_M_MANIFEST, runner=True)
    return GUARD, "git commit -m 改动（R1）说明；5/5", p


def _sc_h4(root):  # F3 暂存越界拦
    p = _mk_project(root, "h4", manifest=_S_MANIFEST, runner=True,
                    stage="src/other.js")
    return GUARD, "git commit -m 改动（R1）说明", p


def _sc_h5(root):  # M 缺清单号拦（092）
    p = _mk_project(root, "h5", manifest=_M_MANIFEST, runner=True)
    return GUARD, "git commit -m 改动说明", p


def _sc_h6(root):  # 执行阀令牌（灾难模式拒，零副作用——命令永不真执行）
    p = _mk_project(root, "h6", stage=None)
    return VALVE, "mkfs.ext4 /dev/sdz9", p


def _sc_h7(root):  # 泛型名不锚定子仓（103，放行场景）
    p = _mk_project(root, "h7", manifest=_S_MANIFEST.replace(
        "file: src/app.js", "file: README.md"), runner=True, stage=None)
    (p / "README.md").write_text("p\n", encoding="utf-8")
    _git(p, "add", "-A")
    demo = _mk_sub(root, "demo-project", {
        "README.md": "demo\n", ".gitignore": "x\n",
        "src/math.js": "m = 1\n"})
    (demo / "src" / "math.js").write_text("m = 2\n", encoding="utf-8")
    _git(demo, "add", "-A")  # 陈旧暂存标本：不得混入
    return GUARD, "git commit -m 改动（R1）", p


def _sc_h8(root):  # 验收未勾拦（v1.55）
    m = _M_MANIFEST.replace("✅\n", "\n")  # 摘掉勾=未验
    p = _mk_project(root, "h8", manifest=m, runner=True)
    return GUARD, "git commit -m 改动（R1）说明；1/1", p


def _sc_h9(root):  # 密钥泄漏拦（v1.42 供应链层）——假 AKIA 键（非白名单示例值）
    p = _mk_project(root, "h9", manifest=_S_MANIFEST.replace(
        "file: src/app.js", "file: config.py"), runner=True,
        stage="config.py", content='key = "AKIAZZYYXXWWVVUUTSRQ"\n')
    return GUARD, "git commit -m 改动（R1）", p


def _sc_h10(root):  # 缓存伪键拒绝（v1.85 键敏感契约）——错误键条目不命中，
    # 门禁照常全量跑（stderr 无 ♻️）；断言走 expect_none 特判
    p = _mk_project(root, "h10", manifest=_S_MANIFEST, runner=True)
    cc = p / ".regress" / "test-cache.jsonl"
    import json as _j
    import time as _t
    cc.write_text(_j.dumps({"key": "deadbeef", "status": "pass",
                            "ts": _t.time()}) + "\n", encoding="utf-8")
    return GUARD, "git commit -m 改动（R1）", p


def _sc_h11(root):  # append-only 违例拦（112，野外 msg521）——直连读门禁 pre 模式
    p = _mk_project(root, "h11", stage=None)
    d = p / ".regress" / "decisions.md"
    d.parent.mkdir(parents=True, exist_ok=True)
    d.write_text("# 决策日志\n\n## 旧条目\n- 内容甲\n", encoding="utf-8")
    return RGUARD, None, p, {
        "argv": ["pre"], "env": {"CLAUDE_SESSION_ID": "heldout-h11"},
        "payload": {"_tool": "Edit", "file_path": str(d),
                    "old_string": "## 旧条目\n- 内容甲\n",
                    "new_string": "## 旧条目\n"}}


def _sc_h12(root):  # 盲潜地板拦（111，野外 F1 新判据链）——独立会话零读即改
    p = _mk_project(root, "h12", stage=None)
    (p / "src").mkdir(parents=True, exist_ok=True)
    (p / "src" / "x.js").write_text("x = 1\n", encoding="utf-8")
    return RGUARD, None, p, {
        "argv": ["pre"], "env": {"CLAUDE_SESSION_ID": "heldout-h12"},
        "payload": {"_tool": "Edit",
                    "file_path": str(p / "src" / "x.js")}}


def _sc_h13(root):  # 写后补戳防误拦（116，标本回放：Edit→Edit 连写）
    p = _mk_project(root, "h13", stage=None)
    (p / "src").mkdir(parents=True, exist_ok=True)
    f = p / "src" / "x.js"
    f.write_text("x = 1\n", encoding="utf-8")
    env = {"CLAUDE_SESSION_ID": "heldout-h13"}
    _e = {"_tool": "Edit", "file_path": str(f)}
    return RGUARD, None, p, {"steps": [
        {"sh": {"argv": ["post"], "env": env,
                "payload": {"_tool": "Read", "file_path": str(f)}}},
        {"sh": {"argv": ["pre"], "env": env, "payload": _e}},   # 放行
        {"write": [str(f), "x = 2\n"]},                          # 宿主写入实况
        {"sh": {"argv": ["post"], "env": env, "payload": _e}},   # 116 补戳
        {"sh": {"argv": ["pre"], "env": env, "payload": _e}},    # 末步：不误拦
    ]}


def _sc_h14(root):  # 补戳后外部改仍拦（116 牙齿保留）
    p = _mk_project(root, "h14", stage=None)
    (p / "src").mkdir(parents=True, exist_ok=True)
    f = p / "src" / "x.js"
    f.write_text("x = 1\n", encoding="utf-8")
    env = {"CLAUDE_SESSION_ID": "heldout-h14"}
    _e = {"_tool": "Edit", "file_path": str(f)}
    return RGUARD, None, p, {"steps": [
        {"sh": {"argv": ["post"], "env": env,
                "payload": {"_tool": "Read", "file_path": str(f)}}},
        {"sh": {"argv": ["pre"], "env": env, "payload": _e}},
        {"write": [str(f), "x = 2\n"]},
        {"sh": {"argv": ["post"], "env": env, "payload": _e}},   # 补写后实况
        {"write": [str(f), "x = 3\n"]},                          # 第三方再改
        {"sh": {"argv": ["pre"], "env": env, "payload": _e}},    # 末步：拦
    ]}


SCENARIOS = [
    {"id": "H1-compound", "build": _sc_h1, "code": 2, "has": "复合"},
    {"id": "H2-count-absent", "build": _sc_h2, "code": 2, "has": "计数"},
    {"id": "H3-count-mismatch", "build": _sc_h3, "code": 2, "has": "不符"},
    {"id": "H4-staged-undeclared", "build": _sc_h4, "code": 2, "has": "不在回归清单"},
    {"id": "H5-no-manifest-ref", "build": _sc_h5, "code": 2, "has": "清单号"},
    {"id": "H6-valve-token", "build": _sc_h6, "code": 2, "has": "不可逆"},
    {"id": "H7-generic-no-anchor", "build": _sc_h7, "code": 0, "has": ""},
    {"id": "H8-acceptance-open", "build": _sc_h8, "code": 2, "has": "验收未勾"},
    {"id": "H9-secret-leak", "build": _sc_h9, "code": 2, "has": "密钥"},
    {"id": "H10-cache-poison-key", "build": _sc_h10, "code": 0,
     "has": "", "expect_none": "♻️"},
    {"id": "H11-append-only", "build": _sc_h11, "code": 2, "has": "append-only"},
    {"id": "H12-blind-dive", "build": _sc_h12, "code": 2, "has": "盲潜"},
    {"id": "H13-post-stamp-no-block", "build": _sc_h13, "code": 0,
     "has": "", "expect_none": "指纹不匹配"},
    {"id": "H14-post-stamp-teeth", "build": _sc_h14, "code": 2, "has": "指纹"},
]



def scenarios_digest(scenarios):
    """束摘要哈希：钉住 id+期望（code/has）——防静默改场景（Goodhart 锁）。
    build 函数不可序列化，脚本归属经 id 间接钉住（场景 id 与目标脚本是稳定映射）。"""
    core = [{"id": s["id"], "code": s["code"], "has": s["has"],
             "expect_none": s.get("expect_none") or ""}
            for s in scenarios]
    blob = json.dumps(core, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def baseline_path(project_dir):
    return os.path.join(str(project_dir), ".regress", "heldout-baseline.json")


def run_battery(scenarios=SCENARIOS, verbose=True):
    """跑全束，返回 {id: pass|fail}（pass=与冻结期望一致）。"""
    outcomes = {}
    with tempfile.TemporaryDirectory(prefix="heldout-") as td:
        from pathlib import Path
        root = Path(td)
        for s in scenarios:
            try:
                ret = s["build"](root)
                script, command, proj = ret[0], ret[1], ret[2]
                extra = ret[3] if len(ret) > 3 else {}
                code, err = None, ""
                if extra.get("steps"):
                    # v1.92.7（118）多步序列：写后补戳链天然多步（post→pre→写→
                    # post→pre）。项二态：{"sh":{argv,env,payload}} 钩子调用 /
                    # {"write":[path,content]} 文件写。末 sh 步做期望判定；
                    # 中间 sh 步非 0 记 error（序列前提被破坏）。
                    for st in extra["steps"]:
                        if "write" in st:
                            with open(st["write"][0], "w",
                                      encoding="utf-8") as wf:
                                wf.write(st["write"][1])
                            continue
                        sh = st["sh"]
                        code, err = _sh(script, command, proj,
                                        argv=sh.get("argv"),
                                        env_extra=sh.get("env"),
                                        payload=sh.get("payload"))
                        if code not in (0, None) and st is not extra["steps"][-1]:
                            outcomes[s["id"]] = f"error:midstep{code}"
                            break
                    else:
                        pass
                    if s["id"] in outcomes:
                        continue
                else:
                    code, err = _sh(script, command, proj,
                                    argv=extra.get("argv") or s.get("argv"),
                                    env_extra=extra.get("env") or s.get("env"),
                                    payload=extra.get("payload")
                                    or s.get("payload"))
                ok = (code == s["code"]
                      and (not s["has"] or s["has"] in err)
                      and (not s.get("expect_none")
                           or s["expect_none"] not in err))
                outcomes[s["id"]] = "pass" if ok else "fail"
            except Exception as e:  # 束故障≠退化：记 fail 但调用方按 5 处理
                outcomes[s["id"]] = f"error:{type(e).__name__}"
            if verbose:
                print(f"  {outcomes[s['id']]:>5}  {s['id']}", file=sys.stderr)
    return outcomes


def _journal(project_dir, kind, **fields):
    try:
        lib = os.path.join(_HOOKS, "lib")
        sys.path.insert(0, lib)
        from journal import journal_append
        journal_append(kind, start_dir=str(project_dir), **fields)
    except Exception:
        pass  # 地层是增强不是依赖


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=os.environ.get(
        "CLAUDE_PROJECT_DIR") or os.getcwd())
    ap.add_argument("--refreeze", action="store_true")
    args = ap.parse_args()
    bp = baseline_path(args.project)
    digest = scenarios_digest(SCENARIOS)

    old = None
    if os.path.exists(bp):
        try:
            old = json.load(open(bp, encoding="utf-8"))
        except Exception:
            old = None

    if args.refreeze:
        outcomes = run_battery(SCENARIOS)
        json.dump({"digest": digest, "outcomes": outcomes,
                   "frozen_at": datetime.now().isoformat()},
                  open(bp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        _journal(args.project, "heldout_refrozen", digest=digest,
                 outcomes=outcomes)
        print(f"held-out 基线已重冻（{digest}）", file=sys.stderr)
        return 0

    if old and old.get("digest") != digest:
        print("REGRESS-GUARD: held-out 场景束已变（摘要不匹配）——期望改动"
              "必须显式：python3 scripts/heldout_gate.py --refreeze"
              "（journal 留痕），不许静默改场景。", file=sys.stderr)
        return 4

    outcomes = run_battery(SCENARIOS)

    if old is None:  # 首跑冻结
        json.dump({"digest": digest, "outcomes": outcomes,
                   "frozen_at": datetime.now().isoformat()},
                  open(bp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        _journal(args.project, "heldout_baseline_frozen", digest=digest)
        print(f"held-out 基线首冻（{len(SCENARIOS)} 场景）", file=sys.stderr)
        return 0

    prev = old.get("outcomes") or {}
    regressed = [i for i, o in outcomes.items()
                 if prev.get(i) == "pass" and o != "pass"]
    improved = [i for i, o in outcomes.items()
                if prev.get(i) not in ("pass", None) and o == "pass"]
    if regressed:
        print(f"REGRESS-GUARD: held-out 退化——{', '.join(regressed)}："
              "冻结期望不再成立。修复行为；确属期望应演进则在批内说明后"
              " --refreeze。", file=sys.stderr)
        _journal(args.project, "heldout_regression",
                 regressed=regressed)
        return 3
    if improved:
        print(f"held-out 改善（{', '.join(improved)}）——建议 --refreeze 收编。",
              file=sys.stderr)
    errored = [i for i, o in outcomes.items() if str(o).startswith("error:")]
    if errored:
        print(f"held-out 束故障（{', '.join(errored)}）——fail-open 记档。",
              file=sys.stderr)
        return 5
    return 0


if __name__ == "__main__":
    sys.exit(main())
