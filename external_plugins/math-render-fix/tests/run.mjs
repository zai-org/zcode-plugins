// Regression tests for this plugin's hooks and patch script.
// Usage: node tests/run.mjs
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

// Hooks run with an empty home directory, so a renderer-patch state file on this machine cannot
// silence the Stop hook and change what these tests observe. Cases that need such a file set their own.
const sandbox = mkdtempSync(join(tmpdir(), "math-render-fix-tests-"));
const inHome = (dir) => ({ ...process.env, HOME: dir, USERPROFILE: dir });

function run(script, payload, env = {}) {
  const input = payload === undefined ? "" : `${JSON.stringify(payload)}\n`;
  const result = spawnSync(node, [join(root, "hooks", script)], { input, encoding: "utf8", env: { ...inHome(sandbox), ...env }, timeout: 20000 });
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
  check("teaches $$ on their own lines for display math", /Display math: a line containing only \$\$, then the formula, then a line containing only \$\$\./.test(context), context);
  check("forbids \\(...\\) and \\[...\\]", context.includes("\\(...\\)") && context.includes("\\[...\\]"), context);
  check("exits 0 with nothing on stderr", same(run("math-rules.mjs", sessionStart()).status, 0) && run("math-rules.mjs", sessionStart()).stderr === "");
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

console.log("Stop: stays silent while the renderer patch is in place");
{
  const home = mkdtempSync(join(tmpdir(), "math-render-fix-home-"));
  try {
    // A stand-in archive with the two patched function heads at known offsets.
    const pass = "function WJt(e){e=e.replace(/\\\\[()[\\]]/g,`$$$`);let t=``,n=0;for(;n<e.length;n++){";
    const wrap = "function KJt(e){if(!/[\\\\$]/.test(e))return e;";
    const filler = "x".repeat(500);
    const archivePath = join(home, "app.asar");
    const state = join(home, ".zcode", "math-render-fix-renderer.txt");
    mkdirSync(dirname(state), { recursive: true });
    const save = (text) => writeFileSync(state, text);
    const archive = (heads) => writeFileSync(archivePath, filler + heads[0] + filler + heads[1]);
    const violating = stop("值为 \\(P_1\\) 和 \\(x^2\\)。");
    const env = inHome(home);

    archive([pass, wrap]);
    save(`asar=${archivePath}\nheads=2\noffset=500\nsignature=${pass}\noffset=${1000 + pass.length}\nsignature=${wrap}\n`);
    const quiet = run("stop-check.mjs", violating, env);
    check("both patched heads present: no output", quiet.status === 0 && quiet.stdout === "", `${quiet.status} ${quiet.stdout}`);

    archive([pass.replace("replace", "REPLACE"), wrap]);
    check("patch gone (as after a ZCode update): the check is back", parse(run("stop-check.mjs", violating, env).stdout)?.decision === "block");

    archive([pass, wrap]);
    save(`asar=${archivePath}\nheads=2\noffset=500\nsignature=${pass}\n`);
    check("state lists only one of the two heads: the check stays active", parse(run("stop-check.mjs", violating, env).stdout)?.decision === "block");

    save(`asar=${archivePath}\nheads=0\n`);
    check("state lists no heads at all: the check stays active", parse(run("stop-check.mjs", violating, env).stdout)?.decision === "block");

    save(`asar=${join(home, "missing.asar")}\nheads=1\noffset=0\nsignature=${pass}\n`);
    check("archive named in the state is missing: the check stays active", parse(run("stop-check.mjs", violating, env).stdout)?.decision === "block");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
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

console.log("Hooks end without process.exit(), so a pending write to a pipe is never lost");
for (const script of ["math-rules.mjs", "stop-check.mjs"]) {
  // Comments are dropped first; they are allowed to mention the call that the code must not make.
  const code = readFileSync(join(root, "hooks", script), "utf8").replace(/\/\/.*$/gm, "");
  const calls = code.match(/process\.exit\s*\(/g) ?? [];
  check(`${script} never calls process.exit()`, calls.length === 0, `${calls.length} call(s)`);
}

console.log("The smoke-test commands printed in the READMEs work as printed");
{
  // Each README block is written to a script file and run with `sh <file>`, exactly as a person pastes it
  // into a terminal, with an empty home directory so no renderer-patch state file can silence the Stop hook.
  const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
  for (const name of ["README.md", "README_CN.md"]) {
    const block = [...readFileSync(join(root, name), "utf8").matchAll(/```shell\n([\s\S]*?)```/g)]
      .map((match) => match[1])
      .find((body) => body.includes("printf"));
    if (!hasSh || !block) {
      skip(`${name}: smoke-test block`, hasSh ? "no smoke-test block found" : "no POSIX shell available");
      continue;
    }
    const home = mkdtempSync(join(tmpdir(), "math-render-fix-readme-"));
    try {
      const script = join(home, "smoke.sh");
      writeFileSync(script, block.replace(/\r\n/g, "\n"));
      const result = spawnSync("sh", [script], { cwd: root, encoding: "utf8", timeout: 20000, env: { ...process.env, HOME: home, USERPROFILE: home } });
      const lines = result.stdout.split("\n").filter((line) => line.trim() !== "");
      const answers = lines.map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      });
      check(`${name}: smoke-test block runs`, result.status === 0 && result.stderr === "", `exit ${result.status}, stderr ${JSON.stringify(result.stderr.slice(0, 160))}`);
      check(`${name}: two hook answers, one JSON object per line`, lines.length === 2 && answers.every(Boolean), `${lines.length} line(s): ${JSON.stringify(lines.map((l) => l.slice(0, 40)))}`);
      check(`${name}: SessionStart answer carries the rule`, answers[0]?.hookSpecificOutput?.hookEventName === "SessionStart" && typeof answers[0]?.hookSpecificOutput?.additionalContext === "string", JSON.stringify(answers[0])?.slice(0, 160));
      check(`${name}: Stop answer blocks with the corrected formula`, answers[1]?.decision === "block" && answers[1]?.reason?.includes("$$P_1$$"), JSON.stringify(answers[1])?.slice(0, 160));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
}

console.log("The patch script on a stand-in archive: status, apply, a simulated update, restore");
{
  const T = String.fromCharCode(96);
  // The two function heads the patch knows, in a chunk that is long enough to be looked at.
  const standInChunk = [
    `// ${"pad ".repeat(300)}`,
    `function WJt(e){if(!e.includes(${T}$${T}))return e;let t=${T}${T};for(let n=0;n<e.length;n++){t+=e[n]}return t}`,
    `function KJt(e){if(!e.includes(${T}$${T}))return e;return WJt(e)}`,
    "",
  ].join("\n");
  const unknownChunk = `// ${"pad ".repeat(300)}\nfunction unrelated(e){return e}\n`;
  const meta = '{"appVersion":"0.0.0-stand-in"}';

  // A stand-in app.asar with one renderer chunk and a build-meta file, laid out like ZCode's own.
  const buildArchive = (file, chunk) => {
    const header = JSON.stringify({
      files: {
        out: {
          files: {
            metadata: { files: { "build-meta.json": { size: meta.length, offset: "0" } } },
            renderer: { files: { assets: { files: { "chunk.js": { size: chunk.length, offset: String(meta.length) } } } } },
          },
        },
      },
    });
    const padding = (4 - (header.length % 4)) % 4;
    const headerSize = 8 + header.length + padding;
    const head = Buffer.alloc(16);
    head.writeUInt32LE(4, 0);
    head.writeUInt32LE(headerSize, 4);
    head.writeUInt32LE(headerSize - 4, 8);
    head.writeUInt32LE(header.length, 12);
    writeFileSync(
      file,
      Buffer.concat([head, Buffer.from(header), Buffer.alloc(padding), Buffer.from(meta, "latin1"), Buffer.from(chunk, "latin1")])
    );
  };

  const home = mkdtempSync(join(tmpdir(), "math-render-fix-cli-"));
  try {
    const script = join(root, "scripts", "patch-renderer.mjs");
    const asar = join(home, "app.asar");
    const state = join(home, ".zcode", "math-render-fix-renderer.txt");
    // The script stores its state under the home directory, so it runs with this empty one.
    const cli = (action) => {
      const result = spawnSync(process.execPath, [script, action, "--asar", asar], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home },
        timeout: 30000,
      });
      return { status: result.status, out: result.stdout, err: result.stderr };
    };
    const says = (result, text) => result.out.includes(text);
    const chunkInArchive = async () => {
      const module = await import(pathToFileURL(script).href);
      const archive = module.openAsar(asar, false);
      try {
        const { entry } = module.listJs(archive.at("out/renderer"), "out/renderer", [])[0];
        return module.readAt(archive.fd, archive.dataBase + Number(entry.offset), entry.size);
      } finally {
        closeSync(archive.fd);
      }
    };

    buildArchive(asar, standInChunk);
    let result = cli("status");
    check(
      "unpatched archive, no state file: original, and the Stop hook is active",
      result.status === 0 && says(result, "patch:   original") && says(result, "hook:    the Stop hook is active") && !existsSync(state),
      result.out + result.err
    );

    result = cli("apply");
    check(
      "apply: patched, and the Stop hook is silent",
      result.status === 0 && says(result, "original -> patched") && says(result, "hook:    the Stop hook is silent") && existsSync(state),
      result.out + result.err
    );
    const functions = new Function(`${await chunkInArchive()}\nreturn { WJt, KJt };`)();
    check(
      "the patched stand-in turns the old delimiters into double dollars",
      functions.KJt("a \\(x^2\\) b") === "a $$x^2$$ b" && functions.KJt("no math here") === "no math here",
      functions.KJt("a \\(x^2\\) b")
    );
    result = cli("status");
    check("the patched archive is recognised", result.status === 0 && says(result, "patch:   patched"), result.out);

    // A ZCode update: a fresh unpatched archive arrives and the state file is left behind.
    buildArchive(asar, standInChunk);
    result = cli("status");
    check(
      "after a simulated update: original, the Stop hook is active again, the stale state file is named",
      result.status === 0 &&
        says(result, "patch:   original") &&
        says(result, "hook:    the Stop hook is active") &&
        says(result, "out of date, as after a ZCode update"),
      result.out
    );
    result = cli("apply");
    check(
      "apply after the update patches again and brings the state file up to date",
      result.status === 0 && says(result, "original -> patched") && says(result, "hook:    the Stop hook is silent") && !says(result, "out of date"),
      result.out + result.err
    );

    const pristine = join(home, "pristine.asar");
    buildArchive(pristine, standInChunk);
    result = cli("restore");
    check(
      "restore: the archive is back byte for byte, the Stop hook is active, the state file is gone",
      result.status === 0 && readFileSync(asar).equals(readFileSync(pristine)) && says(result, "hook:    the Stop hook is active") && !existsSync(state),
      result.out + result.err
    );
    result = cli("restore");
    check("restore on an unpatched archive: nothing to do", result.status === 0 && says(result, "Nothing to do"), result.out);

    const untouched = join(home, "untouched.asar");
    buildArchive(asar, unknownChunk);
    buildArchive(untouched, unknownChunk);
    result = cli("status");
    check(
      "a build the patch does not know: not applicable, exit 1, the Stop hook is still reported",
      result.status === 1 && says(result, "not applicable") && says(result, "hook:    the Stop hook is active"),
      result.out
    );
    result = cli("apply");
    check(
      "apply refuses an unknown build and leaves the archive untouched",
      result.status === 1 && readFileSync(asar).equals(readFileSync(untouched)),
      result.out + result.err
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
