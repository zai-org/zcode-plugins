#!/usr/bin/env node
// Stop hook of math-render-fix.
//
// ZCode's chat renderer cannot display math delimited by \( ... \) or \[ ... \]; it shows the raw LaTeX.
// When the final answer still uses those delimiters, this hook asks the model to re-output just those
// formulas with dollar delimiters, supplying the corrected forms. Text inside code fences and code
// spans is ignored, and a stop that a hook already forced is accepted, so the check never loops.
//
// While the optional renderer patch (scripts/patch-renderer.mjs) is in place, the renderer displays
// those delimiters by itself and this hook stays silent.
//
// Input:  the Stop JSON line on stdin.
// Output: { decision: "block", reason } when formulas need re-outputting, otherwise nothing.
// Every failure path ends with exit code 0 and no output, so a broken check never blocks a turn.

import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LIST_LIMIT = 20;
// ZCode keeps at most 32768 bytes of a hook's stdout; stay well below that.
const OUTPUT_BUDGET = 28000;

async function readInput() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// ---- removing code --------------------------------------------------------------

// The fence a line opens, or null: three or more backticks or tildes after optional indentation.
function fenceMark(line) {
  const trimmed = line.replace(/^[ \t>]*/, "");
  const char = trimmed.charAt(0);
  if (char !== "`" && char !== "~") return null;
  let length = 0;
  while (trimmed.charAt(length) === char) length++;
  return length >= 3 ? { char, length } : null;
}

function closesFence(line, fence) {
  const trimmed = line.replace(/^[ \t>]*/, "").replace(/[\t\r ]+$/, "");
  return trimmed.length >= fence.length && [...trimmed].every((char) => char === fence.char);
}

// One line with its code spans removed. An unmatched backtick run is kept as text.
function stripSpans(line) {
  let out = "";
  let rest = line;
  let at;
  while ((at = rest.indexOf("`")) > -1) {
    out += rest.slice(0, at);
    rest = rest.slice(at);
    let open = 0;
    while (rest.charAt(open) === "`") open++;
    let index = open;
    let close = -1;
    while (index < rest.length) {
      if (rest.charAt(index) !== "`") {
        index++;
        continue;
      }
      let run = 0;
      while (rest.charAt(index + run) === "`") run++;
      if (run === open) {
        close = index + run;
        break;
      }
      index += run;
    }
    if (close > -1) rest = rest.slice(close);
    else {
      out += rest.slice(0, open);
      rest = rest.slice(open);
    }
  }
  return out + rest;
}

// The message with fenced blocks and code spans removed.
function stripCode(message) {
  const kept = [];
  let fence = null;
  for (const line of message.split("\n")) {
    const mark = fenceMark(line);
    if (fence) {
      if (mark && mark.char === fence.char && closesFence(line, fence)) fence = null;
      continue;
    }
    if (mark) {
      fence = mark;
      continue;
    }
    kept.push(stripSpans(line));
  }
  return kept.join("\n");
}

// ---- finding unsupported math -----------------------------------------------------

// Whether the text between delimiters looks like math rather than an accidental \( ... \).
const LATEX_COMMAND = /\\[a-zA-Z]/;
const SCRIPT_OR_GROUP = /[_^{}]/;
const OPERATOR = /[=+*/<>|]/;
const SYMBOL =
  /α|β|γ|δ|ε|ζ|η|θ|ι|κ|λ|μ|ν|ξ|π|ρ|σ|τ|υ|φ|χ|ψ|ω|Γ|Δ|Θ|Λ|Ξ|Π|Σ|Φ|Ψ|Ω|≈|≠|≤|≥|×|÷|±|∑|∏|∫|√|∞|∂|∇|·|∈|→/;

function looksMath(body) {
  return (
    LATEX_COMMAND.test(body) || SCRIPT_OR_GROUP.test(body) || body.includes("\n") || OPERATOR.test(body) || SYMBOL.test(body)
  );
}

// One left-to-right pass, so findings keep the order of the answer. A \[ ... \] pair may span lines; a
// \( ... \) pair must close on its own line. An unterminated opener is skipped, not treated as a pair.
function findUnsupported(text) {
  const found = [];
  let rest = text;
  while (rest.length > 0) {
    const display = rest.indexOf("\\[");
    const inline = rest.indexOf("\\(");
    if (display === -1 && inline === -1) break;
    if (inline === -1 || (display > -1 && display < inline)) {
      const tail = rest.slice(display + 2);
      const end = tail.indexOf("\\]");
      if (end === -1) {
        rest = tail;
        continue;
      }
      const body = tail.slice(0, end);
      if (looksMath(body)) found.push({ kind: "display", body });
      rest = tail.slice(end + 2);
    } else {
      const tail = rest.slice(inline + 2);
      const lineEnd = tail.indexOf("\n");
      const end = tail.indexOf("\\)");
      if (end === -1 || (lineEnd > -1 && end > lineEnd)) {
        rest = tail;
        continue;
      }
      const body = tail.slice(0, end);
      if (looksMath(body)) found.push({ kind: "inline", body });
      rest = tail.slice(end + 2);
    }
  }
  return found;
}

