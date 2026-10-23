#!/usr/bin/env python3
"""检测项目类型并运行测试，返回结构化结果。

被 pre_commit_guard.sh 调用。不信任任何 AI 写的状态，hook 自己跑测试验证。

支持的测试运行器（自动探测）：
  - Node.js: jest（package.json 含 jest 依赖）
  - Python: pytest（存在 pytest.ini / conftest.py / setup.cfg [tool:pytest]）
  - Java: mvn test（存在 pom.xml）/ gradle test（存在 build.gradle）
  - Go: go test（存在 go.mod）

如果找不到测试运行器 → 返回 skip（不阻断，因为可能纯前端/文档项目）。
"""
import sys
import os
import json
import subprocess
import re


def _detect_in(project_dir):
    """单目录探测（原 detect_runner 主体，P0-4 抽出复用）。"""
    # Node.js / Jest
    # Node.js / Jest
    pkg = os.path.join(project_dir, "package.json")
    if os.path.exists(pkg):
        try:
            with open(pkg) as f:
                data = json.load(f)
            deps = {}
            deps.update(data.get("dependencies", {}))
            deps.update(data.get("devDependencies", {}))
            if "jest" in deps:
                return ("jest", ["npx", "jest", "--json",
                                 "--outputFile=" + _result_file(project_dir, ".jest-result.json"),
                                 "--coverage", "--coverageReporters=json-summary",
                                 "--coverageDirectory=.regress/.coverage",
                                 "--silent", "--passWithNoTests"])
            if "vitest" in deps:
                # v1.95.1（124）：落盘同 jest——stdout 贪心提取保留为 fallback
                # （旧版 vitest 的 outputFile 兼容性残余），主路走文件。
                # v1.96.0（125）：绝对路径（相对路径随 cwd=子目录漂移——嵌套
                # 布局潜在错位同修）。
                return ("vitest", ["npx", "vitest", "run", "--reporter=json",
                                   "--outputFile=" + _result_file(project_dir, ".vitest-result.json")])
        except (json.JSONDecodeError, OSError):
            pass  # package.json 损坏 → 跳过 Node.js 探测
        # 有 package.json 但没 jest/vitest → 看 test script
        try:
            with open(pkg) as f:
                data = json.load(f)
            test_script = data.get("scripts", {}).get("test", "")
            if test_script and "no test" not in test_script.lower():
                return ("npm-test", ["npm", "test", "--", "--passWithNoTests"])
        except (json.JSONDecodeError, OSError):
            pass

    # Python / pytest
    for marker in ("pytest.ini", "conftest.py", "setup.cfg", "pyproject.toml"):
        if os.path.exists(os.path.join(project_dir, marker)):
            cmd = ["python3", "-m", "pytest", "-q", "--tb=line"]
            # v1.96.0（125）：机读面优先——junitxml 取代人读摘要正则（正则类
            # bug 的根治：顺序依赖/词序变体/词混淆一类全灭）。绝对路径防嵌套
            # 布局错位；.regress 不在（独立 CLI 场景）则走正则 fallback。
            if os.path.isdir(os.path.join(project_dir, ".regress")):
                cmd.append("--junitxml=" + _result_file(project_dir, ".pytest-result.xml"))
            return ("pytest", cmd)

    # Java / Maven
    if os.path.exists(os.path.join(project_dir, "pom.xml")):
        return ("maven", ["mvn", "test", "-q"])

    # Java / Gradle
    if os.path.exists(os.path.join(project_dir, "build.gradle")) or \
       os.path.exists(os.path.join(project_dir, "build.gradle.kts")):
        return ("gradle", ["./gradlew", "test", "--quiet"])

    # Go
    if os.path.exists(os.path.join(project_dir, "go.mod")):
        return ("go", ["go", "test", "./..."])

    return (None, None)


def detect_runner(project_dir):
    """探测项目的测试运行器。返回 (runner_name, test_cmd) 或 (None, None)。

    向后兼容 2 元组（既有调用方/测试）；嵌套仓探测与 cwd 判定走 _detect。"""
    runner, cmd, _cwd = _detect(project_dir)
    return runner, cmd


# 宿主身份变量（评审批次一三连标本的源头收口）：门禁在钩子 env 里跑测试，
# CLAUDE/ZCODE 的会话号与项目目录泄漏进测试子进程——测试本就不该感知宿主身份
# （实测三族泄漏：会话名文件错配 / 项目目录抢跑 / 钩子链 env 污染）。
# 剥这四个，其余照常继承。
_HOST_IDENTITY_VARS = ("CLAUDE_SESSION_ID", "ZCODE_SESSION_ID",
                       "CLAUDE_PROJECT_DIR", "ZCODE_PROJECT_DIR")


