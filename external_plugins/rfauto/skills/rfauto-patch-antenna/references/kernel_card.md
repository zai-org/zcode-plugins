<!-- XA-8 内核域文档卡：scripts/build_kernel_cards.py 生成（round18 规格 XA-8）。
     三源机读聚合：XC-P 精度档案 + KD-1 出处注册 + 模块 docstring/AST；
     公式 LaTeX 与使用边界为人工转写段，每条带 docstring 逐字引文钉。
     勿手改本文件——改源（YAML/docstring/测试面）后重跑生成器，
     保鲜门=tests/unit/test_kernel_cards.py（重渲染逐字节比对）。 -->

# 内核文档卡：patch

> E6a 微带线综合引擎（plan-extension_v2 §E6a）。

| 字段 | 值 |
|---|---|
| 内核 ID | `patch` |
| 主模块 | `src/rfauto/core/synthesis.py`（`rfauto.core.synthesis`） |
| 计算器注册表 | 未注册（AST 无 @register_calculator 装饰器——service 直调型内核，免 #231 注册表消费者三表同步） |
| KD-1 出处注册 | 2 条（kernel_file=src/rfauto/core/synthesis.py） |
| XC-P 精度档案 | 见下方「精度域」节（机读判定） |
| 数据来源 | XC-P + KD-1 + 模块 docstring/AST + anchors.yaml + tests/service 扫描 |

## 物理语义

矩形贴片天线综合（Hammerstad 模型）：宽/长闭式 + 边缘馈电阻抗的 sin² 腔体驻波变换定馈点，附带 Balanis 腔模读数面板（Q 分解/分数带宽/方向性/辐射效率）——ΔL 与 Rin_edge 全仓单源。

模块自述（docstring 首行，机读）：E6a 微带线综合引擎（plan-extension_v2 §E6a）。

## 公式与口径

### 贴片宽/长（Hammerstad 口径）

（docstring 原文转写）

```latex
W=\frac{c}{2f_0}\sqrt{\frac{2}{\varepsilon_r+1}},\qquad L=\frac{c}{2f_0\sqrt{\varepsilon_{\mathrm{eff}}}}-2\,dL
```

出处：synthesize_patch docstring「闭式公式」节；总扣语义仲裁 INCONCLUSIVE 在档，语义终裁挂 L5 v2 批。

docstring 逐字引文（防漂移钉）："W = c / (2*f0) * sqrt(2/(er+1))" + "L = c/(2*f0*sqrt(er_eff)) - 2*dL   [总扣口径=4ΔL（三副本一致，历史"

### 边缘等效伸长 ΔL（Hammerstad 1975 原式，全仓单源）

（docstring 原文转写）

```latex
\frac{\Delta L}{h}=\frac{0.412\,(\varepsilon_{\mathrm{eff}}+0.3)(w/h+0.264)}{(\varepsilon_{\mathrm{eff}}-0.258)(w/h+0.8)}
```

出处：patch_fringing_delta_l docstring（Hammerstad 1975；Pozar eq.4.23 同口径）；XA-1/PV-016 三副本收敛，本函数是全仓唯一 ΔL 算术单源。

docstring 逐字引文（防漂移钉）："ΔL/h = 0.412·(εeff+0.3)(w/h+0.264) / [(εeff−0.258)(w/h+0.8)]"

### 馈点位置（腔体驻波 sin² 变换，XA-2 闭式）

（docstring 原文转写）

```latex
R_{\mathrm{in}}(\mathrm{off})=R_{\mathrm{in,edge}}\sin^2\!\Bigl(\frac{\pi\,\mathrm{off}}{L}\Bigr),\qquad \mathrm{off}=\frac{L}{\pi}\arcsin\sqrt{\frac{R_{\mathrm{in,t}}}{R_{\mathrm{in,edge}}}}
```

出处：synthesize_patch docstring XA-2 节；Rin_edge 由 patch_rin_edge_balanis 闭式（Balanis 4th §14-8 口径）；输出口径=自贴片中心沿谐振轴偏移（#154 单源化）。

docstring 逐字引文（防漂移钉）："Rin(off) = Rin_edge·sin²(π·off/L)      （腔体驻波，off 自中心）" + "off = (L/π)·arcsin√(Rin_t/Rin_edge)    ≡ L/2 − y0"

### 腔模读数面板（Balanis 4th Ch.14 式链）

（docstring 原文转写）

