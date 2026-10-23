"""benchmarks/cases.json 公开基准清单的健康校验（REGRESS-2026-081 F3）。

基准集是对既有攻击回放测试的策展索引——它的可信度建立在"每条 selector
都真实命中仓库里的测试"上。selector 填错或对应测试被删/改名时，这里必须红
（验收：When cases.json 任一 selector 填错或对应测试被删，则 校验用例红）。

钉死面：
- schema 冻结：恰好五字段、全字符串、非空；id 唯一且形状稳定（大写词-三位序号）
- 每条 pytest_selector 经 subprocess 真跑 pytest --collect-only，命中数 >= 1
- attack_summary 长度 <= 80 字符（防攻击载荷复述回潮——脱敏是本集的发布前提）
- 规模下限：>= 5 族 >= 20 例（清单验收口径）
"""
import json
import os
import re
import subprocess
import sys

import pytest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CASES = os.path.join(REPO, "benchmarks", "cases.json")

# schema 冻结（顺序即 cases.json 内的字段顺序；增删字段须同步改本文件与文档）
FIELDS = ["id", "family", "attack_summary", "expected", "pytest_selector"]

ID_SHAPE = re.compile(r"[A-Z]+(-[A-Z]+)*-\d{3}")


def _load():
    with open(CASES, encoding="utf-8") as f:
        return json.load(f)


def test_top_level_is_nonempty_list():
    data = _load()
    assert isinstance(data, list) and data, "cases.json 应为非空数组"


def test_schema_exact_fields_and_types():
    for c in _load():
        assert list(c.keys()) == FIELDS, f"{c.get('id', '?')} 字段集/顺序漂移: {list(c.keys())}"
        for k in FIELDS:
            v = c[k]
            assert isinstance(v, str) and v.strip(), f"{c['id']}.{k} 应为非空字符串"


def test_ids_unique_and_stable_shape():
    ids = [c["id"] for c in _load()]
    assert len(ids) == len(set(ids)), "id 重复"
    for i in ids:
        assert ID_SHAPE.fullmatch(i), f"id 形状漂移（应为大写词-三位序号）: {i}"


def test_attack_summary_length_cap():
    """<=80 字符：摘要超长几乎总是载荷复述回潮（脱敏粒度 = 发布前提）。"""
    for c in _load():
        assert len(c["attack_summary"]) <= 80, \
            f"{c['id']} attack_summary {len(c['attack_summary'])} 字符超限: {c['attack_summary']}"


def test_scale_floor_five_families_twenty_cases():
    data = _load()
    fams = {c["family"] for c in data}
    assert len(data) >= 20, f"例数 {len(data)} < 20"
    assert len(fams) >= 5, f"族数 {len(fams)} < 5"


def _collect_hits(selector):
    """subprocess 真跑 pytest --collect-only -k <selector>，返回命中的 node id 行。

    -qq 抵消 pytest.ini addopts 的 -v，输出退化为纯 node id 列表 + 统计行——
    含 '::' 的行数即命中数（观测依赖，同族 subprocess 风格见 test_boundary_guard）。
    """
    r = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "--collect-only", "-qq",
         "-k", selector],
        cwd=REPO, capture_output=True, text=True, timeout=180)
    if r.returncode not in (0, 5):  # 5 = 无选中（合法观测值）；其余 = 收集期崩溃
        pytest.fail(f"collect 崩溃 rc={r.returncode}\n{r.stderr[-800:]}")
    return [l for l in r.stdout.splitlines() if "::" in l]


@pytest.mark.parametrize("case", _load(), ids=lambda c: c["id"])
def test_selector_hits_real_tests(case):
    """清单与测试树同步钉：selector 必须在真实测试树上命中 >= 1 条。"""
    hits = _collect_hits(case["pytest_selector"])
    assert hits, f"{case['id']} selector 未命中任何测试: {case['pytest_selector']}"
