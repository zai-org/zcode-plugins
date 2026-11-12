// Archive dashboard renderer: pure function from full ledger history to
// self-contained HTML (editorial layout; static and live share renderBody).
import { escapeHtml } from "./html.ts";
import type { SessionHistory } from "./ledger.ts";
import type { LedgerRun } from "./types.ts";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  keep: { label: "KEEP", cls: "keep" },
  discard: { label: "DISCARD", cls: "discard" },
  crash: { label: "CRASH", cls: "crash" },
  checks_failed: { label: "CHECKS", cls: "crash" },
  noop: { label: "NO-OP", cls: "noop" },
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
/** Exported for tests: tick computation is spec-pinned (decimals invariant). */
export function niceTicks(
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
  // String(step) is exponential for sub-micro steps ("2.5e-7"), which a naive
  // split(".") misreads ("5e-7" → 4 decimals → every label collapses to
  // 0.0000). Below 1, derive decimals from the magnitude instead; the step
  // mantissa is a closed set {1, 2, 2.5, 5, 10} × 10^k, and 2.5 carries one
  // extra fractional digit.
  const exp = Math.floor(Math.log10(step));
  // The +1 tracks the step's mantissa being 2.5 (0.25/2.5e-7 need one extra
  // digit), i.e. the same (2, 2.5] band the step selector maps to the 2.5
  // coefficient — not norm === 2.5 exact equality, which misses norm 2.1→step
  // 0.25 (gridline labeled "0.3") and norm 2.1e-7→step 2.5e-7 ("0.0000002").
  const decimals =
    step >= 1
      ? (String(step).split(".")[1]?.replace(/0+$/, "").length ?? 0)
      : Math.min(20, -exp + (norm > 2 && norm <= 2.5 ? 1 : 0));
  const out: Array<{ value: number; decimals: number }> = [];
  const first = Math.ceil((lo - 1e-9) / step);
  const last = Math.floor((hi + 1e-9) / step);
  for (let k = first; k <= last; k++) out.push({ value: k * step, decimals });
  return out;
}

/** Overall best-vs-baseline change in percent, direction-aware improvement. */
function overallPct(
  first: number | null,
  best: number | null,
  direction: string,
): { text: string; cls: string } | null {
  if (first == null || best == null || !Number.isFinite(first) || first === 0)
    return null;
  const pct = ((best - first) / Math.abs(first)) * 100;
  const improved = direction === "higher" ? pct > 0 : pct < 0;
  if (Math.abs(pct) < 1e-9) return { text: "±0%", cls: "neut" };
  const text = `${pct > 0 ? "+" : "−"}${Number(Math.abs(pct).toFixed(1))}%`;
  return { text, cls: improved ? "up" : "down" };
}

/**
 * Inline-SVG metric trend across the whole ledger: valid metric points in
 * global order (keep filled, others hollow, each labelled with its ordinal),
 * the first measured metric as a dashed baseline. Fewer than 2 points →
 * "". Zero external resources —
 * the dashboard must stay self-contained.
 */
