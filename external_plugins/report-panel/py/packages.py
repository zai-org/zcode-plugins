# -*- coding: utf-8 -*-
"""v0.6 证据包构造器（纯函数，零 I/O）。

职责：从材料总线（extract.analyze 的产物）按席位构造定向证据包；
分诊只分配深度（谁深读哪里），不决定覆盖（覆盖完备性由断言强制）。
"""
import re, collections

SEAT_DEFS = {
    # 核心席：全文深读权（判卷证明的全文级矛盾捕获来源，不裁）
    # v0.7：核心席 4→2——四轮 56 个 A 类簇中"决策层读者/行业专家"零独占发现（裁切依据见 v0.7_验证设计与调研.md）
    '逻辑审计员': dict(kind='core', patterns=[]),
    '魔鬼代言人': dict(kind='core', patterns=[]),
    # 专项席：证据包投喂（pattern 命中行 ± 上下文行号窗）
    '数据严谨审计员': dict(kind='spec', patterns=[r'样本|误差|置信|统计|偏差|复算|校准|精度|分位|基准|评测|Table|表\d',
                                            # v0.6.2：空心证据句式探测（判级锚②——"实验表明"型无数据支撑主张，GT#3盲区根治）
                                            r'实验(表明|显示|证据)|实证表明|经验表明|可忽略|近似无害|几乎不损|不损害|性能损(失|耗)']),
    '财务审计员': dict(kind='spec', patterns=[r'毛利|定价|成本|营收|现金流|敏感性|IRR|TAM|投资回报|年费|报价|亿元|万元|预算|开销']),
    '合规边界审计员': dict(kind='spec', patterns=[r'合规|责任|边界|承诺|合同|法规|免责|验收|保证|确保|适用|无条件|所有(语言|领域|任务|场景)']),
    # v0.9.1 裁席 R6 贯穿（审计 B1）：'外部事实审计员' 已从编排层移除（三轮零独占终级A+
    # 对照跑 GT 10/10 零损失，职责由调查层 WebSearch 承接）——SEAT_DEFS 是被 build_packages
    # 遍历的活代码，此前每跑仍为已裁席位构造证据包并落 pkg 文件；席位注册表与编排层同步裁撤
    '环境审计员': dict(kind='spec', patterns=[r'工件|附件|附录|数据文件|实验记录|复现|\.csv|\.json|\.pdf|\.xlsx']),
}

CTX_WINDOW = 3      # pattern 命中行的上下文窗（±3 行号，供 Read 按需取）
PKG_LINE_CAP = 400  # 单包行号引用预算（行号≈5token/个，400个≈2k tokens，防退化为全文即可）

# v0.8（A2）覆盖维度基础集（技术报告）：查漏三态裁决的靶子清单。
# 每维度须有 covered_by=簇id / not_applicable+理由 / missed 之一裁决；缺失由编排层自动追加进 missed[]。
# "验收可实现性/受众适配"= v0.7 裁掉的两个核心席位（决策层读者/行业专家）的靶子入机制；
# "安全基线"= C 轮前连续漏检维度（信息安全无人认领，README 已知边界）。
DIMENSIONS = ['数字一致性', '结构', '外部事实', '方法学', '法律合规', '安全基线', '供应链', '成本财务', '验收可实现性', '受众适配']


def dimensions_list(custom=None):
    """维度清单（v0.8 A2，纯）：args.dimensions 覆盖支持，custom 为逗号分隔字符串或列表。"""
    if not custom:
        return list(DIMENSIONS)
    if isinstance(custom, str):
        return [x.strip() for x in custom.split(',') if x.strip()]
    return [str(x).strip() for x in custom if str(x).strip()]


