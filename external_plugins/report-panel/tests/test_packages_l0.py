# -*- coding: utf-8 -*-
"""L0 套件：packages.py 证据包构造器 + 覆盖完备性断言。零 token。"""
import sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'py'))
sys.path.insert(0, HERE)
import extract, packages

PASS, FAIL = 0, 0

def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ok  %s' % name)
    else:
        FAIL += 1
        print('FAIL  %s  %s' % (name, detail))


DOC = [
    '# 摘要', '本方案性能完全持平前代，成本 3.5亿元。', '复现实验表明误差 ±2%。',
    '# 方法', '数据集共 12万条，其中训练 8万、验证 2万、测试 2万。', '参考文献见 Zhang et al. 2020。',
    '# 部署', '承诺全年可用性 99.9%，验收口径按合同执行。', '详见 data.csv 工件。',
    '# 附录', '此处为附录占位内容，用于覆盖性测试的最后一个章节区域。',
]
r = extract.analyze('\n'.join(DOC))

print('== 1. 核心席构造（v0.7：4→2） ==')
pk = packages.build_packages(DOC, r, 'standard')
for seat in ('逻辑审计员', '魔鬼代言人'):
    check('%s 全文深读权' % seat, pk[seat]['deep_read'] is True and pk[seat]['role'] == 'core')
for seat in ('决策层读者', '行业专家'):
    check('%s 已裁撤（v0.7）' % seat, seat not in pk, '仍存在于包中')

print('== 2. 专项席证据包 ==')
dn = pk['数据严谨审计员']
check('数据席 pattern 命中（误差行）', 3 in dn['evidence']['lines'], str(dn['evidence']['lines'][:10]))
check('数据席挂载数字', any(n['line'] == 5 for n in dn['evidence']['numbers']), str(dn['evidence']['numbers'][:3]))
# v0.9.1 裁席R6 贯穿（审计 B1）：外部事实审计员已从编排层+席位注册表同步裁撤
check('外部事实审计员已裁撤（v0.9.1 裁席R6 贯穿）', '外部事实审计员' not in pk, '仍存在于包中')
env = pk['环境审计员']
check('环境席命中工件行', 7 in env['evidence']['lines'])
comp = pk['合规边界审计员']
check('合规席命中承诺行', 6 in comp['evidence']['lines'])

print('== 3. 跨节可见性（契约：全员可见断言全表） ==')
for seat, p in pk.items():
    check('%s 携带断言全表' % seat, len(p['evidence']['assertions']) == r['assertion_candidates']['n'],
          '%d vs %d' % (len(p['evidence']['assertions']), r['assertion_candidates']['n']))

print('== 4. 包不含原文（传引用不传内容） ==')
for seat, p in pk.items():
    if p['role'] == 'spec':
        check('%s 包内无原文段落' % seat, all(not isinstance(v, str) or len(v) < 160
              for v in [p['budget_note']] ) and all(isinstance(l, int) for l in p['evidence']['lines'][:5]))

print('== 5. 覆盖完备性断言 ==')
cov = packages.coverage_assertion(DOC, r, pk)
check('standard 档覆盖完备', cov['complete'], str(cov['uncovered']))
r2 = extract.analyze('# 摘要\n仅一句弱内容。\n# 孤岛章\n。\n# 末章\n。')
pk2 = packages.build_packages('# 摘要\n仅一句弱内容。\n# 孤岛章\n。\n# 末章\n。'.split('\n'), r2, 'standard')
cov2 = packages.coverage_assertion('# 摘要\n仅一句弱内容。\n# 孤岛章\n。\n# 末章\n。'.split('\n'), r2, pk2)
check('核心席全读=兜底覆盖', cov2['complete'])

