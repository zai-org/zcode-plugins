---
name: rfauto-wilkinson-power-divider
description: >-
  用 rfauto 设计、仿真或调参 Wilkinson 功分器时使用。涵盖两路等分、λ/4 臂综合和隔离电阻，以及配方驱动的 run、tune、autotune、calibrate 工作流。触发词：wilkinson、power divider、splitter、isolation resistor、arm length、威尔金森、功分器、等分、隔离电阻、臂长。N 路和不等分变体（见其他 rfauto 卡），以及 branchline、ratrace、gysel 耦合器，不适用本卡。数值只来自 rfauto 内核与 references/ 下的卡片文件。
license: 完整条款见本目录 LICENSE.txt
compatibility: 需要 PATH 中可用的 rfauto 命令（公开仓源码安装：在仓根执行 pip install -e .）。闭式综合可离线运行；引擎步骤需本机装有 openEMS 或 HFSS。
metadata:
  author: rfauto
  version: '2'
  rfauto_model: wilkinson_power_divider
  card_kind: recipe+capability+kernel
  generator: 'curated from recipe_to_skill; spec: agentskills.io / rfauto T-Q10'
  source_recipe: recipes/wilkinson_pd_v1.yaml
  source_cards: docs/capability_cards/wilkinson.md, docs_site/kernel_cards/wilkinson.md
allowed-tools: Bash(rfauto:*) Read
---

# rfauto skill：wilkinson_power_divider

## 器件与目标

- 模型插件：`wilkinson_power_divider`；扫频 1.5–3.5 GHz。
- 带内目标（objectives）：
  - `s11_db` max_below -15 @ [2.3, 2.5] GHz
  - `s21_db` mean_within [-3.6, -3.1] @ [2.3, 2.5] GHz
  - `iso_s23_db` min_above 20 @ [2.3, 2.5] GHz

## 可调参数（optimization.params）

| 参数 | low | high |
|---|---|---|
| arm_len_mm | 18.0 | 23.0 |
| series_w_mm | 0.25 | 0.45 |
| shunt_w_mm | 0.9 | 1.3 |

## 标准工作流（typed 命令，数值由确定性内核产出）

```bash
rfauto validate wilkinson_pd_v1.yaml          # 配方校验
rfauto run wilkinson_pd_v1.yaml -a fake       # fake 快验证（秒级）
rfauto autotune wilkinson_pd_v1.yaml --budget 3   # 确定性 critique 自治环
rfauto tune wilkinson_pd_v1.yaml -a openems --max-trials 30  # 外环寻优
rfauto calibrate wilkinson_pd_v1.yaml --sampler openems  # 代理校准（如接入）
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
