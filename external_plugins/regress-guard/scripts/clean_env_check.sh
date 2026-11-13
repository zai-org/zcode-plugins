#!/usr/bin/env bash
# clean_env_check.sh — 清洁环境自检（126）：本地自造"外部环境"
#
# 动机：外部评审"干净环境红 48"类指控，本地本可提前逮住——venv 从零装
# requirements-dev.txt 跑全套件，退出码即答案（红=依赖声明缺口或环境耦合，
# 绿=该指控在本机不可复现）。
#
# 用法：bash scripts/clean_env_check.sh [venv 路径]
# 缺省临时 venv；跑完保留以便复用（复用前不重装，改用 --upgrade 快速刷新）。
# 成本 ~4 分钟（venv+pip+全量套件）——发布前/哨兵节奏动作，不进每次门禁。
# 注意：覆盖面=Python 依赖与套件环境耦合；locale/内核/多 Python 版本不在内
# （诚实边界：单机单版本=单点，非矩阵）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${1:-$(mktemp -d /tmp/rg-cleanenv-XXXXXX)}"

if [ ! -x "${VENV}/bin/python" ]; then
    echo "[clean-env] 创建 venv: ${VENV}"
    python3 -m venv "$VENV"
    "${VENV}/bin/pip" install -q --upgrade pip
fi

echo "[clean-env] 安装 requirements-dev.txt（网络依赖：pypi 不可达时此处失败=环境问题非产品问题）"
"${VENV}/bin/pip" install -q -r "${ROOT}/requirements-dev.txt"

echo "[clean-env] 全量套件（清洁解释器）"
"${VENV}/bin/python" -m pytest "${ROOT}/tests" -q

echo "[clean-env] ✅ 清洁环境全绿（venv: ${VENV}）"
