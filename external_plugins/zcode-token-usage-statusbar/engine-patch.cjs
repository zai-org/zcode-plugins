/* v179 自动压缩阈值引擎补丁（主进程热换模块，由 inject-main.cjs 相对 require；v258 起随
 * loader 热换循环零重启生效）。
 * 原理：桌面客户端把 agent 引擎放在 <resources>/glm/zcode.cjs（独立子进程加载，
 * spawn env 白名单构造，NODE_OPTIONS 注入不可行）。auto-compact 阈值判定在
 * getAutoCompactThreshold（源码 core/src/compact/policy.ts，bundle 内锚点唯一）。
 * 本模块按 ENGINE_TARGETS 的 SHA256 白名单对引擎做两处一次性改写：
 *   1) prologue：在文件头 "use strict"; 之后插入阈值改道 hook——每次决策读
 *      <runtime>/autocompact.json（mtime 缓存），任何异常回退引擎默认 → fail-open；
 *   2) 判定点：默认阈值表达式改道 globalThis hook（hook 缺席/返回空 → 原式兜回）。
 * 红线：fail-closed——引擎 SHA 不在登记表、锚点不唯一、"use strict"; 前缀缺失
 * 均拒绝写盘并在 status() 明示；restore 按当前内容反向还原，不动客户端其它字节。
 * 阈值数值热生效（hook 每轮决策读文件，无需重启）；补丁本身冷生效（引擎子进程
 * 下次 spawn 起用）。作用范围仅桌面客户端引擎，终端 CLI 不受影响。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const MARK = "__zusageAutoCompactThreshold";
const PROLOGUE_PREFIX = "/* zcode-token-usage-statusbar v179 auto-compact threshold hook */";
const BACKUP_PREFIX = ".pre-acthreshold-";
const SENTINEL = "engine-patch.json";
/* 锚点/replacement 与已装 bundle 逐字节核对（bufferTokens 全 bundle 唯一）。
 * `??Math.max(0,t-n)` 兜底必须有：hook 存在但返回空（配置缺失/损坏）时若直接返回
 * undefined，阈值判定会恒 false——那等于永远不压缩而不是回默认。 */
const anchorFor = (fn, dflt) => "n=" + fn + "(e.bufferTokens)??" + dflt + ";return Math.max(0,t-n)";
const replacementFor = (fn, dflt) => "n=" + fn + "(e.bufferTokens)??" + dflt +
  ";return (globalThis." + MARK + "&&globalThis." + MARK + "(t,n))??Math.max(0,t-n)";
/* 最新登记版本的锚点对；旧版本符号轮换见 ENGINE_TARGETS 各条目。 */
const ANCHOR = anchorFor("$ue", "fZo");
const REPLACEMENT = replacementFor("$ue", "fZo");

/* 阈值 hook 本体（PROLOGUE_BASE）：插入引擎文件头。优先级 enabled:false > thresholdPercent(30-99，
 * v194 起总窗口口径：引擎判定只认扣除输出预留后的有效窗口 eff，按 eff+21K 近似
 * 还原标称窗口计算并钳在 eff 内——设置 91 即原生按钮 91% 处触发) >
 * thresholdTokens(>=100000，v420 起；历史值 1000 的旧配置仍被消费但被钳到 100000)
 * > bufferTokens(>=0)；任何形式换算出的阈值统一地板
 * 1% effective——阈值被压到 0 会让每轮都触发压缩、rapid-refill 熔断中断用户 turn。
 * statSync 每轮决策一次 + mtime 缓存，改 JSON 下一轮即生效。 */
const PROLOGUE_BASE = PROLOGUE_PREFIX + "\n;(function(){try{var _zf=require(\"fs\"),_zp=require(\"path\"),_zh=require(\"os\").homedir();" +
  "var _ff=_zp.join(_zh,\".zcode\",\"zcode-token-usage-statusbar\",\"autocompact.json\"),_zc={m:0,v:null,bad:false};" +
  "globalThis." + MARK + "=function(eff){try{var st=_zf.statSync(_ff);" +
  "if(st.mtimeMs!==_zc.m){_zc.m=st.mtimeMs;try{_zc.v=JSON.parse(_zf.readFileSync(_ff,\"utf8\"));" +
  "_zc.bad=!_zc.v||typeof _zc.v!==\"object\"||Array.isArray(_zc.v);}catch(e2){_zc.bad=true;}}" +
  "if(_zc.bad||!_zc.v)return;var c=_zc.v,t;" +
  "if(c.enabled===false)return Number.MAX_SAFE_INTEGER;" +
  "if(isFinite(c.thresholdPercent))t=Math.min(eff,Math.floor((eff+21000)*(Math.min(99,Math.max(30,c.thresholdPercent))/100)));" +
  "else if(isFinite(c.thresholdTokens))t=Math.min(eff,Math.max(100000,c.thresholdTokens));" +
  "else if(isFinite(c.bufferTokens))t=eff-Math.min(Math.max(0,c.bufferTokens),Math.max(0,eff-1));" +
  "else return;" +
  "return Math.max(t,Math.floor(eff*0.01));}catch(e){}};}catch(e){}})();\n";