print('== 6. economy 档单裁判包 ==')
eco = packages.build_packages(DOC, r, 'economy')
judge = eco['取证裁判']
check('单裁判深读=风险前6区', judge['role'] == 'single-judge' and len(judge['deep_read_sections']) >= 1)
check('单裁判带断言全表+预复算', 'assertions' in judge['evidence'] and 'precomputed' in judge['evidence'])
cov_e = packages.coverage_assertion(DOC, r, eco)
check('economy 覆盖断言可运行', isinstance(cov_e['complete'], bool))

print('== 7. 包预算上限 ==')
big = ['噪声行 %d 基准 评测 数据' % i for i in range(600)]
rbig = extract.analyze('\n'.join(big))
pkbig = packages.build_packages(big, rbig, 'standard')
check('超限包被截断并标记', pkbig['数据严谨审计员']['truncated'] is True
      and len(pkbig['数据严谨审计员']['evidence']['lines']) <= packages.PKG_LINE_CAP)

print('== 8. 真实样张B 冒烟 ==')
import io
BENCH = os.environ.get('PANEL_BENCH_DIR', os.path.join(HERE, '..', '..', '..', 'panel_bench_test'))
SRC = os.path.join(BENCH, 'phase_tests', 'sampleB_copy.md')
if os.path.isfile(SRC):
    t = io.open(SRC, encoding='utf-8', errors='replace').read()
    ls = t.split('\n')
    rr = extract.analyze(t)
    pp = packages.build_packages(ls, rr, 'standard')
    cov = packages.coverage_assertion(ls, rr, pp)
    check('样张B 覆盖完备', cov['complete'], str(cov['uncovered'][:5]))
    check('各包行数<=上限', all(len(p['evidence'].get('lines', [])) <= packages.PKG_LINE_CAP for p in pp.values()))
    dn_lines = set(pp['数据严谨审计员']['evidence']['lines'])
    check('已知硬伤区(818-830)有证据覆盖', any(818 <= x <= 832 for x in dn_lines), str([x for x in dn_lines if 800 < x < 850][:8]))
    sizes = {k: len(v['evidence'].get('lines', [])) for k, v in pp.items() if v['role'] == 'spec'}
    print('  各专项包行号数:', sizes)
else:
    print('  skip 样张冒烟')

print('== 9. 空心证据确定性检测 hollow_scan（v0.7） ==')
# 场景A：无任何数据表的全空心文档（排除 ±40 窗口表锚干扰）
hollow_doc = [
    '# 摘要', '实验表明该方法几乎不损失性能。',  # 空心：句式命中+句内无锚+全文档无数据表
    '# 方法', '实验表明误差 ±2%。',  # 放过：句内数值锚
    '如图 3 所示，实验表明收敛稳定。',  # 放过：图表引用锚
    '该开销不可忽略。',  # 放过：负向断言排除
    '远处的普通句子，没有句式。',
]
hs = packages.hollow_scan(hollow_doc)
hit_lines = [h['line'] for h in hs]
check('空心句必报（L2 无锚无表）', 2 in hit_lines, str(hit_lines))
check('数值锚句放过', 4 not in hit_lines)
check('图表锚句放过', 5 not in hit_lines)
check('负向断言放过（不可忽略）', 6 not in hit_lines)
check('返回结构带 quote', all('quote' in h and 'line' in h for h in hs))
# 场景B：句式行与数据表行同窗口（≤40行）→ 表锚放过
tbl_doc = ['# 数据区'] + ['普通行 %d' % i for i in range(5)] + ['| 指标 | 数值 |', '| 误差 | 3% |', '经验表明质量稳定。']
hs2 = packages.hollow_scan(tbl_doc)
check('窗口数据表锚放过（表行覆盖邻近句式行）', all(h['line'] != 9 for h in hs2), str([h['line'] for h in hs2]))

print('== 10. v0.8 A2：覆盖维度清单 ==')
dflt = packages.dimensions_list()
check('默认十维', len(dflt) == 10 and '安全基线' in dflt and '受众适配' in dflt, str(dflt))
check('args 覆盖（去空格）', packages.dimensions_list('数字一致性, 结构 ,外部事实') == ['数字一致性', '结构', '外部事实'])
check('空串退默认', packages.dimensions_list('') == dflt)

