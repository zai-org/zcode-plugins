import { createApp, esc, type AppDef, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders, num } from "./kit/columns.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { drawGroups, drawRaffle, inputHash, newSeed, parsePrizes, type Entrant } from "./draw.ts";

export const NAME = "raffle-draw";
export const VERSION = "0.1.0";

const s = (v: unknown) => String(v ?? "").trim();
const yes = (v: unknown) => /^(1|y|yes|true|是|√|✓|x|排除|不参与|已中奖)$/i.test(s(v));
const entrantsOf = (p: Project): Entrant[] => p.rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include !== false).map(({ r, i }) => ({ id: i, name: s(r.name), weight: Math.max(0, Number(r.weight) || 0), fixed: s(r.fixed), tag: s(r.tag) || "—" }));
const groupName = (k: number, st: Record<string, unknown>) => { const names = s(st.groupNames).split(/[,，、\s]+/).filter(Boolean); return names[k] ?? `第${k + 1}组`; };

function run(p: Project) {
  const st = p.settings;
  const seed = s(st.seed);
  const entrants = entrantsOf(p);
  if (s(st.mode) === "groups") {
    const count = s(st.groupBy) === "size" ? Math.ceil(entrants.length / Math.max(1, Number(st.groupSize) || 1)) : Math.max(1, Number(st.groups) || 1);
    const g = drawGroups(entrants, count, seed, st.balance !== false);
    return { mode: "groups" as const, entrants, seed, groups: g, count: g.sizes.length };
  }
  const prizes = parsePrizes(s(st.prizes));
  const ordered = s(st.order) === "reverse" ? [...prizes].reverse() : prizes;
  const r = drawRaffle(entrants, ordered, seed, { weighted: st.weighted !== false, repeat: st.repeat === true });
  return { mode: "raffle" as const, entrants, seed, prizes, ordered, raffle: r };
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "raffle",
  title: ["抽奖分组工具", "Raffle & Grouping"],
  openDescription:
    "Fair, reproducible lucky draws and random team splits from a participant list (CSV/XLSX with columns such as 姓名/name, 部门/department, 抽奖券/tickets or weight, 不参与/excluded). Every draw uses a published seed and SHA-256 based random numbers, so anyone with the same list and seed gets the same result; an audit log records each step. Raffle mode: prizes like “一等奖×1, 二等奖×3, 三等奖×5”, weighted by tickets or equal, drawn in listed or reverse order, one prize per person or repeats allowed; fix a winner by typing the prize in their row and re-draw the rest with a new seed. Group mode: N groups or groups of size N, balanced by a column such as department.",
  inputs: { exts: [".csv", ".xlsx", ".tsv"], min: 1, max: 1, label: ["选择参与者名单", "Pick the participant list"] },
  settings: [
    { key: "mode", label: ["模式", "Mode"], type: "select", default: "raffle", options: [{ value: "raffle", label: ["抽奖", "Raffle"] }, { value: "groups", label: ["随机分组", "Random groups"] }] },
    { key: "seed", label: ["随机种子（改一下即重新抽）", "Seed (change it to re-draw)"], type: "text", default: "" },
    { key: "prizes", label: ["奖项（如 一等奖×1, 二等奖×3）", "Prizes (e.g. 1st×1, 2nd×3)"], type: "text", default: "一等奖×1, 二等奖×3, 三等奖×5" },
    { key: "order", label: ["抽奖顺序", "Draw order"], type: "select", default: "reverse", options: [{ value: "reverse", label: ["先抽小奖", "Smallest prize first"] }, { value: "listed", label: ["按列出顺序", "As listed"] }] },
    { key: "weighted", label: ["按抽奖券数加权", "Weight by tickets"], type: "bool", default: true },
    { key: "repeat", label: ["允许一人中多个奖", "Allow more than one prize per person"], type: "bool", default: false },
    { key: "groupBy", label: ["分组方式", "Split into"], type: "select", default: "count", options: [{ value: "count", label: ["指定组数", "N groups"] }, { value: "size", label: ["指定每组人数", "Groups of N"] }] },
    { key: "groups", label: ["组数", "Number of groups"], type: "number", default: 4 },
    { key: "groupSize", label: ["每组人数", "Group size"], type: "number", default: 5 },
    { key: "balance", label: ["按“均衡列”平均分配", "Balance by the balance column"], type: "bool", default: true },
    { key: "groupNames", label: ["组名（可选，逗号分隔）", "Group names (optional, comma separated)"], type: "text", default: "" },
    { key: "title", label: ["活动名称", "Event title"], type: "text", default: "" },
  ],
  columns: () => [
    { key: "include", label: ["参与", "In"], type: "bool" },
    { key: "name", label: ["姓名", "Name"] },
    { key: "tag", label: ["均衡列（部门等）", "Balance by (dept…)"] },
    { key: "weight", label: ["抽奖券", "Tickets"], type: "number" },
    { key: "fixed", label: ["锁定奖项", "Locked prize"] },
    { key: "result", label: ["结果", "Result"], readOnly: true },
  ],
  newRow: () => ({ include: true, name: "", tag: "", weight: 1, fixed: "", result: "" }),
  async load({ ws, files, settings }) {
    const t = await readTable(ws, files[0]);
    const m = mapHeaders(t.columns, { name: ["姓名", "名字", "name", "participant", "昵称"], tag: ["部门", "组别", "department", "dept", "team", "性别", "gender", "class", "班级"], weight: ["抽奖券", "券数", "权重", "次数", "tickets", "weight", "entries"], exclude: ["不参与", "排除", "已中奖", "exclude", "excluded"], id: ["工号", "编号", "id", "学号"] });
    if (!m.name) throw new KitError("no_name_column", `Couldn't find a name column (姓名/name). Columns: ${t.columns.join(", ")}`);
    const seen = new Map<string, number>();
    const rows: Row[] = t.rows.filter((r) => s(r[m.name!])).map((r) => {
      let name = s(r[m.name!]);
      const id = m.id ? s(r[m.id]) : "";
      const c = (seen.get(name) ?? 0) + 1; seen.set(name, c);
      if (c > 1) name = id ? `${name}（${id}）` : `${name}（${c}）`;
      return { include: !(m.exclude && yes(r[m.exclude])), name, tag: m.tag ? s(r[m.tag]) : "", weight: m.weight ? Math.max(0, num(r[m.weight]) || 0) : 1, fixed: "", result: "" };
    });
    if (!s(settings.seed)) settings.seed = newSeed();
    return { rows, meta: { file: files[0] } };
  },
  compute(p) {
    const issues: Issue[] = [];
    const res = run(p);
    const rows = p.rows.map((r) => ({ ...r, result: "" }));
    let summary = "";
    let preview = "";
    const stats: Record<string, number> = { participants: res.entrants.length };
    if (res.mode === "raffle") {
      const names = new Set(res.prizes.map((x) => x.name));
      p.rows.forEach((r, i) => { if (s(r.fixed) && !names.has(s(r.fixed))) issues.push({ level: "warn", row: i, key: "fixed", message: `${r.name}: “${r.fixed}” isn't one of the prizes.` }); });
      for (const x of res.prizes) { const f = p.rows.filter((r) => r.include !== false && s(r.fixed) === x.name).length; if (f > x.count) issues.push({ level: "error", message: `${x.name}: ${f} people locked but only ${x.count} prize(s).` }); }
      if (!res.prizes.length) issues.push({ level: "error", key: "prizes", message: "No prizes set (settings → prizes)." });
      for (const sh of res.raffle.short) issues.push({ level: "warn", message: `${sh.prize}: not enough people left — ${sh.missing} prize(s) not drawn.` });
      p.rows.forEach((r, i) => { if (r.include !== false && !(Number(r.weight) > 0) && !s(r.fixed)) issues.push({ level: "info", row: i, key: "weight", message: `${r.name} has 0 tickets and can't win.` }); });
      for (const [id, prizes] of res.raffle.result) rows[id].result = prizes.join("、");
      const winners = res.raffle.result.size;
      stats.winners = winners; stats.prizes = res.prizes.reduce((a, x) => a + x.count, 0);
      summary = `${winners} winners from ${res.entrants.length} people · seed ${res.seed}`;
      preview = `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${res.prizes.map((x) => { const list = [...res.raffle.result].filter(([, ps]) => ps.includes(x.name)).map(([id]) => p.rows[id]); return `<div style="margin:0 0 12px"><div style="font-weight:700;color:#b91c1c;margin-bottom:6px">🎁 ${esc(x.name)} · ${list.length}/${x.count}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${list.map((r) => `<span style="background:#fef2f2;border:1px solid #fecaca;border-radius:999px;padding:3px 12px">${esc(s(r.name))}${s(r.tag) ? ` <small style="color:#6b7280">${esc(s(r.tag))}</small>` : ""}${s(r.fixed) ? " 🔒" : ""}</span>`).join("")}</div></div>`; }).join("")}<div style="color:#6b7280;font-size:12px">种子 seed: <code>${esc(res.seed)}</code></div></div>`;
    } else {
      const { group, sizes } = res.groups;
      for (const [id, k] of group) rows[id].result = groupName(k, p.settings);
      stats.groups = sizes.length;
      summary = `${res.entrants.length} people in ${sizes.length} groups · seed ${res.seed}`;
      const tags = [...new Set(res.entrants.map((e) => e.tag))];
      preview = `<div style="display:flex;flex-wrap:wrap;gap:10px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">${sizes.map((n, k) => { const mem = res.entrants.filter((e) => group.get(e.id) === k); return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;min-width:150px"><div style="font-weight:700;margin-bottom:4px">${esc(groupName(k, p.settings))} · ${n}</div>${tags.length > 1 ? `<div style="font-size:11px;color:#6b7280;margin-bottom:4px">${tags.map((t) => `${esc(t)} ${mem.filter((e) => e.tag === t).length}`).join(" · ")}</div>` : ""}${mem.map((e) => `<div style="font-size:13px">${esc(e.name)}</div>`).join("")}</div>`; }).join("")}</div>`;
      if (sizes.some((n) => n === 0)) issues.push({ level: "warn", message: "Some groups are empty — fewer people than groups." });
    }
    if (!s(p.settings.seed)) issues.push({ level: "error", key: "seed", message: "No seed set." });
    return { rows, issues, preview, summary, stats };
  },
  exports: [
    {
      id: "xlsx", label: ["结果表 Excel", "Result workbook"], description: "result.xlsx — winners by prize (or groups) plus everyone's result",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const res = run(project);
        const all = { name: "全部名单 Everyone", headers: ["姓名 Name", "均衡列 Tag", "抽奖券 Tickets", "参与 In", "结果 Result"], rows: (computed.rows ?? project.rows).map((r) => [s(r.name), s(r.tag), Number(r.weight) || 0, r.include !== false ? "✓" : "", s(r.result)]) };
        if (res.mode === "raffle") {
          const winners = res.raffle.steps.map((st) => [st.step, st.prize, st.winner, s(project.rows[st.id].tag), "", st.random]);
          const locked = res.entrants.filter((e) => e.fixed).map((e) => ["🔒", e.fixed, e.name, e.tag, "locked", ""]);
          return [await write("result.xlsx", await writeXlsx([{ name: "中奖名单 Winners", headers: ["序号 #", "奖项 Prize", "姓名 Name", "均衡列 Tag", "备注 Note", "随机数 Random"], rows: [...locked, ...winners] }, all]))];
        }
        const { group, sizes } = res.groups;
        const rows = sizes.flatMap((_, k) => res.entrants.filter((e) => group.get(e.id) === k).map((e, i) => [groupName(k, project.settings), i + 1, e.name, e.tag]));
        return [await write("result.xlsx", await writeXlsx([{ name: "分组 Groups", headers: ["组 Group", "序号 #", "姓名 Name", "均衡列 Tag"], rows }, all]))];
      },
    },
    {
      id: "audit", label: ["过程记录 JSON", "Audit log (JSON)"], description: "audit.json — seed, method, input fingerprint and every draw step, to reproduce or verify the result",
      async run({ project, write }: ExportCtx) {
        const res = run(project);
        const st = project.settings;
        const log = {
          tool: `${NAME} ${VERSION}`, title: s(st.title), mode: res.mode, seed: res.seed, createdAt: new Date().toISOString(),
          method: "random_i = first 8 bytes of SHA-256(seed + ':' + i) as an unsigned integer, top 53 bits / 2^53. Raffle: for each prize in order, pick the entrant whose cumulative weight range contains random × total weight (entrants in list order). Groups: Fisher–Yates shuffle with the same numbers, then fill the smallest group (balanced by the balance column).",
          input: { file: s(project.meta?.file), participants: res.entrants.length, sha256: inputHash(res.entrants), entrants: res.entrants.map((e) => ({ name: e.name, weight: e.weight, tag: e.tag, locked: e.fixed || undefined })) },
          settings: res.mode === "raffle" ? { prizes: res.ordered, weighted: st.weighted !== false, repeat: st.repeat === true } : { groups: res.count, balance: st.balance !== false },
          steps: res.mode === "raffle" ? res.raffle.steps : undefined,
          result: res.mode === "raffle" ? Object.fromEntries(res.prizes.map((x) => [x.name, [...res.raffle.result].filter(([, ps]) => ps.includes(x.name)).map(([id]) => s(project.rows[id].name))])) : Object.fromEntries(res.groups.sizes.map((_, k) => [groupName(k, st), res.entrants.filter((e) => res.groups.group.get(e.id) === k).map((e) => e.name)])),
        };
        return [await write("audit.json", JSON.stringify(log, null, 2))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
