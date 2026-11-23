"""T18: continue an authorized human-face brief with a declared tentative treatment."""
from __future__ import annotations

import re

STYLE_LABEL = "写实质感的风格化人物"
STYLE_PRESET = STYLE_LABEL + "，风格化非写实面部，电影级CG渲染与PBR材质，真实光照和衣料纹理，非真人脸"
TENTATIVE_NOTE = ("暂定：按已有继续授权，将写实真人脸需求降级为写实质感的风格化人物，"
                  "保留写实材质与光照，面部采用风格化非写实处理。")
BLOCKER_NOTE = "T18 blocker：用户题目明确坚持写实真人脸，当前生成链不能可靠满足；保留需求并记录 blocker。"


def _affirmative(pattern, text):
    for match in re.finditer(pattern, text, re.IGNORECASE):
        before = text[max(0, match.start() - 24):match.start()]
        if not re.search(r"(?:不(?:要|必|用|需|是|再|接受|坚持)?|无需|无须|并非|"
                         r"\bnot|\bno|\bdo not|\bdon't)\s*$", before, re.IGNORECASE):
            return True
    return False


def user_insists_on_real_humans(data):
    """Read insistence from the original user brief, never from a generic style marker."""
    if data.get("insist_photoreal_humans") is True:
        return True
    brief = str(data.get("user_brief") or "")
    human = r"写实(?:的)?真人(?:脸)?|真人(?:脸|人脸)?|照片级(?:的)?(?:人物|人脸)|实拍(?:真人|演员)|真实(?:的)?人脸"
    english = r"photoreal(?:istic)?(?: humans?| human faces?| faces?)|real human faces?|real actors?|live[- ]action (?:humans?|actors?|people)"
    for clause in re.split(r"[，,。.;；\n!?！？]", brief):
        if _affirmative(rf"(?:坚持|必须|一定要|务必|只接受|仅接受|只能用)\s*"
                        rf"(?:要|是|用|采用|使用|拍成|拍摄|保持|保留)?\s*(?:{human})", clause):
            return True
        if _affirmative(rf"(?:insist(?: on)?|must(?: use| be| remain| have)?|only accept|require)\s+(?:{english})", clause):
            return True
        if _affirmative(rf"(?:{english})\s+(?:only|(?:is|are) mandatory)", clause):
            return True
    if _affirmative(rf"{human}|{english}", brief):
        return _affirmative(r"(?:不接受|拒绝|不能用|不允许|不要)\s*(?:动画|风格化|卡通|三维|二维)|"
                            r"(?:no|do not accept|reject)\s+(?:stylized|stylised|animated|animation|cartoon)", brief)
    return False


def resolve_human_style(data):
    """Return an effective plan, blockers and reminders; missing authorization adds no blocker."""
    from .creation_media import photoreal_hits
    current = str(data.get("style_preset") or "")
    resolution = data.get("style_resolution")
    resolution = resolution if isinstance(resolution, dict) else {}
    continuing = resolution.get("status") == "暂定" and current == resolution.get("style_preset")
    requested = str(resolution.get("requested_style") or current) if continuing else current
    brief = str(data.get("user_brief") or "")
    insists = user_insists_on_real_humans(data)
    cast = [c for c in data.get("cast") or [] if isinstance(c, dict)]
    humans = (any(str(c.get("kind") or "").lower() not in ("creature", "object") for c in cast)
              or insists or (not cast and _affirmative(r"真人|人脸|人类|\bhuman(?:s| faces?)?\b|real actors?", brief + current)))
    if not humans or not (photoreal_hits(requested) or (photoreal_hits(brief) and humans) or insists):
        return data, [], []
    notes = data.get("delivery_notes")
    notes = list(notes) if isinstance(notes, list) else [notes] if isinstance(notes, str) else []
    if insists:
        result = dict(data, style_resolution={"status": "blocker", "requested_style": requested,
                                             "effective_style": None, "delivery_note": BLOCKER_NOTE},
                      delivery_notes=[n for n in notes if n != TENTATIVE_NOTE])
        return result, [BLOCKER_NOTE], []
    if data.get("continue_authorized") is not True:
        return data, [], ["T18 写实人脸需求未标已有继续授权；从会话已有授权填写 continue_authorized:true 后采用暂定降级 "
                          "(advisory；缺标记不新增 blocker)"]
    if TENTATIVE_NOTE not in notes:
        notes.append(TENTATIVE_NOTE)
    result = dict(data, style_preset=STYLE_PRESET,
                  style_resolution={"status": "暂定", "requested_style": requested,
                                    "effective_style": STYLE_LABEL, "style_preset": STYLE_PRESET,
                                    "delivery_note": TENTATIVE_NOTE}, delivery_notes=notes)
    return (data if result == data else result), [], [TENTATIVE_NOTE + " (advisory；继续执行，不反问)"]


def delivery_fields(plan):
    resolution = plan.get("style_resolution")
    if not isinstance(resolution, dict):
        return {}
    notes = plan.get("delivery_notes")
    notes = list(notes) if isinstance(notes, list) else []
    if resolution.get("delivery_note") and resolution["delivery_note"] not in notes:
        notes.append(resolution["delivery_note"])
    return {"style_preset": plan.get("style_preset"), "style_resolution": resolution, "delivery_notes": notes}


def annotate_result(result, plan):
    result.data.update(delivery_fields(plan))
    resolution = plan.get("style_resolution")
    if isinstance(resolution, dict) and resolution.get("status") == "暂定":
        result.text += "\n" + TENTATIVE_NOTE
    return result
