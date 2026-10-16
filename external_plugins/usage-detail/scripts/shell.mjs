// 仪表盘独立页面壳：主题变量 + 页签行为（serve 本地面板与会话侧栏共用；由 serve.mjs 同步维护）
export const SHELL_CSS = `
:root{
  color-scheme: light dark;
  --background:#ffffff; --foreground:#1a1a1a; --card:#ffffff;
  --muted:#f2f2f3; --muted-foreground:#6b6b70; --border:#e4e4e7;
  --primary:#18181b; --primary-foreground:#ffffff;
  --blue:#2f6bff; --green:#15803d; --red:#dc2626; --yellow:#b45309;
  --viz-series-1:#4066f0; --viz-series-2:#e8890c; --viz-series-3:#0f9d6a;
  --viz-series-4:#ab47bc; --viz-series-5:#d15b5b; --viz-series-6:#2f80c8;
}
@media (prefers-color-scheme: dark){
  :root{
    --background:#1b1b1f; --foreground:#e9e9ec; --card:#232328;
    --muted:#2c2c31; --muted-foreground:#9c9ca6; --border:#3a3a41;
    --primary:#e9e9ec; --primary-foreground:#1b1b1f;
    --blue:#5b8cff; --green:#3fbf7f; --red:#f47166; --yellow:#d9a514;
    --viz-series-1:#6c8cff; --viz-series-2:#e8a15c; --viz-series-3:#5cbf9a;
    --viz-series-4:#c586c0; --viz-series-5:#d16f6f; --viz-series-6:#7fb3e0;
  }
}
*{box-sizing:border-box}
body{margin:0 auto;max-width:1180px;padding:24px 22px 64px;background:var(--background);color:var(--foreground);font:14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Segoe UI",sans-serif;}
h3{font-size:13px;font-weight:600;margin:22px 0 8px;}
p{margin:6px 0}
code{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--muted);border-radius:4px;padding:1px 5px;}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin:10px 0;}
.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;}
.viz-stat-value{font-size:26px;font-weight:600;margin:3px 0 1px;}
.viz-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.viz-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--border);border-radius:12px;margin-bottom:6px;background:var(--card);}
.nav-pills{display:flex;gap:8px;margin:14px 0;flex-wrap:wrap;}
.nav-pills .nav-link{appearance:none;border:1px solid transparent;background:transparent;color:var(--muted-foreground);font:inherit;font-size:13px;padding:5px 14px;border-radius:999px;cursor:pointer;}
.nav-pills .nav-link:hover{color:var(--foreground);}
.nav-pills .nav-link.active{background:var(--primary);color:var(--primary-foreground);font-weight:500;}
.btn{appearance:none;display:inline-block;border:1px solid var(--border);background:var(--card);color:var(--foreground);font:inherit;font-size:13px;padding:5px 14px;border-radius:8px;cursor:pointer;}
.btn:hover{border-color:var(--muted-foreground);}
.btn:disabled{opacity:.45;cursor:default;}
.progress{height:8px;background:var(--muted);border-radius:5px;overflow:hidden;margin-top:6px;}
.progress-bar{height:100%;background:var(--blue);border-radius:5px;transition:width .3s;}
.table{width:100%;border-collapse:collapse;}
.table th{text-align:left;font-weight:500;color:var(--muted-foreground);font-size:12px;}
.table td,.table th{padding:7px 10px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:top;}
.table-responsive{overflow-x:auto;border:1px solid var(--border);border-radius:12px;padding:2px 10px;background:var(--card);}
.text-end{text-align:right}.text-center{text-align:center}.text-nowrap{white-space:nowrap}
.text-muted{color:var(--muted-foreground)}.text-small{font-size:12px}
.text-destructive{color:var(--red)}
.tabular-nums{font-variant-numeric:tabular-nums}
select.form-select,.form-select{border:1px solid var(--border);border-radius:8px;padding:4px 10px;background:var(--background);color:var(--foreground);font:inherit;font-size:13px;}
.form-label{margin:0;}
.form-check{display:inline-flex;align-items:center;gap:6px;margin:0;cursor:pointer;}
.form-check-input{width:14px;height:14px;accent-color:var(--blue);margin:0;}
.form-switch .form-check-input{width:28px;height:16px;appearance:none;border-radius:99px;background:var(--muted);border:1px solid var(--border);position:relative;cursor:pointer;transition:.15s;}
.form-switch .form-check-input:checked{background:var(--blue);border-color:var(--blue);}
.form-switch .form-check-input::before{content:"";position:absolute;top:1px;left:1px;width:12px;height:12px;border-radius:50%;background:#fff;transition:.15s;}
.form-switch .form-check-input:checked::before{left:13px;}
.form-check-label{font-size:12px;}
hr{border:none;border-top:1px solid var(--border);}

:root[data-theme="dark"]{
    --background:#1b1b1f; --foreground:#e9e9ec; --card:#232328;
    --muted:#2c2c31; --muted-foreground:#9c9ca6; --border:#3a3a41;
    --primary:#e9e9ec; --primary-foreground:#1b1b1f;
    --blue:#5b8cff; --green:#3fbf7f; --red:#f47166; --yellow:#d9a514;
    --viz-series-1:#6c8cff; --viz-series-2:#e8a15c; --viz-series-3:#5cbf9a;
    --viz-series-4:#c586c0; --viz-series-5:#d16f6f; --viz-series-6:#7fb3e0;
  }
:root[data-theme="light"]{color-scheme:light}
`;
export const TAB_JS = `
document.querySelectorAll('.nav-pills [role=tab]').forEach(function (t) {
  t.addEventListener('click', function () {
    document.querySelectorAll('.nav-pills [role=tab]').forEach(function (x) {
      x.classList.toggle('active', x === t);
      x.setAttribute('aria-selected', String(x === t));
    });
    document.querySelectorAll('[role=tabpanel]').forEach(function (p) {
      p.hidden = (p.id !== t.getAttribute('aria-controls'));
    });
  });
});
// 支持 #tab hash 定位（侧栏面板跳转：#trend/#blocks/#sessions/#detail/#errors）
(function () {
  var h = (location.hash || '').replace('#', '');
  if (!h) return;
  var btn = document.querySelector('.nav-pills [role=tab][aria-controls="ud-' + h + '"]');
  if (btn) btn.click();
})();

// 主题跟随宿主（window.zcode.hostContext.theme），同时保留系统偏好兜底
(function () {
  function apply() {
    try {
      var t = window.zcode && window.zcode.hostContext && window.zcode.hostContext.theme;
      if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
    } catch (e) {}
  }
  apply();
  try { if (window.zcode && window.zcode.subscribe) window.zcode.subscribe(apply); } catch (e) {}
})();
`;
