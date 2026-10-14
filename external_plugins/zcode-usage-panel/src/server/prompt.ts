// 提示词构成：扫描 ZCode 组装系统提示词的源文件（AGENTS.md / 记忆 / 技能 / MCP / 子代理），
// 并尽力从 model-io JSONL 读出会话早期的真实注入记录（滚动窗口会丢弃，读到算赚到）。
// 全程只读；config.json 只取键名，不读任何凭证值。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import readline from "node:readline";
import type { UsageDb } from "./db.js";

const HOME = homedir();
// ZCode Desktop 内置技能包位置：macOS 标准安装路径；其他安装位置可用 ZCODE_APP_PACKAGES 指定。
const BUNDLED_PACKAGES = [process.env.ZCODE_APP_PACKAGES, "/Applications/ZCode.app/Contents/Resources/glm/packages"]
  .find((p): p is string => typeof p === "string" && p.length > 0 && existsSync(p));

export interface DocEntry {
  path: string;
  chars: number;
  mtime: number | null;
}

export interface SkillGroup {
  group: "user" | "plugin" | "bundled";
  owner: string; // 用户级固定 "user"；插件级为插件名；内置为包名
  enabled: boolean;
  overriddenBy?: string; // 内置技能被同名已装插件覆盖时标注
  items: DocEntry[];
  /** 清单常驻注入估算：宿主格式为 `- 名称 (file: 路径)`，插件技能带 `插件:技能 (also loadable as …)` */
  listChars: number;
}

export interface MemoryProject {
  dirName: string;
  matched: boolean; // 是否疑似当前会话的项目
  indexChars: number | null;
  entries: number;
  files: number;
  totalChars: number;
}

export interface InjectedInfo {
  source: string; // 文件路径
  toolNames: string[];
  docs: string[]; // 声明加载的文档路径
  skillDirs: { dir: string; count: number }[];
  sections: { name: string; chars: number }[];
}

export interface PromptComposition {
  scannedAt: number;
  sessionId: string | null;
  sessionDirectory: string | null;
  agentsMd: DocEntry[];
  memory: MemoryProject[];
  skills: SkillGroup[];
  skillTotals: { injected: number; chars: number; listChars: number };
  mcpServers: { name: string; source: string }[];
  mcpServersSeen: string[];
  agentsFiles: DocEntry[];
  injected: InjectedInfo | null;
  errors: string[];
}

const tok = (chars: number) => Math.round(chars / 3.2); // 中英混排粗估

function safeStat(p: string): DocEntry | null {
  try {
    const s = readFileSync(p, "utf8");
    return { path: p, chars: s.length, mtime: statSync(p).mtimeMs };
  } catch {
    return null;
  }
}

function walkSkillMd(dir: string, out: DocEntry[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walkSkillMd(p, out);
    else if (e.name === "SKILL.md") {
      const d = safeStat(p);
      if (d) out.push(d);
    }
  }
}

/** 已安装且未被禁用的插件清单：name → installPath（enabledPlugins 只记显式覆盖，缺省即启用） */
function enabledPlugins(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    const disabled = new Set(
      Object.entries(
        JSON.parse(readFileSync(`${HOME}/.zcode/cli/config.json`, "utf8"))?.plugins?.enabledPlugins ?? {},
      ).filter(([, v]) => v === false).map(([k]) => k),
    );
    const installed = JSON.parse(readFileSync(`${HOME}/.zcode/cli/plugins/installed_plugins.json`, "utf8"));
    for (const p of installed.plugins ?? []) {
      if (!disabled.has(p.id) && p.installPath) m.set(p.name, p.installPath);
    }
  } catch {
    // 配置缺失时按空处理
  }
  return m;
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** 按宿主清单条目格式（`- 名称 (file: 路径)`，插件技能带前缀和别名）估算常驻注入字符量 */
function estimateListChars(items: DocEntry[], prefix: string | null): number {
  let sum = 0;
  for (const it of items) {
    const name = it.path.split("/").slice(-2, -1)[0] ?? "";
    const qualified = prefix ? `${prefix}:${name}` : name;
    const alias = prefix ? ` (also loadable as ${name})` : "";
    sum += `- ${qualified}${alias} (file: ${it.path})`.length;
  }
  return sum;
}

