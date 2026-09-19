#!/usr/bin/env python3
"""TASK-010 领导验收核对工具（员工 TASK-010-E02 交付，仅 Python 标准库）。

用法：
    python verify_report.py <claimed卡路径> <outbox回报路径>

核对 relay 信箱的一张领取卡与对应回报是否满足 TASK-010 合同：
  a. 卡 JSON 可解析且含 version/task_id/prompt/prompt_sha256 四字段
  b. 回报 JSON 可解析且含九个必备字段
     （task_id/status/worker_session/actual_model/artifacts/verification/
       unverified/report_markdown/report_sha256）
  c. 卡 prompt_sha256 == sha256(card.prompt 的 UTF-8 字节)
  d. 回报 report_sha256 == sha256(report.report_markdown 的 UTF-8 字节)
  e. 回报 task_id == 卡 task_id
  f. status 属于 DONE/BLOCKED/QUESTION 之一
  g. artifacts 中每个相对路径（相对项目根）都实际存在

每项打印一行 PASS 或 FAIL 加简短说明；全过 exit 0，任一失败 exit 1。
哈希比较不 trim、不归一化换行。输出 UTF-8。
"""

import hashlib
import json
import sys
from pathlib import Path

CARD_FIELDS = ("version", "task_id", "prompt", "prompt_sha256")
REPORT_FIELDS = (
    "task_id",
    "status",
    "worker_session",
    "actual_model",
    "artifacts",
    "verification",
    "unverified",
    "report_markdown",
    "report_sha256",
)
VALID_STATUS = ("DONE", "BLOCKED", "QUESTION")

# 本脚本位于 <项目根>/tools/task-010/，项目根 = 上溯两级。
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def sha256_text(text):
    """UTF-8 字节的 SHA256 hex；调用方负责不做任何 trim/归一化。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_json(path):
    """按 UTF-8 读取并解析 JSON；失败返回 (None, 简短原因)。"""
    try:
        with open(path, "rb") as handle:
            raw = handle.read()
    except OSError as exc:
        return None, "文件无法读取：{}".format(exc)
    try:
        return json.loads(raw.decode("utf-8")), None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, "JSON 无法解析：{}".format(exc)


def check_card_fields(card, card_err):
    label = "a. 卡 JSON 可解析且四字段完整"
    if card_err is not None:
        return False, label, card_err
    missing = [name for name in CARD_FIELDS if name not in card]
    if missing:
        return False, label, "缺少字段：{}".format("、".join(missing))
    return True, label, "version={} task_id={}".format(card.get("version"), card.get("task_id"))


def check_report_fields(report, report_err):
    label = "b. 回报 JSON 可解析且九字段完整"
    if report_err is not None:
        return False, label, report_err
    missing = [name for name in REPORT_FIELDS if name not in report]
    if missing:
        return False, label, "缺少字段：{}".format("、".join(missing))
    return True, label, "worker_session={} status={}".format(
        report.get("worker_session"), report.get("status")
    )


def check_card_hash(card, card_err):
    label = "c. 卡 prompt_sha256 与 prompt UTF-8 字节哈希一致"
    if card_err is not None or any(name not in card for name in ("prompt", "prompt_sha256")):
        return False, label, "卡缺少 prompt/prompt_sha256，无法计算"
    expected = card["prompt_sha256"]
    actual = sha256_text(card["prompt"])
    if not isinstance(expected, str) or expected.lower() != actual:
        return False, label, "卡内={} 实得={}".format(expected, actual)
    return True, label, "sha256={}".format(actual)


def check_report_hash(report, report_err):
    label = "d. 回报 report_sha256 与 report_markdown UTF-8 字节哈希一致"
    if report_err is not None or any(
        name not in report for name in ("report_markdown", "report_sha256")
    ):
        return False, label, "回报缺少 report_markdown/report_sha256，无法计算"
    expected = report["report_sha256"]
    actual = sha256_text(report["report_markdown"])
    if not isinstance(expected, str) or expected.lower() != actual:
        return False, label, "回报内={} 实得={}".format(expected, actual)
    return True, label, "sha256={}".format(actual)


def check_task_id_match(card, card_err, report, report_err):
    label = "e. 回报 task_id 与卡 task_id 一致"
    if card_err is not None or report_err is not None:
        return False, label, "卡或回报无法解析，无法比对"
    if card.get("task_id") != report.get("task_id"):
        return False, label, "卡={} 回报={}".format(card.get("task_id"), report.get("task_id"))
    return True, label, "task_id={}".format(card.get("task_id"))


def check_status_enum(report, report_err):
    label = "f. status 属于 DONE/BLOCKED/QUESTION"
    if report_err is not None or "status" not in report:
        return False, label, "回报缺少 status，无法核对"
    status = report["status"]
    if status not in VALID_STATUS:
        return False, label, "status={!r} 不在允许集合".format(status)
    return True, label, "status={}".format(status)


def check_artifacts_exist(report, report_err):
    label = "g. artifacts 相对项目根全部存在"
    if report_err is not None or "artifacts" not in report:
        return False, label, "回报缺少 artifacts，无法核对"
    artifacts = report["artifacts"]
    if not isinstance(artifacts, list):
        return False, label, "artifacts 不是列表（实际类型 {}）".format(type(artifacts).__name__)
    bad = []
    for entry in artifacts:
        if not isinstance(entry, str):
            bad.append("非字符串项：{!r}".format(entry))
            continue
        path = Path(entry)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        if not path.exists():
            bad.append("不存在：{}".format(entry))
    if bad:
        return False, label, "；".join(bad)
    if not artifacts:
        return True, label, "artifacts 为空列表（vacuous 通过）"
    return True, label, "{} 项全部存在（项目根 {}）".format(len(artifacts), PROJECT_ROOT)


def main(argv):
    if len(argv) != 3:
        print("用法：python verify_report.py <claimed卡路径> <outbox回报路径>", file=sys.stderr)
        return 2
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass  # 非 Python 3.7+ 环境退回默认编码

    card_path, report_path = argv[1], argv[2]
    card, card_err = load_json(card_path)
    report, report_err = load_json(report_path)

    results = [
        check_card_fields(card, card_err),
        check_report_fields(report, report_err),
        check_card_hash(card, card_err),
        check_report_hash(report, report_err),
        check_task_id_match(card, card_err, report, report_err),
        check_status_enum(report, report_err),
        check_artifacts_exist(report, report_err),
    ]

    failed = 0
    for ok, label, detail in results:
        print("{} {} —— {}".format("PASS" if ok else "FAIL", label, detail))
        if not ok:
            failed += 1
    print("RESULT: {}/{} PASS".format(len(results) - failed, len(results)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
