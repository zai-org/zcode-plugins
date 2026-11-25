"""R2 event adaptation, review records and soft role boundaries; no workflow gates."""
from __future__ import annotations
import contextlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'mcp'))
from ve_tools import file_lock
from hook_common import read_stdin_json, project_dir, deny, feedback, shell_write_targets, _codex_short_name, harness
from record_capture_error import observe
import c2v_guard

PLUGIN = Path(__file__).resolve().parents[2]
CAPTURE_TOOLS = frozenset({'mcp__runtime__browser_capture',
                           'mcp__plugin_video_agent_kit_runtime__browser_capture',
                           'mcp__plugin_video-agent-kit_runtime__browser_capture'})
# ZCode's built-in browser (Browser Use) is driven through the node_repl js tool.
BROWSER_TOOLS = frozenset({'mcp__node_repl__js'})
# Independent review roles. v2c-verifier compares a web build against a recording and may use the
# browser-capture tools or the built-in browser; c2v-reviewer only reads rendered images and
# c2v-3d-reviewer only a motion recording it samples itself (tools: Read, Bash), neither gets any
# MCP. All are boundary-restricted to out/reviews/ and may not delegate.
REVIEW_ROLES = frozenset({'v2c-verifier', 'c2v-reviewer', 'c2v-3d-reviewer'})
# Reviewer turn budget (c2v-3d-reviewer.md: "审查预算50轮"). The 2026-11-06/07 opus runs spent 117 and
# ~160 tool turns on one review without writing a line, then the shared logical-call cap ended the
# task. On the turn before the budget the hook feeds the reviewer a reminder: next turn is the report.
REVIEW_TURN_BUDGET = int(os.environ.get('V2C_REVIEW_TURN_BUDGET') or 50)
REVIEW_BUDGET_REMINDER = ('{used} of the {budget} review turns are used. The next turn must be the review report itself '
                          '(the list of problems in the reply format, with every shot you did not get to marked '
                          '"not reviewed"); do not call any more tools.')
EVENTS_SCHEMA = 1
# Path characters only: a Chinese workorder puts the path right after a label (录像路径：/workspace/out/…),
# so a \S* prefix would swallow the label.
_PATH = r'[A-Za-z0-9_.\-/]'
_IMG_REF_RE = re.compile(r'(?:/' + _PATH + r'*?)?out/' + _PATH + r'+?\.(?:png|jpg|jpeg|webp)', re.IGNORECASE)
_VIDEO_REF_RE = re.compile(r'(?:/' + _PATH + r'*?)?out/' + _PATH + r'+?\.(?:mp4|mov|webm|mkv)', re.IGNORECASE)


def _agent_model() -> str:
    """The model this agent runs on (pipeline-exported V2C_MODEL), lower-cased; '' when unknown."""
    return (os.environ.get('V2C_MODEL') or '').strip().lower()


def _image_refs(prompt: str, pattern=_IMG_REF_RE) -> list[str]:
    """The out/… image (or, with _VIDEO_REF_RE, recording) paths a c2v review workorder points
    at — the review's subject, the c2v analogue of a v2c build_id. Deduplicated,
    order-preserving, capped."""
    seen: list[str] = []
    for m in pattern.findall(prompt or ''):
        if m not in seen:
            seen.append(m)
    return seen[:64]


def parse_json(value):
    if isinstance(value, str):
        try: return json.loads(value)
        except ValueError: return {}
    return value if isinstance(value, dict) else {}


def _event_id(data):
    """Dedup key from a host-provided id when present; else generated and flagged."""
    raw = data.get('_raw') or {}
    for src, val in (('call_id', raw.get('call_id') or data.get('tool_call_id')),
                     ('turn_id', data.get('turn_id')), ('raw_id', raw.get('id'))):
        if val:
            return str(val), src
    return uuid.uuid4().hex, 'generated'


def _emit(state, rec):
    """Append one complete feedback event (append-only; reviews.json stays a
    rebuildable summary). Only evidence-backed fields are written; a generated id
    is flagged relation_uncertain so a replay never merges two requests by content."""
    eid, src = _event_id(rec.pop('_data'))
    line = {'schema': EVENTS_SCHEMA, 'event_id': eid, 'id_source': src,
            'time': time.time(), **{k: v for k, v in rec.items() if v is not None}}
    if src == 'generated':
        line['relation_uncertain'] = True
    with (state / 'reviews_events.jsonl').open('a') as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + '\n')


def _record_response(review, resp, *, build_id=None):
    """Append a returned feedback to the review's history; never overwrite earlier
    responses. ``response`` keeps the latest for existing consumers."""
    if resp is None:
        return
    entry = {'at': time.time(), 'response': resp}
    if build_id:
        entry['build_id'] = build_id
    review.setdefault('responses', []).append(entry)
    review['response'] = resp
    review['finished_at'] = entry['at']