```latex
\frac{1}{Q_t}=\frac{1}{Q_{\mathrm{rad}}}+\frac{1}{Q_c}+\frac{1}{Q_d},\qquad \mathrm{BW}=\frac{\mathrm{VSWR}-1}{Q_t\sqrt{\mathrm{VSWR}}},\qquad e_{\mathrm{cds}}=\frac{Q_t}{Q_{\mathrm{rad}}}
```

出处：patch_cavity_metrics docstring（#1c 原文核对：Balanis 4th ed. Ch.14 原文页 852-854 + Table 14.2 逐式核对）；方向性 D0 式 14-55 经 Jacobi-Anger 降维一维确定性求积。

docstring 逐字引文（防漂移钉）："1/Qt = 1/Qrad + 1/Qc + 1/Qd" + "- 分数带宽（式 14-88a）：BW = (VSWR−1)/(Qt·√VSWR)；"

### KD-1 出处注册（`src/rfauto/core/synthesis.py`，knowledge/formula_provenance.yaml 过滤）

命中 **2** 条：

| formula_id | symbol | kind | source_doi | refs |
|---|---|---|---|---|
| synthesis:chebyshev_lpf_g_values:01 | chebyshev_lpf_g_values | pointer | — | — |
| synthesis:patch_rin_edge_balanis:01 | patch_rin_edge_balanis | source | — | — |

## 精度域（XC-P 精度档案）

**未收录**：XC-P 首批建档内核共 **10** 个（bounds、conductor_loss、coupled_microstrip、dielectric_extract、etch_trapezoid、high_power、ridged_waveguide、shield_cavity_mode、synthesis.forward_z0、thermal_iteration），不含 `patch`。因此：

- 典型偏差分档：**UNVERIFIED**（无档案即无分档；本卡不编造任何精度数字——铁律 7 / #122 如实标注）；
- 域判查询：`core/precision_profiles.py` 对未知 kernel 如实降级（收集器=`tests/unit/test_precision_profiles.py` 逐条对照防漂移）；
- 建档入口：precision_profiles.yaml 增键（schema 见该文件头）+ `KERNEL_MODULES` 映射 + 模块 docstring 末尾「精度档案」镜像行 + 重跑本生成器。

> 本节为机读聚合：XC-P 收录状态与键清单构建时实测；本内核建档后此节自动展开为分档表（渲染支路已备）。

## 使用边界

- 越域显式 ValueError 不外推（=Rin_edge 退化边缘馈 off=L/2）；off∈(0, L/2] 由 arcsin 值域自动保证。
  - docstring 逐字引文："物理有效域 0 < Rin_t ≤ Rin_edge（馈点只能从中心向边缘提阻；"
- Rin_edge 出处页码/式号 UNVERIFIED 待核——章节级引用可用，页码级声称必须先回原文（#122）。
  - docstring 逐字引文："原文逐位核对，引用该出处前必须回原文核验，不冒充已核）。"
- ΔL 总扣语义（2ΔL vs 4ΔL）离线锚仲裁 INCONCLUSIVE——现行口径零行为维持，不凑裁决；语义翻转需联动多面另批。
  - docstring 逐字引文："离线锚仲裁判 INCONCLUSIVE：两语义"
- 腔模口径是薄基板假设——厚基板越域显式报错不外推。
  - docstring 逐字引文："适用域：k0·h ≪ 1（守卫同 patch_rin_edge_balanis <0.3，腔模口径）。"

## 代码入口

主入口（file:symbol，AST 校验存在）：

- `src/rfauto/core/synthesis.py:synthesize_patch`
- `src/rfauto/core/synthesis.py:patch_fringing_delta_l`
- `src/rfauto/core/synthesis.py:patch_rin_edge_balanis`
- `src/rfauto/core/synthesis.py:patch_cavity_metrics`

src/rfauto/core/synthesis.py 公开符号 **43** 个（AST 机读）：

