#!/usr/bin/env node
// UserPromptSubmit hook: inject an aggregated session-memory summary so the
// loop survives compaction and long sessions — progress, deduplicated tried
// directions, best trajectory, recent runs with ASI, and a doom-loop warning.
import { rebuildState, readSessionConfig } from "../mcp/lib/ledger.ts";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";
import {
  directionLabel,
  detectDoomLoop,
  normalizeHypothesis,
  hypothesesSimilar,
} from "../mcp/lib/experiment.ts";
import type { SessionState } from "../mcp/lib/types.ts";

const projectCwd = process.argv[2] || process.cwd();
const cwd = resolveWorkCwd(projectCwd);

function pass(): never {
  process.exit(0);
}

let state: SessionState | undefined;
try {
  const cfg = readSessionConfig(projectCwd);
  const max = Number(cfg.maxIterations);
  state = rebuildState(cwd, {
    maxIterations: Number.isFinite(max) && max > 0 ? max : 20,
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

// Deduplicated tried directions (similarity-based, most recent label kept)
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

// Best trajectory: baseline → improving keeps (≤6 steps)
const kept = state.runs.filter((r) => r.status === "keep" && r.metric != null);
const steps = kept.filter((r) => r.metric !== state.baseline).slice(-6);
if (steps.length > 0) {
  const traj = steps.map(
    (r) => `${r.metric}(${directionLabel(r).slice(0, 14)})`,
  );
  lines.push(`best 轨迹：${state.baseline ?? "—"} → ${traj.join(" → ")}。`);
}

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

lines.push(
  "如果你在运行 autoresearch 循环，请基于上述进度选择下一个假设并继续 run_experiment → log_experiment。",
);

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: lines.join("\n"),
    },
  }),
);
