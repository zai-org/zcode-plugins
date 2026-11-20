# 能力卡：pifa

> 由 scripts/capability_cards_export.py 离线生成（确定性输出）；数据源与坑号链见文中逐条标注。

## 适用场景

- 拓扑：PIFA（§10.3 C1）：贴片 z=h（L×W）+ +x 边短路板（宽 Ws，z 0→h 触地）+ 馈针（距短路板 pin_back，y 偏 pin_y，针顶触贴片、针底触地）；LumpedPort 沿针 z 向；基板 + z-min PEC 无限大地
- f0：2.4 GHz ｜ 端口：1 ｜ 时长 ≤30.0 ns ｜ 网格档：0.0 mm
- 提取口径：S11 @ LumpedPort 1（PIFA 居中短路板 λ/4：谷位/谷深；L 路径式定版标称 17.0785 ≈ 真机 override 17.08 → −8.79dB@2.26GHz（−5.8%）PASS，Zin@谷=105−14jΩ，见 smoke_note）
- 参数：pifa_l_mm, pifa_w_mm, pifa_ws_mm, pin_back_mm, pin_y_mm
- 基板：{"er":3.66,"h_mm":0.508}

## 名义参数

| 参数 | 名义值 |
|---|---|
| pifa_l_mm | 17.0785 |
| pifa_w_mm | 8.0 |
| pifa_ws_mm | 2.0 |
| pin_back_mm | 2.0 |
| pin_y_mm | 2.0 |
- 名义参数来源：`docs/templates/pifa/meta.yaml`（与 TEMPLATE_NOMINAL 一致性由 test_gallery_export 钉）

## 敏感性排序（R9 先承诺）

- 出处=computed（幅值分数登记表 `knowledge/sensitivity_rankings.yaml`；证据 scripts/sensitivity_rankings_build.py；坏条目拒收如实降级 #105）

- 方法 central_finite_difference_elasticity ｜ n=11 ｜ 证据：scripts/sensitivity_rankings_build.py

| rank | 参数 | 分数 |
|---|---|---|
| 1 | pifa_l_mm | 1.0 |
| 2 | pifa_w_mm | 0.029987 |
| 3 | pifa_ws_mm | 0.0 |
| 4 | pin_back_mm | 0.0 |
| 5 | pin_y_mm | 0.0 |
- 排序=R9 commitment_order（optimization/eipu；高敏感先钉死，平局按参数名升序）

## 判据

- 锚覆盖 5：coupled_microstrip.kj_even_domain.lit-v1、cps.gamma_er.fdref-v1、mmt.inductive_post_b.hfss-v1、mmt.resonant_window_fres.hfss-v1、pifa.f_res.openems-v1（core/anchors；通配 + 专属）
- 健康门：无模板作用域专属健康门（gate 如实不判，#274 口径）
- 通用体检：求解健康度体检 G11 九因子（core/solve_health；service/health_service.health_check_run 按 run 装载产物判定）

## 引擎精度卡（跨引擎仲裁锚）

- `coupled_microstrip.kj_even_domain.lit-v1`（constant/active；闭式/文献锚（无引擎对））：kj_even_domain_dev_pct = 0.66 percent；±1.0（arbitration_interval）；verdict KJ_VINDICATED_J1_PASS（Elmer 三紧缝/域缘点 even −0.180%/−0.590%/−0.439% 全 J1 PASS；p2_summary.json overall=FAIL 属 HFSS 测量面非 KJ 本体，勿混淆）；证据：runs/df7_kjeven
- `cps.gamma_er.fdref-v1`（formula/active；闭式/文献锚（无引擎对））：cps_gamma_er expr = 1 + 0.9014*er**-0.6361（变量：er）；±0.006（relative）；证据：runs/df6_dp14m1、runs/df6_dp18c9
- `mmt.inductive_post_b.hfss-v1`（constant/active；引擎对 mmt（hfss 仲裁））：inductive_post_b_dev_pct = 9.224 percent；±7.0（arbitration_interval）；verdict AGREE_HFSS；证据：runs/mmt_anchor_20260930
- `mmt.resonant_window_fres.hfss-v1`（constant/active；引擎对 mmt（hfss 仲裁））：resonant_window_f_res_dev_pct = 16.6 percent；±3.0（arbitration_interval）；verdict AGREE_HFSS；证据：runs/mmt_anchor_20260930
- `pifa.f_res.openems-v1`（pointer/experimental；引擎对 openems（hfss 仲裁））：pifa_f_res_ghz 双值 openems=2.268 GHz（不取平均，#122）；±0.12（engine_pair_spread）；verdict PASS（同 dipole 席门族全过）；证据：runs/aurora_e/w2srv_r2/pifa
- 数据源：`knowledge/anchors.yaml`（仲裁锚注册表，status/版本演进口径见该文件头注；本节零计算零求值）

## 已知边界

