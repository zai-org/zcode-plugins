# -*- coding: utf-8 -*-
"""确定性层纯函数模块（v0.6 设计契约定型，零 I/O）。

职责边界：本模块只做"文本→结构"的确定性转换；文件读写/进程调用由调用方注入
（workflow 内嵌 shim 或测试文件），以保证本模块可被 L0 直接 import 测试。
"""
import re, collections

# v0.10.0（代码审 P2 纠偏）：单位交替按长度降序——正则有序交替取首命中，
# kW 列于 kWh/kW/ton 之前会让 '300kWh'/'5kW/ton' 100% 误标为 kW（表内明列单位必错，非边界）
NUM_PAT = re.compile(r'(\d[\d,，]*(?:\.\d+)?)\s*(%|万亿|亿|万|千|元|kW/ton|kWh|MWh|GWh|kW|MW|GW|Wh|°C|K|MPa|kPa|t/h|人天|人周|人|km2|m2|m3|mm|kg|km|倍|座|站|家|条|次|年|月|天|小时|分钟)')

SIGNAL_PATS = {
    '财务': r'毛利|定价|成本|营收|现金流|敏感性|IRR|TAM|投资回报|年费|报价',
    '工程物理': r'COP|工况|热力学|卡诺|焓|熵|载荷|功率|温差|换热|流体',
    '数据严谨': r'样本|误差|置信|统计|偏差|复算|校准|精度|分位',
    '合规边界': r'合规|责任|边界|承诺|合同|法规|免责|验收',
    '外部事实': r'文献|引用|来源|官网|论文|公开|报道|标准',
}

CLAIM_STRONG = re.compile(r'优于|超过|反超|领先|首次|唯一|完全|显著|大幅|证明|确保|保证|均|全部|稳定|持平|掉点|无损|无可测')
CLAIM_WEAK = re.compile(r'表明|显示|意味着|导致|达到|实现|验证|确认|压缩|降低|减少|提升|改善|大约|约为|接近')
HEADLINE_SEC = re.compile(r'摘要|abstract|引言|绪论|结论|总结|overview|summary|创新|核心', re.I)

ART_EXT = ('.json', '.csv', '.pdf', '.docx', '.py', '.mo', '.txt', '.md', '.mat', '.xlsx')


def fnum(s):
    try:
        return float(s.replace(',', '').replace('，', ''))
    except Exception:
        return None


# v0.9.1+（审计 A1）输入格式三检：此前 open(errors='replace') 直读，PDF/GBK/UTF-16 输入
# 会以乱码静默跑完全程——toc/nums 全空时 coverage_assertion 因 secs 为空恒过，评审团在
# 乱码上空转数十万 token 且无一声报错，与"确定性层是地基，拒绝降级空转"的立库哲学冲突。
# 字节层魔数（%PDF/PK）由 workflow PY_BUS 读入时拦；本函数拦文本层两类信号（纯，可 L0）：
#   ① replacement 密度：errors='replace' 产物 U+FFFD 占比 >1% —— 正常 UTF-8 文档为 0，
#      GBK/UTF-16/二进制残余普遍 >10%；个别坏字节（网页粘贴残留，通常 <0.1%）不误伤
#   ② 结构信号：>5000 字符却零数字命中且零标题行——对"报告"域输入，这是非文本输入的
#      行为指纹（正常报告不可能无年份无数字无任何标题）
BAD_INPUT_THRESHOLD = 0.01
_STRUCT_MIN_CHARS = 5000


def validate_input(text):
    """输入格式校验（纯）。非法输入 raise ValueError（消息面向调用者可读）；合法返回 None。"""
    n = len(text)
    if n and text.count('\ufffd') / n > BAD_INPUT_THRESHOLD:
        raise ValueError('输入不是合法 UTF-8 文本（替换符密度 %.1f%%>1%%）——请先转存为 UTF-8 编码的 txt/md' % (100.0 * text.count('\ufffd') / n))
    if n > _STRUCT_MIN_CHARS:
        # 零阿拉伯数字（裸 \d，比 NUM_PAT 宽——数字无单位跟随也算文本特征）且零标题行才拦
        if not re.search(r'\d', text) and not re.search(r'^#{1,4}\s|^第[一二三四五六七八九十百0-9]+[章节]|^(（?[一二三四五六七八九十]{1,3}）?、?\s)', text, re.M):
            raise ValueError('输入 >5000 字符但零数字零标题——疑似二进制/非文本输入，请检查文件内容')
    return None


