import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { mapHeaders } from "./kit/columns.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { knockout, parseSide, roundRobin, standings, type Team } from "./bracket.ts";
import { fontsFor, svgToPng } from "./png.ts";
import { s } from "./util.ts";

export const NAME = "tournament-bracket";
export const VERSION = "0.1.0";
interface Meta { teams: Team[]; dupTeams: string[]; dupSeeds: number[]; extra: string[] }

const isKO = (p: Project) => s(p.settings.format) === "knockout";
const ptsOf = (p: Project): [number, number, number] => { const v = s(p.settings.points || "3,1,0").split(/[,，/\s]+/).map(Number); return [v[0] || 3, isNaN(v[1]) ? 1 : v[1], isNaN(v[2]) ? 0 : v[2]]; };

function parseScore(v: unknown) {
  const t = s(v);
  if (!t) return { empty: true as const };
  const m = /^(.+?)\s*[:：\-–比]\s*(.+)$/.exec(t);
  if (!m) return { bad: true as const };
  const a = parseSide(m[1]), b = parseSide(m[2]);
  if (!a || !b) return { bad: true as const };
  return { hg: a.g, ag: b.g, hp: a.p, ap: b.p };
}

function resolve(p: Project) {
  const ko = isKO(p), win = new Map<string, string>(), lose = new Map<string, string>();
  const names = new Set((p.meta as unknown as Meta).teams.map((t) => t.name));
  const label = (x: string) => (x.startsWith("W:") ? win.get(x.slice(2)) ?? `${x.slice(2)} 胜者` : x.startsWith("L:") ? lose.get(x.slice(2)) ?? `${x.slice(2)} 负者` : x);
  const decided = (x: string) => !x || (!x.startsWith("W:") && !x.startsWith("L:")) || (x.startsWith("W:") ? win.has(x.slice(2)) : lose.has(x.slice(2)));
  const out = p.rows.map((r, i) => {
    const hRaw = s(r.home), aRaw = s(r.away), home = label(hRaw), away = label(aRaw), sc = parseScore(r.score);
    const ready = decided(hRaw) && decided(aRaw);
    let winner = "", loser = "", state: "bye" | "played" | "open" | "bad" | "draw" | "waiting" = "open";
    if (ready && (!home || !away) && (home || away)) { winner = home || away; state = "bye"; }
    else if (!ready) state = "waiting";
    else if ("bad" in sc) state = "bad";
    else if (!("empty" in sc)) {
      state = "played";
      const hw = sc.hg !== sc.ag ? sc.hg > sc.ag : sc.hp !== undefined && sc.ap !== undefined && sc.hp !== sc.ap ? sc.hp > sc.ap : undefined;
      if (hw === undefined) { if (ko) state = "draw"; }
      else { winner = hw ? home : away; loser = hw ? away : home; }
    }
    if (winner) win.set(s(r.id), winner);
    if (loser) lose.set(s(r.id), loser);
    return { r, i, home, away, sc, state, winner, ready, known: (!home || names.has(home) || !decided(hRaw) || hRaw.startsWith("W:") || hRaw.startsWith("L:")) && (!away || names.has(away) || !decided(aRaw) || aRaw.startsWith("W:") || aRaw.startsWith("L:")) };
  });
  return out;
}