/* 请求抓包 hook（CAPTURE_PROLOGUE）：接在阈值 hook 之后，随同一条 prologue 注入。
 * 默认关闭——运行目录 req-capture.json 的 enabled===true 才记（配置 5 秒内最多重读一次，
 * 改 JSON 即生效；只有在引擎装上这段 hook 之前启动的会话进程抓不到）。
 *
 * 宿主发模型请求有两条路（4.0.0 引擎包 fetchHttpResponse，改宿主版本后要复核）：
 *   ① 没配代理、没配自定义证书：全局 fetch(url, {body: Buffer, headers: Headers, ...})
 *   ② 配了代理或自定义证书：node:http / node:https 的 request({method, headers, ...}, cb)
 *      再 req.end(Buffer)
 * 所以这里包两处：globalThis.fetch 与 node:http(s).request（后者在响应对象上包 end 收请求体）。
 * 只认 POST 且带 x-zcode-trace-id 归因头的请求（宿主只给模型请求加这组头）；只落 system 与
 * 工具 schema（SHA256 去重存 blobs/，上限 300 个）和消息条数/字符数，不落消息正文、请求头
 * 或任何凭据。requests.jsonl 超 512KB 只留最近 300 行。任何一步出错都静默放行原请求。
 * 消费端 zusage._read_req_capture 按 trace 归并到会话（近似，见该函数注释）。
 * requests.jsonl 的滚动是「读-改-写」：多个引擎子进程同时抓包时理论上可能互相覆盖丢一两行（追加本身是
 * 原子的，行很小），已知并接受——记录只用于展示，丢行不影响任何判定。
 * 模板里不写任何反斜杠转义（换行用 String.fromCharCode(10)）：\n 会被模板提前解开成真换行。 */