def hermetic_env():
    env = dict(os.environ)
    for k in _HOST_IDENTITY_VARS:
        env.pop(k, None)
    return env


_SKIP_DIRS = {".git", ".regress", "node_modules", "venv", ".venv",
              "__pycache__", "docs", "dist", "build"}


def _result_file(project_dir, name):
    """结果文件绝对路径（125）：落在 project 的 .regress——相对路径随
    cwd=子目录漂移（嵌套布局潜在错位），绝对路径锚死写入位=消费位。"""
    return os.path.join(project_dir, ".regress", name)


def _parse_junitxml(path):
    """解析 pytest junitxml（125 机读面）。返回 None（缺档/坏档）或计数 dict。

    实证（/tmp/jx-probe）：testsuite 聚合 skipped 把 skip 与 xfail 混算
    （1 skip + 1 xfail → skipped=2）——必须逐 case 按 <skipped type> 拆：
    pytest.skip 计入分母（跳过不是通过），pytest.xfail/xpass 不计（代码里
    已承认的已知问题，WORKFLOW 跳过语义节的既定边界）。未知 type 保守计入
    skipped（分母宁大勿小）。root 是 testsuites 包装层，须 iter('testsuite')。
    """
    try:
        import xml.etree.ElementTree as ET
        root = ET.parse(path).getroot()
    except (OSError, SyntaxError, ValueError):
        return None  # 缺档/坏档（ParseError 是 SyntaxError 子类）→ 正则 fallback
    passed = failed = errors = skipped = 0
    for ts in root.iter("testsuite"):
        for tc in ts.iter("testcase"):
            # 130（批评家 run3 历史发现）：全子元素扫描——只看首子元素在
            # 前置附属元素/多子元素形态下误分类。只认 failure/error/skipped
            # 三标签；rerun 场景（同 case 多 failure）按次计不按例计（保守）。
            fails = [k for k in tc if k.tag == "failure"]
            errs = [k for k in tc if k.tag == "error"]
            skips = [k for k in tc if k.tag == "skipped"]
            if fails:
                failed += len(fails)
            elif errs:
                errors += len(errs)
            elif skips:
                for k in skips:
                    if k.get("type") not in ("pytest.xfail", "pytest.xpass"):
                        skipped += 1  # xfail/xpass 不计入任何侧（既定语义）
            else:
                passed += 1
    return {"passed": passed, "failed": failed, "errors": errors,
            "skipped": skipped}


def _looks_like_tests(d):
    """子目录像不像测试现场（P0-4 顾问补强：marker 必须与测试文件同时在场，
    防误扫依赖/样例目录选错 cwd）。"""
    if os.path.isdir(os.path.join(d, "tests")):
        return True
    try:
        return any(f.startswith("test_") or f.endswith("_test.py")
                   or f == "conftest.py" for f in os.listdir(d))
    except (IOError, OSError):
        return False


def _detect(project_dir):
    """探测（runner, cmd, cwd）：project_dir 优先；找不到再扫一层子目录
    （嵌套仓布局：.regress 在工作区根、代码+pytest.ini 在子仓——评审批次一
    P0-4，治"17 份清单 0 份 hook 标 done"的根因）。子目录命中需 marker 与
    测试文件同在。"""
    runner, cmd = _detect_in(project_dir)
    if runner:
        return runner, cmd, project_dir
    try:
        subs = sorted(os.listdir(project_dir))
    except (IOError, OSError):
        subs = []
    for name in subs:
        sub = os.path.join(project_dir, name)
        if not os.path.isdir(sub) or name in _SKIP_DIRS or name.startswith("."):
            continue
        runner, cmd = _detect_in(sub)
        if runner and _looks_like_tests(sub):
            return runner, cmd, sub
    return None, None, project_dir


def _timeout_for(project_dir):
    """超时配置钮（v1.69，058-F4）：项目 .regress/config.json 的
    test_runner.timeout 可调（秒）；缺省 120。套件规模增长越过硬编码
    窗口时门禁会误杀（本批活体：458 例 155s vs 120s 窗口 0 通过超时）。"""
    try:
        with open(os.path.join(project_dir, ".regress", "config.json"),
                  encoding="utf-8") as f:
            v = (json.load(f).get("test_runner") or {}).get("timeout")
        return int(v) if v else 120
    except Exception:
        return 120