`Stackup`、`ForwardMedia`、`forward_media`、`forward_z0`、`inverse_width`、`nominal_width_mm`、`lossless_width_mm`、`SynthesisResult`、`synthesize_mline`、`synthesize_batch`、`ModelSynthesisResult`、`synthesize_wilkinson`、`synthesize_branchline`、`patch_fringing_delta_l`、`patch_rin_edge_balanis`、`patch_cavity_metrics`、`synthesize_patch`、`synthesize_mline_model`、`synthesize_cpw_model`、`synthesize_dipole_model`、`synthesize_wstep_model`、`synthesize_tjunc_model`、`synthesize_bend_model`、`synthesize_via_model`、`synthesize_atten_pi_model`、`synthesize_atten_t_model`、`synthesize_ratrace_model`、`synthesize_gysel_model`、`synthesize_stripline_model`、`synthesize_cps_model`、`synthesize_suspended_stripline_model`、`synthesize_msl_cpw_model`、`synthesize_siw_model`、`synthesize_msl_siw_taper_model`、`synthesize_sma_launcher_model`、`synthesize_bpf_model`、`hairpin_design_from_order`、`synthesize_hairpin_model`、`chebyshev_lpf_g_values`、`synthesize_multisection_quarter_wave`、`synthesize_nway_wilkinson`、`schiffman_delta_phase`、`synthesize_schiffman`

消费面（service/adapters 引用扫描，机读）：

- service：`src/rfauto/service/anchor_family_service.py`
- service：`src/rfauto/service/diagram_stackup_service.py`
- service：`src/rfauto/service/em_bench_service.py`
- service：`src/rfauto/service/even_odd_service.py`
- service：`src/rfauto/service/kicad_em_service.py`
- service：`src/rfauto/service/level2_design.py`
- service：`src/rfauto/service/meep_sampling.py`
- service：`src/rfauto/service/package_chain_service.py`
- service：`src/rfauto/service/qucsator_service.py`
- service：`src/rfauto/service/teaching_service.py`
- service：`src/rfauto/service/unit_convert_service.py`
- adapters：`src/rfauto/adapters/comsol_adapter.py`
- adapters：`src/rfauto/adapters/edb_templates/schema.py`
- adapters：`src/rfauto/adapters/fake_adapter/adapter.py`
- adapters：`src/rfauto/adapters/fake_adapter/antenna_family.py`
- adapters：`src/rfauto/adapters/fake_adapter/coupler_family.py`
- adapters：`src/rfauto/adapters/fake_adapter/filter_family.py`
- adapters：`src/rfauto/adapters/fake_adapter/tl_family.py`
- adapters：`src/rfauto/adapters/layout_generator.py`
- adapters：`src/rfauto/adapters/meep_adapter.py`
- adapters：`src/rfauto/adapters/oe_templates/_nominal_width.py`
- adapters：`src/rfauto/adapters/oe_templates/closedform.py`
- adapters：`src/rfauto/adapters/oe_templates/render_c3.py`
- adapters：`src/rfauto/adapters/oe_templates/render_c4.py`
- adapters：`src/rfauto/adapters/oe_templates/render_coupled_bpf.py`
- adapters：`src/rfauto/adapters/oe_templates/render_diplexer_ridged.py`
- adapters：`src/rfauto/adapters/oe_templates/render_hairpin.py`
- adapters：`src/rfauto/adapters/oe_templates/render_phase_qwt.py`
- adapters：`src/rfauto/adapters/oe_templates/render_sicl_nway.py`
- adapters：`src/rfauto/adapters/oe_templates/render_siw.py`
- adapters：`src/rfauto/adapters/oe_templates/render_ta_wave_c.py`
- adapters：`src/rfauto/adapters/qucsator_adapter.py`

## 锚与测试入口

analytic-anchor（knowledge/anchors.yaml 机读命中）：

| anchor_id | quantity |
|---|---|
| `c3.k_of_g.openems-hfss-v1` | k_of_g |
| `mline.z0_ohm.closedform-v1` | mline_z0_ohm |
| `ratrace.r_ring_mm.closedform-v1` | ratrace_r_ring_mm |
| `ratrace.ring_z_ohm.closedform-v1` | ratrace_ring_z_ohm |
| `schiffman.delta_phase.closedform-v1` | schiffman_delta_phase_deg |

判据书/规格指针（docstring 逐字引文钉）：

- `runs/xa1_arbitration/l5_sweep/criteria.md`（runs/ 证据面，gitignored，存在性不作测试断言）——引文："在真实结构里是 18Ω，|S11| 卡 −6.5dB）。共形映射闭式见"

测试面（tests/unit 引用扫描，机读；合计 **1642** 个 test 函数）：

