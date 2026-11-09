#!/usr/bin/env node
// 测试用的假 typst：模拟 `--version`、`watch` 与 `compile` 的命令行行为和输出格式（human 诊断、状态行、--deps）。
// “编译”把源码的每一行去掉标记后写进一页 PDF；`#include "x"` 引入文件；以下指令模拟诊断：
//   #error("msg")  → 该行报错（带 hint）       #warn("msg") → 该行警告
//   #slow(ms)      → 编译耗时 ms              #pages(n)    → 每 n 行一页（默认 40）
// 环境变量：FAKE_TYPST_VERSION（默认 0.14.2）、FAKE_TYPST_CRASH=1（watch 第一次编译后退出）、
// FAKE_TYPST_DEAF=1（watch 只编译一次，之后不理会修改，模拟漏掉文件事件）。
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { makePdf } from "./pdf-fixture.mjs";

const args = process.argv.slice(2);
const version = process.env.FAKE_TYPST_VERSION ?? "0.14.2";
const err = (text) => process.stderr.write(text);
const stamp = () => `[${new Date().toTimeString().slice(0, 8)}]`;

if (args[0] === "--version") {
  process.stdout.write(`typst ${version} (fake)\n`);
  process.exit(0);
}

const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const [command, input, output] = args;

/** 读主文件与 #include 的文件；返回行（带来源）与依赖列表。 */
function load(file, seen = new Set()) {
  const lines = [];
  const deps = [];
  if (seen.has(file)) return { lines, deps };
  seen.add(file);
  deps.push(file);
  const text = readFileSync(file, "utf8");
  text.split("\n").forEach((line, index) => {
    const include = /^#include "([^"]+)"/.exec(line);
    if (include) {
      const target = join(dirname(file), include[1]);
      if (!existsSync(target)) {
        lines.push({ file, line: index + 1, text: line, missing: target });
        return;
      }
      const inner = load(target, seen);
      lines.push(...inner.lines);
      deps.push(...inner.deps);
    } else lines.push({ file, line: index + 1, text: line });
  });
  return { lines, deps };
}

function display(file) {
  return relative(process.cwd(), file) || file;
}

function diagnostic(severity, message, entry, column, hint) {
  const number = String(entry.line);
  const pad = " ".repeat(number.length);
  return [
    `${severity}: ${message}`,
    `${pad} ┌─ ${display(entry.file)}:${entry.line}:${column}`,
    `${pad} │`,
    `${number} │ ${entry.text}`,
    `${pad} │ ${" ".repeat(column - 1)}^`,
    ...(hint ? [`${pad} │`, `${pad} = hint: ${hint}`] : []),
    "",
  ].join("\n");
}

/** 返回 { ok, warnings, text（诊断）, pages（每页的行）, deps, ms }。 */
function compile(file) {
  const started = Date.now();
  if (!existsSync(file)) return { fatal: `input file not found (searched at ${file})` };
  const { lines, deps } = load(file);
  let text = "";
  let errors = 0;
  let warnings = 0;
  let perPage = 40;
  let slow = 0;
  const visible = [];
  for (const entry of lines) {
    if (entry.missing) {
      text += diagnostic("error", `file not found (searched at ${entry.missing})`, entry, 10);
      errors++;
      continue;
    }
    const error = /#error\("([^"]*)"\)/.exec(entry.text);
    const warn = /#warn\("([^"]*)"\)/.exec(entry.text);
    const pages = /#pages\((\d+)\)/.exec(entry.text);
    const delay = /#slow\((\d+)\)/.exec(entry.text);
    if (error) {
      text += diagnostic("error", error[1], entry, error.index + 1, "a hint from the fake compiler");
      errors++;
    } else if (warn) {
      text += diagnostic("warning", warn[1], entry, warn.index + 1);
      warnings++;
    } else if (pages) perPage = Number(pages[1]);
    else if (delay) slow = Number(delay[1]);
    else {
      const shown = entry.text.replace(/^=+\s*/, "").replace(/[*_#$[\]]/g, "").trim();
      if (shown) visible.push(shown);
    }
  }
  if (slow) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, slow);
  const pages = [];
  for (let index = 0; index < Math.max(1, visible.length); index += perPage) pages.push(visible.slice(index, index + perPage));
  return { ok: errors === 0, warnings, text, pages, deps, ms: Date.now() - started + 0.42 };
}

function writeDeps(deps) {
  const path = option("--deps") ?? option("--make-deps");
  if (!path) return;
  if (option("--deps")) writeFileSync(path, JSON.stringify({ inputs: deps.map(display) }));
  else writeFileSync(path, `${output}: ${deps.map((dep) => display(dep).replace(/ /g, "\\ ")).join(" ")}\n`);
}

if (command === "compile") {
  const result = compile(resolve(input));
  if (result.fatal) {
    err(`error: ${result.fatal}\n`);
    process.exit(1);
  }
  if (!result.ok) {
    err(result.text);
    process.exit(1);
  }
  if (result.text) err(result.text);
  const selected = option("--pages")
    ? option("--pages")
        .split(",")
        .flatMap((part) => {
          const [from, to] = part.split("-").map(Number);
          return Array.from({ length: (to || from) - from + 1 }, (_, index) => from + index);
        })
    : result.pages.map((_, index) => index + 1);
  if (output.endsWith(".png")) {
    // 1×1 PNG。
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    for (const page of selected) if (page <= result.pages.length) writeFileSync(output.replace("{p}", String(page)), png);
  } else writeFileSync(output, makePdf(selected.filter((page) => page <= result.pages.length).map((page) => result.pages[page - 1])));
  process.exit(0);
}

if (command === "watch") {
  const file = resolve(input);
  const watched = new Map();
  let timer = null;
  const run = () => {
    err(`watching ${input}\nwriting to ${output}\n\n${stamp()} compiling ...\n\n`);
    const result = compile(file);
    err(`watching ${input}\nwriting to ${output}\n\n`);
    if (result.fatal) {
      err(`error: ${result.fatal}\n`);
      return;
    }
    writeDeps(result.deps);
    if (result.ok) {
      writeFileSync(output, makePdf(result.pages));
      err(`${stamp()} ${result.warnings ? "compiled with warnings" : "compiled successfully"} in ${result.ms.toFixed(2)} ms\n\n${result.text}`);
    } else err(`${stamp()} compiled with errors\n\n${result.text}`);
    for (const dep of result.deps) if (!watched.has(dep)) watched.set(dep, statSync(dep).mtimeMs);
    if (process.env.FAKE_TYPST_CRASH) {
      err("error: the fake compiler crashed\n");
      process.exit(3);
    }
  };
  run();
  // 轮询依赖的修改时间（假的“文件监视”）。
  setInterval(() => {
    if (process.env.FAKE_TYPST_DEAF) return;
    for (const [dep, mtime] of watched) {
      const now = existsSync(dep) ? statSync(dep).mtimeMs : -1;
      if (now !== mtime) {
        watched.set(dep, now);
        if (!timer)
          timer = setTimeout(() => {
            timer = null;
            run();
          }, 10);
      }
    }
  }, 20);
} else {
  err(`error: unknown command ${command}\n`);
  process.exit(2);
}
