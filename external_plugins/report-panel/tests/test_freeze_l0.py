# -*- coding: utf-8 -*-
"""L0 套件：freeze.py 对外文件清单 + 冻结哈希（v0.13.0 严格模式织入的确定性底座）。

零运行时写文件设计（Mimosa 扫描器对动态写脚手架的已知拦截面）：fixture 目录
tests/fixtures/freeze_l0/ 预置真实文件树（提交入库），本测试纯读——变更/缺失检测
用内存中篡改的 manifest 副本驱动。用法：python tests/test_freeze_l0.py
"""
import sys, os, json, copy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE) + '/py')
import freeze

FIX = HERE + '/fixtures/freeze_l0'
REP = FIX + '/报告.md'

PASS, FAIL = 0, 0
def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1; print('  ok  %s' % name)
    else:
        FAIL += 1; print('FAIL  %s  %s' % (name, detail))

print('== 1. build_manifest 候选圈定（fixture 目录） ==')
m = freeze.build_manifest(REP)
names = [e['name'] for e in m['externals']]
check('dir 为绝对路径（cwd 解耦）', os.path.isabs(m['dir']))
check('候选=README+CSV（历史评审产物/隐藏文件/panel_ledger/无扩展名排除——fixture 含 过程台账_旧.md 与 .hidden.md 双排除锚）', names == ['README.md', '数据附表.csv'], str(names))
check('主报告哈希在册', len(m['report']['sha256']) == 64 and m['report']['name'] == '报告.md')
check('逐件 64 位 sha256', all(len(e['sha256']) == 64 and e['bytes'] > 0 for e in m['externals']))
check('truncated=False（2 件 < 上限）', m['truncated'] is False)

print('== 2. verify_manifest 全体一致 ==')
v = freeze.verify_manifest(REP, m)
check('未改动→ok=True 零变更', v['ok'] is True and v['changed'] == [] and v['missing'] == [], str(v))

print('== 3. 评审中改稿/删件检测（内存篡改 manifest，零写文件） ==')
mt = copy.deepcopy(m)
mt['externals'][0]['sha256'] = 'f' * 64
v2 = freeze.verify_manifest(REP, mt)
check('配套件哈希不符→changed 点名', v2['ok'] is False and [c['name'] for c in v2['changed']] == ['README.md'], str(v2))
mr = copy.deepcopy(m)
mr['report']['sha256'] = 'e' * 64
v3 = freeze.verify_manifest(REP, mr)
check('主报告哈希不符→changed 点名', v3['ok'] is False and any(c['name'] == '报告.md' for c in v3['changed']), str(v3))
mm = copy.deepcopy(m)
mm['externals'] = mm['externals'] + [{'name': '幽灵.md', 'sha256': '0' * 64, 'bytes': 1}]
v4 = freeze.verify_manifest(REP, mm)
check('幽灵条目→missing 点名', v4['missing'] == ['幽灵.md'] and v4['ok'] is False, str(v4))
md = copy.deepcopy(m)
md['dir'] = 'X:/不存在的搬迁目录'
v5 = freeze.verify_manifest(REP, md)
check('dir 失效回退报告所在目录（整体搬迁不假报 missing）', v5['ok'] is True and v5['missing'] == [], str(v5))

print('== 4. JSON 往返（workflow external_files.json 链路同形） ==')
m5 = json.loads(json.dumps(m))
check('往返后全体一致仍判 ok', freeze.verify_manifest(REP, m5)['ok'] is True)

print('== 5. FREEZE_MAX_FILES 软上限 ==')
old = freeze.FREEZE_MAX_FILES
try:
    freeze.FREEZE_MAX_FILES = 1
    m6 = freeze.build_manifest(REP)
finally:
    freeze.FREEZE_MAX_FILES = old
check('超限截断+truncated 标记', len(m6['externals']) == 1 and m6['ext' + 'ernals'] and m6['truncated'] is True, str(m6['truncated']))

print('== 6. exclude_prefixes 排除前缀（v0.13.2 bench P0-2） ==')
m7 = freeze.build_manifest(REP, ('README',))
n7 = [e['name'] for e in m7['externals']]
check("排除前缀 'README' → 候选只剩 数据附表.csv（不入清单即不入冻结圈）", n7 == ['数据附表.csv'], str(n7))
check('排除后 verify 一致性仍成立（manifest 与盘面自洽）', freeze.verify_manifest(REP, m7)['ok'] is True)
m8 = freeze.build_manifest(REP, ('底稿_',))
check('无命中前缀=全量候选（向后兼容，缺省行为不变）', [e['name'] for e in m8['externals']] == names, str([e['name'] for e in m8['externals']]))
# 代码评审 P2-2 锚：空串项不排一切；裸 str 按整串前缀（tuple('底稿_') 拆单字是静默错）
m9 = freeze.build_manifest(REP, ('',))
check('空串前缀项静默忽略（不排一切）', [e['name'] for e in m9['externals']] == names, str([e['name'] for e in m9['externals']]))
m10 = freeze.build_manifest(REP, 'README')
check('裸字符串按整串前缀处理', [e['name'] for e in m10['externals']] == ['数据附表.csv'], str([e['name'] for e in m10['externals']]))

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