def format_assert_brief(assertions):
    """断言登记表全量格式化（v0.8 A8，纯）：盲评/查漏/结构诊断的行内简报。
    修复 slice(0,60) 截断（C 轮 96 条精炼断言仅 60 条进全部席位 prompt——36 条不可见）。
    全量内联逐条：AS编号|行号|章节|主张(≤40字)|承重级；完整表另落盘 materials/assertions_refined.json。"""
    out = []
    for a in assertions:
        aid = a.get('id', 'AS%d' % (len(out) + 1))
        claim = str(a.get('claim', ''))[:40]
        out.append('%s|%s|%s|%s|%s' % (aid, a.get('line', '?'), str(a.get('section', ''))[:12], claim, a.get('tier', '')))
    return '\n'.join(out)

# v0.7：空心证据确定性检测（判级锚②机制化，GT#3 根治）——席位投喂三轮未转化（注意力方差），
# 改由 hollow_scan 直接产出 XH findings 注入 reviews 管线，零 LLM 成本。
# 句式负向断言排除"不可忽略"（否定式实话，非空心断言）。
HOLLOW_PAT = re.compile(r'实验(表明|显示|证据)|实证表明|经验表明|(?<!不)可忽略|近似无害|几乎不损|不损害|性能损(失|耗)')
# 句内数据锚：图表引用 / 带单位数值（%、倍、×、亿/万/千/百） / 括号文献引用——命中即"有据"，不报。
# 排除"2L""(L/2)"类结构系数：数字后紧跟大写字母/右括号不算单位。
HOLLOW_INLINE_ANCHOR = re.compile(r'[表图]\s*\d|Table\s*\d|Figure\s*\d'
                                  r'|\d+(?:\.\d+)?\s*[%％倍x×亿万亿千百]'
                                  r'|[（(][^（）()]{0,80}?(et al\.|, 19\d\d|, 20\d\d)[^（）()]{0,20}[）)]')
# 窗口数据表锚：markdown 表格数据行（含数字）
HOLLOW_TABLE_ROW = re.compile(r'^\s*\|.*\d.*\|\s*$')
HOLLOW_ANCHOR_WINDOW = 40  # 数据表锚回查窗口（±行数），v0.7 设计文档定值

# v0.8.1（A3）：比较级空心族——"显著/大幅/明显/极大 × 提升/改善/提高/降低"类无据改善主张。
# 前瞻框架守卫（三段式基线的阴性零误报关键）：政策/展望动词统领的小句是目标语言非证据主张，
# 放过——实测拦截样张C L860"整体供电效率将显著提升"、样张D"促进居民消费率明显提高"两处前瞻语。
HOLLOW_DEGREE_PAT = re.compile(r'(显著|大幅|明显|极大)(提升|改善|提高|降低)')
PROSPECTIVE_HEAD = re.compile(r'促进|推动|加快|力争|争取|确保|实现|预期|预计|有望|迈向')
_DEGREE_CLAUSE_BREAK = '；。：，'


def _degree_is_prospective(l, m):
    """比较族匹配点是否处于前瞻框架内：紧邻"将"字，或同小句（逗/分/句号切分）匹配点之前有政策/展望动词。"""
    if m.start() > 0 and l[m.start() - 1] == '将':
        return True
    start = max(l.rfind(c, 0, m.start()) for c in _DEGREE_CLAUSE_BREAK) + 1
    return bool(PROSPECTIVE_HEAD.search(l[start:m.start()]))


def hollow_match(l):
    """行级空心句式判定（v0.8.1：旧族 ∪ 带前瞻守卫的比较级族）。hollow_scan 与席位投喂共用。
    v0.13（issue#4 C7）：比较级族逐匹配判守卫（finditer）——同行多命中时旧版只看首个，
    首个被前瞻守卫放过、第二个无据改善主张即漏报（finditer 逐匹配判，任一非前瞻即报）。"""
    if HOLLOW_PAT.search(l):
        return True
    return any(not _degree_is_prospective(l, m) for m in HOLLOW_DEGREE_PAT.finditer(l))


