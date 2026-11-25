import type { Field } from "./schema.ts";

export interface AppSettings {
  title: string;
  lang: "zh" | "en";
  accent: string;
  pageSize: number;
  sort?: { key: string; dir: "asc" | "desc" };
  /** 高亮规则，例如 库存 <= 5 → “库存不足” */
  highlight?: { key: string; op: "<=" | ">=" | "=" | "empty"; value?: string | number; label: string };
}
export interface AppConfig extends AppSettings { id: string; fields: Field[]; keyField?: string; titleField?: string; source: string; generatedAt: string }

const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

const CSS = `:root{--accent:#2563eb;--bg:#f7f7f5;--card:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--bad:#b42318;--warn:#fff4e5}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 20px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
header h1{font-size:18px;margin:0 12px 0 0}header .sp{flex:1}button,.btn{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer}
button.pri{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--bad)}main{padding:16px 20px;max-width:1400px;margin:0 auto}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.bar input[type=search]{min-width:240px;flex:1;max-width:420px}
input,select,textarea{font:inherit;border:1px solid var(--line);border-radius:8px;padding:6px 9px;background:#fff;color:var(--fg)}textarea{min-height:80px;width:100%}
.tbl{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600;background:#fafafa;cursor:pointer;user-select:none}th .ar{opacity:.6}tbody tr{cursor:pointer}tbody tr:hover{background:#f5f8ff}td.num{text-align:right;font-variant-numeric:tabular-nums}
tr.hl td{background:var(--warn)}.tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:#ffe8cc;color:#8a4b00;margin-left:6px}.bad{color:var(--bad)}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:10px;color:var(--muted)}.empty{padding:30px;text-align:center;color:var(--muted)}
.banner{background:#eef4ff;border:1px solid #c7d7fe;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
dialog{border:0;border-radius:14px;padding:0;width:min(560px,94vw);box-shadow:0 20px 60px rgba(0,0,0,.25)}dialog::backdrop{background:rgba(15,23,42,.4)}
dialog form{padding:18px 20px}dialog h2{margin:0 0 12px;font-size:17px}.fld{margin:0 0 10px}.fld label{display:block;font-size:12px;color:var(--muted);margin-bottom:3px}.fld input:not([type=checkbox]),.fld select{width:100%}
.fld .err{color:var(--bad);font-size:12px;margin-top:2px}.req{color:var(--bad)}.acts{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.acts .sp{flex:1}
.toast{position:fixed;right:16px;bottom:16px;background:#111827;color:#fff;padding:8px 14px;border-radius:8px;opacity:0;transition:opacity .2s}.toast.on{opacity:1}
@media print{header,.bar,.foot,.banner{display:none}}`;

