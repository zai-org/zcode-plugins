# -*- coding: utf-8 -*-
"""L0 套件：gt_score 对拍器行为锚（v0.13.2）——对 v0.13.1 考卷v3 落盘报告样张回放，
锁死已知对拍结果：召回 10/10、阴性 A 级误报 1/2（N1→C8 与 X1 注入句的算术耦合，已知项）。
对拍器判定正则/口径改坏在此红灯。用法：python tests/test_gt_score_l0.py
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gt_score

FIX = os.path.join(HERE, 'fixtures', 'exam_v3')
PASS, FAIL = 0, 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1; print('  ok  %s' % name)
    else:
        FAIL += 1; print('FAIL  %s  %s' % (name, detail))

r = gt_score.score(os.path.join(FIX, '考卷v3_GT.json'),
                   os.path.join(FIX, '评审报告样张_v0.13.1_考卷v3.md'))
byid = {row['id']: row for row in r['rows']}
check('召回 10/10（v0.13.1 开卷实测复现）', r['recall'] == '10/10', r['recall'])
check('阴性 A 级误报 1/2（N1→C8 耦合已知项）', r['ctrl_a_fp'] == '1/2', r['ctrl_a_fp'])
check('N1 判 FP-A 终级 A 簇 C8', byid['N1']['verdict'] == 'FP-A' and byid['N1']['tier'] == 'A' and byid['N1']['cluster'] == 'C8', str(byid['N1']))
check('N2 判 reported-B+（立案但非 A，不触判据）', byid['N2']['verdict'] == 'reported-B+' and byid['N2']['tier'] == 'B', str(byid['N2']))
check('十真缺陷全 hit（含 MET1/CS2 共簇 C4）', all(byid[i]['verdict'] == 'hit' for i in ['XH1', 'XH2', 'X1', 'XP1', 'EXT1', 'AUD1', 'MET1', 'CS1', 'CS2', 'SAFE1']), str({i: byid[i]['verdict'] for i in byid}))
check('终级抽取与实测一致（XH2=B/SAFE1=B/MET1=A/CS1=A）', byid['XH2']['tier'] == 'B' and byid['SAFE1']['tier'] == 'B' and byid['MET1']['tier'] == 'A' and byid['CS1']['tier'] == 'A', '')
check('pass 判定（线 9/0 下 FAIL——N1 已知耦合，非对拍器缺陷）', r['pass'] is False, str(r['pass']))

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
