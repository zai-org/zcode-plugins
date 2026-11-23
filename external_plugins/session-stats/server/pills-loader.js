/*
 * session-stats pills loader — 注入到渲染层入口的常驻引导。
 * 从本地数据服务拉取 pills.js（内容变化时重新执行，实现免重启热更新）。
 * 数据服务由 session-stats 插件（≥0.2.2）的 MCP 服务器提供。
 */
;(function () {
  "use strict";
  if (window.__SSPILLS_LOADER__) return;
  window.__SSPILLS_LOADER__ = true;

  var SRC = "http://127.0.0.1:31710/pills.js";
  var current = "";

  function tick() {
    fetch(SRC, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (code) {
        // 代码没变且实例还活着 → 跳过；实例死了（被宿主清掉/异常终止）→ 强制重跑
        if (code === current && window.__SSPILLS__) return;
        try {
          (0, eval)(code); // 间接 eval → 全局作用域；pills.js 自带 teardown+重挂
          current = code;  // 只有成功才记住，失败下一轮重试（旧版失败即永久放弃）
        } catch (e) {
          current = "";
        }
      })
      .catch(function () { /* 服务不在：无会话/未装插件，静默 */ });
  }

  tick();
  setInterval(tick, 10000);
})();
