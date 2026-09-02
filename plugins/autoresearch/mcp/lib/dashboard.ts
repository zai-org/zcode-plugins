// Static dashboard renderer: pure function from ledger state to self-contained HTML.
import { escapeHtml } from "./html.ts";
import { deltaFor } from "./ledger.ts";
import type { LedgerRun, SessionState } from "./types.ts";

const STATUS_LABEL: Record<string, string> = {
  keep: "keep",
  discard: "discard",
  crash: "crash",
  checks_failed: "checks_failed",
  noop: "no-op",
};

/** Compact metric number: 4-decimal cap with trailing zeros stripped (42.0000 → 42). */
function fmtMetric(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return String(Number(v.toFixed(4)));
}

/**
 * Nice grid-tick values for [lo, hi]: step is 1/2/2.5/5 × 10^k, so tick values
 * stay short and all share the same decimal precision — no 61.6667-style noise.
 */
function niceTicks(
  lo: number,
  hi: number,
  target = 3,
): Array<{ value: number; decimals: number }> {
  const raw = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / pow;
  const step =
    pow *
    (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10);
  const ds = String(step).split(".")[1];
  const decimals = ds ? ds.replace(/0+$/, "").length : 0;
  const out: Array<{ value: number; decimals: number }> = [];
  const first = Math.ceil((lo - 1e-9) / step);
  const last = Math.floor((hi + 1e-9) / step);
  for (let k = first; k <= last; k++) out.push({ value: k * step, decimals });
  return out;
}

/**
 * Inline-SVG metric trend: valid metric points in run order (keep filled,
 * others hollow), baseline as a dashed reference, light horizontal grid ticks
 * with values on the left. Fewer than 2 points → "". Zero external resources —
 * the dashboard must stay self-contained.
 */
