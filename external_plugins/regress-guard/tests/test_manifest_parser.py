"""manifest_parser 的单元测试。

覆盖：正常解析、多列表项、update_frontmatter、edge case、损坏文件。
"""
import sys
import os
import tempfile
import pytest

# 把 lib 目录加入 path
LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")
sys.path.insert(0, LIB)

from manifest_parser import (
    parse_frontmatter, update_frontmatter, find_active_manifest,
    get_all_changed_files, get_manifest_status, HAS_YAML,
)


# ─── 测试夹具 ──────────────────────────────────────────

VALID_MANIFEST = """\
---
id: REGRESS-001
requirement: "登录增加验证码"
status: in-progress
planned_changes:
  - id: F1
    file: "src/auth/login.js"
    type: method-logic
    reason: "增加验证码校验"
    tests_required: [unit, smoke]
    characterization_needed: true
  - id: F2
    file: "src/auth/captcha.js"
    type: new-file
    reason: "验证码模块"
    tests_required: [unit]
    characterization_needed: false
actual_changes:
  - id: F3
    file: "src/utils/validator.js"
    type: new-file
    reason: "连带修改"
    discovered_by: track
    tests_required: [unit]
test_results: {}
created_at: "2026-08-11"
---
# 正文内容
"""

MANIFEST_NO_FRONTMATTER = """\
这只是一个普通 Markdown 文件，没有 frontmatter。
"""

MANIFEST_BROKEN_YAML = """\
---
id: REGRESS-002
status: in-progress
planned_changes: this is not a list
  - broken
---
"""

MANIFEST_MISSING_CLOSER = """\
---
id: REGRESS-003
status: in-progress
"""


@pytest.fixture
def manifest_file(tmp_path):
    """创建一个合法的 manifest 文件。"""
    f = tmp_path / "test.md"
    f.write_text(VALID_MANIFEST, encoding="utf-8")
    return str(f)


@pytest.fixture
def regress_dir(tmp_path):
    """创建含多个 manifest 的 .regress 目录。"""
    rdir = tmp_path / ".regress"
    mdir = rdir / "manifests"
    mdir.mkdir(parents=True)
    (mdir / "R001.md").write_text(VALID_MANIFEST, encoding="utf-8")

    done_manifest = VALID_MANIFEST.replace("status: in-progress", "status: done")
    (mdir / "R000.md").write_text(done_manifest, encoding="utf-8")
    return str(rdir)


# ─── 正常解析测试 ──────────────────────────────────────

def test_parse_basic_fields(manifest_file):
    """基本字段正确解析。"""
    data = parse_frontmatter(manifest_file)
    assert data is not None
    assert data["id"] == "REGRESS-001"
    assert data["status"] == "in-progress"
    assert data["requirement"] == "登录增加验证码"


def test_parse_planned_changes(manifest_file):
    """planned_changes 列表正确解析，不丢项。"""
    data = parse_frontmatter(manifest_file)
    planned = data["planned_changes"]
    assert len(planned) == 2, f"应有 2 个 planned_changes，实际 {len(planned)}"
    assert planned[0]["id"] == "F1"
    assert planned[0]["file"] == "src/auth/login.js"
    assert planned[1]["id"] == "F2"
    assert planned[1]["file"] == "src/auth/captcha.js"


def test_parse_actual_changes(manifest_file):
    """actual_changes 列表正确解析。"""
    data = parse_frontmatter(manifest_file)
    actual = data["actual_changes"]
    assert len(actual) == 1
    assert actual[0]["id"] == "F3"
    assert actual[0]["file"] == "src/utils/validator.js"


def test_parse_tests_required(manifest_file):
    """tests_required 数组正确解析。"""
    data = parse_frontmatter(manifest_file)
    planned = data["planned_changes"]
    assert planned[0]["tests_required"] == ["unit", "smoke"]
    assert planned[1]["tests_required"] == ["unit"]


