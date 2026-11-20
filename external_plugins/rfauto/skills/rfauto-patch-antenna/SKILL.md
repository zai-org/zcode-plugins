---
name: rfauto-patch-antenna
description: >-
  用 rfauto 设计、仿真或调参矩形微带贴片天线时使用。涵盖腔模型谐振、贴片宽度与长度综合、馈电内缩（inset feed），以及配方驱动的 run、tune、autotune、calibrate 工作流。触发词：patch antenna、microstrip antenna、patch width、inset feed、resonance frequency、贴片天线、微带天线、谐振频率、馈电。PIFA、IFA 和贴片阵列（见其他 rfauto 卡），以及一般性 PCB 天线问题，不适用本卡。数值只来自 rfauto 内核与 references/ 下的卡片文件。
license: 完整条款见本目录 LICENSE.txt
compatibility: 需要 PATH 中可用的 rfauto 命令（公开仓源码安装：在仓根执行 pip install -e .）。闭式综合可离线运行；引擎步骤需本机装有 openEMS 或 HFSS。
metadata:
  author: rfauto
  version: '2'
  rfauto_model: patch_antenna
  card_kind: recipe+capability+kernel
  generator: 'curated from recipe_to_skill; spec: agentskills.io / rfauto T-Q10'
  source_recipe: recipes/patch_antenna_v1.yaml
  source_cards: docs/capability_cards/patch.md, docs_site/kernel_cards/patch.md
allowed-tools: Bash(rfauto:*) Read
---

# rfauto skill：patch_antenna

## 器件与目标

- 模型插件：`patch_antenna`；扫频 1.5–3.5 GHz。
- 带内目标（objectives）：
  - `s11_db_min` max_below -10 @ [1.8, 2.1] GHz

## 可调参数（optimization.params）

| 参数 | low | high |
|---|---|---|
| patch_len_mm | 37.5 | 42.5 |
| patch_w_mm | 40.0 | 45.0 |

## 标准工作流（typed 命令，数值由确定性内核产出）

```bash
rfauto validate patch_antenna_v1.yaml          # 配方校验
rfauto run patch_antenna_v1.yaml -a fake       # fake 快验证（秒级）
rfauto autotune patch_antenna_v1.yaml --budget 3   # 确定性 critique 自治环
rfauto tune patch_antenna_v1.yaml -a openems --max-trials 30  # 外环寻优
rfauto calibrate patch_antenna_v1.yaml --sampler openems  # 代理校准（如接入）
rfauto p0 <recipe> --high-adapter hfss   # 终验（商业求解器收口）
```

## 扫描 notebook 骨架（openEMS 快验证）

```python
from rfauto.adapters.em_solver_base import EMSolverConfig
from rfauto.adapters.openems_solver import OpenEMSSolver

solver = OpenEMSSolver(EMSolverConfig(
    solver_type="openems",
    freq_range_ghz=tuple([1.5, 3.5]),
    mesh_resolution_mm=0.45,  # 网格 base 覆盖；0=自动 λ_sub/50
))
solver.connect()
solver.build_geometry({"template": None, "params": {}})  # 填参数点
result = solver.solve()
```

## 边界（硬约束）

- LLM/agent 不产生物理数字：所有指标来自求解器与确定性评判器。
- 对配方的任何修改走沙箱草稿 → 三层 Gate 审批（agent 写面隔离）。
- FAIL 如实记录，不凑绿。

## When to open the reference files

| you need | open |
|---|---|
| the full capability card (playbook, all anchors, engine precision) | `references/capability_card.md` |
| formulas, docstring pins, precision profile, code entries, test surface | `references/kernel_card.md` |
| a symptom → pitfall → fix lookup | `references/pitfalls.md` |
| the read-only stackup facts behind this recipe | `configs/materials.yaml` (source of truth) |

## Verify before you finish

Run `python scripts/verify_output.py --json <saved.json> [--expect KEY=VALUE ... --tol 1e-3]`.
FAIL is reported as FAIL (rfauto rule #122); never retry a FAIL into green.