def extract_toc(lines):
    toc = []
    for i, l in enumerate(lines, 1):
        s = l.strip()
        m = re.match(r'^(#{1,4})\s+(.{2,80})', s)
        if m:
            toc.append({'line': i, 'title': m.group(2)})
        m2 = re.match(r'^第[一二三四五六七八九十百0-9]+[章节][\s、.．:：]{0,2}(.{0,60})', s)
        if m2:
            toc.append({'line': i, 'title': s[:60]})
        # v0.8（A6）：公文"（一）（二）"与"一、二、"小节头——C 轮 80 锚点只登记 60、
        # 第五部分 0 锚的根因即此两类头全部漏识别（登记召回=覆盖瓶颈真根因，判卷§四.2）
        m3 = re.match(r'^（[一二三四五六七八九十]{1,3}）\s*(.{0,60})', s)
        if m3 and len(s) >= 6:
            toc.append({'line': i, 'title': s[:60]})
        m4 = re.match(r'^[一二三四五六七八九十]{1,3}、\s*(.{2,60})', s)
        if m4 and len(s) >= 6:
            toc.append({'line': i, 'title': s[:60]})
    return toc


def extract_numbers(lines):
    nums = []
    for i, l in enumerate(lines, 1):
        for m in NUM_PAT.finditer(l):
            ctx = l[max(0, m.start() - 25):m.end() + 25].strip()
            nums.append({'line': i, 'value': m.group(1), 'unit': m.group(2), 'ctx': ctx})
    return nums


def compute_signals(text):
    return {k: len(re.findall(p, text)) for k, p in SIGNAL_PATS.items()}


# v0.8（A7）口径门禁常量：C 轮判卷实证 X/XP 家族全史零真阳性（样张A 未开火、样张C 54 发 0 中，
# 靠 LLM 复算层撤回），根因=①词流重建表行异口径乱加（含 2026年/6月 类日期）②核销/债券伪比率
# ③同单位跨指标混和（存量 vs 增量和——单位代理挡不住，公文残余约 7-12 条/篇，注入侧降 B 级）。
# 门禁四条件不满足即静默（不降 XS 挤占查漏视野）：
#   ① 非表格行（markdown 表行不勾稽——表内勾稽需语义配对，python 做不了，归调查员）
#   ② 数字类型过滤（% 不参与求和；年值∈[1900,2100]/月值∈[1,12] 是日期成分剔除；
#      天/小时/分钟是时长量值，合法求和算子，不剔——L0 既有用例"工期共计40天"必须继续可抓）
#   ③ 同口径（X：stated 与 parts 同单位同组；XP：分子分母同单位同行且行含 占比/比重/比例/份额）
#   ④ 合理偏差域（X：dev∈(2%,400%]——荒谬比=跨指标垃圾，如存量462万亿 vs 增量和37万亿）；
#      XP 每行至多产出一条（最大差者），防 % 列表行连环误报
PCT_HINT = re.compile(r'占比|比重|比例|份额')


def _is_date_like(v, unit):
    if unit == '年':
        return 1900 <= v <= 2100 and v == int(v)
    if unit == '月':
        return v == int(v) and 1 <= v <= 12
    return False


def _unit_groups(text):
    """文本内数字按单位分组（同口径），剔 % 与日期成分值。返回 {unit: [float]}。"""
    g = collections.defaultdict(list)
    for m in NUM_PAT.finditer(text):
        u = m.group(2)
        v = fnum(m.group(1))
        if v is None:
            continue
        if u == '%' or _is_date_like(v, u):
            continue
        g[u].append(v)
    return g


def _is_table_row(l):
    return l.lstrip().startswith('|') or ' | ' in l