def test_parse_characterization_needed(manifest_file):
    """布尔字段正确解析。"""
    data = parse_frontmatter(manifest_file)
    assert data["planned_changes"][0]["characterization_needed"] is True
    assert data["planned_changes"][1]["characterization_needed"] is False


# ─── get_all_changed_files ────────────────────────────

def test_get_all_changed_files(manifest_file):
    """planned + actual 的文件都提取出来。"""
    files = get_all_changed_files(manifest_file)
    assert "src/auth/login.js" in files
    assert "src/auth/captcha.js" in files
    assert "src/utils/validator.js" in files
    assert len(files) == 3


# ─── get_manifest_status ──────────────────────────────

def test_get_status(manifest_file):
    assert get_manifest_status(manifest_file) == "in-progress"


# ─── find_active_manifest ─────────────────────────────

def test_find_active_manifest(regress_dir):
    """找到 status != done 的最新清单。"""
    m = find_active_manifest(regress_dir)
    assert m is not None
    assert "R001" in m  # R001 是 in-progress，R000 是 done


def test_find_active_manifest_all_done(regress_dir):
    """全部 done 时返回 None。"""
    # 把 R001 也改成 done
    import glob
    for f in glob.glob(os.path.join(regress_dir, "manifests", "*.md")):
        content = open(f, encoding="utf-8").read()
        content = content.replace("status: in-progress", "status: done")
        open(f, "w", encoding="utf-8").write(content)
    assert find_active_manifest(regress_dir) is None


# ─── update_frontmatter ───────────────────────────────

def test_update_adds_field(manifest_file):
    """update 能新增字段。"""
    update_frontmatter(manifest_file, {"test_verified_by": "hook"})
    data = parse_frontmatter(manifest_file)
    assert data["test_verified_by"] == "hook"


def test_update_preserves_existing(manifest_file):
    """update 不破坏已有字段。"""
    original = parse_frontmatter(manifest_file)
    update_frontmatter(manifest_file, {"status": "done"})
    updated = parse_frontmatter(manifest_file)
    assert updated["status"] == "done"
    assert updated["id"] == original["id"]
    assert len(updated["planned_changes"]) == len(original["planned_changes"])


# ─── Edge cases ───────────────────────────────────────

def test_no_frontmatter(tmp_path):
    """无 frontmatter 的文件返回 None。"""
    f = tmp_path / "no_fm.md"
    f.write_text(MANIFEST_NO_FRONTMATTER, encoding="utf-8")
    assert parse_frontmatter(str(f)) is None


def test_missing_closer(tmp_path):
    """缺少结尾 --- 的文件容错解析（不返回 None，尽量解析）。"""
    f = tmp_path / "no_closer.md"
    f.write_text(MANIFEST_MISSING_CLOSER, encoding="utf-8")
    data = parse_frontmatter(str(f))
    # 容错模式：有开头 --- 即使没结尾 --- 也尝试解析
    assert data is not None, "缺结尾 --- 应容错解析，不应返回 None"
    assert data.get("id") == "REGRESS-003"
    assert data.get("status") == "in-progress"


def test_nonexistent_file():
    """文件不存在返回 None。"""
    assert parse_frontmatter("/nonexistent/file.md") is None


def test_empty_actual_changes(tmp_path):
    """actual_changes: [] 正确解析为空列表。"""
    f = tmp_path / "empty_actual.md"
    f.write_text(
        "---\nid: T\nstatus: in-progress\nplanned_changes: []\nactual_changes: []\n---\n",
        encoding="utf-8"
    )
    data = parse_frontmatter(str(f))
    assert data["actual_changes"] == []
    assert data["planned_changes"] == []


