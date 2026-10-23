"""secret_scan — gitleaks-lite（v1.42 供应链层，REGRESS-2026-031）。

夹具纪律：测试里的假密钥一律运行时拼接组装（"AKIA" + "ABCD…"），源码里
不出现完整字面量——否则本测试文件自己的提交就会被门禁拦（自指陷阱）。
"""
import os

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks",
                                   "scripts", "lib"))
SCAN = os.path.join(LIB, "secret_scan.py")

# 运行时拼接的夹具（源码无完整字面量）
_AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"          # 16 位大写字母数字
_PEM = "-----BEGIN " + "OPENSSH PRIVATE KEY-----"
_DOC_EXAMPLE = "AKIA" + "IOSFODNN7EXAMPLE"   # AWS 文档标准示例（在允许表）


def _load():
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("ss_test", SCAN)
    m = ilu.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _diff(path, *lines):
    out = [f"+++ b/{path}", "@@ -0,0 +1,{len(lines)} @@"]
    out += ["+" + l for l in lines]
    return "\n".join(out)


def test_high_precision_hit_and_lineno():
    ss = _load()
    hits = ss.scan_added_lines(_diff("src/env.py", f"key = '{_AKIA}'", "x = 1"))
    assert len(hits) == 1 and hits[0][0] == "AWS AccessKey"
    assert hits[0][1] == "src/env.py" and hits[0][2] == 1


def test_private_key_block():
    ss = _load()
    hits = ss.scan_added_lines(_diff("deploy/id_rsa", _PEM))
    assert hits and hits[0][0] == "私钥块"


def test_high_precision_not_exempt_in_tests():
    """高精度模式不豁免 tests/——真密钥漏在测试里也是漏。"""
    ss = _load()
    hits = ss.scan_added_lines(_diff("tests/leak.py", f"k = '{_AKIA}'"))
    assert len(hits) == 1


def test_generic_exempt_in_tests_and_md():
    """通用 key=value：tests/ 与 *.md 是假密钥合法聚集地。"""
    ss = _load()
    pair = "api_key = '" + "a1b2c3d4e5f6g7h8i9j0k1l2" + "'"
    assert ss.scan_added_lines(_diff("tests/t.py", pair)) == []
    assert ss.scan_added_lines(_diff("docs/x.md", pair)) == []
    assert ss.scan_added_lines(_diff("src/cfg.py", pair))  # src 里命中


def test_generic_quoted_required():
    """不带引号的赋值（配置模板占位/常量名）不命中——降噪。"""
    ss = _load()
    assert ss.scan_added_lines(_diff("src/c.py", "secret = " + "x" * 25)) == []


def test_deleted_lines_not_scanned():
    """只扫新增行——删除行里的（历史）密钥是全仓审计工具的职责。"""
    ss = _load()
    diff = ("+++ b/src/env.py\n@@ -1,1 +0,0 @@\n-" + f"key = '{_AKIA}'")
    assert ss.scan_added_lines(diff) == []


def test_builtin_allowlist_doc_example():
    ss = _load()
    assert ss.scan_added_lines(_diff("README.md", f"export AWS={_DOC_EXAMPLE}")) == []
    # md 对高精度本就不豁免——放行靠的是文档示例在允许表
    assert ss.scan_added_lines(_diff("README.md", f"export AWS={_AKIA}"))
