// Archive dashboard renderer: pure function from full ledger history to
// self-contained HTML (Modern AI Research Console style; static and live
// share renderBody). Single design-token layer: deep-navy dark-first base,
// warm-white light override, lava red as the only loud accent.
import { escapeHtml } from "./html.ts";
import type { SessionHistory } from "./ledger.ts";
import type { LedgerRun } from "./types.ts";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  keep: { label: "保留", cls: "keep" },
  discard: { label: "回退", cls: "discard" },
  crash: { label: "崩溃", cls: "crash" },
  checks_failed: { label: "门禁", cls: "crash" },
  noop: { label: "无改动", cls: "noop" },
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

/** Δ text vs the global baseline; 0 renders neutral (no ▲/▼ mismatch). */
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

/**
 * Inline-SVG metric trajectory across the whole ledger: valid metric points in
 * global order. Visual hierarchy (borrowed from ml-auto's trajectory, rebuilt
 * zero-dep): the connecting line is quiet secondary ink, keep points are
 * larger and filled, non-keep points are smaller hollow rings. X axis is a
 * sparse integer scale of the global run number (no per-point ordinal text —
 * the ordinal lives in the tooltip and native <title>); multi-segment
 * histories get a dotted boundary line + label at each segment edge. Fewer
 * than 2 points → "". Zero external resources — the dashboard must stay
 * self-contained.
 */
