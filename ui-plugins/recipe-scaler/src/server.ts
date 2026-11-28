import { createApp, esc, type AppDef, type Column, type Computed, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { hexRgb, newPdf, PAGE } from "./kit/pdf.ts";
import { KitError } from "./kit/workspace.ts";
import { aisleOf, AISLES, formatBase, hasCJK, nice, parseRecipe, qtyValue, roundCount, stepMinutes, unitOf, type Recipe } from "./recipe.ts";
import { s } from "./util.ts";

export const NAME = "recipe-scaler";
export const VERSION = "0.1.0";

type System = "keep" | "metric" | "us";
interface Meta { recipes: Recipe[] }
interface Line { i: number; recipe: string; item: string; text: string; scalable: boolean; mass?: number; vol?: number; count?: { n: number; unit: string }; free?: string; aisle: string }

const ALIAS: [RegExp, string][] = [[/^(鸡蛋|蛋|eggs?|large eggs?)$/i, "鸡蛋"], [/^(西红柿|番茄|tomato(es)?)$/i, "番茄"], [/^(葱|小葱|香葱)$/, "葱"], [/^(白糖|砂糖|白砂糖)$/, "白糖"]];
const key = (item: string) => { const t = item.trim().toLowerCase().replace(/\s+/g, " "); return ALIAS.find(([re]) => re.test(t))?.[1] ?? t; };
const cores = (item: string) => (hasCJK(item) ? [item, item.slice(0, 2), ...(item.length <= 4 ? [item.slice(-1)] : [])] : [item.toLowerCase(), core(item)]);
const core = (item: string) => (hasCJK(item) ? item.slice(0, 2) : item.toLowerCase().split(/[\s-]+/).filter((w) => !/^(all|purpose|large|small|fresh|unsalted|salted|melted|whole)$/.test(w)).pop() ?? item.toLowerCase());

function plan(p: Project) {
  const m = p.meta as unknown as Meta, issues: Issue[] = [], system = (s(p.settings.system) || "keep") as System, people = Number(p.settings.people) || 0;
  const factor = new Map<string, { base: number | null; target: number; f: number | null; row: number }>();
  p.rows.forEach((r, i) => {
    if (r.kind !== "recipe") return;
    const base = Number(s(r.base)) || null, target = Number(s(r.servings)) || people || base || 0;
    factor.set(s(r.recipe), { base, target, f: base && target ? target / base : null, row: i });
    if (!base) issues.push({ level: "error", row: i, key: "base", message: `${s(r.recipe)}: the recipe doesn't say how many it serves (份量) — fill in the original servings (base) so it can be scaled.` });
    else if (target / base > 4) issues.push({ level: "info", row: i, message: `${s(r.recipe)} is scaled ×${nice(target / base, false)} — pans, cooking times and strong seasonings don't scale linearly; taste as you go.` });
  });
  const lines: Line[] = [], seen = new Map<string, number>();
  p.rows.forEach((r, i) => {
    if (r.kind !== "ing" || r.include === false) return;
    const rec = s(r.recipe), item = s(r.item), fx = factor.get(rec), f = fx?.f ?? 1, zh = hasCJK(item) || hasCJK(rec);
    if (!item) { issues.push({ level: "error", row: i, key: "item", message: `#${i} (${rec}): ingredient name is empty — fill it in or delete the row.` }); return; }
    const k = `${rec}|${key(item)}`;
    if (seen.has(k)) issues.push({ level: "warn", row: i, key: "item", message: `#${i} ${rec}: “${item}” is listed twice (also #${seen.get(k)}) — merge them or drop one.` });
    seen.set(k, i);
    const q = qtyValue(s(r.qty)), u = unitOf(s(r.unit)), line: Line = { i, recipe: rec, item, text: "", scalable: false, aisle: s(r.aisle) || aisleOf(item) };
    if (q === null) { issues.push({ level: "error", row: i, key: "qty", message: `#${i} ${rec} · ${item}: can't read the amount “${s(r.qty)}” — write a number like 2, 1/2, 1 1/2 or 两, or 适量.` }); line.text = s(r.qty); lines.push(line); return; }
    if (q === undefined) { line.text = s(r.qty) || ""; line.free = s(r.qty) || "适量"; lines.push(line); return; }
    const v = q * f;
    line.scalable = true;
    if (u === null) {
      issues.push({ level: "warn", row: i, key: "unit", message: `#${i} ${rec} · ${item}: unknown unit “${s(r.unit)}” — scaled as-is; use g, ml, tsp, tbsp, cup, 克, 汤匙, 茶匙, 个 …` });
      line.text = `${nice(v)} ${s(r.unit)}`; line.count = { n: v, unit: s(r.unit) };
    } else if (u === "count") {
      const n = roundCount(v, item);
      if (Math.abs(n - v) / v > 0.15) issues.push({ level: "info", row: i, key: "qty", message: `#${i} ${rec} · ${item}: ${nice(v)} rounded to ${nice(n)}${s(r.unit) ? ` ${s(r.unit)}` : ""}.` });
      line.text = `${nice(n)}${s(r.unit) ? ` ${s(r.unit)}` : ""}`; line.count = { n, unit: s(r.unit) };
    } else {
      const base = v * u.base;
      if (u.dim === "mass") line.mass = base; else line.vol = base;
      line.text = system === "keep" ? `${u.dim === "vol" && u.base >= 5 && u.base <= 240 ? nice(v) : nice(v, false)} ${s(r.unit)}` : formatBase(base, u.dim as "mass" | "vol", system, zh);
      if (u.dim === "vol" && base < 0.6) issues.push({ level: "info", row: i, key: "qty", message: `#${i} ${rec} · ${item}: only ${nice(v)} ${s(r.unit)} — a pinch is fine.` });
    }
    lines.push(line);
  });
  // 步骤里没用到的食材
  for (const rec of m.recipes) {
    const st = rec.steps.join(" ").toLowerCase();
    if (!st) { const fx = factor.get(rec.title); issues.push({ level: "warn", row: fx?.row, message: `${rec.title}: no steps found (## 步骤 / ## Method) — the card will only list ingredients.` }); continue; }
    for (const l of lines.filter((x) => x.recipe === rec.title)) if (!cores(l.item).some((c) => st.includes(c))) issues.push({ level: "info", row: l.i, message: `#${l.i} ${rec.title} · ${l.item} isn't mentioned in the steps — check it's needed or add when to use it.` });
  }
  return { issues, lines, factor, system };
}

function shopping(p: Project, lines: Line[], system: System) {
  const pantry = s(p.settings.pantry).split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean);
  const g = new Map<string, { name: string; aisle: string; mass: number; vol: number; counts: Map<string, number>; free: Set<string>; recipes: Set<string>; bad: boolean }>();
  for (const l of lines) {
    const k = key(l.item);
    const e = g.get(k) ?? { name: k === key(l.item) && ALIAS.some(([re]) => re.test(l.item.trim())) ? k : l.item, aisle: l.aisle, mass: 0, vol: 0, counts: new Map(), free: new Set(), recipes: new Set(), bad: false };
    if (l.mass) e.mass += l.mass;
    if (l.vol) e.vol += l.vol;
    if (l.count) { const cu = /^(|个|large|medium|small|whole|pcs?|pieces?)$/i.test(l.count.unit) ? (hasCJK(k) ? "个" : "") : l.count.unit; e.counts.set(cu, (e.counts.get(cu) ?? 0) + l.count.n); }
    if (l.free) e.free.add(l.free);
    if (!l.scalable && !l.free) e.bad = true;
    e.recipes.add(l.recipe);
    g.set(k, e);
  }
  const out = [...g.values()].map((e) => {
    const zh = hasCJK(e.name), parts: string[] = [];
    if (e.mass) parts.push(formatBase(e.mass, "mass", system === "us" ? "us" : "metric", zh));
    if (e.vol) parts.push(formatBase(e.vol, "vol", system === "us" ? "us" : "metric", zh));
    for (const [u, n] of e.counts) parts.push(`${nice(roundCount(n, e.name))}${u ? ` ${u}` : ""}`);
    if (!parts.length && e.free.size) parts.push([...e.free].join("/"));
    const home = pantry.some((x) => e.name.includes(x) || x === e.name);
    return { ...e, amount: parts.join(" + ") || "?", home, mixed: !!(e.mass && e.vol) };
  });
  const order = [...AISLES.map(([a]) => a), "其他"];
  out.sort((a, b) => order.indexOf(a.aisle) - order.indexOf(b.aisle) || a.name.localeCompare(b.name, "zh"));
  return out;
}

