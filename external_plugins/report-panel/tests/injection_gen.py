# -*- coding: utf-8 -*-
"""注入考题集（纯函数模块，零 I/O）。

用途：L2 召回门的 ground truth——在真实样张副本上受控注入已知缺陷，
按矛盾类型分层（cross_section/within_section/global），含阴性对照测误报率。
类型学来源：FRANK/SummaC 错误分类 × 本项目校准集 8 条判级规则。
策略：**只插入不修改**——原样张内容零改动（真实 9 条判卷真类继续有效），
注入物自带唯一标记文本，行号即天然 ground truth。
"""
import re

S_L9 = '从工程极限拉回到日常可用'
S_L21 = '7 个值得记住'
S_L328 = '2d ≈ 6144'
S_L521 = '4.3 训练超参'
S_L814 = '6.4 长上下文'
S_L816 = 'MRCR 8-needle'
S_L829 = '128K 内表现稳定'
S_L957 = 'sparse embedding modules'
S_L1079 = '9.3.1'
S_L1084 = '80% 流量'

SPECS = [
    dict(id='A1', cls='table_contradiction', tag='within_section', anchor=S_L829, sev='A',
         text=['- **复测附记**：128K 以内各档检索精度均不低于 0.90，无任何档位回落。'],
         why='与 §6.4 自家表格 16K 行 0.85/0.84、64K 行 0.85 直接矛盾'),
    dict(id='A2', cls='table_contradiction', tag='within_section', anchor=S_L816, sev='A',
         text=['- **MRCR 补充口径**：V4-Flash 在 1M 档 MRCR 得分 95.2，全面领先所有对比模型。'],
         why='与 Table 6 的 83.5（及 92.9=Opus 最优）矛盾'),
    dict(id='A3', cls='table_contradiction', tag='cross_section', anchor=S_L21, sev='A',
         text=['- 速览补充：Flash 版 SimpleQA 得分 55.3，知识密集任务无短板。'],
         why='§7 速览宣称 55.3 与评测节 Table 6 的 34.1 矛盾'),
    dict(id='A4', cls='table_contradiction', tag='cross_section', anchor=S_L21, sev='B',
         text=['- Codeforces 实测 3348 分，较报告值再提升。'],
         why='3348 与评测节数值（3206 系）不一致，且"较报告值提升"无出处'),
    dict(id='B1', cls='total_mismatch', tag='within_section', anchor=S_L1079, sev='A',
         text=['- 部署成本构成：训练侧 18亿元、推理侧 9亿元、数据侧 6亿元，合计 40亿元。'],
         why='18+9+6=33≠40，合计不符'),
    dict(id='B2', cls='total_mismatch', tag='within_section', anchor=S_L1079, sev='A',
         text=['- 三个上线阶段分别耗时 12 天、15 天、21 天，全程共计 40 天。'],
         why='12+15+21=48≠40'),
    dict(id='B3', cls='control', tag='within_section', anchor=S_L1079, sev=None,
         text=['- 三个评测阶段分别耗时 12 天、15 天、9 天，全程共计 36 天。'],
         why='阴性对照：12+15+9=36 正确，不应被报'),
    dict(id='C1', cls='strength_hedging', tag='cross_section', anchor=S_L9, sev='A',
         text=['在所有任务上全面超越 GPT-5.4 与 Gemini-3.1-Pro。'],
         why='与 §1.8（L119 附近"相比 5.4/3.1-Pro 略弱"）方向相反'),
    dict(id='C2', cls='strength_hedging', tag='global', anchor=S_L829, sev='B',
         text=['该稳定性结论无条件成立，不受评测口径与脚手架选择影响。'],
         why='限定词移除+范围无限化（表 4 已示 harness 摆幅）'),
    dict(id='C3', cls='strength_hedging', tag='within_section', anchor=S_L1084, sev='B',
         text=['该分流方案可将总体服务成本降低约 65%。'],
         why='无测算支撑的量化收益宣称'),
    dict(id='C4', cls='strength_hedging', tag='cross_section', anchor=S_L9, sev='A',
         text=['1M 长上下文的推理速度已达实时交互水平，可直接用于对话场景。'],
         why='与 §8.1.4 自承"尚未达到实时交互标准"直接矛盾'),
    dict(id='D1', cls='dangling', tag='global', anchor=S_L21, sev='B',
         text=['- 性能已与 Claude Opus 4.7 Max 持平。'],
         why='对比对象全文仅此一处、各表无其数据行（真实表仅到 4.6）'),
    dict(id='D2', cls='dangling', tag='within_section', anchor=S_L957, sev='B',
         text=['（另见 Liu et al. 2028 的独立验证）'],
         why='参考文献不存在该条目（且年份越界）'),
    dict(id='D3', cls='dangling', tag='global', anchor=S_L21, sev='C',
         text=['- 详细消融数据见附录 D。'],
         why='全文无附录 D'),
    dict(id='E1', cls='undefined_number', tag='cross_section', anchor=S_L328, sev='A',
         text=['- 另一关键阈值为 2d ≈ 5230 FLOPs/Byte，两者取其小。'],
         why='与真实 L328 的 6144 并存且同样无 d 定义——制造双值无口径冲突'),
    dict(id='E2', cls='undefined_number', tag='global', anchor=S_L21, sev='B',
         text=['- 每 token 均摊推理成本 0.017 元。'],
         why='全文无任何成本测算支撑'),
    dict(id='E3', cls='undefined_number', tag='cross_section', anchor=S_L9, sev='A',
         text=['上下文窗口实际可达 2M token。'],
         why='与规格表 1M 矛盾'),
    dict(id='F1', cls='scope_overreach', tag='global', anchor=S_L21, sev='B',
         text=['- 上述结论适用于所有语言、所有领域与所有部署规模。'],
         why='评测仅覆盖部分语言/任务，范围无限化'),
    dict(id='F2', cls='scope_overreach', tag='within_section', anchor=S_L1084, sev='B',
         text=['开箱即用，无需任何微调即可在第三方硬件复现全部评测结果。'],
         why='与文中"对工程基础设施有要求"的自承冲突'),
    dict(id='F3', cls='scope_overreach', tag='global', anchor=S_L21, sev='C',
         text=['- 硬件门槛为零。'],
         why='与基础设施章大量定制（TileLang/EP等）矛盾'),
    dict(id='G1', cls='attribution', tag='within_section', anchor=S_L829, sev='A',
         text=['- 其中 0.49 的 1M 档得分属于 Gemini-3.1-Pro，V4 仍显著领先。'],
         why='0.49 实为 V4-Flash 列值，归属错位（复刻已验证缺陷类的新实例）'),
    dict(id='G2', cls='attribution', tag='cross_section', anchor=S_L521, sev='B',
         text=['Muon 优化器由本研究首次提出并开源。'],
         why='Muon 系引用的前人工作（§2.5 与参考文献），首创归属错误'),
    dict(id='N1', cls='control', tag='global', anchor=S_L21, sev=None,
         text=['- 本报告是对 DeepSeek-V4 论文的中文解读，覆盖架构、基础设施、训练与评测四个方面。'],
         why='阴性对照：与原文一致的纯描述，不应被报'),
    dict(id='N2', cls='control', tag='within_section', anchor=S_L1079, sev=None,
         text=['- 评测维度覆盖代码、知识与长上下文。'],
         why='阴性对照：中性归纳，不应被报'),
]


