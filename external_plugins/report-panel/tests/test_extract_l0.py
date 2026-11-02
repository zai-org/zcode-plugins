# -*- coding: utf-8 -*-
"""L0 套件：extract.py 纯函数单元 + 真实样张冒烟。直接 python 运行，零 token。
用法：python tests/test_extract_l0.py
"""
import sys, os, json, collections

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'py'))
import extract

# 样张根目录支持 PANEL_BENCH_DIR 覆盖——设该变量即可在任意机器跑冒烟；
# 缺省指向本仓库外（不存在），文件不存在照旧 skip（保持套件零依赖自足）
BENCH = os.environ.get('PANEL_BENCH_DIR', os.path.join(HERE, '..', '..', '..', 'panel_bench_test'))

PASS, FAIL = 0, 0

def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  ok  %s' % name)
    else:
        FAIL += 1
        print('FAIL  %s  %s' % (name, detail))


print('== 1. TOC 抽取 ==')
doc = ['# 报告', '正文一', '## 第二章 方法', '第三章 结果', '内容']
toc = extract.extract_toc(doc)
check('md标题+中文章节都识别', {t['title'] for t in toc} == {'报告', '第二章 方法', '第三章 结果'}, str(toc))

print('== 2. 数字抽取 ==')
nums = extract.extract_numbers(['成本为 3.5亿元，占比 42%。'])
check('数值+单位成对', any(n['value'] == '3.5' and n['unit'] == '亿' for n in nums), str(nums))
# v0.10.0（代码审 P2）：单位交替长度序回归锚——旧序 kW 先于 kWh/kW/ton，'300kWh'/'5kW/ton' 100% 误标 kW
nums_u = extract.extract_numbers(['机组储能 300kWh，能效基准 5kW/ton，功率 2MW。'])
check('单位全长匹配：kWh/kW/ton 不再截断为 kW', {(n['value'], n['unit']) for n in nums_u} == {('300', 'kWh'), ('5', 'kW/ton'), ('2', 'MW')}, str(nums_u))

print('== 3. 算术预复算 ==')
sum_c, _ = extract.arithmetic_checks(['分项甲 30万元', '分项乙 40万元', '合计 100万元'])
check('sum_checks 抓植入合计错误', len(sum_c) == 1 and sum_c[0]['stated'] == 100.0, str(sum_c))
sum_ok, _ = extract.arithmetic_checks(['分项甲 30万元', '分项乙 40万元', '合计 70万元'])
check('正确合计零误报', len(sum_ok) == 0, str(sum_ok))
adj = ['A线 18亿元、B线 9亿元、C线 6亿元，合计 40亿元。', '甲段 12 天、乙段 15 天、丙段 21 天，全程共计 40 天。']
sum_adj, _ = extract.arithmetic_checks(adj)
check('相邻合计句各自捕获（不并窗）', len(sum_adj) == 2, str(sum_adj))

print('== 4. 断言候选 ==')
DOC4 = ['# 摘要', '本方案性能完全持平前代，成本 3.5亿元。', '普通描述行没有宣称。', '## 方法', '实验表明精度提升 15%。']
ac = extract.assertion_candidates(DOC4, extract.extract_toc(DOC4), extract.extract_numbers(DOC4))
check('强宣称+数字+摘要节 = load_bearing', any(c['tier'] == 'load_bearing' and '持平' in c['quote'] for c in ac), str(ac))
check('弱宣称+数字 = supporting', any(c['tier'] == 'supporting' and '表明' in c['quote'] for c in ac), str(ac))
check('无宣称行不入选', not any('普通描述' in c['quote'] for c in ac), str(ac))
check('关联数字挂载', all(c['related_numbers'] for c in ac), str(ac))

print('== 5. 分诊脚手架 ==')
lines = ['# 摘要', '宣称行 A 优于 B。', '# 附录', '占位']
ts = extract.triage_scaffold(lines, extract.extract_toc(lines), extract.extract_numbers(lines), [], ac)
check('头条章节排最前', ts[0]['section'] == '摘要', str(ts))
check('risk 单调', ts == sorted(ts, key=lambda s: -s['risk']))

print('== 6. 摘录（字节限额） ==')
big = ['L%d|长行内容%s%s%s' % (i, '字' * 50, str(i), 'x' * 30) for i in range(1, 400)]
exc = extract.build_excerpts(big, [{'id': 'C1', 'text': '见 L200 与 L300'}])
check('摘录按行号命中', exc[0]['refs'] == 2)
check('字节上限生效', len(exc[0]['excerpt'].encode('utf-8')) <= 12000 + 200, str(len(exc[0]['excerpt'].encode('utf-8'))))

