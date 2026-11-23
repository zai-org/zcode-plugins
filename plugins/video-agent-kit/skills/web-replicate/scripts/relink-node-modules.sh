#!/bin/bash
# 把 <project-path>/node_modules 修复为 本地快速盘上的硬链接克隆 + 软链。
#
# 背景: 项目目录常在云盘 (JuiceFS) 上, 直接 npm install 数万小文件既慢 (超时被杀
# 留残缺) 又炸 inode 配额。真实 node_modules 永远放本地盘 NM_LOCAL_ROOT, 项目里只留软链。
#
# 铁律 (2026-07-12 事故后): **任何 npm install 都不在项目目录里跑**。
# npm>=7 reify 会把作为软链的 node_modules 根替换成实体目录 —— 旧版的 NEED_DELTA
# 路径 (克隆旧 master 后在项目目录补装) 正是这样把 ~3 万文件写上云盘的。
# 现在 package.json 哈希不匹配时, 在本地盘的构建目录里完成 delta/全量安装,
# 原子落位成新哈希 master, 项目目录只做 克隆+软链。
#
# 用法: relink-node-modules.sh <project-path> [--prepare-only]
#   --prepare-only: 只确保与 package.json 精确匹配的 master 存在 (跑批前预热), 不动项目目录。
set -e

PROJECT_PATH="${1:?usage: relink-node-modules.sh <project-path> [--prepare-only]}"
PREPARE_ONLY=0
[[ "${2:-}" == "--prepare-only" ]] && PREPARE_ONLY=1

TEMPLATE_NAME="${TEMPLATE_NAME:-default}"
NM_LOCAL_ROOT=${NM_LOCAL_ROOT:-/tmp/webapp-node-modules}
mkdir -p "$NM_LOCAL_ROOT"

[[ -f "$PROJECT_PATH/package.json" ]] || { echo "ERROR: $PROJECT_PATH/package.json 不存在" >&2; exit 1; }
# md5sum 是 GNU coreutils; macOS 只有 md5 -q / shasum。没有哈希就会落成 master-default- 空目录。
if command -v md5sum &>/dev/null; then
  PKG_HASH=$(md5sum "$PROJECT_PATH/package.json" | cut -c1-12)
elif command -v md5 &>/dev/null; then
  PKG_HASH=$(md5 -q "$PROJECT_PATH/package.json" | cut -c1-12)
else
  PKG_HASH=$(shasum "$PROJECT_PATH/package.json" | cut -c1-12)
fi
[[ -n "$PKG_HASH" ]] || { echo "ERROR: 无法计算 package.json 哈希 (md5sum/md5/shasum 都不可用)" >&2; exit 1; }
NM_MASTER="$NM_LOCAL_ROOT/master-$TEMPLATE_NAME-$PKG_HASH"

# 原子落位: GNU mv -T 把目录改名到目标; BSD mv 没有 -T, 目标不存在时普通 mv 等价。
# 并发同时建 master 时先到先得, 输家直接丢弃。
place_master() {
  if mv -T "$1" "$NM_MASTER" 2>/dev/null; then return 0; fi
  [[ -e "$NM_MASTER" ]] || mv "$1" "$NM_MASTER" 2>/dev/null || true
}

# ── 预装种子 (V2C_NM_SEED_DIR, 管线只读挂载): 命中精确哈希的 master tar 直接
#    解到本地盘 — 零 npm 零网络 (260831 three 升级后预热不再赌容器出网)。
#    解包不完整/无种子 → 落到下面的 npm 构建路径, 行为与从前一致。
if [[ ! -d "$NM_MASTER" && -n "${V2C_NM_SEED_DIR:-}" ]]; then
  SEED_TAR="$V2C_NM_SEED_DIR/master-$TEMPLATE_NAME-$PKG_HASH.tar"
  if [[ -f "$SEED_TAR" ]]; then
    echo "预装种子命中: $SEED_TAR → 解包到本地盘 (零 npm)..."
    NM_TMP=$(mktemp -d "$NM_LOCAL_ROOT/.master.XXXXXX")
    if tar -xf "$SEED_TAR" -C "$NM_TMP" && [[ -e "$NM_TMP/node_modules/.bin/vite" ]]; then
      place_master "$NM_TMP/node_modules"
    else
      echo "WARN: 种子解包不完整 ($SEED_TAR), 回退 npm 安装路径" >&2
    fi
    rm -rf "$NM_TMP"
  fi
