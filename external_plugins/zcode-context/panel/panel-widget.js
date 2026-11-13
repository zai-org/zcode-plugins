/* zcode-context renderer: sidebar entry + context insight dashboard.
 *
 * Injected into ZCode's local renderer pages by panel/inject-main.cjs.
 * Data flows through window.__zcodeContextRequests (renderer -> main) and
 * window.__zcodeContextRequestResult (main -> renderer). All charts are
 * inline SVG; no external libraries. Visual language mirrors the dsh-context
 * reference: dense dark glass panels, thin multi-color donuts, dot+count
 * ranking rows, tabular numerals.
 */
"use strict";
(function () {
  if (window.__zcodeContextPanelBooted) return;
  window.__zcodeContextPanelBooted = true;
  var BOOT_ID = "b" + ((Number(window.__zciBootCounter) || 0) + 1);
  window.__zciBootCounter = Number(window.__zciBootCounter) || 0;
  window.__zciBootCounter += 1;
  window.__zciBoots = window.__zciBoots || [];
  window.__zciBoots.push(BOOT_ID);
  try {
    if (window.__zciObserver) {
      window.__zciObserver.disconnect();
      window.__zciObserver = null;
    }
  } catch {
    // ignore
  }
  try {
    var oldEntry = document.getElementById("zci-entry");
    if (oldEntry) oldEntry.remove();
    document.querySelectorAll(".zci-overlay").forEach(function (el) {
      el.remove();
    });
    var oldStyle = document.getElementById("zci-style");
    if (oldStyle) oldStyle.remove();
  } catch {
    // ignore
  }

  var config = window.__zcodeContextConfig || {};

  /* ---------------------------------------------------------------- */
  /* Styles                                                            */
  /* ---------------------------------------------------------------- */

  var CSS = `
.zci-entry{display:flex;align-items:center;gap:9px;padding:8px 12px;margin:2px 10px;border-radius:10px;cursor:pointer;color:#aeb4c0;font-size:13px;user-select:none;transition:background .15s,color .15s}
.zci-entry:hover{background:rgba(255,255,255,.08);color:#fff}
.zci-entry svg{flex:0 0 auto}

.zci-overlay{position:fixed;inset:0;z-index:99990;display:flex;flex-direction:column;color:#e6e9f0;font-size:12px;line-height:1.5;overflow:hidden;
  font-family:-apple-system,'Segoe UI',system-ui,'PingFang SC','Microsoft YaHei',sans-serif;
  background:#0d0f13;background-image:radial-gradient(1000px 460px at 20% -10%,rgba(70,110,255,.12),transparent 60%),radial-gradient(800px 420px at 90% -8%,rgba(34,211,197,.06),transparent 60%)}
.zci-head{display:flex;align-items:center;gap:12px;padding:14px 20px 8px;flex:0 0 auto}
.zci-title h1{font-size:16px;font-weight:700;margin:0}
.zci-title .sub{font-size:11px;color:#757d8c}
.zci-spacer{flex:1}
.zci-seg{display:flex;gap:2px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.07);border-radius:999px;padding:2px}
.zci-seg .zci-pill{border:none;background:transparent;color:#a6adba;border-radius:999px;padding:4px 13px;cursor:pointer;font-size:12px;transition:all .15s}
.zci-seg .zci-pill:hover{color:#fff}
.zci-seg .zci-pill.zci-on{background:linear-gradient(135deg,#5b8cff,#3b6dff);color:#fff}
.zci-link{border:none;background:transparent;color:#8b93a3;cursor:pointer;font-size:12px;padding:4px 6px}
.zci-link:hover{color:#fff}
.zci-link.zci-on{color:#fff;text-shadow:0 0 8px rgba(255,255,255,.35)}
.zci-iconbtn{width:30px;height:30px;border-radius:50%;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.05);color:#c6ccd8;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .15s}
.zci-iconbtn:hover{background:rgba(255,255,255,.12);color:#fff}
.zci-iconbtn.zci-accent{background:linear-gradient(135deg,#5b8cff,#3b6dff);border-color:transparent;color:#fff}
.zci-tabs{display:flex;gap:4px;padding:2px 20px 12px;flex:0 0 auto}
.zci-tab{padding:6px 16px;cursor:pointer;border-radius:999px;color:#9aa1af;font-size:12px;transition:all .15s}
.zci-tab:hover{color:#e6e9f0;background:rgba(255,255,255,.05)}
.zci-tab.zci-on{color:#fff;background:linear-gradient(135deg,rgba(91,140,255,.85),rgba(59,109,255,.85))}
.zci-body{flex:1;overflow:auto;padding:2px 20px 44px}
.zci-grid>*,.zci-row>*,.zci-row-2>*,.zci-row-3>*{min-width:0}

.zci-card{background:rgba(10,12,16,.72);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:13px 15px;backdrop-filter:blur(14px);transition:border-color .15s}
.zci-card.zci-hover{cursor:pointer;transition:border-color .15s,background .15s}
.zci-card.zci-hover:hover{border-color:rgba(120,150,255,.4);background:rgba(18,22,30,.8)}
.zci-card h3{margin:0 0 10px;font-size:12px;font-weight:650;color:#cdd3de;display:flex;align-items:center;gap:7px}
.zci-card h3 .zci-ico{width:7px;height:7px;border-radius:50%;display:inline-block}
.zci-card h3 .zci-cnt{margin-left:auto;color:#757d8c;font-weight:400;font-size:11px;font-variant-numeric:tabular-nums}

.zci-top{display:grid;grid-template-columns:1fr 320px;gap:10px}
.zci-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.zci-kpi{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:14px 10px;min-height:86px}
.zci-kpi .zci-kpi-label{font-size:12px;color:#8b93a3}
.zci-kpi .zci-kpi-value{font-size:23px;font-weight:750;margin:5px 0 2px;color:#f2f5fb;font-variant-numeric:tabular-nums;letter-spacing:.3px}
.zci-kpi .zci-kpi-sub{font-size:11px;color:#5f6675}

.zci-row{display:grid;gap:10px;grid-template-columns:1fr 1fr;align-items:stretch;margin-top:10px}
.zci-row-2{display:grid;gap:10px;grid-template-columns:1fr 1fr;align-items:stretch;margin-top:10px}
.zci-row-3{display:grid;gap:10px;grid-template-columns:1.2fr 1fr 1fr 1fr;align-items:stretch;margin-top:10px}

/* donut + legend */
.zci-donut-wrap{display:flex;gap:16px;align-items:center}
.zci-legend{flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px;align-content:center}
.zci-legend.zci-2col{grid-template-columns:repeat(2,1fr)}
.zci-lg{display:flex;flex-direction:column;gap:1px}
.zci-lg .l1{display:flex;align-items:center;gap:6px;color:#a6adba;font-size:11px;white-space:nowrap}
.zci-lg .l1 .dot{width:8px;height:8px;border-radius:2.5px;flex:0 0 auto}
.zci-lg .l1 .pct{margin-left:auto;color:#e6e9f0;font-weight:600;font-variant-numeric:tabular-nums}
.zci-lg .l2{padding-left:14px;color:#757d8c;font-size:11px;font-variant-numeric:tabular-nums}

/* ranking rows: dot + name + xN with thin colored underline */
.zci-rank{display:flex;flex-direction:column}
.zci-rank-row{padding:4px 2px 3px;cursor:default}
.zci-rank-row:hover{background:rgba(255,255,255,.04);border-radius:6px}
.zci-rank-row .r1{display:flex;align-items:center;gap:7px}
.zci-rank-row .dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.zci-rank-row .name{flex:1;color:#b8bfcc;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zci-rank-row .n{color:#8b93a3;font-variant-numeric:tabular-nums;font-size:11px}
.zci-rank-row .bar{height:2px;border-radius:1px;margin-top:3px;background:rgba(255,255,255,.04);position:relative;overflow:hidden}
.zci-rank-row .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:1px}

/* usage tall chart */
.zci-usage{display:flex;flex-direction:column}
.zci-usage svg{flex:1}

/* heatmap */
.zci-heat-tools{display:flex;align-items:center;gap:8px;margin-left:auto}
.zci-heat{padding:2px 0}
.zci-heat text{font-size:9px;fill:#6d7484}

/* timeline strip */
.zci-timeline{margin-top:10px}
.zci-timeline .bar{height:6px;border-radius:3px;overflow:hidden;display:flex;background:rgba(255,255,255,.05)}
.zci-timeline .bar span{height:100%}
.zci-timeline .ticks{display:flex;justify-content:space-between;color:#5f6675;font-size:10px;margin-top:3px;font-variant-numeric:tabular-nums}

/* sessions */
.zci-sess-head{display:flex;align-items:center;gap:10px;margin:12px 0 8px}
.zci-sess-head h2{margin:0;font-size:13px;font-weight:650;color:#cdd3de;display:flex;align-items:center;gap:7px}
.zci-sess-head h2 .zci-ico{width:7px;height:7px;border-radius:50%;background:#5b8cff}
.zci-sess-head .zci-spacer{flex:1}
.zci-search{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:999px;color:#e6e9f0;font-size:12px;padding:5px 14px;width:210px;outline:none}
.zci-search:focus{border-color:rgba(120,150,255,.5)}
.zci-chips{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}
.zci-chip{font-size:11px;padding:3px 10px;border-radius:999px;background:rgba(91,140,255,.14);color:#9db9ff;border:1px solid rgba(91,140,255,.28);cursor:pointer;white-space:nowrap}
.zci-chip:hover{background:rgba(91,140,255,.25)}
.zci-chip.zci-on{background:linear-gradient(135deg,#5b8cff,#3b6dff);color:#fff;border-color:transparent}
.zci-chip.zci-plain{background:rgba(255,255,255,.05);color:#a6adba;border-color:rgba(255,255,255,.1)}
.zci-chip.zci-amber{background:rgba(247,185,85,.14);color:#f7cd85;border-color:rgba(247,185,85,.3);cursor:default}

.zci-sessions{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.zci-scard{display:flex;flex-direction:column;gap:7px}
.zci-scard .zci-shead{display:flex;align-items:center;gap:6px}
.zci-scard .t{font-weight:650;font-size:12px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6e9f0}
.zci-scard .time{color:#5f6675;font-size:10px;white-space:nowrap}
.zci-scard .zci-smid{display:flex;align-items:center;gap:10px}
.zci-scard .zci-sstats{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:11px;color:#8b93a3}
.zci-scard .zci-sstats b{color:#dfe3ec;font-weight:600;font-variant-numeric:tabular-nums}
.zci-scard .zci-sstats .wide{grid-column:1/-1}
.zci-scard .zci-slast{font-size:11px;color:#5f6675;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* detail header stats */
.zci-dstats{display:flex;gap:0;align-items:stretch;flex-wrap:wrap}
.zci-dstat{flex:1;text-align:center;padding:2px 14px;border-right:1px solid rgba(255,255,255,.06)}
.zci-dstat:last-child{border-right:none}
.zci-dstat .v{font-size:20px;font-weight:750;color:#f2f5fb;font-variant-numeric:tabular-nums}
.zci-dstat .l{font-size:11px;color:#8b93a3}
.zci-dstat .s{font-size:10px;color:#5f6675}
.zci-io-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:#a6adba;margin-top:9px;padding-top:9px;border-top:1px dashed rgba(255,255,255,.07)}
.zci-io-line .n{color:#5f6675;font-variant-numeric:tabular-nums}
.zci-io-line .tot{margin-left:auto;color:#757d8c;font-variant-numeric:tabular-nums}

/* context bar */
.zci-ctx-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.zci-ctx-head .big{font-size:19px;font-weight:750;color:#f2f5fb;font-variant-numeric:tabular-nums}
.zci-ctx-head .big small{font-size:12px;color:#8b93a3;font-weight:400}
.zci-ctx-head .pct{margin-left:auto;font-size:12px;color:#cdd3de}
.zci-ctx-head .pct b{font-size:15px;color:#f2f5fb}
.zci-ctxbar{position:relative;height:14px;border-radius:7px;overflow:hidden;display:flex;background:rgba(255,255,255,.05);margin:10px 0 8px}
.zci-ctxbar .seg{height:100%}
.zci-ctxbar .reserve{height:100%;background:repeating-linear-gradient(135deg,rgba(255,255,255,.12) 0 5px,transparent 5px 10px)}
.zci-ctxline{height:8px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden;display:flex}
.zci-ctxline .seg{height:100%}
.zci-ctx-leg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 16px;margin-top:8px}
.zci-ctx-leg .zci-lg .l2{font-size:10px}

/* cost composition */
.zci-cost-head{display:flex;gap:26px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
.zci-cost-head .item{display:flex;flex-direction:column}
.zci-cost-head .item .v{font-size:20px;font-weight:750;color:#f2f5fb;font-variant-numeric:tabular-nums}
.zci-cost-head .item .l{font-size:11px;color:#8b93a3}
.zci-cost-head .item .s{font-size:10px;color:#5f6675}
.zci-cost-donut{display:flex;gap:18px;align-items:center}
.zci-donut-100{position:relative}
.zci-donut-100 .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.zci-donut-100 .c .v{font-size:16px;font-weight:750;color:#2bd576}
.zci-donut-100 .c .l{font-size:10px;color:#757d8c}

/* trend */
.zci-trend-tools{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.zci-trend-tools .grp{margin-left:auto;display:flex;gap:2px;background:rgba(255,255,255,.06);border-radius:999px;padding:2px}
.zci-trend-tools .grp:first-of-type{margin-left:0}

/* events & files */
.zci-events{max-height:320px;overflow:auto;font-size:11px;padding-right:4px}
.zci-ev{display:flex;gap:8px;padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.05);align-items:baseline}
.zci-ev:last-child{border-bottom:none}
.zci-ev .k{flex:0 0 74px;color:#5f6675;font-variant-numeric:tabular-nums}
.zci-ev .tag{flex:0 0 66px;font-size:10px;padding:1px 7px;border-radius:999px;text-align:center;border:1px solid}
.zci-ev .tag.zci-t-tool{color:#9db9ff;border-color:rgba(91,140,255,.35);background:rgba(91,140,255,.1)}
.zci-ev .tag.zci-t-compact{color:#f7cd85;border-color:rgba(247,185,85,.35);background:rgba(247,185,85,.1)}
.zci-ev .tag.zci-t-error{color:#ff8fa0;border-color:rgba(255,107,129,.4);background:rgba(255,107,129,.12)}
.zci-ev .tag.zci-t-msg{color:#a3b3c9;border-color:rgba(255,255,255,.14);background:rgba(255,255,255,.05)}
.zci-ev .txt{flex:1;min-width:0;color:#b8bfcc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.zci-files{font-size:11px}
.zci-files .fhead{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.zci-file{display:flex;gap:8px;padding:4px 8px;border-radius:6px;align-items:center}
.zci-file:hover{background:rgba(255,255,255,.05)}
.zci-file .p{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#b8bfcc;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}
.zci-file .c{color:#8b93a3;font-variant-numeric:tabular-nums;flex:0 0 auto;font-size:10px}
.zci-file .c b{color:#2bd576;font-weight:600}
.zci-file .c i{color:#ff8fa0;font-style:normal;font-weight:600}

/* context browser (right rail) */
.zci-browser{display:flex;flex-direction:column;gap:6px}
.zci-brow-row{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:7px 10px}
.zci-brow-row .r1{display:flex;align-items:center;gap:7px;font-size:11px;color:#cdd3de}
.zci-brow-row .r1 .dot{width:7px;height:7px;border-radius:50%}
.zci-brow-row .r1 .name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zci-brow-row .r1 .items{color:#757d8c}
.zci-brow-row .r1 .add{color:#2bd576;font-variant-numeric:tabular-nums}
.zci-brow-row .r1 .val{color:#8b93a3;font-variant-numeric:tabular-nums;margin-left:auto}
.zci-brow-row .r1 .pct{color:#5f6675;font-variant-numeric:tabular-nums}

/* formation */
.zci-banner{display:flex;align-items:center;gap:12px;border-radius:12px;padding:14px 18px;margin-bottom:10px;
  background:linear-gradient(120deg,rgba(122,90,248,.55),rgba(59,109,255,.45));border:1px solid rgba(167,139,250,.3)}
.zci-banner .t{font-size:16px;font-weight:750;color:#fff}
.zci-banner .d{font-size:11px;color:rgba(255,255,255,.75)}
.zci-banner .stats{margin-left:auto;display:flex;gap:8px}
.zci-banner .stat{background:rgba(0,0,0,.25);border-radius:8px;padding:5px 12px;text-align:center;min-width:56px}
.zci-banner .stat .v{font-size:15px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
.zci-banner .stat .l{font-size:10px;color:rgba(255,255,255,.7)}

.zci-net{position:relative}
.zci-node{display:flex;flex-direction:column;gap:6px}
.zci-node .zci-ahead{display:flex;align-items:center;gap:8px}
.zci-badge{width:26px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex:0 0 auto}
.zci-node .name{font-weight:650;font-size:12px;color:#e6e9f0}
.zci-node .val{font-size:11px;color:#8b93a3;font-variant-numeric:tabular-nums}
.zci-node .pbar{height:6px;border-radius:3px;background:rgba(255,255,255,.06);overflow:hidden}
.zci-node .pbar i{display:block;height:100%;border-radius:3px}
.zci-node .meta{font-size:10px;color:#5f6675;display:flex;gap:10px}
.zci-net-children{margin:8px 0 0 13px;padding-left:16px;border-left:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;gap:8px}

.zci-empty{padding:40px 16px;text-align:center;color:#5f6675;font-size:12px}
.zci-err{color:#ff8fa0;padding:16px 20px;font-size:13px}
.zci-err + pre{white-space:pre-wrap;font-size:11px;color:#ff8fa0;padding:0 20px 16px;margin:0;opacity:.8}
.zci-note{font-size:11px;color:#757d8c}
.zci-trend-toggle{display:flex;gap:2px;background:rgba(255,255,255,.06);border-radius:999px;padding:2px;width:fit-content;margin-bottom:8px}
.zci-trend-toggle .zci-pill{border:none;background:transparent;color:#a6adba;border-radius:999px;padding:3px 12px;cursor:pointer;font-size:11px}
.zci-trend-toggle .zci-pill.zci-on{background:rgba(91,140,255,.4);color:#fff}
.zci-back{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.zci-back .t{font-weight:700;font-size:14px;color:#e6e9f0}
.zci-btn{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#c6ccd8;border-radius:999px;padding:4px 14px;cursor:pointer;font-size:12px}
.zci-btn:hover{background:rgba(255,255,255,.12);color:#fff}

/* global tooltip */
.zci-tip{position:fixed;z-index:100000;pointer-events:none;background:rgba(16,19,26,.96);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 11px;font-size:11px;color:#dfe3ec;line-height:1.55;box-shadow:0 6px 24px rgba(0,0,0,.5);max-width:340px;display:none;font-variant-numeric:tabular-nums}
.zci-tip b{color:#fff;font-weight:650}
.zci-tip .dim{color:#8b93a3}

/* clickable rows / cells */
.zci-rank-row.zci-ck{cursor:pointer}
.zci-rank-row.zci-ck:hover{background:rgba(255,255,255,.06)}
.zci-rank-row.zci-sel{background:rgba(91,140,255,.16);border-radius:6px;outline:1px solid rgba(91,140,255,.4)}
.zci-rank-row.zci-sel .name{color:#fff}
.zci-heat rect[data-day]{cursor:pointer}
.zci-heat rect[data-day]:hover{stroke:#fff;stroke-width:1}
.zci-kpi.zci-ck{cursor:pointer}
.zci-dseg{cursor:pointer;transition:opacity .12s}
.zci-dimmed{opacity:.18}
.zci-lg.zci-lgck{cursor:default;border-radius:5px;padding:1px 3px;transition:background .12s}
.zci-lg.zci-lgck:hover{background:rgba(255,255,255,.05)}

/* ctx bar segments */
.zci-ctxbar .seg{cursor:pointer;transition:filter .12s}
.zci-ctxbar .seg:hover{filter:brightness(1.35)}
.zci-ctxbar .seg.zci-seg-hot{outline:1.5px solid #fff;outline-offset:-1px;filter:brightness(1.35)}
.zci-ctxbar .reserve{cursor:help}

/* trend hover + pinned detail */
.zci-trend-hit{cursor:pointer}
.zci-trend-hit:hover{fill:rgba(255,255,255,.07)}
.zci-xhair{pointer-events:none}
.zci-reqdetail{margin-top:8px;border:1px dashed rgba(91,140,255,.4);border-radius:8px;padding:8px 12px;background:rgba(91,140,255,.08);display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:#a6adba;align-items:center}
.zci-reqdetail b{color:#f2f5fb;font-variant-numeric:tabular-nums;font-weight:650}
.zci-reqdetail .x{margin-left:auto;color:#757d8c;cursor:pointer}
.zci-reqdetail .x:hover{color:#fff}

/* events expand + pills */
.zci-ev{cursor:pointer}
.zci-ev.open .txt{white-space:normal;overflow:visible}
.zci-ev .more{color:#5b8cff;font-size:10px;flex:0 0 auto}
.zci-dstat.zci-ck{cursor:pointer;border-radius:8px}
.zci-dstat.zci-ck:hover{background:rgba(255,255,255,.05)}
.zci-dstat.zci-ck .s{color:#5b8cff}

/* files */
.zci-file{cursor:pointer}
.zci-file .fmeta{flex:0 0 auto;color:#5f6675;font-size:10px}
.zci-file .fdetail{flex-basis:100%;color:#757d8c;font-size:10px;padding-left:4px;display:none}
.zci-file.open .fdetail{display:block}
.zci-file.open{background:rgba(91,140,255,.08);flex-wrap:wrap}
.zci-filesearch{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:999px;color:#e6e9f0;font-size:11px;padding:3px 12px;width:170px;outline:none}

/* browser rows collapsible */
.zci-brow-row{cursor:pointer;transition:background .12s,border-color .12s}
.zci-brow-row:hover{background:rgba(255,255,255,.08);border-color:rgba(120,150,255,.35)}
.zci-brow-row.zci-bhot{border-color:rgba(120,150,255,.55);background:rgba(91,140,255,.12)}
.zci-brow-row .bdetail{display:none;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.08);font-size:10px;color:#8b93a3;line-height:1.6;max-height:180px;overflow:auto}
.zci-brow-row.open .bdetail{display:block}
.zci-brow-row .caret{font-size:9px;color:#5f6675;flex:0 0 auto;transition:transform .15s}
.zci-brow-row.open .caret{transform:rotate(90deg)}
.zci-brow-row .bdetail .tnames{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.zci-brow-row .bdetail .tnames span{background:rgba(255,255,255,.07);border-radius:4px;padding:1px 6px;font-family:ui-monospace,Consolas,monospace;font-size:10px}

/* agent nodes */
.zci-node.zci-ck{cursor:pointer}
.zci-node .pbar{position:relative}
.zci-net.zci-dimnet .zci-node{opacity:.25;transition:opacity .15s}
.zci-net.zci-dimnet .zci-node.zci-chain{opacity:1}
.zci-press-ok{background:rgba(43,213,118,.7)}
.zci-press-warn{background:rgba(245,158,66,.85)}
.zci-press-hot{background:rgba(255,107,129,.9)}
`;

  function ensureStyle() {
    if (document.getElementById("zci-style")) return;
    var style = document.createElement("style");
    style.id = "zci-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ---------------------------------------------------------------- */
  /* Data plumbing                                                     */
  /* ---------------------------------------------------------------- */

  var requestSeq = 0;
  window.__zciPending = window.__zciPending || new Map();
  var pending = window.__zciPending;
  window.__zciDeliveredLog = [];

  window.__zcodeContextRequestResult = function (id, result) {
    try {
      window.__zciDeliveredLog.push({ id: id, at: Date.now(), type: typeof result, ok: result ? result.ok : null });
      if (window.__zciDeliveredLog.length > 20) window.__zciDeliveredLog.shift();
    } catch {
      // diagnostics only
    }
    var entry = pending.get(id);
    if (!entry) {
      window.__zciOrphans = window.__zciOrphans || [];
      window.__zciOrphans.push({ id: id, boot: BOOT_ID, at: Date.now() });
      if (window.__zciOrphans.length > 20) window.__zciOrphans.shift();
      return;
    }
    pending.delete(id);
    if (result && result.ok === false) entry.reject(new Error(result.error?.message || "查询失败"));
    else entry.resolve(result);
  };

  window.__zcodeContextDebugInfo = function () {
    return {
      boot: BOOT_ID,
      boots: window.__zciBoots,
      booted: true,
      tab: state.tab,
      loading: state.loading,
      error: state.error ? String(state.error).slice(0, 120) : null,
      pending: Array.from(pending.keys()),
      queue: Array.isArray(window.__zcodeContextRequests) ? window.__zcodeContextRequests.length : -1,
      delivered: window.__zciDeliveredLog.slice(-8),
      orphans: (window.__zciOrphans || []).slice(-5),
      overlayShown: state.overlayEl ? state.overlayEl.style.display !== "none" : false,
    };
  };

  function query(op, args) {
    return new Promise(function (resolve, reject) {
      var id = "q" + ++requestSeq;
      pending.set(id, { resolve: resolve, reject: reject });
      window.__zcodeContextRequests = window.__zcodeContextRequests || [];
      window.__zcodeContextRequests.push({ id: id, op: op, args: args || {}, boot: BOOT_ID });
      setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("查询超时"));
        }
      }, 95000);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Formatting helpers                                                */
  /* ---------------------------------------------------------------- */

  function fmtTokens(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k";
    return String(Math.round(n));
  }
  function fmtCost(n) {
    return "¥" + (Number(n) || 0).toFixed(2);
  }
  function fmtDuration(ms) {
    ms = Number(ms) || 0;
    if (ms >= 3600000) return Math.floor(ms / 3600000) + "h" + Math.round((ms % 3600000) / 60000) + "m";
    if (ms >= 60000) return Math.floor(ms / 60000) + "m" + Math.round((ms % 60000) / 1000) + "s";
    return Math.round(ms / 1000) + "s";
  }
  function fmtPct(p) {
    return ((Number(p) || 0) * 100).toFixed(1) + "%";
  }
  function fmtTime(ts) {
    if (!ts) return "-";
    var d = new Date(Number(ts));
    return d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  var C = {
    blue: "#4b7bff",
    green: "#2bd576",
    amber: "#f59e42",
    red: "#ff6b81",
    purple: "#a78bfa",
    cyan: "#22d3c5",
    magenta: "#e04fa3",
    gray: "#697182",
  };
  var RANK_COLORS = [C.amber, C.green, C.red, C.blue, C.cyan, C.purple, C.magenta, "#8fa0b8", "#d0a24a", "#5ec9b0"];

  /* ---------------------------------------------------------------- */
  /* Global floating tooltip (140ms delay, follows the cursor)         */
  /* ---------------------------------------------------------------- */

  var tipEl = null;
  var tipTimer = null;
  function tipEnsure() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "zci-tip";
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function tipShow(html, x, y) {
    var el = tipEnsure();
    el.innerHTML = html;
    el.style.display = "block";
    var w = el.offsetWidth || 160;
    var h = el.offsetHeight || 40;
    var px = Math.min(x + 14, window.innerWidth - w - 10);
    var py = y + 16;
    if (py + h > window.innerHeight - 8) py = y - h - 10;
    el.style.left = Math.max(6, px) + "px";
    el.style.top = Math.max(6, py) + "px";
  }
  function tipHide() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    if (tipEl) tipEl.style.display = "none";
  }
  /** Bind [data-tip] elements under root: hover shows the floating tooltip. */
  function bindTips(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("[data-tip]").forEach(function (el) {
      if (el.__zciTip) return;
      el.__zciTip = true;
      el.addEventListener("mousemove", function (e) {
        var html = el.getAttribute("data-tip");
        if (!html) return;
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(function () { tipShow(html, e.clientX, e.clientY); }, 140);
      });
      el.addEventListener("mouseleave", tipHide);
      el.addEventListener("mousedown", tipHide);
    });
  }

  /** Donut hover <-> legend highlight within each .zci-donut-wrap. */
  function linkDonuts(root) {
    if (!root) return;
    root.querySelectorAll(".zci-donut-wrap").forEach(function (wrap) {
      if (wrap.__zciLinked) return;
      wrap.__zciLinked = true;
      var segs = wrap.querySelectorAll(".zci-dseg");
      var rows = wrap.querySelectorAll("[data-lkey]");
      function setHot(key) {
        segs.forEach(function (s) {
          s.classList.toggle("zci-dimmed", key != null && s.getAttribute("data-dkey") !== key);
        });
        rows.forEach(function (r) {
          r.classList.toggle("zci-dimmed", key != null && r.getAttribute("data-lkey") !== key);
          r.style.background = r.getAttribute("data-lkey") === key ? "rgba(255,255,255,.07)" : "";
        });
      }
      wrap.addEventListener("mouseover", function (e) {
        var t = e.target.closest("[data-dkey],[data-lkey]");
        setHot(t ? t.getAttribute("data-dkey") || t.getAttribute("data-lkey") : null);
      });
      wrap.addEventListener("mouseleave", function () { setHot(null); });
    });
  }

  /** One delegated pass: tooltips, donut linking, filter chips. Call after each innerHTML write. */
  function bindAll(root) {
    bindTips(root);
    linkDonuts(root);
  }


  /* ---------------------------------------------------------------- */
  /* SVG chart helpers                                                 */
  /* ---------------------------------------------------------------- */

  function donut(parts, size, thickness, centerLabel, centerSub) {
    size = size || 118;
    thickness = thickness || 13;
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
    var r = (size - thickness) / 2 - 1;
    var c = size / 2;
    var circ = 2 * Math.PI * r;
    var shown = parts.filter(function (p) { return p.value > 0; });
    var gap = shown.length > 1 ? 2 : 0;
    var offset = 0;
    var segs = "";
    if (total <= 0) {
      segs = '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="' + thickness + '"/>';
    } else {
      shown.forEach(function (p) {
        var frac = p.value / total;
        var len = Math.max(0.5, frac * circ - gap);
        var tip = p.tip || (p.label + (p.valueText ? " " + p.valueText : ""));
        segs +=
          '<circle class="zci-dseg" data-dkey="' + esc(String(p.key != null ? p.key : p.label)) +
          (tip ? '" data-tip="' + esc("<b>" + p.label + "</b>" + (p.valueText ? " " + p.valueText : "") + " · " + ((frac * 100).toFixed(1) + "% 占比")) : "") +
          '" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + p.color +
          '" stroke-width="' + thickness + '" stroke-linecap="round" stroke-dasharray="' + len + " " + (circ - len) +
          '" stroke-dashoffset="' + -offset + '" transform="rotate(-90 ' + c + " " + c + ')"></circle>';
        offset += frac * circ;
      });
    }
    var center = "";
    if (centerLabel) {
      // adaptive center font: small donuts (mini rings) shrink to fit
      var bigFs = size <= 64 ? (String(centerLabel).length > 4 ? 8 : 10) : String(centerLabel).length > 6 ? 12 : 15;
      var subFs = size <= 64 ? 7 : 9;
      var subDy = size <= 64 ? 10 : 14;
      center =
        '<text x="' + c + '" y="' + (c - 1) + '" text-anchor="middle" font-size="' + bigFs + '" font-weight="700" fill="#f2f5fb">' + esc(centerLabel) + "</text>" +
        '<text x="' + c + '" y="' + (c + subDy) + '" text-anchor="middle" font-size="' + subFs + '" fill="#757d8c">' + esc(centerSub || "") + "</text>";
    }
    return '<svg width="' + size + '" height="' + size + '" style="flex:0 0 auto">' + segs + center + "</svg>";
  }

  /** dsh-style legend: label + pct on first line, ≈value on second. */
  function legendGrid(parts, opts) {
    opts = opts || {};
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0);
    var cls = "zci-legend" + (opts.cols === 2 ? " zci-2col" : "");
    var rows = parts
      .filter(function (p) { return p.value > 0 || opts.showZero; })
      .map(function (p) {
        var pct = total > 0 ? ((p.value / total) * 100).toFixed(1) + "%" : "0%";
        var val = p.valueText || fmtTokens(p.value);
        var tip = p.tip ? '" data-tip="' + esc(p.tip) : "";
        return (
          '<div class="zci-lg zci-lgck" data-lkey="' + esc(String(p.key != null ? p.key : p.label)) + tip + '"><div class="l1"><span class="dot" style="background:' + p.color + '"></span>' +
          '<span class="name">' + esc(p.label) + '</span><span class="pct">' + pct + '</span></div>' +
          '<div class="l2">≈' + esc(val) + "</div></div>"
        );
      })
      .join("");
    return '<div class="' + cls + '">' + rows + "</div>";
  }

  /** ranking rows: dot + name + ×n + thin colored underline.
   *  With opts.filterType the rows become clickable session-card filters. */
  function rankRows(items, colorFn, opts) {
    opts = opts || {};
    var max = 1;
    items.forEach(function (it) {
      max = Math.max(max, it.calls);
    });
    var total = items.reduce(function (a, it) { return a + it.calls; }, 0) || 1;
    return items
      .map(function (it, i) {
        var col = colorFn(it, i);
        var pct = Math.max(2, (it.calls / max) * 100);
        var clickable = Boolean(opts.filterType);
        var selected = clickable && state.filter && state.filter.type === opts.filterType && String(state.filter.value) === String(it.name);
        var cls = "zci-rank-row" + (clickable ? " zci-ck" : "") + (selected ? " zci-sel" : "");
        var tip = it.tip || ("<b>" + esc(it.name) + "</b> ×" + it.calls + " · " + ((it.calls / total) * 100).toFixed(1) + "% 占比" + (clickable ? "<div class='dim'>点击筛选相关会话</div>" : ""));
        return (
          '<div class="' + cls + '"' +
          (clickable ? ' data-ft="' + opts.filterType + '" data-fv="' + esc(it.name) + '"' : "") +
          (tip ? ' data-tip="' + tip + '"' : "") +
          '><div class="r1">' +
          '<span class="dot" style="background:' + col + '"></span><span class="name">' + esc(it.name) +
          '</span><span class="n">×' + it.calls + "</span></div>" +
          '<div class="bar"><i style="width:' + pct + "%;background:" + col + '"></i></div></div>'
        );
      })
      .join("");
  }

  /** Delegated click binding for [data-ft]/[data-fv] filter rows + filter chip. */
  function bindFilterRows(root, rerender) {
    if (!root) return;
    root.querySelectorAll("[data-ft]").forEach(function (el) {
      if (el.__zciF) return;
      el.__zciF = true;
      el.addEventListener("click", function () {
        var type = el.getAttribute("data-ft");
        var value = el.getAttribute("data-fv");
        if (state.filter && state.filter.type === type && String(state.filter.value) === value) state.filter = null;
        else state.filter = { type: type, value: value, label: value };
        rerender();
      });
    });
  }

  function filterChipHtml() {
    if (!state.filter) return "";
    return '<div class="zci-chips"><span class="zci-chip zci-on" data-fclear="1">筛选：' + esc(state.filter.label) + " ✕</span>" +
      '<span class="zci-note" style="align-self:center">再次点击排行行或此标签取消筛选</span></div>';
  }

  /** Apply state.filter to a session card list. */
  function applyCardFilter(list) {
    if (!state.filter) return list;
    var f = state.filter;
    return list.filter(function (card) {
      if (f.type === "tool") return ((card.tools || []).some(function (t) { return t.tool === f.value; }));
      if (f.type === "cmd") {
        var bash = (card.tools || []).some(function (t) { return t.tool === "Bash" || t.tool === "PowerShell" || t.tool === "pwsh"; });
        return bash;
      }
      if (f.type === "proj") return card.workspace === f.value;
      if (f.type === "day") {
        var d = new Date(Number(card.lastActiveAt) || 0);
        var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        return key === f.value;
      }
      return true;
    });
  }

  /** tall usage chart with y-axis labels and thin paired bars */
  function usageChart(series) {
    if (!series.length) return '<div class="zci-empty">暂无数据</div>';
    var w = 300;
    var h = 240;
    var padL = 40;
    var padB = 22;
    var plotW = w - padL - 6;
    var plotH = h - padB - 10;
    var max = 1;
    series.forEach(function (s) { max = Math.max(max, s.tokens); });
    var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (f) { return { v: max * f, y: 10 + plotH - f * plotH }; });
    var n = series.length;
    var slot = plotW / n;
    var bw = Math.min(9, slot * 0.4);
    var svg = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">';
    ticks.forEach(function (t) {
      svg += '<text x="' + (padL - 5) + '" y="' + (t.y + 3) + '" text-anchor="end">' + fmtTokens(t.v) + "</text>";
      svg += '<line x1="' + padL + '" y1="' + t.y + '" x2="' + (w - 4) + '" y2="' + t.y + '" stroke="rgba(255,255,255,.06)"/>';
    });
    series.forEach(function (s, i) {
      var x = padL + slot * i + (slot - bw * 2.3) / 2;
      var hT = Math.max(2, (s.tokens / max) * plotH);
      var hC = Math.max(2, ((s.cost * 4e6) / max) * plotH);
      var tip = "<b>" + esc(s.key) + "</b><br>Token " + fmtTokens(s.tokens) + "<br>费用 " + fmtCost(s.cost) + " · " + s.requests + " 次请求";
      svg += '<rect x="' + x + '" y="' + (10 + plotH - hT) + '" width="' + bw + '" height="' + hT + '" rx="2" fill="#4b7bff" data-tip="' + esc(tip) + '"/>';
      svg += '<rect x="' + (x + bw + 2) + '" y="' + (10 + plotH - hC) + '" width="' + bw + '" height="' + hC + '" rx="2" fill="#2bd576" data-tip="' + esc(tip) + '"/>';
      if (n <= 16 || i % Math.ceil(n / 12) === 0) {
        svg += '<text x="' + (padL + slot * i + slot / 2) + '" y="' + (h - 6) + '" text-anchor="middle">' + esc(s.key.slice(5)) + "</text>";
      }
    });
    svg += "</svg>";
    return svg;
  }

  function heatmap(days, metric) {
    metric = metric || "tokens";
    var map = {};
    days.forEach(function (d) { map[d.day] = d; });
    var today = new Date();
    var cells = [];
    var maxV = 1;
    days.forEach(function (d) { maxV = Math.max(maxV, metric === "sessions" ? d.sessions : d.tokens); });
    var start = new Date(today.getTime() - 55 * 86400000);
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var weekdayLabels = ["", "一", "", "三", "", "五", ""];
    var svgCells = "";
    var monthMarks = [];
    var lastMonth = -1;
    var idx = 0;
    for (var d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      var cell = map[key];
      var level = 0;
      if (cell) {
        var v = metric === "sessions" ? cell.sessions : cell.tokens;
        level = v > 0 ? Math.min(4, Math.ceil((v / maxV) * 4)) : 0;
      }
      var col = Math.floor(idx / 8);
      var row = idx % 8;
      if (row === 0 && d.getMonth() !== lastMonth) {
        lastMonth = d.getMonth();
        monthMarks.push({ x: col * 15.4 + 34, label: d.getMonth() + 1 + "月" });
      }
      var val = cell ? (metric === "sessions" ? cell.sessions : cell.tokens) : 0;
      var tip = cell ? "<b>" + esc(key) + "</b><br>" + cell.sessions + " 会话 · " + fmtTokens(cell.tokens) + (val > 0 ? "<div class='dim'>点击筛选当天的会话</div>" : "") : "<b>" + esc(key) + "</b><br>无活动";
      svgCells +=
        '<rect data-day="' + key + '" x="' + col * 15.4 + 34 + '" y="' + (row * 15 + 14) + '" width="12.5" height="12.5" rx="3" fill="' +
        ["rgba(255,255,255,.06)", "#1d3a70", "#2b57b0", "#3f74e8", "#6d9bff"][level] +
        '" data-tip="' + esc(tip) + '"></rect>';
      idx += 1;
    }
    var svg = '<svg class="zci-heat" width="100%" viewBox="0 0 162 132">';
    monthMarks.forEach(function (m) {
      svg += '<text x="' + m.x + '" y="9">' + esc(m.label) + "</text>";
    });
    weekdayLabels.forEach(function (w, i) {
      if (w) svg += '<text x="26" y="' + (i * 15 + 24) + '" text-anchor="end">' + w + "</text>";
    });
    svg += svgCells + "</svg>";
    return (
      svg +
      '<div class="zci-chartlegend" style="display:flex;justify-content:space-between;font-size:10px;color:#6d7484"><span>近 8 周活跃度</span><span>少 ' +
      ["rgba(255,255,255,.06)", "#1d3a70", "#2b57b0", "#3f74e8", "#6d9bff"].map(function (col) {
        return '<span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:2.5px;background:' + col + ';margin-left:3px"></span>';
      }).join("") + " 多</span></div>"
    );
  }

  function trendChart(trend, windowTokens, mode, pinnedIndex) {
    if (!trend.length) return '<div class="zci-empty">暂无请求数据</div>';
    var width = 760;
    var height = 250;
    var n = trend.length;
    var maxV = 1;
    trend.forEach(function (t) {
      maxV = Math.max(maxV, mode === "delta" ? Math.max(t.inputTokens, t.outputTokens) : t.inputTokens);
    });
    if (mode !== "delta" && windowTokens > 0) maxV = Math.max(maxV, windowTokens * 1.06);
    var maxDur = 1;
    trend.forEach(function (t) { maxDur = Math.max(maxDur, t.durationMs || 0); });
    var padL = 8;
    var yOf = function (v) {
      return height - 30 - (v / maxV) * (height - 52);
    };
    var ydOf = function (v) {
      return height - 30 - (v / maxDur) * (height - 52);
    };
    var xOf = function (i) {
      return padL + (i / Math.max(1, n - 1)) * (width - padL * 2);
    };
    var uid = "tg" + Math.floor(Math.random() * 1e6);
    var inputLine = "";
    trend.forEach(function (t, i) {
      inputLine += (i ? " L" : "M") + xOf(i).toFixed(1) + " " + yOf(t.inputTokens).toFixed(1);
    });
    var outputLine = "";
    trend.forEach(function (t, i) {
      outputLine += (i ? " L" : "M") + xOf(i).toFixed(1) + " " + yOf(t.outputTokens).toFixed(1);
    });
    var durLine = "";
    trend.forEach(function (t, i) {
      durLine += (i ? " L" : "M") + xOf(i).toFixed(1) + " " + ydOf(t.durationMs || 0).toFixed(1);
    });
    var marks = "";
    if (mode !== "delta" && windowTokens > 0 && windowTokens <= maxV) {
      marks +=
        '<line x1="0" y1="' + yOf(windowTokens) + '" x2="' + width + '" y2="' + yOf(windowTokens) + '" stroke="' + C.red + '" stroke-dasharray="5 4" opacity=".85"/>' +
        '<text x="8" y="' + (yOf(windowTokens) - 6) + '" fill="' + C.red + '">窗口 ' + fmtTokens(windowTokens) + "</text>";
    }
    trend.forEach(function (t, i) {
      if (t.compact) {
        marks += '<line x1="' + xOf(i) + '" y1="16" x2="' + xOf(i) + '" y2="' + (height - 30) + '" stroke="' + C.amber + '" stroke-dasharray="2 3" opacity=".9" data-tip="<b>compact 压缩</b><div class=\'dim\'>该请求为上下文压缩调用</div>"/>';
      }
    });
    // pinned marker
    if (pinnedIndex != null && trend[pinnedIndex]) {
      marks += '<line class="zci-xhair" x1="' + xOf(pinnedIndex) + '" y1="14" x2="' + xOf(pinnedIndex) + '" y2="' + (height - 30) + '" stroke="#5b8cff" stroke-width="1.2" opacity=".9"/>';
    }
    // right-side duration ticks
    var durTicks = [0, 0.5, 1].map(function (f) {
      return { y: height - 30 - f * (height - 52), text: fmtDuration(maxDur * f) };
    });
    // per-point hover/click hit regions
    var slot = (width - padL * 2) / Math.max(1, n);
    var hits = "";
    trend.forEach(function (t, i) {
      var prev = trend[i - 1];
      var deltaIn = prev ? t.inputTokens - prev.inputTokens : t.inputTokens;
      var tip =
        "<b>" + (t.turn != null ? "第 " + t.turn + " 轮 · " : "") + "第 " + (t.index + 1) + " 步</b>" +
        "<br>输入 " + fmtTokens(t.inputTokens) + " · 输出 " + fmtTokens(t.outputTokens) +
        "<br>缓存读 " + fmtTokens(t.cacheReadTokens) + "（" + fmtPct(t.cacheRate || 0) + "）" +
        "<br>耗时 " + fmtDuration(t.durationMs) + (prev ? "<br>Δ输入 " + (deltaIn >= 0 ? "+" : "") + fmtTokens(deltaIn) : "") +
        (t.compact ? "<br>✂ compact 压缩" : "") +
        "<div class='dim'>点击固定该步详情</div>";
      hits +=
        '<rect class="zci-trend-hit" data-step="' + i + '" data-tip="' + esc(tip) +
        '" x="' + (xOf(i) - slot / 2) + '" y="10" width="' + slot + '" height="' + (height - 40) + '" fill="' + (i === pinnedIndex ? "rgba(91,140,255,.12)" : "transparent") + '"/>';
    });
    var svg =
      '<svg width="100%" viewBox="0 0 ' + width + " " + height + '">' +
      '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#4b7bff" stop-opacity=".42"/><stop offset="1" stop-color="#4b7bff" stop-opacity=".02"/></linearGradient></defs>' +
      '<line x1="0" y1="' + (height - 30) + '" x2="' + width + '" y2="' + (height - 30) + '" stroke="rgba(255,255,255,.1)"/>' +
      marks +
      '<path d="' + inputLine + " L" + xOf(n - 1).toFixed(1) + " " + (height - 30) + " L" + xOf(0).toFixed(1) + " " + (height - 30) + ' Z" fill="url(#' + uid + ')"/>' +
      '<path d="' + inputLine + '" fill="none" stroke="#4b7bff" stroke-width="1.6"/>' +
      '<path d="' + outputLine + '" fill="none" stroke="#2bd576" stroke-width="1.4"/>' +
      '<path d="' + durLine + '" fill="none" stroke="#a78bfa" stroke-width="1.2" stroke-dasharray="3 3" opacity=".9"/>' +
      hits +
      durTicks.map(function (t) {
        return '<text x="' + (width - 4) + '" y="' + (t.y + 3) + '" text-anchor="end" fill="#a78bfa" font-size="9">' + esc(t.text) + "</text>";
      }).join("") +
      "</svg>";
    return svg;
  }

  function timelineStrip(segments, totalLabel) {
    var total = segments.reduce(function (a, s) { return a + s.value; }, 0) || 1;
    var bars = segments
      .filter(function (s) { return s.value > 0; })
      .map(function (s) {
        return '<span style="width:' + ((s.value / total) * 100).toFixed(2) + "%;background:" + s.color + '" title="' + esc(s.label + " " + fmtDuration(s.value)) + '"></span>';
      })
      .join("");
    return (
      '<div class="zci-timeline"><div class="bar">' + bars + '</div><div class="ticks"><span>0</span><span>' + esc(totalLabel || "") + "</span></div></div>"
    );
  }

  /* ---------------------------------------------------------------- */
  /* State + views                                                     */
  /* ---------------------------------------------------------------- */

  var state = {
    tab: "overview",
    range: 7,
    directory: "",
    directoryFilter: "",
    order: "tokens",
    search: "",
    heatMetric: "tokens",
    filter: null,
    evFilter: null,
    evOpen: {},
    fileFilter: "",
    fileSearch: "",
    fileOpen: {},
    browserOpen: {},
    pinnedStep: null,
    trendGran: "step",
    overview: null,
    sessions: null,
    sessionDetail: null,
    detailSessionId: null,
    trendMode: "total",
    loading: false,
    error: null,
    overlayEl: null,
    tabsEl: null,
    bodyEl: null,
    onKey: null,
    observer: null,
  };

  function rangeStartMs() {
    if (state.range === "today") {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    return Date.now() - state.range * 86400000;
  }

  function sectionCard(title, color, countText, bodyHtml) {
    return (
      '<div class="zci-card"><h3><span class="zci-ico" style="background:' + color + '"></span>' + esc(title) +
      (countText ? '<span class="zci-cnt">' + countText + "</span>" : "") + "</h3>" + (bodyHtml || "") + "</div>"
    );
  }

  function timeDonutParts(ts) {
    return [
      { label: "模型等待", value: ts.modelWaitMs, valueText: fmtDuration(ts.modelWaitMs), color: C.amber, tip: "<b>模型等待</b> " + fmtDuration(ts.modelWaitMs) + "<div class='dim'>Σ 各请求首字延迟（ttft）</div>" },
      { label: "模型思考", value: ts.thinkMs || 0, valueText: fmtDuration(ts.thinkMs || 0), color: C.purple, tip: "<b>模型思考</b> " + fmtDuration(ts.thinkMs || 0) + "<div class='dim'>生成时长 × reasoning token 占比</div>" },
      { label: "模型回复", value: ts.replyMs || 0, valueText: fmtDuration(ts.replyMs || 0), color: C.green, tip: "<b>模型回复</b> " + fmtDuration(ts.replyMs || 0) + "<div class='dim'>生成时长 × 输出 token 占比</div>" },
      { label: "工具执行", value: ts.toolMs, valueText: fmtDuration(ts.toolMs), color: C.blue, tip: "<b>工具执行</b> " + fmtDuration(ts.toolMs) + "<div class='dim'>相邻请求之间的空闲间隔（≤120s）</div>" },
      { label: "其他", value: ts.otherMs, valueText: fmtDuration(ts.otherMs), color: C.gray, tip: "<b>其他</b> " + fmtDuration(ts.otherMs) + "<div class='dim'>活跃时长 − 上述各项</div>" },
    ];
  }

  function timeLegendRows(parts, counts) {
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
    return parts
      .filter(function (p) { return p.value > 0; })
      .map(function (p) {
        var pct = ((p.value / total) * 100).toFixed(1) + "%";
        var extra = counts && counts[p.label] ? " · " + counts[p.label] : "";
        return (
          '<div class="zci-lg"><div class="l1"><span class="dot" style="background:' + p.color + '"></span>' +
          '<span class="name">' + esc(p.label) + '</span><span class="pct">' + pct + '</span></div>' +
          '<div class="l2">≈' + esc(fmtDuration(p.value)) + esc(extra) + "</div></div>"
        );
      })
      .join("");
  }

  function renderOverview(body) {
    var o = state.overview;
    if (!o) return;
    var s = o.summary;
    var ts = o.timeStats || { modelWaitMs: s.activeMs, toolMs: 0, otherMs: 0, outputSpeed: s.outputSpeed };
    var usageParts = usageDonutParts(o);
    var timeParts = timeDonutParts(ts);

    var kpis =
      kpi("全部会话", fmtTokens(s.sessions), "含 " + s.requests + " 次请求", { kpiId: "sessions", tip: "点击查看<b>会话列表</b><div class='dim'>按当前时间范围统计</div>" }) +
      kpi("Token 消耗", fmtTokens(s.totalTokens), "输出 " + fmtTokens(s.outputTokens), { tip: "所有请求 <b>computed_total_tokens</b> 合计" }) +
      kpi("预估费用", fmtCost(s.cost), "按公开牌价估算", { tip: "按<b>内置牌价表</b>估算：输入/输出/缓存读写分别计价<div class='dim'>实际账单以模型服务商为准</div>" }) +
      kpi("缓存命中", fmtPct(s.cacheHitRate), "cacheRead / input", { tip: "<b>cache_read / input</b>（dsh 口径）<div class='dim'>越高说明缓存复用越好、费用越低</div>" }) +
      kpi("工具调用", fmtTokens(s.toolCalls), "命令执行 " + s.commandExec + " 次" + ((o.commandStats && o.commandStats.failed) ? " · 失败 " + o.commandStats.failed : ""), { kpiId: "tools", tip: "点击滚动到<b>工具调用</b>排行" }) +
      kpi("活跃时长", fmtDuration(ts.modelWaitMs + (ts.thinkMs || 0) + (ts.replyMs || 0)), "模型等待 · " + s.outputSpeed + " tok/s", { tip: "模型等待=Σ首字延迟；生成按思考/回复 token 占比拆分<div class='dim'>工具执行按请求间隙估算</div>" });

    var usageCard = sectionCard("近 7 天用量", "", "", '<div class="zci-usage">' + usageChart(o.series.slice(-14)) +
      '<div class="zci-chartlegend" style="display:flex;gap:14px;font-size:10px;color:#6d7484;justify-content:center"><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#4b7bff;margin-right:4px"></span>Token</span><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#2bd576;margin-right:4px"></span>费用</span></div></div>');

    var tokenCard = sectionCard("Token 统计", C.blue, "", '<div class="zci-donut-wrap">' +
      donut(usageParts, 118, 13, fmtTokens(s.totalTokens), "总用量") +
      legendGrid(usageParts) + "</div>");

    var timeTotalMs = ts.modelWaitMs + (ts.thinkMs || 0) + (ts.replyMs || 0) + ts.toolMs + ts.otherMs;
    var timeCard = sectionCard("耗时统计", C.amber, "输出速度 " + s.outputSpeed + " tok/s", '<div class="zci-donut-wrap">' +
      donut(timeParts, 118, 13, fmtDuration(timeTotalMs), "总时长") +
      '<div class="zci-legend zci-2col">' + timeLegendRows(timeParts, { 模型等待: s.requests + " 次", 工具执行: s.toolCalls + " 次" }) + "</div></div>" +
      timelineStrip(timeParts, fmtDuration(ts.spanMs || timeTotalMs)));

    var heatCard = sectionCard("活跃", C.green, "", '<div style="display:flex;justify-content:flex-end;margin-bottom:6px"><div class="zci-seg">' +
      '<button class="zci-pill ' + (state.heatMetric === "tokens" ? "zci-on" : "") + '" data-heat="tokens">Token 消耗</button>' +
      '<button class="zci-pill ' + (state.heatMetric === "sessions" ? "zci-on" : "") + '" data-heat="sessions">会话</button></div></div>' +
      '<div class="zci-heat">' + heatmap(o.heatmap, state.heatMetric) + "</div>");

    var toolItems = (o.tools || []).slice(0, 10).map(function (t, i) {
      return { name: t.tool, calls: t.calls };
    });
    var toolCard = sectionCard("工具调用", C.cyan, (o.tools || []).length + " 个工具 · " + s.toolCalls + " 次调用",
      '<div class="zci-rank">' + rankRows(toolItems, function (it, i) { return RANK_COLORS[i % RANK_COLORS.length]; }, { filterType: "tool" }) + "</div>");

    var cmdItems = (o.commands || []).map(function (c, i) {
      return { name: c.cmd, calls: c.calls };
    });
    var cmdCard = sectionCard("命令执行", C.red, (o.commands || []).length + " 个程序 · " + s.commandExec + " 次执行" + ((o.commandStats && o.commandStats.failed) ? " · 失败 " + o.commandStats.failed : ""),
      '<div class="zci-rank">' + rankRows(cmdItems, function (it, i) { return RANK_COLORS[(i + 3) % RANK_COLORS.length]; }, { filterType: "cmd" }) + "</div>");

    var projItems = (o.projects || []).slice(0, 8).map(function (p, i) {
      return { name: p.workspace, calls: Math.max(1, Math.round(p.tokens / 1e6)), tip: "<b>" + esc(p.workspace) + "</b><br>" + fmtTokens(p.tokens) + " tokens · " + p.sessions + " 会话<div class='dim'>点击筛选该工作区的会话</div>" };
    });
    var projCard = sectionCard("项目分布", C.purple, (o.projects || []).length + " 个工作区",
      '<div class="zci-rank">' + rankRows(projItems, function (it, i) { return RANK_COLORS[(i + 5) % RANK_COLORS.length]; }, { filterType: "proj" }) + "</div>");

    var filteredCards = applyCardFilter((o.sessions || []).slice(0, 12));
    var sessionsHtml = renderSessionCards(filteredCards, true);
    var sessCard =
      '<div class="zci-sess-head"><h2><span class="zci-ico"></span>会话<span class="zci-note" style="font-weight:400">共 ' + s.sessions + "</span></h2>" +
      '<span class="zci-spacer"></span><div class="zci-seg">' +
      '<button class="zci-pill ' + (state.order === "tokens" ? "zci-on" : "") + '" data-order="tokens">Token 总用量</button>' +
      '<button class="zci-pill ' + (state.order === "recent" ? "zci-on" : "") + '" data-order="recent">最近更新</button></div></div>' +
      filterChipHtml() +
      '<div class="zci-sessions">' + (sessionsHtml || '<div class="zci-empty">没有匹配当前筛选的会话</div>') + "</div>";

    body.innerHTML =
      '<div class="zci-top"><div class="zci-kpis">' + kpis + "</div>" + usageCard + "</div>" +
      '<div class="zci-row">' + tokenCard + timeCard + "</div>" +
      '<div class="zci-row-3">' + heatCard + toolCard + cmdCard + projCard + "</div>" +
      sessCard;

    body.querySelectorAll("[data-session]").forEach(function (el) {
      el.addEventListener("click", function () {
        openSession(el.getAttribute("data-session"));
      });
    });
    body.querySelectorAll("[data-order]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.order = el.getAttribute("data-order");
        load();
      });
    });
    body.querySelectorAll("[data-heat]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.heatMetric = el.getAttribute("data-heat");
        render();
      });
    });
    body.querySelectorAll("[data-kpi]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-kpi");
        if (id === "sessions") {
          state.tab = "sessions";
          if (!state.sessions) loadSessions();
          else render();
        } else if (id === "tools") {
          var card = body.querySelectorAll(".zci-card")[3];
          try {
            var target = Array.from(body.querySelectorAll(".zci-card")).find(function (c) {
              return c.querySelector("h3") && c.querySelector("h3").textContent.indexOf("工具调用") >= 0;
            });
            if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
          } catch {
            // ignore
          }
        }
      });
    });
    // heatmap day cells -> filter session cards by that day
    body.querySelectorAll("[data-day]").forEach(function (el) {
      el.addEventListener("click", function () {
        var day = el.getAttribute("data-day");
        if (state.filter && state.filter.type === "day" && state.filter.value === day) state.filter = null;
        else state.filter = { type: "day", value: day, label: day };
        render();
      });
    });
    body.querySelectorAll("[data-fclear]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.filter = null;
        render();
      });
    });
    bindFilterRows(body, render);
    bindAll(body);
  }

  function kpi(label, value, sub, opts) {
    opts = opts || {};
    return (
      '<div class="zci-card zci-kpi' + (opts.kpiId ? " zci-ck" : "") + '"' +
      (opts.kpiId ? ' data-kpi="' + opts.kpiId + '"' : "") +
      (opts.tip ? ' data-tip="' + esc(opts.tip) + '"' : "") +
      '><div class="zci-kpi-label">' + esc(label) +
      '</div><div class="zci-kpi-value">' + esc(value) + '</div><div class="zci-kpi-sub">' + esc(sub || "") + "</div></div>"
    );
  }

  function compositionParts(detail) {
    var c = detail.composition;
    return [
      { label: "系统提示词", value: c.systemPrompt.tokens, color: C.purple },
      { label: "工具定义", value: c.toolDefs.tokens, color: C.amber },
      { label: "用户消息", value: c.userMessages.tokens, color: C.blue },
      { label: "助手回复", value: c.assistantText.tokens, color: C.green },
      { label: "思考", value: c.reasoning.tokens, color: C.cyan },
      { label: "工具结果", value: c.toolResults.tokens, color: C.red },
    ];
  }

  function usageDonutParts(overview) {
    var s = overview.summary;
    return [
      { label: "缓存读取", value: s.cacheReadTokens, color: C.cyan },
      { label: "模型思考", value: s.reasoningTokens, color: C.purple },
      { label: "未命中输入", value: Math.max(0, s.inputTokens - s.cacheReadTokens - s.cacheWriteTokens), color: C.blue },
      { label: "输出", value: s.outputTokens, color: C.green },
      { label: "缓存写入", value: s.cacheWriteTokens, color: C.amber },
    ];
  }

  function sessionUsageParts(d) {
    var agg = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    (d.usage || []).forEach(function (r) {
      agg.input += r.inputTokens || 0;
      agg.output += r.outputTokens || 0;
      agg.reasoning += r.reasoningTokens || 0;
      agg.cacheRead += r.cacheReadTokens || 0;
    });
    return [
      { label: "缓存读取", value: agg.cacheRead, color: C.cyan },
      { label: "模型思考", value: agg.reasoning, color: C.purple },
      { label: "未命中输入", value: Math.max(0, agg.input - agg.cacheRead - agg.cacheWrite), color: C.blue },
      { label: "输出", value: agg.output, color: C.green },
    ];
  }

  function renderSessionCards(list, compact) {
    var maxTokens = 1;
    list.forEach(function (card) { maxTokens = Math.max(maxTokens, card.tokens || 0); });
    return list
      .map(function (card) {
        var pct = card.contextPct != null ? Math.min(100, Math.round(card.contextPct * 100)) : Math.min(100, Math.round(((card.tokens || 0) / maxTokens) * 100));
        var donutColor = pct >= 85 ? C.red : C.blue;
        var miniDonut =
          donut(
            [
              { label: "上下文占比", value: Math.max(0.5, pct), color: donutColor },
              { label: "余量", value: Math.max(0, 100 - pct), color: "rgba(255,255,255,.08)" },
            ],
            56,
            7,
            pct + "%",
            "上下文",
          );
        return (
          '<div class="zci-card zci-hover zci-scard" data-session="' + esc(card.id) + '">' +
          '<div class="zci-shead"><span class="t">' + esc(card.title) + '</span><span class="time">' + esc(fmtTime(card.lastActiveAt)) + "</span></div>" +
          '<div style="display:flex;gap:6px;flex-wrap:wrap"><span class="zci-chip zci-plain">' + esc(card.workspace) + "</span>" +
          (card.compacted ? '<span class="zci-chip zci-amber">已压缩</span>' : "") + "</div>" +
          '<div class="zci-smid">' + miniDonut +
          '<div class="zci-sstats"><span>轮次 <b>' + (card.turns || card.requests) + "</b></span><span>Token <b>" + fmtTokens(card.tokens) + "</b></span>" +
          '<span class="wide">总预估费用 <b>' + fmtCost(card.cost) + "</b></span></div></div>" +
          (card.lastMessage ? '<div class="zci-slast">' + esc(card.lastMessage.slice(0, 80)) + "</div>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function renderSessions(body) {
    var list = state.sessions || [];
    var workspaces = {};
    list.forEach(function (s) { workspaces[s.workspace] = true; });
    var kw = state.search.trim().toLowerCase();
    var filtered = list.filter(function (s) {
      return (!state.directoryFilter || s.workspace === state.directoryFilter) &&
        (!kw || String(s.title).toLowerCase().indexOf(kw) >= 0);
    });
    var chips = Object.keys(workspaces)
      .slice(0, 9)
      .map(function (w) {
        var n = list.filter(function (s) { return s.workspace === w; }).length;
        return '<span class="zci-chip ' + (state.directoryFilter === w ? "zci-on" : "zci-plain") + '" data-ws="' + esc(w) + '">' + esc(w) + " " + n + "</span>";
      })
      .join("");
    body.innerHTML =
      '<div class="zci-sess-head"><h2><span class="zci-ico"></span>会话<span class="zci-note" style="font-weight:400">共 ' + list.length + "</span></h2>" +
      '<span class="zci-spacer"></span><input class="zci-search" placeholder="搜索会话标题…" value="' + esc(state.search) + '"/>' +
      '<div class="zci-seg">' +
      '<button class="zci-pill ' + (state.order === "tokens" ? "zci-on" : "") + '" data-order="tokens">Token 总用量</button>' +
      '<button class="zci-pill ' + (state.order === "recent" ? "zci-on" : "") + '" data-order="recent">最近更新</button>' +
      '<button class="zci-pill ' + (state.order === "context" ? "zci-on" : "") + '" data-order="context">当前上下文</button></div></div>' +
      '<div class="zci-chips"><span class="zci-chip ' + (!state.directoryFilter ? "zci-on" : "zci-plain") + '" data-ws="">全部 ' + list.length + "</span>" + chips + "</div>" +
      '<div class="zci-sessions">' + renderSessionCards(filtered, false) + "</div>";
    body.querySelector(".zci-search").addEventListener("input", function (e) {
      state.search = e.target.value;
      render();
      var input = body.querySelector(".zci-search");
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    body.querySelectorAll("[data-session]").forEach(function (el) {
      el.addEventListener("click", function () {
        openSession(el.getAttribute("data-session"));
      });
    });
    body.querySelectorAll("[data-ws]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.directoryFilter = el.getAttribute("data-ws");
        render();
      });
    });
    body.querySelectorAll("[data-order]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.order = el.getAttribute("data-order");
        loadSessions();
      });
    });
    bindAll(body);
  }

  function ioCell(label, value) {
    return '<span>' + esc(label) + ' <span class="n">' + value + "</span></span>";
  }

  /** clickable io chip: filters the 文件活动 card (op) or 事件日志 card (tool). */
  function ioCellChip(label, value, op) {
    if (!value) return ioCell(label, value);
    return '<span class="zci-chip zci-plain" data-iofilter="' + op + '" data-tip="<b>' + esc(label) + ' ' + value + '</b><div class=\'dim\'>点击筛选文件活动</div>" style="padding:1px 8px">' + esc(label) + ' <span class="n">' + value + "</span></span>";
  }

  function renderSessionDetail(body) {
    var d = state.sessionDetail;
    if (!d) return;
    var st = d.stats;
    var io = d.ioCounts || { user: 0, read: 0, write: 0, edit: 0, search: 0, bash: 0, tools: 0 };
    var compParts = compositionParts(d);
    var compTotal = compParts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
    var win = st.contextWindow || 1;
    var usedPct = Math.min(1, st.currentContextTokens / win);

    // context bar segments with hatched reserve; hover tip + click -> browser group
    var segs = compParts
      .filter(function (p) { return p.value > 0; })
      .map(function (p) {
        var segPct = (p.value / compTotal) * 100;
        var tip = "<b>" + p.label + "</b> ≈" + fmtTokens(p.value) + " · " + segPct.toFixed(1) + "% 占已用<div class='dim'>点击在上下文浏览器中展开</div>";
        return '<span class="seg" data-bgroup="' + esc(p.label) + '" data-tip="' + esc(tip) + '" style="width:' + Math.max(0.4, segPct * Math.max(0.01, usedPct) * 100) + "%;background:" + p.color + '"></span>';
      })
      .join("");
    var reserve = Math.max(0, 100 - usedPct * 100);

    var headerStats =
      '<div class="zci-dstat zci-ck" data-jump="trend"><div class="v">' + d.turns + '</div><div class="l">轮次</div><div class="s">点击查看趋势</div></div>' +
      '<div class="zci-dstat zci-ck" data-jump="trend"><div class="v">' + d.requests + '</div><div class="l">步骤</div><div class="s">点击查看趋势</div></div>' +
      '<div class="zci-dstat"><div class="v">' + io.tools + '</div><div class="l">工具调用</div></div>' +
      '<div class="zci-dstat"><div class="v">' + (d.composition.assistantText.items || 0) + '</div><div class="l">回复块</div></div>' +
      '<div class="zci-dstat"><div class="v">' + fmtTokens(st.totalTokens) + '</div><div class="l">Token 总用量</div><div class="s">' + fmtCost(st.cost) + "</div></div>";

    var ioLine =
      '<div class="zci-io-line"><span>输入输出</span>' +
      ioCell("用户", io.user) +
      ioCellChip("读取", io.read, "read") + ioCellChip("写入", io.write, "write") +
      ioCellChip("搜索", io.search, "search") + ioCellChip("命令", io.bash, "bash") +
      '<span class="tot">合计 ' + (io.read + io.write + io.edit + io.search + io.bash) + "</span></div>";

    var toolItems = (d.toolTop || []).map(function (t) {
      return { name: t.tool, calls: t.calls };
    });
    var ioToolsLine =
      '<div class="zci-io-line"><span>工具调用</span>' +
      toolItems
        .slice(0, 8)
        .map(function (t) {
          return '<span class="zci-chip zci-plain" data-evtool="' + esc(t.tool) + '" data-tip="<b>' + esc(t.tool) + '</b> ×' + t.calls + '<div class=\'dim\'>点击筛选事件日志到该工具</div>" style="padding:1px 8px">' + esc(t.tool) + ' <span class="n">' + t.calls + "</span></span>";
        })
        .join("") +
      '<span class="tot">合计 ' + io.tools + "</span></div>";

    var ts = (st && st.timing) || d.timeStats || { modelWaitMs: st.modelMs, toolMs: 0, otherMs: 0, outputSpeed: st.outputSpeed };
    var timeParts = timeDonutParts(ts);
    var sUsageParts = sessionUsageParts(d);
    var cacheRate = st.cacheRate != null ? st.cacheRate : 0;

    var costComp = d.costComposition || { totalTokens: st.compositionTokens, totalCost: st.cost, parts: [] };
    var costColors = [C.purple, C.amber, C.blue, C.green, C.cyan, C.red];
    var costParts = (costComp.parts || []).map(function (p, i) {
      return {
        label: p.label,
        value: Math.max(0.5, p.pct * 100),
        valueText: "¥" + Number(p.cost).toFixed(5),
        color: costColors[i % costColors.length],
        tip: "<b>" + esc(p.label) + "</b> ≈" + fmtTokens(Math.max(0.5, p.pct * 100) / 100 * costComp.totalTokens) + " tokens<br>≈¥" + Number(p.cost).toFixed(5) + "<div class='dim'>按最近模型牌价估算</div>",
      };
    });

    // browser groups (collapsible; expand content per group)
    var compGroups = [
      { label: "系统提示词", detail: (d.promptPreview || "（无快照）"), raw: true },
      { label: "工具定义", toolNames: true },
      { label: "用户消息", items: (d.composition.userMessages.items || 0) + " 条" },
      { label: "助手回复", items: (d.composition.assistantText.items || 0) + " 块" },
      { label: "思考", items: (d.composition.reasoning.items || 0) + " 段" },
      { label: "工具结果", items: (d.composition.toolResults.items || 0) + " 条" },
    ];
    var browserRows = compParts
      .map(function (p) {
        var g = compGroups.find(function (x) { return x.label === p.label; }) || {};
        var pct = ((p.value / compTotal) * 100).toFixed(1) + "%";
        var add = g.items ? '<span class="add">+' + esc(g.items) + "</span>" : "";
        var detail = "";
        if (g.raw) {
          detail = '<div class="bdetail"><div>系统提示词快照（前 400 字）：</div><div style="white-space:pre-wrap;margin-top:3px">' + esc(g.detail) + (g.detail && g.detail.length >= 400 ? "…" : "") + "</div></div>";
        } else if (g.toolNames) {
          var names = d.toolNames || [];
          detail = '<div class="bdetail"><div>工具定义 ' + names.length + " 个：</div>" +
            (names.length ? '<div class="tnames">' + names.map(function (n) { return "<span>" + esc(n) + "</span>"; }).join("") + "</div>" : "<div>（未捕获工具清单）</div>") + "</div>";
        } else {
          detail = '<div class="bdetail"><div>条目数：' + esc(g.items || "0") + " · 占已用上下文 " + pct + "</div></div>";
        }
        var open = state.browserOpen[p.label] ? " open" : "";
        return (
          '<div class="zci-brow-row' + open + '" data-brow="' + esc(p.label) + '" data-tip="<b>' + esc(p.label) + '</b> ≈' + fmtTokens(p.value) + '<div class=\'dim\'>点击展开/收起明细</div>"><div class="r1"><span class="caret">▶</span><span class="dot" style="background:' + p.color + '"></span>' +
          '<span class="name">' + esc(p.label) + '</span>' + add +
          '<span class="val">≈' + fmtTokens(p.value) + '</span><span class="pct">' + pct + "</span></div>" + detail + "</div>"
        );
      })
      .join("");

    var fileTotalWrite = (d.files || []).reduce(function (a, f) { return a + f.write; }, 0);
    var fileTotalEdit = (d.files || []).reduce(function (a, f) { return a + f.edit; }, 0);
    var fileTotalRead = (d.files || []).reduce(function (a, f) { return a + f.read; }, 0);

    // --- 趋势数据：步进=逐请求；轮次=按 turn 聚合 ---
    var trendRows = d.trend || [];
    if (state.trendGran === "turn") {
      var byTurn = new Map();
      trendRows.forEach(function (t) {
        var key = t.turn || 1;
        var agg = byTurn.get(key);
        if (!agg) {
          agg = { index: key - 1, turn: key, startedAt: t.startedAt, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheRate: 0, durationMs: 0, compact: false, n: 0 };
          byTurn.set(key, agg);
        }
        agg.inputTokens = Math.max(agg.inputTokens, t.inputTokens);
        agg.outputTokens += t.outputTokens;
        agg.reasoningTokens += t.reasoningTokens;
        agg.cacheReadTokens += t.cacheReadTokens;
        agg.durationMs += t.durationMs || 0;
        agg.compact = agg.compact || t.compact;
        agg.n += 1;
      });
      trendRows = Array.from(byTurn.values()).sort(function (a, b) { return a.index - b.index; });
      if (state.pinnedStep != null && !trendRows[state.pinnedStep]) state.pinnedStep = null;
    }

    function requestDetailHtml(dd) {
      if (state.pinnedStep == null) return "";
      var t = (dd.trend || [])[state.pinnedStep];
      var u = (dd.usage || [])[state.pinnedStep];
      if (!t && !u) return "";
      var row = u || t;
      var input = row.inputTokens != null ? row.inputTokens : row.input_tokens;
      var output = row.outputTokens != null ? row.outputTokens : row.output_tokens;
      var cacheRead = row.cacheReadTokens != null ? row.cacheReadTokens : row.cache_read_input_tokens;
      var model = row.modelId || row.model_id || "";
      var prev = (dd.trend || [])[state.pinnedStep - 1];
      var delta = prev ? input - prev.inputTokens : input;
      return (
        '<div class="zci-reqdetail" id="zci-reqdetail"><b>' + (t && t.turn != null ? "第 " + t.turn + " 轮 · " : "") + "第 " + (state.pinnedStep + 1) + " 步</b>" +
        "<span>输入 <b>" + fmtTokens(input) + "</b></span><span>输出 <b>" + fmtTokens(output) + "</b></span>" +
        "<span>缓存命中 <b>" + fmtPct(t && t.cacheRate) + "</b></span>" +
        "<span>Δ输入 <b>" + (delta >= 0 ? "+" : "") + fmtTokens(delta) + "</b></span>" +
        "<span>耗时 <b>" + fmtDuration(row.durationMs) + "</b></span>" +
        (model ? "<span class='dim'>" + esc(String(model).slice(0, 40)) + "</span>" : "") +
        '<span class="x" data-unpin>✕ 取消固定</span></div>'
      );
    }

    // --- 事件：筛选 + 计数 + 行点击展开 ---
    var evCounts = { all: (d.events || []).length, message: 0, tool: 0, compact: 0, error: 0 };
    (d.events || []).forEach(function (ev) {
      if (evCounts[ev.kind] != null) evCounts[ev.kind] += 1;
    });
    var evShown = (d.events || []).filter(function (ev) {
      if (state.evFilter && state.evFilter.indexOf("tool:") === 0) return ev.kind === "tool" && ev.tool === state.evFilter.slice(5);
      if (!state.evFilter) return true;
      return ev.kind === state.evFilter;
    });
    var eventsHtml =
      evShown
        .slice(-120)
        .reverse()
        .map(function (ev) {
          var cls = ev.kind === "error" ? "zci-t-error" : ev.kind === "compact" ? "zci-t-compact" : ev.kind === "tool" ? "zci-t-tool" : "zci-t-msg";
          var tag = ev.kind === "tool" ? ev.tool : ev.kind === "compact" ? "压缩" : ev.kind === "error" ? "错误" : "消息";
          var id = "ev" + (ev.at || 0) + Math.abs(String(ev.text || "").length);
          var open = state.evOpen[id] ? " open" : "";
          var long = (ev.text || "").length > 96;
          return (
            '<div class="zci-ev' + open + '" data-ev="' + esc(id) + '" data-tip="<b>' + esc(tag) + '</b> ' + esc(fmtTime(ev.at)) + (long ? "<div class=\'dim\'>点击展开全文</div>" : "") + '">' +
            '<span class="k">' + esc(fmtTime(ev.at)) + '</span><span class="tag ' + cls + '">' + esc(String(tag).slice(0, 10)) + '</span>' +
            '<span class="txt">' + esc(ev.text || "") + "</span>" +
            (long && !state.evOpen[id] ? '<span class="more">展开</span>' : "") +
            "</div>"
          );
        })
        .join("") || '<div class="zci-empty">暂无事件</div>';

    // --- 文件：筛选 + 搜索 + 行点击展开明细 ---
    var filesFiltered = (d.files || []).filter(function (f) {
      if (state.fileFilter && !(f[state.fileFilter] > 0)) return false;
      if (state.fileSearch) {
        var kw = state.fileSearch.toLowerCase();
        return String(f.file || "").toLowerCase().indexOf(kw) >= 0 || String(f.full || "").toLowerCase().indexOf(kw) >= 0;
      }
      return true;
    });
    var filesHtml =
      filesFiltered
        .slice(0, 60)
        .map(function (f, i) {
          var id = String(f.full || f.file || i);
          var open = state.fileOpen[id] ? " open" : "";
          return (
            '<div class="zci-file' + open + '" data-file="' + esc(id) + '" data-tip="<b>' + esc(f.file) + "</b><br>读 " + f.read + " · 写 " + f.write + " · 改 " + f.edit + "<div class='dim'>点击展开明细</div>\">" +
            '<span class="p">' + esc(f.file) + '</span><span class="fmeta">' + esc(fmtTime(f.at)) + '</span>' +
            '<span class="c">读 ' + f.read + " · <b>写 " + f.write + "</b> · <i>改 " + f.edit + "</i></span>" +
            '<span class="fdetail">完整路径：' + esc(f.full) + " · 最后操作 " + esc(fmtTime(f.at)) + "</span></div>"
          );
        })
        .join("") || '<div class="zci-empty">暂无文件活动</div>';

    var parts = [
      '<div class="zci-back"><button class="zci-btn" data-back>← 返回</button><span class="t">' + esc(d.session.title) + "</span>" +
        '<span class="zci-chip zci-plain">' + esc(d.session.workspace) + "</span>" +
        '<span class="zci-note">' + esc(fmtTime(d.session.startedAt)) + "</span></div>",

      '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.blue + '"></span>上下文统计</h3>' +
        '<div class="zci-dstats">' + headerStats + "</div>" + ioLine + ioToolsLine + "</div>",

      '<div class="zci-row">' +
        sectionCard("Token 统计", C.blue, "缓存命中 " + fmtPct(cacheRate),
          '<div class="zci-donut-wrap">' + donut(sUsageParts, 110, 12, fmtTokens(st.totalTokens), "总用量") + legendGrid(sUsageParts, { cols: 2 }) + "</div>") +
        sectionCard("耗时统计", C.amber, "输出速度 " + st.outputSpeed + " tok/s",
          '<div class="zci-donut-wrap">' + donut(timeParts, 110, 12, fmtDuration(ts.modelWaitMs), "总时长") +
          '<div class="zci-legend zci-2col">' + timeLegendRows(timeParts, { 模型等待: d.requests + " 次" }) + "</div></div>" +
          timelineStrip(timeParts, fmtDuration(ts.spanMs || ts.modelWaitMs))) +
        "</div>",

      '<div class="zci-row-2">' +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.cyan + '"></span>当前上下文<span class="zci-cnt">' + esc(st.lastModelId) + "</span></h3>" +
        '<div class="zci-ctx-head"><span class="big">' + fmtTokens(st.currentContextTokens) + ' <small>/ ' + fmtTokens(win) + " tokens</small></span>" +
        '<span class="pct"><b>' + fmtPct(usedPct) + "</b> 上下文已用</span></div>" +
        '<div class="zci-ctxbar">' + segs + '<span class="reserve" style="width:' + reserve + '%"></span></div>' +
        '<div class="zci-ctx-leg">' + compParts.map(function (p) {
          var pct = ((p.value / compTotal) * 100).toFixed(0) + "%";
          return '<div class="zci-lg"><div class="l1"><span class="dot" style="background:' + p.color + '"></span><span class="name">' + esc(p.label) + '</span><span class="pct">' + pct + '</span></div><div class="l2">≈' + fmtTokens(p.value) + "</div></div>";
        }).join("") + "</div></div>",

        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.green + '"></span>上下文费用构成<span class="zci-cnt">估算 · CNY</span></h3>' +
        '<div class="zci-cost-head">' +
        '<div class="item"><span class="v">≈ ' + fmtTokens(costComp.totalTokens) + '</span><span class="l">当前上下文</span><span class="s">tokens（估算）</span></div>' +
        '<div class="item"><span class="v">≈ ' + (Number(costComp.totalCost) || 0).toFixed(5) + '</span><span class="l">非缓存输入估算</span><span class="s">按最近模型牌价</span></div></div>' +
        '<div class="zci-cost-donut">' +
        '<div class="zci-donut-100">' + donut(costParts, 104, 12, "", "") +
        '<div class="c"><span class="v">100%</span><span class="l">参考费用占比</span></div></div>' +
        legendGrid(costParts, { cols: 2 }) + "</div></div>",
        "</div>",

      '<div class="zci-card" style="margin-top:10px"><h3><span class="zci-ico" style="background:' + C.blue + '"></span>上下文趋势<span class="zci-cnt">' + d.requests + " 步 · " + d.turns + " 轮</span></h3>" +
        '<div class="zci-trend-tools"><div class="zci-trend-toggle">' +
        '<button class="zci-pill ' + (state.trendMode === "total" ? "zci-on" : "") + '" data-tmode="total">总计</button>' +
        '<button class="zci-pill ' + (state.trendMode === "delta" ? "zci-on" : "") + '" data-tmode="delta">增量</button></div>' +
        '<div class="zci-trend-toggle"><button class="zci-pill ' + (state.trendGran === "step" ? "zci-on" : "") + '" data-tgran="step">步进</button>' +
        '<button class="zci-pill ' + (state.trendGran === "turn" ? "zci-on" : "") + '" data-tgran="turn">轮次</button></div>' +
        '<span class="zci-note">紫虚线为单请求耗时 · 悬停查看摘要 · 点击固定该步</span></div>' +
        trendChart(trendRows, win, state.trendMode, state.pinnedStep) +
        requestDetailHtml(d) +
        '<div class="zci-chartlegend" style="display:flex;gap:14px;font-size:10px;color:#6d7484"><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#4b7bff;margin-right:4px"></span>输入（上下文）</span><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#2bd576;margin-right:4px"></span>输出</span><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + C.amber + ';margin-right:4px"></span>compact 压缩</span><span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + C.red + ';margin-right:4px"></span>模型窗口上限</span></div></div>',

      '<div class="zci-row-2" style="margin-top:10px">' +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.amber + '"></span>事件日志<span class="zci-cnt">' + evCounts.all + " 条</span></h3>" +
        '<div class="zci-chips">' +
        '<span class="zci-chip ' + (!state.evFilter ? "zci-on" : "zci-plain") + '" data-evk="">全部 ' + evCounts.all + "</span>" +
        '<span class="zci-chip ' + (state.evFilter === "message" ? "zci-on" : "zci-plain") + '" data-evk="message">消息 ' + evCounts.message + "</span>" +
        '<span class="zci-chip ' + (state.evFilter === "tool" ? "zci-on" : "zci-plain") + '" data-evk="tool">工具 ' + evCounts.tool + "</span>" +
        '<span class="zci-chip ' + (state.evFilter === "compact" ? "zci-on" : "zci-plain") + '" data-evk="compact">压缩 ' + evCounts.compact + "</span>" +
        '<span class="zci-chip ' + (state.evFilter === "error" ? "zci-on" : "zci-plain") + '" data-evk="error">错误 ' + evCounts.error + "</span>" +
        (state.evFilter && state.evFilter.indexOf("tool:") === 0 ? '<span class="zci-chip zci-on" data-evk-clear="1">' + esc(state.evFilter.slice(5)) + " ✕</span>" : "") +
        "</div>" +
        '<div class="zci-events">' + eventsHtml + "</div></div>" +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.green + '"></span>文件活动<span class="zci-cnt">' + filesFiltered.length + "/" + (d.files || []).length + " 个 · 读" + fileTotalRead + " 写" + fileTotalWrite + " 改" + fileTotalEdit + "</span></h3>" +
        '<div class="zci-files"><div class="fhead">' +
        '<span class="zci-chip ' + (!state.fileFilter ? "zci-on" : "zci-plain") + '" data-fop="">全部</span>' +
        '<span class="zci-chip ' + (state.fileFilter === "read" ? "zci-on" : "zci-plain") + '" data-fop="read">读取 ' + fileTotalRead + "</span>" +
        '<span class="zci-chip ' + (state.fileFilter === "write" ? "zci-on" : "zci-plain") + '" data-fop="write">写入 ' + fileTotalWrite + "</span>" +
        '<span class="zci-chip ' + (state.fileFilter === "edit" ? "zci-on" : "zci-plain") + '" data-fop="edit">编辑 ' + fileTotalEdit + "</span>" +
        '<input class="zci-filesearch" placeholder="搜索路径…" value="' + esc(state.fileSearch) + '" data-filesearch/></div>' +
        filesHtml + "</div></div></div>",

      '<div class="zci-row-2" style="margin-top:10px">' +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.purple + '"></span>上下文浏览器<span class="zci-cnt">DNA 模式 · 当前</span></h3>' +
        '<div class="zci-browser">' + browserRows + "</div></div>" +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.cyan + '"></span>上下文注入与事件<span class="zci-cnt">注入 ' + (d.composition.systemPrompt.items || 0) + "</span></h3>" +
        '<div class="zci-io-line" style="margin-top:0;border-top:none;padding-top:0">' +
        '<span>本轮会话注入 <span class="n">' + (d.composition.systemPrompt.items || 0) + '</span> 项系统提示 · 工具定义 <span class="n">' + (d.composition.toolDefs.items || 0) + "</span> 项</span></div>" +
        '<div class="zci-note" style="margin-top:8px">上下文文件（注入/压缩/切换事件）与压缩历史暂由事件日志承载。</div></div></div>',
    ];
    body.innerHTML = parts.join("");
    body.querySelector("[data-back]").addEventListener("click", backToOverview);
    body.querySelectorAll("[data-tmode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.trendMode = btn.getAttribute("data-tmode");
        render();
      });
    });
    body.querySelectorAll("[data-tgran]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.trendGran = btn.getAttribute("data-tgran");
        state.pinnedStep = null;
        render();
      });
    });
    // header figures -> scroll to the trend card
    body.querySelectorAll("[data-jump]").forEach(function (el) {
      el.addEventListener("click", function () {
        var target = Array.from(body.querySelectorAll(".zci-card")).find(function (c) {
          return c.querySelector("h3") && c.querySelector("h3").textContent.indexOf("上下文趋势") >= 0;
        });
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    // io chips -> filter file card + scroll
    body.querySelectorAll("[data-iofilter]").forEach(function (el) {
      el.addEventListener("click", function () {
        var op = el.getAttribute("data-iofilter");
        state.fileFilter = state.fileFilter === op ? "" : op;
        var target = Array.from(body.querySelectorAll(".zci-card")).find(function (c) {
          return c.querySelector("h3") && c.querySelector("h3").textContent.indexOf("文件活动") >= 0;
        });
        if (target) {
          render();
          var again = Array.from(state.bodyEl.querySelectorAll(".zci-card")).find(function (c) {
            return c.querySelector("h3") && c.querySelector("h3").textContent.indexOf("文件活动") >= 0;
          });
          if (again) again.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    });
    // tool chips -> filter event log to that tool + scroll
    body.querySelectorAll("[data-evtool]").forEach(function (el) {
      el.addEventListener("click", function () {
        var tool = el.getAttribute("data-evtool");
        state.evFilter = state.evFilter === "tool:" + tool ? null : "tool:" + tool;
        render();
        var again = Array.from(state.bodyEl.querySelectorAll(".zci-card")).find(function (c) {
          return c.querySelector("h3") && c.querySelector("h3").textContent.indexOf("事件日志") >= 0;
        });
        if (again) again.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    // ctx bar segments -> expand + scroll to browser group
    body.querySelectorAll(".zci-ctxbar [data-bgroup]").forEach(function (el) {
      el.addEventListener("click", function () {
        var label = el.getAttribute("data-bgroup");
        state.browserOpen[label] = true;
        render();
        var row = state.bodyEl.querySelector('[data-brow="' + label.replace(/"/g, '\\"') + '"]');
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    // ctx bar hover <-> browser row highlight (bidirectional)
    var ctxSegs = body.querySelectorAll(".zci-ctxbar [data-bgroup]");
    var browRows = body.querySelectorAll("[data-brow]");
    function hotGroup(label) {
      ctxSegs.forEach(function (s) {
        s.classList.toggle("zci-seg-hot", s.getAttribute("data-bgroup") === label);
      });
      browRows.forEach(function (r) {
        r.classList.toggle("zci-bhot", r.getAttribute("data-brow") === label);
      });
    }
    ctxSegs.forEach(function (s) {
      s.addEventListener("mouseenter", function () { hotGroup(s.getAttribute("data-bgroup")); });
      s.addEventListener("mouseleave", function () { hotGroup(null); });
    });
    browRows.forEach(function (r) {
      r.addEventListener("mouseenter", function () { hotGroup(r.getAttribute("data-brow")); });
      r.addEventListener("mouseleave", function () { hotGroup(null); });
    });
    // browser rows expand/collapse
    body.querySelectorAll("[data-brow]").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest(".bdetail a")) return;
        var label = row.getAttribute("data-brow");
        state.browserOpen[label] = !state.browserOpen[label];
        render();
      });
    });
    // event pills
    body.querySelectorAll("[data-evk]").forEach(function (el) {
      el.addEventListener("click", function () {
        var k = el.getAttribute("data-evk");
        state.evFilter = k || null;
        render();
      });
    });
    body.querySelectorAll("[data-evk-clear]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.evFilter = null;
        render();
      });
    });
    // event rows expand full text
    body.querySelectorAll("[data-ev]").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = row.getAttribute("data-ev");
        state.evOpen[id] = !state.evOpen[id];
        render();
      });
    });
    // file pills + search + row expand
    body.querySelectorAll("[data-fop]").forEach(function (el) {
      el.addEventListener("click", function () {
        state.fileFilter = el.getAttribute("data-fop") || "";
        render();
      });
    });
    var fileSearch = body.querySelector("[data-filesearch]");
    if (fileSearch) {
      fileSearch.addEventListener("input", function (e) {
        state.fileSearch = e.target.value;
        render();
        var again = state.bodyEl.querySelector("[data-filesearch]");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    }
    body.querySelectorAll("[data-file]").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = row.getAttribute("data-file");
        state.fileOpen[id] = !state.fileOpen[id];
        render();
      });
    });
    // trend points: click to pin request detail
    body.querySelectorAll(".zci-trend-hit").forEach(function (hit) {
      hit.addEventListener("click", function () {
        var i = Number(hit.getAttribute("data-step"));
        state.pinnedStep = state.pinnedStep === i ? null : i;
        render();
      });
    });
    var unpin = body.querySelector("[data-unpin]");
    if (unpin) {
      unpin.addEventListener("click", function () {
        state.pinnedStep = null;
        render();
      });
    }
    bindAll(body);
  }

  function renderAgents(body) {
    var data = state.agentsData;
    if (!data) return;
    var maxTokens = Math.max.apply(
      null,
      [1].concat(
        data.agents.map(function (a) { return a.tokens; }),
      ),
    );
    var main = { name: data.sessionTitle, tokens: 0, requests: 0, activeMs: 0 };
    var usageMain = data.events.filter(function (e) { return e.sessionId === data.sessionId; });
    if (usageMain.length) {
      main.tokens = usageMain.reduce(function (a, e) { return a + e.inputTokens + e.outputTokens; }, 0);
      main.requests = usageMain.length;
    }
    var running = data.agents.filter(function (a) { return a.lastAt > Date.now() - 3600000; }).length;
    var msgs = data.events.length;

    var agentColors = [C.blue, C.purple, C.cyan, C.green, C.amber, C.red];
    function pressCls(pct) {
      return pct >= 90 ? "zci-press-hot" : pct >= 70 ? "zci-press-warn" : "zci-press-ok";
    }
    function nodeCard(a, color, badge, child) {
      var pct = Math.max(2, Math.min(100, (a.tokens / maxTokens) * 100));
      var ctxPct = a.contextPct != null ? a.contextPct * 100 : null;
      var tip =
        "<b>" + esc(a.name) + "</b>" +
        "<br>Token " + fmtTokens(a.tokens) + " · " + (a.requests || 0) + " 请求" +
        "<br>活跃 " + fmtDuration(a.activeMs || 0) +
        (child && child.childSessionId ? "<br>子会话 " + esc(child.childSessionId.slice(0, 24)) + "…<div class='dim'>点击打开该子会话详情</div>" : "<div class='dim'>主会话节点</div>");
      return (
        '<div class="zci-card zci-hover zci-node' + (child && child.childSessionId ? " zci-ck" : "") + '"' +
        (child && child.childSessionId ? ' data-open="' + esc(child.childSessionId) + '"' : "") +
        (child ? ' data-agent="' + esc(String(a.name)) + '"' : "") +
        ' data-tip="' + tip + '" style="max-width:340px">' +
        '<div class="zci-ahead"><span class="zci-badge" style="background:' + color + '">' + esc(badge) + "</span>" +
        '<div><div class="name">' + esc(a.name) + '</div><div class="val">' + fmtTokens(a.tokens) + " · " + fmtCost(a.cost || 0) + "</div></div>" +
        (ctxPct != null ? '<span class="zci-chip zci-plain" style="margin-left:auto">' + Math.round(ctxPct) + "%</span>" : "") + "</div>" +
        '<div class="pbar"><i class="' + (child ? pressCls(ctxPct != null ? ctxPct : pct) : pressCls(pct)) + '" style="width:' + pct + "%;background:" + color + '"></i></div>' +
        '<div class="meta"><span>' + esc(fmtDuration(a.activeMs || 0)) + "</span><span>" + (a.requests || 0) + " 请求</span>" +
        (a.desc ? "<span>" + esc(String(a.desc).slice(0, 40)) + "</span>" : "") + "</div></div>"
      );
    }

    var childRows = (data.agents || [])
      .map(function (a, i) {
        var col = agentColors[i % agentColors.length];
        var badge = String(a.profileName || a.profileId || "AG").slice(0, 2).toUpperCase();
        return nodeCard(
          {
            name: a.profileName || a.profileId || "agent",
            tokens: a.tokens,
            cost: 0,
            activeMs: a.activeMs,
            requests: a.requests,
            desc: a.description,
            contextPct: a.contextPct,
          },
          col,
          badge,
          a,
        );
      })
      .join("");

    var evRows = (data.events || [])
      .slice(-100)
      .reverse()
      .map(function (ev, i) {
        var who = ev.sessionId === data.sessionId ? "主" : "子";
        var id = "ag" + i;
        var open = state.evOpen[id] ? " open" : "";
        return (
          '<div class="zci-ev' + open + '" data-agev="' + id + '" data-tip="<b>[' + esc(who) + ']</b> ' + esc(ev.modelId) + "<div class='dim'>点击展开</div>\"><span class=\"k\">" + esc(fmtTime(ev.at)) + '</span><span class="tag zci-t-msg">[' + esc(who) + ']</span>' +
          '<span class="txt">' + esc(ev.modelId) + " · " + fmtTokens(ev.inputTokens) + " → " + fmtTokens(ev.outputTokens) + '</span><span class="more">' + (open ? "收起" : "展开") + "</span></div>"
        );
      })
      .join("");

    var parts = [
      '<div class="zci-back"><button class="zci-btn" data-back>← 返回</button><span class="t">编队视图</span></div>',
      '<div class="zci-banner"><div><div class="t">多 Agent 编队</div><div class="d">在同一时间线上，观察 Agent 间的通讯、活跃状态与委派工作。</div></div>' +
        '<div class="stats"><div class="stat"><div class="v">' + ((data.agents || []).length + 1) + '</div><div class="l">Agent</div></div>' +
        '<div class="stat"><div class="v">' + running + '</div><div class="l">运行中</div></div>' +
        '<div class="stat"><div class="v">' + (data.agents || []).length + '</div><div class="l">工作项</div></div>' +
        '<div class="stat"><div class="v">' + msgs + '</div><div class="l">消息</div></div></div></div>',
      '<div class="zci-row-2">' +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.blue + '"></span>Agent 网络<span class="zci-cnt">' + ((data.agents || []).length + 1) + " 个节点</span></h3>" +
        '<div class="zci-net">' + nodeCard({ name: main.name, tokens: main.tokens, requests: main.requests, activeMs: 0, cost: 0 }, C.blue, "主") +
        ((data.agents || []).length ? '<div class="zci-net-children">' + childRows + "</div>" : "") +
        "</div></div>" +
        '<div class="zci-card"><h3><span class="zci-ico" style="background:' + C.purple + '"></span>跨 Agent 协作<span class="zci-cnt">' + msgs + " 条消息</span></h3>" +
        '<div class="zci-events">' + (evRows || '<div class="zci-empty">这个编队还没有跨 Agent 事件</div>') + "</div></div></div>",
    ];
    body.innerHTML = parts.join("");
    body.querySelector("[data-back]").addEventListener("click", backToOverview);
    // 点击子 Agent 节点 -> 打开该子会话详情
    body.querySelectorAll("[data-open]").forEach(function (el) {
      el.addEventListener("click", function () {
        openSession(el.getAttribute("data-open"), "session");
      });
    });
    // hover 子节点 -> 点亮自身与主节点（父链），其余降透明
    var net = body.querySelector(".zci-net");
    if (net) {
      net.addEventListener("mouseover", function (e) {
        var node = e.target.closest("[data-agent]");
        net.classList.toggle("zci-dimnet", Boolean(node));
        var mainCard = net.querySelector(".zci-node");
        body.querySelectorAll("[data-agent]").forEach(function (n) {
          n.classList.toggle("zci-chain", n === node);
        });
        if (mainCard) mainCard.classList.toggle("zci-chain", Boolean(node));
      });
      net.addEventListener("mouseleave", function () {
        net.classList.remove("zci-dimnet");
        body.querySelectorAll("[data-agent]").forEach(function (n) {
          n.classList.remove("zci-chain");
        });
        var mainCard = net.querySelector(".zci-node");
        if (mainCard) mainCard.classList.remove("zci-chain");
      });
    }
    // 协作事件行点击展开
    body.querySelectorAll("[data-agev]").forEach(function (row) {
      row.addEventListener("click", function () {
        var id = row.getAttribute("data-agev");
        state.evOpen[id] = !state.evOpen[id];
        render();
      });
    });
    bindAll(body);
  }

  function render() {
    var body = state.bodyEl;
    if (!body) return;
    var tabs =
      '<div class="zci-tab ' + (state.tab === "overview" ? "zci-on" : "") + '" data-tab="overview">洞察</div>' +
      '<div class="zci-tab ' + (state.tab === "sessions" ? "zci-on" : "") + '" data-tab="sessions">会话</div>' +
      '<div class="zci-tab ' + (state.tab === "session" ? "zci-on" : "") + '" data-tab="session">上下文</div>' +
      '<div class="zci-tab ' + (state.tab === "agents" ? "zci-on" : "") + '" data-tab="agents">编队</div>';
    state.tabsEl.innerHTML = tabs;
    state.tabsEl.querySelectorAll("[data-tab]").forEach(function (el) {
      el.addEventListener("click", function () {
        var target = el.getAttribute("data-tab");
        if ((target === "session" || target === "agents") && !state.detailSessionId) {
          // pick the most recently active session — the one the user is likely in
          var sessions = (state.sessions && state.sessions.length ? state.sessions : null) ||
            (state.overview && state.overview.sessions) || [];
          var pick = null;
          sessions.forEach(function (s) {
            if (!pick || (s.lastActiveAt || 0) > (pick.lastActiveAt || 0)) pick = s;
          });
          if (pick && pick.id) {
            openSession(pick.id, target);
            return;
          }
          state.tab = "sessions";
          loadSessions(true);
          return;
        }
        state.tab = target;
        if (state.tab === "agents") loadAgents(state.detailSessionId);
        else if (state.tab === "sessions" && !state.sessions) loadSessions();
        else render();
      });
    });

    if (state.error) {
      body.innerHTML =
        '<div class="zci-err">' + esc(state.error) + '</div><div style="padding:0 20px"><button class="zci-btn" data-retry>重试</button></div>';
      body.querySelector("[data-retry]").addEventListener("click", function () {
        state.error = null;
        load();
      });
      return;
    }
    if (state.loading) {
      body.innerHTML = '<div class="zci-empty" style="font-size:13px">加载中…</div>';
      return;
    }
    function safe(name, fn) {
      try {
        fn();
      } catch (e) {
        body.innerHTML =
          '<div class="zci-err">渲染出错（' + esc(name) + '）：</div><pre style="white-space:pre-wrap;font-size:11px;color:#ff8fa0;padding:8px 20px 16px;margin:0;opacity:.8">' +
          esc(String((e && (e.stack || e.message)) || e)) + "</pre>";
      }
    }
    if (state.tab === "overview") safe("overview", function () { renderOverview(body); });
    else if (state.tab === "sessions") safe("sessions", function () { renderSessions(body); });
    else if (state.tab === "session") safe("session", function () { renderSessionDetail(body); });
    else if (state.tab === "agents") safe("agents", function () { renderAgents(body); });
  }

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  function load() {
    if (state.tab === "agents" && state.detailSessionId) return loadAgents(state.detailSessionId);
    state.loading = true;
    state.error = null;
    render();
    var args = { start: rangeStartMs(), end: Date.now(), order: state.order };
    if (state.tab === "sessions") return loadSessions();
    query("overview", args)
      .then(function (data) {
        state.overview = data && data.ok !== false ? data : state.overview;
        state.loading = false;
        if (state.tab === "overview") render();
      })
      .catch(function (e) {
        state.loading = false;
        state.error = e.message;
        if (state.tab === "overview") render();
      });
  }

  function loadSessions(openAfter) {
    state.loading = true;
    state.error = null;
    render();
    query("sessions", { start: rangeStartMs(), end: Date.now(), order: state.order, limit: 60 })
      .then(function (data) {
        state.sessions = (data && data.sessions) || [];
        state.loading = false;
        if (openAfter && state.sessions.length) {
          openSession(state.sessions[0].id, state.tab === "agents" ? "agents" : "session");
          return;
        }
        render();
      })
      .catch(function (e) {
        state.loading = false;
        state.error = e.message;
        render();
      });
  }

  function openSession(id, targetTab) {
    state.detailSessionId = id;
    state.tab = targetTab || "session";
    state.loading = true;
    state.error = null;
    render();
    if (state.tab === "agents") return loadAgents(id);
    query("session", { sessionId: id })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error && data.error.message) || "查询失败");
        state.sessionDetail = data;
        state.loading = false;
        render();
      })
      .catch(function (e) {
        state.loading = false;
        state.error = e.message;
        render();
      });
  }

  function loadAgents(id) {
    state.loading = true;
    state.error = null;
    render();
    query("agents", { sessionId: id })
      .then(function (data) {
        if (!data || data.ok === false) throw new Error((data && data.error && data.error.message) || "查询失败");
        state.agentsData = data;
        state.loading = false;
        render();
      })
      .catch(function (e) {
        state.loading = false;
        state.error = e.message;
        render();
      });
  }

  function backToOverview() {
    state.tab = "overview";
    state.sessionDetail = null;
    state.agentsData = null;
    state.detailSessionId = null;
    render();
  }

  /* ---------------------------------------------------------------- */
  /* Overlay + sidebar entry                                           */
  /* ---------------------------------------------------------------- */

  function buildOverlay() {
    var overlay = document.createElement("div");
    overlay.className = "zci-overlay";
    overlay.innerHTML =
      '<div class="zci-head"><div class="zci-title"><h1>上下文洞察</h1><span class="sub">数据来自本机 ZCode 用量库 · 费用为牌价估算</span></div><span class="zci-spacer"></span>' +
      '<div class="zci-seg">' +
      '<button class="zci-pill" data-range="today">今天</button>' +
      '<button class="zci-pill zci-on" data-range="7">近 7 天</button>' +
      '<button class="zci-pill" data-range="30">近 30 天</button></div>' +
      '<button class="zci-iconbtn zci-accent" data-refresh title="刷新">⟳</button>' +
      '<button class="zci-iconbtn" data-close title="关闭">✕</button></div>' +
      '<div class="zci-tabs"></div><div class="zci-body"></div>';
    document.body.appendChild(overlay);
    function syncOffset() {
      var aside = findAside();
      var w = 262;
      try {
        if (aside) {
          var rect = aside.getBoundingClientRect();
          if (rect && rect.width > 80) w = rect.width;
        }
      } catch {
        // keep default
      }
      overlay.style.left = w + 6 + "px";
    }
    syncOffset();
    window.addEventListener("resize", syncOffset);
    state.overlayEl = overlay;
    state.tabsEl = overlay.querySelector(".zci-tabs");
    state.bodyEl = overlay.querySelector(".zci-body");

    overlay.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.range = btn.getAttribute("data-range") === "today" ? "today" : Number(btn.getAttribute("data-range"));
        overlay.querySelectorAll("[data-range]").forEach(function (b) {
          b.classList.remove("zci-on");
        });
        btn.classList.add("zci-on");
        if (state.tab === "session" || state.tab === "agents") state.tab = "overview";
        load();
      });
    });
    overlay.querySelector("[data-refresh]").addEventListener("click", load);
    overlay.querySelector("[data-close]").addEventListener("click", closeOverlay);
    state.onKey = function (e) {
      if (e.key === "Escape") closeOverlay();
    };
    document.addEventListener("keydown", state.onKey, true);
    load();
  }

  function openOverlay() {
    if (!state.overlayEl) buildOverlay();
    else {
      state.overlayEl.style.display = "flex";
      load();
    }
  }

  function closeOverlay() {
    if (state.overlayEl) state.overlayEl.style.display = "none";
    if (state.onKey) document.removeEventListener("keydown", state.onKey, true);
  }

  function visible(el) {
    try {
      var rect = el.getBoundingClientRect();
      return rect && rect.width >= 80 && rect.height >= 80;
    } catch {
      return true;
    }
  }

  function findAside() {
    var list = [
      document.querySelector('aside[data-testid="sidebar"]'),
      document.querySelector('[data-workspace-sidebar-panel="true"] aside'),
      document.querySelector('nav[data-testid="sidebar"]'),
    ].filter(Boolean);
    return list.find(visible) || list[0] || null;
  }

  function isCompactProfileBlock(el, aside, panel) {
    if (!el || el === aside || el === panel || el === document.body) return false;
    if (!(aside.contains(el) || panel.contains(el))) return false;
    if (el.querySelector('aside[data-testid="sidebar"], nav[data-testid="sidebar"]')) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (!rect || rect.height <= 0 || rect.height > 140) return false;
    } catch {
      return false;
    }
    return true;
  }

  function findProfileBlock(aside) {
    var panel = aside.closest('[data-workspace-sidebar-panel="true"]') || aside.parentElement || aside;
    var triggers = [];
    ['[data-testid="login-trigger"]', '[data-testid="task-settings-button"]'].forEach(function (selector) {
      [aside, panel].forEach(function (root) {
        root.querySelectorAll(selector).forEach(function (el) {
          if (!triggers.includes(el)) triggers.push(el);
        });
      });
    });
    var trigger = null;
    var lowest = -Infinity;
    for (var el of triggers) {
      try {
        var rect = el.getBoundingClientRect();
        if (!rect || rect.height <= 0 || rect.top < lowest) continue;
        lowest = rect.top;
        trigger = el;
      } catch {
        // detached
      }
    }
    if (!trigger) return null;
    var best = null;
    var node = trigger;
    while (node && node !== aside && node !== panel && node !== document.body) {
      if (isCompactProfileBlock(node, aside, panel)) best = node;
      node = node.parentElement;
    }
    if (!best || !best.parentElement) return null;
    return { parent: best.parentElement, node: best };
  }

  function mountEntry() {
    var aside = findAside();
    if (!aside) return false;
    if (document.getElementById("zci-entry")) return true;
    var entry = document.createElement("div");
    entry.className = "zci-entry";
    entry.id = "zci-entry";
    entry.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="6" height="5" rx="1.5" fill="#4b7bff"/><rect x="9" y="2" width="6" height="5" rx="1.5" fill="#2bd576"/><rect x="1" y="9" width="6" height="5" rx="1.5" fill="#f59e42"/><rect x="9" y="9" width="6" height="5" rx="1.5" fill="#a78bfa"/></svg><span>上下文洞察</span>';
    entry.addEventListener("click", openOverlay);
    var footer = aside.querySelector(":scope > footer");
    if (footer) {
      aside.insertBefore(entry, footer);
      return true;
    }
    var profile = findProfileBlock(aside);
    if (profile && profile.parent && profile.node) {
      profile.parent.insertBefore(entry, profile.node);
      return true;
    }
    aside.appendChild(entry);
    return true;
  }

  function tryMount(attempt) {
    ensureStyle();
    if (mountEntry()) {
      if (state.observer) return;
      state.observer = new MutationObserver(function () {
        if (window.__zciLive !== BOOT_ID) return;
        if (!document.getElementById("zci-entry")) mountEntry();
      });
      window.__zciObserver = state.observer;
      window.__zciLive = BOOT_ID;
      try {
        state.observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        // ignore
      }
      return;
    }
    if (attempt < 120) setTimeout(function () { tryMount(attempt + 1); }, 500);
  }

  tryMount(0);

  window.__zcodeContextDispose = function () {
    try {
      if (window.__zciObserver) {
        window.__zciObserver.disconnect();
        window.__zciObserver = null;
      }
      var entry = document.getElementById("zci-entry");
      if (entry) entry.remove();
      var style = document.getElementById("zci-style");
      if (style) style.remove();
      if (state.overlayEl) state.overlayEl.remove();
      document.removeEventListener("keydown", state.onKey, true);
      window.__zcodeContextPanelBooted = false;
    } catch (e) {
      /* ignore */
    }
  };
})();