def arithmetic_checks(lines):
    """合计/百分比交叉核对（v0.8 A7 口径门禁定稿版，纯）。门禁四条件见上方模块注释。"""
    sum_re = re.compile(r'合计|共计|总计|累计|全年共|总共')
    sum_checks = []
    for i, l in enumerate(lines, 1):
        if not sum_re.search(l) or _is_table_row(l):
            continue
        # 同口径分组：本行优先，单位组内 ≥3 个才判；不足才退邻近窗（实测为行 i-2..i+2 共 5 行，
        # 此前注释误写 ±3——审计算过切片边界后修正，行为不变）
        groups = _unit_groups(l)
        cands = [(u, v) for u, v in groups.items() if len(v) >= 3]
        if not cands:
            ctx = ' '.join(x for x in lines[max(0, i - 3):min(len(lines), i + 2)] if NUM_PAT.search(x))
            groups = _unit_groups(ctx)
            cands = [(u, v) for u, v in groups.items() if len(v) >= 3]
        for u, vals in cands:
            mx = max(vals)
            parts = sorted(vals)[:-1]
            psum = sum(parts)
            if mx <= max(parts) * 1.5 or psum <= 0:
                continue
            dev = abs(mx - psum) / psum
            if 0.02 < dev <= 4.0:
                sum_checks.append({'line': i, 'stated': mx, 'parts_sum': psum, 'unit': u,
                                   'dev_pct': round(dev * 100, 1), 'ctx': l.strip()[:90]})
    pct_checks = []
    for i, l in enumerate(lines, 1):
        if not PCT_HINT.search(l) or _is_table_row(l):
            continue
        # 每行至多一条（最大差者）：% 列表行（"23.5%、15.1%，均高于…"）对同一对大数连环误报的根治
        best = None
        for m in re.finditer(r'(\d+(?:\.\d+)?)\s*%', l):
            pct = float(m.group(1))
            if not (0 < pct < 100):
                continue
            big_by_unit = collections.defaultdict(list)
            UNIT_SCALE = {'万亿': 1e12, '亿': 1e8, '万': 1e4, '元': 1}
            for nm in NUM_PAT.finditer(l):
                v = fnum(nm.group(1))
                u = nm.group(2)
                # 绝对金额规范尺度过滤（≥千万）：替代旧 v>100 裸值过滤——后者把
                # "8.3 万亿"类小数值大金额分子误滤、又放过"900 万"类小金额噪声
                if v and not nm.group(0).endswith('%') and u in UNIT_SCALE and v * UNIT_SCALE[u] >= 1e7:
                    big_by_unit[u].append(v)
            for u, big in big_by_unit.items():
                if len(big) < 2:
                    continue
                a, b = sorted(big)[-2:]
                if b > 0:
                    implied = a / b * 100
                    d = abs(implied - pct)
                    if d > 3 and pct > 0.5 and (best is None or d > best[0]):
                        best = (d, {'line': i, 'stated_pct': pct, 'implied_pct': round(implied, 1),
                                    'pair': [a, b], 'unit': u, 'ctx': l.strip()[:90]})
        if best:
            pct_checks.append(best[1])
    return sum_checks, pct_checks[:40]


def ikey(before):
    w = ''.join(ch for ch in before if u'\u4e00' <= ch <= u'\u9fff')
    return w[-8:]


# v0.9.1（XS key 升级）：指标名词键——窗口 14→20、迭代剥尾部算子词（累计超过/分别/年均/超过/增长…）、
# 取清洗后末 6 字。治 ikey 语境键不聚（实测：城镇新增就业 1267/1200/1213/6000 四值四键不聚，
# CS1 类同指标异值只能靠核心席全文读）。剥词表只剥词尾整词且保留至少 1 字，指标名成分不受影响。
_OP_SUFFIX = ('累计超过', '共计', '累计', '分别', '年均', '平均', '同比', '超过', '增长', '下降',
              '提高', '降低', '达到', '左右', '约', '较', '为', '是', '达')


def metric_key(before):
    w = ''.join(ch for ch in before[-20:] if u'\u4e00' <= ch <= u'\u9fff')
    changed = True
    while changed and w:
        changed = False
        for op in _OP_SUFFIX:
            if w.endswith(op) and len(w) > len(op):
                w = w[:-len(op)]
                changed = True
                break
    return w[-6:]


