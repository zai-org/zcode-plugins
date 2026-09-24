---
description: 快速模式——机器判据达标的小改动专用（合并 plan+track 一步到位）
argument-hint: <需求描述>
allowed-tools: Read, Write, Edit, Bash, Grep
---

# /regress:quick — 快速模式

合并 `/regress:plan` 和 `/regress:track` 为一步：**基于 git diff 直接生成清单**
（不分 planned/actual，全部算实际改动）。清单标 `mode: quick`。

## 与 full 模式的分界（v1.37：机器判据，不再靠"个人/小改动"感觉）

**四条全过才许 quick**（任一不过 → 走 /regress:plan full）：

1. 改动 ≤3 个文件（git diff 统计，含新增）
2. 无 new-file 以外的结构类型（model 签名变更/跨模块调用链 → full）
3. 纯内部改动（不新增用户可见行为——新功能/UI/接口语义变化 → full，
   用户可见必过广度矩阵与 DoD，那是 full 的领土）
4. 无环境/依赖变更（requirements/package/build/配置文件 → full）

| | full 模式 | quick 模式 |
|---|---------|----------|
| 流程 | plan→开发→track→verify | 开发→quick→commit |
| F3 追踪 | ✅ 区分计划内/外 | ❌ 不区分（全是 actual） |
| 脆弱点 | 拓扑穷举 | **至少 1 条**（0 条=没想过，不是没有风险） |
| runner 缺失 | 阻断 | **豁免**（warn 放行留痕——门禁认 mode: quick） |
| 广度/架构/ADR | 按触发条件 | 永不（quick 定义即不触发） |

## 流程

参数 `$ARGUMENTS` 是需求描述。

### 步骤 1：判据检查（四条）

```bash
git diff --name-only HEAD; git ls-files --others --exclude-standard
```
统计文件数、看类型、找用户可见面、找环境文件。**判据不过就在此说
"这单走 full"，转 /regress:plan**——塌方曲线的病根是重仪式被绕过，
不是仪式被正确豁免；机器判据让豁免留痕、越级可审计。

### 步骤 2：用户先改好代码

quick 模式假设代码**已经改完了**。如果还没改，提示用户先改代码。

### 步骤 3：生成清单（全部记为 actual_changes）

```yaml
---
id: REGRESS-<序号>
requirement: "<需求>"
status: in-progress
mode: quick
planned_changes: []
actual_changes:
  - id: F1
    file: "<文件>"
    type: <类型>
    reason: "quick 模式：基于 git diff 生成"
    tests_required: [unit]
fragile_points:           # 至少 1 条（哪怕就是"无测试覆盖，人工验证过 X"）
  - id: V1
    kind: oracle
    description: "<这条改动最怕什么>"
    verify: "<可执行命令>"
    status: locked
---
```

### 步骤 4：提示用户

```
⚡ 快速清单已生成（mode: quick·判据四条全过）
   F1: src/auth/login.js (method-logic)
   V1: <脆弱点一行>
   rollback: git revert 即回滚（v1.41 全档必填——触及迁移/外部状态时写真路径）
现在可以直接 git commit。hook 自动跑测试验证；无 runner 时 warn 放行（quick 豁免）。
```