def event(data, project):
    state = project/'.v2c'
    state.mkdir(parents=True, exist_ok=True)
    (state/'plugin_root').write_text(str(PLUGIN))
    with (state/'reviews.lock').open('a') as lock:
        file_lock.flock(lock, file_lock.LOCK_EX)
        path=state/'reviews.json'
        reviews=json.loads(path.read_text()) if path.exists() else {}
        result=handle(data,project,reviews)
        temp=path.with_suffix('.tmp');temp.write_text(json.dumps(reviews,ensure_ascii=False,indent=2));os.replace(temp,path)
        return result


def handle(data, project, reviews):
    state=project/'.v2c'
    ev=data.get('hook_event_name','')
    tool=data.get('tool_name','')
    raw=_codex_short_name((data.get('_raw') or {}).get('tool_name',tool))
    ti=data.get('tool_input') or {}
    response=parse_json(data.get('tool_response'))
    aid=str(data.get('agent_id') or '')
    role=str(data.get('agent_type') or reviews.get(aid,{}).get('role') or '')
    role_name=role.rsplit(':',1)[-1]
    is_review=role_name in REVIEW_ROLES
    verifier=role_name=='v2c-verifier'
    code2video_mode=(project/'.v2c/code2video.enabled').is_file() and not (project/'.v2c/replicate.enabled').is_file()
    if ev=='SessionStart':
        (project/'.v2c/plugin_root').write_text(str(PLUGIN))
        if code2video_mode:
            ctx=(f'code2video skill: {PLUGIN}/skills/code2video/SKILL.md (read the reference its dispatch table names). Implement the animation in code and render it; write the final film to out/final.mp4.'
                 ' Generation services (image generation, speech synthesis, 3D generation) are called only through their MCP tools: do not read or print environment variables and do not request the service addresses directly.')
        else:
            ctx=f'video2code skill: {PLUGIN}/skills/video2code/SKILL.md; references are read as needed. Preview/capture require an available task-managed service.'
        # 效率提示分两半 (harness() 由 V2C_AGENT 定; 模型名由管线经 V2C_MODEL 下发):
        # 1) 合并并行调用、整文件写入 —— 对所有会话都有效 (2026-11-06 opus 跑批没收到
        #    这句, 97% 的轮次只发一个工具调用, 轮次是 fable 的 4 倍);
        # 2) 少派子代理 —— 来自 video2code 的 gpt E2E 观察, 与 code2video 的看图子代理方向相反,
        #    只给 gpt-* 模型。只在 SessionStart 上下文里建议, 不硬拦。
        if harness()=='cc':
            ctx+=(' Efficiency: issue independent reads and edits together in one turn (several tool calls in parallel),'
                  ' and write a file whole when it can be written in one go instead of many small edits.')
            if _agent_model().startswith('gpt-'):
                ctx+=(' Implement the scenes one after another in the main thread and delegate to few sub-agents'
                      ' (parallel sub-agents each repeat the reading and coordination, multiplying calls without a gain in quality).')
        return {'context':ctx}
    if ev=='PreToolUse' and code2video_mode:
        # Every role, the main agent included: credential reads / direct service calls (see c2v_guard).
        verdict=c2v_guard.check(tool,ti,project)
        if verdict:
            return {'deny':verdict}
    if ev=='PreToolUse' and is_review:
        # c2v-reviewer has no MCP at all; v2c-verifier may use the browser-capture tools or the built-in browser only.
        mcp_ok = verifier and (tool in CAPTURE_TOOLS or tool in BROWSER_TOOLS)
        if tool=='Agent' or (tool.startswith('mcp__') and not mcp_ok):
            return {'deny':'This review can inspect its subject, not publish or delegate.'}
        paths=list(ti.get('file_paths') or [])
        if tool in ('Write','Edit') and ti.get('file_path'): paths.append(ti['file_path'])
        if tool=='Bash': paths.extend(shell_write_targets(str(ti.get('command') or '')))
        allowed=[(project/'out/reviews').resolve(),(project/'out/obs').resolve()]
        for value in paths:
            p=Path(value);p=(p if p.is_absolute() else project/p).resolve()
            if not any(p.is_relative_to(d) for d in allowed):
                return {'deny':'Write review scripts/evidence under out/reviews/ (source samples may use out/obs/); keep the application and frozen build unchanged.'}
    if ev=='PostToolUse':
        observe(data,project)
        # A typed capture request naming an existing frozen build identifies the
        # review target even when its free-form workorder omitted the URL.
        if tool in CAPTURE_TOOLS and aid in reviews:
            bid = ti.get('build_id')
            manifest = project/'.v2c/runtime/builds.json'
            builds = json.loads(manifest.read_text()) if manifest.exists() else {}
            if bid and bid in builds:
                review = reviews[aid]
                targets = review.setdefault('capture_build_ids', [])
                if bid not in targets: targets.append(bid)
                if not review.get('build_id') and len(targets) == 1:
                    review.update(build_id=bid, build_binding_source='capture_request')
                elif review.get('build_id') != bid:
                    review['multiple_builds_requested'] = True
                # Request association is not capture success or visual approval.
        if raw=='spawn_agent' or (tool=='Agent' and raw in ('Agent','Task')):
            sub_name=str(ti.get('subagent_type') or '').rsplit(':',1)[-1]
            if sub_name in REVIEW_ROLES:
                rid=str(response.get('agent_id') or response.get('agentId') or uuid.uuid4().hex)
                prompt=str(ti.get('prompt') or '')
                build_id=None
                image_refs=None
                video_refs=None
                binding_source=None
                if sub_name=='v2c-verifier':
                    # A build whose URL appears in the free-form workorder binds the review.
                    manifest=project/'.v2c/runtime/builds.json'
                    if manifest.exists():
                        for bid,build in json.loads(manifest.read_text()).items():
                            if build.get('url') and build['url'] in prompt: build_id=bid
                    binding_source='workorder_url' if build_id else None
                else:
                    # c2v reviewers have no build; the subject is the rendered images / recordings given.
                    image_refs=_image_refs(prompt)
                    video_refs=_image_refs(prompt,_VIDEO_REF_RE)
                    binding_source=('workorder_images' if image_refs else
                                    'workorder_videos' if video_refs else None)
                directory=project/'out/reviews'/rid
                directory.mkdir(parents=True,exist_ok=True)
                spawned = raw=='spawn_agent'
                rec={'review_id':rid,'agent_id':rid,'role':sub_name,
                     'status':'running' if spawned else 'completed',
                     'live_status':'running' if spawned else 'completed',
                     'build_id':build_id,'work_dir':str(directory),'started_at':time.time(),
                     'responses':[],'response':None}
                if image_refs:
                    rec['image_refs']=image_refs
                if video_refs:
                    rec['video_refs']=video_refs
                reviews[rid]=rec
                if not spawned:
                    _record_response(reviews[rid], data.get('tool_response'), build_id=build_id)
                emit={'_data':data,'agent_id':rid,'type':'spawn','build_id':build_id,
                      'build_binding_source':binding_source}
                if image_refs:
                    emit['image_refs']=image_refs
                if video_refs:
                    emit['video_refs']=video_refs
                _emit(state,emit)
        elif raw=='wait_agent':
            for rid, status in (response.get('status') or {}).items():
                if rid not in reviews or not isinstance(status,dict): continue
                if 'completed' in status:
                    _record_response(reviews[rid], status['completed'])
                    reviews[rid].update(status='completed',live_status='completed')
                    _emit(state,{'_data':data,'agent_id':rid,'type':'response',
                                 'build_id':reviews[rid].get('build_id')})
                elif any(k in status for k in ('errored','not_found','shutdown')):
                    reviews[rid].update(status='failed',live_status='failed',error=status,finished_at=time.time())
                    _emit(state,{'_data':data,'agent_id':rid,'type':'failed'})
        elif raw in ('send_input','resume_agent'):
            rid=str(ti.get('target') or ti.get('id') or '')
            if rid in reviews:
                # Thread goes live again; prior returned responses are NOT cleared —
                # thread liveness and whether a feedback already returned are separate facts.
                reviews[rid].update(status='running',live_status='running')
                _emit(state,{'_data':data,'agent_id':rid,'type':'resumed'})
        elif raw=='close_agent':
            rid=str(ti.get('id') or ti.get('target') or '')
            if rid in reviews and reviews[rid].get('live_status',reviews[rid].get('status'))=='running':
                reviews[rid].update(status='interrupted',live_status='interrupted')
                _emit(state,{'_data':data,'agent_id':rid,'type':'closed'})
    if ev=='PostToolUse' and is_review and aid in reviews and tool!='Agent':
        rec=reviews[aid]
        rec['tool_calls']=int(rec.get('tool_calls') or 0)+1
        if rec['tool_calls']==REVIEW_TURN_BUDGET-1:
            rec['budget_reminded_at']=time.time()
            return {'feedback':REVIEW_BUDGET_REMINDER.format(budget=REVIEW_TURN_BUDGET,used=rec['tool_calls'])}
    if ev=='SubagentStart' and is_review and aid not in reviews:
        reviews[aid]={'review_id':aid,'agent_id':aid,'role':role_name,
                      'status':'running','live_status':'running','build_id':None,
                      'responses':[],'response':None}
    if ev=='SubagentStop' and aid in reviews:
        message=data.get('last_assistant_message')
        if message:
            _record_response(reviews[aid], message)
            reviews[aid].update(status='completed',live_status='completed')
            _emit(state,{'_data':data,'agent_id':aid,'type':'response',
                         'build_id':reviews[aid].get('build_id')})
    if ev=='Stop':
        with (project/'.v2c/stops.jsonl').open('a') as f:
            f.write(json.dumps({'agent_id':aid,'time':time.time(),'event':'generation_stopped'})+'\n')
    return {}


if __name__=='__main__':
    data=read_stdin_json(legacy_policy=False)
    result=event(data,project_dir())
    if result.get('deny'): deny(result['deny'])
    if result.get('feedback'): feedback(result['feedback'])
    if result.get('context'):
        print(json.dumps({'hookSpecificOutput':{'hookEventName':'SessionStart','additionalContext':result['context']}}))