def metric_suspects(nums):
    bysus = collections.defaultdict(list)
    for n in nums:
        head = n['ctx'].split(n['value'])[0]
        k = metric_key(head)
        if len(k) >= 2:
            bysus[k].append(n)
    suspects = []
    for k, v in bysus.items():
        if len(v) < 2:
            continue
        uniq = {(x['value'], x['unit']) for x in v}
        if len(uniq) > 1 and len(v) <= 12:
            suspects.append({'metric': k, 'occurrences': [{'line': x['line'], 'value': x['value'], 'unit': x['unit']} for x in v[:6]]})
    return suspects[:60]


def locate_section(line, secs):
    cur = ''
    for t in secs:
        if t['line'] <= line:
            cur = t['title']
        else:
            break
    return cur


def assertion_candidates(lines, toc, nums):
    """断言候选脚手架：强宣称词/宣称词+数字 行，带行号/章节/承重分级/关联数字。
    下游解剖员 LLM 依据本清单精炼为最终断言登记表（锚定率是 L2 质量门）。"""
    secs = sorted(toc, key=lambda t: t['line'])
    num_by_line = collections.defaultdict(list)
    for n in nums:
        num_by_line[n['line']].append(n['value'] + n['unit'])
    out = []
    for i, l in enumerate(lines, 1):
        if len(l.strip()) < 8:
            continue
        strong = bool(CLAIM_STRONG.search(l))
        weak = bool(CLAIM_WEAK.search(l))
        has_num = i in num_by_line
        if not (strong or (weak and has_num)):
            continue
        sec = locate_section(i, secs)
        score = (2 if strong else 1) + (1 if has_num else 0) + (1 if HEADLINE_SEC.search(sec) else 0)
        out.append({'line': i, 'section': sec[:40], 'quote': l.strip()[:120],
                    'tier': 'load_bearing' if score >= 3 else 'supporting',
                    'score': score, 'related_numbers': num_by_line[i][:6]})
    return out


# v0.13.2（bench J1 根治）：断言候选盲区告警。考卷v3 实跑七处注入句全 miss——
# 候选规则是"宣称词表触发"（strong 或 weak+带单位数字），对无宣称词的操作句/承诺句/
# 书名号引用句/安全操作句零覆盖（"合计/安排/占比/清单/权限"均不在词表，"23项/87pips"
# 的"项/pips"不在单位表故不构成 has_num）。本函数宽表重扫四类信号，凡不在候选行集者
# 输出 gap 清单交解剖员逐行裁决（登记或豁免）——确定性前置 + LLM 裁决出口，宁宽勿漏。
GAP_CITE_PAT = re.compile(r'《[^》]{2,40}》')
GAP_OP_PAT = re.compile(r'合计|共计|安排|部署|落实|对照|逐项|对齐|执行|专项|贴息|补贴|经费|预算|拨付|资金')
GAP_SAFETY_PAT = re.compile(r'默认开放|远程写入|越权|旁路|无鉴权|禁止访问')


def assertion_gaps(lines, candidates, cap=40):
    """候选盲区重扫（纯）：宣称词（强弱皆可，弱词无数字的漏网在此抓回）∪ 书名号引用 ∪
    操作/资金信号 ∪ 安全操作信号的行，不在候选行集者输出 [{line, signals, quote}]。
    上限 cap 防长文档爆炸（cap=None 全量——PY_BUS 以此计数后切片并上浮 truncated 标志，
    截断非静默是 0.13.0 C4 教义）；表格行剔除；宁宽勿漏——误入由解剖员 dismiss 出口消化。
    candidates 兼容 analyze() 原始 dict 形态 {'n':..,'candidates':[..]}——功能评审 D1：
    PY_BUS 壳手写实参与函数签名错配是 L0 盲区，形态防御让壳无论怎么写都安全。"""
    if isinstance(candidates, dict):
        candidates = candidates.get('candidates') or []
    cand_lines = set(int(c.get('line') or 0) for c in candidates)
    out = []
    for i, l in enumerate(lines, 1):
        if i in cand_lines or len(l.strip()) < 8:
            continue
        # 架构评审：剔表格行——GAP_OP_PAT 含"合计/资金/预算"，财务报告数据表行会成片命中
        # 吃满 cap，把散文盲区挤出清单（与 arithmetic_checks 同款剔除）
        if _is_table_row(l):
            continue
        sigs = []
        if CLAIM_STRONG.search(l) or CLAIM_WEAK.search(l):
            sigs.append('claim')
        if GAP_CITE_PAT.search(l):
            sigs.append('cite')
        if GAP_OP_PAT.search(l):
            sigs.append('op')
        if GAP_SAFETY_PAT.search(l):
            sigs.append('safety')
        if sigs:
            out.append({'line': i, 'signals': sigs, 'quote': l.strip()[:80]})
            if cap is not None and len(out) >= cap:
                break
    return out


