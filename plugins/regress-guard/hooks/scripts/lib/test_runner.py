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
                                 "--outputFile=.regress/.jest-result.json",
                                 "--coverage", "--coverageReporters=json-summary",
                                 "--coverageDirectory=.regress/.coverage",
                                 "--silent", "--passWithNoTests"])
            if "vitest" in deps:
                return ("vitest", ["npx", "vitest", "run", "--reporter=json"])
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
            return ("pytest", ["python3", "-m", "pytest", "-q", "--tb=line"])

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
        return _parse_pytest(output, exit_code)
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
    """解析 jest --json 输出。优先读 --outputFile 文件。"""
    data = None
    # 优先读 outputFile（避免 stdout 混入诊断信息）
    # jest 以 cwd=project_dir 运行，文件写在 project_dir/.regress/ 下
    base = project_dir or os.getcwd()
    jest_file = os.path.join(base, ".regress", ".jest-result.json")
    if os.path.exists(jest_file):
        try:
            with open(jest_file) as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            data = None
        finally:
            try: os.remove(jest_file)
            except OSError: pass

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


def _parse_pytest(output, exit_code):
    """解析 pytest 输出。"""
    # pytest 末尾通常有：===== 3 passed in 0.12s =====
    match = re.search(
        r'(\d+) passed(?:.*?(\d+) failed)?(?:.*?(\d+) error)?',
        output
    )
    passed = failed = errors = 0
    if match:
        passed = int(match.group(1))
        failed = int(match.group(2) or 0)
        errors = int(match.group(3) or 0)

    if exit_code == 0 and failed == 0 and errors == 0:
        return {
            "runner": "pytest", "status": "pass",
            "total": passed, "passed": passed, "failed": 0,
            "duration_ms": 0, "failures": [], "raw_snippet": ""
        }

    # 失败时提取失败用例
    failures = []
    for line in output.split("\n"):
        if "FAILED" in line:
            failures.append({"test": line.strip()[:200], "message": ""})

    return {
        "runner": "pytest", "status": "fail",
        "total": passed + failed + errors,
        "passed": passed, "failed": failed + errors,
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
