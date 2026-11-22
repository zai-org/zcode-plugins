# rfauto MCP 工具集目录(14 集)

> 由 `rfauto knowledge/toolsets.yaml`(schema rfauto-toolsets-v1)生成;
**成员名单以 MCP 注册面为准**,此处 tools_hint 为导航启发。
每个工具集的 `skill` 字段是该域的调用时序纪律(含坑号出处)——进入
不熟的域之前先读对应小节。

## platform_lifecycle

平台生命周期——环境体检/模型与模板目录/配方校验/战役计划面

提示成员: `doctor`, `list_models`, `validate_recipe`, `list_template_specs`, `list_calculators`, `run_calculator`, `get_model_3d`, `draft_recipe_from_spec`, `plan_campaign`, `get_campaign_status`, `save_campaign_plan`, `multi_agent_run`

**调用纪律**:

会话开工先 doctor 探环境（对应官方 lifecycle 工具集 check_aedt_installed 的
同位语义）；配方改动先 validate_recipe 过三层 Gate 再建 run（#317 配方写
守卫：UI 表单整文档回写是污染源）；战役先 plan_campaign 冻结全参数再放量
（#253 探针不带全参数会撞不可变校验）；模板目录先 list_template_specs 再
draft_recipe_from_spec（登记行只作线索不作现状，#222）。

## simulation_runs

求解作业生命周期——创建/轮询/取消/指标读取/工件对账/战役执行

提示成员: `create_run`, `create_run_async`, `poll_job`, `wait_job`, `cancel_job`, `get_metrics`, `get_run_artifacts`, `run_monitor`, `run_campaign`, `compare_runs`

**调用纪律**:

先 doctor 探环境再 create_run；轮询用 poll_job（前台长跑 wait_job 需显式超时，
竞态完成的真结果要接受，见 #145）；run 结束先 explain_run/run_monitor 看门再
get_metrics；判 run 真伪看 meta.json 的 adapter/study 字段（#144）；战役类走
run_campaign 内部 executor（零 shell 出，VI-2）；跨 run 对比用 compare_runs。

## hfss_arbitration

HFSS 真机求解与跨引擎仲裁（HFSS 结果为对齐基准）

提示成员: `read_hfss_touchstone_comments`, `marchand_balun_design`, `marchand_two_section_synthesis`, `msl_slot_transition_design`, `slotline_analysis`, `slotline_synthesis`, `certify_design`

**调用纪律**:

HFSS 结果为对齐基准（A220）；真机异常第一时间查官方文档再改模型（A216，
#191 波端口尺寸实证）。仲裁前先验收敛——ΔS 达标不等于关键标量收敛，做
阶梯看饱和（#335）；薄片导电用 assign_perfecte_to_sheets 而非 pec 盒（#356）；
unite 后只引用首对象名（#285）；pyaedt 退出必 release_desktop，防孤儿
ansysedt 占轨（#265）。Touchstone 读回先 read_hfss_touchstone_comments
看注释块口径。

## openems_fdtd

openEMS/FDTD 渲染守卫与真机求解

提示成员: `mmt_solve`, `render_constraint_check`, `dispersion_report`

**调用纪律**:

网格构建末尾必做最小间距守卫，防 CFL 时间步塌缩（#152）；FC 窗要覆盖脉冲
全程，max|S11| 大于 1 先查截断再疑物理（#262/#266）；跨 Run 绑定对象禁复用，
多端口走进程隔离单激励（#208）；柱坐标不支持 MUR、一律 PML_8（#232）；预算
外推看 port_ut 末行时间轴，et 文件 mtime 停止不等于卡死（#268/#323）；旋钮
效力断言必须在同参最终网格上做（#368）。渲染约束先过 render_constraint_check。

## synthesis_design

射频综合设计面——滤波器/功分器/链路预算/交调/NFC 线圈

提示成员: `synthesize`, `synthesize_bpf`, `budget_analysis`, `cascade_budget`, `spur_search`, `if_plan_sweep`, `nfc_coil_synthesize`, `nfc_coil_q`, `nfc_coil_evaluate`

**调用纪律**:

线宽与名义几何一律 skrf HJ 综合精算（core/synthesis.py），禁沿用其他模型或
文档的毫米数（AGENTS 规则 1c；#252 名义臂长手算捷径致谐振负偏一成）；合成
产物先 validate_recipe 过三层 Gate 再真跑；预算/交调用 budget_analysis 与
spur_search（ADS 侧同源核对走 compose_netlist）。

## calibration_optimization

校准/优化闭环——采样/提案/确定性批判/自动调参/暖启动

提示成员: `rf_run_sampler`, `rf_propose_params`, `rf_critique_point`, `rf_spec_cost`, `warm_start_optimize`, `autotune_self_verify`, `self_heal_run`, `robustness_report`

**调用纪律**:

LLM 永不产生物理数字，数值只在确定性内核（铁律 7）；批判/修正走
rf_critique_point 等 service 确定性函数；同种子重跑秒回是缓存合法、新轨迹
换 study 或 seed（#158）；warm-start 历史集上界剔除阈值必须等于判据同款
target（#273）；自治环 critique 结果先过 autotune_self_verify 再采信。

## measurement_correlation

测量互证与相关性——VNA/NF 测量/带限查询/跨通道对拍

提示成员: `correlate_measurement`, `vna_en_report`, `vna_offline_replay`, `nfmeas_cut_view`, `nfmeas_ffs_info`, `bands_list`, `bands_find`, `bands_get`, `bands_spec_bounds`, `bands_env_list`, `bands_env_find`, `bands_env_get`, `bands_env_points`, `bands_env_uq_axis`, `bands_env_delta_t`

**调用纪律**:

