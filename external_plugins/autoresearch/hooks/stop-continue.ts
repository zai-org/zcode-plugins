#!/usr/bin/env node
// Stop hook: keep the autoresearch loop running while it is not finished.
// zcode grants at most 3 consecutive Stop continuations per window, so this
// hook only fires when the ledger shows the loop should continue.
import {
  rebuildState,
  readSessionConfig,
  plateauCalibration,
} from "../mcp/lib/ledger.ts";
import { resolveWorkCwd } from "../mcp/lib/paths.ts";
import { isStopReached, detectDoomLoop } from "../mcp/lib/experiment.ts";
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

function failOpen(): never {
  process.exit(0);
}

let state: SessionState | undefined;
let calib: ReturnType<typeof plateauCalibration> = {
  minImprovement: undefined,
  window: undefined,
  deterministic: false,
};
// Whether the continuation window below runs on the built-in default (no
// maxIterations in .auto/config.json): manifest userConfig is invisible to
// hooks, so a server-side cap set that way can be tighter than this window —
// the block reason says so once, so the model can align instead of spinning.
let usedDefaultMax = true;
try {
  const cfg = readSessionConfig(projectCwd);
  if (cfg.autoresearchOff === true) failOpen();
  const max = Number(cfg.maxIterations);
  usedDefaultMax = !(Number.isFinite(max) && max > 0);
  const fails = Number(cfg.consecutiveFailures);
  calib = plateauCalibration(projectCwd);
  state = rebuildState(cwd, {
    maxIterations: Number.isFinite(max) && max > 0 ? max : 20,
    consecutiveFailures: Number.isFinite(fails) && fails > 0 ? fails : 3,
    plateauWindow: calib.window,
    plateauMinImprovement: calib.minImprovement,
    deterministic: calib.deterministic,
  });
} catch {
  failOpen();
}

// No active session → let the model finish normally.
// Everything below the config/rebuild try/catch is fail-open too: a broken
// ledger or an unexpected throw must degrade to "allow the stop" (exit 0),
// never to a crash exit code with a stack trace as the hook's only output.
try {
  if (!state || !state.config || state.runs.length === 0) failOpen();

  const finished = isStopReached(
    state.runs,
    state.maxIterations ?? 20,
    state.failureThreshold,
  );
  if (finished) failOpen();

  // Plateau convergence: recent runs improved below the calibrated threshold
  // (default 1% over 5 runs) → let the model wrap up. The Stop schema has no
  // allow-with-reason shape, so the advisory goes to stderr (hook log) while
  // the hook exits 0 to allow the stop.
  if (state.plateau) {
    const window = calib.window ?? 5;
    const min = calib.minImprovement ?? 0.01;
    const pct = `${(min * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    const suggestions = [
      // A deterministic benchmark cannot be confirmed by re-measurement.
      ...(calib.deterministic ? [] : ["用 run_experiment repeat:3 复测确认"]),
      "init_experiment 开启新 segment",
      "就此收尾总结",
    ].join("，或 ");
    process.stderr.write(
      `[autoresearch] 循环已进入平台期（最近 ${window} 轮改善 < ${pct}，best=${state.best ?? "—"}）。` +
        `建议：${suggestions}。\n`,
    );
    process.exit(0);
  } else {
    const dir = state.config?.direction ?? "lower";
    const tail = state.runs
      .slice(-3)
      .map((r) => {
        let line = `#${r.run} ${r.status} metric=${r.metric ?? "—"} ${r.description ?? ""}`;
        if (r.asi && typeof r.asi === "object") {
          const parts: string[] = [];
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
        ? `⚠️ 检测到重复/震荡尝试：请停止重复同一假设，换一个结构性不同的方向。\n`
        : "") +
      `请继续下一个假设：修改代码 → run_experiment → log_experiment（keep/discard）。\n` +
      (usedDefaultMax
        ? `（提示：本续跑窗口按缺省 ${state.maxIterations ?? 20} 次计算；清单 userConfig 与 AR_MAX_ITERATIONS 环境变量的 maxIterations 对 hook 不可见，若 server 侧窗口更小会在 run_experiment 处报「iteration cap reached」——需对齐时在 .auto/config.json 设置 maxIterations。）\n`
        : "") +
      `（若用户已要求无人值守续跑，可按 unattended 规程用 CronCreate 创建有界定时唤醒。）`;

    process.stdout.write(JSON.stringify({ decision: "block", reason }));
  }
} catch (err) {
  process.stderr.write(
    `[autoresearch] stop-continue 检查失败，放行本次停止: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  failOpen();
}
