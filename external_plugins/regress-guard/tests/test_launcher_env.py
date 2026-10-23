"""launcher.js cleanEnv 白名单行为钉（REGRESS-2026-078 F1；前身：058/v1.69 部分钉）。

观测路径：node 子进程 require launcher.js（module.exports 导出 cleanEnv/ENV_KEEP，
require.main 守卫保证被 require 时不 spawn 守卫——test_require_does_not_spawn 钉此
合同），对子进程**真实 process.env** 应用 cleanEnv 后 JSON 回传。子进程 env 由
pytest 完全构造，因此钉的正是生产调用形态 cleanEnv(process.env)（launcher.js
tryPython 内）的输入→输出行为，不钉内部实现细节。

钉死面（白名单改坏任一方向都红）：
- 删条目：test_whitelist_var_kept 逐变量红（19 项全覆盖）
- 增条目（放宽 creep）：test_whitelist_exact_set 红——白名单内容本身即安全合同
- 剥离失效：test_poison_env_fully_stripped / test_mixed_env_exact_output 红

本文件重写自 058 的 3 用例部分钉（毒 env 剥离/契约保留/小写归一），语义全部
吸收进下方用例；另修掉旧版 _clean 里的预热调试残留。
"""
import json
import os
import shutil
import subprocess
import sys

import pytest

LAUNCHER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "hooks", "scripts", "launcher.js"))
NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node 不在 PATH，无法观测 launcher.js")

# launcher.js ENV_KEEP 实测 19 项 = 9 系统 + 4 代理 + 6 契约（按实现冻结，非清单口述数）
EXPECTED_KEEP = (
    "ALL_PROXY", "CLAUDE_PROJECT_DIR", "CLAUDE_SESSION_ID", "HOME",
    "HTTP_PROXY", "HTTPS_PROXY", "LANG", "LC_ALL", "LC_CTYPE", "NO_PROXY",
    "PATH", "SYSTEMROOT", "TERM", "TMPDIR", "TZ", "ZCODE_HOME",
    "ZCODE_PLUGIN_ROOT", "ZCODE_PROJECT_DIR", "ZCODE_SESSION_ID",
)

# 白名单外样本：自定义变量、RG_*/WECOM_*/GIT_* 覆盖类注入、云凭据敏感样本
_POISON = {
    "MY_CUSTOM_VAR": "custom",
    "RG_ATTACK": "1",
    "RG_BYPASS_UNTIL": "2099-01-01T00:00:00",
    "RG_TRUSTED_PROJECTS": "/tmp/evil",
    "RG_TRUST_PROJECT_CHANNELS": "1",
    "RG_MACHINE_NOTIFY": "/tmp/evil.json",
    "WECOM_API_BASE": "https://evil.example",
    "WECOM_WEBHOOK": "https://evil.example/wh",
    "GIT_DIR": "/tmp/fake.git",
    "GIT_INDEX_FILE": "/tmp/poison",
    "AWS_SECRET_ACCESS_KEY": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "AWS_ACCESS_KEY_ID": "AKIAIOSFODNN7EXAMPLE",
    "CI": "true",
}

_PROBE_CLEAN_ENV = (
    "const { cleanEnv } = require(process.argv[1]);"
    "console.log(JSON.stringify(cleanEnv(process.env)));"
)
_PROBE_ENV_KEEP = (
    "const m = require(process.argv[1]);"
    "console.log(JSON.stringify(Array.from(m.ENV_KEEP).sort()));"
)


def _probe(script, env):
    try:
        r = subprocess.run(
            [NODE, "-e", script, LAUNCHER], capture_output=True, text=True,
            timeout=30, env=env)
    except subprocess.TimeoutExpired:
        pytest.fail("node 探针超时：launcher.js 可能阻死")
    if r.returncode != 0:
        pytest.fail(f"node 探针退出码 {r.returncode}\nstderr: {r.stderr[:500]}")
    return json.loads(r.stdout)


def _clean(env_dict):
    """以 env_dict 为子进程真实 env，观测 cleanEnv(process.env) 的输出。"""
    return _probe(_PROBE_CLEAN_ENV, env_dict)


# ---------- ① 白名单内保留 ----------

@pytest.mark.parametrize("var", EXPECTED_KEEP)
def test_whitelist_var_kept(var):
    """①逐变量保留：白名单变量原键名、原值到达输出，同 env 的毒变量被剥离。"""
    sentinel = f"keep-{var.lower()}"
    out = _clean({var: sentinel,
                  "MY_CUSTOM_VAR": "x",
                  "AWS_SECRET_ACCESS_KEY": "sekrit"})
    assert out == {var: sentinel}


def test_whitelist_exact_set():
    """①补充：ENV_KEEP 全集双向钉——删条目由逐变量用例红，增条目（放宽）只在此红。

    白名单内容即安全合同（RG_* 等覆盖类变量一旦混入即信任面破口），全集等值
    不是钉实现细节，是钉合同本身。"""
    assert _probe(_PROBE_ENV_KEEP, dict(os.environ)) == sorted(EXPECTED_KEEP)


# ---------- ② 白名单外剥离 ----------

@pytest.mark.skipif(sys.platform == "win32",
                    reason="Windows 下 node 需要 SYSTEMROOT，空输出断言仅 POSIX 成立")
def test_poison_env_fully_stripped():
    """②纯毒 env：自定义/RG_*/WECOM_*/GIT_*/AWS_* 全部剥离，输出恰为 {}。"""
    assert _clean(dict(_POISON)) == {}


def test_mixed_env_exact_output():
    """②混合 env：输出恰等于白名单子集（精确字典等值，多留一个/少留一个都红）。"""
    keep = {
        "PATH": "/usr/bin:/bin",
        "HOME": "/home/tester",
        "LANG": "C.UTF-8",
        "TZ": "Asia/Shanghai",
        "HTTP_PROXY": "http://127.0.0.1:8080",
        "ZCODE_SESSION_ID": "sess-1",
        "CLAUDE_PROJECT_DIR": "/proj",
        "ZCODE_PLUGIN_ROOT": "/plugin/root",
    }
    out = _clean({**keep, **_POISON})
    assert out == keep


# ---------- ③ 大小写归一 ----------

def test_case_normalized_comparison_keeps_original_key():
    """③小写/混合形态：比较大写归一命中白名单，输出保留调用方原键名。"""
    out = _clean({"path": "/lower", "zcode_session_id": "s-lower",
                  "http_proxy": "p-lower",
                  "rg_attack": "1", "aws_secret_access_key": "k"})
    assert out == {"path": "/lower", "zcode_session_id": "s-lower",
                   "http_proxy": "p-lower"}


@pytest.mark.skipif(sys.platform == "win32",
                    reason="Windows env 键大小写不区分，三形态共存仅 POSIX 可观测")
def test_path_and_PATH_coexist():
    """③path= 与 PATH= 双形态：各自独立判定、各自原样保留（归一只用于比较，不改名不合并）。"""
    out = _clean({"path": "/lower", "Path": "/mixed", "PATH": "/upper"})
    assert out == {"path": "/lower", "Path": "/mixed", "PATH": "/upper"}


# ---------- 导出面合同 ----------

def test_require_does_not_spawn():
    """require launcher.js 不启动守卫（require.main 守卫）——本测试族观测路径的安全前提。"""
    r = subprocess.run(
        [NODE, "-e", f"require({json.dumps(LAUNCHER)}); console.log('LOADED_OK')"],
        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0
    assert "LOADED_OK" in r.stdout
    assert "REGRESS-GUARD" not in r.stderr
