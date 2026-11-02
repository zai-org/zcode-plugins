# -*- coding: utf-8 -*-
"""py 确定性层版本（单一事实源）。

设计审查 P0-2 根治机制：PY_BUS 将 LAYER_VERSION 回传进 headline.layer_version，
编排层与之硬比对——缓存副本/研究目录陈旧副本/审计快照误绑一律明确报错拒绝，
不再静默降级（"确定性层是地基"的版本面收口）。

同步门（test_sync_l0）同时校验：正本/runtime 副本/当前缓存副本的 LAYER_VERSION
与 .zcode-plugin/plugin.json、marketplace.json 版本一致。

v0.13.1：冻结契约健壮性批——render 台账新增 freeze_status 行（评审 C-2）。
v0.13.2：通道收口批——extract 新增 assertion_gaps（候选盲区宽表重扫）；freeze 新增 exclude_prefixes。
v0.13.3：路径健壮性批——py 层无功能变更，版本随 workflow（绝对路径规范化+reportName 分隔符双认）对齐握手。
"""

LAYER_VERSION = '0.13.3'
