# .regress/ — 回归治理数据目录（先读我）

> 写给失忆的读者（新会话/新同事/接手者）：工作现场全在本目录，不依赖任何人的记忆。

## 三步上手

0. **产品需求**：先读 `product-context.md`（产品上下文卡：用户/价值观/行业惯例——如果存在）
1. **看现场**：`manifests/` 里 status ∈ planning/in-progress/verifying/blocked 的清单——
   planning=等人类批准；blocked=受阻（读清单 blocked 四问，need 写着需要你提供什么）
2. **跑环境**：清单正文「环境准备（必读）」段——版本/连接命令/唯一正确的启动入口
3. **干活**：按清单正文「实施顺序（一步一响）」逐步做，每步达成表里的可观察里程碑

## 什么时候算做完（不由感觉定义）

- 验收标准表逐条 locked（判据拿到证据）+ 脆弱点全部 locked/flagged——open 禁止提交
- 实际改动全部回写清单（F3 清零）；提交时 hook 自跑测试通过
- 清单 status → done

## 出错了怎么办

- verify 失败 → 先查清单「报错自救」表和脆弱点 rescue 字段
- 修复 3 次仍败/需要人类输入 → 受阻（`~/.zcode/regress-guard-hooks/lib/plan_approve.py <清单> --block`），
  转达 need——受阻是合法停止
- 假设被实测推翻 → 清单「假设失效记录」追加 was→reality→evidence，别悄悄改写
- 排障改了仍不好 → 这是**假设被证伪**不是防御不够：回「假设账本」新增一行重新取证，
  禁止直接叠防御层

## AI 会话

断点续作直接跑 `/regress:resume`（从本目录产物单侧重建现场）。
其他：decisions.md=决策史（否决过的方案别重走）；journal/=考古地层；history.jsonl=门禁决策史。

---
<!-- generated-by: regress-guard v1.26.1 · 机器生成；人工定制请删除本行（删除后永不被自动覆盖/刷新） -->