| 测试文件 | test 函数数 |
|---|---|
| `tests/unit/test_a3c_coupled_interdigital.py` | 20 |
| `tests/unit/test_anchd_analytic_anchors.py` | 7 |
| `tests/unit/test_anchors_correction.py` | 30 |
| `tests/unit/test_aniso_separation.py` | 7 |
| `tests/unit/test_array_templates.py` | 25 |
| `tests/unit/test_atten_pi_template.py` | 10 |
| `tests/unit/test_atten_t_template.py` | 9 |
| `tests/unit/test_audit_fix_core_visibility.py` | 15 |
| `tests/unit/test_bend_template.py` | 7 |
| `tests/unit/test_cal_wizard.py` | 37 |
| `tests/unit/test_calculators.py` | 49 |
| `tests/unit/test_coupled_bpf_template.py` | 34 |
| `tests/unit/test_coupling_matrix.py` | 52 |
| `tests/unit/test_cps_template.py` | 20 |
| `tests/unit/test_cpw_template.py` | 11 |
| `tests/unit/test_diplexer_ridged_templates.py` | 28 |
| `tests/unit/test_dipole_template.py` | 7 |
| `tests/unit/test_edb_templates.py` | 25 |
| `tests/unit/test_edb_templates_ext.py` | 38 |
| `tests/unit/test_eep_templates.py` | 19 |
| `tests/unit/test_engine_benchmark_expand_golden.py` | 25 |
| `tests/unit/test_gysel_template.py` | 15 |
| `tests/unit/test_hairpin_alt_template.py` | 26 |
| `tests/unit/test_hairpin_kgap_correction.py` | 16 |
| `tests/unit/test_hairpin_template.py` | 37 |
| `tests/unit/test_impedance_drc.py` | 27 |
| `tests/unit/test_interdigital_template.py` | 31 |
| `tests/unit/test_level2_design.py` | 62 |
| `tests/unit/test_marchand_two_section.py` | 22 |
| `tests/unit/test_marchand_via_ab.py` | 18 |
| `tests/unit/test_materials_loader.py` | 15 |
| `tests/unit/test_meep_adapter.py` | 38 |
| `tests/unit/test_mf_synthesis.py` | 33 |
| `tests/unit/test_mline_template.py` | 7 |
| `tests/unit/test_msl_cpw_template.py` | 19 |
| `tests/unit/test_msl_siw_taper_template.py` | 15 |
| `tests/unit/test_mtrl_kit_kicad.py` | 16 |
| `tests/unit/test_oe_phase3_driver.py` | 42 |
| `tests/unit/test_package_chain.py` | 37 |
| `tests/unit/test_patch_feed_offset_unification.py` | 6 |
| `tests/unit/test_pk2_vertical_lit_and_wiring.py` | 10 |
| `tests/unit/test_port_renormalize.py` | 14 |
| `tests/unit/test_qucsator_adapter.py` | 35 |
| `tests/unit/test_qw10_qw11.py` | 14 |
| `tests/unit/test_ratrace_template.py` | 19 |
| `tests/unit/test_rf_matrix_branchline.py` | 53 |
| `tests/unit/test_ring_resonator_template.py` | 25 |
| `tests/unit/test_rp1_myj_sec4_05_prototype.py` | 6 |
| `tests/unit/test_rp1_pozar_patch_example.py` | 3 |
| `tests/unit/test_rules_verify.py` | 6 |
| `tests/unit/test_schiffman_qwt_templates.py` | 26 |
| `tests/unit/test_sensanc_analytic_anchors.py` | 11 |
| `tests/unit/test_shell_below_service_ratchet.py` | 3 |
| `tests/unit/test_sicl_nway_templates.py` | 26 |
| `tests/unit/test_siw_template.py` | 26 |
| `tests/unit/test_sma_launcher_template.py` | 22 |
| `tests/unit/test_stackup_diagram.py` | 39 |
| `tests/unit/test_stepped_coupled_line_specs.py` | 8 |
| `tests/unit/test_stripline_template.py` | 12 |
| `tests/unit/test_suspended_stripline_template.py` | 19 |
| `tests/unit/test_symbolic_fit.py` | 15 |
| `tests/unit/test_synthesis.py` | 14 |
| `tests/unit/test_synthesis_bpf_asym_tz.py` | 8 |
| `tests/unit/test_synthesis_bpf_polish_backsub.py` | 8 |
| `tests/unit/test_synthesis_multisection.py` | 31 |
| `tests/unit/test_synthesis_patch_anchor.py` | 16 |
| `tests/unit/test_tjunc_template.py` | 8 |
| `tests/unit/test_unit_convert_service.py` | 13 |
| `tests/unit/test_varactor.py` | 26 |
| `tests/unit/test_varactor_bpf_template.py` | 12 |
| `tests/unit/test_via_template.py` | 7 |
| `tests/unit/test_w1s3_lange_stepped.py` | 11 |
| `tests/unit/test_w3s11_ring.py` | 12 |
| `tests/unit/test_w3s15_analytic_anchors.py` | 7 |
| `tests/unit/test_w4_a_sm_core.py` | 21 |
| `tests/unit/test_w4_w4e_anchors.py` | 10 |
| `tests/unit/test_w4s15_anchor_batch.py` | 11 |
| `tests/unit/test_w6_d_so_leftovers.py` | 32 |
| `tests/unit/test_w6_f_anchors_cpw.py` | 7 |
| `tests/unit/test_width_single_source.py` | 11 |
| `tests/unit/test_wilkinson_synthesis_semantics.py` | 7 |
| `tests/unit/test_wstep_template.py` | 8 |
| `tests/unit/test_x5_analytic_anchors.py` | 13 |