def test_find_active_invented_status(tmp_path):
    """语义反转：AI 自造词（analysis-done 等）不算活跃。"""
    rdir = tmp_path / ".regress" / "manifests"
    rdir.mkdir(parents=True)
    (rdir / "a.md").write_text(
        "---\nid: A\nstatus: analysis-done\nplanned_changes: []\n---\n", encoding="utf-8")
    (rdir / "b.md").write_text(
        "---\nid: B\nstatus: in-progress\nplanned_changes: []\n---\n", encoding="utf-8")
    m = find_active_manifest(str(tmp_path / ".regress"))
    assert m is not None and "b.md" in m  # 只认明确的活跃词


# ── v1.15：模板骨架回归（rescue 字段与新段不得破坏 frontmatter 解析）──

def test_template_frontmatter_parses_with_new_fields():
    """官方模板（含 {{占位符}}）能被 fallback 解析器完整吃下，新字段透传。"""
    import manifest_parser as mp
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    data = mp.parse_frontmatter(os.path.abspath(tmpl))
    assert data, "模板 frontmatter 必须可解析（占位符当字符串值）"
    assert data.get("status") == "planning"
    assert data.get("base_head") == "{{GIT_HEAD_SHORT}}"
    assert isinstance(data.get("approved"), dict) or "approved" in data
    assert isinstance(data.get("blocked"), dict) or "blocked" in data
    assert "provisional" in data  # v1.18 临行块骨架在位
    fps = data.get("fragile_points") or []
    assert fps and isinstance(fps[0], dict)
    assert "rescue" in fps[0], "脆弱点模板条目应含 rescue 键（可选但骨架在）"
    assert "verify" in fps[0] and "status" in fps[0]


def test_template_body_has_amnesia_sections():
    """失忆读者层三段（环境准备/实施顺序/报错自救）骨架在模板里。"""
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    body = open(os.path.abspath(tmpl), encoding="utf-8").read()
    for section in ("环境准备（必读", "实施顺序（一步一响", "报错自救"):
        assert section in body
    assert "写给失忆的读者" in body


def test_template_kind_vocab_includes_oracle_sensory():
    """v1.19：拓扑词表新增 oracle（测试替身保真度）与 sensory（感官终验）。"""
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    body = open(os.path.abspath(tmpl), encoding="utf-8").read()
    assert "oracle" in body and "sensory" in body
    assert "human_check" in body


def test_template_body_has_hypothesis_ledger():
    """v1.23：假设账本骨架在模板里（假设/检验命令/结果/裁决），排障纪律可寻址。"""
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    body = open(os.path.abspath(tmpl), encoding="utf-8").read()
    assert "假设账本" in body
    for col in ("检验命令", "结果", "裁决"):
        assert col in body, f"账本缺「{col}」列"
    assert "第一嫌疑人" in body and "证伪" in body


def test_read_frontmatter_stops_at_closing_fence(tmp_path):
    """v1.23.2：只读到闭合 ---——正文再长、再引用状态词都与扫描无关。"""
    import manifest_parser as mp
    p = tmp_path / "m.md"
    p.write_text("---\nid: X\nstatus: done\n---\n"
                 + "filler\n" * 500 + "> 引用 status: in-progress\n", encoding="utf-8")
    head = mp.read_frontmatter(str(p))
    assert "status: done" in head
    assert "引用 status: in-progress" not in head
    assert head.count("\n") < 10  # 只读了 frontmatter 那几行


def test_read_frontmatter_unfenced_fallback_capped(tmp_path):
    """容错对齐：无闭合 --- 的文件读到 line_cap 为止（不吞整文件）。"""
    import manifest_parser as mp
    p = tmp_path / "m2.md"
    p.write_text("---\nid: Y\n" + "x: 1\n" * 400, encoding="utf-8")
    head = mp.read_frontmatter(str(p))
    assert "id: Y" in head
    assert head.count("\n") <= 202  # line_cap=200 兜底