print('== 7. 工件发现决策（纯） ==')
plan = extract.artifact_plan(['report.md', 'data.csv', '.hidden', 'x.panel_ledger.json', 'notes.txt'],
                             'report.md', '详见 data.csv 与 notes.txt')
check('引用优先且排除自身/隐藏/台账', {a['file'] for a in plan if a['referenced']} == {'data.csv', 'notes.txt'}, str(plan))

print('== 7b. v0.8 A6：公文（一）/一、 小节头 ==')
gongwen = ['# 第一部分 货币信贷', '（一）保持流动性合理充裕', '正文行占位。', '一、金融支持实体经济情况', '（十二）深化外汇领域改革']
toc2 = extract.extract_toc(gongwen)
titles2 = [t['title'] for t in toc2]
check('（一）小节头识别', any(t.startswith('（一）') for t in titles2), str(titles2))
check('一、小节头识别', any(t.startswith('一、') for t in titles2), str(titles2))
check('（十二）识别', any(t.startswith('（十二）') for t in titles2), str(titles2))
check('非小节头零误报', extract.extract_toc(['一个 30% 的提升是显著的，因为基数为零。']) == [], '')

print('== 7c. v0.8 A7：X/XP 口径门禁（C 轮 54 发 0 中形态全静默） ==')
# 形态①：异口径乱加（亿/万亿混行）——旧版必炸、新版静默
s1, p1 = extract.arithmetic_checks(['合计新增 12099.73 亿元，其中 A 项 8.3 万亿元、B 项 5897 亿元。'])
check('异口径混行静默', len(s1) == 0, str(s1))
# 形态①b：同单位跨指标但荒谬比（存量462万亿 vs 增量和37万亿）——dev>400% 静默（L112 实例）
s1b, _ = extract.arithmetic_checks(['累计：6月末存量 462.06 万亿元，上半年增量 20.84 万亿元，比上年同期多 16.83 万亿元。'])
check('荒谬偏差静默（dev>400%）', len(s1b) == 0, str(s1b))
# 形态②：日期成分（2026年/6月）不参与求和，但同单位真量值合计照抓（stated=300≠分项和140；
# 若 2026 未被剔除，stated 会错成 2026——断言 stated 精确值即验证剔除生效）
s2, _ = extract.arithmetic_checks(['2026年累计投放 300亿元、80亿元、60亿元。'])
check('日期剔除+真合计照抓', len(s2) == 1 and s2[0]['stated'] == 300.0, str(s2))
# 形态③：markdown 表行不勾稽（表内勾稽需语义配对，归调查员）
s3, _ = extract.arithmetic_checks(['| 合计 | 356.7 万亿元 | 8.3% |', '| 分项 | 100 万亿元 | 4% |', '| 分项 | 200 万亿元 | 4% |'])
check('表行静默', len(s3) == 0, str(s3))
# 形态④：XP 无占比提示词不开火；有提示词+同单位+超容差才开火；异单位分子分母静默
_, p4 = extract.arithmetic_checks(['增速 5.0%，存款 8.3 万亿元、贷款 356.7 万亿元。'])
check('XP 无提示词静默', len(p4) == 0, str(p4))
_, p5 = extract.arithmetic_checks(['个人住房贷款 8.3 万亿元，占各项贷款 356.7 万亿元的比重为 6.0%。'])
check('XP 同单位+超容差开火', len(p5) == 1 and p5[0]['stated_pct'] == 6.0, str(p5))
_, p6 = extract.arithmetic_checks(['存款 8.3 万亿元，占贷款 5897 亿元的比例为 90%。'])
check('XP 异单位分子分母静默', len(p6) == 0, str(p6))

print('== 8. 真实样张冒烟 ==')
SRC = os.path.join(BENCH, 'phase_tests/sampleB_copy.md')
if os.path.isfile(SRC):
    text = open(SRC, encoding='utf-8', errors='replace').read()
    r = extract.analyze(text)
    h = r['headline']
    check('总线头表齐备', all(k in h for k in ('chars', 'toc_n', 'num_total', 'assertion_candidates', 'load_bearing', 'top_risk_sections')), str(h))
    check('断言候选非空', h['assertion_candidates'] > 0, str(h))
    check('load_bearing 为正且不超候选数', 0 < h['load_bearing'] <= h['assertion_candidates'], str(h))
    check('风险分区覆盖全目录', len(r['triage_scaffold']['sections']) == h['toc_n'], '')
    known = extract.build_excerpts(text.split('\n'), [{'id': 'A1', 'text': 'L821 对照 L829'}])
    check('已知硬伤行可摘录(821/829)', known[0]['refs'] == 2 and '0.85' in known[0]['excerpt'], known[0]['excerpt'][:80])