const JS = String.raw`(function(){
"use strict";
var CFG=JSON.parse(document.getElementById("cfg").textContent),SEED=JSON.parse(document.getElementById("seed").textContent);
var ZH=CFG.lang==="zh",S=ZH?{add:"新增",exp:"导出 CSV",imp:"导入 CSV",backup:"备份",restore:"恢复备份",reset:"重置为表格数据",search:"搜索…",all:"全部",yes:"是",no:"否",save:"保存",cancel:"取消",del:"删除",edit:"编辑",newT:"新增记录",of:"共",rows:"条",prev:"上一页",next:"下一页",none:"没有记录",required:"必填",num:"请输入数字",date:"请输入日期",email:"邮箱格式不对",url:"需要 http(s) 链接",saved:"已保存",deleted:"已删除",confirmDel:"确定删除这条记录？",imported:"已导入",updated:"表格已更新（",updated2:"）。载入新数据会替换你在本机做的修改。",load:"载入新数据",keep:"保留我的数据",confirmReset:"用表格里的数据替换本机数据？",importMode:"导入方式：确定 = 追加，取消 = 替换全部",dupKey:"已存在相同的",restored:"已恢复"}
:{add:"Add",exp:"Export CSV",imp:"Import CSV",backup:"Backup",restore:"Restore backup",reset:"Reset to sheet data",search:"Search…",all:"All",yes:"Yes",no:"No",save:"Save",cancel:"Cancel",del:"Delete",edit:"Edit",newT:"New record",of:"of",rows:"rows",prev:"Previous",next:"Next",none:"No records",required:"Required",num:"Enter a number",date:"Enter a date",email:"Not a valid email",url:"Needs an http(s) link",saved:"Saved",deleted:"Deleted",confirmDel:"Delete this record?",imported:"Imported",updated:"The spreadsheet was updated (",updated2:"). Loading it replaces the changes made on this computer.",load:"Load new data",keep:"Keep my data",confirmReset:"Replace the data on this computer with the spreadsheet data?",importMode:"Import: OK = append, Cancel = replace all",dupKey:"Already exists: ",restored:"Restored"};
document.documentElement.style.setProperty("--accent",CFG.accent||"#2563eb");
var F=CFG.fields,LIST=F.filter(function(f){return f.list}),KEY="sheet-to-app:"+CFG.id,$=function(s,r){return (r||document).querySelector(s)};
function uid(){return Math.random().toString(36).slice(2,10)+Date.now().toString(36)}
function fresh(){return{seedVersion:SEED.version,rows:SEED.rows.map(function(r){var o={_id:uid()};for(var k in r)o[k]=r[k];return o})}}
var store;try{store=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){store=null}
var stale=!!(store&&store.seedVersion!==SEED.version);if(!store||!Array.isArray(store.rows))store=fresh();
function persist(){try{localStorage.setItem(KEY,JSON.stringify(store))}catch(e){}}persist();
var st={q:"",filters:{},sort:CFG.sort||null,page:0};
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function fmt(f,v){if(v==null||v==="")return"";if(f.type==="boolean")return v===true?S.yes:v===false?S.no:String(v);if(f.type==="money"&&typeof v==="number")return v.toLocaleString(ZH?"zh-CN":"en-US",{minimumFractionDigits:2,maximumFractionDigits:2});if(f.type==="number"&&typeof v==="number")return v.toLocaleString(ZH?"zh-CN":"en-US");return String(v)}
function invalid(f,v){if(v==null||v===""||(f.type==="boolean"&&v===false))return f.required&&f.type!=="boolean"?S.required:"";if((f.type==="number"||f.type==="money")&&typeof v!=="number")return S.num;if(f.type==="date"&&!/^\d{4}-\d{2}-\d{2}$/.test(v))return S.date;if(f.type==="email"&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))return S.email;if(f.type==="url"&&!/^https?:\/\//i.test(v))return S.url;return""}
function hl(r){var h=CFG.highlight;if(!h)return false;var v=r[h.key];if(h.op==="empty")return v==null||v==="";var x=Number(v),y=Number(h.value);if(h.op==="<=")return typeof v==="number"&&x<=y;if(h.op===">=")return typeof v==="number"&&x>=y;return String(v)===String(h.value)}
function view(){var q=st.q.trim().toLowerCase(),rows=store.rows.filter(function(r){for(var k in st.filters){var fv=st.filters[k];if(fv==="")continue;var f=F.find(function(x){return x.key===k});if(f.type==="boolean"){if(String(r[k]===true)!==fv)return false}else if(String(r[k]==null?"":r[k])!==fv)return false}
if(!q)return true;return F.some(function(f){return f.search&&String(r[f.key]==null?"":r[f.key]).toLowerCase().indexOf(q)>=0})});
if(st.sort){var k=st.sort.key,d=st.sort.dir==="desc"?-1:1;rows.sort(function(a,b){var x=a[k],y=b[k];if(x==null||x==="")return 1;if(y==null||y==="")return -1;return(typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),ZH?"zh":"en",{numeric:true}))*d})}return rows}
function render(){var rows=view(),ps=CFG.pageSize||20,pages=Math.max(1,Math.ceil(rows.length/ps));if(st.page>=pages)st.page=pages-1;var page=rows.slice(st.page*ps,st.page*ps+ps);
$("#thead").innerHTML="<tr>"+LIST.map(function(f){var a=st.sort&&st.sort.key===f.key?(st.sort.dir==="asc"?" ▲":" ▼"):"";return'<th data-k="'+f.key+'">'+esc(f.label)+'<span class="ar">'+a+"</span></th>"}).join("")+"</tr>";
$("#tbody").innerHTML=page.length?page.map(function(r){return'<tr data-id="'+r._id+'"'+(hl(r)?' class="hl"':"")+">"+LIST.map(function(f,i){var v=r[f.key],bad=invalid(f,v);return'<td class="'+((f.type==="number"||f.type==="money")?"num ":"")+(bad?"bad":"")+'"'+(bad?' title="'+esc(bad)+'"':"")+">"+esc(fmt(f,v))+(i===0&&hl(r)?'<span class="tag">'+esc(CFG.highlight.label)+"</span>":"")+"</td>"}).join("")+"</tr>"}).join(""):'<tr><td class="empty" colspan="'+LIST.length+'">'+S.none+"</td></tr>";
$("#count").textContent=(rows.length?(st.page*ps+1)+"–"+(st.page*ps+page.length):"0")+" / "+S.of+" "+rows.length+" "+S.rows;$("#prev").disabled=st.page===0;$("#next").disabled=st.page>=pages-1}
function toast(t){var e=$(".toast");e.textContent=t;e.classList.add("on");clearTimeout(e._t);e._t=setTimeout(function(){e.classList.remove("on")},1800)}
function input(f,v){var id="f_"+f.key,req=f.required?' <span class="req">*</span>':"",h='<div class="fld"><label for="'+id+'">'+esc(f.label)+req+"</label>";
if(f.type==="longtext")h+='<textarea id="'+id+'" name="'+f.key+'">'+esc(v)+"</textarea>";
else if(f.type==="select")h+='<select id="'+id+'" name="'+f.key+'"><option value=""></option>'+(f.options||[]).concat(v&&(f.options||[]).indexOf(v)<0?[v]:[]).map(function(o){return'<option'+(o===v?" selected":"")+">"+esc(o)+"</option>"}).join("")+"</select>";
else if(f.type==="boolean")h+='<input type="checkbox" id="'+id+'" name="'+f.key+'"'+(v===true?" checked":"")+">";
else{var t={number:"number",money:"number",date:"date",email:"email",phone:"tel",url:"url"}[f.type]||"text";h+='<input id="'+id+'" name="'+f.key+'" type="'+t+'"'+(f.type==="money"?' step="0.01"':f.type==="number"?' step="any"':"")+' value="'+esc(v)+'">'}
return h+'<div class="err"></div></div>'}
var editing=null;
function openForm(r){editing=r;var d=$("#dlg");$("#dlgT").textContent=r?S.edit+(CFG.titleField&&r[CFG.titleField]?" · "+r[CFG.titleField]:""):S.newT;$("#fields").innerHTML=F.map(function(f){return input(f,r?r[f.key]:f.type==="boolean"?false:"")}).join("");$("#del").style.display=r?"":"none";d.showModal()}
function readForm(){var o={},ok=true;F.forEach(function(f){var el=$("[name='"+f.key+"']",$("#dlg")),v;if(f.type==="boolean")v=el.checked;else{v=el.value.trim();if((f.type==="number"||f.type==="money")&&v!=="")v=isNaN(Number(v))?v:Number(v)}if(v==="")v=null;var bad=invalid(f,v);
if(!bad&&CFG.keyField===f.key&&v!=null&&store.rows.some(function(x){return x!==editing&&String(x[f.key])===String(v)}))bad=S.dupKey+f.label;el.parentNode.querySelector(".err").textContent=bad;if(bad)ok=false;o[f.key]=v});return ok?o:null}
function csvCell(v){v=v==null?"":String(v);return/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function download(name,text,type){var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type:type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500)}
function parseCsv(t){t=t.replace(/^\uFEFF/,"");var first=t.split(/\r?\n/,1)[0]||"",dl=[",","\t",";"].sort(function(a,b){return first.split(b).length-first.split(a).length})[0],rows=[],row=[],c="",q=false;
for(var i=0;i<t.length;i++){var ch=t[i];if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}else if(ch==='"'&&c==="")q=true;else if(ch===dl){row.push(c);c=""}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&t[i+1]==="\n")i++;row.push(c);rows.push(row);row=[];c=""}else c+=ch}if(c!==""||row.length){row.push(c);rows.push(row)}return rows.filter(function(r){return r.some(function(x){return x.trim()})})}
function fromCell(f,v){v=(v||"").trim();if(f.type==="boolean")return/^(是|yes|y|true|1|✓)$/i.test(v);if(v==="")return null;if(f.type==="number"||f.type==="money"){var n=Number(v.replace(/[,\s¥$€£￥]/g,""));return isNaN(n)?v:n}return v}
document.body.addEventListener("click",function(e){var th=e.target.closest("th[data-k]");if(th){var k=th.dataset.k;st.sort=st.sort&&st.sort.key===k?{key:k,dir:st.sort.dir==="asc"?"desc":"asc"}:{key:k,dir:"asc"};render();return}
var tr=e.target.closest("tbody tr[data-id]");if(tr){openForm(store.rows.find(function(r){return r._id===tr.dataset.id}))}});
$("#q").addEventListener("input",function(e){st.q=e.target.value;st.page=0;render()});
$("#filters").innerHTML=F.filter(function(f){return f.filter}).map(function(f){var opts=f.type==="boolean"?[["true",S.yes],["false",S.no]]:(f.options||[]).map(function(o){return[o,o]});return'<select data-f="'+f.key+'" aria-label="'+esc(f.label)+'"><option value="">'+esc(f.label)+": "+S.all+"</option>"+opts.map(function(o){return'<option value="'+esc(o[0])+'">'+esc(o[1])+"</option>"}).join("")+"</select>"}).join("");
$("#filters").addEventListener("change",function(e){st.filters[e.target.dataset.f]=e.target.value;st.page=0;render()});
$("#add").onclick=function(){openForm(null)};$("#prev").onclick=function(){st.page--;render()};$("#next").onclick=function(){st.page++;render()};
$("#cancel").onclick=function(){$("#dlg").close()};
$("#del").onclick=function(){if(editing&&confirm(S.confirmDel)){store.rows=store.rows.filter(function(r){return r!==editing});persist();$("#dlg").close();render();toast(S.deleted)}};
$("#frm").addEventListener("submit",function(e){e.preventDefault();var o=readForm();if(!o)return;if(editing){for(var k in o)editing[k]=o[k]}else{o._id=uid();store.rows.unshift(o)}persist();$("#dlg").close();render();toast(S.saved)});
$("#exp").onclick=function(){var lines=[F.map(function(f){return csvCell(f.label)}).join(",")].concat(store.rows.map(function(r){return F.map(function(f){var v=r[f.key];return csvCell(f.type==="boolean"?(v?S.yes:S.no):v)}).join(",")}));download(CFG.title+".csv","\uFEFF"+lines.join("\r\n")+"\r\n","text/csv")};
$("#imp").onclick=function(){$("#file").dataset.mode="csv";$("#file").accept=".csv,.tsv,.txt";$("#file").click()};
$("#restore").onclick=function(){$("#file").dataset.mode="json";$("#file").accept=".json";$("#file").click()};
$("#backup").onclick=function(){download(CFG.title+"-backup.json",JSON.stringify({app:CFG.id,exported:new Date().toISOString(),store:store},null,1),"application/json")};
$("#file").addEventListener("change",function(e){var file=e.target.files[0];if(!file)return;file.text().then(function(t){if(e.target.dataset.mode==="json"){var b=JSON.parse(t);if(b&&b.store&&Array.isArray(b.store.rows)){store=b.store;persist();render();toast(S.restored)}}
else{var m=parseCsv(t),head=m[0]||[],idx=F.map(function(f){var i=head.findIndex(function(h){h=h.trim();return h===f.label||h===f.column||h===f.key});return i}),rows=m.slice(1).map(function(c){var o={_id:uid()};F.forEach(function(f,j){o[f.key]=idx[j]>=0?fromCell(f,c[idx[j]]):(f.type==="boolean"?false:null)});return o});
if(confirm(S.importMode))store.rows=store.rows.concat(rows);else store.rows=rows;persist();render();toast(S.imported+" "+rows.length)}e.target.value=""})});
$("#reset").onclick=function(){if(confirm(S.confirmReset)){store=fresh();persist();render()}};
if(stale){var b=$("#banner");b.style.display="";b.innerHTML="<span>"+S.updated+esc(new Date(SEED.date).toLocaleString(ZH?"zh-CN":"en-US",{dateStyle:"medium",timeStyle:"short"}))+S.updated2+'</span><button class="pri" id="loadNew">'+S.load+'</button><button id="keepMine">'+S.keep+"</button>";
$("#loadNew").onclick=function(){store=fresh();persist();b.style.display="none";render()};$("#keepMine").onclick=function(){store.seedVersion=SEED.version;persist();b.style.display="none"}}
render();
})();`;