def hollow_scan(lines):
    """空心证据确定性检测（v0.7 改动2，纯函数零 I/O；v0.8.1 A3 扩比较级族）。

    判定链：hollow_match（旧族 ∪ 带前瞻守卫的比较级族）命中行 → 句内有数据锚
    （图表/数值/文献引用）则放过 → ±HOLLOW_ANCHOR_WINDOW 行内有数据表行则放过
    （席位可对照邻近表格）→ 否则产出候选。
    返回 [{'line': int, 'quote': str}]；编排层据此生成 XH 系列 findings 注入 reviews 管线。
    阶段0 验证基线（样张A）：L68/L169/L267 必报（GT#3 三处，L269 为同族第四处亦报）；
    L66（句尾"约 1/4（见图 1(b)）"）/L117（"不可忽略"+文献引用）/L291/L570（句内数值）零误报。
    v0.8.1 三段式基线：旧族四样张行为不变；比较级族阴性（前瞻语/数值锚）零误报；
    比较级族阳性（无据改善主张）必报。"""
    hits = []
    n = len(lines)
    for i, l in enumerate(lines, 1):
        if not hollow_match(l):
            continue
        if HOLLOW_INLINE_ANCHOR.search(l):
            continue
        lo, hi = max(1, i - HOLLOW_ANCHOR_WINDOW), min(n, i + HOLLOW_ANCHOR_WINDOW)
        if any(HOLLOW_TABLE_ROW.match(lines[j - 1]) for j in range(lo, hi + 1)):
            continue
        hits.append({'line': i, 'quote': l.strip()[:60]})
    return hits


def _table_regions(nums, n_lines):
    """确定性表格区检测：≥3 个相邻（间隔≤2）含数字行 → 区块（含 ±1 上下文）。
    纯 pattern 席位包会漏无触发词的纯数字表格区——L0 实测缺口，此函数根治。"""
    lines_with = sorted({n['line'] for n in nums})
    regions, run = [], [lines_with[0]] if lines_with else []
    for x in lines_with[1:]:
        if x - run[-1] <= 2:
            run.append(x)
        else:
            if len(run) >= 3:
                regions.append((run[0], run[-1]))
            run = [x]
    if len(run) >= 3:
        regions.append((run[0], run[-1]))
    out = set()
    for a, b in regions:
        out.update(range(max(1, a - 1), min(n_lines, b + 1) + 1))
    return out


def _lines_matching(lines, patterns):
    """返回命中行号集合（±CTX_WINDOW 展开）。"""
    pat = re.compile('|'.join(patterns)) if patterns else None
    hit = set()
    for i, l in enumerate(lines, 1):
        if pat and pat.search(l):
            for j in range(max(1, i - CTX_WINDOW), min(len(lines), i + CTX_WINDOW) + 1):
                hit.add(j)
    return hit