const CAPTURE_PROLOGUE = `
/* zcode-token-usage-statusbar request capture hook */
;(function(){try{
var _cf=require("fs"),_cp=require("path"),_ch=require("os").homedir(),_cc=require("crypto"),_NL=String.fromCharCode(10);
var _cd=_cp.join(_ch,".zcode","zcode-token-usage-statusbar"),_cj=_cp.join(_cd,"req-capture.json");
var _cx=_cp.join(_cd,"req-capture"),_cl=_cp.join(_cx,"requests.jsonl"),_cb=_cp.join(_cx,"blobs");
var _cs={m:-1,on:false,t:0};
function _cen(){var n=Date.now();if(n-_cs.t<5000)return _cs.on;_cs.t=n;
try{var st=_cf.statSync(_cj);if(st.mtimeMs!==_cs.m){_cs.m=st.mtimeMs;try{var v=JSON.parse(_cf.readFileSync(_cj,"utf8"));_cs.on=!!(v&&v.enabled===true);}catch(e){_cs.on=false;}}}catch(e){_cs.on=false;}
return _cs.on;}
function _zb(h,txt){try{_cf.mkdirSync(_cb,{recursive:true,mode:0o700});var f=_cp.join(_cb,h+".json");if(_cf.existsSync(f))return;_cf.writeFileSync(f,txt,{mode:0o600});
var fs=_cf.readdirSync(_cb);if(fs.length>300){var es=fs.map(function(x){var p=_cp.join(_cb,x);return {p:p,t:_cf.statSync(p).mtimeMs};}).sort(function(a,b){return a.t-b.t;});
for(var i=0;i<es.length-300;i++){try{_cf.unlinkSync(es[i].p);}catch(e2){}}}}catch(e){}}
function _zp(txt,tr,qs,st){try{if(txt.length>26214400)return;var j=JSON.parse(txt);if(!j||typeof j!=="object")return;
var sy=j.system==null?"":JSON.stringify(j.system),tl=j.tools==null?"":JSON.stringify(j.tools);if(!sy&&!tl)return;
var ms=Array.isArray(j.messages)?j.messages:[],mc=null;if(ms.length<20000){mc=0;for(var k=0;k<ms.length;k++){mc+=JSON.stringify(ms[k]).length;}}
var sh=sy?_cc.createHash("sha256").update(sy).digest("hex"):"",th=tl?_cc.createHash("sha256").update(tl).digest("hex"):"";
if(sy)_zb(sh,sy);if(tl)_zb(th,tl);
_cf.mkdirSync(_cx,{recursive:true,mode:0o700});
try{if(_cf.statSync(_cl).size>524288){var ls=_cf.readFileSync(_cl,"utf8").split(_NL);if(ls[ls.length-1]==="")ls.pop();_cf.writeFileSync(_cl,ls.slice(-300).join(_NL)+_NL,{mode:0o600});}}catch(e){}
_cf.appendFileSync(_cl,JSON.stringify({ts:Date.now(),trace:String(tr).slice(0,80),querySource:String(qs).slice(0,64),sessionType:String(st).slice(0,32),model:String(j.model||"").slice(0,120),systemHash:sh,toolsHash:th,systemChars:sy.length,toolsChars:tl.length,messages:ms.length,messageChars:mc})+_NL,{mode:0o600});
}catch(e){}}
function _hd(o,i,n){try{var h=o&&o.headers,k,v;
if(h){if(typeof h.get==="function"){v=h.get(n);if(v!=null)return String(v);}else if(typeof h==="object"){for(k in h){if(String(k).toLowerCase()===n){v=h[k];if(Array.isArray(v))v=v[0];if(v!=null)return String(v);}}}}
if(i&&typeof i.headers==="object"&&typeof i.headers.get==="function"){v=i.headers.get(n);if(v!=null)return String(v);}return "";}catch(e){return "";}}
function _zbody(b){if(typeof b==="string")return b;try{if(typeof Buffer==="undefined"||b==null)return null;
if(ArrayBuffer.isView(b))return Buffer.from(b.buffer,b.byteOffset||0,b.byteLength).toString("utf8");
if(Object.prototype.toString.call(b)==="[object ArrayBuffer]")return Buffer.from(b).toString("utf8");}catch(e){}return null;}
function _zd(fn){try{if(typeof setImmediate==="function"){var t=setImmediate(fn);if(t&&typeof t.unref==="function")t.unref();return;}}catch(e){}try{fn();}catch(e2){}}
function _zc(i,o){var m=String((o&&o.method)||(i&&i.method)||"GET").toUpperCase();if(m!=="POST")return;
var tr=_hd(o,i,"x-zcode-trace-id");if(!tr)return;
var qs=_hd(o,i,"x-zcode-query-source"),st=_hd(o,i,"x-zcode-session-type");
if(o&&o.body!=null){var sb=_zbody(o.body);if(sb!=null){_zd(function(){_zp(sb,tr,qs,st);});return;}}
if(i&&typeof i.clone==="function"){var p=i.clone().text();if(p&&typeof p.then==="function")p.then(function(t){_zp(t,tr,qs,st);},function(){});}}
function _zt(q,tr,qs,st){var oe=q.end,acc=[],tot=0;
q.end=function(c){try{var s2=_zbody(c);if(s2!=null){acc.push(s2);tot+=s2.length;}}catch(e){}
var r=oe.apply(this,arguments);try{if(acc.length&&tot<=26214400)_zd(function(){_zp(acc.join(""),tr,qs,st);});}catch(e){}return r;};}
function _zh(mod){try{if(!mod||typeof mod.request!=="function"||mod.request.__zc)return;var of=mod.request;
var wf=function(){var a=arguments,opts=null;try{var f=a[0];
if(f&&typeof f==="object"&&typeof f!=="function"&&!(typeof URL==="function"&&f instanceof URL))opts=f;
else if(f&&(typeof f==="string"||(typeof URL==="function"&&f instanceof URL))&&a[1]&&typeof a[1]==="object"&&typeof a[1]!=="function")opts=a[1];}catch(e){}
var r=of.apply(this,a);
try{if(opts&&_cen()){var tr=_hd(opts,null,"x-zcode-trace-id");
if(tr&&String(opts.method||"GET").toUpperCase()==="POST"&&r&&typeof r.end==="function")_zt(r,tr,_hd(opts,null,"x-zcode-query-source"),_hd(opts,null,"x-zcode-session-type"));}}catch(e){}
return r;};wf.__zc=1;mod.request=wf;}catch(e){}}
try{_zh(require("node:http"));_zh(require("node:https"));}catch(e){}
var _of=globalThis.fetch;if(typeof _of==="function")globalThis.fetch=function(i,o){try{if(_cen())_zc(i,o);}catch(e){}return _of.apply(this,arguments);};
}catch(e){}})();
`;
/* 上一版抓包 hook（2026-11-27 22:05 装进本机引擎：0644 权限、同步解析、消息过多时 messageChars 写 0）：只给当时的
 * 开发机原位换装用，没有随任何版本发布。文本必须逐字节保留。 */
