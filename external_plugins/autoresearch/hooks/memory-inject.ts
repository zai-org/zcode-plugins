#!/usr/bin/env node
// UserPromptSubmit hook: inject an aggregated session-memory summary so the
// loop survives compaction and long sessions — progress, deduplicated tried
// directions, best trajectory, recent runs with ASI, and a doom-loop warning.
import {
  rebuildState,
  readSessionConfig,
  plateauCalibration,
} from "../mcp/lib/ledger.ts";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";
import {
  directionLabel,
  detectDoomLoop,
  normalizeHypothesis,
  hypothesesSimilar,
} from "../mcp/lib/experiment.ts";
import type { SessionState } from "../mcp/lib/types.ts";

const projectCwd = process.argv[2] || process.cwd();
let cwd: string;
try {
  cwd = resolveWorkCwd(projectCwd);
} catch (err) {
  // Invalid workingDir: fail open with a diagnostic (hook discipline), the
  // MCP server surfaces the same misconfiguration as a hard error.
  process.stderr.write(
    `[autoresearch] ${err instanceof Error ? err.message : String(err)}\n`,
  );
  cwd = projectCwd;
}

function pass(): never {
  process.exit(0);
}

let state: SessionState | undefined;
try {
  const cfg = readSessionConfig(projectCwd);
  if (cfg.autoresearchOff === true) pass();
  const max = Number(cfg.maxIterations);
  const calib = plateauCalibration(projectCwd);
  state = rebuildState(cwd, {
    maxIterations: Number.isFinite(max) && max > 0 ? max : 20,
    deterministic: calib.deterministic,
  });
} catch {
  pass();
}
if (!state || !state.config || state.runs.length === 0) pass();

const cfg = state.config;
const lines: string[] = [];

// Progress line
lines.push(
  `[autoresearch 记忆] segment ${state.segment}（metric=${cfg.metricName}，direction=${cfg.direction ?? "lower"}）` +
    `已跑 ${state.runs.length}/${state.maxIterations ?? 20} 次，baseline=${state.baseline ?? "—"}，best=${state.best ?? "—"}。`,
);

// Deduplicated tried directions (similarity-based; for each direction the
// first-seen label is kept — later paraphrases collapse into it)
const tried: string[] = [];
const triedNorm: string[] = [];
for (const r of state.runs) {
  const label = directionLabel(r);
  const n = normalizeHypothesis(label) ?? label;
  if (triedNorm.some((t) => hypothesesSimilar(t, n))) continue;
  triedNorm.push(n);
  tried.push(label);
}
const triedList = tried.slice(-8);
if (triedList.length > 0)
  lines.push(`已尝试方向：${triedList.join("、")}（避免重复尝试）。`);

// Best trajectory: baseline → improving keeps (≤6 steps). Labels reuse
// directionLabel's own 40-char cap — an inner 14-char slice would cut CJK
// conclusions mid-word ("spw 细扫 1" hiding "…单峰确认在 2.0").
const kept = state.runs.filter((r) => r.status === "keep" && r.metric != null);
const steps = kept.filter((r) => r.metric !== state.baseline).slice(-6);
if (steps.length > 0) {
  const traj = steps.map((r) => `${r.metric}(${directionLabel(r)})`);
  lines.push(`best 轨迹：${state.baseline ?? "—"} → ${traj.join(" → ")}。`);
}

// Discard reasons (design D5): why each rejected direction was dropped, so a
// later result can be checked against them even outside the 3-run recent
// window. Same window as the tried-directions list, one line, reasons
// truncated at 120 chars — enough for a full conclusion ("spw 1.5/2.5 细扫
// 单峰确认在 2.0"), still bounded (8 × 120) to keep the injection slim.
const discardItems: string[] = [];
for (const r of state.runs) {
  if (r.status !== "discard" && r.status !== "checks_failed") continue;
  const raw = r.asi?.rollback;
  if (typeof raw !== "string" || raw.trim() === "") continue;
  const reason = raw.trim();
  const truncated = reason.length > 120 ? reason.slice(0, 120) + "…" : reason;
  discardItems.push(`#${r.run} ${truncated}`);
}
const discardList = discardItems.slice(-8);
if (discardList.length > 0)
  lines.push(`弃用方向与理由：${discardList.join("；")}。`);

// Recent runs with ASI extraction
const recent = state.runs
  .slice(-3)
  .map((r) => {
    let line = `#${r.run} ${r.status} metric=${r.metric ?? "—"} ${r.description ?? ""}`;
    if (r.asi && typeof r.asi === "object") {
      const parts: string[] = [];
      if (r.asi.hypothesis) parts.push(`hyp: ${r.asi.hypothesis}`);
      if (r.asi.next_action_hint) parts.push(`next: ${r.asi.next_action_hint}`);
      if (r.asi.rollback) parts.push(`rollback: ${r.asi.rollback}`);
      if (parts.length) line += "\n    " + parts.join("\n    ");
    }
    return line;
  })
  .join("\n");
lines.push(`最近记录：\n${recent}`);

// Doom-loop warning
const doom = detectDoomLoop(state.runs);
if (doom) {
  lines.push(
    doom.pattern === "oscillate"
      ? "⚠️ 检测到 A→B→A→B 震荡尝试：请停止在两个方向上反复，换一个结构性不同的方向。"
      : "⚠️ 检测到连续重复尝试：请停止重复同一假设，换一个结构性不同的方向。",
  );
}

// Continuation guidance must agree with the loop's own terminal states: at
// the cap the server refuses run_experiment (and the Stop hook stands down),
// so a continuation nudge here would push a run that cannot happen — worst
// right after a compaction, when this inject is the agent's main anchor.
const capReached =
  state.maxIterations != null && state.runs.length >= state.maxIterations;
if (capReached) {
  lines.push(
    `迭代上限已到（${state.runs.length}/${state.maxIterations}）：本 segment 请收官总结，勿继续 run_experiment；续优用 init_experiment 开新 segment，暂停用 /autoresearch:off。`,
  );
} else {
  lines.push(
    "如果你在运行 autoresearch 循环，请基于上述进度选择下一个假设并继续 run_experiment → log_experiment。",
  );
}

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: lines.join("\n"),
    },
  }),
);