fi

# ── master 构建: 全部安装动作发生在本地盘构建目录, 永不触碰项目目录 ────────────
if [[ ! -d "$NM_MASTER" ]]; then
  NM_TMP=$(mktemp -d "$NM_LOCAL_ROOT/.master.XXXXXX")
  cp "$PROJECT_PATH/package.json" "$NM_TMP/"
  [[ -f "$PROJECT_PATH/package-lock.json" ]] && cp "$PROJECT_PATH/package-lock.json" "$NM_TMP/"
  # 底座加速: 同模板最新 master 硬链克隆后只跑 delta; 没有则纯冷启动全量安装。
  # 硬链安全: npm 换包是 unlink+新写, 不改旧 inode。
  BASE=$(ls -dt "$NM_LOCAL_ROOT/master-$TEMPLATE_NAME-"* 2>/dev/null | head -1)
  if [[ -n "$BASE" ]]; then
    echo "以 $BASE 为底座硬链克隆, 本地盘 delta npm install..."
    cp -al "$BASE" "$NM_TMP/node_modules" 2>/dev/null || cp -r "$BASE" "$NM_TMP/node_modules"
  else
    echo "无可用底座, 本地盘冷启动全量 npm install (首次较慢)..."
  fi
  if ! (cd "$NM_TMP" && npm install --no-audit --no-fund --prefer-offline 2>&1 | tail -5); then
    rm -rf "$NM_TMP"
    echo "ERROR: npm install failed (check registry/proxy connectivity above)." >&2
    exit 1
  fi
  if [[ ! -e "$NM_TMP/node_modules/.bin/vite" ]]; then
    rm -rf "$NM_TMP"
    echo "ERROR: npm install finished but node_modules/.bin/vite missing — install incomplete." >&2
    exit 1
  fi
  # 原子落位: 并发同时建 master 时先到先得, 输家直接丢弃
  place_master "$NM_TMP/node_modules"
  rm -rf "$NM_TMP"
fi

if [[ "$PREPARE_ONLY" == "1" ]]; then
  echo "✓ master ready: $NM_MASTER"
  exit 0
fi

# ── 项目落位: 清旧 → 克隆 → 软链 (项目目录零 npm 操作) ──────────────────────
# 真实目录在云盘上 rm 数万文件很慢, 先 O(1) 改名再后台删
if [[ -L "$PROJECT_PATH/node_modules" ]]; then
  rm -f "$PROJECT_PATH/node_modules"
elif [[ -e "$PROJECT_PATH/node_modules" ]]; then
  BROKEN="$PROJECT_PATH/.node_modules.broken.$$"
  mv "$PROJECT_PATH/node_modules" "$BROKEN"
  nohup rm -rf "$BROKEN" >/dev/null 2>&1 &
fi

NM_CLONE=$(mktemp -d "$NM_LOCAL_ROOT/nm.XXXXXX")
cp -al "$NM_MASTER" "$NM_CLONE/node_modules" 2>/dev/null || cp -r "$NM_MASTER" "$NM_CLONE/node_modules"
ln -sfn "$NM_CLONE/node_modules" "$PROJECT_PATH/node_modules"

# 落位断言: 必须是软链且工具链完整 — 任何一条不满足都宁可失败也不放行
if [[ ! -L "$PROJECT_PATH/node_modules" ]]; then
  echo "ERROR: node_modules 不是软链 (落位失败), 拒绝继续 — 防止依赖被写上云盘。" >&2
  exit 1
fi
if [[ ! -e "$PROJECT_PATH/node_modules/.bin/vite" ]]; then
  echo "ERROR: node_modules 落位失败 (软链悬空或克隆不完整)。" >&2
  exit 1
fi
echo "✓ node_modules → $NM_CLONE/node_modules (local disk)"
