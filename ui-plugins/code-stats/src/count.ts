/** 按语言统计代码行、注释行、空行；简单 .gitignore 匹配。 */
export interface Lang { name: string; line: string[]; block: [string, string][] }

const C: Pick<Lang, "line" | "block"> = { line: ["//"], block: [["/*", "*/"]] };
const HASH: Pick<Lang, "line" | "block"> = { line: ["#"], block: [] };
const L = (name: string, spec: Pick<Lang, "line" | "block">): Lang => ({ name, ...spec });
export const LANGS: Record<string, Lang> = {
  ".ts": L("TypeScript", C), ".tsx": L("TypeScript", C), ".mts": L("TypeScript", C), ".cts": L("TypeScript", C),
  ".js": L("JavaScript", C), ".jsx": L("JavaScript", C), ".mjs": L("JavaScript", C), ".cjs": L("JavaScript", C),
  ".java": L("Java", C), ".kt": L("Kotlin", C), ".kts": L("Kotlin", C), ".scala": L("Scala", C), ".swift": L("Swift", C),
  ".c": L("C", C), ".h": L("C/C++ Header", C), ".cpp": L("C++", C), ".cc": L("C++", C), ".hpp": L("C/C++ Header", C), ".cs": L("C#", C),
  ".go": L("Go", C), ".rs": L("Rust", C), ".dart": L("Dart", C), ".php": L("PHP", { line: ["//", "#"], block: [["/*", "*/"]] }),
  ".css": L("CSS", { line: [], block: [["/*", "*/"]] }), ".scss": L("SCSS", C), ".less": L("Less", C),
  ".py": L("Python", { line: ["#"], block: [['"""', '"""'], ["'''", "'''"]] }), ".rb": L("Ruby", { line: ["#"], block: [["=begin", "=end"]] }),
  ".sh": L("Shell", HASH), ".bash": L("Shell", HASH), ".zsh": L("Shell", HASH), ".ps1": L("PowerShell", { line: ["#"], block: [["<#", "#>"]] }),
  ".pl": L("Perl", HASH), ".r": L("R", HASH), ".yaml": L("YAML", HASH), ".yml": L("YAML", HASH), ".toml": L("TOML", HASH),
  ".sql": L("SQL", { line: ["--"], block: [["/*", "*/"]] }), ".lua": L("Lua", { line: ["--"], block: [["--[[", "]]"]] }),
  ".html": L("HTML", { line: [], block: [["<!--", "-->"]] }), ".vue": L("Vue", { line: ["//"], block: [["<!--", "-->"], ["/*", "*/"]] }),
  ".svelte": L("Svelte", { line: ["//"], block: [["<!--", "-->"], ["/*", "*/"]] }), ".xml": L("XML", { line: [], block: [["<!--", "-->"]] }),
  ".md": L("Markdown", { line: [], block: [["<!--", "-->"]] }), ".json": L("JSON", { line: [], block: [] }),
};
export const CODE_EXTS = Object.keys(LANGS);

export function langOf(path: string): Lang | undefined {
  const m = /\.[^./]+$/.exec(path.toLowerCase());
  return m ? LANGS[m[0]] : undefined;
}

export interface Count { lines: number; code: number; comment: number; blank: number; longest: number }

export function countLines(text: string, lang: Lang): Count {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const r: Count = { lines: text ? lines.length : 0, code: 0, comment: 0, blank: 0, longest: 0 };
  if (!text) return r;
  let open: string | undefined;
  for (const raw of lines) {
    r.longest = Math.max(r.longest, raw.length);
    const t = raw.trim();
    if (open) {
      r.comment++;
      const i = t.indexOf(open);
      if (i >= 0) {
        const rest = t.slice(i + open.length).trim();
        open = undefined;
        if (rest && !lang.line.some((x) => rest.startsWith(x))) { r.comment--; r.code++; }
      }
      continue;
    }
    if (!t) { r.blank++; continue; }
    if (lang.line.some((x) => t.startsWith(x)) && !(lang.name === "Lua" && t.startsWith("--[["))) { r.comment++; continue; }
    const b = lang.block.find(([a]) => t.startsWith(a));
    if (b) {
      const end = t.indexOf(b[1], b[0].length);
      if (end < 0) { open = b[1]; r.comment++; continue; }
      const rest = t.slice(end + b[1].length).trim();
      if (rest) r.code++; else r.comment++;
      continue;
    }
    r.code++;
  }
  return r;
}

/** .gitignore 的常见写法：注释、目录（尾部 /）、以 / 开头锚定、*、**、?。不支持 ! 取反（会提示）。 */
export function gitignoreMatcher(text: string) {
  const rules: RegExp[] = [];
  let negations = 0;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) { negations++; continue; }
    const dir = line.endsWith("/");
    if (dir) line = line.slice(0, -1);
    const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    let re = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "*" && line[i + 1] === "*") { re += ".*"; i++; if (line[i + 1] === "/") i++; }
      else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    rules.push(new RegExp(`${anchored ? "^" : "(^|/)"}${re}${dir ? "/" : "(/|$)"}`));
  }
  return { negations, test: (rel: string) => rules.some((r) => r.test(rel)) };
}

/** 逗号分隔的排除规则（同 .gitignore 写法）。 */
export const excludeMatcher = (list: string) => gitignoreMatcher(list.split(/[,，;\n]/).join("\n"));
