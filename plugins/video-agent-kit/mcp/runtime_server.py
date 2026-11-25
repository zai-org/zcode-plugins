"""runtime MCP server for webpage replication.

Always offers `deploy_website`: serve a built static site on a stable local URL, which the
agent then opens, screenshots and records with ZCode's built-in browser (`control-browser`
skill). The plugin starts no Playwright/Chromium of its own.

`preview_build` / `browser_capture` are the task-managed (harness) runtime's tools; they are
advertised only when that runtime's endpoint file exists in the workspace.
"""
from __future__ import annotations
import asyncio
import base64
import io
import json
import os
from pathlib import Path
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent

import runtime_deploy

server=Server('video2code-runtime')


def workspace() -> Path:
    return runtime_deploy.workspace()


def hosted_endpoint() -> Path:
    return workspace()/'.v2c/runtime/endpoint.json'


def runtime_call(op, args):
    endpoint=json.loads(hosted_endpoint().read_text())
    request=Request(endpoint['url'],data=json.dumps({'op':op,'args':args}).encode(),
                    headers={'Content-Type':'application/json','Authorization':'Bearer '+endpoint['token']})
    with urlopen(request,timeout=float(args.get('timeout_s',300))+30) as response:
        return json.load(response)


DEPLOY_TOOL=Tool(name='deploy_website',description='Serve a built static site (e.g. app/dist) on a stable local URL. The first call starts a local server; later calls keep the SAME URL and replace the content in place, so the browser tab only needs a reload. If app/src is newer than dist it runs `npm run build` first. Returns url, data-testid list and missing /assets/ images. Holds no browser: open/reload the URL with ZCode Browser Use (control-browser skill) for screenshots and recordings.',inputSchema={
    'type':'object','properties':{'local_dir':{'type':'string','description':'Built static directory containing index.html, workspace-relative or absolute (normally app/dist).'},'type':{'type':'string','enum':['static'],'description':'Site type; only static.'}},'required':['local_dir','type'],'additionalProperties':False})

HOSTED_TOOLS=[
    Tool(name='preview_build',description='Build and publish a frozen project version through the task-owned preview service (harness runtime only). A failed build keeps the previous preview.',inputSchema={
        'type':'object','properties':{'project_root':{'type':'string','description':'Project directory holding package.json, workspace-relative or absolute. Defaults to app/ when present, else the workspace root.'},'build_command':{'type':'string'},'output_dir':{'type':'string','description':'Static output directory to publish, resolved RELATIVE TO project_root (so "dist" means <project_root>/dist); absolute paths are used as-is. Omit to auto-detect dist/build/out under the project. On build_missing the error lists the paths searched.'},'timeout_s':{'type':'number','exclusiveMinimum':0}},'additionalProperties':False}),
    Tool(name='browser_capture',description='Capture a frozen build using the task browser (harness runtime only; under ZCode use the built-in browser instead). Optional script is a workspace Python FILE PATH (not source code); that file defines async run(page). Returns images/video paths, actual timing and errors; no visual grade.',inputSchema={
        'type':'object','properties':{'build_id':{'type':'string'},'kind':{'type':'string','enum':['screenshot','record']},
          'script':{'type':'string','description':'Path to an existing Python file inside the task workspace, absolute or workspace-relative. The file defines async run(page). Write the file with native tools first; do not pass Python source text.'},'duration':{'type':'number','minimum':0,'description':'Additional capture time in seconds AFTER the action script returns. Recording also includes the script execution.'},'interval':{'type':'number','exclusiveMinimum':0,'description':'For record: minimum spacing in video time between frames extracted after recording. For screenshot: delay between live screenshots.'},
          'viewport':{'type':'object','properties':{'width':{'type':'integer','minimum':1},'height':{'type':'integer','minimum':1}},'required':['width','height'],'additionalProperties':False},
          'full_page':{'type':'boolean'},'timeout_s':{'type':'number','exclusiveMinimum':0,'description':'Total operation budget, including browser startup, script, recording, close and extraction. Up to 5 seconds additional cleanup grace on timeout.'}},'additionalProperties':False})]


@server.list_tools()
async def list_tools():
    tools=[DEPLOY_TOOL]
    if hosted_endpoint().is_file():
        tools.extend(HOSTED_TOOLS)
    return tools


@server.call_tool()
async def call_tool(name, arguments):
    if name not in ('deploy_website','preview_build','browser_capture'): raise ValueError('unknown tool')
    arguments = arguments or {}
    if name == 'deploy_website':
        result=await asyncio.to_thread(runtime_deploy.deploy_website,arguments)
        return [TextContent(type='text',text=json.dumps(result,ensure_ascii=False))]
    script = arguments.get('script')
    if name == 'browser_capture' and script and ('\n' in script or '\r' in script):
        result={'status':'failed','capture_status':'not_started','visual_assessment_status':'unassessed',
                'error':{'kind':'invalid_script_path','message':'script expects a workspace file path, not Python source. Write a .py file defining async run(page), then pass its path.'}}
    else:
        try:
            result=await asyncio.to_thread(runtime_call,'build' if name=='preview_build' else 'capture',arguments)
        except Exception as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            if isinstance(reason, TimeoutError):
                kind = 'runtime_response_timeout'
                message = 'Timed out waiting for the runtime response; the operation may still be finishing. Inspect .v2c/runtime/capture-events and out/captures before retrying.'
            elif isinstance(exc, FileNotFoundError) or isinstance(reason, ConnectionRefusedError):
                kind = 'runtime_unavailable'
                message = ('Task runtime endpoint is missing or refused the connection. Without the task-managed runtime '
                           '(e.g. under ZCode), use deploy_website for a local URL and ZCode Browser Use '
                           '(control-browser skill) for screenshots and recordings.')
            else:
                kind = 'runtime_request_failed'
                message = 'The runtime request failed; this does not establish a visual defect.'
            result={'status':'failed','build_id':arguments.get('build_id'),
                    'visual_assessment_status':'unassessed',
                    'error':{'kind':kind,'message':message,'detail':f'{type(exc).__name__}: {exc}'}}
    content=[TextContent(type='text',text=json.dumps(result,ensure_ascii=False))]
    frames=result.get('frames') or []
    # Bounded inline preview, preserving first/middle/last; full files remain readable.
    indexes=sorted({0,len(frames)//2,len(frames)-1}) if frames else []
    for index in indexes:
        from PIL import Image
        try:
            path=Path(frames[index]['path'])
            if not path.resolve().is_relative_to(workspace()): continue
            with Image.open(path) as im:
                im=im.convert('RGB');im.thumbnail((1280,1280))
                data=io.BytesIO();im.save(data,format='JPEG',quality=85)
            content.append(ImageContent(type='image',mimeType='image/jpeg',data=base64.b64encode(data.getvalue()).decode()))
        except (OSError,ValueError): continue
    return content


async def main():
    try:
        async with stdio_server() as (read,write):
            await server.run(read,write,server.create_initialization_options())
    finally:
        runtime_deploy.stop_all()


if __name__=='__main__': asyncio.run(main())