跨适配器比较先统一单位并显式归一，空交集会静默通过（#121）；频轴对齐用
最近邻加 ulp 容差，禁 searchsorted 越位（#287/#294）；深谐振谷族的 dB 域
判据换线性域幅值或加 eps 锚（#370/#371）；测量侧入口 correlate_measurement，
ENR/离线回放走 vna 系，近场走 nfmeas 系，带限查询先 bands_list 再 bands_find，
环境扫与规格界走 bands_env 系与 bands_spec_bounds。

## knowledge_diagnostics

知识总线与诊断——坑账检索/失败指纹/锚点/指南/解释

提示成员: `search_knowledge`, `get_guidelines_for`, `error_hints_lookup`, `explain_run`, `diagnose`, `rag_query`, `rag_explain`, `anchors_list`, `anchors_inspect`

**调用纪律**:

动手前先检索坑账（pitfalls_index 加 playbook 指纹加 rules 三源，本工具集的
get_guidelines_for 与 search_knowledge 同走确定性检索）；诊断规则只收症状可
机器观测的确定性指纹（playbook 设计约束，无检测器支撑的坑不硬塞，#122 哲学）；
观测工具自身失真会掩盖真实 tag（#331：审计 dump 打印 tag 原文）；坑号是
Devlog 出处标记（D1 裁决保留口径）；锚点查证走 anchors_list 与
anchors_inspect，环境体检先 `rfauto doctor`。

## layout_kicad

KiCad 版图面——提取/CPW 优化/远场联动

提示成员: `kicad_extract`, `kicad_optimize_cpw`, `farfield_runs`, `farfield_view`

**调用纪律**:

KiCad 一律子进程调用自带 Python 3.11（AGENTS 规则 2，ABI 硬限制，项目 venv
禁 import pcbnew）；zone 自有多边形一律 AppendCorner 写入（#220 SWIG 归属
陷阱）；层 id 禁写死数值（#210 族重排）；远场联动产物对账走 farfield_runs
与 farfield_view。

## remote_multihost

远程多机协同——探活/状态/队列（lab_server 通道）

提示成员: `remote_probe_machine`, `remote_machine_status`

**调用纪律**:

服务器侧版本必须等于本机（AGENTS 规则 0，gRPC 客户端-服务端版本配对）；
先 remote_probe_machine 探活、remote_machine_status 看队列再发射；任务毕
必清理（杀 ansysedt 删 schtasks，remote_hfss_cleanup）；发射后存活复核，
隐藏形态进程易被杀毒静默击杀（#157 家族）；中间文件只落服务器工作盘，
禁写生产云盘。

## uq_robustness

不确定性与稳健性——良率/设计中心/温度带/稀有失效

提示成员: `uq_yield_at`, `uq_design_center`, `uq_temperature_zone`, `uq_rare_yield`

**调用纪律**:

Saltelli 一阶估计量先对目标做常数居中，防大数相减失效（#234）；判据统计量
必须匹配响应形态——窄带谐振器件带内 max 是常数陷阱，谷深语义走显式指标名
s11_db_min（#195）；新器件族接校准前先离线小样本验证 cost 分布非退化；
稀有失效走 uq_rare_yield 重要抽样。

## signals_integrity

信号/电源完整性——SI 通道/PDN/EMC/ADC 预算/编织偏斜

提示成员: `si_channel_report`, `pdn_analyze`, `pdn_gate`, `pdn_select`, `emc_cispr_band_params`, `emc_cispr_detect`, `emc_ground_spacing_check`, `emc_cm_radiated_budget`, `adc_interleave_spurs`, `jitter_budget_snr`, `com_pam4_run`, `weave_skew_estimate`, `weave_style_info`, `cm_cat_critique`, `cm_diagnose_q`, `cm_extract_refine`

**调用纪律**:

跨适配器与跨域比较先统一单位并显式归一，空交集会静默通过（#121）；判据
统计量必须匹配响应形态（#195，深谐振谷族 dB 域病态换线性域口径 #370）；
PDN 门/分域预声明先行（W4 批 MS-3 口径：预声明门错了也如实记 FAIL 不事后
改门，#122）；EMC 检波器/辐射预算走 emc 系确定性内核，零 LLM。

## data_platform

数据平台——工作目录导入/数据集查询/导出/标注/湖仓

提示成员: `discover_workdir_runs`, `import_workdir_runs`, `list_datasets`, `query_dataset`, `dataset_annotate_ground_truth`, `dataset_coverage`, `dataset_export_hf`, `dataset_set_visibility`, `import_solid_payload`, `lake_pack_campaign`, `lake_query_runs`, `db_init`, `db_migrate`, `db_query`, `db_status`, `db_reindex_runs`, `db_analytics_attach`

**调用纪律**:

工作目录产物导入三坑先读（#320 键路径优先级 params 大于 calib_params 大于
design_params；#321 多曲线目录显式引用归属，只比文件名会张冠李戴；#322
study_name 置空会跨战役折叠）；先 discover_workdir_runs 干跑核对再
import_workdir_runs 放量（#251 新战役先跑 1 点 ingest 核对成行）；query_dataset
的行数语义先实测一次返回再当总数消费（#369）。

## explain_report

解释与报告——失败解释/叙事报告/PDF 导出/清单核对

提示成员: `report_narrative`, `export_report_pdf`, `build_datasheet`, `fault_tree_report`, `log_digest`, `agentbench_regression`, `rationale_checklist`, `rationale_recall`

**调用纪律**:

文档与报告的统计数字必须代码实测，不沿用上一份（#97）；校准/判读结果
如实记 FAIL 或 PARTIAL，不凑绿（#122 学术诚信原则）；失败解释先
explain_run 走确定性规则面，叙事化走 report_narrative，落盘走
export_report_pdf（中文图逐张目检，matplotlib CJK 字形）。