const CAPTURE_PROLOGUE_V2 = `
/* zcode-token-usage-statusbar request capture hook */
;(function(){try{
var _cf=require("fs"),_cp=require("path"),_ch=require("os").homedir(),_cc=require("crypto"),_NL=String.fromCharCode(10);
var _cd=_cp.join(_ch,".zcode","zcode-token-usage-statusbar"),_cj=_cp.join(_cd,"req-capture.json");
var _cx=_cp.join(_cd,"req-capture"),_cl=_cp.join(_cx,"requests.jsonl"),_cb=_cp.join(_cx,"blobs");
var _cs={m:-1,on:false,t:0};
function _cen(){var n=Date.now();if(n-_cs.t<5000)return _cs.on;_cs.t=n;
try{var st=_cf.statSync(_cj);if(st.mtimeMs!==_cs.m){_cs.m=st.mtimeMs;try{var v=JSON.parse(_cf.readFileSync(_cj,"utf8"));_cs.on=!!(v&&v.enabled===true);}catch(e){_cs.on=false;}}}catch(e){_cs.on=false;}
return _cs.on;}
function _zb(h,txt){try{_cf.mkdirSync(_cb,{recursive:true});var f=_cp.join(_cb,h+".json");if(_cf.existsSync(f))return;_cf.writeFileSync(f,txt);
var fs=_cf.readdirSync(_cb);if(fs.length>300){var es=fs.map(function(x){var p=_cp.join(_cb,x);return {p:p,t:_cf.statSync(p).mtimeMs};}).sort(function(a,b){return a.t-b.t;});
for(var i=0;i<es.length-300;i++){try{_cf.unlinkSync(es[i].p);}catch(e2){}}}}catch(e){}}
function _zp(txt,tr,qs,st){try{if(txt.length>26214400)return;var j=JSON.parse(txt);if(!j||typeof j!=="object")return;
var sy=j.system==null?"":JSON.stringify(j.system),tl=j.tools==null?"":JSON.stringify(j.tools);if(!sy&&!tl)return;
var ms=Array.isArray(j.messages)?j.messages:[],mc=0;if(ms.length<20000){for(var k=0;k<ms.length;k++){mc+=JSON.stringify(ms[k]).length;}}
var sh=sy?_cc.createHash("sha256").update(sy).digest("hex"):"",th=tl?_cc.createHash("sha256").update(tl).digest("hex"):"";
if(sy)_zb(sh,sy);if(tl)_zb(th,tl);
_cf.mkdirSync(_cx,{recursive:true});
try{if(_cf.statSync(_cl).size>524288){var ls=_cf.readFileSync(_cl,"utf8").split(_NL);if(ls[ls.length-1]==="")ls.pop();_cf.writeFileSync(_cl,ls.slice(-300).join(_NL)+_NL);}}catch(e){}
_cf.appendFileSync(_cl,JSON.stringify({ts:Date.now(),trace:String(tr).slice(0,80),querySource:String(qs).slice(0,64),sessionType:String(st).slice(0,32),model:String(j.model||"").slice(0,120),systemHash:sh,toolsHash:th,systemChars:sy.length,toolsChars:tl.length,messages:ms.length,messageChars:mc})+_NL);
}catch(e){}}
function _hd(o,i,n){try{var h=o&&o.headers,k,v;
if(h){if(typeof h.get==="function"){v=h.get(n);if(v!=null)return String(v);}else if(typeof h==="object"){for(k in h){if(String(k).toLowerCase()===n){v=h[k];if(Array.isArray(v))v=v[0];if(v!=null)return String(v);}}}}
if(i&&typeof i.headers==="object"&&typeof i.headers.get==="function"){v=i.headers.get(n);if(v!=null)return String(v);}return "";}catch(e){return "";}}
function _zbody(b){if(typeof b==="string")return b;try{if(typeof Buffer==="undefined"||b==null)return null;
if(ArrayBuffer.isView(b))return Buffer.from(b.buffer,b.byteOffset||0,b.byteLength).toString("utf8");
if(Object.prototype.toString.call(b)==="[object ArrayBuffer]")return Buffer.from(b).toString("utf8");}catch(e){}return null;}
function _zc(i,o){var m=String((o&&o.method)||(i&&i.method)||"GET").toUpperCase();if(m!=="POST")return;
var tr=_hd(o,i,"x-zcode-trace-id");if(!tr)return;
var qs=_hd(o,i,"x-zcode-query-source"),st=_hd(o,i,"x-zcode-session-type");
if(o&&o.body!=null){var sb=_zbody(o.body);if(sb!=null){_zp(sb,tr,qs,st);return;}}
if(i&&typeof i.clone==="function"){var p=i.clone().text();if(p&&typeof p.then==="function")p.then(function(t){_zp(t,tr,qs,st);},function(){});}}
function _zt(q,tr,qs,st){var oe=q.end,acc=[],tot=0;
q.end=function(c){try{var s2=_zbody(c);if(s2!=null){acc.push(s2);tot+=s2.length;}}catch(e){}
var r=oe.apply(this,arguments);try{if(acc.length&&tot<=26214400)_zp(acc.join(""),tr,qs,st);}catch(e){}return r;};}
function _zh(mod){try{if(!mod||typeof mod.request!=="function"||mod.request.__zc)return;var of=mod.request;
var wf=function(){var a=arguments,opts=null;try{var f=a[0];
if(f&&typeof f==="object"&&typeof f!=="function"&&!(typeof URL==="function"&&f instanceof URL))opts=f;
else if(f&&(typeof f==="string"||(typeof URL==="function"&&f instanceof URL))&&a[1]&&typeof a[1]==="object"&&typeof a[1]!=="function")opts=a[1];}catch(e){}
var r=of.apply(this,a);
try{if(opts&&_cen()){var tr=_hd(opts,null,"x-zcode-trace-id");
if(tr&&String(opts.method||"GET").toUpperCase()==="POST"&&r&&typeof r.end==="function")_zt(r,tr,_hd(opts,null,"x-zcode-query-source"),_hd(opts,null,"x-zcode-session-type"));}}catch(e){}
return r;};wf.__zc=1;mod.request=wf;}catch(e){}}
try{_zh(require("node:http"));_zh(require("node:https"));}catch(e){}
var _of=globalThis.fetch;if(typeof _of==="function")globalThis.fetch=function(i,o){try{if(_cen())_zc(i,o);}catch(e){}return _of.apply(this,arguments);};
}catch(e){}})();
`;
const PROLOGUE = PROLOGUE_BASE + CAPTURE_PROLOGUE;
const PROLOGUE_CAP_V2 = PROLOGUE_BASE + CAPTURE_PROLOGUE_V2;   // 旧装机形态：阈值 hook + 上一版抓包 hook