function dateOf(p: Project, round: number, own: string) {
  if (own) return own;
  const st = s(p.settings.start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(st)) return "";
  const d = new Date(`${st}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (round - 1) * (Number(p.settings.every) || 7));
  return d.toISOString().slice(0, 10);
}

const roundName = (p: Project, r: number) => {
  if (!isKO(p)) return `第${r}轮`;
  const last = Math.max(...p.rows.map((x) => Number(x.round) || 0)), left = last - r;
  return left === 0 ? "决赛" : left === 1 ? "半决赛" : left === 2 ? "1/4 决赛" : left === 3 ? "1/8 决赛" : `第${r}轮`;
};

function table(p: Project) {
  const res = resolve(p), teams = (p.meta as unknown as Meta).teams.map((t) => t.name);
  const played = res.filter((x) => x.state === "played" && !("empty" in x.sc) && !("bad" in x.sc)).map((x) => ({ home: x.home, away: x.away, hg: (x.sc as { hg: number }).hg, ag: (x.sc as { ag: number }).ag }));
  return { res, teams, ...standings(teams, played, ptsOf(p)), played };
}

function bracketSvg(p: Project, family = "sans-serif") {
  const { res, lines, teams, played } = table(p), title = s(p.settings.title) || "赛程";
  if (isKO(p)) {
    const rounds = Math.max(...res.map((x) => Number(x.r.round) || 1));
    const first = res.filter((x) => Number(x.r.round) === 1), BW = 200, BH = 54, GX = 60, GY = 22;
    const W = 40 + rounds * (BW + GX), H = 90 + first.length * (BH + GY);
    const pos = new Map<string, { x: number; y: number }>();
    const parts: string[] = [];
    for (let r = 1; r <= rounds; r++) {
      const ms = res.filter((x) => Number(x.r.round) === r && !s(x.r.home).startsWith("L:"));
      ms.forEach((x, k) => {
        let y: number;
        if (r === 1) y = 80 + k * (BH + GY);
        else { const a = pos.get(s(x.r.home).slice(2)), b = pos.get(s(x.r.away).slice(2)); y = a && b ? (a.y + b.y) / 2 : 80 + k * (BH + GY) * 2 ** (r - 1); }
        const xx = 20 + (r - 1) * (BW + GX);
        pos.set(s(x.r.id), { x: xx, y });
        if (r > 1) for (const c of [s(x.r.home).slice(2), s(x.r.away).slice(2)]) { const q = pos.get(c); if (q) parts.push(`<path d="M${q.x + BW} ${q.y + BH / 2} H${q.x + BW + GX / 2} V${y + BH / 2} H${xx}" fill="none" stroke="#9CA3AF" stroke-width="1.5"/>`); }
        const sc = x.sc as { hg?: number; ag?: number; hp?: number; ap?: number };
        const row = (name: string, g: number | undefined, pen: number | undefined, yy: number, won: boolean) => `<rect x="${xx}" y="${yy}" width="${BW}" height="${BH / 2}" fill="${won ? "#DCFCE7" : "#FFFFFF"}" stroke="#D1D5DB"/><text x="${xx + 8}" y="${yy + BH / 4 + 5}" font-size="14" font-weight="${won ? 700 : 400}" fill="${name ? "#111827" : "#9CA3AF"}">${esc(name || "轮空")}</text>${g !== undefined ? `<text x="${xx + BW - 8}" y="${yy + BH / 4 + 5}" font-size="14" font-weight="700" text-anchor="end">${g}${pen !== undefined ? ` (${pen})` : ""}</text>` : ""}`;
        parts.push(row(x.home, sc.hg, sc.hp, y, !!x.winner && x.winner === x.home), row(x.away, sc.ag, sc.ap, y + BH / 2, !!x.winner && x.winner === x.away));
        parts.push(`<text x="${xx}" y="${y - 4}" font-size="10" fill="#6B7280">${esc([s(x.r.id), dateOf(p, r, s(x.r.date)), s(x.r.venue)].filter(Boolean).join(" · "))}</text>`);
      });
      parts.push(`<text x="${20 + (r - 1) * (BW + GX) + BW / 2}" y="58" font-size="15" font-weight="700" text-anchor="middle" fill="#1D4ED8">${esc(roundName(p, r))}</text>`);
    }
    const fin = res.find((x) => Number(x.r.round) === rounds && !s(x.r.home).startsWith("L:"));
    const champ = fin?.winner ? `冠军：${fin.winner}` : "";
    const third = res.find((x) => s(x.r.home).startsWith("L:"));
    if (third) { const q = pos.get(fin ? s(fin.r.id) : "") ?? { x: 20 + (rounds - 1) * (BW + GX), y: 80 }; const y = q.y + BH + 60, xx = q.x; const sc = third.sc as { hg?: number; ag?: number }; parts.push(`<text x="${xx}" y="${y - 6}" font-size="12" font-weight="700" fill="#B45309">三四名决赛</text><rect x="${xx}" y="${y}" width="${BW}" height="${BH / 2}" fill="${third.winner === third.home && third.winner ? "#FEF3C7" : "#FFFFFF"}" stroke="#D1D5DB"/><text x="${xx + 8}" y="${y + 19}" font-size="14">${esc(third.home)}</text><text x="${xx + BW - 8}" y="${y + 19}" font-size="14" text-anchor="end">${sc.hg ?? ""}</text><rect x="${xx}" y="${y + BH / 2}" width="${BW}" height="${BH / 2}" fill="${third.winner === third.away && third.winner ? "#FEF3C7" : "#FFFFFF"}" stroke="#D1D5DB"/><text x="${xx + 8}" y="${y + BH / 2 + 19}" font-size="14">${esc(third.away)}</text><text x="${xx + BW - 8}" y="${y + BH / 2 + 19}" font-size="14" text-anchor="end">${sc.ag ?? ""}</text>`); }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.max(H, 260)}" viewBox="0 0 ${W} ${Math.max(H, 260)}" font-family="${esc(family)}"><rect width="100%" height="100%" fill="#F9FAFB"/><text x="20" y="32" font-size="22" font-weight="700">${esc(title)}</text>${champ ? `<text x="${W - 20}" y="32" font-size="18" font-weight="700" fill="#B45309" text-anchor="end">🏆 ${esc(champ)}</text>` : ""}${parts.join("")}</svg>`;
  }
  // 循环赛：积分榜 + 交叉表
  const cw = 64, nameW = 110, rh = 30, n = teams.length;
  const order = lines.map((l) => l.team);
  const W = 40 + nameW + n * cw + 8 * 52, H = 90 + (n + 1) * rh + 20;
  const parts: string[] = [];
  const X0 = 20, Y0 = 60;
  const heads = ["", ...order.map((_, i) => String(i + 1)), "场", "胜", "平", "负", "得", "失", "净", "积分"];
  heads.forEach((h, j) => { const x = j === 0 ? X0 : j <= n ? X0 + nameW + (j - 1) * cw : X0 + nameW + n * cw + (j - n - 1) * 52; const w = j === 0 ? nameW : j <= n ? cw : 52; parts.push(`<rect x="${x}" y="${Y0}" width="${w}" height="${rh}" fill="#E0E7FF" stroke="#C7D2FE"/><text x="${x + w / 2}" y="${Y0 + 20}" font-size="13" font-weight="700" text-anchor="middle">${esc(h)}</text>`); });
  order.forEach((t, i) => {
    const y = Y0 + (i + 1) * rh, l = lines[i];
    parts.push(`<rect x="${X0}" y="${y}" width="${nameW}" height="${rh}" fill="${i === 0 && l.p ? "#FEF3C7" : "#FFFFFF"}" stroke="#E5E7EB"/><text x="${X0 + 8}" y="${y + 20}" font-size="13" font-weight="700">${i + 1}. ${esc(t)}</text>`);
    order.forEach((u, j) => {
      const x = X0 + nameW + j * cw, m = played.filter((r) => (r.home === t && r.away === u) || (r.home === u && r.away === t)).map((r) => (r.home === t ? `${r.hg}:${r.ag}` : `${r.ag}:${r.hg}`)).join(" ");
      const won = m && m.split(" ").every((z) => +z.split(":")[0] > +z.split(":")[1]);
      parts.push(`<rect x="${x}" y="${y}" width="${cw}" height="${rh}" fill="${i === j ? "#E5E7EB" : won ? "#DCFCE7" : "#FFFFFF"}" stroke="#E5E7EB"/><text x="${x + cw / 2}" y="${y + 20}" font-size="12" text-anchor="middle">${esc(i === j ? "" : m)}</text>`);
    });
    [l.p, l.w, l.d, l.l, l.gf, l.ga, l.gf - l.ga, l.pts].forEach((v, k) => { const x = X0 + nameW + n * cw + k * 52; parts.push(`<rect x="${x}" y="${y}" width="52" height="${rh}" fill="#FFFFFF" stroke="#E5E7EB"/><text x="${x + 26}" y="${y + 20}" font-size="13" font-weight="${k === 7 ? 700 : 400}" text-anchor="middle">${v}</text>`); });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(family)}"><rect width="100%" height="100%" fill="#F9FAFB"/><text x="20" y="36" font-size="22" font-weight="700">${esc(title)}</text>${parts.join("")}</svg>`;
}