def run_tests(project_dir, timeout=None):
    """运行测试，返回结果 dict。

    Returns:
        {
            "runner": "jest" | "pytest" | ... | "none",
            "status": "pass" | "fail" | "skip",
            "total": int, "passed": int, "failed": int,
            "duration_ms": int,
            "failures": [{"test": str, "message": str}],
            "raw_snippet": str  # 失败时的输出片段
        }
    """
    if timeout is None:
        timeout = _timeout_for(project_dir)
    runner, cmd, rcwd = _detect(project_dir)

    if runner is None:
        return {
            "runner": "none",
            "status": "skip",
            "total": 0, "passed": 0, "failed": 0,
            "duration_ms": 0,
            "failures": [],
            "raw_snippet": "No test runner detected (no jest/pytest/maven/go.mod found)"
        }

    try:
        # 125：运行前清残档——上次运行留下的结果文件被当本次结果是静默错读
        # （心虚探测位：最阴的失效形态），主动删先。
        for _res in (".pytest-result.xml", ".jest-result.json",
                     ".vitest-result.json"):
            try:
                os.remove(_result_file(project_dir, _res))
            except OSError:
                pass
        proc = subprocess.run(
            cmd,
            capture_output=True, text=True,
            cwd=rcwd, timeout=timeout,
            env=hermetic_env(),
        )
        output = proc.stdout + proc.stderr
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        return {
            "runner": runner, "status": "fail",
            "total": 0, "passed": 0, "failed": 0,
            "duration_ms": timeout * 1000,
            "failures": [{"test": "(timeout)", "message": f"Tests timed out after {timeout}s"}],
            "raw_snippet": ""
        }
    except FileNotFoundError:
        return {
            "runner": runner, "status": "skip",
            "total": 0, "passed": 0, "failed": 0,
            "duration_ms": 0,
            "failures": [],
            "raw_snippet": f"{cmd[0]} not found in PATH"
        }

    # 解析结果
    if runner == "jest":
        return _parse_jest(output, exit_code, project_dir)
    elif runner == "pytest":
        return _parse_pytest(output, exit_code, project_dir)
    else:
        # mvn/gradle/go：靠 exit code 判断，不精细解析
        return {
            "runner": runner,
            "status": "pass" if exit_code == 0 else "fail",
            "total": 0, "passed": 0, "failed": 0,
            "duration_ms": 0,
            "failures": [] if exit_code == 0 else [{"test": "(unknown)", "message": output[-300:]}],
            "raw_snippet": output[-200:] if exit_code != 0 else ""
        }


def _read_jest_coverage(project_dir):
    """读取 jest coverage json-summary 的全量行覆盖率（无配置时返回 None）。"""
    summary = os.path.join(project_dir, ".regress", ".coverage", "coverage-summary.json")
    try:
        with open(summary) as f:
            data = json.load(f)
        total = data.get("total", {}).get("lines", {}).get("pct")
        return round(total) if isinstance(total, (int, float)) else None
    except (IOError, json.JSONDecodeError, KeyError):
        return None


def _parse_jest(output, exit_code, project_dir=None):
    """解析 jest/vitest --json 输出。优先读 --outputFile 文件。"""
    data = None
    # 优先读 outputFile（避免 stdout 混入诊断信息）
    # jest/vitest 以 cwd=project_dir 运行，文件写在 project_dir/.regress/ 下
    base = project_dir or os.getcwd()
    for _res_name in (".jest-result.json", ".vitest-result.json"):  # 124：vitest 同路
        jest_file = os.path.join(base, ".regress", _res_name)
        if os.path.exists(jest_file):
            try:
                with open(jest_file) as f:
                    data = json.load(f)
            except (json.JSONDecodeError, IOError):
                data = None
            finally:
                try: os.remove(jest_file)
                except OSError: pass
            if data:
                break

    # fallback：从 stdout 提取
    if not data:
        matches = list(re.finditer(r'\{.*\}', output, re.DOTALL))
        for m in reversed(matches):
            try:
                data = json.loads(m.group())
                break
            except json.JSONDecodeError:
                continue

    if data and "testResults" in data:
        suites = data.get("testResults", [])
        total = sum(len(s.get("assertionResults", [])) for s in suites)
        passed = sum(
            1 for s in suites for a in s.get("assertionResults", [])
            if a.get("status") == "passed"
        )
        failed = sum(
            1 for s in suites for a in s.get("assertionResults", [])
            if a.get("status") == "failed"
        )
        # v1.95.0（123）：skipped 可见性——jest 分母本就含这些断言（total=全部），
        # 但 skipped 数从未透传（外部评审实证的盲区另一半）。todo/pending/
        # disabled 在 jest/vitest 语义里都是"没真正跑"。
        skipped = sum(
            1 for s in suites for a in s.get("assertionResults", [])
            if a.get("status") in ("skipped", "pending", "todo", "disabled")
        )
        failures = [
            {
                "test": a.get("fullName", ""),
                "message": (a.get("failureMessages", [""]) or [""])[0][:200]
            }
            for s in suites for a in s.get("assertionResults", [])
            if a.get("status") == "failed"
        ]
        return {
            "runner": "jest",
            "status": "pass" if failed == 0 and exit_code == 0 else "fail",
            "total": total, "passed": passed, "failed": failed,
            "skipped": skipped,
            "duration_ms": 0,
            "failures": failures[:20],
            "raw_snippet": "",
            "coverage_pct": _read_jest_coverage(base),
        }

    # 完全无法解析 → 靠 exit code（覆盖率独立于测试数解析，仍尝试读取）
    return {
        "runner": "jest",
        "status": "pass" if exit_code == 0 else "fail",
        "total": 0, "passed": 0, "failed": 0,
        "duration_ms": 0,
        "coverage_pct": _read_jest_coverage(base),
        "failures": [] if exit_code == 0 else [{"test": "(parse error)", "message": output[-200:]}],
        "raw_snippet": output[-200:]
    }


