---
description: 初始化项目的 .regress/ 数据目录（代码已在全局级安装，这里只建数据）
argument-hint: [--force]
allowed-tools: Read, Write, Edit, Bash
---

# /regress:init — 初始化项目

在项目根目录创建 `.regress/`（**只是数据目录，不是代码**）。代码已在全局级 `~/.zcode/` 安装。

## 步骤 1：冲突检测

先检查项目里是否有重复的 regress-guard 代码（会导致和全局级冲突）：

```bash
# 检查项目级是否有重复 skill/command
ls .zcode/skills/regression-planning 2>/dev/null
ls .zcode/skills/characterization-testing 2>/dev/null
ls .zcode/skills/change-impact-analysis 2>/dev/null
ls .agents/skills/regression-planning 2>/dev/null
ls regress-guard/hooks/ 2>/dev/null
```

如果发现重复 → **警告并询问是否删除项目级副本**：
```
⚠️ 检测到项目级有 regress-guard 的 skill/command 副本：
  .zcode/skills/regression-planning/

全局级已安装（~/.zcode/skills/），项目级副本会导致：
  - 用到旧版本
  - 更新不同步
  - ZCode 优先级混乱

建议删除项目级副本（数据不受影响）。
```

## 步骤 2：检查已有

```bash
ls .regress/config.json 2>/dev/null
```
若已存在且无 `--force` → 停止，提示已初始化。

## 步骤 3：创建数据目录

```bash
mkdir -p .regress/manifests .regress/journal
```

写入 `.regress/config.json`：
```json
{ "strict": true, "read_before_edit_ratio": 2 }
```

创建 `.regress/README.md`（**零号入口**——写给失忆的读者：打开仓库第一眼
就知道从哪读起、"做完"由什么定义。内容与 `templates/regress-dir-readme.md` 同源，
复制后可按项目微调；self_heal 会在老项目里自动补这个文件，永不覆盖已定制版本）：

```bash
cp "<插件路径>/templates/regress-dir-readme.md" .regress/README.md
```

创建 `.regress/product-context.md`（v1.26 产品上下文卡——「资深·懂行业·贴近用户」
那部分知识的住所；用户/价值观段人类填，行业惯例段可由顾问带搜索起草。
缺失才补、永不覆盖）：

```bash
cp "<插件路径>/templates/product-context.md" .regress/product-context.md
```

创建 `.regress/product-arch.md`（v1.35 模块卡片——产品存量与架构连接点同卡：
每模块一卡 = 完成度|能力|依赖方向|契约|缺口|验证路径。AI 扫代码起草初版
（每个可辨认的模块一张卡），人类校对；缺失才补、永不覆盖）：

```bash
cp "<插件路径>/templates/product-arch.md" .regress/product-arch.md
```

创建 `.regress/adr/` 目录（v1.35 架构决策记录——重大选型必落
`adr/NNNN-短标题.md`，模板 `templates/adr.md`；decisions.md 记"决定"，
ADR 记"为什么这么定"的完整备选与红线）：

```bash
mkdir -p .regress/adr
```

创建决策日志 `.regress/decisions.md`（公理二：认知物质化——决策链刻在文件里，
新会话/新人不靠记忆，读文件）：

```markdown
# 决策日志（append-only，最新在最上）

<!-- 格式：## 日期 · 主题
     决定：<做了什么决定>
     依据：<代码/顾问意见/用户指示>
     否决：<被否掉的方案及原因——防止未来会话把否决路线再走一遍> -->
```

采集环境指纹 `.regress/env.lock.json`（公理一：谁帮我设的 CUDA？锁住当下环境，
漂移可检测）：

```bash
python3 - <<'EOF'
import json, subprocess, sys, platform
def cap(cmd):
    try: return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception: return "unavailable"
lock = {
    "captured_at": __import__("datetime").datetime.now().isoformat(),
    "python": sys.version.split()[0],
    "node": cap("node --version"),
    "git": cap("git --version").split()[-1],
    "os": f"{platform.system()} {platform.release()}",
}
open(".regress/env.lock.json", "w").write(json.dumps(lock, indent=2, ensure_ascii=False))
print(json.dumps(lock, ensure_ascii=False))
EOF
```

## 步骤 4：安装 git 提交观测钩子（补全证据链）

ZCode 门卫只能看到 ZCode 发起的提交；IDE/终端直接 commit 时不可见。
装一个原生 git `post-commit` 钩子记录**所有来源**的提交（静默/自禁用/不阻断/monorepo 向上找 .regress）。

**已知边界（v1.41 注记）**：钩子装在 init 所在仓库的 `.git/hooks/`——嵌套仓
拓扑（.regress 在外仓、代码在内仓）时代码提交走内仓，钩子观测不到
（评审病例：commit_observed 0 条+.expect-commit 残留）。单仓项目机制完整。

项目是 git 仓库且 `.git/hooks/post-commit` 不存在时才装（husky 等已有钩子则跳过并提示）：

```bash
if git rev-parse --git-dir >/dev/null 2>&1 && [ ! -f .git/hooks/post-commit ]; then
cat > .git/hooks/post-commit << 'RGHOOK'
#!/bin/sh
D="$(git rev-parse --show-toplevel 2>/dev/null)"
RG=""
while [ -n "$D" ] && [ "$D" != "/" ]; do
  [ -d "$D/.regress" ] && RG="$D/.regress" && break
  D="$(dirname "$D")"
done
[ -n "$RG" ] || exit 0
SRC="git-hook"
EXP="$RG/.expect-commit"
if [ -f "$EXP" ]; then
  if [ -n "$(find "$EXP" -mmin -5 2>/dev/null)" ]; then
    SRC="zcode-$(sed -n 's/^kind=//p' "$EXP" | head -1)"
  fi
  rm -f "$EXP" 2>/dev/null
fi
SHA="$(git rev-parse --short HEAD 2>/dev/null)"
SUBJ="$(git log -1 --format=%s 2>/dev/null | head -c 80 | sed 's/\\/\\\\/g; s/"/\\"/g')"
printf '{"timestamp":"%s","event":"commit_observed","manifest_id":"","commit_sha":"%s","subject":"%s","source":"%s"}\n' \
  "$(date -Iseconds)" "$SHA" "$SUBJ" "$SRC" >> "$RG/history.jsonl" 2>/dev/null
exit 0
RGHOOK
chmod +x .git/hooks/post-commit
fi
```

## 步骤 5：输出

```
✅ regress-guard 已为本项目初始化
   .regress/config.json     — 项目配置
   .regress/manifests/      — 回归清单目录
   .regress/journal/        — 考古地层（失败/风险/纠正化石，append-only）
   .regress/decisions.md    — 决策日志（决策链物质化）
   .regress/env.lock.json   — 环境指纹（漂移检测基线）
   .git/hooks/post-commit   — 提交观测（记录所有来源的提交）

   代码在全局级（~/.zcode/），所有项目共享。
   这个项目只存自己的数据（清单/历史/配置）。

建议把 .regress/（含 journal/）纳入 git——历史厚度决定系统生存韧性。

下一步：/regress:plan <需求描述>
（老项目首次大提交若被 F3 拦截，直接跑 /regress:track 一次性回填全部文件）
```

## 架构说明

```
全局级 ~/.zcode/              → 代码（skill/command/hook），装一次
项目级 项目/.regress/         → 数据（清单/历史/配置），每个项目独立
```

不要在项目里放 regress-guard 代码——会导致和全局级冲突。
