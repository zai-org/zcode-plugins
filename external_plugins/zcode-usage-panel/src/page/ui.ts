// 面板渲染：静态骨架一次构建，动态区块按快照重绘。
// 不依赖框架；所有 DOM 手工构建，样式由外层 index.html 内联 CSS 提供。
import type { UsageSnapshot, ToolStat, ModelStat } from "../server/db.js";
import type { PromptComposition } from "../server/prompt.js";

export interface UiState {
  open: { tools: boolean; models: boolean; turns: boolean; prompt: boolean };
}

export interface UiCallbacks {
  onSessionChange(sessionId: string): void;
  onToggleState(next: UiState): void;
}

const SOURCE_LABEL: Record<string, string> = {
  main_turn: "主对话",
  subagent: "子代理",
  workflow_child: "工作流",
  session_title: "标题生成",
  compact: "压缩",
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === "class") el.className = String(v);
      else if (k === "text") el.textContent = String(v);
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2), v as EventListener);
      } else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function fmtTok(n: number): string {
  if (!isFinite(n)) return "-";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}
function fmtDur(ms: number | null): string {
  if (ms === null) return "-";
  if (ms >= 60000) return (ms / 60000).toFixed(1) + " 分";
  if (ms >= 1000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms) + "ms";
}
function fmtTps(v: number | null): string {
  return v === null ? "-" : v.toFixed(1);
}
function fmtBytes(n: number): string {
  if (!n) return "—";
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + "KB";
  return n + "B";
}
function fmtTokEst(chars: number): string {
  return "≈" + fmtTok(chars / 3.2);
}
function fmtDate(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().slice(0, 10);
}
function fmtTime(ts: number | null): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

/** 一次性骨架；返回各动态容器引用 */
export function buildSkeleton(root: HTMLElement, state: UiState, cb: UiCallbacks) {
  root.replaceChildren();

  const sessionSelect = h("select", { id: "session-select", class: "session-select" });
  sessionSelect.addEventListener("change", () => {
    cb.onSessionChange(sessionSelect.value);
  });

  const statusDot = h("span", { class: "dot dot-off", id: "status-dot" });
  const statusText = h("span", { class: "status-text", id: "status-text", text: "连接中…" });

  root.append(
    h("header", { class: "head" },
      h("div", { class: "head-row" },
        h("span", { class: "brand", text: "用量面板" }),
        statusDot,
        statusText,
      ),
      sessionSelect,
      h("div", { class: "session-meta", id: "session-meta" }),
    ),
    h("div", { class: "banner", id: "error-banner", style: "display:none" }),
    h("div", { class: "cards", id: "summary-cards" }),
    h("div", { class: "tps-block", id: "tps-block" }),
    section("sec-prompt", "提示词构成", state.open.prompt, cb, (body) => { body.id = "prompt-body"; }),
    section("sec-tools", "工具明细", state.open.tools, cb, (body) => { body.id = "tools-body"; }),
    section("sec-models", "模型明细", state.open.models, cb, (body) => { body.id = "models-body"; }),
    section("sec-turns", "最近轮次", state.open.turns, cb, (body) => { body.id = "turns-body"; }),
    h("footer", { class: "foot" },
      "数据源：~/.zcode/cli/db/db.sqlite（只读）。token 按模型调用计；工具维度为调用次数/耗时占比。",
    ),
  );

  return {
    sessionSelect,
    statusDot,
    statusText,
    errorBanner: document.getElementById("error-banner")!,
    sessionMeta: document.getElementById("session-meta")!,
    summaryCards: document.getElementById("summary-cards")!,
    tpsBlock: document.getElementById("tps-block")!,
    promptBody: document.getElementById("prompt-body")!,
    toolsBody: document.getElementById("tools-body")!,
    modelsBody: document.getElementById("models-body")!,
    turnsBody: document.getElementById("turns-body")!,
  };
}

