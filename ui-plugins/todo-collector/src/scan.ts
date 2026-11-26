import { execFile } from "node:child_process";

export const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".swift", ".m", ".mm", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".scala", ".dart", ".lua", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".r", ".pl", ".ex", ".exs", ".erl", ".hs", ".clj", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".ini", ".tf", ".gradle", ".cmake", ".proto", ".graphql", ".md"];

export interface Hit { file: string; line: number; tag: string; owner: string; text: string; urgent: boolean }

const COMMENT = String.raw`(?:\/\/+|#+|\/\*+|^\s*\*+|--|<!--|;+|%|\{-|'|REM\b)`;
export function makeRe(tags: string[]) {
  const t = tags.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`${COMMENT}\\s*(?:@)?(${t})\\b(?:\\s*\\(([^)]{1,40})\\))?\\s*[:：\\-–]?\\s*(.*)$`, "i");
}

export function scanText(file: string, text: string, tags: string[], markdown = false): Hit[] {
  const re = makeRe(tags);
  const out: Hit[] = [];
  const lines = text.split(/\r?\n/);
  let inFence = false;
  lines.forEach((ln, i) => {
    if (ln.length > 2000) return;
    if (markdown) {
      if (/^\s*```/.test(ln)) inFence = !inFence;
      if (!inFence && !/<!--/.test(ln)) return;
    }
    const m = re.exec(ln);
    if (!m) return;
    // 标记必须在注释里：注释符号之前不能是未闭合的字符串
    const before = ln.slice(0, m.index);
    if ((before.match(/"/g)?.length ?? 0) % 2 === 1 || (before.match(/'/g)?.length ?? 0) % 2 === 1) return;
    let body = m[3].replace(/\s*(\*\/|-->|-\})\s*$/, "").trim();
    let owner = (m[2] ?? "").trim().replace(/^@/, "");
    const at = /^@([\w.-]+)\s*[:：]?\s*/.exec(body);
    if (!owner && at) { owner = at[1]; body = body.slice(at[0].length); }
    // 连续的下一行注释作为续写
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const cont = /^\s*(?:\/\/+|#+|\*+(?!\/)|--)\s{1,}(?![A-Z]{3,}\b)(\S.*)$/.exec(lines[j]);
      if (!cont || re.test(lines[j]) || /^\s*\*\//.test(lines[j])) break;
      if (/^\s*(\/\/|#|--)/.test(ln.trim()) === false && !/^\s*\*/.test(lines[j])) break;
      body += ` ${cont[1].replace(/\s*\*\/\s*$/, "").trim()}`;
    }
    const urgent = /!!+|\burgent\b|\basap\b|紧急|尽快/i.test(body);
    out.push({ file, line: i + 1, tag: m[1].toUpperCase(), owner, text: body.replace(/\s*!!+\s*/g, " ").trim(), urgent });
  });
  return out;
}

export interface Blame { author: string; time: number }
export function blame(cwd: string, file: string): Promise<Map<number, Blame>> {
  return new Promise((resolve) => {
    execFile("git", ["blame", "--line-porcelain", "--", file], { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true }, (err, stdout) => {
      const map = new Map<number, Blame>();
      if (err) return resolve(map);
      let line = 0, author = "", time = 0;
      for (const l of stdout.split("\n")) {
        const h = /^[0-9a-f]{40} \d+ (\d+)/.exec(l);
        if (h) { line = Number(h[1]); continue; }
        if (l.startsWith("author ")) author = l.slice(7);
        else if (l.startsWith("author-time ")) time = Number(l.slice(12));
        else if (l.startsWith("\t")) { if (author !== "Not Committed Yet") map.set(line, { author, time }); }
      }
      resolve(map);
    });
  });
}
