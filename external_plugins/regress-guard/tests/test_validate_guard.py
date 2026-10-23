"""架构守卫（validate 5/5）的负路径测试——从未失败过的守卫等于未验证的守卫。"""
import glob
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TRAP = os.path.join(ROOT, "hooks", "scripts", "_zz_trap_guardtest.py")


def test_architecture_guard_detects_planted_violation():
    """种一个 lib 之外的块解析正则 → validate 的 grep 必须检出（finally 清理防留 trap）。"""
    try:
        with open(TRAP, "w", encoding="utf-8") as f:
            f.write('_APPROVED_BLOCK = re.compile(r"^approved:\\s*\\n(?:[ \\t]+.*\\n?)*", re.M)\n')
        r = subprocess.run(
            ["grep", "-l", "-E", r"\^(approved|blocked|provisional):"]
            + glob.glob(os.path.join(ROOT, "hooks", "scripts", "*.py")),
            capture_output=True, text=True, timeout=10)
        assert TRAP in r.stdout, "守卫失明：种了违规未检出"
    finally:
        if os.path.exists(TRAP):
            os.remove(TRAP)
    # 清理后守卫应恢复干净
    r2 = subprocess.run(
        ["grep", "-l", "-E", r"\^(approved|blocked|provisional):"]
        + glob.glob(os.path.join(ROOT, "hooks", "scripts", "*.py")),
        capture_output=True, text=True, timeout=10)
    assert r2.stdout.strip() == "", f"清理后仍有残留检出: {r2.stdout}"


def test_lib_single_source_has_the_patterns():
    """正样本：单一来源本身必须包含三个块解析（守卫没把合法宿主也禁了）。"""
    src = open(os.path.join(ROOT, "hooks", "scripts", "lib", "manifest_fields.py"),
               encoding="utf-8").read()
    for block in ("approved", "blocked", "provisional"):
        assert f"^{{{block}}}:\\s" in src or f"^({block}):" in src or block in src


def test_command_byte_budget_warns_on_bloat():
    """v1.23.1 长度预算：超预算命令文件 → warn；预算内 → 静默（正负双路）。"""
    import sys
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import check_docs
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "commands"))
        # 负路：造一个超预算文件
        big = os.path.join(td, "commands", "regress:fat.md")
        with open(big, "w", encoding="utf-8") as f:
            f.write("x" * (check_docs.COMMAND_BYTE_BUDGET + 1))
        errs, warns = [], []
        check_docs.check_v123(td, errs, warns)
        assert not errs and len(warns) == 1 and "regress:fat.md" in warns[0]
        # 正路：删掉后无告警
        os.remove(big)
        with open(os.path.join(td, "commands", "regress:lean.md"), "w",
                  encoding="utf-8") as f:
            f.write("x" * 100)
        errs2, warns2 = [], []
        check_docs.check_v123(td, errs2, warns2)
        assert not errs2 and not warns2


def test_deploy_contract_drift_guard(tmp_path):
    """v1.26.1：REQUIRED_HOOK/LIB 与源目录漂移 → block（病例：2026-09-03 审计半量拷贝）。"""
    import sys
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import check_docs
    # 正路：真实插件目录无漂移
    errs, warns = [], []
    check_docs.check_v1241(ROOT, errs, warns)
    assert not errs, f"真实目录被判漂移: {errs}"
    # 负路：伪源目录多一个脚本不在清单 → 报错
    import shutil
    proj = tmp_path / "plug"
    (proj / "hooks" / "scripts" / "lib").mkdir(parents=True)
    heal = proj / "hooks" / "scripts" / "self_heal.py"
    heal.write_text('REQUIRED_HOOK_FILES = ["a.py"]\nREQUIRED_LIB_FILES = ["l.py"]\n',
                    encoding="utf-8")
    (proj / "hooks" / "scripts" / "a.py").write_text("", encoding="utf-8")
    (proj / "hooks" / "scripts" / "zzz_extra.py").write_text("", encoding="utf-8")
    (proj / "hooks" / "scripts" / "lib" / "l.py").write_text("", encoding="utf-8")
    (proj / "hooks" / "scripts" / "lib" / "zzz_lib.py").write_text("", encoding="utf-8")
    errs2, _ = [], []
    check_docs.check_v1241(str(proj), errs2, _)
    assert any("zzz_extra" in e for e in errs2) and any("zzz_lib" in e for e in errs2)


def test_doc_coverage_matrix_both_paths(tmp_path):
    """v1.27：文档层覆盖矩阵——正路真实仓库全绿；负路缺词必拦（v1.25/26 腐烂病例）。"""
    import sys
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import check_docs
    errs, warns = [], []
    check_docs.check_v127(ROOT, errs, warns)
    assert not errs, f"真实仓库覆盖不全: {errs}"
    # 负路：伪造缺词文档
    proj = tmp_path / "plug2"
    (proj / "docs").mkdir(parents=True)
    (proj / "docs" / "WORKFLOW.md").write_text("这里没有能力词\n", encoding="utf-8")
    saved = dict(check_docs.DOC_COVERAGE)
    try:
        check_docs.DOC_COVERAGE = {"验收标准": ("docs/WORKFLOW.md",)}
        errs2, _w = [], []
        check_docs.check_v127(str(proj), errs2, _w)
        assert any("验收标准" in e for e in errs2)
    finally:
        check_docs.DOC_COVERAGE = saved


def test_gate_liveness_watchdog_both_paths(tmp_path):
    """v1.27.2：链外看门狗——空 matcher 配置必拦（本周病例）；干净配置+无日志静默。"""
    import sys
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import check_docs
    # 负路：空 matcher 配置 → error
    bad_cfg = tmp_path / "config.json"
    bad_cfg.write_text(json.dumps(
        {"hooks": {"enabled": True, "events": {
            "UserPromptSubmit": [{"matcher": "", "hooks": []}]}}}),
        encoding="utf-8")
    errs, warns = [], []
    check_docs.check_gate_liveness(str(tmp_path), errs, warns,
                                   cfg_path=str(bad_cfg),
                                   log_dir=str(tmp_path / "nologi"))
    assert any("空 matcher" in e for e in errs)
    # 正路：干净配置 + 无日志目录 → 全静默
    good_cfg = tmp_path / "config2.json"
    good_cfg.write_text(json.dumps(
        {"hooks": {"enabled": True, "events": {
            "UserPromptSubmit": [{"hooks": []}]}}}),
        encoding="utf-8")
    errs2, warns2 = [], []
    check_docs.check_gate_liveness(str(tmp_path), errs2, warns2,
                                   cfg_path=str(good_cfg),
                                   log_dir=str(tmp_path / "nologi"))
    assert not errs2 and not warns2
    # 日志负路：含 invalid 记录 → warn
    logd = tmp_path / "logs"; logd.mkdir()
    (logd / "zcode-2026-09-03.jsonl").write_text(
        '{"event":"config.file.invalid"}\n', encoding="utf-8")
    errs3, warns3 = [], []
    check_docs.check_gate_liveness(str(tmp_path), errs3, warns3,
                                   cfg_path=str(good_cfg), log_dir=str(logd))
    assert not errs3 and any("config.file.invalid" in w for w in warns3)