function renderTrendSvg(
  history: SessionHistory,
  variant: "desktop" | "mobile",
): string {
  const pts: Array<{ run: LedgerRun; ordinal: number }> = [];
  for (const [i, r] of history.runs.entries()) {
    if (r.metric != null && Number.isFinite(r.metric))
      pts.push({ run: r, ordinal: i + 1 });
  }
  if (pts.length < 2) return "";
  // Both variants are emitted; CSS picks one per viewport. The mobile variant
  // renders at 1:1 scale (a downscaled 960px SVG makes its labels unreadable).
  const dims =
    variant === "mobile"
      ? {
          W: 390,
          H: 240,
          padX: 30,
          padY: 26,
          dotR: 3.5,
          lineW: 2,
          svgCls: "chart-m",
        }
      : {
          W: 960,
          H: 240,
          padX: 52, // left gutter carries the grid-tick values
          padY: 24,
          dotR: 4,
          lineW: 1.8,
          svgCls: "chart-d",
        };
  const { W, H, padX, padY, dotR, lineW, svgCls } = dims;
  const total = history.totalRuns;
  const vals = pts.map((p) => p.run.metric as number);
  let lo = Math.min(...vals, history.firstMetric ?? Infinity);
  let hi = Math.max(...vals, history.firstMetric ?? -Infinity);
  if (hi === lo) {
    lo -= 1; // degenerate flat line → pad it so points sit mid-chart
    hi += 1;
  }
  const span = hi - lo;
  const x = (n: number) => padX + ((n - 1) * (W - 2 * padX)) / (total - 1);
  const y = (v: number) => padY + ((hi - v) * (H - 2 * padY)) / span;
  const tickFont = variant === "mobile" ? 11 : 10;
  const labelFont = variant === "mobile" ? 9.5 : 9;
  const labelLift = variant === "mobile" ? 12 : 10;
  // Light horizontal grid ticks at "nice" values covering [lo, hi].
  const ticks = niceTicks(lo, hi)
    .map(({ value: v, decimals }) => {
      const yy = y(v);
      return (
        `<line class="gl" x1="${padX}" y1="${yy.toFixed(1)}" x2="${W - padX}" y2="${yy.toFixed(1)}"/>` +
        `<text x="${padX - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="${tickFont}">${v.toFixed(decimals)}</text>`
      );
    })
    .join("");
  const baseLine =
    history.firstMetric != null &&
    Number.isFinite(history.firstMetric) &&
    history.firstMetric >= lo &&
    history.firstMetric <= hi
      ? `<line class="base" x1="${padX}" y1="${y(history.firstMetric).toFixed(1)}" x2="${W - padX}" y2="${y(history.firstMetric).toFixed(1)}"/>` +
        `<text class="base-t" x="${W - padX}" y="${(y(history.firstMetric) - 6).toFixed(1)}" text-anchor="end" font-size="${tickFont}">baseline ${escapeHtml(fmtMetric(history.firstMetric))}</text>`
      : "";
  const poly = pts.map(
    (p) => `${x(p.ordinal).toFixed(1)},${y(p.run.metric as number).toFixed(1)}`,
  );
  const dots = pts
    .map((p) => {
      const cls = p.run.status === "keep" ? "dk" : "dh"; // discard / crash / checks_failed / noop → hollow red
      return (
        `<a href="#run-${p.ordinal}" aria-label="实验 ${p.ordinal}: ${escapeHtml(p.run.description ?? "")}，${escapeHtml(fmtMetric(p.run.metric))}"><title>#${p.ordinal} · ${escapeHtml(fmtMetric(p.run.metric))} · ${escapeHtml(p.run.description ?? "")}</title><circle class="${cls}" cx="${x(p.ordinal).toFixed(1)}" cy="${y(p.run.metric as number).toFixed(1)}" r="${dotR}"/></a>` +
        `<text class="dv" x="${x(p.ordinal).toFixed(1)}" y="${(y(p.run.metric as number) - labelLift).toFixed(1)}" text-anchor="middle" font-size="${labelFont}">#${p.ordinal}</text>`
      );
    })
    .join("");
  return `<svg class="${svgCls}" viewBox="0 0 ${W} ${H}" role="group" aria-label="metric trend (${variant})">
${ticks}
${baseLine}
<polyline class="ln" points="${poly.join(" ")}" stroke-width="${lineW}"/>
${dots}
</svg>`;
}

/** Δ text vs the segment baseline; 0 renders neutral (no ▲/▼ mismatch). */
function deltaFor(
  metric: number | null | undefined,
  baseline: number | null,
  direction: string,
): { text: string; cls: string } | null {
  if (metric == null || !Number.isFinite(metric) || baseline == null)
    return null;
  const raw = metric - baseline;
  const delta = direction === "higher" ? raw : -raw;
  if (Math.abs(delta) < 1e-9) return { text: "±0", cls: "neut" };
  return delta > 0
    ? { text: `▲ +${fmtMetric(delta)}`, cls: "up" }
    : { text: `▼ −${fmtMetric(-delta)}`, cls: "down" };
}

