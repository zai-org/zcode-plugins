// Regression tests for this plugin's hooks.
// Usage: node tests/run.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(script, payload) {
  const input = payload === undefined ? "" : `${JSON.stringify(payload)}\n`;
  const result = spawnSync(node, [join(root, "hooks", script)], { input, encoding: "utf8", timeout: 20000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parse(line) {
  return line.trim() ? JSON.parse(line) : null;
}

let failed = 0;
let passed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}
function skip(name, why) {
  console.log(`  skip ${name} (${why})`);
}

const sessionStart = (source = "startup") => ({ hook_event_name: "SessionStart", session_id: "sess_1", source });
const stop = (text, extra = {}) => ({
  hook_event_name: "Stop",
  session_id: "sess_1",
  permission_mode: "default",
  responseText: text,
  stop_hook_active: false,
  last_assistant_message: text,
  ...extra,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("SessionStart: math-rules.mjs");
{
  const out = parse(run("math-rules.mjs", sessionStart()).stdout);
  const context = out?.hookSpecificOutput?.additionalContext ?? "";
  check("answers with a SessionStart hookSpecificOutput", out?.hookSpecificOutput?.hookEventName === "SessionStart", JSON.stringify(out));
  check("is the only key on the top level", out && Object.keys(out).join() === "hookSpecificOutput", JSON.stringify(out));
  check("teaches double dollars for inline math", context.includes("$$P_{\\mathrm{total}}$$"), context);
  check(
    "teaches $$ on their own lines for display math",
    /Display math: a line containing only \$\$, then the formula, then a line containing only \$\$\./.test(context),
    context
  );
  check("forbids \\(...\\) and \\[...\\]", context.includes("\\(...\\)") && context.includes("\\[...\\]"), context);
  check("exits 0 with nothing on stderr", run("math-rules.mjs", sessionStart()).status === 0 && run("math-rules.mjs", sessionStart()).stderr === "");
  const empty = parse(run("math-rules.mjs").stdout);
  check("still answers when stdin is empty", empty?.hookSpecificOutput?.additionalContext === context, JSON.stringify(empty));
  const echoed = parse(run("math-rules.mjs", { hook_event_name: "SessionStart", source: "compact" }).stdout);
  check("echoes the event name of the payload", echoed?.hookSpecificOutput?.hookEventName === "SessionStart", JSON.stringify(echoed));
  check("keeps the rule under 2 KB", Buffer.byteLength(context) < 2048, String(Buffer.byteLength(context)));
}

console.log("Stop: stop-check.mjs");
{
  const real = "两种写法的功率分别为 \\(P_1\\) 和 \\(P_{\\mathrm{total}}\\)，所以有\n\n\\[\nS=4\\lambda\\frac{P_2}{P_{\\text{total}}}\n\\]\n\n其中 \\(\\lambda = 0.5\\)。";
  const result = run("stop-check.mjs", stop(real));
  const out = parse(result.stdout);
  const reason = out?.reason ?? "";
  check("asks the model to continue with decision block", out?.decision === "block", JSON.stringify(out));
  check("uses only the documented keys", out && Object.keys(out).sort().join() === "decision,reason", JSON.stringify(out));
  check("exits 0 with nothing on stderr", result.status === 0 && result.stderr === "", `${result.status} ${result.stderr}`);
  check("gives both language versions of the request", reason.includes("ZCode 的聊天界面无法渲染") && reason.includes("The ZCode chat UI cannot render"), reason);
  check("counts the formulas", /\bDetected 4 formula/.test(reason), reason);
  const at = (snippet) => reason.indexOf(snippet);
  check(
    "lists the corrected formulas in the order of the answer",
    at("1. $$P_1$$") > -1 &&
      at("$$P_1$$") < at("2. $$P_{\\mathrm{total}}$$") &&
      at("$$P_{\\mathrm{total}}$$") < at("3. $$\nS=4\\lambda\\frac{P_2}{P_{\\text{total}}}\n$$") &&
      at("S=4\\lambda") < at("4. $$\\lambda = 0.5$$"),
    reason
  );

  const mid = parse(run("stop-check.mjs", stop("先看 \\(a_1\\)，再展开\n\n\\[\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n\\]\n\n最后 \\(x^2 + y^2\\)。")).stdout);
  check(
    "finds formulas before, inside and after a display block",
    ["1. $$a_1$$", "\\begin{aligned}", "3. $$x^2 + y^2$$"].every((s) => mid?.reason?.includes(s)) && /\bDetected 3 formula/.test(mid?.reason ?? ""),
    JSON.stringify(mid)
  );

  const clean = [
    "功率守恒可以写成 $$P_{\\mathrm{total}} = P_1 + P_2$$，其中 $$P_1$$ 是输入功率。\n\n独立的推导：\n\n$$\nS = 4\\lambda\\frac{P_2}{P_{\\text{total}}}\n$$\n",
    "No math here at all. Price is $5 and $10.\n\n```sh\nfind . \\( -name '*.c' -o -name '*.h' \\)\necho '\\[' file\n```\n\nUse `\\(x\\)` in LaTeX and `\\[x\\]` for display.",
    "正则示例：\\(abc\\) 只是三个字符；\\[1\\] 是个字面量方括号。",
    "其中 \\(x\\) 表示位移。",
    "",
  ];
  for (const [index, text] of clean.entries()) {
    const result = run("stop-check.mjs", stop(text));
    check(`clean #${index + 1}: no output`, result.status === 0 && result.stdout === "", `${result.status} ${result.stdout}`);
  }

  const again = run("stop-check.mjs", stop(real, { stop_hook_active: true }));
  check("already forced by a hook: no output (no loop)", again.status === 0 && again.stdout === "", again.stdout);

  const escaped = parse(run("stop-check.mjs", stop("公式 \\(\\alpha + \\beta^2\\)，中文“ 引号 ”，表情 😀。")).stdout);
  check("handles non-ASCII text", escaped?.reason?.includes("$$\\alpha + \\beta^2$$"), JSON.stringify(escaped));

  const odd = parse(run("stop-check.mjs", stop('quotes " backslash \\ tab \t in \\(a \\text{"if"} b\\)\n')).stdout);
  check("output stays valid JSON for quotes, backslashes and tabs", odd?.decision === "block", JSON.stringify(odd));

  const started = Date.now();
  const big = parse(run("stop-check.mjs", stop(`${"# Section\n\nSome text without math.\n\n".repeat(3000)}\\(E = mc^2\\)`)).stdout);
  check("large answer (about 100 KB) handled quickly", big?.reason?.includes("$$E = mc^2$$") && Date.now() - started < 5000, JSON.stringify(big));

  const listed = parse(run("stop-check.mjs", stop(Array.from({ length: 25 }, (_, i) => `\\(x_${i}\\)`).join(" "))).stdout);
  check(
    "lists at most 20 formulas and says how many are left",
    listed?.reason?.includes("20. $$x_19$$") && listed.reason.includes("... and 5 more."),
    listed?.reason
  );

  // Thirty display formulas of about 3 KB each: twenty of them would overflow the stdout limit.
  const huge = run("stop-check.mjs", stop(Array.from({ length: 30 }, (_, i) => `\\[ y_{${i}} = ${"a".repeat(3000)} \\]`).join("\n\n")));
  const hugeOut = parse(huge.stdout);
  check(
    "keeps the output under the hook stdout limit",
    hugeOut?.decision === "block" && Buffer.byteLength(huge.stdout) <= 28000 && /more\. Those are not listed here/.test(hugeOut.reason),
    `${Buffer.byteLength(huge.stdout)} bytes`
  );
  check("lists as many of them as fit", (hugeOut?.reason?.match(/\d+\. \$\$\ny_\{\d+\}/g) ?? []).length >= 1, String((hugeOut?.reason?.match(/\d+\. \$\$/g) ?? []).length));

  for (const [name, payload] of [
    ["empty stdin", undefined],
    ["not JSON", "this is not json"],
    ["JSON without a response", { hook_event_name: "Stop" }],
    ["response is not a string", { hook_event_name: "Stop", responseText: 42, last_assistant_message: 42 }],
    ["a JSON array", [1, 2, 3]],
  ]) {
    const result = run("stop-check.mjs", payload);
    check(`${name}: exits 0 without output`, result.status === 0 && result.stdout === "", `${result.status} ${result.stdout} ${result.stderr}`);
  }
  const preview = parse(run("stop-check.mjs", { hook_event_name: "Stop", last_assistant_message: "value \\(P_1\\)" }).stdout);
  check("falls back to last_assistant_message", preview?.reason?.includes("$$P_1$$"), JSON.stringify(preview));
}

console.log("hooks.json matches the hooks on disk");
{
  const config = JSON.parse(readFileSync(join(root, "hooks", "hooks.json"), "utf8"));
  const registered = Object.entries(config.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) => group.hooks.map((hook) => ({ event, ...hook })))
  );
  const scripts = registered.map((hook) => hook.args?.[0]?.replace("${ZCODE_PLUGIN_ROOT}/", "")).filter(Boolean);
  check(
    "every registered hook is a process hook that runs an existing script",
    registered.length === 2 &&
      registered.every((hook) => hook.type === "process" && hook.command === "node" && hook.args?.length === 1 && hook.timeoutMs > 0),
    JSON.stringify(registered)
  );
  check("the scripts registered are the ones in hooks/", same(scripts.sort(), ["hooks/math-rules.mjs", "hooks/stop-check.mjs"].sort()), JSON.stringify(scripts));
  check(
    "only documented hook fields are used",
    registered.every((hook) => Object.keys(hook).every((key) => ["event", "type", "command", "args", "timeoutMs", "statusMessage"].includes(key))),
    JSON.stringify(registered)
  );
}

console.log("The hooks are self-contained: no exit() call, no file access, no network");
{
  for (const script of ["math-rules.mjs", "stop-check.mjs"]) {
    // Comments are dropped first; they are allowed to mention what the code must not do.
    const code = readFileSync(join(root, "hooks", script), "utf8").replace(/\/\/.*$/gm, "");
    check(`${script} never calls process.exit()`, (code.match(/process\.exit\s*\(/g) ?? []).length === 0);
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    check(`${script} imports nothing that touches files or the network`, imports.every((name) => /^node:(path|url|util)$/.test(name)), JSON.stringify(imports));
  }
}

console.log("The smoke-test commands printed in the READMEs work as printed");
{
  // Each README block is written to a script file and run with `sh <file>`, exactly as a person pastes it
  // into a terminal.
  const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
  for (const name of ["README.md", "README_CN.md"]) {
    const block = [...readFileSync(join(root, name), "utf8").matchAll(/```shell\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .find((body) => body.includes("printf"));
    if (!hasSh || !block) {
      skip(`${name}: smoke-test block`, hasSh ? "no smoke-test block found" : "no POSIX shell available");
      continue;
    }
    const work = mkdtempSync(join(tmpdir(), "math-render-fix-readme-"));
    try {
      const script = join(work, "smoke.sh");
      writeFileSync(script, block.replace(/\r\n/g, "\n"));
      const result = spawnSync("sh", [script], { cwd: root, encoding: "utf8", timeout: 20000 });
      const lines = result.stdout.split("\n").filter((line) => line.trim() !== "");
      const answers = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      });
      check(
        `${name}: smoke-test block runs`,
        result.status === 0 && result.stderr === "",
        `exit ${result.status}, stderr ${JSON.stringify(result.stderr.slice(0, 160))}`
      );
      check(
        `${name}: two hook answers, one JSON object per line`,
        lines.length === 2 && answers.every(Boolean),
        `${lines.length} line(s): ${JSON.stringify(lines.map((l) => l.slice(0, 40)))}`
      );
      check(
        `${name}: SessionStart answer carries the rule`,
        answers[0]?.hookSpecificOutput?.hookEventName === "SessionStart" && typeof answers[0]?.hookSpecificOutput?.additionalContext === "string",
        JSON.stringify(answers[0])?.slice(0, 160)
      );
      check(
        `${name}: Stop answer blocks with the corrected formula`,
        answers[1]?.decision === "block" && answers[1]?.reason?.includes("$$P_1$$"),
        JSON.stringify(answers[1])?.slice(0, 160)
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