export async function buildPromptComposition(db: UsageDb, sessionId: string): Promise<PromptComposition> {
  const out: PromptComposition = {
    scannedAt: Date.now(),
    sessionId,
    sessionDirectory: null,
    agentsMd: [],
    memory: [],
    skills: [],
    skillTotals: { injected: 0, chars: 0, listChars: 0 },
    mcpServers: [],
    mcpServersSeen: [],
    agentsFiles: [],
    injected: null,
    errors: [],
  };

  // 会话信息（工作区目录）
  try {
    const s = db.sessionInfo(sessionId);
    out.sessionDirectory = s?.directory ?? null;
  } catch (e) {
    out.errors.push(`会话信息: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 1) AGENTS.md 指令：用户全局 + 会话工作区项目级
  for (const p of [`${HOME}/.zcode/AGENTS.md`, out.sessionDirectory ? `${out.sessionDirectory}/AGENTS.md` : null, out.sessionDirectory ? `${out.sessionDirectory}/CLAUDE.md` : null]) {
    if (!p) continue;
    const d = safeStat(p);
    if (d) out.agentsMd.push(d);
  }

  // 2) 记忆：按项目目录扫描；尝试匹配当前会话
  try {
    const memRoot = `${HOME}/.zcode/cli/memories/projects`;
    if (existsSync(memRoot)) {
      const dirNameHint = out.sessionDirectory ? out.sessionDirectory.split("/").filter(Boolean).pop() : "";
      for (const proj of readdirSync(memRoot)) {
        const memDir = `${memRoot}/${proj}/memory`;
        if (!existsSync(memDir)) continue;
        const files = readdirSync(memDir).filter((f) => f.endsWith(".md"));
        let indexChars: number | null = null;
        let entries = 0;
        let total = 0;
        for (const f of files) {
          const s = readFileSync(`${memDir}/${f}`, "utf8");
          total += s.length;
          if (f === "MEMORY.md") {
            indexChars = s.length;
            entries = (s.match(/^- \[/gm) ?? []).length;
          }
        }
        out.memory.push({
          dirName: proj,
          matched: dirNameHint ? proj.startsWith(dirNameHint + "-") || proj === dirNameHint : false,
          indexChars,
          entries,
          files: files.length,
          totalChars: total,
        });
      }
    }
  } catch (e) {
    out.errors.push(`记忆扫描: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) 技能：用户级 / 已启用插件 / App 内置（同名插件覆盖内置）
  const plugins = enabledPlugins();
  try {
    const userItems: DocEntry[] = [];
    walkSkillMd(`${HOME}/.agents/skills`, userItems);
    if (userItems.length)
      out.skills.push({ group: "user", owner: "user", enabled: true, items: userItems, listChars: estimateListChars(userItems, null) });

    for (const [name, installPath] of plugins) {
      const items: DocEntry[] = [];
      walkSkillMd(`${installPath}/skills`, items);
      if (items.length)
        out.skills.push({ group: "plugin", owner: name, enabled: true, items, listChars: estimateListChars(items, name) });
    }

    const pluginNames = new Set(plugins.keys());
    if (BUNDLED_PACKAGES) {
      for (const pkg of readdirSync(BUNDLED_PACKAGES)) {
        const items: DocEntry[] = [];
        // 内置插件若在插件缓存有版本，实际注入的是缓存里的最新版本（实测规律）
        const base = pkg.replace(/-plugin$/, "");
        const cacheDir = `${HOME}/.zcode/cli/plugins/cache/zcode-plugins-official/${base}`;
        let scanDir = `${BUNDLED_PACKAGES}/${pkg}/skills`;
        let note = "";
        if (!pluginNames.has(base) && existsSync(cacheDir)) {
          const versions = readdirSync(cacheDir)
            .filter((v) => /^\d/.test(v))
            .sort(cmpVersion);
          if (versions.length) {
            scanDir = `${cacheDir}/${versions[versions.length - 1]}/skills`;
            note = `（注入缓存版 ${versions[versions.length - 1]}）`;
          }
        }
        walkSkillMd(scanDir, items);
        if (!items.length) continue;
        const overridden = pluginNames.has(base) ? base : undefined;
        const prefix = base === "bundled-skills" ? null : base;
        out.skills.push({
          group: "bundled",
          owner: pkg + note,
          enabled: !overridden,
          overriddenBy: overridden,
          items,
          listChars: estimateListChars(items, prefix),
        });
      }
    }
    const enabledGroups = out.skills.filter((g) => g.enabled);
    const all = enabledGroups.flatMap((g) => g.items);
    out.skillTotals = {
      injected: all.length,
      chars: all.reduce((a, b) => a + b.chars, 0),
      listChars: enabledGroups.reduce((a, g) => a + g.listChars, 0),
    };
  } catch (e) {
    out.errors.push(`技能扫描: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 4) MCP server：config.json（只取键名）+ 已启用插件 manifest 声明的
  try {
    const cfg = JSON.parse(readFileSync(`${HOME}/.zcode/cli/config.json`, "utf8"));
    for (const name of Object.keys(cfg?.mcp?.servers ?? {})) {
      out.mcpServers.push({ name, source: "config.json" });
    }
    for (const [name, installPath] of plugins) {
      try {
        const manifest = JSON.parse(readFileSync(`${installPath}/.zcode-plugin/plugin.json`, "utf8"));
        for (const s of Object.keys(manifest?.mcpServers ?? {})) {
          out.mcpServers.push({ name: s, source: `插件 ${name}` });
        }
      } catch {
        // 单个插件 manifest 读不了就跳过
      }
    }
  } catch (e) {
    out.errors.push(`MCP 扫描: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5) 用户/工作区级子代理定义文件
  for (const dir of [`${HOME}/.zcode/agents`, out.sessionDirectory ? `${out.sessionDirectory}/.zcode/agents` : null]) {
    if (!dir || !existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".md")) {
          const d = safeStat(`${dir}/${f}`);
          if (d) out.agentsFiles.push(d);
        }
      }
    } catch {
      // 忽略
    }
  }

  // 6) 本会话（含子会话）实际调用过的 MCP server（含 App 内置注入的）
  out.mcpServersSeen = db.mcpServersUsed(sessionId);

  // 6) 真实注入记录（model-io 头部，若尚未被滚动丢弃）
  out.injected = await readInjected(sessionId);
  return out;
}

