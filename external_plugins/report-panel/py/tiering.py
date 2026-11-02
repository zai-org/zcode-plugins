# -*- coding: utf-8 -*-
"""v0.8.1（A1）判级对账门（纯函数，零 I/O）。

JUDGE_RULES 可机检规则的确定性执行——仲裁规则明言"违反即无效"，本模块把无效落实为
自动封顶 + 违规记录 + A类数收敛归因账（每步差值可归因：盲评A→簇A→法官A→对账后A）。

规则（与 workflow JUDGE_RULES 同源；两处不做机械同步门，靠 L0 现实锚定用例绑定语义）：
  R-quote     : 簇成员意见全无 location/quote → 终级至多 C（仲裁硬规则1：无定位意见至多 C）
  R-ghost     : 簇成员 id 全部失配或为空（聚合幻觉簇）→ 终级至多 C——无真实成员意见可取证，
                等价于全员无 location/quote 的极端形；v0.9.1 只堵了法官幻影条目（judge_a
                只计真实簇），本规则补对称面（审计 A2，2026-09-29）
  R-recalc    : 簇含数字主张且无"无降级证据"（attached 调查 verdict∈{维持,升级} 且
                label∈{已验证,复算不符}）→ 终级至多 B（硬规则2：数字主张未经复算至多 B）
                v0.12 例外：法官 final_tier 的 note 含【复算:算式】（显式标记+算术符+数字）
                视作复算级证据——考卷v3 C18 案（法官亲算 6649 亿仍被封 B）的制度化解法
  R-jitem     : 法官新增意见（J 系列）含数字主张且未经后核级证据 → 至多 B（硬规则2对 J 系列的延伸）
  R-quote-jitem: J 系列缺 location/quote → 至多 C（硬规则1对 J 系列的延伸——此前确定性
                执行只覆盖簇成员侧，非数字无引的 A 级 J 意见不受任何封顶；审计 B2，2026-09-29）
  R-junverified: v0.12——后核 slice(0,4) 之外的 J 意见（无 stub 无后核）A/B → B
  R-jhallu    : v0.12.1——后核 label∈{幻觉,引用有误} 的 J 意见 → 至多 C（横幅
                "已降级或撤回"对非数字项此前是空话；两审核员独立发现一致性最强）
                （代码审 P2：第 5 条起非逐字引文 J 意见零核验即可 A 级出稿）

v0.12 成员解析：精确匹配优先、strip 前缀兜底——裸 id 撞号根治（R1-F1 vs R2-F1 strip 后
Map 键覆盖，调查简报/证据绑定错成员；编排层现在传带 R{i}- 前缀的唯一 id，旧格式仍兼容）。

"含数字主张"判据：quote 含数字 ∪ id 属 X/XP/XS 确定性系列 ∪ 簇 dims 含'数字'。
设计红线：**不得封堵合法升级**——调查结论为 已验证/复算不符+维持/升级 的簇，A 级放行
（v0.8.0 验收实证：C3 调查B→终审升A、C5 复算升A，两例均须过门不拦）。
"""
import re

_NUM = re.compile(r'\d')
_CN_QUANT = re.compile(r'[一二三四五六七八九十百]{1,3}\s*(成|折|倍)|过半|一半')  # 中文数量主张（九成/三折/两倍）
_SCRIPT_ID = re.compile(r'^X[PS]?S?\d')  # X/XP/XS 确定性数字疑点系列


def strip_reviewer(mid):
    """成员 id 去评审员前缀（R1-F2 → F2），与编排层 member_ids 约定一致。"""
    return re.sub(r'^R\d+-', '', str(mid))


def is_numeric_claim(item):
    """含数字主张：quote（原文摘录）含数字（阿拉伯或中文量词），或 X/XP/XS 确定性系列 id。

    v0.9.0（P0②）：不查 problem 字段——那是检测器自述文本（XH 模板含"±40行"字样），
    会把全部 XH 发现误判为数字主张（红队 09-29 抓获，实测复现）。数字性以作者原文为准。"""
    v = item.get('quote')
    if v and (_NUM.search(str(v)) or _CN_QUANT.search(str(v))):
        return True
    return bool(_SCRIPT_ID.match(str(item.get('id', ''))))


def no_downgrade_evidence(inv):
    """无降级证据（枚举判据，v0.8.0 任务书修订定案）：调查存在且 verdict∈{维持,升级} 且 label∈{已验证,复算不符}。"""
    return inv is not None and inv.get('verdict') in ('维持', '升级') and inv.get('label') in ('已验证', '复算不符')


