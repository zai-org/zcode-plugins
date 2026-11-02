# -*- coding: utf-8 -*-
"""L0 套件：render.py 纯函数 + assertion_fidelity 单元 + 回放锚（v0.12 架构审 P1-4）。

回放锚：v0.10 验收跑的 render_payload fixture → render() → 断言 final_a/caps 逐值复现
（把 11M 级端到端验收的数字锚变成永久免费回归门）。
用法：python tests/test_render_l0.py
"""
import sys, os, json, io

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'py'))
import extract, render, tiering

PASS, FAIL = 0, 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1; print('  ok  %s' % name)
    else:
        FAIL += 1; print('FAIL  %s  %s' % (name, detail))

print('== 1. assertion_fidelity 纯函数 ==')
lines = ['# 报告', '本方案投资489亿元，金融部门203亿元。', '两值合计692亿元。', '下一行无匹配号码。', '空白变体：3.5 亿元。']
assertions_ok = [dict(id='AS1', line=2, numbers=['489', '203'])]
assertions_bad = [dict(id='AS2', line=4, numbers=['999'])]
assertions_space = [dict(id='AS3', line=5, numbers=['3.5亿'])]
check('号码命中→空失配', extract.assertion_fidelity(lines, assertions_ok) == [])
check('号码不在原文→失配', len(extract.assertion_fidelity(lines, assertions_bad)) == 1)
# v0.13（0.13批）：去空白归一——"3.5亿" vs 行内"3.5 亿元"（md 折行/转换产物）不再误报失真。
# C8 修正：旧锚是恒真条件（'3.5 亿元'.replace(' ','') in '3.5亿元' 恒 True），从未真正断言行为
check('去空白变体命中（3.5亿 vs 行内"3.5 亿元"）', extract.assertion_fidelity(lines, assertions_space) == [],
      str(extract.assertion_fidelity(lines, assertions_space)))
check('千分位逗号变体仍命中（v0.12 回归锚）',
      extract.assertion_fidelity(['投资 1,234 万元。'], [dict(id='AS4', line=1, numbers=['1234'])]) == [])

print('== 2. render.py 载荷契约+回放锚 ==')
FIXTURE = os.path.join(HERE, 'fixtures', 'render_payload_v0100.json')
if os.path.isfile(FIXTURE):
    payload = json.load(io.open(FIXTURE, encoding='utf-8'))
    out = render.render(payload)
    check('回放锚 final_a==10（v0.10 验收复现）', out['final_a'] == 10, str(out['ledger']))
    check('回放锚 caps==2', len(out['caps']) == 2, str(out['caps']))
    check('报告含终审判定节', '## 终审判定：' in out['report_md'])
    check('报告含定级对账节', '## 定级对账' in out['report_md'])
    check('报告含意见簇清单节', '## 意见簇清单' in out['report_md'])
    check('报告含台账节', '## 台账' in out['report_md'])
    check('台账含定级对账行', '定级对账' in out['log_md'])
    check('tiering 委托正常（tiers 非空）', len(out['tiers']) > 0)
else:
    print('  skip 回放（fixture 缺失——CI 或非本机布局）')

print('== 3. render 对 unverified_j_ids 的感知 ==')
if os.path.isfile(FIXTURE):
    p2 = dict(payload)
    p2['new_items'] = payload.get('new_items', []) + [
        dict(id='J90', location='L99', quote='测试未核A', problem='x', severity='A', confidence='H', fix=''),
        dict(id='J91', location='L98', quote='测试未核B', problem='y', severity='B', confidence='M', fix=''),
    ]
    p2['unverified_j_ids'] = ['J90', 'J91']
    out2 = render.render(p2)
    check('unverified A 级 J 意见→R-junverified 封 B', any(c['rule'] == 'R-junverified' and c['id'] == 'J90' and c['to_tier'] == 'B' for c in out2['caps']),
          str([c for c in out2['caps'] if c['rule'] == 'R-junverified']))

print('== 4. v0.13 新形态回放（R 前缀命名空间 + verify 台账 + J 系列入报告 + inv 口径） ==')
FIX2 = os.path.join(HERE, 'fixtures', 'render_payload_v0124.json')
if os.path.isfile(FIX2):
    p3 = json.load(io.open(FIX2, encoding='utf-8'))
    out3 = render.render(p3)
    check('v0.12.4 形态 payload 回放锚 final_a==1（R 前缀成员解析）', out3['final_a'] == 1, str(out3['ledger']))
    check('v0.12.4 形态 payload 回放锚 caps==1 且=R-junverified(J1)',
          len(out3['caps']) == 1 and out3['caps'][0]['rule'] == 'R-junverified' and out3['caps'][0]['id'] == 'J1',
          str(out3['caps']))
    check('C2 锚：J 系列意见入报告（此前封顶表之外无处可查）', '## J1（B）' in out3['report_md'] and '## J2（B）' in out3['report_md'], '')
    check('C2 锚：J 意见正文（problem）可见', '法官新增数字意见' in out3['report_md'], '')
    check('verify 锚：验证断言台账节存在', '## 验证断言台账' in out3['report_md'], '')
    check('verify 锚：XH1/J1 可机械断言入表', '应出现:L40' in out3['report_md'] and '可复算:1.5/7.8=19.2%' in out3['report_md'], '')
    p4 = dict(p3)
    p4['gap_findings'] = [dict(id='GAP-G1', location='L20', quote='x', problem='y', severity='B', verify='应出现:L21')]
    out4 = render.render(p4)
    check('GAP verify 消费锚：gap_findings 入验证断言台账（v0.13.0 盲评修复）',
          'GAP-G1' in out4['report_md'].split('## 验证断言台账')[1].split('## 漏检处置')[0], '')
    _va_sec = out3['report_md'].split('## 验证断言台账')[1].split('## 漏检处置')[0]
    check('verify 锚：仅可人工复检不入台账表', '仅可人工复检' not in _va_sec, _va_sec[:120])
    check('inv 口径锚：台账含 inv_breakdown（stub/后核/派单目标）', '派单目标 2' in out3['report_md'] and '确定性stub' in out3['report_md'], '')
    # v0.13.1（评审 C-2）：freeze_status 进台账——armed/verified/skipped/timeout/internal-error/tampered
    check('freeze_status 锚：缺省回退"未记录"', '冻结契约：未记录' in out3['report_md'], '')
    p5 = dict(p3)
    p5['display'] = dict(p3['display'], freeze_status='verified（清单截断：64 件上限外未校验）')
    out5 = render.render(p5)
    check('freeze_status 锚：带状态时台账如实呈现', '冻结契约：verified（清单截断：64 件上限外未校验）' in out5['report_md'], '')
else:
    print('  skip v0.13 回放（fixture 缺失）')

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
