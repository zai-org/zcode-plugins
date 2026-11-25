// 注入每个离线页面的搜索框：⌘K / Ctrl+K 或右上角按钮打开；不需要服务器（索引是 JS 文件，file:// 可加载）。
export const SEARCH_CSS = `#osp-btn{position:fixed;top:12px;right:12px;z-index:2147483000;font:14px system-ui,sans-serif;padding:6px 12px;border-radius:999px;border:1px solid #d0d5dd;background:#fff;color:#344054;box-shadow:0 1px 3px rgba(0,0,0,.12);cursor:pointer}
#osp{position:fixed;inset:0;z-index:2147483001;background:rgba(15,23,42,.45);display:none;align-items:flex-start;justify-content:center;padding-top:10vh;font:15px/1.45 system-ui,sans-serif}
#osp.on{display:flex}#osp .box{width:min(640px,92vw);background:#fff;color:#1d2939;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden}
#osp input{width:100%;box-sizing:border-box;border:0;border-bottom:1px solid #eaecf0;padding:16px 18px;font:inherit;font-size:17px;outline:none}
#osp ul{list-style:none;margin:0;padding:6px;max-height:60vh;overflow:auto}#osp li a{display:block;padding:10px 12px;border-radius:8px;color:inherit;text-decoration:none}
#osp li a:hover,#osp li a.sel{background:#f2f4f7}#osp li b{display:block;color:#b93815}#osp li span{font-size:13px;color:#475467}#osp mark{background:#fef0c7;color:inherit}
#osp .empty{padding:14px 18px;color:#667085;font-size:14px}@media print{#osp-btn{display:none}}`;

export const SEARCH_JS = `(function(){
var me=document.currentScript,root=(me&&me.dataset.root)||"";
var data=window.__OFFLINE_SEARCH;if(!data||!window.MiniSearch)return;
var ms=null;function idx(){return ms||(ms=MiniSearch.loadJSON(data,{fields:["title","text"],storeFields:["title","url","text"],searchOptions:{boost:{title:3},prefix:true,fuzzy:0.2}}))}
var zh=/^zh/i.test(document.documentElement.lang||navigator.language);
var btn=document.createElement("button");btn.id="osp-btn";btn.type="button";btn.textContent=(zh?"搜索":"Search")+(/Mac/.test(navigator.platform)?"  ⌘K":"  Ctrl+K");
var ov=document.createElement("div");ov.id="osp";ov.innerHTML='<div class="box" role="dialog" aria-label="Search"><input type="search" autocomplete="off"><ul></ul></div>';
document.body.appendChild(btn);document.body.appendChild(ov);
var input=ov.querySelector("input"),list=ov.querySelector("ul"),sel=0;input.placeholder=zh?"搜索本站（离线）":"Search this site (offline)";
function esc(s){return s.replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function snip(text,terms){var low=text.toLowerCase(),at=-1;for(var i=0;i<terms.length&&at<0;i++)at=low.indexOf(terms[i].toLowerCase());var s=Math.max(0,at-60),out=esc(text.slice(s,s+180));terms.forEach(function(t){if(t.length>1)out=out.replace(new RegExp("("+t.replace(/[.*+?^$()|[\\]\\\\{}]/g,"\\\\$&")+")","gi"),"<mark>$1</mark>")});return(s>0?"… ":"")+out+" …"}
function run(){var q=input.value.trim();if(!q){list.innerHTML="";return}var r=idx().search(q).slice(0,12);sel=0;
list.innerHTML=r.length?r.map(function(x,i){return '<li><a href="'+esc(root+x.url)+'"'+(i===0?' class="sel"':'')+'><b>'+esc(x.title)+'</b><span>'+snip(x.text,x.terms)+'</span></a></li>'}).join(""):'<div class="empty">'+(zh?"没有结果":"No results")+'</div>'}
function open(){ov.classList.add("on");input.focus();input.select()}function close(){ov.classList.remove("on")}
btn.onclick=open;ov.onclick=function(e){if(e.target===ov)close()};input.oninput=run;
input.onkeydown=function(e){var a=list.querySelectorAll("a");if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(!a.length)return;a[sel].classList.remove("sel");sel=(sel+(e.key==="ArrowDown"?1:a.length-1))%a.length;a[sel].classList.add("sel");a[sel].scrollIntoView({block:"nearest"})}else if(e.key==="Enter"&&a[sel]){location.href=a[sel].href}else if(e.key==="Escape")close()};
document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();open()}else if(e.key==="/"&&!/input|textarea/i.test((e.target.tagName||""))){e.preventDefault();open()}});
})();
`;