def _parse_pytest(output, exit_code, project_dir=None):
    """解析 pytest 结果：junitxml 机读面优先（125），人读摘要正则 fallback。

    v1.95.0（123）：skipped 进分母（与 jest 的 total=全部断言语义对齐）——
    此前 total=passed，"1 passed, 1 skipped"被报成 1/1 全过（外部评审实证：
    行尾 N/N 对账同瞎，宣称=实测=1/1 的一致假象）。xfailed/deselected 语义
    不同（已知问题/显式筛除）故意不进分母，见 WORKFLOW 跳过语义节。
    v1.96.0（125）：机读面根治正则类 bug（顺序依赖/词序变体/词混淆全灭）；
    聚合 skipped 混淆 skip+xfail 的坑见 _parse_junitxml 实证注。
    """
    counts = _parse_junitxml(_result_file(project_dir or os.getcwd(),
                                          ".pytest-result.xml")) \
        if project_dir else None
    if counts:
        try:  # 读后即清（同 jest 惯例）：残档留在 .regress 有被误提交的面
            os.remove(_result_file(project_dir, ".pytest-result.xml"))
        except OSError:
            pass
    if counts:
        passed = counts["passed"]
        failed = counts["failed"]
        errors = counts["errors"]
        skipped = counts["skipped"]
    else:
        # fallback：人读摘要正则（旧环境无 junitxml/写失败）
        # v1.95.0（123）：各 token 独立搜索——原链式正则的 failed 组只往 passed
        # 之后找，而 pytest 惯例"1 failed, 1 passed"（failed 在前），fail 分支的
        # failed 计数一直漏抓（skipped 进分母后此错显形，顺手根治）。
        # xpassed/xfailed 不被误抓（"1 xpassed"的数字不紧邻 passed）。
        def _cnt(tok):
            m = re.search(rf'(\d+) {tok}', output)
            return int(m.group(1)) if m else 0
        passed = _cnt("passed")
        failed = _cnt("failed")
        errors = _cnt("error")
        skipped = _cnt("skipped")
        # 130（批评家 run3）：collection error 场景 pytest 死在写 junitxml 前、
        # -q 摘要又无计数（conftest 坏=活体）——fail 态零计数时至少记 1：
        # 计数未知 ≠ 计数为零（零会让"fail 但 0/0"的矛盾形态外泄）
        if exit_code != 0 and not (failed or errors):
            errors = 1

    if exit_code == 0 and failed == 0 and errors == 0:
        return {
            "runner": "pytest", "status": "pass",
            "total": passed + skipped, "passed": passed, "failed": 0,
            "skipped": skipped, "parse": "junitxml" if counts else "regex",
            "duration_ms": 0, "failures": [], "raw_snippet": ""
        }

    # 失败时提取失败用例
    failures = []
    for line in output.split("\n"):
        if "FAILED" in line:
            failures.append({"test": line.strip()[:200], "message": ""})

    return {
        "runner": "pytest", "status": "fail",
        "total": passed + failed + errors + skipped,
        "passed": passed, "failed": failed + errors,
        "skipped": skipped, "parse": "junitxml" if counts else "regex",
        "duration_ms": 0,
        "failures": failures[:20] if failures else [{"test": "(unknown)", "message": output[-200:]}],
        "raw_snippet": output[-300:]
    }


if __name__ == "__main__":
    # CLI 用法：python3 test_runner.py [project_dir]
    project_dir = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    result = run_tests(project_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result["status"] in ("pass", "skip") else 1)
