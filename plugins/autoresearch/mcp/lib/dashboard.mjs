// Static dashboard renderer: pure function from ledger state to self-contained HTML.
import { escapeHtml } from "./html.mjs";
import { deltaFor } from "./ledger.mjs";

const STATUS_LABEL = {
  keep: "keep",
  discard: "discard",
  crash: "crash",
  checks_failed: "checks_failed",
  noop: "no-op",
};

export function renderDashboard(state) {
  return renderBody(state, false);
}

/** Live variant: same body plus an SSE client that auto-reloads on updates. */
export function renderLiveDashboard(state) {
  return renderBody(state, true);
}

function renderBody(state, live) {
  const cfg = state.config;
  const direction = cfg?.direction ?? "lower";
  const rows = state.runs
    .map((r, i) => {
      const delta = deltaFor(state, r.metric);
      const deltaText =
        delta == null ? "—" : (delta >= 0 ? "+" : "") + delta.toFixed(4);
      const improved = delta != null && delta > 0;
      return {
        i: i + 1,
        run: r,
        deltaText,
        improved,
        cls:
          r.status === "keep"
            ? "keep"
            : r.status === "discard"
              ? "discard"
              : "crash",
      };
    })
    .reverse(); // newest first

  const kept = state.runs.filter((r) => r.status === "keep");
  const failures = state.runs.filter((r) => r.status !== "keep");
  const conf = state.confidence;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoresearch — ${escapeHtml(cfg?.name ?? "session")}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif; margin: 2rem auto; max-width: 900px; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .meta { color: #666; font-size: .9rem; margin-bottom: 1.5rem; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: .8rem 1.2rem; min-width: 120px; }
  .card .n { font-size: 1.4rem; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #eee; vertical-align: top; }
  th { position: sticky; top: 0; background: #fafafa; }
  .keep { color: #1a7f37; }
  .discard { color: #b35900; }
  .crash { color: #c62828; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: .78rem; }
  .badge.keep { background: #d4edda; }
  .badge.discard { background: #ffe5c2; }
  .badge.crash { background: #f8d7da; }
  code { background: #f4f4f4; padding: 1px 5px; border-radius: 4px; font-size: .85em; }
  .desc { max-width: 340px; }
</style>
</head>
<body>
<h1>autoresearch · ${escapeHtml(cfg?.name ?? "session")}</h1>
<div class="meta">
  ${cfg ? `metric <code>${escapeHtml(cfg.metricName ?? "")}</code> · direction <code>${escapeHtml(direction)}</code>` : "no session yet"}
  ${cfg?.metricUnit ? ` · unit <code>${escapeHtml(cfg.metricUnit)}</code>` : ""}
</div>
<div class="cards">
  <div class="card"><div class="n">${state.runs.length}</div>experiments</div>
  <div class="card"><div class="n">${kept.length}</div>kept</div>
  <div class="card"><div class="n">${failures.length}</div>reverted</div>
  <div class="card"><div class="n">${state.baseline ?? "—"}</div>baseline</div>
  <div class="card"><div class="n">${state.best ?? "—"}</div>best</div>
  ${conf ? `<div class="card"><div class="n" style="color:${conf.level === "green" ? "#1a7f37" : conf.level === "yellow" ? "#b35900" : "#c62828"}">${escapeHtml(conf.level)}</div>confidence</div>` : ""}
</div>
${
  rows.length === 0
    ? "<p>暂无实验记录。</p>"
    : `
<table>
<thead><tr><th>#</th><th>status</th><th>metric</th><th>Δ vs baseline</th><th>commit</th><th>description</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
  <td>${r.i}</td>
  <td><span class="badge ${r.cls}">${STATUS_LABEL[r.run.status] ?? escapeHtml(r.run.status)}</span></td>
  <td>${r.run.metric ?? "—"}</td>
  <td class="${r.cls}">${r.improved ? "▲" : "▼"} ${escapeHtml(r.deltaText)}</td>
  <td>${r.run.commit ? `<code>${escapeHtml(r.run.commit)}</code>` : "—"}</td>
  <td class="desc">${escapeHtml(r.run.description ?? "")}</td>
</tr>`,
  )
  .join("\n")}
</tbody>
</table>`
}
${
  live
    ? `<script>
(function () {
  const es = new EventSource('/events');
  es.addEventListener('jsonl-updated', () => { location.reload(); });
})();
</script>`
    : ""
}
</body>
</html>`;
}
