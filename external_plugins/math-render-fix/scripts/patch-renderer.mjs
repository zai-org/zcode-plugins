#!/usr/bin/env node
// Lets ZCode's chat renderer display math delimited by \(...\) or \[...\].
//
// ZCode renders Markdown with Streamdown, whose math support only recognizes dollar delimiters. Before
// parsing, ZCode runs a dollar-disambiguation pass over every line outside code:
//
//   wrapper(text)  skips fenced code blocks and hands each remaining line on
//   spans(line)     skips code spans and hands each plain segment to the pass
//   pass(segment)  keeps $...$ when it looks like math and escapes the other dollar signs
//
// The patch rewrites the heads of two of these functions and nothing else:
//   1. pass:     insert `e=e.replace(/\\[()[\]]/g,`$$$`)`, so \( \) \[ \] become $$ before the parser
//                sees them (`$$$` is the replacement pattern for two dollar signs). The bytes come
//                from dropping the pass's dollar-free fast path and folding the loop counter into the
//                existing `let`; the result is exactly as long as the original.
//   2. wrapper:  its fast path returned a whole message as soon as it held no `$`, which kept messages
//                that only use \(...\) from ever reaching the pass. It now also requires that the
//                message hold no backslash: `if(!/[\\$]/.test(e))return e;` (same length as before).
//
// Each replacement is exactly as long as the text it replaces, so the file keeps its size and the
// asar header (file table, sizes, offsets, hashes) is left untouched. The edits are made in place and
// are reversed by `restore`. A ZCode update replaces app.asar, which silently removes the patch.
//
// apply and restore also refresh ~/.zcode/math-render-fix-renderer.txt with the patched bytes. This
// plugin's Stop hook reads it to stay silent while the renderer already displays \(...\) by itself.
//
// Usage:
//   node patch-renderer.mjs status  [--asar <path to app.asar>]
//   node patch-renderer.mjs apply   [--asar <path to app.asar>]
//   node patch-renderer.mjs restore [--asar <path to app.asar>]
//
// Without --asar, the archive is located from the running ZCode process and then from common install
// folders. apply and restore refuse to write unless both functions are found exactly once.

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Pass as shipped:
//   function f(e){if(!e.includes(`$`))return e;let t=``;for(let n=0;n<e.length;n++){
export const PASS_ORIGINAL =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{if\(!\2\.includes\(`\$`\)\)return \2;let ([A-Za-z_$][\w$]*)=``;for\(let ([A-Za-z_$][\w$]*)=0;\4<\2\.length;\4\+\+\)\{/g;

// Pass once patched:
//   function f(e){e=e.replace(/\\[()[\]]/g,`$$$`);let t=``,n=0;for(;n<e.length;n++){
// `$$$` is a replacement pattern that yields two dollar signs: `$$` is one literal `$`, and a final
// lone `$` is literal too. It is the only form that fits the byte budget (`$$$$` is one byte too long).
export const PASS_PATCHED =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{\2=\2\.replace\(\/\\\\\[\(\)\[\\\]\]\/g,`\$\$\$`\);let ([A-Za-z_$][\w$]*)=``,([A-Za-z_$][\w$]*)=0;for\(;\4<\2\.length;\4\+\+\)\{/g;

// Wrapper as shipped: the same fast path as the pass, but not followed by the pass's loop.
export const WRAPPER_ORIGINAL =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{if\(!\2\.includes\(`\$`\)\)return \2;(?!let [A-Za-z_$][\w$]*=``;for\(let )/g;

// Wrapper once patched:
//   function f(e){if(!/[\\$]/.test(e))return e;
export const WRAPPER_PATCHED =
  /function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\{if\(!\/\[\\\\\$\]\/\.test\(\2\)\)return \2;/g;

const toPatchedPass = (match, fn, value, out, index) =>
  `function ${fn}(${value}){${value}=${value}.replace(/\\\\[()[\\]]/g,\`$$$\`);let ${out}=\`\`,${index}=0;for(;${index}<${value}.length;${index}++){`;

const toOriginalPass = (match, fn, value, out, index) =>
  `function ${fn}(${value}){if(!${value}.includes(\`$\`))return ${value};let ${out}=\`\`;for(let ${index}=0;${index}<${value}.length;${index}++){`;

const toPatchedWrapper = (match, fn, value) => `function ${fn}(${value}){if(!/[\\\\$]/.test(${value}))return ${value};`;

const toOriginalWrapper = (match, fn, value) => `function ${fn}(${value}){if(!${value}.includes(\`$\`))return ${value};`;

const USAGE = "usage: node patch-renderer.mjs <status|apply|restore> [--asar <path to app.asar>]";

// Read by the Stop hook of this plugin. While the renderer displays \(...\) by itself there is nothing
// for that hook to correct, so it stays silent. The file holds the bytes the patch wrote; the hook
// reads them back every time, so a ZCode update that replaces app.asar also re-enables the hook.
const HOOK_STATE = join(homedir(), ".zcode", "math-render-fix-renderer.txt");

function find(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => ({ index: match.index, text: match[0], pattern }));
}

// The same text with its head rewritten, or null when that would change its length.
function swapped(hit, rewrite) {
  const next = hit.text.replace(new RegExp(hit.pattern.source), rewrite);
  return next.length === hit.text.length ? next : null;
}

function edit(hit, rewrite) {
  return { index: hit.index, from: hit.text, to: swapped(hit, rewrite) };
}

/**
 * What to change in a renderer chunk.
 * Returns { state, toPatched, toOriginal }, where each list holds the edits, with equal-length
 * `from` and `to` text, that bring the chunk fully into that state. `state` is "unknown" when the
 * two functions are not found exactly once each; such a build is never written to.
 */
export function plan(content) {
  const pass = find(content, PASS_ORIGINAL);
  const passDone = find(content, PASS_PATCHED);
  const wrapper = find(content, WRAPPER_ORIGINAL);
  const wrapperDone = find(content, WRAPPER_PATCHED);
  const passHere = pass.length === 1 && passDone.length === 0;
  const passDoneHere = passDone.length === 1 && pass.length === 0;
  const wrapperHere = wrapper.length === 1 && wrapperDone.length === 0;
  const wrapperDoneHere = wrapperDone.length === 1 && wrapper.length === 0;

  if (passHere && wrapperHere) {
    return {
      state: "original",
      toPatched: [edit(pass[0], toPatchedPass), edit(wrapper[0], toPatchedWrapper)],
      toOriginal: [],
    };
  }
  if (passDoneHere && wrapperDoneHere) {
    return {
      state: "patched",
      toPatched: [],
      toOriginal: [edit(passDone[0], toOriginalPass), edit(wrapperDone[0], toOriginalWrapper)],
    };
  }
  // Only one of the two edits was written, for example because an earlier run was interrupted.
  if (passDoneHere && wrapperHere) {
    return {
      state: "partly patched",
      toPatched: [edit(wrapper[0], toPatchedWrapper)],
      toOriginal: [edit(passDone[0], toOriginalPass)],
    };
  }
  if (passHere && wrapperDoneHere) {
    return {
      state: "partly patched",
      toPatched: [edit(pass[0], toPatchedPass)],
      toOriginal: [edit(wrapperDone[0], toOriginalWrapper)],
    };
  }
  return { state: "unknown", toPatched: [], toOriginal: [] };
}

/** `content` with every edit written at its own index. */
export function withEdits(content, edits) {
  let next = content;
  for (const item of [...edits].sort((a, b) => b.index - a.index)) {
    next = next.slice(0, item.index) + item.to + next.slice(item.index + item.from.length);
  }
  return next;
}

// app.asar of the installation that holds `path`: the program itself, or a folder or file inside it.
function archiveUnder(path) {
  if (!path) return null;
  const folder = /\.(exe|ico)$/i.test(path) ? dirname(path) : path;
  const candidate = join(folder, "resources", "app.asar");
  return existsSync(candidate) ? candidate : null;
}

export function locateAsar(explicit) {
  // An explicit path is never silently replaced by a guess.
  if (explicit) return existsSync(explicit) ? explicit : null;
  const candidates = [process.env.ZCODE_APP_ASAR];
  if (process.platform === "win32") {
    // The running app reports where it is installed; when it is closed, its uninstall entry does.
    const ask = (command) => {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 15000 });
      return result.status === 0 ? result.stdout.trim() : "";
    };
    const uninstall =
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WOW6432Node\\*' -ErrorAction SilentlyContinue | " +
      "Where-Object { $_.DisplayName -like 'ZCode*' } | Select-Object -First 1";
    candidates.push(
      archiveUnder(ask("Get-Process ZCode -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path")),
      archiveUnder(ask(`${uninstall} -ExpandProperty InstallLocation`)),
      archiveUnder(ask(`${uninstall} -ExpandProperty DisplayIcon`)),
    );
    for (const base of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
      if (base) candidates.push(join(base, "ZCode", "resources", "app.asar"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/ZCode.app/Contents/Resources/app.asar");
  } else {
    candidates.push("/opt/ZCode/resources/app.asar", "/opt/zcode/resources/app.asar");
  }
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export function openAsar(file, writable) {
  const fd = openSync(file, writable ? "r+" : "r");
  const head = Buffer.alloc(16);
  readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonLen = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonLen);
  readSync(fd, json, 0, jsonLen, 16);
  const header = JSON.parse(json.toString("utf8"));
  const at = (p) => p.split("/").reduce((node, part) => (node && node.files ? node.files[part] : undefined), header);
  return { fd, header, dataBase: 8 + headerSize, at };
}

export function listJs(node, prefix, out) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (child.files) listJs(child, rel, out);
    else if (rel.endsWith(".js")) out.push({ rel, entry: child });
  }
  return out;
}

export function readAt(fd, offset, size) {
  const buf = Buffer.alloc(size);
  if (size) readSync(fd, buf, 0, size, offset);
  return buf.toString("latin1");
}

// The renderer chunks the patch applies to, with the plan for each.
export function findChunks(archive) {
  const renderer = archive.at("out/renderer");
  if (!renderer) return [];
  const found = [];
  for (const { rel, entry } of listJs(renderer, "out/renderer", [])) {
    if (entry.unpacked || entry.size < 1000) continue;
    const content = readAt(archive.fd, archive.dataBase + Number(entry.offset), entry.size);
    const thePlan = plan(content);
    if (thePlan.state !== "unknown") found.push({ rel, entry, thePlan });
  }
  return found;
}

function checkSyntax(content) {
  const probe = join(tmpdir(), `math-render-fix-syntax-${process.pid}.mjs`);
  try {
    writeFileSync(probe, Buffer.from(content, "latin1"));
    const result = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" });
    return result.status === 0 ? "" : (result.stderr || "syntax check failed").trim();
  } finally {
    rmSync(probe, { force: true });
  }
}

// One `offset=`/`signature=` pair per patched function head, as it is on disk now.
function syncHookState(file, archive, { entry, thePlan }) {
  if (thePlan.state !== "patched") {
    rmSync(HOOK_STATE, { force: true });
    return false;
  }
  const base = archive.dataBase + Number(entry.offset);
  const lines = [`asar=${file.replace(/\\/g, "/")}`, `heads=${thePlan.toOriginal.length}`];
  for (const item of thePlan.toOriginal) lines.push(`offset=${base + item.index}`, `signature=${item.from}`);
  mkdirSync(dirname(HOOK_STATE), { recursive: true });
  writeFileSync(HOOK_STATE, `${lines.join("\n")}\n`);
  return true;
}

// What the Stop hook will do on this machine right now. It mirrors the hook's own check: the state file
// counts only while every head it records is still in the archive. A ZCode update replaces app.asar and
// leaves the file out of date, which makes the hook active again even though the file still exists.
function hookState() {
  const none = { silent: false, stale: false };
  if (!existsSync(HOOK_STATE)) return none;
  let archive;
  let expected = 0;
  let offset;
  let matched = 0;
  let fd;
  try {
    for (const line of readFileSync(HOOK_STATE, "utf8").split("\n")) {
      if (line.startsWith("asar=")) archive = line.slice(5);
      else if (line.startsWith("heads=")) expected = Number(line.slice(6));
      else if (line.startsWith("offset=")) offset = Number(line.slice(7));
      else if (line.startsWith("signature=")) {
        const signature = Buffer.from(line.slice(10), "latin1");
        if (!archive || !Number.isInteger(offset)) return { silent: false, stale: true };
        fd ??= openSync(archive, "r");
        const bytes = Buffer.alloc(signature.length);
        if (readSync(fd, bytes, 0, bytes.length, offset) !== bytes.length || !bytes.equals(signature)) {
          return { silent: false, stale: true };
        }
        matched++;
        offset = undefined;
      }
    }
  } catch {
    return { silent: false, stale: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return expected > 0 && matched === expected ? { silent: true, stale: false } : { silent: false, stale: true };
}

function describeHook() {
  const { silent, stale } = hookState();
  if (silent) return "the Stop hook is silent: the renderer displays \\(...\\) itself";
  return `the Stop hook is active: it has formulas written with \\(...\\) re-output${stale ? " (its state file is out of date, as after a ZCode update)" : ""}`;
}

function run(action, explicitAsar) {
  const file = locateAsar(explicitAsar);
  if (!file) {
    console.log(explicitAsar ? `No such file: ${explicitAsar}` : "ZCode's app.asar was not found. Pass it with --asar.");
    return 1;
  }
  const patching = action === "apply";
  const archive = openAsar(file, action !== "status");
  try {
    const meta = archive.at("out/metadata/build-meta.json");
    const version = meta ? JSON.parse(readAt(archive.fd, archive.dataBase + Number(meta.offset), meta.size)).appVersion : "unknown";
    const hits = findChunks(archive);
    console.log(`asar:    ${file}`);
    console.log(`ZCode:   ${version}`);
    if (hits.length !== 1) {
      console.log(`patch:   not applicable (${hits.length} renderer chunks match). This is not a ZCode build the patch knows; app.asar is unchanged.`);
      if (action === "status") console.log(`hook:    ${describeHook()}`);
      return 1;
    }
    const { rel, entry, thePlan } = hits[0];
    const chunk = () => readAt(archive.fd, archive.dataBase + Number(entry.offset), entry.size);
    console.log(`target:  ${rel}`);
    console.log(`patch:   ${thePlan.state}`);
    if (action === "status") {
      console.log(`hook:    ${describeHook()}`);
      return 0;
    }

    const edits = patching ? thePlan.toPatched : thePlan.toOriginal;
    if (edits.length === 0) {
      console.log("Nothing to do.");
    } else {
      const content = chunk();
      if (edits.some((item) => !item.to)) {
        console.log("Refusing to write: a replacement would change the file length. app.asar is unchanged.");
        return 1;
      }
      if (patching) {
        const problem = checkSyntax(withEdits(content, edits));
        if (problem) {
          console.log(`Refusing to write: the patched chunk does not parse.\n${problem}\napp.asar is unchanged.`);
          return 1;
        }
      }

      const base = archive.dataBase + Number(entry.offset);
      let written = 0;
      for (const item of edits) {
        const offset = base + item.index;
        if (readAt(archive.fd, offset, item.from.length) !== item.from) {
          console.log(`Stopped after ${written} of ${edits.length} edits: ${rel} changed while it was being examined. Run this script again.`);
          return 1;
        }
        writeSync(archive.fd, Buffer.from(item.to, "latin1"), 0, item.to.length, offset);
        fsyncSync(archive.fd);
        if (readAt(archive.fd, offset, item.to.length) !== item.to) {
          console.log(`Stopped after ${written} of ${edits.length} edits: the bytes written to ${rel} did not read back as expected. Run this script again.`);
          return 1;
        }
        written++;
      }
      console.log(`patch:   ${thePlan.state} -> ${patching ? "patched" : "original"} (${written} edits, ${edits.reduce((sum, item) => sum + item.from.length, 0)} bytes replaced in place, file size unchanged)`);
      console.log(
        patching
          ? "Restart ZCode completely for the change to take effect. Undo with: node patch-renderer.mjs restore"
          : "Restart ZCode completely for the change to take effect.",
      );
    }

    // Tell the Stop hook what the archive holds now.
    syncHookState(file, archive, { entry, thePlan: plan(chunk()) });
    console.log(`hook:    ${describeHook()}`);
    return 0;
  } finally {
    closeSync(archive.fd);
  }
}

function main(argv) {
  const [action, ...rest] = argv;
  let asar;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--asar" && rest[i + 1]) asar = rest[++i];
    else {
      console.log(USAGE);
      return 2;
    }
  }
  if (!["status", "apply", "restore"].includes(action)) {
    console.log(USAGE);
    return 2;
  }
  try {
    return run(action, asar);
  } catch (error) {
    console.log(`Failed before writing: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
