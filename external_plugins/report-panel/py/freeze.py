# -*- coding: utf-8 -*-
"""对外文件清单 + 冻结哈希（纯函数层，v0.13.0 严格模式 workflow 织入——0.12.2 批机制
从轻量 skill/panel-recheck 扩展到编排层）。

两类结构性失效的对账根治（0.12.2 设计定案）：
  覆盖缺口——主报告改对而配套件（README/摘要页/PPT/数据附表）残留旧值，评审只审主报告全绿照样出错件；
  评审中改稿——评审进行中作者改动被评审文件，意见与稿子版本错位，被误读为"评审员看错"。

build_manifest(report_path)：扫描报告同目录顶层候选对外件（扩展名白名单），逐件 SHA-256，
  连同主报告自身哈希一起冻结。编排层把清单落盘 materials/external_files.json（唯一事实源），
  席位 prompt 注入名单（配套件=跨件一致性重点）。
verify_manifest(report_path, manifest)：重算哈希对表——任一变更/缺失即返回 ok=False。
  编排层在终审前与落盘前各校验一次；失配即按冻结契约作废本跑（评审中改稿=程序问题）。

历史评审产物（评审报告_*/过程台账_*）不入清单——上一轮输出与本跑意见无涉，冻结它们只会
制造"作者删旧报告=作废"的假阳性。materials 目录、隐藏文件、panel_ledger 同理排除。
"""
import hashlib
import os

FREEZE_EXTS = ('.md', '.txt', '.pdf', '.pptx', '.docx', '.xlsx', '.xls',
               '.csv', '.html', '.htm', '.json')
FREEZE_EXCLUDE_PREFIX = ('评审报告_', '过程台账_')
FREEZE_MAX_FILES = 64  # 软上限：防报告目录被无关大目录污染；超限截断并在结果标 truncated


def _sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(chunk), b''):
            h.update(b)
    return h.hexdigest()


def _is_candidate(name, report_name, exclude_prefixes=()):
    if name.startswith('.') or name == report_name:
        return False
    if name.startswith(FREEZE_EXCLUDE_PREFIX):
        return False
    # v0.13.2（bench P0-2）：调用方排除前缀——同目录扫描此前零门槛（v0.13.1 实跑把仅供
    # 人工对照的底稿收编成 externals，评审被静默"开卷"）。排除件不进 manifest，
    # verify 按 manifest 对表，天然对称（排除件无冻结校验义务）。
    # 代码评审 P2-2 根治：滤空串（('',) 恒 True 会静默清空整张清单）；裸 str 由
    # build_manifest 入口按整串处理（tuple('底稿_') 拆单字匹配是静默错）。
    _excl = tuple(p for p in exclude_prefixes if p)
    if _excl and name.startswith(_excl):
        return False
    if name.endswith('.panel_ledger.json'):
        return False
    return name.lower().endswith(FREEZE_EXTS)


def build_manifest(report_path, exclude_prefixes=()):
    """冻结清单（纯读）：主报告 + 同目录顶层候选对外件，逐件 {name, sha256, bytes}。
    exclude_prefixes：调用方按文件名前缀排除（如 ('底稿_',)）——不入清单即不入冻结圈；
    裸字符串按整串前缀处理，空串项静默忽略。
    返回 {dir, truncated, report:{name,sha256,bytes}, externals:[...]}；dir 为绝对路径，
    verify 据此定位（与会话 cwd 解耦——cwd 陷阱的既有教训）。"""
    if isinstance(exclude_prefixes, str):
        exclude_prefixes = (exclude_prefixes,)
    d = os.path.dirname(os.path.abspath(report_path)) or '.'
    rname = os.path.basename(report_path)

    def ent(p):
        return {'name': os.path.basename(p), 'sha256': _sha256(p), 'bytes': os.path.getsize(p)}

    cands = sorted(f for f in os.listdir(d)
                   if _is_candidate(f, rname, exclude_prefixes) and os.path.isfile(os.path.join(d, f)))
    truncated = len(cands) > FREEZE_MAX_FILES
    return {'dir': d, 'truncated': truncated,
            'report': ent(report_path),
            'externals': [ent(os.path.join(d, f)) for f in cands[:FREEZE_MAX_FILES]]}


def verify_manifest(report_path, manifest):
    """冻结校验（纯读）：重算主报告与清单各件 SHA-256 并对表。
    返回 {ok, changed:[{name,old,new}], missing:[name]}——ok=False 即评审中改稿/删件。"""
    # v0.13.0 盲评修复：dir 缺失或已失效（目录整体搬迁）一律回退报告所在目录——
    # 否则对外件全体假报 missing，与"评审中删件"不可区分
    d = manifest.get('dir') or ''
    if not os.path.isdir(d):
        d = os.path.dirname(os.path.abspath(report_path))
    changed, missing = [], []

    def chk(name, old, p):
        if not os.path.isfile(p):
            missing.append(name)
            return
        new = _sha256(p)
        if new != old:
            changed.append({'name': name, 'old': old, 'new': new})

    chk(os.path.basename(report_path), manifest['report']['sha256'], report_path)
    for e in manifest.get('externals', []):
        chk(e['name'], e['sha256'], os.path.join(d, e['name']))
    return {'ok': not changed and not missing, 'changed': changed, 'missing': missing}