function generate(p: Project, teams: Team[], prev?: Row[]): Row[] {
  const ms = s(p.settings.format) === "knockout" ? knockout(teams, s(p.settings.third) !== "false" && p.settings.third !== false) : roundRobin(teams.map((t) => t.name), p.settings.double === true);
  const key = (r: { home: unknown; away: unknown; round?: unknown }) => `${s(r.round)}|${s(r.home)}|${s(r.away)}`;
  const old = new Map((prev ?? []).map((r) => [key(r as { home: unknown; away: unknown; round?: unknown }), r]));
  return ms.map((m) => { const o = old.get(key(m)); return { id: m.id, round: m.round, home: m.home, away: m.away, score: s(o?.score), date: s(o?.date), venue: s(o?.venue), note: s(o?.note) }; });
}

function makeDef(assetRoot: string): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "bracket",
    title: ["赛程对阵", "Tournament Bracket"],
    openDescription:
      "Make a round-robin or knockout schedule from a team list, enter scores and get standings or the bracket. Pick a .csv/.xlsx with 队名/team (and optional 种子/seed), or a folder with that plus an optional results sheet (主队/home, 客队/away, 比分/score like 21:15). Settings: format (roundrobin / knockout; changing it rebuilds the schedule), double (home and away), third (3rd-place match in knockout), points (win,draw,loss, default 3,1,0), start (YYYY-MM-DD of round 1) and every (days between rounds) to date the rounds, title. Rows are matches: id, round, home, away (knockout later rounds hold “W:M1” = winner of M1, shown resolved), score (“21:15”; knockout draws need a decider like “2(4):2(3)”), date (overrides the round date), venue, note. Seeds go to standard bracket positions and byes go to the top seeds. Round-robin standings rank by points, then head-to-head, goal/point difference, scored. Checks: unreadable scores, knockout draws without a decider, scores for matches whose teams aren't known yet, unknown or duplicate team names, duplicate seeds, a team playing twice on one date, results that match no fixture, unresolved ties. Exports standings.xlsx (standings, matches, cross table), bracket.svg / bracket.png (the bracket or the standings table) and schedule.pdf (printable fixtures by round with score boxes).",
    inputs: { exts: [".csv", ".xlsx"], min: 1, max: 2, folders: true, label: ["选择参赛队名单", "Pick the team list"] },
    settings: [
      { key: "title", label: ["赛事名称", "Title"], type: "text", default: "" },
      { key: "format", label: ["赛制", "Format"], type: "select", default: "roundrobin", options: [{ value: "roundrobin", label: ["单循环", "Round robin"] }, { value: "knockout", label: ["淘汰赛", "Knockout"] }], reload: true },
      { key: "double", label: ["双循环（主客场）", "Double round robin"], type: "bool", default: false, reload: true },
      { key: "third", label: ["淘汰赛加三四名决赛", "3rd-place match"], type: "bool", default: true, reload: true },
      { key: "points", label: ["积分（胜,平,负）", "Points (win,draw,loss)"], type: "text", default: "3,1,0" },
      { key: "start", label: ["第一轮日期（YYYY-MM-DD）", "Round 1 date"], type: "text", default: "" },
      { key: "every", label: ["每轮间隔天数", "Days between rounds"], type: "number", default: 7, min: 0, max: 60 },
    ],
    columns: () => [
      { key: "id", label: ["场次", "Match"], readOnly: true },
      { key: "round", label: ["轮次", "Round"], type: "number", readOnly: true },
      { key: "_home", label: ["主/上", "Home"], readOnly: true },
      { key: "score", label: ["比分", "Score"] },
      { key: "_away", label: ["客/下", "Away"], readOnly: true },
      { key: "_date", label: ["日期", "Date"], readOnly: true },
      { key: "date", label: ["改日期", "Date override"], type: "date" },
      { key: "venue", label: ["场地", "Venue"] },
      { key: "_winner", label: ["胜者", "Winner"], readOnly: true },
      { key: "note", label: ["备注", "Note"] },
    ] as Column[],
    async load({ ws, files, settings, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (/\.(csv|xlsx)$/i.test(f)) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [".csv", ".xlsx"], limit: 50 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/"));
      let teamFile = "", resFile = "";
      for (const f of all) { const t = await readTable(ws, f); const h = mapHeaders(t.columns, { home: ["主队", "主场", "队伍a", "甲方", "home"], score: ["比分", "score", "result"] }); if (h.home && h.score) resFile ||= f; else teamFile ||= f; }
      if (!teamFile) throw new KitError("no_teams", "No team list found (.csv/.xlsx with a 队名/team column).");
      const t = await readTable(ws, teamFile);
      const h = mapHeaders(t.columns, { name: ["队名", "队伍", "参赛队", "球队", "选手", "姓名", "team", "name", "player"], seed: ["种子", "种子号", "seed"] });
      const col = h.name ?? t.columns[0];
      const raw = t.rows.map((r) => ({ name: s(r[col]), seed: Number(s(h.seed && r[h.seed])) || 0 })).filter((x) => x.name);
      const seen = new Set<string>(), dupTeams: string[] = [], teams: Team[] = [];
      for (const x of raw) { if (seen.has(x.name)) { dupTeams.push(x.name); continue; } seen.add(x.name); teams.push(x); }
      const seeds = teams.filter((x) => x.seed).map((x) => x.seed), dupSeeds = [...new Set(seeds.filter((v, i) => seeds.indexOf(v) !== i))];
      let next = Math.max(0, ...seeds); for (const x of teams) if (!x.seed) x.seed = ++next + 1000;
      if (teams.length < 2) throw new KitError("few_teams", "Need at least 2 teams.");
      const fake = { name: "", inputs: files, settings, rows: [], meta: {} } as unknown as Project;
      const rows = generate(fake, teams, previous);
      const extra: string[] = [];
      if (resFile && !previous?.some((r) => s(r.score))) {
        const rt = await readTable(ws, resFile);
        const rh = mapHeaders(rt.columns, { home: ["主队", "主场", "队伍a", "甲方", "home"], away: ["客队", "客场", "队伍b", "乙方", "away"], score: ["比分", "score", "result"] });
        for (const r of rt.rows) {
          const a = s(r[rh.home!]), b = s(rh.away && r[rh.away]), sc = s(r[rh.score!]);
          if (!a || !sc) continue;
          const m = rows.find((x) => (s(x.home) === a && s(x.away) === b)) ?? rows.find((x) => s(x.home) === b && s(x.away) === a);
          if (!m) { extra.push(`${a} vs ${b} ${sc}`); continue; }
          m.score = s(m.home) === a ? sc : sc.split(/[:：\-–比]/).reverse().join(":");
        }
      }
      return { rows, meta: { teams, dupTeams, dupSeeds, extra } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const m = p.meta as unknown as Meta, issues: Issue[] = [], ko = isKO(p), { res, lines, tie } = table(p);
      for (const d of m.dupTeams) issues.push({ level: "warn", message: `“${d}” is listed twice in the team list — counted once.` });
      for (const d of m.dupSeeds) issues.push({ level: "warn", message: `Seed ${d} is given to more than one team (${m.teams.filter((t) => t.seed === d).map((t) => t.name).join("、")}).` });
      for (const e of m.extra) issues.push({ level: "warn", message: `Result “${e}” doesn't match any fixture — check the team names.` });
      const onDate = new Map<string, number>();
      for (const x of res) {
        if (x.state === "bad") issues.push({ level: "error", row: x.i, key: "score", message: `${s(x.r.id)} ${x.home} vs ${x.away}: can't read score “${s(x.r.score)}” — write it like 21:15${ko ? " or 2(4):2(3)" : ""}.` });
        if (x.state === "draw") issues.push({ level: "error", row: x.i, key: "score", message: `${s(x.r.id)} ${x.home} vs ${x.away} is a draw (${s(x.r.score)}) but a knockout needs a winner — add the decider, e.g. ${s(x.r.score).replace(/(\d+)\s*[:：]\s*(\d+)/, "$1(4):$2(3)")}.` });
        if (x.state === "waiting" && s(x.r.score)) issues.push({ level: "error", row: x.i, key: "score", message: `${s(x.r.id)} has a score but its teams aren't decided yet (${x.home} vs ${x.away}) — enter the earlier rounds first.` });
        if (!x.known) issues.push({ level: "error", row: x.i, message: `${s(x.r.id)}: ${x.home} / ${x.away} isn't in the team list.` });
        const d = dateOf(p, Number(x.r.round), s(x.r.date));
        if (d && s(x.r.date) && x.state !== "bye") for (const t of [x.home, x.away]) { const k = `${t}@${d}`; if (onDate.has(k)) issues.push({ level: "warn", row: x.i, key: "date", message: `${t} plays twice on ${d} (${s(p.rows[onDate.get(k)!].id)} and ${s(x.r.id)}).` }); onDate.set(k, x.i); }
        else if (d && x.state !== "bye") for (const t of [x.home, x.away]) onDate.set(`${t}@${d}`, x.i);
      }
      if (!ko) for (const t of tie) issues.push({ level: "info", message: `${t} are level on points, head-to-head, difference and scored — decide by lot or a play-off.` });
      const left = res.filter((x) => x.state === "open" || x.state === "waiting").length;
      const rows = res.map((x) => ({ ...x.r, _home: x.home || "轮空", _away: x.away || "轮空", _date: dateOf(p, Number(x.r.round), s(x.r.date)), _winner: x.state === "bye" ? `${x.winner}（轮空晋级）` : x.winner }));
      const rounds = Math.max(...p.rows.map((r) => Number(r.round) || 0));
      const fin = res.find((x) => Number(x.r.round) === rounds && !s(x.r.home).startsWith("L:"));
      const head = ko ? (fin?.winner ? `Champion: ${fin.winner}.` : `${rounds} rounds, ${res.filter((x) => x.state === "bye").length} bye(s).`) : `Standings: ${lines.slice(0, 4).map((l, i) => `${i + 1}. ${l.team} ${l.pts}`).join(", ")}${lines.length > 4 ? "…" : ""}.`;
      return {
        rows,
        issues,
        summary: `${s(p.settings.title) || "Tournament"}: ${m.teams.length} teams, ${ko ? "knockout" : p.settings.double === true ? "double round robin" : "round robin"}, ${p.rows.length} matches (${res.filter((x) => x.state === "played").length} played, ${left} to play). ${head}`,
        stats: { teams: m.teams.length, matches: p.rows.length, played: res.filter((x) => x.state === "played").length },
        preview: bracketSvg(p).replace(/^<svg /, `<svg style="max-width:100%;height:auto" `),
      };
    },
    exports: [
      { id: "xlsx", label: ["积分榜 Excel", "Standings (Excel)"], description: "standings.xlsx", async run(ctx: ExportCtx) {
        const p = ctx.project, { res, lines, teams, played } = table(p);
        const sheets = [
          { name: "积分榜", headers: ["名次", "队伍", "场", "胜", "平", "负", "得分", "失分", "净胜", "积分"], rows: lines.map((l, i) => [i + 1, l.team, l.p, l.w, l.d, l.l, l.gf, l.ga, l.gf - l.ga, l.pts]) },
          { name: "赛程", headers: ["场次", "轮次", "日期", "主/上", "比分", "客/下", "场地", "胜者", "备注"], rows: res.map((x) => [s(x.r.id), roundName(p, Number(x.r.round)), dateOf(p, Number(x.r.round), s(x.r.date)), x.home || "轮空", s(x.r.score), x.away || "轮空", s(x.r.venue), x.winner, s(x.r.note)]) },
          ...(isKO(p) ? [] : [{ name: "交叉表", headers: ["", ...teams], rows: teams.map((t) => [t, ...teams.map((u) => (t === u ? "—" : played.filter((r) => (r.home === t && r.away === u) || (r.home === u && r.away === t)).map((r) => (r.home === t ? `${r.hg}:${r.ag}` : `${r.ag}:${r.hg}`)).join(" ")))]) }]),
        ];
        if (isKO(p)) sheets.shift();
        return [await ctx.write("standings.xlsx", await writeXlsx(sheets))];
      } },
      { id: "svg", label: ["对阵图 SVG", "Bracket (SVG)"], description: "bracket.svg", async run(ctx: ExportCtx) { return [await ctx.write("bracket.svg", bracketSvg(ctx.project))]; } },
      { id: "png", label: ["对阵图 PNG", "Bracket (PNG)"], description: "bracket.png", async run(ctx: ExportCtx) { const f = await fontsFor(assetRoot, "TOURNAMENT_FONT"); const svg = bracketSvg(ctx.project, f.family); return [await ctx.write("bracket.png", await svgToPng(assetRoot, svg.replace("🏆 ", ""), undefined, "TOURNAMENT_FONT"))]; } },
      { id: "pdf", label: ["赛程表 PDF", "Schedule (PDF)"], description: "schedule.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { res } = table(p), k = await newPdf(), [W, H] = PAGE.A4;
        let pg = k.doc.addPage([W, H]), y = H - 56;
        k.text(pg, s(p.settings.title) || "赛程表", W / 2, y, { size: 18, bold: true, align: "center" }); y -= 30;
        const rounds = [...new Set(res.map((x) => Number(x.r.round)))].sort((a, b) => a - b);
        for (const r of rounds) {
          const ms = res.filter((x) => Number(x.r.round) === r && x.state !== "bye");
          if (!ms.length) continue;
          if (y < 120) { pg = k.doc.addPage([W, H]); y = H - 56; }
          k.text(pg, `${roundName(p, r)}${dateOf(p, r, "") ? `  ·  ${dateOf(p, r, "")}` : ""}`, 48, y, { size: 12, bold: true, color: "#1D4ED8" }); y -= 20;
          for (const x of ms) {
            if (y < 60) { pg = k.doc.addPage([W, H]); y = H - 56; }
            k.text(pg, s(x.r.id), 48, y, { size: 9, color: "#6B7280" });
            k.text(pg, x.home, 250, y, { size: 11, align: "right", bold: x.winner === x.home && !!x.winner });
            pg.drawRectangle({ x: 262, y: y - 5, width: 30, height: 18, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.7 }); pg.drawRectangle({ x: 302, y: y - 5, width: 30, height: 18, borderColor: hexRgb("#9CA3AF"), borderWidth: 0.7 });
            const sc = x.sc as { hg?: number; ag?: number };
            if (sc.hg !== undefined) { k.text(pg, String(sc.hg), 277, y, { size: 11, align: "center" }); k.text(pg, String(sc.ag), 317, y, { size: 11, align: "center" }); }
            k.text(pg, x.away, 344, y, { size: 11, bold: x.winner === x.away && !!x.winner });
            k.text(pg, [s(x.r.date) || "", s(x.r.venue)].filter(Boolean).join(" · "), W - 48, y, { size: 9, align: "right", color: "#6B7280" });
            y -= 22;
          }
          y -= 8;
        }
        return [await ctx.write("schedule.pdf", await k.doc.save())];
      } },
    ],
    describeRow: (r, i) => `#${i} ${s(r.id)} R${s(r.round)} ${s(r._home)} ${s(r.score) || "vs"} ${s(r._away)}${s(r._date) ? ` ${s(r._date)}` : ""}${s(r._winner) ? ` → ${s(r._winner)}` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(options.assetRoot), options).server;
}