// ---- the renderer patch -------------------------------------------------------------

// The optional renderer patch records the bytes it wrote in this file. While all of them are still in
// the archive the renderer handles \( ... \) itself. They are read back every time, so a ZCode update
// that replaces app.asar brings this check back on its own.
function rendererIsPatched() {
  const state = join(homedir(), ".zcode", "math-render-fix-renderer.txt");
  if (!existsSync(state)) return false;
  let fd;
  let archive;
  let expected = 0;
  let offset;
  let matched = 0;
  try {
    for (const line of readFileSync(state, "utf8").split("\n")) {
      if (line.startsWith("asar=")) archive = line.slice(5);
      else if (line.startsWith("heads=")) expected = Number(line.slice(6));
      else if (line.startsWith("offset=")) offset = Number(line.slice(7));
      else if (line.startsWith("signature=")) {
        const signature = Buffer.from(line.slice(10), "latin1");
        if (!archive || !Number.isInteger(offset)) return false;
        fd ??= openSync(archive, "r");
        const bytes = Buffer.alloc(signature.length);
        if (readSync(fd, bytes, 0, bytes.length, offset) !== bytes.length || !bytes.equals(signature)) return false;
        matched++;
        offset = undefined;
      }
    }
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return expected > 0 && matched === expected;
}

// ---- output ------------------------------------------------------------------------

function buildReason(found, shown) {
  const lines = [
    "ZCode 的聊天界面无法渲染用 \\(...\\) 或 \\[...\\] 包裹的公式，它们会显示为原始 LaTeX。请立刻按下面给出的修正写法重新输出这些公式：保持原有编号和顺序，每条公式配一句上下文即可，不要重复回答的其余部分。今后聊天回复中的公式一律使用 $$...$$（行内）或独占一行的 $$（独立公式）。",
    "The ZCode chat UI cannot render math delimited by \\(...\\) or \\[...\\]; it shows raw LaTeX. Re-output the formulas below now using the corrected forms given: keep their numbering and order, give each with a one-line context, and do not repeat the rest of your answer. From now on use $$...$$ for inline math and $$ on its own lines for display math.",
    "",
  ];
  if (shown === 0) {
    lines.push(
      `Detected ${found.length} formula(s) with unsupported delimiters. They are too long to list here: find them in your answer and re-output each one.`,
    );
    return lines.join("\n");
  }
  lines.push(`Detected ${found.length} formula(s) with unsupported delimiters:`);
  found.slice(0, shown).forEach((item, index) => {
    const body = item.body.trim();
    lines.push(item.kind === "display" ? `${index + 1}. $$\n${body}\n$$` : `${index + 1}. $$${body}$$`);
  });
  if (found.length > shown) {
    lines.push(
      `... and ${found.length - shown} more. Those are not listed here: find them in your answer and convert each one the same way.`
    );
  }
  return lines.join("\n");
}

// The JSON to answer with, or null when the turn may simply end.
function decide(input) {
  // The turn is already continuing because of a hook: let it end this time.
  if (!input || input.stop_hook_active === true || rendererIsPatched()) return null;

  const text = typeof input.responseText === "string" ? input.responseText : input.last_assistant_message;
  if (typeof text !== "string" || text.length === 0) return null;

  const found = findUnsupported(stripCode(text));
  if (found.length === 0) return null;

  // List as many corrected formulas as fit in the output budget; fall back to none at all.
  let shown = Math.min(found.length, LIST_LIMIT);
  let result = { decision: "block", reason: buildReason(found, shown) };
  while (shown > 0 && Buffer.byteLength(JSON.stringify(result)) > OUTPUT_BUDGET) {
    shown = shown === 1 ? 0 : Math.floor(shown / 2);
    result = { decision: "block", reason: buildReason(found, shown) };
  }
  return JSON.stringify(result);
}

let response = null;
try {
  response = decide(await readInput());
} catch {
  // Never block a turn because of this check.
}
// The process then ends by itself with exit code 0. Do not call process.exit() here: ZCode runs hooks
// with stdout on a pipe, the write below is asynchronous there, and exit() would discard it.
if (response !== null) process.stdout.write(`${response}\n`);