else:
    print('  skip 样张冒烟（文件缺失）')

print('== 9. v0.9.1 XS key 升级：metric_key 指标名词键（治 ikey 语境键不聚） ==')
# 核心场景：同一指标在不同语境前缀下应聚为同键（ikey 时代四值四键）
k1 = extract.metric_key('就业总体稳定，城镇新增就业')
k2 = extract.metric_key('2025年全年城镇新增就业')
k3 = extract.metric_key('失业率5.5%左右，城镇新增就业')
k4 = extract.metric_key('脱贫人口务工就业规模…城镇新增就业累计超过')
check('城镇新增就业 四语境同键', k1 == k2 == k3 == k4 == '城镇新增就业', '%r %r %r %r' % (k1, k2, k3, k4))
check('剥尾部算子：累计超过', extract.metric_key('社融存量余额累计超过') == '社融存量余额')
check('剥尾部算子：分别（剥词后取末6字）', extract.metric_key('高技术制造业增加值分别') == '制造业增加值')
check('末6字窗口：先剥词后截取', extract.metric_key('A very 前面的长语境文字区域经济增长') == '文字区域经济')
check('metric_key 返回 str（类型契约；len>=2 聚合门槛在 metric_suspects 侧由下述考卷D基线实测覆盖）', isinstance(extract.metric_key('增长'), str))
# 四样张基线（本地在盘才跑，CI 跳过——防爆量回归门）
if os.path.isfile(os.path.join(BENCH, 'samples/sampleD_gov_2026_政府工作报告_考卷.md')):
    import io as _io
    _d = _io.open(os.path.join(BENCH, 'samples/sampleD_gov_2026_政府工作报告_考卷.md'), encoding='utf-8', errors='replace').read().split('\n')
    _sus = extract.metric_suspects(extract.extract_numbers(_d))
    _grp = [s for s in _sus if s['metric'] == '城镇新增就业']
    check('考卷D 城镇新增就业组聚齐（CS1 确定性化）', _grp and any(o['value'] == '1213' for o in _grp[0]['occurrences']) and any(o['value'] == '1267' for o in _grp[0]['occurrences']), str(_grp[:1]))
    check('考卷D suspects 无爆量（≤18）', len(_sus) <= 18, str(len(_sus)))
    for _name, _p, _cap in [('C', os.path.join(BENCH, 'samples/sampleC_pbc_2026Q2_货政报告.md'), 70),
                            ('A', os.path.join(BENCH, 'samples/sampleA_deepseek_v41flash_zh.md'), 5)]:
        if os.path.isfile(_p):
            _ls = _io.open(_p, encoding='utf-8', errors='replace').read().split('\n')
            _n = len(extract.metric_suspects(extract.extract_numbers(_ls)))
            check('样张%s suspects 守门（≤%d）' % (_name, _cap), _n <= _cap, str(_n))

print('== 10. v0.9.1+（审计 A1）：输入格式校验 validate_input ==')
# GBK/UTF-16 形态：errors='replace' 产物 U+FFFD 密度 >1% 必拦（实测 GBK 中文普遍 >10%）
gbk_sim = '报告正文' + '\ufffd' * 300 + '结尾'
try:
    extract.validate_input(gbk_sim)
    check('乱码密度 >1% 必拦', False, '未 raise')
except ValueError as e:
    check('乱码密度 >1% 必拦', 'UTF-8' in str(e))
# 阴性①：个别坏字节（<1%）不误伤
ok_text = '正常报告正文段落。' * 100 + '\ufffd' * 3 + ' 2026年数据'
check('个别坏字节放行（<1%）', extract.validate_input(ok_text) is None)
# 阴性②：长文（>5000）有数字无标题放行——裸数字即文本特征
num_no_head = '本方案测算了各项成本，预算 3.5 亿元。' * 300
check('长文有数字无标题放行', extract.validate_input(num_no_head) is None)
# 结构信号：>5000 字符零阿拉伯数字零标题拦（二进制行为指纹）
no_num = '纯粹的文学散文段落，没有任何数字与标题，' * 400
try:
    extract.validate_input(no_num)
    check('长文零数字零标题拦', False, '未 raise')
except ValueError as e:
    check('长文零数字零标题拦', '非文本' in str(e))
check('短文本零数字放行（<5000 不做结构判）', extract.validate_input('短散文无数字。') is None)
# analyze 入口串联：乱码在源头 raise，不再静默跑完全程
try:
    extract.analyze(gbk_sim)
    check('analyze 乱码源头拦截', False, '未 raise')