_RECALC_MARK = re.compile(r'【复算[^】]*[+\-×÷*/=≈±][^】]*\d|【复算[^】]*\d[^】]*[+\-×÷*/=≈±±]')


def judge_recalc_note(ft):
    """v0.12（考卷v3 C18 案）：法官 final_tier 的 note 含【复算…】显式标记且带算术符/数字
    ——视作复算级证据（法官亲算入账；对账门认标记不认空口，防"写了复算二字"白条）。"""
    if not ft:
        return False
    note = str(ft.get('note') or '')
    return '【复算' in note and bool(_RECALC_MARK.search(note))


def _cluster_numeric(cluster, members):
    if '数字' in (cluster.get('dims') or []):
        return True
    return any(is_numeric_claim(m) for m in members)


def reconcile(clusters, findings, investigations, final_tiers):
    """对账门主体（纯）。

    参数：
      clusters        聚合员输出簇列表（member_ids 带评审员前缀）
      findings        全部原始 findings（盲评 + 确定性席）
      investigations  调查结论列表（target=簇id/GAP-/XH/J-id）
      final_tiers     法官结构化定级 [{id, tier, note?}]；缺该簇时按簇 severity 起算
    返回 {tiers: {簇id: 生效级}, caps: [{rule,id,from_tier,to_tier,reason}],
          ledger: {blind_a,cluster_a,judge_a,final_a, 步差归因...}}
    """
    f_by_id = {str(f.get('id')): f for f in findings}
    inv_by_target = {str(i.get('target')): i for i in investigations}
    ft_by_id = {str(t.get('id')): t for t in (final_tiers or [])}
    # v0.12（裸 id 撞号根治）：成员解析精确匹配优先、strip 前缀兜底——编排层传带 R{i}-
    # 前缀的唯一 id 时不再丢前缀查裸表（旧格式 member_ids 仍走 strip 兜底，行为兼容）
    def _resolve(mid):
        m = str(mid)
        return f_by_id.get(m) if m in f_by_id else f_by_id.get(strip_reviewer(m))
    tiers, caps = {}, []
    for c in clusters:
        cid = str(c.get('id'))
        ft = ft_by_id.get(cid)
        tier = str(ft['tier']) if ft and ft.get('tier') else str(c.get('severity', 'B'))
        members = [_resolve(m) for m in c.get('member_ids', [])]
        members = [m for m in members if m is not None]
        # R-ghost（审计 A2）：成员 id 全部失配或为空（聚合幻觉簇）——无真实成员意见可取证，
        # 封 C。此前 members 为空时 R-quote 的 `members and all(...)` 首条件短路、R-recalc 只剩
        # dims 一条路，无 dims 的幽灵簇 A 级原样通过——对账门对聚合员幻觉存在结构性缺口
        #（与 v0.9.1 修的"法官幻影条目"对称）。C-ORPHAN（裸 id 成员）不受影响：其 id 在 f_by_id。
        if not members and tier in ('A', 'B'):
            caps.append(dict(rule='R-ghost', id=cid, from_tier=tier, to_tier='C',
                             reason='簇成员 id 全部无法解析（聚合幻觉簇），无真实意见支撑'))
            tier = 'C'
        # R-quote：全员无 location/quote → 至多 C
        if members and all((not m.get('location')) or (not m.get('quote')) for m in members) and tier in ('A', 'B'):
            caps.append(dict(rule='R-quote', id=cid, from_tier=tier, to_tier='C',
                             reason='簇成员全部无 location/quote'))
            tier = 'C'
        # R-recalc：数字主张无复算级证据 → 至多 B
        # v0.9.0（P0①）：证据解析扩展到成员 finding id——XH*/GAP-*/J* 直通调查的 target 是
        # finding id 而非簇 id（红队 09-29 抓的键断裂：XH 调查已维持 A、簇却因按簇 id 查不到
        # 证据被误封 B，实测复现）。任一成员携带无降级证据即视为簇有证据。
        member_evidence = any(no_downgrade_evidence(inv_by_target.get(str(m)) if str(m) in inv_by_target else inv_by_target.get(strip_reviewer(m)))
                              for m in c.get('member_ids', []))
        # v0.12：法官亲算入账——note 带显式【复算:算式】标记即视作复算级证据（C18 案）
        judge_recalc = judge_recalc_note(ft)
        if tier == 'A' and _cluster_numeric(c, members) and not (no_downgrade_evidence(inv_by_target.get(cid)) or member_evidence or judge_recalc):
            caps.append(dict(rule='R-recalc', id=cid, from_tier='A', to_tier='B',
                             reason='含数字主张且无复算级调查证据（verdict∈{维持,升级}∧label∈{已验证,复算不符}），标记【待复算】'))
            tier = 'B'
        tiers[cid] = tier
    # A类数收敛归因账
    blind_a = sum(1 for f in findings if str(f.get('severity')) == 'A')
    cluster_a = sum(1 for c in clusters if str(c.get('severity')) == 'A')
    # v0.9.1：judge_a 只计真实簇 id 的 final_tiers——法官幻影条目（给不存在簇的定级，
    # R6 跑实测 11→8 封顶却 0 条的账务矛盾根源）不再抬高收敛账
    real_ids = {str(c.get('id')) for c in clusters}
    judge_a = sum(1 for t in (final_tiers or []) if str(t.get('tier')) == 'A' and str(t.get('id')) in real_ids)
    final_a = sum(1 for v in tiers.values() if v == 'A')
    ledger = dict(blind_a=blind_a, cluster_a=cluster_a, judge_a=judge_a, final_a=final_a,
                  blind_to_cluster=('聚类合并去重 -%d' % (blind_a - cluster_a)) if blind_a >= cluster_a else ('聚类分裂 +%d' % (cluster_a - blind_a)),
                  cluster_to_judge='法官定级 降%d/升%d' % (max(0, cluster_a - judge_a), max(0, judge_a - cluster_a)),
                  judge_to_final='对账封顶拦 %d' % max(0, judge_a - final_a))
    return dict(tiers=tiers, caps=caps, ledger=ledger)