function section(
  id: string,
  title: string,
  open: boolean,
  cb: UiCallbacks,
  decorate: (body: HTMLElement) => void,
): HTMLElement {
  const body = h("div", { class: "sec-body" });
  const det = h("details", { class: "sec", id, open: open ? "" : null },
    h("summary", { class: "sec-summary" },
      h("span", { class: "arrow", text: "▸" }),
      title,
      h("span", { class: "sec-hint", id: `${id}-hint`, text: "" }),
    ),
    body,
  );
  det.addEventListener("toggle", () => {
    cb.onToggleState({
      ...stateFromDetails(),
    });
    function stateFromDetails(): UiState {
      return {
        open: {
          prompt: (document.getElementById("sec-prompt") as HTMLDetailsElement | null)?.open ?? false,
          tools: (document.getElementById("sec-tools") as HTMLDetailsElement | null)?.open ?? false,
          models: (document.getElementById("sec-models") as HTMLDetailsElement | null)?.open ?? false,
          turns: (document.getElementById("sec-turns") as HTMLDetailsElement | null)?.open ?? false,
        },
      };
    }
  });
  decorate(body);
  return det;
}

export interface Containers {
  sessionSelect: HTMLSelectElement;
  statusDot: HTMLElement;
  statusText: HTMLElement;
  errorBanner: HTMLElement;
  sessionMeta: HTMLElement;
  summaryCards: HTMLElement;
  tpsBlock: HTMLElement;
  promptBody: HTMLElement;
  toolsBody: HTMLElement;
  modelsBody: HTMLElement;
  turnsBody: HTMLElement;
}

export function setStatus(c: Containers, kind: "live" | "poll" | "off" | "error", text: string): void {
  const dot = kind === "live" ? "dot dot-live" : kind === "poll" ? "dot dot-poll" : kind === "error" ? "dot dot-error" : "dot dot-off";
  c.statusDot.className = dot;
  c.statusText.textContent = text;
}

export function render(c: Containers, snap: UsageSnapshot): void {
  // 错误横幅
  const errs = snap.errors ?? [];
  if (errs.length > 0 || snap.totals === null) {
    c.errorBanner.style.display = "";
    c.errorBanner.replaceChildren(
      h("strong", { text: "数据读取异常：" }),
      h("span", { text: errs.join("；") || "未知错误" }),
    );
  } else {
    c.errorBanner.style.display = "none";
  }

  renderSessionSelect(c, snap);
  renderSummary(c, snap);
  renderTps(c, snap);
  renderTools(c, snap);
  renderModels(c, snap);
  renderTurns(c, snap);
}

function renderSessionSelect(c: Containers, snap: UsageSnapshot): void {
  const sel = c.sessionSelect;
  const prev = sel.value;
  sel.replaceChildren(
    h("option", { value: "", text: "跟随最新会话（自动）" }),
  );
  for (const s of snap.sessions) {
    const label = s.title ? s.title.slice(0, 40) : s.id.slice(0, 24);
    sel.append(h("option", { value: s.id, text: label }));
  }
  const wanted = snap.mode === "pinned" && snap.session ? snap.session.id : "";
  sel.value = [...sel.options].some((o) => o.value === wanted) ? wanted : prev || "";

  c.sessionMeta.replaceChildren();
  if (snap.session) {
    const dir = snap.session.directory ? snap.session.directory.split("/").slice(-2).join("/") : "";
    c.sessionMeta.append(
      h("span", { class: "meta-item", text: `${dir || "—"}` }),
      h("span", { class: "meta-item", text: `更新 ${fmtTime(snap.session.timeUpdated)}` }),
      h("span", { class: "meta-item", text: `${snap.mode === "auto" ? "自动" : "固定"}${snap.childSessionCount > 0 ? ` · 含 ${snap.childSessionCount} 个子会话` : ""}` }),
    );
  }
}

function renderSummary(c: Containers, snap: UsageSnapshot): void {
  const t = snap.totals;
  if (!t) {
    c.summaryCards.replaceChildren();
    return;
  }
  const running = snap.runningTools.map((r) => r.tool).join(", ");
  c.summaryCards.replaceChildren(
    card("总 tokens", fmtTok(t.totalTokens), `输入 ${fmtTok(t.inputTokens)} · 输出 ${fmtTok(t.outputTokens)}`),
    card("缓存读取", fmtTok(t.cacheReadTokens), `缓存写入 ${fmtTok(t.cacheWriteTokens)}`),
    card("模型调用", `${t.modelCalls} 次`, `完成 ${t.completedCalls} · 失败 ${t.errorCalls}`),
    card("平均 TPS", fmtTps(t.avgTpsGen), `端到端 ${fmtTps(t.avgTpsE2E)} tok/s`),
    card("当前 TPS", fmtTps(snap.currentTpsGen), `活跃 ${fmtDur(t.activeSeconds * 1000)}`),
    card("工具调用", `${snap.tools.reduce((a, x) => a + x.calls, 0)} 次`, running ? `运行中: ${running}` : "空闲"),
  );
}

