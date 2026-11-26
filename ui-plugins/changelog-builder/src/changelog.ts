export const TYPES = ["feat", "fix", "perf", "refactor", "docs", "security", "deps", "other", "chore", "test", "ci", "build", "style", "revert"] as const;
export type CType = (typeof TYPES)[number];
export const HIDDEN: CType[] = ["chore", "test", "ci", "build", "style"];

const HEAD: Record<CType, [string, string]> = {
  feat: ["新功能", "Features"], fix: ["问题修复", "Bug Fixes"], perf: ["性能优化", "Performance"], refactor: ["代码重构", "Refactoring"], docs: ["文档", "Documentation"], security: ["安全", "Security"], deps: ["依赖更新", "Dependencies"], other: ["其他改动", "Other Changes"], chore: ["杂项", "Chores"], test: ["测试", "Tests"], ci: ["持续集成", "CI"], build: ["构建", "Build"], style: ["代码风格", "Style"], revert: ["回滚", "Reverts"],
};
export const heading = (t: CType, lang: "zh" | "en") => HEAD[t][lang === "zh" ? 0 : 1];

const ZH: [RegExp, CType][] = [[/^(新增|添加|增加|新功能|功能|支持)/, "feat"], [/^(修复|修正|修改bug|bug)/i, "fix"], [/^(优化|性能)/, "perf"], [/^(重构)/, "refactor"], [/^(文档)/, "docs"], [/^(依赖|升级依赖)/, "deps"], [/^(测试)/, "test"], [/^(回滚|还原)/, "revert"]];
const ALIAS: Record<string, CType> = { feature: "feat", features: "feat", bugfix: "fix", hotfix: "fix", doc: "docs", performance: "perf", sec: "security", dep: "deps", chores: "chore", tests: "test" };

export interface Parsed { type: CType; scope: string; summary: string; breaking: boolean }
export function parseCommit(subject: string, body = ""): Parsed {
  const breakingBody = /^BREAKING[ -]CHANGE:/m.test(body);
  const m = /^(\w+)(?:\(([^)]*)\))?(!)?\s*[:：]\s*(.+)$/.exec(subject);
  if (m) {
    const raw = m[1].toLowerCase();
    const type = (TYPES as readonly string[]).includes(raw) ? (raw as CType) : ALIAS[raw];
    if (type) return { type, scope: m[2] ?? "", summary: m[4].trim(), breaking: !!m[3] || breakingBody };
  }
  for (const [re, type] of ZH) {
    const z = re.exec(subject);
    if (z) return { type, scope: "", summary: subject.slice(z[0].length).replace(/^[\s:：,，-]+/, "").trim() || subject, breaking: breakingBody };
  }
  if (/^(add|added|adds|implement|introduce|support|new)\b/i.test(subject)) return { type: "feat", scope: "", summary: subject, breaking: breakingBody };
  if (/^(fix|fixed|fixes|resolve|resolved|correct)\b/i.test(subject)) return { type: "fix", scope: "", summary: subject, breaking: breakingBody };
  if (/^(bump|upgrade|update) .*(dependenc|version|to v?\d)/i.test(subject)) return { type: "deps", scope: "", summary: subject, breaking: breakingBody };
  if (/^revert\b/i.test(subject)) return { type: "revert", scope: "", summary: subject, breaking: breakingBody };
  return { type: "other", scope: "", summary: subject, breaking: breakingBody };
}

export interface Entry { release: string; date: string; type: CType; scope: string; summary: string; breaking: boolean; hash: string; short: string; author: string }
export interface Release { name: string; date: string; entries: Entry[] }

export function group(entries: Entry[], order: string[]): Release[] {
  return order.map((name) => {
    const es = entries.filter((e) => e.release === name);
    return { name, date: es.reduce((d, e) => (e.date > d ? e.date : d), ""), entries: es };
  }).filter((r) => r.entries.length);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function linkify(s: string, repo: string) {
  if (!repo) return s;
  const kind = /gitlab/.test(repo) ? "/-/issues/" : "/issues/";
  return s.replace(/(^|[\s(])#(\d+)\b/g, (_, pre, n) => `${pre}[#${n}](${repo}${kind}${n})`);
}

export function markdown(releases: Release[], o: { lang: "zh" | "en"; repo: string; authors: boolean; hidden: CType[]; title: boolean }): string {
  const out: string[] = [];
  if (o.title) out.push(o.lang === "zh" ? "# 更新日志\n" : "# Changelog\n", o.lang === "zh" ? "本文件记录项目的所有重要变更。\n" : "All notable changes to this project are documented in this file.\n");
  for (const r of releases) {
    const shown = r.entries.filter((e) => !o.hidden.includes(e.type) || e.breaking);
    if (!shown.length) continue;
    out.push(`## ${r.name}${r.date ? ` (${r.date.slice(0, 10)})` : ""}\n`);
    const brk = shown.filter((e) => e.breaking);
    if (brk.length) {
      out.push(`### ⚠ ${o.lang === "zh" ? "不兼容变更" : "BREAKING CHANGES"}\n`);
      for (const e of brk) out.push(line(e, o));
      out.push("");
    }
    for (const t of TYPES) {
      const es = shown.filter((e) => e.type === t && !e.breaking);
      if (!es.length) continue;
      out.push(`### ${heading(t, o.lang)}\n`);
      for (const e of es) out.push(line(e, o));
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
function line(e: Entry, o: { repo: string; authors: boolean; lang: "zh" | "en" }) {
  const sha = o.repo ? `[${e.short}](${o.repo}/commit/${e.hash})` : e.short;
  return `- ${e.scope ? `**${e.scope}:** ` : ""}${linkify(/^[a-z]/.test(e.summary) ? cap(e.summary) : e.summary, o.repo)} (${sha})${o.authors && e.author ? ` — ${e.author}` : ""}`;
}