def reconcile_new_items(new_items, investigations, unverified_ids=None):
    """R-jitem：法官新增意见（J 系列）含数字主张且无后核级证据 → 至多 B。

    v0.12 增 unverified_ids：后核 slice(0,4) 之外、无 quote-grep stub 亦无后核调查的
    J 意见 id 列表——R-junverified 规则 A/B → B（防"排序第 5+ 零核验 A 级出稿"）。
    返回 {tiers: {J-id: 生效级}, caps: [...]}；后核结论 target=J-id 进 investigations。
    """
    inv_by_target = {str(i.get('target')): i for i in investigations}
    unv = {str(x) for x in (unverified_ids or [])}
    tiers, caps = {}, []
    for f in new_items:
        jid = str(f.get('id'))
        tier = str(f.get('severity', 'C'))
        # R-quote-jitem（审计 B2）：硬规则1"无 location/quote 至多 C"对 J 系列的延伸。
        # 此前只实现 R-jitem（数字封 B），非数字无引的 A 级 J 意见不受任何确定性封顶。
        if tier in ('A', 'B') and (not f.get('location') or not f.get('quote')):
            caps.append(dict(rule='R-quote-jitem', id=jid, from_tier=tier, to_tier='C',
                             reason='法官新增意见缺 location/quote（仲裁硬规则1）'))
            tier = 'C'
        # R-jhallu（v0.12.1 审计 B1）：后核判幻觉/引用有误 → 至多 C——横幅降级承诺落地
        _inv_j = inv_by_target.get(jid)
        if tier in ('A', 'B') and _inv_j is not None and _inv_j.get('label') in ('幻觉', '引用有误'):
            caps.append(dict(rule='R-jhallu', id=jid, from_tier=tier, to_tier='C',
                             reason='后核判 %s——降级承诺兑现（非数字项此前无确定性降级路径）' % _inv_j.get('label')))
            tier = 'C'
        # R-junverified（v0.12）：后核配额之外且无任何核验证据 → 至多 B（quote-grep stub
        # 与后核调查都在 investigations，未命中=真零核验）
        if tier in ('A', 'B') and jid in unv and not no_downgrade_evidence(inv_by_target.get(jid)):
            caps.append(dict(rule='R-junverified', id=jid, from_tier=tier, to_tier='B',
                             reason='后核配额外且无 stub/后核证据（slice(0,4) 之外的 J 意见）'))
            tier = 'B'
        if tier == 'A' and is_numeric_claim(f) and not no_downgrade_evidence(inv_by_target.get(jid)):
            caps.append(dict(rule='R-jitem', id=jid, from_tier='A', to_tier='B',
                             reason='法官新增数字意见未经后核级证据，标记【待复算】'))
            tier = 'B'
        tiers[jid] = tier
    return dict(tiers=tiers, caps=caps)