function card(title: string, value: string, sub: string): HTMLElement {
  return h("div", { class: "card" },
    h("div", { class: "card-title", text: title }),
    h("div", { class: "card-value", text: value }),
    h("div", { class: "card-sub", text: sub }),
  );
}

function renderTps(c: Containers, snap: UsageSnapshot): void {
  const pts = snap.series.filter((p) => p.tpsGen !== null && p.tpsGen > 0);
  const svg = sparkline(snap.series.map((p) => p.tpsGen));
  const last = snap.series[snap.series.length - 1];
  c.tpsBlock.replaceChildren(
    h("div", { class: "tps-head" },
      h("span", { class: "tps-label", text: "生成段 TPS（最近 40 次模型调用）" }),
      h("span", { class: "tps-now", text: `${fmtTps(snap.currentTpsGen)} tok/s` }),
    ),
    svg,
    h("div", { class: "tps-foot" },
      last ? `最新：${last.model}${last.agent ? " · " + last.agent : ""} · 输出 ${fmtTok(last.output)} tok · ${SOURCE_LABEL[last.source] ?? last.source} · ${fmtTime(last.t)}` : "暂无调用",
      pts.length > 1 ? ` · 峰值 ${fmtTps(Math.max(...pts.map((p) => p.tpsGen!)))}` : "",
    ),
  );
}