- 参数语义：pifa_l_mm=贴片长 L（L 路径式定版 L=λ0/(4√εeff(W))，HJ @W；居中短路板电流不绕行，文献通式 L+W−Ws 的 +W−Ws 项不适用，真机两轮实证），pifa_w_mm=贴片宽 W，pifa_ws_mm=短路板宽 Ws（≤W，几何输入不进谐振式），pin_back_mm=馈针距短路板（定匹配），pin_y_mm=馈针 y 偏置（<W）
- 网格：辐射器件：上方/侧向空气隙 λ0/4；贴片/短路板/针缘精确入网
- 冒烟现状：真机 runs/antenna2_smoke/pifa（2026-09-14，旧通式标称 L=11.0785）FAIL：|S11|≥−0.02dB 全带，Zin=0.0+j(3.9→8.6)Ω 随 f 线性=纯短路桩电感 ⇒ 谐振在 2.9GHz 之上。两轮实证：① 去掉同体积金属针盒（pifa_v1_pin_short→pifa）S11 逐点不变，"PEC 针盒短路端口"假设证伪；② override pifa_l_mm=17.08（=λ0/(4√εeff(W))，仅 L 路径口径，runs/antenna2_smoke/pifa_override）→ −8.79dB @2.26GHz（−5.8%）PASS，Zin@谷=105−14jΩ（并联型谐振，馈针距短路板 2mm ⇒ R_peak≈100Ω 过耦合限谷深）。根因：L+W−Ws=λ/4 通式假定角部短路板（电流绕行贴片宽），本布局短路板居中不绕行，有效路径≈L。定版（2026-09-16）：设计式改 L 路径式 pifa_l_mm=λ0/(4√εeff(W))，标称 17.0785（与 PASS 的 override 17.08 差 0.0015mm=0.009%，真机证据直接沿用，不另跑），fake 逆/ANTENNA2_NOMINAL/单测/本文件同步；谷位 −5.8% 为细带端效应/短路板电感口径偏差，设计式不预补偿（#190）
- 失败模式坑账链（playbook 命中 17 条，坑号 #NNN 为 DEVLOG 出处标记）：
  - `fdtd_truncation_artifact`（fdtd_truncation_artifact；坑：#262、#84、#266）——窄 FC 窗/NrTS 截断长脉冲 → |S11|>1 假象；max|S11|>1 先查截断再怀疑物理
  - `sparam_nonphysical_investigate`（sparam_nonphysical_investigate；坑：#262、#174）——无衰减证据时的保守候选：截断已排除才升级物理怀疑
  - `single_excitation_mask_semantics`（single_excitation_mask_semantics；坑：#314、#248）——单激励产物零填充/互易补齐元素不构成互易证据；全矩阵比对是假阳性指纹
  - `true_reciprocity_violation`（true_reciprocity_violation；坑：#314、#257）——独立已测对上的互易破坏才是真破坏
  - `hfss_cad_unite_failure`（hfss_cad_unite_failure；坑：#310、#285）——unite 返回 False/合并后对象数>1=金属网络不连通，馈电不导电
  - `hfss_sheet_compression_undecidable`（hfss_sheet_compression_undecidable；坑：#264、#122）——多轮网格/端口排查互差小且仍 UNDECIDABLE=建模路径可疑，非数据坏
  - `pyaedt_session_leak`（pyaedt_session_leak；坑：#265、#308）——退出未 release 占 HFSS 轨；杀前先看命令行
  - `pyaedt_geometry_selection_api`（pyaedt_geometry_selection_api；坑：#285、#308）——gRPC 通道损坏后 finally release 可能静默失败，先修对象引用
  - `excitation_zero_volume`（excitation_zero_volume；坑：#174）——全带 |S11|≈0dB 平推=死激励指纹
  - `grid_near_coincident_lines`（grid_near_coincident_lines；坑：#152、#349）——nm 级近重合线 → CFL 时间步塌缩多个量级，症状常在端口链下游
  - `fake_cost_degenerate`（fake_cost_degenerate；坑：#195、#118）——窄带谐振带内 max 是常数陷阱；谷深语义走显式指标名
  - `probe_window_low_confidence`（probe_window_low_confidence；坑：#283、#282）——探针盒 <2 格/中线不落线 → 端口链偏差混入噪声
  - `dissipation_power_mismatch`（dissipation_power_mismatch；坑：#218、#244）——功率守恒破坏先查建模量纲再查物理
  - `thermal_model_implausible`（thermal_model_implausible；坑：#233）——恒温陷阱=热源项未被消费的典型症状
  - `hfss_port_convention_gap`（hfss_port_convention_gap；坑：#285、#307、#282、#335）——两引擎对同一设计可方向相反地偏；单引擎归因不可外推
  - `judgment_gate_fail`（judgment_gate_fail；坑：#122、#345）——通用裁决失败候选——更具体族同击时以其为主
  - `run_execution_failed`（run_execution_failed；坑：#144、#295）——status=failed 的执行层失败；物理判读前先排除环境/路径问题