function makeDef(): AppDef {
  return {
    name: NAME,
    version: VERSION,
    prefix: "recipe",
    title: ["菜谱换算", "Recipe Scaler"],
    openDescription:
      "Scale recipes to the number of people, convert units and build one shopping list and printable recipe cards. Pick a folder of recipe .md/.txt files (or one or more files): “# Title”, a servings line (份量：4 人份 / Serves 4), “## 食材 / Ingredients” list lines (五花肉 500 g, 生抽 2 汤匙, 鸡蛋 3 个, 盐 适量, 1 1/2 cups flour, 2 tbsp sugar) and “## 步骤 / Method”. Rows: one recipe row per recipe (base = original servings, servings = target; blank target uses the people setting) followed by its ingredient rows (item, qty, unit, note, aisle, include). Settings: people (target servings for all recipes; 0 = keep each recipe's own), system (keep the recipe's units / metric g·ml / us oz·cup), pantry (items you already have, left off the list and shown under “already at home”), title. Counts are rounded sensibly (eggs and tomatoes whole), spoons and cups in quarters, grams to 5. Shopping list merges the same item across recipes (鸡蛋/蛋/eggs, 番茄/西红柿), adds weights and volumes, and groups by aisle. Checks: recipes without servings, unreadable amounts, unknown units, duplicate ingredients in a recipe, ingredients never mentioned in the steps, recipes without steps, big rounding, scaling more than ×4, items needed by weight and by volume. Exports recipe-cards.pdf (one A5 card per recipe with scaled amounts, steps and time), shopping-list.pdf (by aisle with checkboxes), shopping-list.csv and recipes-scaled.md.",
    inputs: { exts: [".md", ".txt", ".markdown"], min: 1, max: 30, folders: true, label: ["选择菜谱（文件夹或 .md）", "Pick recipes (folder or .md)"] },
    settings: [
      { key: "title", label: ["标题", "Title"], type: "text", default: "" },
      { key: "people", label: ["统一按几人份（0 = 各自不变）", "Servings for all (0 = keep)"], type: "number", default: 0, min: 0, max: 500 },
      { key: "system", label: ["单位", "Units"], type: "select", default: "keep", options: [{ value: "keep", label: ["保持原单位", "Keep recipe units"] }, { value: "metric", label: ["公制（克、毫升）", "Metric (g, ml)"] }, { value: "us", label: ["美制（oz、cup）", "US (oz, cup)"] }] },
      { key: "pantry", label: ["家里已有（不进购物清单）", "Already at home"], type: "textarea", default: "" },
    ],
    columns: () => [
      { key: "include", label: ["保留", "Keep"], type: "bool" },
      { key: "recipe", label: ["菜谱", "Recipe"], readOnly: true },
      { key: "_type", label: ["行", "Row"], readOnly: true },
      { key: "item", label: ["食材", "Ingredient"], wide: true },
      { key: "qty", label: ["原数量", "Qty"] },
      { key: "unit", label: ["单位", "Unit"] },
      { key: "base", label: ["原份数", "Base servings"], type: "number" },
      { key: "servings", label: ["做几人份", "Servings"], type: "number" },
      { key: "_scaled", label: ["换算后", "Scaled"], readOnly: true },
      { key: "aisle", label: ["货架", "Aisle"], type: "select", options: [...AISLES.map(([a]) => a), "其他"] },
      { key: "note", label: ["备注", "Note"], wide: true },
    ] as Column[],
    newRow: (p) => ({ kind: "ing", include: true, recipe: s(p.rows.findLast?.((r) => r.kind === "recipe")?.recipe ?? p.rows.find((r) => r.kind === "recipe")?.recipe), item: "", qty: "", unit: "", base: "", servings: "", aisle: "", note: "" }),
    async load({ ws, files, previous }) {
      const list: string[] = [];
      for (const f of files) {
        if (/\.(md|txt|markdown)$/i.test(f)) list.push(f);
        else for (const x of await ws.list({ dir: f, exts: [".md", ".txt", ".markdown"], limit: 200 })) list.push(x.path);
      }
      const all = [...new Set(list)].filter((f) => !f.startsWith(NAME + "/") && !/readme/i.test(f));
      if (!all.length) throw new KitError("no_recipes", "No recipe .md/.txt files found.");
      const recipes: Recipe[] = [];
      for (const f of all.sort()) { const r = parseRecipe(await ws.readText(f), f); if (r.ings.length) recipes.push(r); }
      if (!recipes.length) throw new KitError("no_ingredients", "None of the files has an ingredient list (## 食材 / ## Ingredients).");
      const names = new Map<string, number>();
      for (const r of recipes) { const n = names.get(r.title) ?? 0; names.set(r.title, n + 1); if (n) r.title = `${r.title} (${n + 1})`; }
      const prevT = new Map((previous ?? []).filter((r) => r.kind === "recipe").map((r) => [s(r.recipe), r]));
      const rows: Row[] = [];
      for (const r of recipes) {
        rows.push({ kind: "recipe", include: true, recipe: r.title, item: r.title, qty: "", unit: "", base: r.servings ?? "", servings: s(prevT.get(r.title)?.servings), aisle: "", note: r.servingsRaw ? `份量：${r.servingsRaw}` : "" });
        for (const g of r.ings) rows.push({ kind: "ing", include: true, recipe: r.title, item: g.item, qty: g.qty, unit: g.unit, base: "", servings: "", aisle: aisleOf(g.item), note: g.note });
      }
      return { rows, meta: { recipes } satisfies Meta as unknown as Record<string, unknown> };
    },
    compute(p): Computed {
      const { issues, lines, factor, system } = plan(p), byI = new Map(lines.map((l) => [l.i, l]));
      const rows = p.rows.map((r, i) => {
        if (r.kind === "recipe") { const fx = factor.get(s(r.recipe)); return { ...r, _type: "菜谱", _scaled: fx?.f ? `${fx.target} 人份（×${nice(fx.f, false)}）` : "" }; }
        return { ...r, _type: "食材", _scaled: byI.get(i)?.text ?? "" };
      });
      const shop = shopping(p, lines, system), recs = [...factor.keys()];
      const html = `<div style="font:13px/1.5 system-ui,sans-serif"><b>购物清单</b> · ${shop.filter((x) => !x.home).length} 样${shop.some((x) => x.home) ? `（家里有 ${shop.filter((x) => x.home).length} 样）` : ""}<ul style="margin:4px 0;padding-left:18px">${shop.filter((x) => !x.home).map((x) => `<li>${esc(x.name)} <b>${esc(x.amount)}</b> <span style="color:#6B7280">${esc(x.aisle)} · ${esc([...x.recipes].join("、"))}</span></li>`).join("")}</ul></div>`;
      for (const x of shop) if (x.mixed) issues.push({ level: "info", message: `${x.name} is needed by weight and by volume (${x.amount}) — they can't be added up; buy enough for both.` });
      return {
        rows, issues,
        summary: `${recs.length} recipe(s): ${recs.map((r) => { const fx = factor.get(r)!; return `${r} ${fx.base ?? "?"}→${fx.target || "?"}`; }).join(", ")}; shopping list ${shop.filter((x) => !x.home).length} item(s)${shop.some((x) => x.home) ? `, ${shop.filter((x) => x.home).length} already at home` : ""}.`,
        stats: { recipes: recs.length, items: shop.length },
        preview: html,
      };
    },
    exports: [
      { id: "cards", label: ["菜谱卡片 PDF", "Recipe cards (PDF)"], description: "recipe-cards.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { lines, factor } = plan(p), m = p.meta as unknown as Meta, k = await newPdf(), [W, H] = PAGE.A5, M = 30;
        for (const rec of m.recipes) {
          const fx = factor.get(rec.title); if (!fx) continue;
          const hr = p.rows.find((r) => r.kind === "recipe" && s(r.recipe) === rec.title);
          if (hr?.include === false) continue;
          let pg = k.doc.addPage([W, H]), y = H - 40;
          const next = () => { pg = k.doc.addPage([W, H]); y = H - 40; k.text(pg, `${rec.title}（续）`, M, y, { size: 11, bold: true, color: "#6B7280" }); y -= 22; };
          pg.drawRectangle({ x: 0, y: H - 14, width: W, height: 14, color: hexRgb("#F59E0B") });
          k.text(pg, rec.title, M, y, { size: 18, bold: true }); y -= 20;
          const mins = stepMinutes(rec.steps);
          k.text(pg, [`${fx.target || "?"} 人份${fx.base && fx.target !== fx.base ? `（原 ${fx.base} 人份，×${nice(fx.f ?? 1, false)}）` : ""}`, mins ? `约 ${mins >= 60 ? `${Math.floor(mins / 60)} 小时${mins % 60 ? ` ${mins % 60} 分` : ""}` : `${mins} 分钟`}` : ""].filter(Boolean).join("  ·  "), M, y, { size: 10, color: "#92400E" }); y -= 22;
          k.text(pg, "食材", M, y, { size: 12, bold: true }); y -= 16;
          const ls = lines.filter((l) => l.recipe === rec.title), colW = (W - 2 * M) / 2;
          const half = Math.ceil(ls.length / 2);
          ls.forEach((l, j) => {
            const x = M + (j < half ? 0 : colW), yy = y - (j < half ? j : j - half) * 15;
            k.text(pg, l.item, x, yy, { size: 10, maxWidth: colW - 70 }); k.text(pg, l.text || "—", x + colW - 10, yy, { size: 10, bold: true, align: "right" });
          });
          y -= half * 15 + 14;
          k.text(pg, rec.steps.length ? "做法" : "", M, y, { size: 12, bold: true }); y -= 16;
          rec.steps.forEach((st, j) => {
            const wl = k.wrap(st, 10, W - 2 * M - 18);
            if (y - wl.length * 13 < 30) next();
            k.text(pg, `${j + 1}.`, M, y, { size: 10, bold: true, color: "#B45309" });
            for (const w of wl) { k.text(pg, w, M + 18, y, { size: 10 }); y -= 13; }
            y -= 4;
          });
        }
        return [await ctx.write("recipe-cards.pdf", await k.doc.save())];
      } },
      { id: "shop", label: ["购物清单 PDF", "Shopping list (PDF)"], description: "shopping-list.pdf", async run(ctx: ExportCtx) {
        const p = ctx.project, { lines, system } = plan(p), shop = shopping(p, lines, system), k = await newPdf(), [W, H] = PAGE.A4, M = 48;
        let pg = k.doc.addPage([W, H]), y = H - 56;
        const need = (h: number) => { if (y - h < 50) { pg = k.doc.addPage([W, H]); y = H - 56; } };
        k.text(pg, s(p.settings.title) || "购物清单", M, y, { size: 20, bold: true }); y -= 20;
        k.text(pg, [...new Set(lines.map((l) => l.recipe))].join("、"), M, y, { size: 10, color: "#6B7280", maxWidth: W - 2 * M }); y -= 26;
        const groups = [...new Set(shop.filter((x) => !x.home).map((x) => x.aisle))];
        for (const a of groups) {
          need(40); k.text(pg, a, M, y, { size: 13, bold: true, color: "#B45309" }); y -= 18;
          for (const x of shop.filter((z) => !z.home && z.aisle === a)) {
            need(18);
            pg.drawRectangle({ x: M, y: y - 2, width: 10, height: 10, borderColor: hexRgb("#6B7280"), borderWidth: 0.8 });
            k.text(pg, x.name, M + 18, y, { size: 11 }); k.text(pg, x.amount, M + 250, y, { size: 11, bold: true });
            k.text(pg, [...x.recipes].join("、"), W - M, y, { size: 8, align: "right", color: "#9CA3AF", maxWidth: 150 }); y -= 18;
          }
          y -= 6;
        }
        const home = shop.filter((x) => x.home);
        if (home.length) { need(40); k.text(pg, "家里应该有（出门前看一眼）", M, y, { size: 12, bold: true, color: "#6B7280" }); y -= 16; for (const x of home) { need(16); k.text(pg, `${x.name}  ${x.amount}`, M + 18, y, { size: 10, color: "#6B7280" }); y -= 15; } }
        return [await ctx.write("shopping-list.pdf", await k.doc.save())];
      } },
      { id: "csv", label: ["购物清单 CSV", "Shopping list (CSV)"], description: "shopping-list.csv", async run(ctx: ExportCtx) {
        const p = ctx.project, { lines, system } = plan(p), shop = shopping(p, lines, system);
        const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const out = ["货架,食材,数量,用于,家里已有", ...shop.map((x) => [x.aisle, x.name, x.amount, [...x.recipes].join("、"), x.home ? "是" : ""].map(q).join(","))].join("\r\n");
        return [await ctx.write("shopping-list.csv", "\uFEFF" + out + "\r\n")];
      } },
      { id: "md", label: ["换算后菜谱 Markdown", "Scaled recipes (Markdown)"], description: "recipes-scaled.md", async run(ctx: ExportCtx) {
        const p = ctx.project, { lines, factor } = plan(p), m = p.meta as unknown as Meta;
        const md = m.recipes.filter((r) => factor.has(r.title)).map((r) => { const fx = factor.get(r.title)!; return [`# ${r.title}`, "", `份量：${fx.target || "?"} 人份${fx.base && fx.base !== fx.target ? `（原 ${fx.base} 人份）` : ""}`, "", "## 食材", "", ...lines.filter((l) => l.recipe === r.title).map((l) => `- ${l.item} ${l.text}`.trimEnd()), "", "## 步骤", "", ...r.steps.map((x, j) => `${j + 1}. ${x}`), ""].join("\n"); }).join("\n");
        return [await ctx.write("recipes-scaled.md", md)];
      } },
    ],
    describeRow: (r, i) => r.kind === "recipe"
      ? `#${i} [recipe] ${s(r.recipe)} base ${s(r.base) || "?"} → ${s(r.servings) || "(people setting)"}${s(r._scaled) ? ` = ${s(r._scaled)}` : ""}`
      : `#${i}${r.include === false ? " [dropped]" : ""}   ${s(r.recipe)} · ${s(r.item)} ${s(r.qty)}${s(r.unit) ? ` ${s(r.unit)}` : ""} → ${s(r._scaled) || "?"}${s(r.note) ? ` (${s(r.note)})` : ""}`,
  };
}

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(makeDef(), options).server;
}
