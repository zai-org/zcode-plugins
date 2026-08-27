#!/usr/bin/env node
// Stop hook: keep the autoresearch loop running while it is not finished.
// zcode grants at most 3 consecutive Stop continuations per window, so this
// hook only fires when the ledger shows the loop should continue.
import { rebuildState, readSessionConfig } from "../mcp/lib/ledger.mjs";
import { resolveWorkCwd } from "../mcp/lib/paths.mjs";
import { isStopReached, detectDoomLoop } from "../mcp/lib/experiment.mjs";

const projectCwd = process.argv[2] || process.cwd();
const cwd = resolveWorkCwd(projectCwd);

function failOpen() {
  process.exit(0);
}

let state;
try {
  const cfg = readSessionConfig(projectCwd);
  const max = Number(cfg.maxIterations);
  const fails = Number(cfg.consecutiveFailures);
  state = rebuildState(cwd, {
    maxIterations: Number.isFinite(max) && max > 0 ? max : 20,
    consecutiveFailures: Number.isFinite(fails) && fails > 0 ? fails : 3,
  });
} catch {
  failOpen();
}

// No active session → let the model finish normally.
if (!state.config || state.runs.length === 0) failOpen();

const finished = isStopReached(
  state.runs,
  state.maxIterations ?? 20,
  state.failureThreshold,
);
if (finished) failOpen();

// Plateau convergence: recent runs improved < 1% → let the model wrap up.
if (state.plateau) {
  const reason =
    `[autoresearch] 循环已进入平台期（最近 5 轮改善 < 1%，best=${state.best ?? "—"}）。` +
    `建议：用 run_experiment repeat:3 复测确认，或 init_experiment 开启新 segment，或就此收尾总结。`;
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
} else {
  const dir = state.config?.direction ?? "lower";
  const tail = state.runs
    .slice(-3)
    .map((r) => {
      let line = `#${r.run} ${r.status} metric=${r.metric ?? "—"} ${r.description ?? ""}`;
      if (r.asi && typeof r.asi === "object") {
        const parts = [];
        if (r.asi.hypothesis) parts.push(`hyp: ${r.asi.hypothesis}`);
        if (r.asi.next_action_hint)
          parts.push(`next: ${r.asi.next_action_hint}`);
        if (r.asi.rollback) parts.push(`rollback: ${r.asi.rollback}`);
        if (parts.length) line += "\n    " + parts.join("\n    ");
      }
      return line;
    })
    .join("\n");

  const reason =
    `[autoresearch] 实验循环未结束：segment ${state.segment} 已跑 ${state.runs.length}/${state.maxIterations ?? 20} 次，` +
    `direction=${dir}，baseline=${state.baseline ?? "—"}，best=${state.best ?? "—"}。` +
    `最近记录：\n${tail}\n` +
    (detectDoomLoop(state.runs)
      ? `⚠️ 检测到重复/震荡尝试——停止重复同一假设，换一个结构性不同的方向。\n`
      : "") +
    `请继续下一个假设：修改代码 → run_experiment → log_experiment（keep/discard）。`;

  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}