export function renderDashboard(
  history: SessionHistory,
  opts: { pin?: string | null } = {},
): string {
  return renderBody(history, false, opts);
}

/** Live variant: same body plus an SSE client that auto-reloads on updates. */
export function renderLiveDashboard(
  history: SessionHistory,
  opts: { pin?: string | null } = {},
): string {
  return renderBody(history, true, opts);
}

function renderBody(
  history: SessionHistory,
  live: boolean,
  opts: { pin?: string | null },
): string {
  const current = history.config;
  const direction = current?.direction ?? "lower";
  const name = current?.name ?? "session";
  const pin = opts.pin ?? null;

  // Confidence verdict wording: level → human verdict (colored by level).
  const CONF_VERDICT: Record<string, string> = {
    green: "PASS",
    yellow: "WEAK",
    red: "FAIL",
  };
  const conf = history.confidence;
  // Result-first hero metrics: the baseline→best story as the centerpiece,
  // process counts + confidence verdict demoted to a quiet meta line.
  const hasResult =
    history.firstMetric != null &&
    Number.isFinite(history.firstMetric) &&
    history.bestMetric != null &&
    Number.isFinite(history.bestMetric);
  const overall = hasResult
    ? overallPct(history.firstMetric, history.bestMetric, direction)
    : null;
  const result = hasResult
    ? `<div class="result">
  <div class="fig past"><div class="n">${fmtMetric(history.firstMetric)}</div><div class="l">baseline</div></div>
  <div class="arr" aria-hidden="true"></div>
  <div class="fig"><div class="n">${fmtMetric(history.bestMetric)}</div><div class="l">best</div></div>
  ${
    overall
      ? `<div class="fig delta ${overall.cls}"><div class="n">${overall.text}</div><div class="l">overall</div></div>`
      : ""
  }
</div>`
    : "";
  const noop = history.runs.filter((r) => r.status === "noop").length;
  const metaItems = [
    `${history.totalRuns} experiments`,
    `${history.kept} kept`,
    `${history.totalRuns - history.kept - noop} reverted`,
    `${noop} no-op`,
  ];
  if (conf) {
    const verdict = CONF_VERDICT[conf.level] ?? escapeHtml(conf.level);
    metaItems.push(
      `<span class="conf-${conf.level}">${verdict}</span> ${conf.confidence.toFixed(2)}× noise`,
    );
  }
  const meta = metaItems.join(`<span class="dot"> · </span>`);
  const heroMetrics =
    history.totalRuns === 0
      ? ""
      : `
  ${result}
  <p class="meta">${meta}</p>`;

  // Flat ledger: every run in ledger order, no segment grouping. Δ is
  // computed against the global baseline (first measured metric).
  const rows: string[] = [];
  history.runs.forEach((r, i) => {
    const badge = STATUS_BADGE[r.status] ?? {
      label: escapeHtml(r.status),
      cls: "noop",
    };
    const d = deltaFor(r.metric, history.firstMetric, direction);
    // Grounded-revisit marker: only a positive integer counts; anything
    // else (missing, 0, negative, non-numeric) renders the plain row.
    const revisits = r.asi?.revisits_run;
    const revisitsN =
      typeof revisits === "number" && Number.isInteger(revisits) && revisits > 0
        ? revisits
        : null;
    // ADR-11 (help-first): hypothesis / next_action_hint / rollback carry the
    // loop's reasoning but only reached the agent via memory-inject — the
    // dashboard showed nothing. Render them as a collapsible block so a human
    // reading the trend can answer "why did this round do what it did".
    const asiParts: Array<[string, string]> = [];
    if (typeof r.asi?.hypothesis === "string" && r.asi.hypothesis.length > 0)
      asiParts.push(["假设", r.asi.hypothesis]);
    if (
      typeof r.asi?.next_action_hint === "string" &&
      r.asi.next_action_hint.length > 0
    )
      asiParts.push(["下一步", r.asi.next_action_hint]);
    if (typeof r.asi?.rollback === "string" && r.asi.rollback.length > 0)
      asiParts.push(["回滚理由", r.asi.rollback]);
    const asiBlock =
      asiParts.length > 0
        ? `<details class="r-asi"><summary>假设与结论</summary>${asiParts
            .map(
              ([k, v]) =>
                `<div class="asi-row"><span class="asi-k">${k}</span><span class="asi-v">${escapeHtml(v)}</span></div>`,
            )
            .join("")}</details>`
        : "";
    rows.push(`<div class="run" id="run-${i + 1}" data-status="${r.status === "keep" ? "keep" : r.status === "noop" ? "noop" : "reverted"}" tabindex="-1">
  <div class="r-no">${i + 1}</div>
  <div class="r-stamp ${badge.cls}">${badge.label}</div>
  <div class="r-metric">${fmtMetric(r.metric)}${r.metric != null && current?.metricUnit ? `<span class="u">${escapeHtml(current.metricUnit)}</span>` : ""}</div>
  <div class="r-delta">${d ? `<span class="d ${d.cls}">${d.text}</span>` : `<span class="d neut">—</span>`}</div>
  <div class="r-desc">${escapeHtml(r.description ?? "")}${revisitsN != null ? ` <span class="revisits">↻ Revisiting #${revisitsN}</span>` : ""}${asiBlock}</div>
  <div class="r-commit">${r.commit ? `<code>${escapeHtml(r.commit)}</code>` : ""}</div>
</div>`);
  });

  // Ledger rows are hand-editable: never assume timestamp is a string, and
  // escape it like every other piece of ledger-derived text.
  const lastRunAt =
    typeof history.lastRunAt === "string" ? history.lastRunAt : null;
  const lastDate = lastRunAt ? escapeHtml(lastRunAt.slice(0, 10)) : null;
  const footer = `
  <span>autoresearch${lastDate ? ` · ${lastDate}` : ""}</span><span>${history.totalRuns} runs${pin ? ` · pinned at ${escapeHtml(pin)}` : ""}</span>`;

  const trend =
    renderTrendSvg(history, "desktop") + renderTrendSvg(history, "mobile");
  const body =
    history.totalRuns === 0
      ? `<p class="empty">暂无实验记录。</p>`
      : `${trend ? `<figure class="chart"><figcaption><span>度量趋势 <small>全部实验 · ${escapeHtml(current?.metricName ?? "metric")}</small></span><span class="legend">● 保留 · ○ 未保留</span></figcaption>${trend}</figure>` : ""}
<section class="history"><div class="history-title"><h2>实验记录 <span>${history.totalRuns}</span></h2><div class="filters" hidden aria-label="筛选实验">${[
          ["all", "全部"],
          ["keep", "保留"],
          ["reverted", "回退"],
          ["noop", "无改动"],
        ]
          .map(
            ([key, label]) =>
              `<button type="button" data-filter="${key}" aria-pressed="${key === "all"}">${label}</button>`,
          )
          .join("")}</div></div><div class="ledger">
<div class="l-head"><span>#</span><span>状态</span><span>metric</span><span>Δ vs baseline</span><span>假设与结论</span><span>commit</span></div>
${rows.join("\n")}
</div></section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoresearch: ${escapeHtml(name)}</title>
<style>
  :root {
    color-scheme: light dark;
    /* light: warm paper, ink, single rust accent */
    --bg: #f3f1ea; --panel: #fbfaf5; --fg: #23281f; --muted: #6b7263;
    --line: #d8d9cc; --accent: #a4482e; --accent-soft: #f2e8df;
    --keep: #2f6b3a; --discard: #9a6b2f; --crash: #a13d3d; --neut: #6b7263;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    --serif: "Iowan Old Style", "Palatino Linotype", "Songti SC", "Noto Serif CJK SC", serif;
    --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      /* dark: deep surface, cyan accent */
      --bg: #0b0f14; --panel: #111823; --fg: #e8edf4; --muted: #93a1b3;
      --line: #ffffff17; --accent: #22d3ee; --accent-soft: #0e2a33;
      --keep: #3fb950; --discard: #d29a22; --crash: #f85149; --neut: #93a1b3;
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--sans); background: var(--bg); color: var(--fg);
    margin: 0; line-height: 1.65; -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: light) {
    body { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E"); }
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 0 1.5rem; }

  .hero { padding: 4.5rem 0 2.25rem; border-bottom: 1px solid var(--line); }
  h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(2.4rem, 5.5vw, 3.6rem); line-height: 1.1; margin: 0 0 2.5rem; letter-spacing: .01em; overflow-wrap: anywhere; }
  /* result-first hero metrics: baseline → best story, quiet meta line below */
  .result { display: flex; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; margin: 0 0 1.1rem; }
  .fig .n { font-family: var(--serif); font-size: 2.8rem; font-weight: 600; line-height: 1.1; }
  .fig.past .n { color: var(--muted); }
  .fig.delta.up .n { color: var(--accent); }
  .fig.delta.down .n { color: var(--crash); }
  .fig .l { font: .68rem var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .arr { position: relative; width: 72px; height: 1px; background: var(--muted); opacity: .7; align-self: center; }
  .arr::after { content: ""; position: absolute; right: 0; top: -3.5px; border-left: 7px solid var(--muted); border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent; }
  .meta { font: .78rem/1.8 var(--mono); color: var(--muted); margin: 0; }
  .meta .dot { opacity: .55; }
  .conf-green { color: var(--keep); }
  .conf-yellow { color: var(--discard); }
  .conf-red { color: var(--crash); }

  .chart { margin: 2.5rem 0 2rem; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1rem 1rem .5rem; }
  .chart svg { width: 100%; height: auto; }
  .chart-d { display: block; }
  .chart .gl { stroke: var(--line); }
  .chart text { fill: var(--muted); font-family: var(--mono); }
  .chart .base { stroke: var(--muted); stroke-dasharray: 6 5; opacity: .75; }
  .chart .ln { fill: none; stroke: var(--accent); opacity: .85; }
  .chart .dk { fill: var(--keep); }
  .chart .dh { fill: var(--panel); stroke: var(--crash); stroke-width: 1.6; }
  .chart .dv { opacity: .8; }
  /* two chart variants rendered; CSS picks per viewport (mobile is 1:1 scale) */
  .chart-m { display: none; }

  .ledger { border-top: 1px solid var(--line); }
  .l-head, .run {
    display: grid; grid-template-columns: 3rem 6.5rem 8rem 8.5rem 1fr 7rem;
    gap: 0 1rem; align-items: baseline; padding: .8rem 0;
  }
  .l-head { font: 500 .68rem var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); padding: .6rem 0 .5rem; border-bottom: 1px solid var(--line); }
  .run { border-bottom: 1px solid var(--line); }
  .r-no { font-family: var(--serif); font-size: 1.5rem; font-weight: 600; color: var(--muted); }
  .r-stamp { font: 500 .72rem/1 var(--mono); letter-spacing: .08em; padding: .3em .65em; border-radius: 2px; justify-self: start; }
  .r-stamp.keep { color: var(--keep); background: color-mix(in srgb, var(--keep) 12%, transparent); }
  .r-stamp.discard { color: var(--discard); background: color-mix(in srgb, var(--discard) 14%, transparent); }
  .r-stamp.crash { color: var(--crash); background: color-mix(in srgb, var(--crash) 12%, transparent); }
  .r-stamp.noop { color: var(--neut); background: color-mix(in srgb, var(--neut) 12%, transparent); }
  .r-metric { font: 500 1.05rem var(--mono); white-space: nowrap; }
  .r-metric .u { font-size: .72rem; color: var(--muted); margin-left: .3em; }
  .d { font: .85rem var(--mono); }
  .d.up { color: var(--keep); }
  .d.down { color: var(--crash); }
  .d.neut { color: var(--neut); }
  .r-desc { font-size: .9rem; min-width: 0; overflow-wrap: anywhere; }
  .revisits { color: var(--muted); font: .75rem var(--mono); white-space: nowrap; }
  .r-asi { margin-top: 3px; font-size: .78rem; }
  .r-asi summary { cursor: pointer; opacity: .65; }
  .asi-row { display: flex; gap: 6px; margin: 4px 0; }
  .asi-k { flex: none; font-weight: 600; opacity: .7; }
  .asi-v { white-space: pre-wrap; word-break: break-word; min-width: 0; }
  .r-commit { font: .78rem var(--mono); text-align: right; }
  .r-commit code { background: var(--accent-soft); padding: 1px 6px; border-radius: 4px; overflow-wrap: anywhere; }
  .empty { color: var(--muted); padding: 2rem 0 3rem; }

  .footer { margin-top: 3.5rem; padding: 1.5rem 0 3rem; border-top: 1px solid var(--line); font: .75rem var(--mono); color: var(--muted); display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; overflow-wrap: anywhere; }
  @media (max-width: 760px) {
    .wrap { padding: 0 1.1rem; }
    .hero { padding: 3.25rem 0 1.75rem; }
    h1 { font-size: 1.9rem; margin-bottom: 1.75rem; }
    .l-head { display: none; }
    /* result-first metrics shrink; meta line wraps naturally */
    .result { gap: 1rem; }
    .fig .n { font-size: 1.9rem; }
    .fig .l { font-size: .62rem; }
    .arr { width: 36px; }
    .meta { font-size: .72rem; }
    .chart { margin: 1.75rem 0 1.5rem; padding: .7rem .7rem .35rem; border-radius: 6px; }
    .chart-d { display: none; }
    .chart-m { display: block; }
    /* ledger row: one dense table line (# · badge · metric · Δ), details below */
    .run {
      grid-template-columns: auto auto auto 1fr auto;
      grid-template-areas:
        "no stamp commit metric delta"
        "desc desc desc desc desc";
      column-gap: .55rem;
      row-gap: .15rem;
      align-items: baseline;
      padding: .55rem 0;
    }
    .r-no { grid-area: no; font: 500 .85rem var(--mono); }
    .r-stamp { grid-area: stamp; font-size: .62rem; padding: .2em .5em; }
    .r-metric { grid-area: metric; font-size: .85rem; justify-self: end; }
    .r-delta { grid-area: delta; font-size: .85rem; }
    .r-desc { grid-area: desc; font-size: .8rem; color: var(--muted); }
    .r-desc .revisits { font-size: .7rem; }
    .r-commit { grid-area: commit; align-self: center; }
    .r-commit code { font-size: .68rem; padding: 0 4px; background: none; }
    /* footer: date only on mobile — runs/pinned are desktop metadata */
    .footer { margin-top: 2rem; padding: 1.1rem 0 2rem; }
    .footer span + span { display: none; }
  }

  /* Report hierarchy: quiet surfaces, one accent, evidence gets the width. */
  .wrap { max-width: 1160px; padding-inline: clamp(20px, 4vw, 48px); }
  .hero { padding-top: clamp(40px, 6vw, 80px); padding-bottom: 32px; }
  h1 { font-size: clamp(2rem, 1.4rem + 2vw, 3.2rem); max-width: 24ch; margin-bottom: 16px; letter-spacing: -.025em; }
  .metric-context { color: var(--muted); font: 12px var(--mono); margin: 0 0 32px; overflow-wrap: anywhere; }
  .metric-context span { font-family: var(--sans); margin-left: 16px; }
  .result { display: grid; grid-template-columns: auto 48px auto 1fr; gap: 24px; align-items: end; margin-bottom: 28px; }
  .fig .n { font-family: var(--sans); font-size: clamp(24px, 1rem + 2vw, 40px); font-weight: 400; letter-spacing: -.045em; font-variant-numeric: tabular-nums; }
  .fig .l { margin-top: 10px; font-size: 10px; }
  .fig.delta { justify-self: end; }
  .fig.delta .n { font-size: clamp(44px, 2rem + 4vw, 80px); font-weight: 600; line-height: .95; }
  .arr { width: 40px; align-self: end; margin-bottom: calc(22px + clamp(24px, 1rem + 2vw, 40px) * .55); }
  .chart { margin: 32px 0 40px; padding: 20px 20px 12px; border-radius: 4px; }
  figcaption { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; font-weight: 600; margin: 0 4px 24px; }
  figcaption small, .legend { font: 11px var(--sans); color: var(--muted); }
  figcaption small { margin-left: 12px; }
  .chart a circle { stroke-width: 2; }
  .chart a:hover circle, .chart a:focus-visible circle { stroke: var(--accent); stroke-width: 5; }
  .history-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  h2 { font-size: 16px; font-weight: 600; margin: 0; }
  h2 span { font: 12px var(--mono); color: var(--muted); margin-left: 8px; }
  .filters { display: flex; flex-wrap: wrap; gap: 4px; }
  [hidden] { display: none !important; }
  button { font: 12px var(--sans); color: var(--muted); border: 1px solid transparent; background: transparent; border-radius: 4px; padding: 8px 12px; cursor: pointer; min-height: 40px; }
  button[aria-pressed="true"] { color: var(--fg); background: var(--panel); border-color: var(--line); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .l-head, .run { grid-template-columns: 2rem 5rem 6rem 7rem minmax(0, 1fr) 5rem; column-gap: 16px; }
  .l-head { font-weight: 400; letter-spacing: .04em; }
  .l-head span:nth-child(2), .l-head span:nth-child(5) { font-family: var(--sans); letter-spacing: normal; }
  .run { padding-block: 20px; scroll-margin-top: 24px; }
  .run:target { background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: 6px; }
  .r-no { font: 12px var(--mono); }
  .r-metric { font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; white-space: normal; overflow-wrap: anywhere; }
  .r-delta { text-align: right; }
  .d { font-size: 12px; }
  .r-desc { font-size: 14px; line-height: 1.7; }
  .r-commit { color: var(--muted); font-size: 11px; }
  .r-commit code { background: none; padding: 0; }
  @media (max-width: 760px) {
    .result { grid-template-columns: auto 28px auto; gap: 16px; }
    .fig.delta { grid-column: 1 / -1; justify-self: start; margin-top: 12px; }
    .fig.delta .n { font-size: 56px; }
    .arr { width: 28px; }
    .history-title { align-items: start; flex-direction: column; gap: 12px; }
    .chart { padding: 16px 8px 8px; }
    figcaption { flex-direction: column; gap: 8px; margin-bottom: 12px; }
    figcaption small { display: block; margin: 6px 0 0; }
    .run { grid-template-columns: 24px 1fr 1fr; grid-template-areas: "no stamp commit" "desc desc desc" "metric metric delta"; gap: 10px; padding-block: 20px; }
    .r-desc { color: var(--fg); font-size: 14px; }
    .r-metric { justify-self: start; text-align: left; }
    .r-metric .u { display: inline; }
    .r-commit { justify-self: end; }
    .meta { font-family: var(--sans); }
  }
  @media print { .filters { display: none; } .run[hidden] { display: grid !important; } .chart { break-inside: avoid; } }

</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <h1>${escapeHtml(name)}</h1><p class="metric-context">${escapeHtml(current?.metricName ?? "metric")}${current?.metricUnit ? ` / ${escapeHtml(current.metricUnit)}` : ""}<span>${direction === "higher" ? "越高越好" : "越低越好"}</span></p>${heroMetrics}
  </header>
${body}
  <footer class="footer">${footer}
  </footer>
</div>${
    live
      ? `<script>
(function () {
  // Preserve the scroll position across the auto-reload so an update never
  // kicks the viewer (who is usually reading the history ledger) back to top.
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
<script>
(function () {
  var filters = document.querySelector('.filters');
  if (!filters) return;
  filters.hidden = false;
  function apply(key) {
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === key)); });
    document.querySelectorAll('.run').forEach(function (r) { r.hidden = key !== 'all' && r.dataset.status !== key; });
  }
  filters.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (b) apply(b.dataset.filter);
  });
  document.querySelectorAll('.chart a').forEach(function (a) {
    a.addEventListener('click', function () { apply('all'); });
  });
})();
</script>
</body>
</html>`;
}
