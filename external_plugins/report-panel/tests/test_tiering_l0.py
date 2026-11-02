# -*- coding: utf-8 -*-
"""tiering.py L0（v0.8.1 A1 判级对账门）。
锚定用例取自 v0.8.0 样张D 验收实证——门的存在不得封堵当晚发生的合法升级。
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'py'))
import tiering  # noqa: E402

PASS, FAIL = 0, 0


def check(name, ok, detail=''):
    global PASS, FAIL
    print('  %s  %s%s' % ('ok ' if ok else 'FAIL', name, ('  [' + str(detail)[:70] + ']') if detail and not ok else ''))
    PASS, FAIL = PASS + (1 if ok else 0), FAIL + (0 if ok else 1)


print('== 1. 无降级证据判据（枚举组合） ==')
check('已验证+维持 = 有证据', tiering.no_downgrade_evidence(dict(label='已验证', verdict='维持')))
check('复算不符+升级 = 有证据', tiering.no_downgrade_evidence(dict(label='复算不符', verdict='升级')))
check('已验证+降级 = 无证据', not tiering.no_downgrade_evidence(dict(label='已验证', verdict='降级')))
check('幻觉+维持 = 无证据', not tiering.no_downgrade_evidence(dict(label='幻觉', verdict='维持')))
check('不可验证+维持 = 无证据', not tiering.no_downgrade_evidence(dict(label='不可验证', verdict='维持')))
check('无调查 = 无证据', not tiering.no_downgrade_evidence(None))

print('== 2. 含数字主张判据 ==')
check('quote 带数字', tiering.is_numeric_claim(dict(id='F1', quote='合计 4800 亿元')))
check('X 系列脚本 id', tiering.is_numeric_claim(dict(id='X1', quote='合计')))
check('XS 系列', tiering.is_numeric_claim(dict(id='XS3', quote='同指标')))
check('XP 系列', tiering.is_numeric_claim(dict(id='XP2', quote='52%')))
check('纯文字非数字', not tiering.is_numeric_claim(dict(id='F9', quote='结构断裂')))

print('== 3. R-recalc：数字主张封顶（v0.8.0 现实锚定） ==')
findings = [
    dict(id='F1', location='L85', quote='1213万人', problem='同指标矛盾', severity='A'),
    dict(id='F2', location='L53', quote='合计 4800 亿元', problem='合计不符', severity='A'),
    dict(id='F3', location='L28', quote='TFP 3.5%', problem='无源预测', severity='A'),
    dict(id='F4', location='L61', quote='能耗降低九成', problem='空心证据', severity='A'),
]
clusters = [
    dict(id='C1', title='就业数矛盾', member_ids=['R1-F1'], severity='A', dims=['数字']),
    dict(id='C3', title='TFP预测', member_ids=['R1-F3'], severity='A', dims=['方法学']),
    dict(id='C5', title='合计不符', member_ids=['R2-F2'], severity='A', dims=['数字']),
    dict(id='C7', title='空心证据', member_ids=['R3-F4'], severity='A', dims=['结构']),
]
# D 轮现实：C1 有已验证+维持调查；C3 有已验证+维持（调查B终审升A——合法升级须放行）；
# C5 有已验证+维持（复算升A）；C7 无调查（空心证据 XH 直通但调查缺席）
invs = [
    dict(target='C1', label='已验证', verdict='维持', final_severity='A', evidence='官方公报1267万', provenance='WebSearch'),
    dict(target='C3', label='已验证', verdict='维持', final_severity='B', evidence='主流测算2%无3.5%出处', provenance='WebSearch'),
    dict(target='C5', label='复算不符', verdict='升级', final_severity='A', evidence='bash复算3600≠4800', provenance='复算'),
]
final_tiers = [dict(id=c['id'], tier='A') for c in clusters]
r = tiering.reconcile(clusters, findings, invs, final_tiers)
check('C1 已验证+维持 → A 放行', r['tiers']['C1'] == 'A')
check('C3 调查B终审升A（已验证+维持）→ A 放行（不封合法升级）', r['tiers']['C3'] == 'A')
check('C5 复算升级 → A 放行', r['tiers']['C5'] == 'A')
check('C7 数字主张无调查 → 封 B', r['tiers']['C7'] == 'B', r['tiers']['C7'])
check('封顶记录恰 1 条 R-recalc', len(r['caps']) == 1 and r['caps'][0]['id'] == 'C7' and r['caps'][0]['rule'] == 'R-recalc', str(r['caps']))
check('收敛账 blind=4/cluster=4/judge=4/final=3', (r['ledger']['blind_a'], r['ledger']['cluster_a'], r['ledger']['judge_a'], r['ledger']['final_a']) == (4, 4, 4, 3), str(r['ledger']))
check('judge_to_final 归因=对账拦1', '拦 1' in r['ledger']['judge_to_final'], r['ledger']['judge_to_final'])

print('== 3b. v0.9.0 P0 双bug 回归锚（红队 09-29 抓获，实测复现过） ==')
# P0①键断裂：XH 直通调查 target=finding id，簇按 id 查不到证据曾被误封 B——修复后成员 id 取证可达
fxh = [dict(id='XH1', location='L61', quote='实验表明能耗可降低九成以上', problem='空心证据（确定性检测）：±40行内无数据表', severity='A')]
clxh = [dict(id='C8', title='空心能耗主张', member_ids=['R3-XH1'], severity='A', dims=[])]
ivxh = [dict(target='XH1', label='已验证', verdict='维持', final_severity='A', evidence='全文无实验数据表', provenance='Read')]
rxh = tiering.reconcile(clxh, fxh, ivxh, [dict(id='C8', tier='A', note='撑头条')])
check('P0①：XH 调查（target=XH1，维持A）经成员 id 挂到簇 → A 放行', rxh['tiers']['C8'] == 'A', str(rxh['caps']))
rxh2 = tiering.reconcile(clxh, fxh, [], [dict(id='C8', tier='A')])
check('P0①对照：同一簇无任何调查 → 仍封 B（quote 九成=真数字主张）', rxh2['tiers']['C8'] == 'B' and rxh2['caps'][0]['rule'] == 'R-recalc')
# P0②伪数字：problem 模板"±40行"曾把无数字 quote 的 XH 全部误判数字主张——修复后只看 quote
check('P0②：quote 无数字 + problem 含"±40" → 非数字主张', not tiering.is_numeric_claim(dict(id='XH2', quote='空气质量显著改善，治理成本大幅降低', problem='空心证据（确定性检测）：±40行内无数据表')))
check('P0②对照：quote 带中文量词仍是数字主张', tiering.is_numeric_claim(dict(id='XH1', quote='能耗降低九成', problem='')))

print('== 4. R-quote：无定位封 C ==')
f_noq = [dict(id='F1', location='', quote='', problem='无定位意见', severity='A')]
cl_noq = [dict(id='C2', title='无定位簇', member_ids=['R1-F1'], severity='A', dims=[])]
r2 = tiering.reconcile(cl_noq, f_noq, [], [dict(id='C2', tier='A')])
check('全员无 location/quote → 封 C', r2['tiers']['C2'] == 'C', r2['tiers']['C2'])
check('封顶规则=R-quote', r2['caps'][0]['rule'] == 'R-quote')
# 有定位不封（正常簇不受影响）
f_ok = [dict(id='F1', location='L9', quote='结构断裂', problem='结构', severity='A')]
r3 = tiering.reconcile(cl_noq, f_ok, [], [dict(id='C2', tier='A')])
check('有 location+quote 不封', r3['tiers']['C2'] == 'A')

print('== 5. 法官定级缺失回退簇级 ==')
r4 = tiering.reconcile(cl_noq, f_ok, [], [])  # final_tiers 空
check('无 final_tiers 按簇 severity 起算', r4['tiers']['C2'] == 'A')

print('== 6. R-jitem：法官新增数字意见 ==')
j_items = [dict(id='J1', location='L44', quote='隐含GDP 147万亿', problem='隐含增速5.04%', severity='A'),
           dict(id='J2', location='L90', quote='表述冗余', problem='表达', severity='A')]
j_invs = [dict(target='J1', label='已验证', verdict='维持', final_severity='A', evidence='bash复算', provenance='复算')]
rj = tiering.reconcile_new_items(j_items, j_invs)
check('J1 后核已验证 → A 放行', rj['tiers']['J1'] == 'A')
check('J2 非数字主张 → A 不受影响', rj['tiers']['J2'] == 'A')
rj2 = tiering.reconcile_new_items([dict(id='J3', location='L7', quote='成本下降 30%', problem='无据', severity='A')], [])
check('J3 数字无后核 → 封 B', rj2['tiers']['J3'] == 'B' and rj2['caps'][0]['rule'] == 'R-jitem')

print('== 7. X 系列确定性疑点（quote 常无数字文本）走 id 判据 ==')
fx = [dict(id='X1', location='L53', quote='合计 4800', problem='脚本疑点', severity='B')]
clx = [dict(id='C9', title='脚本疑点簇', member_ids=['R1-X1'], severity='A', dims=[])]
rx = tiering.reconcile(clx, fx, [], [dict(id='C9', tier='A')])
check('X 系列成员簇无调查 → 封 B', rx['tiers']['C9'] == 'B')

print('== 8. strip_reviewer 前缀剥离 ==')
check('R12-F3 → F3', tiering.strip_reviewer('R12-F3') == 'F3')
check('F3 原样', tiering.strip_reviewer('F3') == 'F3')

print('== 9. R-ghost：聚合幻觉簇封顶（审计 A2，2026-09-29） ==')
f_real = [dict(id='F1', location='L9', quote='结构断裂主张', problem='结构', severity='A')]
cl_ghost = [
    dict(id='C10', title='幻觉簇', member_ids=['R9-F99'], severity='A', dims=['结构']),  # id 全失配
    dict(id='C11', title='空成员簇', member_ids=[], severity='A', dims=[]),              # 成员为空
    dict(id='C12', title='真簇对照', member_ids=['R1-F1'], severity='A', dims=['结构']), # 不误伤
]
rg = tiering.reconcile(cl_ghost, f_real, [], [dict(id=c['id'], tier='A') for c in cl_ghost])
check('幻觉簇（id 全失配）A→C', rg['tiers']['C10'] == 'C' and rg['caps'][0]['rule'] == 'R-ghost', str(rg['caps']))
check('空成员簇 A→C', rg['tiers']['C11'] == 'C')
check('真簇不受影响（对照）', rg['tiers']['C12'] == 'A', str(rg['tiers']))
# C-ORPHAN 形态（裸 id 成员）不误伤——member_ids 无前缀但 id 真实存在于 findings 池
cl_orph = [dict(id='C13', title='残差簇', member_ids=['F1'], severity='A', dims=['结构'])]
ro = tiering.reconcile(cl_orph, f_real, [], [dict(id='C13', tier='A')])
check('C-ORPHAN 裸 id 成员不误伤', ro['tiers']['C13'] == 'A', str(ro['caps']))

print('== 10. R-quote-jitem：J 系列无引封 C（审计 B2，2026-09-29） ==')
jitems = [dict(id='J5', location='L44', quote='', problem='结构断裂', severity='A'),
          dict(id='J6', location='', quote='某主张原文', problem='结构', severity='A'),
          dict(id='J7', location='L7', quote='完整引文', problem='结构', severity='A')]
rj3 = tiering.reconcile_new_items(jitems, [])
check('J 无 quote → A→C', rj3['tiers']['J5'] == 'C' and any(c['rule'] == 'R-quote-jitem' for c in rj3['caps']), str(rj3['caps']))
check('J 无 location → A→C', rj3['tiers']['J6'] == 'C')
check('J 有引有址不受影响（对照）', rj3['tiers']['J7'] == 'A')


print('== 11. v0.12 精确匹配优先成员解析（裸 id 撞号根治） ==')
f_pool = [
    dict(id='R1-F1', location='L9', quote='第一席意见A', problem='a', severity='A'),
    dict(id='R2-F1', location='L20', quote='第二席同号意见B', problem='b', severity='B'),  # 撞号
    dict(id='R3-F1', location='L30', quote='第三席同号意见C', problem='c', severity='C'),  # 三重撞号
]
cl_ns = [dict(id='C20', title='撞号簇', member_ids=['R2-F1'], severity='B', dims=[])]
rns = tiering.reconcile(cl_ns, f_pool, [], [dict(id='C20', tier='B')])
check('前缀形成员精确命中（不误绑第一席）', rns['tiers']['C20'] == 'B' and not any(c['rule'] == 'R-ghost' for c in rns['caps']))
cl_bare = [dict(id='C21', title='裸 id 簇', member_ids=['R1-F1'], severity='A', dims=[])]
rb = tiering.reconcile(cl_bare, f_pool, [], [dict(id='C21', tier='A')])
check('strip 兜底路径（前缀成员/裸池可解）', not any(c['rule'] == 'R-ghost' for c in rb['caps']))

print('== 12. v0.12 法官亲算入账（judge_recalc_note） ==')
check('【复算:算式】含算术符+数字→认账', tiering.judge_recalc_note(dict(id='C1', tier='A', note='本席复算 334218-327569=6649亿，【复算:334218-327569=6649】')))
check('空口【复算过】无算术→不认', not tiering.judge_recalc_note(dict(id='C1', tier='A', note='本席已复算过')))
check('无标记→不认', not tiering.judge_recalc_note(dict(id='C1', tier='A', note='亲算后维持')))
# R-recalc 例外
f_num = [dict(id='F1', location='L9', quote='合计4620亿 vs 分项3600亿', problem='x', severity='A')]
cl_num = [dict(id='C22', title='数字簇', member_ids=['R1-F1'], severity='A', dims=['数字'])]
r_no_note = tiering.reconcile(cl_num, f_num, [], [dict(id='C22', tier='A')])
check('无亲算标记→R-recalc 封 B', r_no_note['tiers']['C22'] == 'B')
r_note = tiering.reconcile(cl_num, f_num, [], [dict(id='C22', tier='A', note='【复算:4620-3600=1020偏差27.8%】')])
check('有亲算标记→A 放行', r_note['tiers']['C22'] == 'A')

print('== 13. v0.12 R-junverified（后核配额外 J 封 B） ==')
jitems = [dict(id='J1', location='L10', quote='已核验', problem='a', severity='A'),
          dict(id='J2', location='L20', quote='未核验', problem='b', severity='A'),
          dict(id='J3', location='L30', quote='配额外', problem='c', severity='B')]
rju = tiering.reconcile_new_items(jitems, [], unverified_ids=['J3'])
check('J1 无 unverified 标记→A 放行', rju['tiers']['J1'] == 'A')
check('J2 无 unverified 标记→A 放行', rju['tiers']['J2'] == 'A')
check('J3 unverified→B', rju['tiers']['J3'] == 'B' and any(c['rule'] == 'R-junverified' for c in rju['caps']))
# 有 stub 证据者豁免
stub = [dict(target='J3', label='已验证', verdict='维持', final_severity='A', evidence='quote-grep', provenance='deterministic')]
rju2 = tiering.reconcile_new_items(jitems, stub, unverified_ids=['J3'])
check('有 stub 证据者 unverified 豁免', rju2['tiers']['J3'] != 'B' or not any(c['rule'] == 'R-junverified' and c['id'] == 'J3' for c in rju2['caps']))


print('== 14. v0.12.1 R-jhallu（后核幻觉非数字 J 降 C） ==')
jh = [dict(id='J10', location='L50', quote='非数字主张', problem='x', severity='A', confidence='H', fix=''),
      dict(id='J11', location='L51', quote='引用有误主张', problem='y', severity='B', confidence='M', fix='')]
inv_h = [dict(target='J10', label='幻觉', verdict='撤回', final_severity='C', evidence='后核驳回', provenance='llm'),
         dict(target='J11', label='引用有误', verdict='降级', final_severity='C', evidence='引用错', provenance='llm')]
rh = tiering.reconcile_new_items(jh, inv_h)
check('J10 后核幻觉 A→C（R-jhallu）', rh['tiers']['J10'] == 'C' and any(c['rule'] == 'R-jhallu' and c['id'] == 'J10' for c in rh['caps']))
check('J11 引用有误 B→C', rh['tiers']['J11'] == 'C')
rh2 = tiering.reconcile_new_items([jh[0]], [])
check('无后核不触发 R-jhallu', rh2['tiers']['J10'] == 'A')

print('== 15. v0.12.1 C6 行号≤0 报失配 ==')
import extract as _ex
fid = _ex.assertion_fidelity(['正文'], [dict(id='AS0', line=0, numbers=['123']), dict(id='AS-1', line=-5, numbers=['456'])])
check('行号 0 → 失配记录', any(m['id'] == 'AS0' and m['number'] == '123' for m in fid))
check('行号 -5 → 失配记录', any(m['id'] == 'AS-1' and m['number'] == '456' for m in fid))

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
