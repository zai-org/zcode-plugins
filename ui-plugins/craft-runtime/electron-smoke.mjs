// Optional integration check against an existing ZCode source checkout. No user profile is used.
import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.ZCODE_SOURCE_ROOT) throw new Error("Set ZCODE_SOURCE_ROOT to an existing ZCode checkout");
const zcode = resolve(process.env.ZCODE_SOURCE_ROOT);
const output = join(root, ".craft-cache/electron-results");
await mkdir(join(output, "assets"), { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2) :
  (await readdir(join(root, "ui-plugins"))).filter((name) => name.endsWith("craft"));
const shared = join(zcode, "packages/shared");
const exports = JSON.parse(await readFile(join(shared, "package.json"), "utf8")).exports;
const alias = Object.fromEntries(Object.entries(exports).map(([key, value]) => [
  key === "." ? "@zcode/shared" : `@zcode/shared/${key.slice(2)}`, resolve(shared, value),
]));
const main = `
import {app,BrowserWindow,ipcMain,protocol,session} from 'electron';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {automationSmoke} from ${JSON.stringify(join(root, 'ui-plugins/craft-runtime/automation-smoke.mjs'))};
import {chineseSmoke} from ${JSON.stringify(join(root, 'ui-plugins/craft-runtime/chinese-smoke.mjs'))};
import {createPluginSandboxRegistry} from ${JSON.stringify(join(zcode, "packages/desktop/src/main/pluginSandbox/registry.ts"))};
import {createPluginSandboxProtocolHandler,PLUGIN_SANDBOX_PRIVILEGED_SCHEME} from ${JSON.stringify(join(zcode, "packages/desktop/src/main/pluginSandbox/protocol.ts"))};
const root=${JSON.stringify(root)},output=${JSON.stringify(output)},names=${JSON.stringify(names)};
// Defaults are checked on a fresh test profile. Existing application preferences
// intentionally take precedence and must not leak between validation runs.
app.setPath('userData',join(output,'profile-'+randomUUID()));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('use-angle','swiftshader');
protocol.registerSchemesAsPrivileged([PLUGIN_SANDBOX_PRIVILEGED_SCHEME]);
app.on('window-all-closed',()=>{});
const results=[];
async function waitFor(check,ms=90000){const start=Date.now();while(Date.now()-start<ms){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out');}
app.whenReady().then(async()=>{
 for(const name of names){
  let client,win;
  const errors=[];
  try{
   const workspace=await mkdtemp(join(output,name+'-workspace-'));
   const transport=new StdioClientTransport({command:${JSON.stringify(process.execPath)},args:[join(root,'external_plugins',name,'dist/server.mjs')],cwd:workspace,env:{PATH:process.env.PATH||'',ZCODE_WORKSPACE_ROOT:workspace},stderr:'pipe'});
   client=new Client({name:'craft-electron-check',version:'1'});await client.connect(transport);
   const panel=await client.readResource({uri:'ui://'+name+'/panel.html'});
   const registry=createPluginSandboxRegistry();
   const identity=createHash('sha256').update('craft-test:'+name).digest('hex');
   const record=registry.register({instance:{runtimeId:name,generation:1,token:randomUUID(),appIdentity:identity},ownerWebContentsId:1,workspacePath:workspace,sessionId:'craft-check',pluginId:name,serverName:name,scopeId:'editor',html:panel.contents[0].text,cspRelaxations:panel.contents[0]._meta['zcode/csp']});
   const isolated=session.fromPartition(record.partition);
   isolated.protocol.handle('zcode-sandbox',createPluginSandboxProtocolHandler({registry,assets:{rendererDir:output,aliasDir:output}}));
   ipcMain.handle('craft-rpc',async(_event,method,args)=>{
    const result=method==='readResource'?await client.readResource(args):await client.callTool(args);
    if(method==='readResource')assert.ok(Buffer.byteLength(JSON.stringify(result))<8*1024*1024);
    return result;
   });
   const downloads=[];
   ipcMain.handle('craft-download',async(_event,params)=>{downloads.push(params);return {isError:false};});
   win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{partition:record.partition,preload:join(output,'preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false}});
   win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
   await win.loadURL(record.shellUrl);
   const frame=await waitFor(()=>win.webContents.mainFrame.frames.find(f=>f.url.includes('://plugin-')));
   const state=await waitFor(async()=>{const s=await frame.executeJavaScript('window.__craftPlugin');return s?.loaded||s?.error?s:null;});
   assert.equal(state.error,null);assert.equal(state.loaded,true);
   assert.equal(await win.webContents.executeJavaScript('window.initializations'),1);
   assert.equal(await frame.executeJavaScript('window.isSecureContext'),true);
   await frame.executeJavaScript("(()=>{const u=URL.createObjectURL(new Blob([new Uint8Array([0,1,127,128,255])]));const a=document.createElement('a');a.href=u;a.download='electron.bin';a.click();URL.revokeObjectURL(u);})()");
   await waitFor(()=>downloads.length===1);
   assert.deepEqual(Buffer.from(downloads[0].contents[0].resource.blob,'base64'),Buffer.from([0,1,127,128,255]));
   assert.equal(await frame.executeJavaScript("document.querySelectorAll('#craft-toolbar, #craft-open, #craft-path').length"),0);
   assert.equal(await frame.executeJavaScript("document.getElementById('craft-stage').getBoundingClientRect().top"),0);
   assert.equal(await frame.executeJavaScript("document.getElementById('craft-notice').hidden"),true);
   const automation=await automationSmoke({client,name,workspace,catalogPath:join(root,'external_plugins',name,'dist/tools.json'),frame:{
    evaluate:fn=>frame.executeJavaScript('('+fn.toString()+')()'),
    waitForFunction:(fn,_arg,options)=>waitFor(()=>frame.executeJavaScript('('+fn.toString()+')()'),options.timeout),
   }});
   const chinese=await chineseSmoke({client,name,workspace,output:join(output,'chinese')});
   await new Promise(r=>setTimeout(r,500));
   await writeFile(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
   results.push({name,status:'passed',secureContext:true,scheme:'zcode-sandbox',downloadBytes:5,automation,chinese,errors});
   await win.webContents.executeJavaScript('window.shutdownCraft()');
   process.stdout.write('PASS Electron '+name+' production protocol/CSP, isolated partition, MCP edit/save/reopen\\n');
  }catch(error){results.push({name,status:'failed',error:error.stack,errors});process.stderr.write('FAIL Electron '+name+': '+error.stack+'\\n');}
  finally{win?.destroy();ipcMain.removeHandler('craft-rpc');ipcMain.removeHandler('craft-download');await client?.close();await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));}
 }
 app.exit(results.some(r=>r.status==='failed')?1:0);
}).catch(e=>{process.stderr.write(e.stack+'\\n');app.exit(1);});
`;
await build({
  stdin: { contents: main, sourcefile: "craft-native-check.mjs", resolveDir: root },
  outfile: join(output, "main.cjs"), bundle: true, platform: "node", format: "cjs",
  external: ["electron"], alias,
});
await writeFile(join(output, "preload.cjs"), `const {contextBridge,ipcRenderer}=require('electron');if(process.isMainFrame)contextBridge.exposeInMainWorld('craftHarness',{rpc:(method,args)=>ipcRenderer.invoke('craft-rpc',method,args),download:params=>ipcRenderer.invoke('craft-download',params)});`);
await build({
  stdin: {
    contents: `
import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
const host=new AppBridge(null,{name:'zcode-electron-check',version:'1'},{serverResources:{},serverTools:{},downloadFile:{}},{hostContext:{locale:'en-US',theme:'dark',displayMode:'fullscreen'}});
window.initializations=0;
window.shutdownCraft=()=>host.teardownResource({});
host.onreadresource=params=>window.craftHarness.rpc('readResource',params);
host.oncalltool=params=>window.craftHarness.rpc('callTool',params);
host.ondownloadfile=params=>window.craftHarness.download(params);
host.onsizechange=()=>{};
host.oninitialized=()=>{window.initializations++;};
const frame=document.querySelector('iframe');
await host.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
frame.src=location.href.replace('://shell-','://plugin-')+'index.html';
`,
    sourcefile: "electron-host.mjs", resolveDir: root,
  },
  outfile: join(output, "assets/host.js"), bundle: true, format: "esm", platform: "browser",
});
await writeFile(join(output, "plugin-sandbox.html"), '<!doctype html><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;overflow:hidden}</style><iframe sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen"></iframe><script type="module" src="assets/host.js"></script>');
// The applications use the official SDK directly, so the compatibility alias is intentionally unused.
await writeFile(join(output, "plugin-sandbox-alias.js"), "// Official App SDK owns this test connection.\n");
const electron = require(require.resolve("electron", { paths: [zcode] }));
await new Promise((accept, reject) => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [join(output, "main.cjs")], { env, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => code === 0 ? accept() : reject(new Error(`Electron checks failed (${code})`)));
});