function renderTrendSvg(
  history: SessionHistory,
  variant: "desktop" | "mobile",
): string {
  const direction = history.config?.direction ?? "lower";
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
          padL: 36,
          padR: 14,
          padT: 20,
          padB: 28,
          keepR: 4.2,
          otherR: 3.1,
          lineW: 1.6,
          tickFont: 9,
          axisFont: 9,
          svgCls: "chart-m",
        }
      : {
          W: 960,
          H: 240,
          padL: 52,
          padR: 20,
          padT: 20,
          padB: 30,
          keepR: 5.5,
          otherR: 3.8,
          lineW: 1.5,
          tickFont: 10,
          axisFont: 10,
          svgCls: "chart-d",
        };
  const {
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    keepR,
    otherR,
    lineW,
    tickFont,
    axisFont,
    svgCls,
  } = dims;
  const total = history.totalRuns;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const vals = pts.map((p) => p.run.metric as number);
  let lo = Math.min(...vals, history.firstMetric ?? Infinity);
  let hi = Math.max(...vals, history.firstMetric ?? -Infinity);
  if (hi === lo) {
    lo -= 1; // degenerate flat line → pad it so points sit mid-chart
    hi += 1;
  }
  const span = hi - lo;
  const x = (n: number) => padL + ((n - 1) * plotW) / Math.max(1, total - 1);
  const y = (v: number) => padT + ((hi - v) * plotH) / span;
  // Sparse integer x ticks: smallest step from {1,2,5}×10^k with ≤8 labels.
  let xStep = total;
  outer: for (let k = 1; k <= total * 10; k *= 10) {
    for (const m of [1, 2, 5]) {
      if (total / (m * k) <= 8) {
        xStep = m * k;
        break outer;
      }
    }
  }
  const xTicks: string[] = [];
  for (let n = xStep; n <= total; n += xStep) {
    xTicks.push(
      `<text class="xt" x="${x(n).toFixed(1)}" y="${H - padB + 14}" text-anchor="middle" font-size="${tickFont}">${n}</text>`,
    );
  }
  // Light horizontal grid ticks at "nice" values covering [lo, hi].
  const ticks = niceTicks(lo, hi)
    .map(({ value: v, decimals }) => {
      const yy = y(v);
      return (
        `<line class="gl" x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}"/>` +
        `<text x="${padL - 8}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="${tickFont}">${v.toFixed(decimals)}</text>`
      );
    })
    .join("");
  // Segment boundary markers: a dotted vertical at each segment edge plus a
  // small label, only when the runs actually span multiple segments.
  const segMarks: string[] = [];
  if (history.segmentCount > 1) {
    const halfGap = total > 1 ? plotW / (total - 1) / 2 : 0;
    let prevSeg = pts[0].run.segment;
    for (const p of pts) {
      if (p.run.segment !== prevSeg) {
        prevSeg = p.run.segment;
        const bx = (x(p.ordinal) - halfGap).toFixed(1);
        segMarks.push(
          `<line class="seg-line" x1="${bx}" y1="${padT}" x2="${bx}" y2="${H - padB}"/>` +
            `<text class="seg-t" x="${(Number(bx) + 4).toFixed(1)}" y="${padT - 6}" font-size="${tickFont}">分段 ${p.run.segment}</text>`,
        );
      }
    }
  }
  const baseLine =
    history.firstMetric != null &&
    Number.isFinite(history.firstMetric) &&
    history.firstMetric >= lo &&
    history.firstMetric <= hi
      ? `<line class="base" x1="${padL}" y1="${y(history.firstMetric).toFixed(1)}" x2="${W - padR}" y2="${y(history.firstMetric).toFixed(1)}"/>` +
        `<text class="base-t" x="${W - padR}" y="${(y(history.firstMetric) - 6).toFixed(1)}" text-anchor="end" font-size="${tickFont}">baseline ${escapeHtml(fmtMetric(history.firstMetric))}</text>`
      : "";
  const poly = pts.map(
    (p) => `${x(p.ordinal).toFixed(1)},${y(p.run.metric as number).toFixed(1)}`,
  );
  const dots = pts
    .map((p) => {
      const cls = p.run.status === "keep" ? "dk" : "dh"; // keep filled & larger; others hollow rings
      const badge =
        STATUS_BADGE[p.run.status] ??
        ({ label: escapeHtml(p.run.status), cls: "noop" } as const);
      const d = deltaFor(p.run.metric, history.firstMetric, direction);
      const deltaText = d ? d.text.replace(/^[▲▼]\s*/, "") : "—";
      const desc = (p.run.description ?? "").slice(0, TOOLTIP_DESC);
      return `<a class="pt" href="#run-${p.ordinal}" data-run="${p.ordinal}" data-metric="${escapeHtml(fmtMetric(p.run.metric))}" data-delta="${escapeHtml(deltaText)}" data-dcls="${d ? d.cls : "neut"}" data-status="${badge.label}" data-desc="${escapeHtml(desc)}" aria-label="实验 ${p.ordinal}: ${escapeHtml(p.run.description ?? "")}，${escapeHtml(fmtMetric(p.run.metric))}"><title>#${p.ordinal} · ${escapeHtml(fmtMetric(p.run.metric))} · ${badge.label}</title><circle class="${cls}" cx="${x(p.ordinal).toFixed(1)}" cy="${y(p.run.metric as number).toFixed(1)}" r="${p.run.status === "keep" ? keepR : otherR}"/></a>`;
    })
    .join("");
  return `<svg class="${svgCls}" viewBox="0 0 ${W} ${H}" role="group" aria-label="指标轨迹 (${variant})">
${ticks}
${segMarks.join("\n")}
${baseLine}
<polyline class="ln" points="${poly.join(" ")}" stroke-width="${lineW}"/>
${xTicks.join("\n")}
<text class="axis-t" x="${(padL + plotW / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="${axisFont}">全局轮次</text>
${dots}
</svg>`;
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

const TOOLTIP_DESC = 80;