function renderTrendSvg(state: SessionState): string {
  const pts = state.runs.filter(
    (r): r is LedgerRun & { metric: number } =>
      r.metric != null && Number.isFinite(r.metric),
  );
  if (pts.length < 2) return "";
  const W = 860;
  const H = 120;
  const padX = 44; // left gutter carries the grid-tick values
  const padY = 10;
  const vals = pts.map((r) => r.metric);
  let lo = Math.min(...vals, state.baseline ?? Infinity);
  let hi = Math.max(...vals, state.baseline ?? -Infinity);
  if (hi === lo) {
    lo -= 1; // degenerate flat line → pad it so points sit mid-chart
    hi += 1;
  }
  const span = hi - lo;
  const x = (i: number) => padX + (i * (W - 2 * padX)) / (pts.length - 1);
  const y = (v: number) => padY + ((hi - v) * (H - 2 * padY)) / span;
  // Light horizontal grid ticks at "nice" values covering [lo, hi].
  const ticks = niceTicks(lo, hi)
    .map(({ value: v, decimals }) => {
      const yy = y(v);
      return (
        `<line class="gline" x1="${padX}" y1="${yy.toFixed(1)}" x2="${W - padX}" y2="${yy.toFixed(1)}"/>` +
        `<text x="${padX - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end">${v.toFixed(decimals)}</text>`
      );
    })
    .join("");
  const poly = pts.map(
    (r, i) => `${x(i).toFixed(1)},${y(r.metric).toFixed(1)}`,
  );
  const circleCls = (st: string) =>
    st === "keep"
      ? "c-keep"
      : st === "discard"
        ? "c-discard"
        : st === "noop"
          ? "c-noop"
          : "c-fail";
  const circles = pts
    .map(
      (r, i) =>
        `<circle class="${circleCls(r.status)}" cx="${x(i).toFixed(1)}" cy="${y(r.metric).toFixed(1)}" r="3.5"/>`,
    )
    .join("");
  const baseline = state.baseline;
  const baseLine =
    baseline != null &&
    Number.isFinite(baseline) &&
    baseline >= lo &&
    baseline <= hi
      ? `<line class="base" x1="${padX}" y1="${y(baseline).toFixed(1)}" x2="${W - padX}" y2="${y(baseline).toFixed(1)}"/>` +
        `<text x="${W - padX}" y="${(y(baseline) - 4).toFixed(1)}" text-anchor="end">baseline ${escapeHtml(fmtMetric(baseline))}</text>`
      : "";
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="metric trend">
${ticks}
<polyline class="line" points="${poly.join(" ")}"/>
${baseLine}
${circles}
</svg>`;
}

export function renderDashboard(state: SessionState): string {
  return renderBody(state, false);
}

/** Live variant: same body plus an SSE client that auto-reloads on updates. */
export function renderLiveDashboard(state: SessionState): string {
  return renderBody(state, true);
}

function renderBody(state: SessionState, live: boolean): string {
  const cfg = state.config;
  const direction = cfg?.direction ?? "lower";
  const rows = state.runs
    .map((r, i) => {
      const delta = deltaFor(state, r.metric);
      const deltaText =
        delta == null ? "—" : (delta >= 0 ? "+" : "") + fmtMetric(delta);
      const improved = delta != null && delta > 0;
      const cls =
        r.status === "keep"
          ? "keep"
          : r.status === "discard"
            ? "discard"
            : r.status === "noop"
              ? "noop"
              : "crash";
      return { i: i + 1, run: r, deltaText, improved, cls };
    })
    .reverse(); // newest first

  const kept = state.runs.filter((r) => r.status === "keep");
  const failures = state.runs.filter((r) => r.status !== "keep");
  const conf = state.confidence;
  const trend = renderTrendSvg(state);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoresearch: ${escapeHtml(cfg?.name ?? "session")}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1f2328; --muted: #59636e;
    --border: #d9dde1; --card-bg: #ffffff; --th-bg: #f5f6f8; --code-bg: #f0f1f3;
    --keep: #1a7f37; --discard: #b35900; --fail: #c62828; --neutral: #6e7781;
    --badge-keep-bg: #d4edda; --badge-discard-bg: #ffe5c2;
    --badge-fail-bg: #f8d7da; --badge-neutral-bg: #e8eaed;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1;
      --border: #3d444d; --card-bg: #161b22; --th-bg: #1c2129; --code-bg: #21262d;
      --keep: #3fb950; --discard: #d29a22; --fail: #f85149; --neutral: #9198a1;
      --badge-keep-bg: #12261e; --badge-discard-bg: #2d230f;
      --badge-fail-bg: #2d1416; --badge-neutral-bg: #21262d;
    }
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Segoe UI", sans-serif; background: var(--bg); color: var(--fg); margin: 2rem auto; max-width: 900px; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .meta { color: var(--muted); font-size: .9rem; margin-bottom: 1.5rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .card { border: 1px solid var(--border); background: var(--card-bg); border-radius: 8px; padding: .8rem 1.2rem; }
  .card .n { font-size: 1.4rem; font-weight: 600; }
  .trend { margin-bottom: 1.5rem; }
  .trend svg { display: block; width: 100%; height: auto; }
  .trend .line { fill: none; stroke: var(--muted); opacity: .55; }
  .trend .base { stroke: var(--muted); stroke-dasharray: 5 4; }
  .trend .gline { stroke: var(--border); }
  .trend .c-keep { fill: var(--keep); }
  .trend .c-discard { fill: var(--card-bg); stroke: var(--discard); stroke-width: 1.5; }
  .trend .c-fail { fill: var(--card-bg); stroke: var(--fail); stroke-width: 1.5; }
  .trend .c-noop { fill: var(--card-bg); stroke: var(--neutral); stroke-width: 1.5; }
  .trend text { fill: var(--muted); font-size: 10px; }
  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { position: sticky; top: 0; background: var(--th-bg); color: var(--fg); }
  .keep { color: var(--keep); }
  .discard { color: var(--discard); }
  .crash { color: var(--fail); }
  .noop { color: var(--neutral); }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: .78rem; }
  .badge.keep { background: var(--badge-keep-bg); }
  .badge.discard { background: var(--badge-discard-bg); }
  .badge.crash { background: var(--badge-fail-bg); }
  .badge.noop { background: var(--badge-neutral-bg); }
  code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; font-size: .85em; }
  .desc { max-width: 340px; overflow-wrap: anywhere; }
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
  <div class="card"><div class="n">${fmtMetric(state.baseline)}</div>baseline</div>
  <div class="card"><div class="n">${fmtMetric(state.best)}</div>best</div>
  ${conf ? `<div class="card"><div class="n" style="color:var(--${conf.level === "green" ? "keep" : conf.level === "yellow" ? "discard" : "fail"})">${escapeHtml(conf.level)}</div>confidence ${conf.confidence.toFixed(2)}</div>` : ""}
</div>
${trend ? `<div class="trend">${trend}</div>` : ""}
${
  rows.length === 0
    ? "<p>暂无实验记录。</p>"
    : `
<div class="tablewrap">
<table>
<thead><tr><th>#</th><th>status</th><th>metric</th><th>Δ vs baseline</th><th>commit</th><th>description</th></tr></thead>
<tbody>
${rows
  .map(
    (r) => `<tr>
  <td>${r.i}</td>
  <td><span class="badge ${r.cls}">${STATUS_LABEL[r.run.status] ?? escapeHtml(r.run.status)}</span></td>
  <td>${fmtMetric(r.run.metric)}</td>
  <td class="${r.cls}">${r.improved ? "▲" : "▼"} ${escapeHtml(r.deltaText)}</td>
  <td>${r.run.commit ? `<code>${escapeHtml(r.run.commit)}</code>` : "—"}</td>
  <td class="desc">${escapeHtml(r.run.description ?? "")}</td>
</tr>`,
  )
  .join("\n")}
</tbody>
</table>
</div>`
}
${
  live
    ? `<script>
(function () {
  // Preserve the scroll position across the auto-reload so an update never
  // kicks the viewer (who is usually reading the history table) back to top.
  var KEY = 'autoresearch-dash-scroll';
  try {
    var y = sessionStorage.getItem(KEY);
    if (y != null) window.scrollTo(0, Number(y));
  } catch (e) {}
  const es = new EventSource('/events');
  es.addEventListener('jsonl-updated', () => {
    try { sessionStorage.setItem(KEY, String(window.scrollY)); } catch (e) {}
    location.reload();
  });
})();
</script>`
    : ""
}
</body>
</html>`;
}