function sparkline(values: (number | null)[]): SVGElement {
  const W = 320, H = 44, PAD = 2;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "spark");
  const max = Math.max(1, ...values.filter((v): v is number => v !== null && v > 0));
  const x = (i: number) => (values.length <= 1 ? W / 2 : (i / (values.length - 1)) * (W - PAD * 2) + PAD);
  const y = (v: number) => H - PAD - (Math.min(v, max) / max) * (H - PAD * 2);

  // 空值造成的断点拆成多段 polyline
  let seg: string[] = [];
  const segs: string[][] = [];
  values.forEach((v, i) => {
    if (v === null || v <= 0) {
      if (seg.length > 1) segs.push(seg);
      seg = [];
    } else {
      seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (seg.length > 1) segs.push(seg);
  for (const s of segs) {
    const pl = document.createElementNS(ns, "polyline");
    pl.setAttribute("points", s.join(" "));
    pl.setAttribute("class", "spark-line");
    svg.append(pl);
  }
  // 均值虚线
  const vals = values.filter((v): v is number => v !== null && v > 0);
  if (vals.length) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ln = document.createElementNS(ns, "line");
    ln.setAttribute("x1", "0"); ln.setAttribute("x2", String(W));
    ln.setAttribute("y1", y(avg).toFixed(1)); ln.setAttribute("y2", y(avg).toFixed(1));
    ln.setAttribute("class", "spark-avg");
    svg.append(ln);
  }
  return svg;
}

function bar(pct: number): HTMLElement {
  return h("div", { class: "bar" }, h("div", { class: "bar-in", style: `width:${Math.min(100, pct * 100).toFixed(1)}%` }));
}

function toolRow(t: ToolStat, totalCalls: number, totalMs: number): HTMLElement {
  const name = t.kind === "mcp" ? `${t.server}/${t.name}` : t.name;
  return h("tr", { class: t.errors > 0 ? "row-err" : null },
    h("td", { class: "td-name" },
      h("span", { class: `kind kind-${t.kind}`, text: t.kind === "mcp" ? "MCP" : t.kind === "skill" ? "SK" : "内" }),
      name,
      t.running > 0 ? h("span", { class: "running-pill", text: "运行中" }) : null,
    ),
    h("td", { class: "td-num" }, String(t.calls), h("div", { class: "bar", title: `次数占比 ${fmtPct(totalCalls ? t.calls / totalCalls : 0)}` }, h("div", { class: "bar-in", style: `width:${totalCalls ? Math.min(100, (t.calls / totalCalls) * 100).toFixed(1) : 0}%` }))),
    h("td", { class: "td-num", title: `耗时占比 ${fmtPct(totalMs ? t.totalMs / totalMs : 0)}`, text: fmtDur(t.totalMs) }),
    h("td", { class: "td-num", text: fmtDur(t.avgMs) }),
    h("td", { class: "td-num", title: "工具输出字节数（Skill 为按次数分摊的近似值）", text: fmtBytes(t.outBytes) }),
    h("td", { class: "td-num", text: t.errors > 0 ? String(t.errors) : "—" }),
    h("td", { class: "td-num dim", text: fmtTime(t.lastAt) }),
  );
}

function renderTools(c: Containers, snap: UsageSnapshot): void {
  const body = c.toolsBody;
  body.replaceChildren();
  const totalCalls = snap.tools.reduce((a, t) => a + t.calls, 0);
  const totalMs = snap.tools.reduce((a, t) => a + t.totalMs, 0);

  const groups: { key: ToolStat["kind"]; label: string }[] = [
    { key: "builtin", label: "内置工具" },
    { key: "mcp", label: "MCP 工具" },
    { key: "skill", label: "Skill" },
  ];
  let any = false;
  for (const g of groups) {
    const rows = snap.tools.filter((t) => t.kind === g.key);
    if (rows.length === 0) continue;
    any = true;
    const gc = rows.reduce((a, t) => a + t.calls, 0);
    const gm = rows.reduce((a, t) => a + t.totalMs, 0);
    body.append(
      h("div", { class: "grp" },
        h("div", { class: "grp-title" },
          h("strong", { text: g.label }),
          h("span", { class: "dim", text: ` · ${gc} 次 · ${fmtDur(gm)} · 占比 ${fmtPct(totalCalls ? gc / totalCalls : 0)}` }),
        ),
        h("table", { class: "tbl" },
          h("thead", null,
            h("tr", null,
              h("th", { text: "名称" }), h("th", { text: "次数" }), h("th", { text: "总耗时" }),
              h("th", { text: "平均" }), h("th", { text: "输出量" }), h("th", { text: "错误" }), h("th", { text: "最近" }),
            ),
          ),
          h("tbody", null, ...rows.map((t) => toolRow(t, totalCalls, totalMs))),
        ),
      ),
    );
  }
  if (!any) body.append(h("div", { class: "empty", text: "本会话暂无工具调用" }));
  const hint = document.getElementById("sec-tools-hint");
  if (hint) hint.textContent = `${totalCalls} 次`;
}

function renderModels(c: Containers, snap: UsageSnapshot): void {
  const body = c.modelsBody;
  body.replaceChildren();
  const ms: ModelStat[] = snap.models;
  if (ms.length === 0) {
    body.append(h("div", { class: "empty", text: "暂无模型调用" }));
    return;
  }
  const sumTotal = ms.reduce((a, m) => a + m.total, 0) || 1;
  body.append(
    h("table", { class: "tbl" },
      h("thead", null,
        h("tr", null,
          h("th", { text: "模型 / agent / 来源" }), h("th", { text: "调用" }),
          h("th", { text: "输入" }), h("th", { text: "输出" }), h("th", { text: "缓存读" }),
          h("th", { text: "总量占比" }), h("th", { text: "平均 TPS" }),
        ),
      ),
      h("tbody", null,
        ...ms.map((m) =>
          h("tr", null,
            h("td", { class: "td-name" },
              h("strong", { text: m.model }),
              h("div", { class: "dim sub", text: `${m.agent ?? "—"} · ${SOURCE_LABEL[m.source] ?? m.source}` }),
            ),
            h("td", { class: "td-num", text: String(m.calls) }),
            h("td", { class: "td-num", text: fmtTok(m.input) }),
            h("td", { class: "td-num", text: fmtTok(m.output) }),
            h("td", { class: "td-num", text: fmtTok(m.cacheRead) }),
            h("td", { class: "td-num" }, `${fmtPct(m.total / sumTotal)}`, bar(m.total / sumTotal)),
            h("td", { class: "td-num", text: fmtTps(m.avgTpsGen) }),
          ),
        ),
      ),
    ),
  );
}

export function renderPrompt(c: Containers, comp: PromptComposition): void {
  const body = c.promptBody;
  body.replaceChildren();
  if (comp.errors?.length) {
    body.append(h("div", { class: "banner", text: comp.errors.join("；") }));
  }
  const hint = document.getElementById("sec-prompt-hint");
  if (hint) hint.textContent = `${comp.skillTotals.injected} 技能 · ${comp.mcpServers.length} MCP`;

  // 真实注入记录（若 model-io 头部仍在）
  if (comp.injected) {
    body.append(
      h("div", { class: "grp" },
        h("div", { class: "grp-title" },
          h("strong", { text: "真实注入记录" }),
          h("span", { class: "dim", text: ` · 本会话早期捕获 · 工具 ${comp.injected.toolNames.length} 个` }),
        ),
        h("div", { class: "kv-list" },
          ...comp.injected.sections.map((s) =>
            h("div", { class: "kv" },
              h("span", { class: "kv-k", text: s.name }),
              h("span", { class: "kv-v", text: `${s.chars} 字符 ${fmtTokEst(s.chars)} tok` }),
            ),
          ),
          ...comp.injected.docs.map((d) =>
            h("div", { class: "kv" }, h("span", { class: "kv-k", text: "文档" }), h("span", { class: "kv-v", text: d })),
          ),
          ...comp.injected.skillDirs.slice(0, 8).map((d) =>
            h("div", { class: "kv" },
              h("span", { class: "kv-k", text: "技能目录" }),
              h("span", { class: "kv-v", text: `${d.dir}（${d.count} 个）` }),
            ),
          ),
        ),
      ),
    );
  }

  // AGENTS.md 指令
  body.append(
    h("div", { class: "grp" },
      h("div", { class: "grp-title" }, h("strong", { text: "AGENTS.md 指令" }),
        h("span", { class: "dim", text: comp.agentsMd.length ? ` · ${comp.agentsMd.length} 个文件 · 全文常驻` : " · 无" })),
      h("div", { class: "kv-list" },
        ...comp.agentsMd.map((d) =>
          h("div", { class: "kv" },
            h("span", { class: "kv-v mono", text: d.path }),
            h("span", { class: "kv-k", text: `${d.chars} 字符 ${fmtTokEst(d.chars)} tok · ${fmtDate(d.mtime)}` }),
          ),
        ),
      ),
    ),
  );

  // 记忆
  body.append(
    h("div", { class: "grp" },
      h("div", { class: "grp-title" }, h("strong", { text: "记忆 memory" }),
        h("span", { class: "dim", text: comp.memory.length ? " · 索引常驻，正文按需召回" : " · 无" })),
      h("div", { class: "kv-list" },
        ...comp.memory.map((m) =>
          h("div", { class: "kv" },
            h("span", { class: "kv-v mono", text: m.dirName + (m.matched ? " ← 当前项目" : "") }),
            h("span", { class: "kv-k", text: `索引 ${m.entries} 条（${m.indexChars ?? 0} 字符）· 正文 ${m.files - 1} 文件 ${fmtTok(m.totalChars - (m.indexChars ?? 0))} tok` }),
          ),
        ),
      ),
    ),
  );

  // 技能（用户级 / 插件 / 内置）
  const groupLabel: Record<string, string> = { user: "用户级技能", plugin: "插件技能", bundled: "App 内置技能" };
  for (const g of comp.skills) {
    const chars = g.items.reduce((a, b) => a + b.chars, 0);
    body.append(
      h("details", { class: "sub-sec" },
        h("summary", { class: "sub-summary" },
          h("span", { class: "arrow", text: "▸" }),
          `${groupLabel[g.group] ?? g.group}：${g.owner}`,
          h("span", { class: "dim", text: ` · ${g.items.length} 个 · 清单常驻 ≈${fmtTokEst(g.listChars)} tok · 全文 ${fmtTok(chars)} 字符${g.overriddenBy ? ` · 已被插件「${g.overriddenBy}」覆盖` : ""}` }),
        ),
        h("table", { class: "tbl" },
          h("thead", null, h("tr", null, h("th", { text: "技能" }), h("th", { text: "全文字符" }), h("th", { text: "≈token" }), h("th", { text: "修改" }))),
          h("tbody", null,
            ...[...g.items].sort((a, b) => b.chars - a.chars).map((it) =>
              h("tr", null,
                h("td", { class: "td-name mono", title: it.path, text: it.path.split("/").slice(-2, -1)[0] }),
                h("td", { class: "td-num", text: String(it.chars) }),
                h("td", { class: "td-num", text: fmtTokEst(it.chars) }),
                h("td", { class: "td-num dim", text: fmtDate(it.mtime) }),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // MCP server
  body.append(
    h("div", { class: "grp" },
      h("div", { class: "grp-title" }, h("strong", { text: "MCP server" }),
        h("span", { class: "dim", text: comp.mcpServers.length ? ` · 声明 ${comp.mcpServers.length} 个（工具 schema 注入提示词）` : " · 无声明" })),
      h("div", { class: "kv-list" },
        ...comp.mcpServers.map((s) =>
          h("div", { class: "kv" },
            h("span", { class: "kv-v mono", text: s.name }),
            h("span", { class: "kv-k", text: s.source }),
          ),
        ),
        ...(comp.mcpServersSeen?.length
          ? [h("div", { class: "kv" },
              h("span", { class: "kv-k", text: `本会话实际调用过 ${comp.mcpServersSeen.length} 个` }),
              h("span", { class: "kv-v mono", text: comp.mcpServersSeen.join(", ") }))]
          : []),
      ),
    ),
  );

  // 子代理定义
  body.append(
    h("div", { class: "grp" },
      h("div", { class: "grp-title" }, h("strong", { text: "子代理定义" }),
        h("span", { class: "dim", text: comp.agentsFiles.length ? ` · ${comp.agentsFiles.length} 个文件` : " · 无用户级定义（内置类型运行时注入）" })),
      h("div", { class: "kv-list" },
        ...comp.agentsFiles.map((d) =>
          h("div", { class: "kv" },
            h("span", { class: "kv-v mono", text: d.path }),
            h("span", { class: "kv-k", text: `${d.chars} 字符 · ${fmtDate(d.mtime)}` }),
          ),
        ),
      ),
    ),
  );

  // 技能汇总行
  body.append(
    h("div", { class: "grp" },
      h("div", { class: "grp-title" }, h("strong", { text: "技能清单合计" }),
        h("span", { class: "dim", text: ` · ${comp.skillTotals.injected} 个注入 · 清单常驻 ≈${fmtTokEst(comp.skillTotals.listChars)} tok · 全文 ${fmtTok(comp.skillTotals.chars)} 字符` })),
      h("div", { class: "empty", text: "清单条目仅含名称+文件路径（宿主格式）；SKILL.md 全文在调用该技能时才加载。" }),
    ),
  );

  body.append(h("div", { class: "empty", text: `扫描于 ${new Date(comp.scannedAt).toLocaleTimeString("zh-CN")}；清单常驻为按条目格式估算，≈token 为字符÷3.2 粗估。` }));
}

function renderTurns(c: Containers, snap: UsageSnapshot): void {
  const body = c.turnsBody;
  body.replaceChildren();
  if (snap.turns.length === 0) {
    body.append(h("div", { class: "empty", text: "暂无轮次" }));
    return;
  }
  body.append(
    h("table", { class: "tbl" },
      h("thead", null,
        h("tr", null,
          h("th", { text: "开始" }), h("th", { text: "总 tokens" }), h("th", { text: "输出" }),
          h("th", { text: "耗时" }), h("th", { text: "模型" }), h("th", { text: "工具" }), h("th", { text: "状态" }),
        ),
      ),
      h("tbody", null,
        ...snap.turns.map((t) =>
          h("tr", null,
            h("td", { class: "td-num", text: fmtTime(t.startedAt) }),
            h("td", { class: "td-num", text: fmtTok(t.totalTokens) }),
            h("td", { class: "td-num", text: fmtTok(t.outputTokens) }),
            h("td", { class: "td-num", text: fmtDur(t.durationMs) }),
            h("td", { class: "td-num", text: String(t.modelRequests) }),
            h("td", { class: "td-num", text: String(t.toolCalls) }),
            h("td", { class: "td-num", text: t.status === "completed" ? "完成" : t.status === "running" ? "进行中" : t.status }),
          ),
        ),
      ),
    ),
  );
}