def apply_injections(lines, ids=None):
    """纯函数：按规格插入注入行。升序+累积偏移（每次插入只影响更高位置，先记录的行号永不失效）。
    返回 (new_lines, manifest)；manifest 每条含注入后绝对行号区间。"""
    specs = [s for s in SPECS if ids is None or s['id'] in ids]
    located = []
    for s in specs:
        hits = [i for i, l in enumerate(lines) if s['anchor'] in l]
        if len(hits) != 1:
            raise SystemExit('锚点不唯一/未命中 [%s] %r: hits=%d' % (s['id'], s['anchor'][:20], len(hits)))
        located.append((hits[0], s))
    located.sort(key=lambda x: x[0])  # 升序：每次插入只影响更高位置，先记录的行号永不失效
    new_lines = list(lines)
    manifest = []
    offset = 0  # 已插入行数累积
    for anchor_idx, s in located:
        ins = s['text']
        at = anchor_idx + 1 + offset  # 锚行之后的实际插入点（同锚多注入自然向下叠放）
        new_lines[at:at] = ins
        manifest.append({'id': s['id'], 'cls': s['cls'], 'tag': s['tag'], 'sev': s['sev'],
                         'anchor_line': anchor_idx + 1 + offset,
                         'planted_lines': list(range(at + 1, at + 1 + len(ins))),
                         'planted_text': ins, 'why': s['why']})
        offset += len(ins)
    return new_lines, manifest


def recall_score(manifest, reported_points):
    """计分（纯）：reported_points = 评审报告指认的行号集合。
    返回分层召回与误报。control 命中计为误报。"""
    res = {'by_tag': {}, 'by_cls': {}, 'false_positives': []}
    for m in manifest:
        hit = any(p in m['planted_lines'] or abs(p - m['anchor_line']) <= 2 for p in reported_points)
        if m['cls'] == 'control':
            if hit:
                res['false_positives'].append(m['id'])
            continue
        for key in ('by_tag', 'by_cls'):
            k = m['tag'] if key == 'by_tag' else m['cls']
            res[key].setdefault(k, [0, 0])
            res[key][k][1] += 1
            if hit:
                res[key][k][0] += 1
    total = sum(v[0] for v in res['by_cls'].values()), sum(v[1] for v in res['by_cls'].values())
    res['overall'] = '%d/%d' % total
    return res
