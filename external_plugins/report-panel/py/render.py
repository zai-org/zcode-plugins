# -*- coding: utf-8 -*-
"""判级对账 + 报告渲染（纯函数，零 I/O）——v0.12 自 PY_RENDER 模板移植（设计审 P1-1：
模板/markdown 组装/账务覆盖此前活在 TS 字符串里 L0 够不着；入库后回放门与 L0 直达）。

render(payload) ← 解析后的渲染载荷 dict（键同 workflow renderPayload）：
  {clusters, member_findings, gap_findings, investigations, final_tiers, new_items, blind_a, unverified_j_ids, display}
返回 {report_md, log_md, tiers, caps, ledger, final_a}——写盘与 stdout 由调用方（PY_RENDER 壳）执行。
对账逻辑委托 tiering（单一事实源），本模块只做裁决结果的确定性呈现。
"""


def render(p):
    import tiering
    r1 = tiering.reconcile(p['clusters'], p['member_findings'], p['investigations'], p.get('final_tiers') or [])
    r2 = tiering.reconcile_new_items(p.get('new_items') or [], p['investigations'], p.get('unverified_j_ids'))
    tiers, caps, ledger = r1['tiers'], r1['caps'] + r2['caps'], r1['ledger']
    ledger['blind_a'] = p['blind_a']
    d = dict(p['display'])
    for _k in ('findings_total', 'blind_a', 'clusters_total', 'inv_total', 'assert_count',
               'coverage_pct', 'dims_adjudicated', 'dims_total', 'blind_fail_n', 'script_n', 'hollow_n'):
        d[_k] = str(d.get(_k, ''))
    notes = {str(t.get('id')): str(t.get('note') or '') for t in (p.get('final_tiers') or [])}
    sev_rank = {'A': 0, 'B': 1, 'C': 2}
    inv_by = {str(i.get('target')): i for i in p['investigations']}
    cl = []
    for c in sorted(p['clusters'], key=lambda x: sev_rank.get(tiers.get(str(x.get('id')), x.get('severity')), 9)):
        cid = str(c.get('id'))
        inv = inv_by.get(cid)
        seg = '## ' + cid + '（' + tiers.get(cid, str(c.get('severity'))) + '）' + c.get('title', '') + '\n'
        seg += '- 成员：' + '、'.join(c.get('member_ids', [])[:6]) + ('（同源）' if c.get('correlated') else '') + '\n'
        seg += '- 调查：' + (('%s｜%s｜终级 %s｜%s' % (inv.get('label'), inv.get('verdict'), inv.get('final_severity'), inv.get('evidence'))) if inv else '未调查（按未复算规则封顶）') + '\n'
        if notes.get(cid):
            seg += '- 定级：' + notes[cid] + '\n'
        cl.append(seg)
    cluster_lines = '\n'.join(cl)
    # v0.13（issue#4 C2）：J 系列意见正文此前不进报告任何节——封顶表出现 J1 但定义无处可查。
    # 判级取 reconcile_new_items 的对账后终级（r2.tiers），与簇清单同构呈现。
    j_tiers = r2.get('tiers') or {}
    j_lines = []
    for f in (p.get('new_items') or []):
        jid = str(f.get('id'))
        seg = '## ' + jid + '（' + j_tiers.get(jid, str(f.get('severity'))) + '）' + str(f.get('location', '')) + '「' + str(f.get('quote', ''))[:50] + '」\n'
        seg += '- ' + str(f.get('problem', '')) + '\n'
        if f.get('fix'):
            seg += '- 修复：' + str(f.get('fix')) + '\n'
        if f.get('verify'):
            seg += '- 验证断言：' + str(f.get('verify')) + '\n'
        j_lines.append(seg)
    j_md = '\n'.join(j_lines) if j_lines else '（终审无新增意见）'
    # v0.13：验证断言台账——findings 第6项 verify 的确定性呈现（panel-recheck 机械对账的事实源）。
    # 只收可机械验证项（'仅可人工复检'不进表），成员意见、J 系列与 GAP 查漏新增（v0.13.0 盲评补源）合并去重。
    va_rows = []
    seen_va = set()
    for f in list(p.get('member_findings') or []) + list(p.get('new_items') or []) + list(p.get('gap_findings') or []):
        v = str(f.get('verify') or '')
        fid = str(f.get('id'))
        if v and v != '仅可人工复检' and fid not in seen_va:
            seen_va.add(fid)
            va_rows.append('| ' + fid + ' | ' + str(f.get('location', '')) + ' | ' + v.replace('|', '\\|') + ' |')
    va_md = ('\n'.join(va_rows)) if va_rows else '（无可机械验证断言——各意见均未提供或仅可人工复检）'
    caps_md = ('\n'.join('| %s | %s→%s | %s |' % (c2['id'], c2['from_tier'], c2['to_tier'], c2['reason']) for c2 in caps)) if caps else '（无封顶——全部终级通过对账）'
    ledger_md = '盲评A %d → 簇A %d（%s）→ 法官A %d（%s）→ 对账后A %d（%s）' % (
        ledger['blind_a'], ledger['cluster_a'], ledger['blind_to_cluster'],
        ledger['judge_a'], ledger['cluster_to_judge'], ledger['final_a'], ledger['judge_to_final'])
    report_md = '# 评审报告 · ' + d['report_name'] + ' · ' + d['version'] + '\n\n'
    if d.get('banner'):
        report_md += '> ' + d['banner'] + '\n\n'
    report_md += '## 终审判定：' + d['verdict'] + '\n\n' + d['narrative'] + '\n\n'
    if d.get('blockers_md'):
        report_md += '## 🚫 交付资格阻断项（release_blockers）\n' + d['blockers_md'] + '\n\n'
    report_md += '## 必须修改项（must_fix）\n' + d['mustfix_md'] + '\n\n'
    report_md += '## 法官新增意见（J 系列）\n\n' + j_md + '\n\n'
    report_md += '## 验证断言台账（修订回归机械对账）\n\n| 意见 | 位置 | 验证断言 |\n|---|---|---|\n' + va_md + '\n\n'
    report_md += '## 漏检处置映射\n\n| 漏检项 | 处置 |\n|---|---|\n' + d['gapdisp_md'] + '\n\n'
    report_md += '## 分维度覆盖表\n\n| 维度 | 裁决 |\n|---|---|\n' + d['dimtable_md'] + '\n\n'
    report_md += '## 定级对账\n- A类数收敛：' + ledger_md + '\n- 封顶记录：\n\n| 簇 | 终级变动 | 依据 |\n|---|---|---|\n' + caps_md + '\n\n'
    report_md += '## 结构诊断与处方\n- hint：' + d['struct_hint'] + '｜' + d['dev_recommended'] + '\n- 结构病：' + d['diseases_md'] + '\n- standing_objection：' + d['standing_objection'] + '\n\n'
    report_md += '## 意见簇清单（A→C）\n\n' + cluster_lines + '\n## 台账\n'
    inv_break = str(d.get('inv_breakdown') or '')
    inv_show = d['inv_total'] + ('（' + inv_break + '）' if inv_break else '')
    report_md += '- 档位：' + d['depth'] + '｜评审员：' + d['seat_summary'] + '｜findings ' + d['findings_total'] + '（A ' + d['blind_a'] + '）｜簇 ' + d['clusters_total'] + '｜调查 ' + inv_show + '\n'
    report_md += '- 材料总线：' + d['materials'] + '（headline：' + d['headline'] + '）\n'
    # v0.13.1（评审 C-2）：冻结契约状态进台账——armed/verified/skipped/timeout/internal-error/tampered
    report_md += '- 冻结契约：' + str(d.get('freeze_status') or '未记录') + '\n'
    report_md += '- 断言登记表：' + d['assert_count'] + ' 条（全量注入）｜查漏自评覆盖 ' + d['coverage_pct'] + '%（' + d['coverage_basis'] + '）｜维度三态裁决 ' + d['dims_adjudicated'] + '/' + d['dims_total'] + '\n'
    log_md = '# 过程台账 · ' + d['report_name'] + '\n- 备料：' + d['headline'] + '｜覆盖断言：' + d['cov_assert'] + '｜py 来源：' + d['py_dir'] + '\n'
    log_md += '- 盲评：' + d['seat_summary'] + '｜失败剔除 ' + d['blind_fail_n'] + '｜脚本预检 ' + d['script_n'] + '（口径门禁后）｜XH直通调查 ' + d['hollow_n'] + '\n'
    log_md += '- 调查单元：' + d['inv_composition'] + '\n'
    log_md += '- 定级对账：' + ledger_md + '｜封顶 ' + str(len(caps)) + ' 条\n'
    return dict(report_md=report_md, log_md=log_md, tiers=tiers, caps=caps,
                ledger=ledger, final_a=ledger['final_a'])
