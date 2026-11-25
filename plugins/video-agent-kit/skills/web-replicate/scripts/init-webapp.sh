#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────

# 这是最早上线的默认模板，用户如果没指定模板，则使用这个模板
ORIGIN_TEMPLATE_NAME="default"

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPO_ROOT="$(cd "$SCRIPTS_DIR/.." && pwd)"
PROJECT_NAME="$1"
TEMPLATE_NAME="${2:-$ORIGIN_TEMPLATE_NAME}"
[[ "$OSTYPE" == "darwin"* ]] && SED_INPLACE=(sed -i '') || SED_INPLACE=(sed -i)

TEMPLATE_PATH="$REPO_ROOT/templates/$TEMPLATE_NAME"

# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

! command -v npm &>/dev/null && { echo "Error: npm not found"; exit 1; }
[[ -z "$1" ]] && { echo "Usage: $0 <project-name>"; exit 1; }
[[ ! -d "$TEMPLATE_PATH" ]] && { echo "Error: template not found: $TEMPLATE_NAME"; exit 1; }
# 模板源 = git 里的目录 (templates/<name>/template/), 单一事实源
TEMPLATE_SRC="$TEMPLATE_PATH/template"
INFO_MD="$TEMPLATE_PATH/info.md"
if [[ ! -f "$TEMPLATE_SRC/package.json" ]]; then
    echo "Error: Template '$TEMPLATE_NAME' not found at: $TEMPLATE_SRC"
    echo "Available templates:"
    ls "$REPO_ROOT/templates" 2>/dev/null | sed 's/^/  - /' || true
    exit 1
fi

# 默认落在工程目录下 app/ (VE_PROJECT_DIR 优先, 兜底当前 cwd = agent 所在的项目目录)
PROJECT_PATH=${PROJECT_PATH:-"${VE_PROJECT_DIR:-$PWD}/app"}
# TEMP_PATH 可能被多个并行 case 共享 (run_unattended 注入固定 tmp_root/temp-webapp),
# 直接 rm -rf 会互删。每次调用用 PID 唯一子目录, 用完即清。
TEMP_PATH=${TEMP_PATH:-"/tmp/temp-webapp"}
TEMP_PATH="$TEMP_PATH/init.$$"

# ─────────────────────────────────────────────────────────────────────────────
# Project Creation
# ─────────────────────────────────────────────────────────────────────────────

echo "Creating project: $PROJECT_PATH"
mkdir -p "$PROJECT_PATH"
[[ -d "$TEMP_PATH" ]] && rm -rf "$TEMP_PATH"
mkdir -p "$TEMP_PATH"
# 用完即清
_TEMP_CLEAN_ROOT="$TEMP_PATH"
trap 'rm -rf "$_TEMP_CLEAN_ROOT"' EXIT

# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────

echo "Installing dependencies..."

# 拷贝模板目录 (排除 node_modules — 依赖由 relink 落位, 防御模板目录混入实体依赖)
(cd "$TEMPLATE_SRC" && tar cf - --exclude=node_modules .) | tar xf - -C "$TEMP_PATH"

cp "$INFO_MD" "$TEMP_PATH"/info.md

ESCAPED_REPLACE=$(printf '%s\n' "$PROJECT_NAME" | sed 's/[\/&]/\\&/g')
"${SED_INPLACE[@]}" 's/<title>.*<\/title>/<title>'"$ESCAPED_REPLACE"'<\/title>/' "$TEMP_PATH"/index.html

# Copy template files (dotglob includes hidden files like .gitignore)
(shopt -s dotglob && cp -r "$TEMP_PATH"/* "$PROJECT_PATH"/)

# node_modules 放本地快速盘, PROJECT_PATH 里只留软链 —— PROJECT_PATH 常在云盘
# (JuiceFS) 上, 直接 cp/npm install 数万小文件会超过 shell 工具超时 (300s 被杀,
# 留下残缺 node_modules)。具体逻辑在 relink-node-modules.sh (master 缓存 +
# 硬链接克隆 + 软链落位), 损坏时 agent 也可单独重跑它修复。
export TEMPLATE_NAME
bash "$SCRIPTS_DIR/relink-node-modules.sh" "$PROJECT_PATH"

# 防回归断言 (2026-07-12 inode 事故): node_modules 必须是软链。实体目录意味着
# 几万个小文件被写上云盘 (慢 + 吃光 inode 配额), 宁可 init 失败也不放行。
if [[ ! -L "$PROJECT_PATH/node_modules" ]]; then
    echo "ERROR: $PROJECT_PATH/node_modules 不是软链 — relink 未生效, 终止。" >&2
    echo "修复: bash $SCRIPTS_DIR/relink-node-modules.sh $PROJECT_PATH" >&2
    exit 1
fi

# 非默认模板的依赖差异由 relink 的 master 构建路径统一处理 (按项目 package.json
# 哈希在本地盘 delta 安装) — 项目目录里永远不跑 npm install (会把软链换成实体目录)。

# ─────────────────────────────────────────────────────────────────────────────
# Git: commit template baseline
# ─────────────────────────────────────────────────────────────────────────────

grep -qxF 'node_modules' "$PROJECT_PATH/.gitignore" 2>/dev/null || echo 'node_modules' >> "$PROJECT_PATH/.gitignore"

git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$PROJECT_PATH" \
  || git config --global --add safe.directory "$PROJECT_PATH"
if [[ ! -d "$PROJECT_PATH/.git" ]]; then
  git -C "$PROJECT_PATH" init -q -b main
  git -C "$PROJECT_PATH" config user.name "Skill Template"
  git -C "$PROJECT_PATH" config user.email "template@skill"
fi
git -C "$PROJECT_PATH" add -A
git -C "$PROJECT_PATH" commit -q -m "chore(web-replicate): init template \"$PROJECT_NAME\"" --no-verify

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$TEMPLATE_NAME" != "$ORIGIN_TEMPLATE_NAME" ]]; then
  echo ""
  echo "✓ Template '$TEMPLATE_NAME' extracted successfully to: $PROJECT_PATH"
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo "TEMPLATE INFO"
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo ""
  # Output info.md for the AI agent to read
  if [[ -f "$INFO_MD" ]]; then
    cat "$INFO_MD"
  else
    echo "⚠ No info.md found for this template."
  fi
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════"
else
  # 默认模板就直接输出info.md
  [[ -f "$INFO_MD" ]] && cat "$INFO_MD"
fi