XC-P 精度档案收集器（防漂移对照面）：`tests/unit/test_precision_profiles.py`；本卡保鲜门：`tests/unit/test_kernel_cards.py`。

## 关联

- [架构与方法论（锚体系/判据先行）](../architecture/methodology.md)
- [分层架构](../explanation/layered-architecture.md)
- [计算器注册表](../reference/calculators.md)——本内核的注册状态见元数据表
- 同批内核卡：[macromodel](macromodel.md)、[rwg_mmt](rwg_mmt.md)、[pdn](pdn.md)、[pce](pce.md)、[cascade](cascade.md)、[mline](mline.md)、[wilkinson](wilkinson.md)、[branchline](branchline.md)、[ratrace](ratrace.md)、[hairpin](hairpin.md)、[cpw](cpw.md)、[slotline](slotline.md)、[coupled_microstrip](coupled_microstrip.md)、[finline](finline.md)、[wilkinson_unequal](wilkinson_unequal.md)、[atten_pi](atten_pi.md)、[atten_t](atten_t.md)、[qwt_multisection](qwt_multisection.md)、[nway_wilkinson](nway_wilkinson.md)、[schiffman](schiffman.md)、[bethe_hole_coupler](bethe_hole_coupler.md)、[gysel_core](gysel_core.md)、[coupled_line_bpf](coupled_line_bpf.md)、[lange](lange.md)、[stepped_impedance](stepped_impedance.md)、[ring_resonator](ring_resonator.md)、[mixer_conversion](mixer_conversion.md)、[ruthroff_balun](ruthroff_balun.md)、[gd_equalizer](gd_equalizer.md)、[measurement_drift](measurement_drift.md)、[agc_loop](agc_loop.md)、[cal_kit_verify](cal_kit_verify.md)、[six_port](six_port.md)、[iss_on_wafer](iss_on_wafer.md)、[source_power_cal](source_power_cal.md)、[combline](combline.md)、[cps](cps.md)、[interdigital](interdigital.md)、[siw](siw.md)、[slot](slot.md)、[stripline](stripline.md)、[suspended_stripline](suspended_stripline.md)、[dipole](dipole.md)、[helix](helix.md)、[link_limits](link_limits.md)、[fec_codes](fec_codes.md)、[directional_bridge](directional_bridge.md)、[rf_switch](rf_switch.md)、[kuroda_identities](kuroda_identities.md)、[pll_lock_time](pll_lock_time.md)、[multisection_coupler](multisection_coupler.md)、[itu_link](itu_link.md)、[link](link.md)、[dgs](dgs.md)、[if_digitizer](if_digitizer.md)、[wg_dielectric_window](wg_dielectric_window.md)、[waveguide_closed_form](waveguide_closed_form.md)、[waveguide_iris](waveguide_iris.md)、[hybrid_junction](hybrid_junction.md)、[radar_eq](radar_eq.md)、[modulation_ber](modulation_ber.md)、[coax_line](coax_line.md)、[analog_modulation](analog_modulation.md)、[si_ctle](si_ctle.md)、[propagation](propagation.md)、[hf_skywave](hf_skywave.md)、[fmcw_radar](fmcw_radar.md)、[sar_geometry](sar_geometry.md)、[gnss_geometry](gnss_geometry.md)、[radar_clutter](radar_clutter.md)、[microstrip_disc](microstrip_disc.md)、[open_wire_line](open_wire_line.md)、[wg_cavity_bpf](wg_cavity_bpf.md)