def triage_scaffold(lines, toc, nums, suspects, candidates):
    """分诊脚手架：按章节的风险分（数字密度+3×断言+5×疑点+头条章节加成）。"""
    secs = sorted(toc, key=lambda t: t['line'])
    sec_list = []
    bounds = [t['line'] for t in secs] + [len(lines) + 1]
    num_by_line = collections.Counter(n['line'] for n in nums)
    for si, t in enumerate(secs):
        lo, hi = bounds[si], bounds[si + 1]
        nc = sum(num_by_line.get(x, 0) for x in range(lo, hi))
        cand = sum(1 for c in candidates if lo <= c['line'] < hi)
        susp = sum(1 for s in suspects for o in s['occurrences'] if lo <= o['line'] < hi)
        risk = nc + 3 * cand + 5 * susp + (4 if HEADLINE_SEC.search(t['title']) else 0)
        sec_list.append({'section': t['title'][:40], 'from': lo, 'to': hi - 1,
                         'numbers': nc, 'claim_candidates': cand, 'suspects': susp, 'risk': risk})
    return sorted(sec_list, key=lambda s: -s['risk'])


def artifact_plan(sibling_names, report_name, text, exclude_prefixes=()):
    """工件发现决策（纯）：返回应读取的文件清单及理由。实际读取由调用方执行。
    exclude_prefixes（v0.13.2 功能评审 D2）：与 freeze 同参的排除前缀——被排除件不进
    工件索引（否则 full 档环境席仍读到冻结圈外的文件，ext_exclude 半程接线）。"""
    refs = set(re.findall(r'[\w\-\u4e00-\u9fff]+\.(?:json|csv|pdf|docx|py|mo|txt|md|mat|xlsx)', text))
    # v0.12.1（审计 B4）：先全量过滤+标 referenced 再截断——原序 sorted()[:60] 先截后判
    cands = []
    for f in sorted(sibling_names):
        if not f.lower().endswith(ART_EXT):
            continue
        if f.startswith('.') or f == report_name or f.endswith('.panel_ledger.json') or f == 'index.json':
            continue
        if exclude_prefixes and f.startswith(tuple(exclude_prefixes)):
            continue
        if '..' in f or '/' in f or '\\' in f:
            continue
        cands.append({'file': f, 'referenced': f in refs})
    kept = [a for a in cands if a['referenced']][:60]
    fallback = [a for a in cands if not a['referenced']][:5] if not kept else []
    return kept + fallback


def assertion_fidelity(lines, assertions):
    """断言登记表转写保真校验（纯，v0.12——样张E AS31 案：解剖员把 489/203 张冠李戴，
    靠财务席单点拦截属运气）。逐断言核 numbers 是否在所指行的 ±2 行窗内命中原文：
    号码与窗文本都做「去空白+去千分位逗号」归一后匹配（v0.13：md 转换/换行折行产生的
    "3.5 亿"vs"3.5亿"类空白变体不再误报失真——归一只放宽不收紧，零新增误报面）。
    返回 [{id, line, number, hit}]——仅失配项；空列表=全保真。"""
    out = []

    def _norm(t):
        return re.sub(r'[\s,，]', '', str(t))

    for a in assertions:
        ln = int(a.get('line') or 0)
        if ln <= 0:
            # v0.12.1（审计 C6）：行号≤0 视为失配
            for num in (a.get('numbers') or []):
                s2 = str(num).strip()
                if s2:
                    out.append(dict(id=a.get('id'), line=ln, number=s2, hit=False))
            continue
        window = lines[max(0, ln - 3):min(len(lines), ln + 2)]
        window_n = [_norm(w) for w in window]
        for num in (a.get('numbers') or []):
            s = str(num).strip()
            if not s:
                continue
            v = _norm(s)
            # 原形命中（旧路）∪ 归一命中（v0.13 去空白/逗号变体）——两路任一通过即保真
            if any(s in w for w in window) or any(v in w for w in window_n):
                continue
            out.append(dict(id=a.get('id'), line=ln, number=s, hit=False))
    return out