print('== 11. v0.8 A8：断言全量格式化（修 slice(0,60) 截断） ==')
many = [{'id': 'AS%d' % (i + 1), 'line': i + 1, 'section': '第%d章' % (i % 9 + 1),
         'claim': '宣称主张第%d条' % (i + 1), 'tier': 'load_bearing' if i % 3 == 0 else 'supporting'} for i in range(96)]
brief = packages.format_assert_brief(many)
brief_lines = brief.split('\n')
check('96 条全量输出（>60 也全在）', len(brief_lines) == 96, str(len(brief_lines)))
check('逐条含编号/行号/承重级', all(ln.startswith('AS') and ('load_bearing' in ln or 'supporting' in ln) for ln in brief_lines))
check('主张截 40 字内', all(len(ln.split('|')[3]) <= 40 for ln in brief_lines))
check('缺 id 自动编号', packages.format_assert_brief([{'line': 3, 'claim': 'x', 'tier': 'supporting'}]).startswith('AS1|3|'))
check('空表返回空串', packages.format_assert_brief([]) == '')

print('== 12. v0.8.1 A3：比较级空心族 + 前瞻守卫（三段式基线） ==')
# 段② 新族阳性：无据改善主张必报（recall ≥0.9 → 此处 1.0）
deg_pos = ['# 摘要', '该方法使整体吞吐显著提升，运行三月无任何实测记录。',
           '改造后系统能耗大幅降低，现场未装计量表。',
           '新算法使检索质量明显提高，无消融无对照。']
hs3 = packages.hollow_scan(deg_pos)
check('比较级阳性 3/3 必报', [h['line'] for h in hs3] == [2, 3, 4], str([h['line'] for h in hs3]))
# 段③ 阴性零误报：数值锚 / 图表锚 / 前瞻框架（政策语言）
deg_neg = ['经三个月试运行，故障率大幅降低 41.2%。',
           '如图 2 所示，检索质量明显提升。',
           '下一步将推动系统能力显著提升，分三年实施。',
           '促进跨境物流效率明显改善，是本轮改革目标。',
           '预计交付周期大幅缩短至 12 天。']
hs4 = packages.hollow_scan(deg_neg)
check('比较级阴性零误报（锚×2+前瞻×3）', len(hs4) == 0, str([h['line'] for h in hs4]))
check('守卫：紧邻"将"字拦"将显著提升"', packages._degree_is_prospective('整体效率将显著提升', packages.HOLLOW_DEGREE_PAT.search('整体效率将显著提升')))
check('守卫：同小句政策动词拦"促进…明显提高"', packages._degree_is_prospective('大力提振消费，促进居民消费率明显提高', packages.HOLLOW_DEGREE_PAT.search('大力提振消费，促进居民消费率明显提高')))
check('守卫：达成主张不拦（使…显著提升）', not packages._degree_is_prospective('该方法使召回率显著提升', packages.HOLLOW_DEGREE_PAT.search('该方法使召回率显著提升')))
# 段① 旧族不回归 + 真实样张阴性零误报（本地在盘才跑，CI 跳过——与第8节同模式）
import os as _os
for _name, _p, _expect in [('A', os.path.join(BENCH, 'samples', 'sampleA_deepseek_v41flash_zh.md'), [68, 169, 267, 269]),
                           ('C', os.path.join(BENCH, 'samples', 'sampleC_pbc_2026Q2_货政报告.md'), []),
                           ('D原文', os.path.join(BENCH, 'samples', 'sampleD_gov_2026_政府工作报告.md'), [])]:
    if _os.path.isfile(_p):
        _ls = io.open(_p, encoding='utf-8', errors='replace').read().split('\n')
        _got = [h['line'] for h in packages.hollow_scan(_ls)]
        check('样张%s 扩表后基线不变 %s' % (_name, _expect), _got == _expect, str(_got))

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