except ValueError:
    check('analyze 乱码源头拦截', True)

print('== 11. v0.13（issue#4 C7）：比较级空心族逐匹配判守卫 ==')
import packages
_l0 = '整体效率将显著提升，服务水平明显改善。'  # 首匹配"显著提升"带将字守卫、次匹配"明显改善"无守卫
_l1 = '预计明年营收显著提升。'                  # 单匹配前瞻（v0.8.1 三段式阴性回归锚）
_l2 = '基线成本显著降低。'                      # 单匹配无守卫（阳性回归锚）
check('同行双命中：首个前瞻+次个无守卫→报（旧版只看首个=漏报）', packages.hollow_match(_l0) is True, '')
check('单匹配前瞻静默（v0.8.1 阴性回归锚）', packages.hollow_match(_l1) is False, '')
check('单匹配无守卫照报（v0.8.1 阳性回归锚）', packages.hollow_match(_l2) is True, '')
check('hollow_scan 行为同步（逐匹配在扫描路径同样生效）',
      [h['line'] for h in packages.hollow_scan([_l0, _l1, _l2])] == [1, 3], '')

print('== 12. assertion_gaps 候选盲区重扫（v0.13.2 bench J1，考卷v3 回归锚） ==')
_exam = os.path.join(HERE, 'fixtures', 'exam_v3', '考卷v3_统计局8月_考卷.md')
if os.path.isfile(_exam):
    _text = open(_exam, encoding='utf-8').read()
    _lines = _text.split('\n')
    _r = extract.analyze(_text)
    _cands = _r['assertion_candidates']['candidates']
    _cand_lines = set(c['line'] for c in _cands)
    _gaps = extract.assertion_gaps(_lines, _cands)
    _gap_lines = set(g['line'] for g in _gaps)
    # v0.13.1 实测：候选 13 行——七处注入句中 L7/13/17/18/21/42/48 不在候选（词表触发
    # 盲区，J1 实锤）；L10 在候选（weak"显示"+数字）。宽表重扫后 7 行必须全部进 gap
    check('七处候选外注入句全部进 gap（L7,13,17,18,21,42,48）',
          {7, 13, 17, 18, 21, 42, 48} <= _gap_lines, 'gap=%s' % sorted(_gap_lines))
    check('gap 与候选行集不相交（重扫只补盲区）', not (_gap_lines & _cand_lines), '')
    check('信号标注齐全（L18=cite，L48=safety）',
          'cite' in next((g['signals'] for g in _gaps if g['line'] == 18), []) and
          'safety' in next((g['signals'] for g in _gaps if g['line'] == 48), ''), '')
    check('cap 上限生效', len(_gaps) <= 40, str(len(_gaps)))
    # 功能评审 D1 锚：analyze() 原始 dict 形态 {'n':..,'candidates':[..]} 直传不抛且行为一致
    # （PY_BUS 壳实参曾与函数签名错配致整跑崩，L0 盲区——防御+锚双保险）
    _gaps_dict = extract.assertion_gaps(_lines, _r['assertion_candidates'])
    check('dict 形态防御：直传 analyze 原始形态结果一致', [g['line'] for g in _gaps_dict] == [g['line'] for g in _gaps], '')
    # 功能评审 D2 锚：artifact_plan 排除前缀（与 freeze 同参——排除件不进环境席工件索引）
    _ap = extract.artifact_plan(['底稿_原文.md', '数据附表.csv', '报告.md'], '报告.md', '正文无引用', ('底稿_',))
    check("artifact_plan 排除前缀生效（底稿_ 不入索引，fallback 只剩 csv）", [a['file'] for a in _ap] == ['数据附表.csv'], str(_ap))
    # 架构评审锚：表格行剔除（财务数据表"合计"行不吃 cap）+ cap=None 全量计数（截断上浮的前提）
    _tbl = ['这是正常散文句子。', '| 项目 | 金额 |', '| 合计 | 4800 亿元 |']
    _tg = extract.assertion_gaps(_tbl, [])
    check('表格行不入 gap（"合计"表格行被剔，散文行无信号亦不进）', [g['line'] for g in _tg] == [], str([g['line'] for g in _tg]))
    _many = ['第%d句安排资金补贴经费合计。' % i for i in range(60)]
    check('cap=None 全量 60 / 缺省 cap 截断 40', len(extract.assertion_gaps(_many, [], cap=None)) == 60 and len(extract.assertion_gaps(_many, [])) == 40, '')
else:
    print('  skip 考卷v3 fixture 缺失')

print('\n结果: PASS=%d FAIL=%d' % (PASS, FAIL))
sys.exit(0 if FAIL == 0 else 1)
