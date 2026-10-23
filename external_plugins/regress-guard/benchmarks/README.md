# 公开攻击回放基准（benchmarks/cases.json）

对 regress-guard 既有攻击回放测试的**策展索引**：把散在 `tests/` 里的供应链注入、
信任旁路、缓存伪造、边界旁路、密钥外发、执行阀、先读后改指纹、提交门禁、
全貌新鲜度、验收入环、规律召回、待决回流等真实翻车标本，整理为可独立引用的
基准用例集（当前 82 例 / 13 族）。

## 非新披露声明

**本集是策展，不是新披露。** 所有被引用的测试内容本来就公开于本仓 `tests/`
目录（攻击回放自 v1.29 起即以测试形态入库）；cases.json 只增加一层脱敏摘要
与稳定 id，不引入任何新的攻击载荷、命令原文或密钥样例形态。摘要粒度停在
"环境变量注入重定向信任面"这一层，不复述具体变量名、命令与值。

## 方法论：human-only 误报口径（为什么比厂商自报严）

安全工具厂商的基准数字通常由厂商自报——自己拦截、自己判定拦截是否有价值，
既当运动员又当裁判。本插件的口径不同：

- **拦截是否有用，由人**事后**裁决**：门禁每次拦截经人复核，归入三类——
  `useful`（真拦住了问题）/ `false_positive`（误报）/ `ignored`（人主动忽略）
- **AI 无投票权**：AI（包括本插件的自动化层）不能把自己的拦截记为 useful，
  也不能销掉 false_positive——数字不经被测系统的手
- 对照面同理：放行路径上的对照用例（如授权后放行、暂存态不误拒）红掉时
  同样计入问题——误放与误拦都算翻车

厂商自报口径下"0 误报"是营销数字；human-only 口径下它是审计结果。

## 当前实测数字（截至 2026-09-21）

| 指标 | 值 |
|---|---|
| 拦截累计裁决 | 33 useful / 0 false_positive / 1 ignored |
| 门禁测试缓存命中 | 4 次（键随树变化，命中即同树全绿） |

数字来源：真实使用中的人工裁决累计，非基准集跑分。基准集本身是
"这些拦截能力有测试钉着"的证据链，不是分数发生器。

## 如何跑

每条用例的 `pytest_selector` 字段是可直接使用的 `-k` 表达式：

```bash
# 单条（以 TRUST-001 为例）
python3 -m pytest tests/ -k "test_trust_default_denied"

# 一族（launcher-env 白名单钉族）
python3 -m pytest tests/ -k "test_poison_env_fully_stripped or test_mixed_env_exact_output or test_whitelist_exact_set"

# 全族回放：按 cases.json 的 pytest_selector 逐条跑，或直接跑源测试文件
python3 -m pytest tests/test_notify.py tests/test_test_cache.py tests/test_boundary_guard.py \
  tests/test_secret_scan.py tests/test_launcher_env.py tests/test_execution_valve.py \
  tests/test_read_before_edit.py tests/test_pre_commit_guard.py tests/test_scan_check.py \
  tests/test_history.py tests/test_pending.py -q
```

清单自身的健康校验（schema / selector 真实可命中 / 摘要长度上限）：

```bash
python3 -m pytest tests/test_benchmark_manifest.py -q
```

## 族一览

| family | 覆盖面 | 例数 |
|---|---|---|
| notify-trust | 通知通道供应链信任面（env 注入重定向 / 凭据字段门 / API 域钉住） | 5 |
| notify-pin | 同路径换内容分级防线（敏感面调包 / 人工重授信对照） | 2 |
| launcher-env | 守卫子进程环境白名单（全量剥离 / 全集双向钉 / 大小写归一） | 5 |
| test-cache | 门禁测试缓存完整性（键敏感 / 伪造拒绝 / 生存期 / 防死循环对照） | 6 |
| boundary-guard | 开发边界与 shell 写目标提取（越界 / 工具旁路 / 跨会话 / 误报防御） | 8 |
| secret-scan | 提交密钥扫描（高精度命中 / 私钥块 / 目录豁免边界 / 删除行对照） | 4 |
| execution-valve | 不可逆命令执行阀（毁灭类模式 / 复合命令夹带 / 旗标变形 / 令牌授权对照） | 7 |
| edit-fingerprint | 先读后改与文件指纹守卫（盲改 / 读数阈值 / 外部改动失配 / 重读恢复对照） | 7 |
| commit-gate | 提交门禁本体（间接提交识别 / 清单解析 fail-closed / 验收拦截 / 自审键） | 10 |
| scan-freshness | 全貌新鲜度三态与规则A（缺扫描拦 / 占位防绕 / 三态判定 / 轻量豁免对照） | 9 |
| acceptance-gate | 验收标准入环 EARS 机器化（未勾拦 / 占位拦 / 两行判据 / 宽松计勾对照） | 5 |
| rule-recall | 拦截现场规律召回与有效性度量（TOP-3 召回 / 开关与坏账降级 / 三态归类 / 热力图） | 8 |
| pending-reflow | 待决决策自动回流（过门禁闭环 / 精确锚定 / 多义防护 / 误报口径隔离） | 6 |

schema 冻结为五字段（增删须同步 `tests/test_benchmark_manifest.py` 与本文档）：

```json
{"id": "TRUST-001", "family": "notify-trust", "attack_summary": "一句话脱敏描述",
 "expected": "门禁应然行为（拒/拦/剥离/放行/钉回）", "pytest_selector": "-k 表达式"}
```

约束：`attack_summary` <= 80 字符（防载荷复述回潮）；`id` 全局唯一且形状稳定
（大写词-三位序号）。

## 引用格式

按 id 引用，不引用测试函数名（函数会改名，id 不会）：

> regress-guard 公开基准 TRUST-001（环境变量注入重定向通知信任面）：
> 通知通道默认拒 + 生产路径零环境变量影响。

批量引用时可引族名：`regress-guard benchmarks: launcher-env 族（5 例）`。
校验引用是否仍有效：`python3 -m pytest tests/test_benchmark_manifest.py -q`
——任何一条 selector 失配（测试被删/改名）都会红。