def test_template_body_has_acceptance_and_tradeoff():
    """v1.25 证据律 + v1.40 EARS-lite：验收标准节（判据/证据/状态）与设计取舍
    行骨架在模板里；判据列头带 When…则…验 三件格式约言。"""
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    body = open(os.path.abspath(tmpl), encoding="utf-8").read()
    assert "验收标准（做到什么算完" in body
    for col in ("判据（EARS-lite", "When <条件>，则 <可观察结果>", "证据（verify", "状态"):
        assert col in body, f"验收标准缺「{col}」列/格式约言"
    assert "设计取舍" in body and "否决因" in body


def test_template_product_context_sections():
    """v1.26：产品上下文卡四段骨架在模板里——行业暗知识的住所。"""
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "product-context.md")
    body = open(os.path.abspath(tmpl), encoding="utf-8").read()
    for sec in ("用户是谁", "产品价值观（不可牺牲的）", "行业惯例", "设计否决记录"):
        assert sec in body, f"产品上下文卡缺「{sec}」段"
    assert "scout" in body and "永不删人类写的段" in body


# ─── v1.96.1（126）：fallback 与 PyYAML 行为对齐（清洁环境矩阵三捕获的回归锚）───

def test_fallback_comment_parity():
    """行内注释三形态：值首 # / 空白# / 引号外——宿主装 yaml 时 fallback
    不被走到，本单元直接调 _parse_fallback 锚住（否则只有无 yaml 的机器
    替我们测它）。"""
    import manifest_parser as mp
    fm = ("id: R1\n"
          "status: planning  # 行尾注释\n"
          "tier: S\n"
          "note:  # 值首注释=空值\n"
          "quote: \"a # b\"  # 引号内的#保留\n"
          "url: http://x/y#z\n")
    d = mp._parse_fallback(fm)
    assert d["status"] == "planning"
    assert not d.get("note")  # 空值（占位 [] 与 None 同为 falsy，下游等价）
    assert d["quote"] == "a # b"
    assert d["url"] == "http://x/y#z"  # 无空白前导的 # 不是注释


def test_fallback_nested_map_and_inner_list():
    """嵌套映射+映射内嵌列表：scan: card / boundary: include: - 项——
    曾被压平到顶层（PyYAML 给 dict，fallback 给 []）。"""
    import manifest_parser as mp
    fm = ("id: R1\n"
          "scan:\n"
          "  card: 知识层\n"
          "boundary:\n"
          "  include:\n"
          "    - \"src/**\"\n"
          "    - \"tests/**\"\n"
          "planned_changes:\n"
          "- id: F1\n"
          "  file: a.py\n"
          "fragile_points:\n"
          "- id: FP1\n"
          "  kind: machine\n")
    d = mp._parse_fallback(fm)
    assert d["scan"] == {"card": "知识层"}
    assert d["boundary"] == {"include": ["src/**", "tests/**"]}
    assert d["planned_changes"][0]["file"] == "a.py"
    assert d["fragile_points"][0]["kind"] == "machine"


def test_fallback_parity_with_pyyaml_on_template():
    """官方模板：装了 yaml 的机器上双解析器对齐（没装 yaml 的机器上
    fallback 独自扛——上面两个单元锚住关键形态）。"""
    import manifest_parser as mp
    try:
        import yaml  # noqa: F401
    except ImportError:
        pytest.skip("宿主无 pyyaml——清洁环境矩阵路径覆盖")
    import re as _re
    tmpl = os.path.join(os.path.dirname(__file__), "..", "templates",
                        "regress-manifest.md")
    txt = open(tmpl, encoding="utf-8").read()
    m = _re.match(r"^---\s*\n(.*?)\n---", txt, _re.DOTALL)
    fb = mp._parse_fallback(m.group(1))
    yy = yaml.safe_load(m.group(1))
    for k in ("scan", "boundary"):
        assert fb.get(k) == yy.get(k), f"{k} 双解析器不对齐"
    assert fb.get("planned_changes") == yy.get("planned_changes")