// Restrained inline icons (Lucide-style path data, hand-inlined — zero deps).
function icon(paths: string): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const ICON_ACTIVITY = icon(`<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`);
const ICON_FILTER = icon(
  `<path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/>`,
);

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
    green: "通过",
    yellow: "偏弱",
    red: "未过",
  };
  const conf = history.confidence;
  // Result-first hero metrics: the baseline→best story as the centerpiece,
  // KPI cards for process counts, confidence verdict in a quiet meta line.
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

  // KPI cards: compact counters, never marketing-sized. NO-OP is not reverted.
  const noop = history.runs.filter((r) => r.status === "noop").length;
  const reverted = history.totalRuns - history.kept - noop;
  const kpi = (n: number, label: string, cls: string) =>
    `<div class="kpi ${cls}"><div class="kpi-n">${n}</div><div class="kpi-l">${label}</div></div>`;
  const kpis =
    history.totalRuns === 0
      ? ""
      : `<div class="kpis" aria-label="实验计数">
  ${kpi(history.totalRuns, "实验总数", "")}
  ${kpi(history.kept, "保留", "k-keep")}
  ${kpi(reverted, "回退", "k-rev")}
  ${kpi(noop, "无改动", "k-noop")}
</div>`;

  // Quiet meta line: confidence verdict + segment + last update (no fabricated
  // "running status" — the renderer only knows what the ledger records).
  const metaParts: string[] = [];
  if (conf) {
    const verdict = CONF_VERDICT[conf.level] ?? escapeHtml(conf.level);
    metaParts.push(
      `<span class="conf-${conf.level}">${verdict}</span> ${conf.confidence.toFixed(2)}× 噪声`,
    );
  }
  if (current) metaParts.push(`分段 ${current.segment}`);
  const lastRunAt =
    typeof history.lastRunAt === "string" ? history.lastRunAt : null;
  if (lastRunAt) metaParts.push(`更新于 ${escapeHtml(lastRunAt.slice(0, 10))}`);
  const meta = metaParts.join(`<span class="dot"> · </span>`);
  const heroMetrics =
    history.totalRuns === 0
      ? ""
      : `
  ${result}
  ${kpis}
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
    const descRaw = r.description ?? "";
    const descText = escapeHtml(descRaw);
    // The round's change (description) is the one long value: full text in
    // the DOM; JS clamps it to one line with a right fade and expands on
    // click. Without JS everything stays readable.
    const revisitsHtml =
      revisitsN != null
        ? `<div class="clamp-line revisit-line"><span class="clamp-v revisits">↻ Revisiting #${revisitsN}</span></div>`
        : "";
    rows.push(`<div class="run" id="run-${i + 1}" data-status="${r.status === "keep" ? "keep" : r.status === "noop" ? "noop" : "reverted"}" tabindex="-1">
  <div class="r-no">${i + 1}</div>
  <div class="r-stamp ${badge.cls}">${badge.label}</div>
  <div class="r-metric">${fmtMetric(r.metric)}${r.metric != null && current?.metricUnit ? `<span class="u">${escapeHtml(current.metricUnit)}</span>` : ""}</div>
  <div class="r-delta">${d ? `<span class="d ${d.cls}">${d.text}</span>` : `<span class="d neut">—</span>`}</div>
  <div class="r-desc"><div class="clamp-line"><span class="clamp-v">${descText}</span></div>${revisitsHtml}</div>
  <div class="r-commit">${r.commit ? `<code>${escapeHtml(r.commit)}</code>` : ""}</div>
</div>`);
  });

  const lastDate = lastRunAt ? escapeHtml(lastRunAt.slice(0, 10)) : null;
  const footer = `
  <span>autoresearch${lastDate ? ` · ${lastDate}` : ""}</span><span>${history.totalRuns} 次实验${pin ? ` · 锚定 ${escapeHtml(pin)}` : ""}</span>`;

  const validCount = history.runs.filter(
    (r) => r.metric != null && Number.isFinite(r.metric),
  ).length;
  const trend =
    renderTrendSvg(history, "desktop") + renderTrendSvg(history, "mobile");
  // First-run → best raw difference in metric units, direction-colored.
  let firstToBest: { text: string; cls: string } | null = null;
  if (
    history.firstMetric != null &&
    Number.isFinite(history.firstMetric) &&
    history.bestMetric != null &&
    Number.isFinite(history.bestMetric)
  ) {
    const raw = history.bestMetric - history.firstMetric;
    if (Math.abs(raw) < 1e-9) firstToBest = { text: "±0", cls: "neut" };
    else
      firstToBest = {
        text: `${raw > 0 ? "+" : "−"}${fmtMetric(Math.abs(raw))}`,
        cls: (direction === "higher" ? raw > 0 : raw < 0) ? "up" : "down",
      };
  }
  const unit = current?.metricUnit ? ` ${escapeHtml(current.metricUnit)}` : "";
  const tStats =
    trend && history.totalRuns > 0
      ? `<div class="t-stats"><span>分段数 <b>${history.segmentCount}</b></span><span>轮次数 <b>${validCount}</b></span><span>保留数 <b>${history.kept}</b></span>${firstToBest ? `<span>首轮→最优 <b class="${firstToBest.cls}">${firstToBest.text}${unit}</b></span>` : ""}</div>`
      : "";
  const body =
    history.totalRuns === 0
      ? `<p class="empty">暂无实验记录。</p>`
      : `${trend ? `<figure class="chart"><figcaption><span class="cap-t">${ICON_ACTIVITY}度量趋势 <small>全局轨迹 · ${escapeHtml(current?.metricName ?? "metric")}</small></span><span class="legend"><i class="lg-line"></i>轨迹连线<i class="lg-keep"></i>保留<i class="lg-open"></i>未保留</span></figcaption><p class="chart-note">实心为保留 · 空心为未保留 · 虚线为分段边界 · 悬停查看详情</p>${trend}${tStats}<div class="tip" id="chart-tip" hidden></div></figure>` : ""}
<section class="history"><div class="history-title"><h2>${ICON_FILTER}实验记录 <span>${history.totalRuns}</span></h2><div class="filters" hidden aria-label="筛选实验">${[
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
<div class="l-head"><span>#</span><span>状态</span><span>指标</span><span>Δ 相对基线</span><span>该轮改动</span><span>提交</span></div>
${rows.join("\n")}
</div></section>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>autoresearch: ${escapeHtml(name)}</title>
<style>
  /* Single design-token layer. Dark-first: deep navy console is the default
     token set; the light override re-maps the same tokens to warm white. */
  :root {
    color-scheme: dark;
    --bg: #0b1220; --panel: #101a2c; --panel-2: #0d1524;
    --fg: #e7ecf5; --muted: #8da0b8;
    --line: rgba(148, 163, 184, .16); --line-strong: rgba(148, 163, 184, .30);
    --accent: #ff5140; --accent-soft: rgba(255, 81, 64, .12);
    --keep: #3ecf8e; --keep-soft: rgba(62, 207, 142, .13);
    --discard: #e6a23c; --discard-soft: rgba(230, 162, 60, .14);
    --crash: #ff6b5e; --crash-soft: rgba(255, 107, 94, .14);
    --neut: #8da0b8; --neut-soft: rgba(141, 160, 184, .14);
    --sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "JetBrains Mono", monospace;
    --r-s: 6px; --r-m: 10px; --r-l: 14px;
    --shadow-1: 0 1px 2px rgba(2, 6, 16, .4);
    --shadow-2: 0 12px 32px rgba(2, 6, 16, .45);
  }
  @media (prefers-color-scheme: light) {
    :root {
      color-scheme: light;
      --bg: #f6f4ef; --panel: #fffef9; --panel-2: #f3f1ea;
      --fg: #22293a; --muted: #6a7383;
      --line: rgba(34, 41, 58, .13); --line-strong: rgba(34, 41, 58, .24);
      --accent: #d93a2b; --accent-soft: rgba(217, 58, 43, .10);
      --keep: #1f8f56; --keep-soft: rgba(31, 143, 86, .11);
      --discard: #b47616; --discard-soft: rgba(180, 118, 22, .13);
      --crash: #c73a30; --crash-soft: rgba(199, 58, 48, .11);
      --neut: #6a7383; --neut-soft: rgba(106, 115, 131, .13);
      --shadow-1: 0 1px 2px rgba(34, 41, 58, .08);
      --shadow-2: 0 12px 32px rgba(34, 41, 58, .10);
    }
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--sans); background: var(--bg); color: var(--fg);
    margin: 0; line-height: 1.6; -webkit-font-smoothing: antialiased;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 5px; border: 2px solid var(--bg); }
  ::-webkit-scrollbar-track { background: transparent; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 clamp(16px, 4vw, 40px); }

  /* Hero: title opens directly (no eyebrow), result-first composition. */
  .hero { padding: 40px 0 24px; border-bottom: 1px solid var(--line); }
  h1 { font-weight: 650; font-size: clamp(1.6rem, 1.1rem + 1.8vw, 2.4rem); line-height: 1.15; letter-spacing: -.02em; margin: 0 0 10px; overflow-wrap: anywhere; }
  .metric-context { color: var(--muted); font: 12.5px var(--mono); margin: 0 0 24px; overflow-wrap: anywhere; }
  .dir-chip { display: inline-block; font: 500 11px var(--sans); color: var(--fg); border: 1px solid var(--line-strong); border-radius: 999px; padding: 2px 9px; margin-left: 10px; vertical-align: baseline; }
  .result { display: flex; align-items: baseline; gap: 28px; flex-wrap: wrap; margin: 0 0 24px; }
  .fig .n { font-size: clamp(26px, 1.2rem + 1.6vw, 40px); font-weight: 600; letter-spacing: -.03em; line-height: 1.05; font-variant-numeric: tabular-nums; }
  .fig.delta.up .n { color: var(--accent); }
  .fig.delta.down .n { color: var(--crash); }
  .fig .l { margin-top: 6px; font: 10.5px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .arr { position: relative; width: 44px; height: 2px; background: var(--muted); align-self: center; }
  .arr::after { content: ""; position: absolute; right: 0; top: -4px; border-left: 8px solid var(--muted); border-top: 4px solid transparent; border-bottom: 4px solid transparent; }

  /* KPI cards: compact counters with status-tinted numbers. */
  .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 16px; max-width: 640px; }
  .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-m); padding: 12px 14px; box-shadow: var(--shadow-1); }
  .kpi-n { font-size: 22px; font-weight: 600; line-height: 1.1; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .kpi-l { margin-top: 4px; font: 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .kpi.k-keep .kpi-n { color: var(--keep); }
  .kpi.k-rev .kpi-n { color: var(--discard); }
  .kpi.k-noop .kpi-n { color: var(--neut); }
  .meta { font: 12px var(--mono); color: var(--muted); margin: 0; }
  .meta .dot { opacity: .5; }
  .conf-green { color: var(--keep); font-weight: 600; }
  .conf-yellow { color: var(--discard); font-weight: 600; }
  .conf-red { color: var(--crash); font-weight: 600; }

  /* Trend chart card. */
  .chart { margin: 28px 0 32px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-l); padding: 18px 18px 10px; box-shadow: var(--shadow-1); position: relative; }
  .chart svg { width: 100%; height: auto; }
  .chart-d { display: block; }
  .chart .gl { stroke: var(--line); }
  .chart text { fill: var(--muted); font-family: var(--mono); }
  .chart .base { stroke: var(--muted); stroke-dasharray: 6 5; opacity: .7; }
  .chart a { cursor: pointer; }
  .chart a circle { stroke-width: 2; transition: stroke-width .12s; }
  .chart a:hover circle, .chart a:focus-visible circle { stroke: var(--accent); stroke-width: 3.5; }
  figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; font-size: 13px; font-weight: 600; margin: 0 4px 4px; }
  .cap-t { display: inline-flex; align-items: center; gap: 8px; }
  figcaption .ic, h2 .ic { width: 15px; height: 15px; color: var(--muted); flex: none; }
  figcaption small, .legend { font: 11px var(--sans); font-weight: 400; color: var(--muted); }
  figcaption small { margin-left: 12px; }
  /* named legend with drawn swatches (line / filled keep / hollow ring) */
  .legend { display: inline-flex; align-items: center; gap: 14px; }
  .legend i { display: inline-block; vertical-align: middle; margin-right: 5px; }
  .lg-line { width: 16px; border-top: 2px solid var(--muted); }
  .lg-keep { width: 9px; height: 9px; border-radius: 50%; background: var(--keep); }
  .lg-open { width: 8px; height: 8px; border-radius: 50%; background: var(--panel); border: 1.4px solid var(--crash); }
  .chart-note { font: 11px var(--sans); color: var(--muted); margin: 0 4px 10px; }
  /* trajectory hierarchy: quiet connector line, emphasized keep markers */
  .chart .ln { fill: none; stroke: var(--muted); }
  .chart .dk { fill: var(--keep); stroke: var(--panel); stroke-width: 1.5; }
  .chart .dh { fill: var(--panel); stroke: var(--crash); stroke-width: 1.4; }
  .chart .seg-line { stroke: var(--line-strong); stroke-dasharray: 3 4; }
  .chart .axis-t { fill: var(--muted); font-family: var(--mono); }
  /* summary strip directly under the chart */
  .t-stats { display: flex; flex-wrap: wrap; gap: 4px 22px; border-top: 1px solid var(--line); margin: 10px 4px 2px; padding-top: 10px; font: 11.5px var(--sans); color: var(--muted); }
  .t-stats b { font: 600 12.5px var(--mono); font-variant-numeric: tabular-nums; color: var(--fg); margin-left: 5px; }
  .t-stats b.up { color: var(--keep); }
  .t-stats b.down { color: var(--crash); }
  .t-stats b.neut { color: var(--muted); }
  /* Page-level chart tooltip: filled from the hovered anchor's data
     attributes (real ledger values) via textContent — never innerHTML. */
  .tip { position: fixed; z-index: 10; max-width: 320px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: var(--r-m); box-shadow: var(--shadow-2); padding: 10px 12px; font: 12px/1.5 var(--sans); pointer-events: none; }
  .tip .t-run { font: 600 10.5px var(--mono); letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
  .tip .t-metric { font: 600 15px var(--mono); font-variant-numeric: tabular-nums; margin-top: 2px; }
  .tip .t-delta { font: 12px var(--mono); font-variant-numeric: tabular-nums; }
  .tip .t-delta.up { color: var(--keep); }
  .tip .t-delta.down { color: var(--crash); }
  .tip .t-delta.neut { color: var(--neut); }
  .tip .t-desc { color: var(--muted); margin-top: 4px; overflow-wrap: anywhere; }
  /* two chart variants rendered; CSS picks per viewport (mobile is 1:1 scale) */
  .chart-m { display: none; }

  /* History: card-framed ledger table. */
  .history-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
  h2 { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; margin: 0; }
  h2 span { font: 12px var(--mono); color: var(--muted); margin-left: 2px; }
  .filters { display: flex; flex-wrap: wrap; gap: 4px; }
  [hidden] { display: none !important; }
  button { font: 12.5px var(--sans); color: var(--muted); border: 1px solid transparent; background: transparent; border-radius: var(--r-s); padding: 7px 12px; cursor: pointer; min-height: 36px; transition: color .12s, background .12s, border-color .12s; }
  button:hover { color: var(--fg); }
  button[aria-pressed="true"] { color: var(--fg); background: var(--panel); border-color: var(--line-strong); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .ledger { border: 1px solid var(--line); border-radius: var(--r-l); background: var(--panel); box-shadow: var(--shadow-1); overflow: hidden; }
  .l-head, .run {
    display: grid; grid-template-columns: 2.4rem 6rem 7rem 7.5rem minmax(0, 1fr) 6.5rem;
    column-gap: 14px; align-items: baseline; padding: 12px 16px;
  }
  .l-head { font: 500 10.5px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); background: var(--panel-2); border-bottom: 1px solid var(--line); }
  .run { border-bottom: 1px solid var(--line); transition: background .12s; scroll-margin-top: 24px; }
  .run:last-child { border-bottom: 0; }
  .run:hover { background: var(--panel-2); }
  .run:target { background: var(--accent-soft); outline: 1px solid var(--accent); outline-offset: -1px; }
  .r-no { font: 500 12px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
  .r-stamp { font: 600 10px/1 var(--mono); letter-spacing: .08em; padding: 4px 8px; border-radius: 999px; justify-self: start; }
  .r-stamp.keep { color: var(--keep); background: var(--keep-soft); }
  .r-stamp.discard { color: var(--discard); background: var(--discard-soft); }
  .r-stamp.crash { color: var(--crash); background: var(--crash-soft); }
  .r-stamp.noop { color: var(--neut); background: var(--neut-soft); }
  .r-metric { font: 500 13px var(--mono); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .r-metric .u { font-size: 10.5px; color: var(--muted); margin-left: .3em; }
  .r-delta { text-align: right; }
  .d { font: 12px var(--mono); font-variant-numeric: tabular-nums; }
  .d.up { color: var(--keep); }
  .d.down { color: var(--crash); }
  .d.neut { color: var(--neut); }
  .r-desc { font-size: 13.5px; min-width: 0; overflow-wrap: anywhere; }
  /* One clamp language for every long value: full text in the DOM; JS clamps
     overflowing items to exactly one line with a right fade and expands on
     click. Without JS nothing is hidden. */
  .clamp-line { display: flex; gap: 7px; align-items: baseline; margin: 2px 0; min-width: 0; line-height: 1.55; }
  .clamp-v { min-width: 0; flex: 1; white-space: normal; overflow-wrap: anywhere; }
  .clamp-line.js-clamp .clamp-v { white-space: nowrap; overflow: hidden; overflow-wrap: normal; -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 56px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 56px), transparent); }
  .clamp-line.js-more { cursor: pointer; }
  .clamp-line.js-open .clamp-v { white-space: normal; overflow: visible; -webkit-mask-image: none; mask-image: none; }
  .revisit-line { font: 11px var(--mono); }
  .revisits { color: var(--muted); }
  .r-commit { font: 11px var(--mono); text-align: right; color: var(--muted); }
  .r-commit code { background: var(--neut-soft); border: 1px solid var(--line); padding: 2px 7px; border-radius: 6px; overflow-wrap: anywhere; }
  .empty { color: var(--muted); padding: 2.5rem 0 3rem; }

  .footer { margin-top: 40px; padding: 20px 0 40px; border-top: 1px solid var(--line); font: 11.5px var(--mono); color: var(--muted); display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; overflow-wrap: anywhere; }

  @media (max-width: 760px) {
    .wrap { padding: 0 16px; }
    .hero { padding: 28px 0 20px; }
    h1 { font-size: 1.5rem; }
    .metric-context { margin-bottom: 18px; }
    .result { gap: 18px; }
    .fig .n { font-size: 24px; }
    .fig.delta .n { font-size: 30px; }
    .arr { width: 30px; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); max-width: none; }
    .kpi { padding: 10px 12px; }
    .kpi-n { font-size: 19px; }
    .chart { margin: 20px 0 24px; padding: 12px 10px 8px; border-radius: var(--r-m); }
    .chart-d { display: none; }
    .chart-m { display: block; }
    figcaption { flex-direction: column; gap: 6px; margin-bottom: 10px; align-items: flex-start; }
    figcaption small { display: block; margin: 4px 0 0; }
    .history-title { flex-direction: column; align-items: flex-start; gap: 10px; }
    .l-head { display: none; }
    /* ledger row: one dense line (# · badge · metric · Δ · commit), details below */
    .run {
      grid-template-columns: auto auto 1fr auto auto;
      grid-template-areas:
        "no stamp metric delta commit"
        "desc desc desc desc desc";
      column-gap: 10px; row-gap: 6px; padding: 12px 14px;
    }
    .r-no { grid-area: no; }
    .r-stamp { grid-area: stamp; font-size: 9px; padding: 3px 6px; }
    .r-metric { grid-area: metric; justify-self: end; font-size: 12px; }
    .r-metric .u { display: inline; }
    .r-delta { grid-area: delta; }
    .r-commit { grid-area: commit; }
    .r-commit code { background: none; border: 0; padding: 0; font-size: 10px; }
    .r-desc { grid-area: desc; font-size: 13px; }
    /* footer: date only on mobile — runs/pinned are desktop metadata */
    .footer { margin-top: 24px; padding: 14px 0 28px; }
    .footer span + span { display: none; }
  }
  @media print {
    .filters { display: none; }
    .run[hidden] { display: grid !important; }
    .chart { break-inside: avoid; }
    .tip { display: none !important; }
    /* clamped values must not lose their full text on paper */
    .clamp-v { white-space: normal !important; overflow: visible !important; -webkit-mask-image: none !important; mask-image: none !important; }
  }

</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <h1>${escapeHtml(name)}</h1><p class="metric-context">${escapeHtml(current?.metricName ?? "metric")}${current?.metricUnit ? ` / ${escapeHtml(current.metricUnit)}` : ""}<span class="dir-chip">${direction === "higher" ? "越高越好" : "越低越好"}</span></p>${heroMetrics}
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
  if (filters) {
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
  }
  // Chart tooltip: fill from the hovered anchor's data attributes (real
  // ledger values) using textContent only — ledger text is data, never markup.
  var tip = document.getElementById('chart-tip');
  var pts = document.querySelectorAll('.chart a.pt');
  if (!tip || !pts.length) return;
  function fill(a) {
    tip.textContent = '';
    var run = document.createElement('div');
    run.className = 't-run';
    run.textContent = '实验 #' + a.dataset.run + ' · ' + a.dataset.status;
    var m = document.createElement('div');
    m.className = 't-metric';
    m.textContent = a.dataset.metric;
    var d = document.createElement('div');
    d.className = 't-delta ' + (a.dataset.dcls || 'neut');
    d.textContent = 'Δ 相对基线: ' + (a.dataset.delta || '—');
    tip.appendChild(run); tip.appendChild(m); tip.appendChild(d);
    if (a.dataset.desc) {
      var t = document.createElement('div');
      t.className = 't-desc';
      t.textContent = a.dataset.desc;
      tip.appendChild(t);
    }
    tip.hidden = false;
  }
  function place(a) {
    var r = a.getBoundingClientRect();
    var left = Math.max(8, Math.min(window.innerWidth - tip.offsetWidth - 8, r.left));
    var top = r.bottom + 8;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = r.top - tip.offsetHeight - 8;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  function show(a) { fill(a); place(a); }
  function hide() { tip.hidden = true; }
  pts.forEach(function (a) {
    a.addEventListener('mouseenter', function () { show(a); });
    a.addEventListener('mouseleave', hide);
    a.addEventListener('focus', function () { show(a); });
    a.addEventListener('blur', hide);
  });
  // Clamp language for the round's change: an overflowing description
  // collapses to one faded line and expands on click/Enter. Only lines that
  // actually overflow get the gesture.
  document.querySelectorAll('.r-desc .clamp-line').forEach(function (line) {
    var v = line.querySelector('.clamp-v');
    if (!v) return;
    line.classList.add('js-clamp');
    line.setAttribute('tabindex', '0');
    function overflowed() { return v.scrollWidth > v.clientWidth + 1; }
    if (overflowed()) line.classList.add('js-more');
    function toggle() {
      var open = line.classList.toggle('js-open');
      line.classList.toggle('js-more', !open && overflowed());
    }
    line.addEventListener('click', toggle);
    line.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
})();
</script>
</body>
</html>`;
}