async function readInjected(sessionId: string): Promise<InjectedInfo | null> {
  for (const dir of [`${HOME}/.zcode/cli/rollout`, `${HOME}/.zcode/cli/debug`]) {
    const f = `${dir}/model-io-${sessionId}.jsonl`;
    if (!existsSync(f)) continue;
    try {
      const rl = readline.createInterface({ input: readFileSyncStream(f), crlfDelay: Infinity });
      let consumed = 0;
      for await (const line of rl) {
        if (!line.trim() || consumed++ >= 5) break;
        const rec = JSON.parse(line);
        const req = rec?.request;
        const msgs = req?.messages ?? [];
        if (!msgs.length) continue;
        const first = msgs[0];
        const text = Array.isArray(first.content)
          ? first.content.map((b: { text?: string }) => b.text ?? "").join("\n")
          : String(first.content ?? "");
        if (!text.includes("AGENTS.md") && !text.includes("The following skills are available")) continue;
        const docs = [...new Set([...text.matchAll(/Contents of (\S+?\.md)/g)].map((m) => m[1]))];
        const skillPaths = [...text.matchAll(/file: (\/[^\)]+\/SKILL\.md)/g)].map((m) => m[1]);
        const dirCount = new Map<string, number>();
        for (const p of skillPaths) {
          const d = p.split("/").slice(0, -2).join("/");
          dirCount.set(d, (dirCount.get(d) ?? 0) + 1);
        }
        return {
          source: f,
          toolNames: req?.toolNames ?? [],
          docs,
          skillDirs: [...dirCount.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count),
          sections: sectionSpans(text),
        };
      }
      rl.close();
    } catch {
      // 解析失败继续试下一个目录
    }
  }
  return null;
}

function readFileSyncStream(path: string): NodeJS.ReadableStream {
  // 小工具：同步打开流给 readline
  const { createReadStream } = require("node:fs") as typeof import("node:fs");
  return createReadStream(path, { encoding: "utf8" });
}

/** 按已知标记把前导文本切块，估算各模块字符量 */
function sectionSpans(text: string): { name: string; chars: number }[] {
  const marks: [string, string][] = [
    ["AGENTS.md 指令", "Contents of "],
    ["记忆索引", "# Memory Index"],
    ["技能清单", "The following skills are available"],
    ["子代理类型", "Available agent types"],
    ["环境信息", "# Environment"],
    ["日期", "# currentDate"],
  ];
  const found = marks
    .map(([name, m]) => ({ name, i: text.indexOf(m) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  return found.map((x, k) => ({
    name: x.name,
    chars: k + 1 < found.length ? found[k + 1].i - x.i : Math.min(text.length - x.i, 40000),
  }));
}

export { tok as estimateTokens };