/* 历史装机 hook 本体，仅供已打补丁引擎的原位迁移与还原匹配；由新串程序化推导并
 * 守卫漂移——将来再改 prologue 时按同款模式滚动：每个历史值段各留一条替换对。
 * V1 = v194 前装机（eff×pct 口径 + tokens 地板 1000）；V2 = v194 起装机面
 * （总窗口口径 + tokens 地板 1000）；当前 PROLOGUE = tokens 地板 100000（v420）。 */
const PROLOGUE_V1 = (() => {
  const NEW_PCT = "t=Math.min(eff,Math.floor((eff+21000)*(Math.min(99,Math.max(30,c.thresholdPercent))/100)));";
  const OLD_PCT = "t=Math.floor(eff*(Math.min(99,Math.max(10,c.thresholdPercent))/100));";
  const NEW_TOK = "Math.max(100000,c.thresholdTokens)";
  const OLD_TOK = "Math.max(1000,c.thresholdTokens)";
  if (!PROLOGUE_BASE.includes(NEW_PCT) || !PROLOGUE_BASE.includes(NEW_TOK)) throw new Error("prologue segments drifted; roll PROLOGUE_V1/V2 forward");
  return PROLOGUE_BASE.replace(NEW_PCT, OLD_PCT).replace(NEW_TOK, OLD_TOK);
})();
const PROLOGUE_V2 = (() => {
  const NEW_TOK = "Math.max(100000,c.thresholdTokens)";
  const OLD_TOK = "Math.max(1000,c.thresholdTokens)";
  if (!PROLOGUE_BASE.includes(NEW_TOK)) throw new Error("prologue tokens segment drifted; roll PROLOGUE_V2 forward");
  return PROLOGUE_BASE.replace(NEW_TOK, OLD_TOK);
})();

/* 登记表：客户端升级后引擎字节变化，必须实测新 SHA 并在此补条目（renderer_bridge
 * HOST_TARGETS 同款维护模型）；表外版本拒绝补丁并明示，绝不盲打。滚动 ANCHOR/REPLACEMENT
 * 到新版本时，旧条目必须同步改为 anchorFor/replacementFor 显式字面量——只有表首条目
 * 允许引用常量，否则旧条目会静默继承新版本锚点（tests/engine-patch.test.cjs 锁表守护）。
 * sha 未登记但桌面 build 前缀匹配登记条目时，按锚点串全文件唯一命中兜底注入（锚点是
 * 完整代码表达式，结构验证替代指纹预检，与 renderer_bridge derive 同哲学）；锚点
 * 不在/多处仍拒绝并明示，等登记跟上。 */
