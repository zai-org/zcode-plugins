# -*- coding: utf-8 -*-
"""GT 对拍器（v0.13.2 bench P1-3）：评审报告 x GT 标准答案 → 召回/误报表，发版回归一步出表。

判分口径（与基准工作流约定一致，2026-11-02 定案）：
  真缺陷命中 = must_fix 行引用了该条 planted_line 且带终级——A/B 均算命中；
  期望 sev 只是参考列（GT 是随机案例夹具不是公理，终级分歧不判 FAIL）；
  阴性对照误报 = control 条目被 must_fix 立案且终级 A。
判定实现：must_fix 行形如 "3. C3(A)+C5：考卷L28删…"——按 "L<planted_line>(?!\\d)" 负向前瞻
防 L13 误配 L138。
用法：python tests/gt_score.py <GT.json> <评审报告.md> [--min-recall 9] [--max-fp 0]
"""
import argparse, json, re, sys


def score(gt_path, report_path, min_recall=9, max_fp=0):
    gt = json.load(open(gt_path, encoding='utf-8'))
    rep_lines = open(report_path, encoding='utf-8').read().splitlines()
    mf = []
    for ln, line in enumerate(rep_lines, 1):
        m = re.match(r'\s*\d+\.\s+([CG][\w-]+)\(([ABC])\)', line)  # 首簇 C/G 打头均可（代码评审 P3-2）
        if m:
            mf.append((ln, m.group(1), m.group(2), line))
    rows, hits, ctrl_a = [], 0, 0
    for g in gt:
        planted = g.get('planted_lines') or [g['anchor_line']]
        tier, cluster, ev = '-', '-', '-'
        for ln, cl, t, text in mf:
            if any(re.search(r'L%d(?!\d)' % p, text) for p in planted):
                tier, cluster, ev = t, cl, 'must_fix L%d' % ln
                break
        ctrl = g.get('cls') == 'control'
        if ctrl and tier == 'A':
            ctrl_a += 1
        if not ctrl and tier != '-':
            hits += 1
        verdict = ('FP-A' if ctrl and tier == 'A'
                   else 'hit' if not ctrl and tier != '-'
                   else 'reported-B+' if ctrl and tier != '-'
                   else 'miss')
        rows.append({'id': g['id'], 'verdict': verdict, 'tier': tier, 'cluster': cluster,
                     'expected_sev_ref': g.get('sev') or '-', 'evidence': ev})
    reals = [g for g in gt if g.get('cls') != 'control']
    ctrls = [g for g in gt if g.get('cls') == 'control']
    ok = hits >= min_recall and ctrl_a <= max_fp
    return {'rows': rows, 'recall': '%d/%d' % (hits, len(reals)),
            'ctrl_a_fp': '%d/%d' % (ctrl_a, len(ctrls)), 'pass': ok}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('gt')
    ap.add_argument('report')
    ap.add_argument('--min-recall', type=int, default=9)
    ap.add_argument('--max-fp', type=int, default=0)
    a = ap.parse_args()
    r = score(a.gt, a.report, a.min_recall, a.max_fp)
    print('| id | 判定 | 终级 | 期望sev(参考) | 簇 | 证据 |')
    print('|---|---|---|---|---|---|')
    for row in r['rows']:
        print('| %(id)s | %(verdict)s | %(tier)s | %(expected_sev_ref)s | %(cluster)s | %(evidence)s |' % row)
    print('召回 %s（线 ≥%d）；阴性 A 级误报 %s（线 ≤%d）→ %s'
          % (r['recall'], a.min_recall, r['ctrl_a_fp'], a.max_fp, 'PASS' if r['pass'] else 'FAIL'))
    sys.exit(0 if r['pass'] else 1)


if __name__ == '__main__':
    main()