def build_packages(lines, analyze_result, depth='standard'):
    """构造各席证据包。返回 {seat: {...}}；包内只有行号引用与断言子集，绝不内嵌原文段落。"""
    toc = analyze_result['ledger']['toc']
    cands = analyze_result['assertion_candidates']['candidates']
    nums = analyze_result['ledger']['numbers']
    suspects = analyze_result['ledger']['suspects']
    pre = analyze_result['precomputed']
    triage = analyze_result['triage_scaffold']['sections']
    n_lines = len(lines)

    # 断言清单（全员可见——跨节矛盾在断言层显影的关键）
    assert_list = [{'line': c['line'], 'section': c['section'], 'tier': c['tier'],
                    'quote': c['quote'][:60]} for c in cands]

    # 经济档：单裁判。深读区=风险前 6 章的行段，其余靠断言清单+预复算
    if depth == 'economy':
        top = triage[:6]
        ev_lines = sorted(set(j for s in top for j in range(s['from'], min(s['to'], s['from'] + 120) + 1)))
        return {'取证裁判': dict(role='single-judge', deep_read_sections=[s['section'] for s in top],
                               evidence=dict(lines=ev_lines[:PKG_LINE_CAP], assertions=assert_list,
                                             numbers=[n for n in nums if n['line'] in set(ev_lines)][:80],
                                             suspects=suspects, precomputed=pre,
                                             triage=triage),
                               budget_note='深读前6风险区+断言全表+预复算全量；其余章节按断言/摘录取证',
                               truncated=len(ev_lines) > PKG_LINE_CAP)}

    packages = {}
    for seat, d in SEAT_DEFS.items():
        if d['kind'] == 'core':
            packages[seat] = dict(role='core', deep_read=True, deep_read_sections=None,
                                  evidence=dict(assertions=assert_list, triage=triage),
                                  budget_note='全文两遍深读权（核心席不裁）', truncated=False)
            continue
        ev = _lines_matching(lines, d['patterns'])
        if seat == '数据严谨审计员':
            ev |= _table_regions(nums, n_lines)
        truncated = len(ev) > PKG_LINE_CAP
        ev_sorted = sorted(ev)[:PKG_LINE_CAP]
        seat_nums = [n for n in nums if n['line'] in ev][:100]
        pkg = dict(role='spec', deep_read=False, deep_read_sections=None,
                              evidence=dict(lines=ev_sorted, assertions=assert_list,
                                            numbers=seat_nums,
                                            suspects=[s for s in suspects
                                                      if any(o['line'] in ev for o in s['occurrences'])],
                                            precomputed=pre, triage=triage),
                              budget_note='pattern 命中±%d 行引用 + 断言全表 + 预复算；原文按行号 Read' % CTX_WINDOW,
                              truncated=truncated)
        if seat == '数据严谨审计员':
            # v0.6.3 结构化投喂保留为双保险；v0.7 起主通道=hollow_scan 的 XH 注入（绕过席位注意力）
            pkg['evidence']['hollow_checks'] = [dict(line=i, quote=l.strip()[:60])
                                                for i, l in enumerate(lines, 1) if hollow_match(l)][:24]
            pkg['budget_note'] += '；hollow_checks=空心证据候选行（"实验表明"类无数据主张），逐条回查全文有无对应实验数据表/图/消融，查无即按判级锚②报A'
        packages[seat] = pkg
    return packages


def coverage_assertion(lines, analyze_result, packages):
    """覆盖完备性断言（契约不变量①）：每章必须有 席位深读 或 证据行 或 断言 覆盖。
    返回 {complete, uncovered, by_section};违反即分诊失效，编排层必须拒绝开评。

    v0.13（issue#4 B6）明示取舍：any_core_full 短路使本门在 standard/full 档恒真
    （v0.7 裁席后核心席 deep_read 恒 True）——真实拦截面=economy 档（无核心席全读，
    每节须靠证据行/断言覆盖）。standard/full 保留本门只为 economy 路径复用同一入口；
    无标题含数字文档绕过 validate_input 的场景由查漏员维度三态兜底，不在本门语义内。"""
    toc = analyze_result['ledger']['toc']
    secs = sorted(toc, key=lambda t: t['line'])
    cands = analyze_result['assertion_candidates']['candidates']
    assert_lines = {c['line'] for c in cands}
    covered_lines = set(assert_lines)
    any_core_full = any(p.get('deep_read') for p in packages.values())
    for p in packages.values():
        covered_lines.update(p.get('evidence', {}).get('lines', []))
        covered_lines.update(p.get('evidence', {}).get('numbers', []) and
                             {n['line'] for n in p['evidence']['numbers']} or set())
    bounds = [t['line'] for t in secs] + [len(lines) + 1]
    by_section, uncovered = [], []
    for si, t in enumerate(secs):
        lo, hi = bounds[si], bounds[si + 1]
        n_cov = sum(1 for x in covered_lines if lo <= x < hi)
        ok = any_core_full or n_cov > 0 or (lo <= len(lines) and hi - lo <= 1)
        by_section.append({'section': t['title'][:40], 'covered_points': n_cov, 'ok': ok})
        if not ok:
            uncovered.append(t['title'][:40])
    return {'complete': len(uncovered) == 0, 'uncovered': uncovered, 'by_section': by_section}