const ENGINE_TARGETS = [
  {
    build: "4.0.0",
    engineSha256: "0de95ddd65d7712a3beeccc8ee6de53ea0ce96338eb427e52b2717ba2f3afe19",
    anchor: ANCHOR,
    replacement: REPLACEMENT,
    prologue: PROLOGUE,
  },
  {
    build: "3.19.1",
    engineSha256: "4b90ae046753be9f5ba63dee14b8fd2cdb07b5540e9bfe348ba127504b8cf8da",
    anchor: anchorFor("Uue", "KKo"),
    replacement: replacementFor("Uue", "KKo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.19.0",
    engineSha256: "6b84e928d9258fe020c6ab8c75fa2c123b0cd658fe43c0ce141a13df677fb0ea",
    anchor: anchorFor("Hue", "xZo"),
    replacement: replacementFor("Hue", "xZo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.18.2",
    engineSha256: "08726b5ef69e1e9072828baa4656713cb3aac93bb096938681278c5600312b2c",
    anchor: anchorFor("iTe", "PWo"),
    replacement: replacementFor("iTe", "PWo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.18.1",
    engineSha256: "666f9c5a0a566eb8cbb906625e219aa2657e9f6a0e0ea8a73471fabdc54110b6",
    anchor: anchorFor("oTe", "vWo"),
    replacement: replacementFor("oTe", "vWo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.18.0",
    engineSha256: "26785f28ab8fb9f8b0f3821f2bf71d294f4d0b8bf28108785292f86c7e14090d",
    anchor: anchorFor("nTe", "K9o"),
    replacement: replacementFor("nTe", "K9o"),
    prologue: PROLOGUE,
  },
  {
    build: "3.17.2",
    engineSha256: "d9afd58d694f98a5279bf548cdc7646413c125762e86730605a6071f9e0346d6",
    anchor: anchorFor("cke", "jBo"),
    replacement: replacementFor("cke", "jBo"),
    prologue: PROLOGUE,
  },
  {
    build: "3.17.1",
    engineSha256: "9afd565a104d660259e6bdeeaa5cb8abc74a908559e21aa3c5f6a06f2a9da6c6",
    anchor: anchorFor("ake", "DBo"),
    replacement: replacementFor("ake", "DBo"),
    prologue: PROLOGUE,
  },
];

function resolveEnginePath(resourcesPath) {
  const candidates = [
    path.join(resourcesPath, "glm", "zcode.cjs"),
    path.join(resourcesPath, "glm", process.platform + "-" + process.arch, "zcode.cjs"),
  ];
  for (const p of candidates) {
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* 换下一布局 */ }
  }
  return null;
}

function sha256hex(buf) { return createHash("sha256").update(buf).digest("hex"); }

/* 同目录临时文件 + rename 原子替换；Windows 下引擎被运行中的 agent 子进程占用时
 * rename 抛 EPERM/EBUSY，由调用方降级为 busy 待重启态，不阻塞主进程启动。 */
function atomicWrite(file, content) {
  let mode = 0o644;
  try { mode = fs.statSync(file).mode & 0o777; } catch (e) { /* 新文件用默认 */ }
  const tmp = file + ".zusage-tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, content, { mode });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* tmp 已不存在 */ }
    throw e;
  }
}

function insertPrologue(text, prologue) {
  // 指令序言必须在最前：插到 shebang 与 "use strict"; 之后，保持引擎严格模式不退化
  const m = text.match(/^(#![^\n]*\n)?[ \t]*"use strict";/);
  if (!m) return null;
  return text.slice(0, m[0].length) + "\n" + prologue + text.slice(m[0].length);
}

function buildPatchedSource(text, target) {
  const count = text.split(target.anchor).length - 1;
  if (count !== 1) return { error: "anchor_count_" + count };
  // 函数式替换：replacement/prologue 是 JS 源码，压缩标识符常带 $（$$、$&、$1…），
  // 字符串替换串会把这些当替换模式展开——插入体必须逐字节原样
  const output = insertPrologue(text.replace(target.anchor, () => target.replacement), target.prologue);
  if (output == null) return { error: "strict_prefix_missing" };
  return { output };
}

function createEnginePatcher(opts) {
  const log = opts.log || (() => { });
  const configPath = path.join(opts.runtime, "autocompact.json");
  const sentinelPath = path.join(opts.runtime, SENTINEL);
  // st 缓存最近一次真实执行结果，status() 只读它——pushPluginState 高频调用零读盘
  const st = { enabled: false, state: "off", build: null, engineSha256: null, drifted: null, lastError: null };

  const set = (state, lastError, extra) => {
    st.state = state;
    st.lastError = lastError || null;
    if (extra) for (const k of Object.keys(extra)) st[k] = extra[k];
    if (state === "off" || state === "unsupported_build" || state === "engine_missing") st.build = extra && extra.build || null;
    // drifted 只在 unsupported_build 下有意义（issue #191），其它状态一律清掉防跨调用残留
    st.drifted = state === "unsupported_build" && extra && extra.drifted || null;
    if (lastError) log(state + ": " + lastError);
    return state;
  };

  function readJson(file) {
    try {
      const d = JSON.parse(fs.readFileSync(file, "utf8"));
      return d && typeof d === "object" && !Array.isArray(d) ? d : null;
    } catch (e) { return null; }
  }
  function readSentinel() { return readJson(sentinelPath); }
  function writeSentinel(d) {
    try { atomicWrite(sentinelPath, Buffer.from(JSON.stringify(d, null, 2) + "\n", "utf8")); }
    catch (e) { log("sentinel write failed: " + e.message); }
  }

  function ensure() {
    st.enabled = true;
    const enginePath = resolveEnginePath(opts.resourcesPath);
    if (!enginePath) return set("engine_missing", "glm/zcode.cjs not found under resources");
    let content;
    try { content = fs.readFileSync(enginePath); } catch (e) { return set("engine_missing", e.message); }
    const sha = sha256hex(content);
    st.engineSha256 = sha;
    const text = content.toString("utf8");
    // 幂等检查必须先于登记表查询：补丁写盘后文件字节已变，SHA 只匹配未打补丁原版；
    // 已含 prologue 的文件按替换体内容识别（字节级精确，外来补丁不会误配）。
    if (text.includes(PROLOGUE_PREFIX)) {
      const t2 = ENGINE_TARGETS.find((t) => text.includes(t.replacement));
      if (!t2) return set("error", "patched_inconsistent");
      if (text.includes(t2.prologue)) return set("applied", null, { build: t2.build });
      /* 旧版 hook 本体在位（BASE=只有阈值 hook、V1=v194 前 eff×pct 口径、V2=v194 起
       * tokens 地板 1000）：原位换装新 prologue——锚点替换体各代相同无需重打；旧串逐字节
       * 匹配，匹配不到=外来/半截补丁不接手。CAP_V2 与 BASE 是新版的前缀，排在最前；
       * 四段互斥，命中唯一。 */
      const legacy = [PROLOGUE_CAP_V2, PROLOGUE_BASE, PROLOGUE_V2, PROLOGUE_V1].find((p) => text.includes(p));
      if (!legacy) return set("error", "patched_inconsistent");
      try { atomicWrite(enginePath, Buffer.from(text.replace(legacy, () => t2.prologue), "utf8")); } catch (e) {
        const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
        return set(busy ? "busy" : "error", e.message);
      }
      try {
        const after = fs.readFileSync(enginePath, "utf8");
        /* BASE 是新版 prologue 的前缀，「旧串不残留」对它恒假——改用前缀标记恰好一次
         * （抓包 hook 不叠加）+ 完整本体在位；CAP_V2 与 V1/V2 跟新版有差异段，仍按旧串不残留判。 */
        const marks = after.split(PROLOGUE_PREFIX).length - 1;
        if (!after.includes(t2.prologue) || marks !== 1 || (legacy !== PROLOGUE_BASE && after.includes(legacy))) {
          return set("error", "verify_failed");
        }
      } catch (e) { return set("error", e.message); }
      writeSentinel({ patched: true, build: t2.build });
      log("patch prologue migrated: " + t2.build);
      return set("applied", null, { build: t2.build });
    }
    let target = ENGINE_TARGETS.find((t) => t.engineSha256 === sha);
    let anchorFallback = false;
    if (!target) {
      /* issue #191：桌面 build 仍在登记表（如 3.17.2.9661 匹配 3.17.2）而引擎 sha 脱钩，
       * =引擎文件被供应商/CLI 侧单独热更，与"全新桌面版本"区分开供 ⚙ 面板明示。
       * 前缀匹配按点分界，"3.17.20" 不得误配 "3.17.2"。
       * 同 build 字节漂移兜底：判定区混淆符号未轮换时锚点串全文件唯一命中，按该
       * 条目注入——字节手术点与登记版本一致，结构验证替代指纹预检；符号已轮换
       * （锚点不在/多处）仍 fail-closed 明示，等待登记。 */
      const dv = typeof opts.appVersion === "string" ? opts.appVersion : "";
      const drift = ENGINE_TARGETS.find((t) => t.build && (dv === t.build || dv.startsWith(t.build + ".")));
      if (drift && text.split(drift.anchor).length - 1 === 1) {
        target = drift;
        anchorFallback = true;
      } else {
        return set("unsupported_build", "engine sha " + sha.slice(0, 12) + " not in ENGINE_TARGETS",
          { drifted: drift ? drift.build : null });
      }
    }
    if (text.includes(PROLOGUE_PREFIX)) {
      // 幂等：本补丁两处编辑同一次写盘，prologue 在而替换体不在=外来/半打补丁，不接手
      if (text.includes(target.replacement)) return set("applied", null, { build: target.build });
      return set("error", "patched_inconsistent");
    }
    const built = buildPatchedSource(text, target);
    if (built.error) return set("error", built.error);
    try {
      // 首次打补丁留一份未打补丁原字节备份（已有备份不叠加，避免堆文件）
      const hasBackup = fs.readdirSync(path.dirname(enginePath)).some((f) => f.startsWith(BACKUP_PREFIX));
      if (!hasBackup) {
        let mode = 0o644;
        try { mode = fs.statSync(enginePath).mode & 0o777; } catch (e) { /* 已读成功，stat 失败极罕见 */ }
        fs.writeFileSync(path.join(path.dirname(enginePath), BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, "-")), content, { mode });
      }
      atomicWrite(enginePath, Buffer.from(built.output, "utf8"));
    } catch (e) {
      const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
      return set(busy ? "busy" : "error", e.message);
    }
    try {
      const after = fs.readFileSync(enginePath, "utf8");
      if (!after.includes(PROLOGUE_PREFIX) || !after.includes(target.replacement)) return set("error", "verify_failed");
    } catch (e) { return set("error", e.message); }
    writeSentinel({ patched: true, build: target.build, engineSha256: sha });
    log((anchorFallback ? "patch applied via anchor fallback: " : "patch applied: ") +
      target.build + " (" + sha.slice(0, 12) + ")");
    return set("applied", null, { build: target.build });
  }

  function restore() {
    st.enabled = false;
    const enginePath = resolveEnginePath(opts.resourcesPath);
    if (!enginePath) return set("engine_missing", "glm/zcode.cjs not found under resources");
    let text;
    try { text = fs.readFileSync(enginePath, "utf8"); } catch (e) { return set("engine_missing", e.message); }
    st.engineSha256 = sha256hex(Buffer.from(text, "utf8"));
    if (!text.includes(MARK)) {
      writeSentinel({ patched: false });
      return set("off");   // 引擎本就干净（可能被客户端更新整体替换）
    }
    const target = ENGINE_TARGETS.find((t) => t.engineSha256 === st.engineSha256)
      || ENGINE_TARGETS.find((t) => text.includes(t.replacement) && (text.includes(t.prologue) || text.includes(PROLOGUE_BASE) || text.includes(PROLOGUE_V1) || text.includes(PROLOGUE_V2)));
    if (!target) return set("error", "restore_pattern_missing");
    // CAP_V2 含 BASE，必须排在 BASE 前面
    const pro = [target.prologue, PROLOGUE_CAP_V2, PROLOGUE_BASE, PROLOGUE_V1, PROLOGUE_V2].find((p) => text.includes(p));
    // 完整版 / 上一版抓包 / 只有阈值 hook / v194 前 / v194+（tokens 1000 代）装机的本体都能还原
    let out = text.replace("\n" + pro, "").replace(target.replacement, () => target.anchor);
    if (out.includes(MARK)) return set("error", "restore_incomplete");
    try { atomicWrite(enginePath, Buffer.from(out, "utf8")); } catch (e) {
      const busy = e && (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES");
      return set(busy ? "busy" : "error", e.message);
    }
    writeSentinel({ patched: false });
    log("patch restored");
    return set("off");
  }

  /* 主进程启动时调用一次：开→补丁；关→仅在哨兵记录已打补丁时才读引擎还原
   *（多数用户从未开启，避免每次启动都读 15MB 引擎）。 */
  function syncStartup() {
    if (opts.isEnabled()) return ensure();
    const s = readSentinel();
    if (s && s.patched) return restore();
    st.enabled = false;
    return set("off");
  }

  /* ⚙ 写阈值配置：mode+value 归一为白名单 JSON（hook 侧按固定优先级消费），
   * 非法输入直接拒绝，不落盘。 */
  function writeConfig(mode, value) {
    let out;
    if (mode === "default") out = { enabled: true };
    else if (mode === "disabled") out = { enabled: false };
    else if (mode === "percent" || mode === "tokens" || mode === "buffer") {
      const n = Math.round(Number(value));
      const ok = isFinite(n) && (mode === "percent" ? n >= 30 && n <= 99 : mode === "tokens" ? n >= 100000 : n >= 0);   // v194：30-99；v420：tokens 下限 100k（UI 协议同限）
      if (!ok) throw new Error("invalid value for " + mode);
      out = mode === "percent" ? { enabled: true, thresholdPercent: n }
        : mode === "tokens" ? { enabled: true, thresholdTokens: n }
          : { enabled: true, bufferTokens: n };
    } else throw new Error("invalid mode");
    atomicWrite(configPath, Buffer.from(JSON.stringify(out) + "\n", "utf8"));
    return out;
  }
  function readConfig() { return readJson(configPath); }
  /* status() 附带当前阈值配置：⚙ 面板据此反推模式/数值；mtime 缓存，广播高频调用零读盘 */
  const cfgCache = { m: 0, v: null, known: false };
  function readConfigCached() {
    try {
      const m = fs.statSync(configPath).mtimeMs;
      if (!cfgCache.known || m !== cfgCache.m) { cfgCache.m = m; cfgCache.v = readJson(configPath); cfgCache.known = true; }
    } catch (e) { cfgCache.v = null; cfgCache.known = true; }
    return cfgCache.v;
  }

  function status() {
    return { enabled: st.enabled, state: st.state, build: st.build, engineSha256: st.engineSha256, drifted: st.drifted, config: readConfigCached(), configPath, lastError: st.lastError };
  }

  return { ensure, restore, syncStartup, writeConfig, readConfig, status, configPath };
}

module.exports = { createEnginePatcher, ENGINE_TARGETS, PROLOGUE, PROLOGUE_BASE, CAPTURE_PROLOGUE, CAPTURE_PROLOGUE_V2, PROLOGUE_CAP_V2, PROLOGUE_V1, PROLOGUE_V2, PROLOGUE_PREFIX, ANCHOR, REPLACEMENT, MARK, resolveEnginePath, insertPrologue, buildPatchedSource };