def analyze(text):
    """总线分析主入口（纯）：文本 → 全套材料 dict（调用方负责落盘）。

    v0.9.1+（审计 A1）：入口先过 validate_input——乱码输入在源头 raise，
    不再以空 toc/空 nums 静默跑完让 coverage_assertion 恒过。"""
    validate_input(text)
    lines = text.split('\n')
    toc = extract_toc(lines)
    nums = extract_numbers(lines)
    groups = collections.Counter((n['value'], n['unit']) for n in nums)
    sum_checks, pct_checks = arithmetic_checks(lines)
    suspects = metric_suspects(nums)
    cands = assertion_candidates(lines, toc, nums)
    triage = triage_scaffold(lines, toc, nums, suspects, cands)
    signals = compute_signals(text)
    return {
        'ledger': {'chars': len(text), 'toc': toc, 'numbers': nums, 'num_total': len(nums),
                   'dup_groups': [{'value': k[0], 'unit': k[1], 'n': v} for k, v in groups.most_common() if v >= 2],
                   'signals': signals, 'sum_checks': sum_checks, 'pct_checks': pct_checks, 'suspects': suspects},
        'assertion_candidates': {'n': len(cands), 'candidates': cands},
        'triage_scaffold': {'sections': triage, 'signals': signals},
        'precomputed': {'sum_checks': sum_checks, 'pct_checks': pct_checks, 'suspects': suspects},
        'headline': {'chars': len(text), 'toc_n': len(toc), 'num_total': len(nums),
                     'assertion_candidates': len(cands),
                     'load_bearing': sum(1 for c in cands if c['tier'] == 'load_bearing'),
                     'sum_checks': len(sum_checks), 'pct_checks': len(pct_checks),
                     'suspects': len(suspects),
                     'top_risk_sections': [s['section'] for s in triage[:5]]},
    }


def build_excerpts(lines, items):
    """调查摘录（v0.6.1：单位数行号 + 引文定位兜底，纯）。"""
    out = []
    cap = max(1200, min(12000, 200000 // max(1, len(items))))
    stripped = None
    for it in items:
        refs = [int(m) for m in re.findall(r'L(\d{1,4})', it['text'])] + [int(m) for m in re.findall(r'行(\d{1,4})', it['text'])]
        refs = sorted(set(r for r in refs if 1 <= r <= len(lines)))
        if not refs:
            # 引文定位兜底：简报无行号时，用首个「」引文前12字在原文定位（分歧/GAP条目常见）
            m = re.search(r'「([^」]{4,80})」', it['text'])
            if m:
                key = m.group(1).replace(' ', '')[:12]
                if stripped is None:
                    stripped = [l.replace(' ', '') for l in lines]
                for i, l in enumerate(stripped):
                    if key and key in l:
                        refs = [i + 1]
                        break
        rngs = []
        for n in refs:
            a, b = max(0, n - 61), min(len(lines), n + 60)
            if rngs and a <= rngs[-1][1] + 1:
                rngs[-1][1] = max(rngs[-1][1], b)
            else:
                rngs.append([a, b])
        txt, total, stop = [], 0, False
        for a, b in rngs:
            if stop:
                break
            for i in range(a, b):
                s = 'L%d|%s' % (i + 1, lines[i].rstrip())
                nb = len(s.encode('utf-8'))
                if total + nb > cap:
                    stop = True
                    break
                txt.append(s)
                total += nb + 1
        out.append({'id': it['id'], 'refs': len(refs), 'excerpt': '\n'.join(txt)})
    return out