export function renderApp(cfg: AppConfig, seed: { version: string; date: string; rows: Record<string, unknown>[] }): string {
  const zh = cfg.lang === "zh";
  const t = (a: string, b: string) => (zh ? a : b);
  const e = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html>
<html lang="${zh ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(cfg.title)}</title>
<meta name="generator" content="Sheet To App (ZCode) — ${e(cfg.source)} — ${cfg.generatedAt}">
<style>${CSS}</style></head>
<body>
<header><h1>${e(cfg.title)}</h1><span class="sp"></span>
<button class="pri" id="add">${t("新增", "Add")}</button><button id="exp">${t("导出 CSV", "Export CSV")}</button><button id="imp">${t("导入 CSV", "Import CSV")}</button>
<button id="backup">${t("备份", "Backup")}</button><button id="restore">${t("恢复备份", "Restore backup")}</button><button id="reset">${t("重置为表格数据", "Reset to sheet data")}</button>
<input type="file" id="file" hidden></header>
<main>
<div class="banner" id="banner" style="display:none"></div>
<div class="bar"><input type="search" id="q" placeholder="${t("搜索…", "Search…")}"><span id="filters" class="bar" style="margin:0"></span></div>
<div class="tbl"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
<div class="foot"><span id="count"></span><span><button id="prev">${t("上一页", "Previous")}</button> <button id="next">${t("下一页", "Next")}</button></span></div>
<p style="color:var(--muted);font-size:12px">${t("数据保存在这台电脑的浏览器里。换电脑或清除浏览器数据前，请先“备份”或“导出 CSV”。", "Data is stored in this browser on this computer. Use Backup or Export CSV before switching computers or clearing browser data.")}</p>
</main>
<dialog id="dlg"><form id="frm" method="dialog" novalidate><h2 id="dlgT"></h2><div id="fields"></div>
<div class="acts"><button type="button" class="danger" id="del">${t("删除", "Delete")}</button><span class="sp"></span><button type="button" id="cancel">${t("取消", "Cancel")}</button><button class="pri" type="submit">${t("保存", "Save")}</button></div></form></dialog>
<div class="toast"></div>
<script id="cfg" type="application/json">${json(cfg)}</script>
<script id="seed" type="application/json">${json(seed)}</script>
<script>${JS}</script>
</body></html>
`;
}

/** 面板里用的静态预览（无脚本）：前 15 行。 */
export function staticPreview(cfg: AppConfig, rows: Record<string, unknown>[]): string {
  const e = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const list = cfg.fields.filter((f) => f.list && !f.hidden);
  const fmt = (f: Field, v: unknown) => (v == null ? "" : f.type === "boolean" ? (v === true ? (cfg.lang === "zh" ? "是" : "Yes") : (cfg.lang === "zh" ? "否" : "No")) : f.type === "money" && typeof v === "number" ? v.toFixed(2) : String(v));
  const hl = (r: Record<string, unknown>) => { const h = cfg.highlight; if (!h) return false; const v = r[h.key]; if (h.op === "empty") return v == null || v === ""; if (typeof v !== "number") return h.op === "=" && String(v) === String(h.value); return h.op === "<=" ? v <= Number(h.value) : h.op === ">=" ? v >= Number(h.value) : String(v) === String(h.value); };
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body style="--accent:${e(cfg.accent)}"><header><h1>${e(cfg.title)}</h1><span class="sp"></span><button class="pri">${cfg.lang === "zh" ? "新增" : "Add"}</button><button>${cfg.lang === "zh" ? "导出 CSV" : "Export CSV"}</button></header><main>
<div class="bar"><input type="search" placeholder="${cfg.lang === "zh" ? "搜索…" : "Search…"}">${cfg.fields.filter((f) => f.filter && !f.hidden).map((f) => `<select><option>${e(f.label)}: ${cfg.lang === "zh" ? "全部" : "All"}</option></select>`).join("")}</div>
<div class="tbl"><table><thead><tr>${list.map((f) => `<th>${e(f.label)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 15).map((r) => `<tr${hl(r) ? ' class="hl"' : ""}>${list.map((f, i) => `<td class="${f.type === "number" || f.type === "money" ? "num" : ""}">${e(fmt(f, r[f.key]))}${i === 0 && hl(r) ? `<span class="tag">${e(cfg.highlight!.label)}</span>` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
<div class="foot"><span>1–${Math.min(15, rows.length)} / ${rows.length}</span></div></main></body></html>`;
}
