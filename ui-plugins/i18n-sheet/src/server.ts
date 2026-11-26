import { createApp, esc, type AppDef, type Column, type ExportCtx, type Issue, type Project, type Row } from "./kit/app.ts";
import { writeXlsx } from "./kit/sheet.ts";
import { decodeText, readTable } from "./kit/table.ts";
import { KitError } from "./kit/workspace.ts";
import { parseLocale, placeholders, serialize, tags, type LocaleFile } from "./locale.ts";

export const NAME = "i18n-sheet";
export const VERSION = "0.1.0";

const localesOf = (p: Project) => (p.meta.locales as LocaleFile[]) ?? [];
const baseIdx = (p: Project) => {
  const l = localesOf(p);
  const want = String(p.settings.base || "").trim();
  const i = want ? l.findIndex((x) => x.code === want) : l.findIndex((x) => /^en([-_]|$)/.test(x.code));
  return i >= 0 ? i : 0;
};
const col = (i: number) => `l${i}`;
const val = (r: Row, i: number) => (r[col(i)] === undefined || r[col(i)] === null ? undefined : String(r[col(i)]));

export function check(p: Project) {
  const ls = localesOf(p);
  const b = baseIdx(p);
  const issues: Issue[] = [];
  const status: string[] = [];
  const keys = new Map<string, number>();
  p.rows.forEach((r, ri) => {
    const key = String(r.key ?? "").trim();
    const notes: string[] = [];
    if (!key) issues.push({ level: "error", row: ri, key: "key", message: "Empty key." });
    else if (keys.has(key)) issues.push({ level: "error", row: ri, key: "key", message: `Duplicate key “${key}” (also row ${keys.get(key)! + 1}).` });
    keys.set(key, ri);
    const base = val(r, b);
    if (base === undefined || base === "") { notes.push(`not in ${ls[b]?.code}`); issues.push({ level: "warn", row: ri, key: col(b), message: `${key}: missing in the base language ${ls[b]?.code}${ls.some((_, i) => val(r, i)) ? " (only in other files — unused or stale?)" : ""}.` }); }
    ls.forEach((l, i) => {
      if (i === b) return;
      const v = val(r, i);
      if (v === undefined || v === "") { notes.push(`${l.code} missing`); if (base) issues.push({ level: "warn", row: ri, key: col(i), message: `${key}: ${l.code} ${v === "" ? "is empty" : "is missing"}.` }); return; }
      if (!base) return;
      const pb = placeholders(base), pv = placeholders(v);
      if (pb.join("|") !== pv.join("|")) { notes.push(`${l.code} placeholders`); issues.push({ level: "error", row: ri, key: col(i), message: `${key}: ${l.code} placeholders ${pv.join(" ") || "(none)"} ≠ ${ls[b].code} ${pb.join(" ") || "(none)"}.` }); }
      if (tags(base).join("|") !== tags(v).join("|")) { notes.push(`${l.code} tags`); issues.push({ level: "warn", row: ri, key: col(i), message: `${key}: ${l.code} HTML tags differ from ${ls[b].code}.` }); }
      if (v === base && /\p{L}{3,}/u.test(base) && l.code.slice(0, 2) !== ls[b].code.slice(0, 2)) { notes.push(`${l.code} untranslated?`); issues.push({ level: "info", row: ri, key: col(i), message: `${key}: ${l.code} is the same as ${ls[b].code} — not translated yet?` }); }
    });
    status.push(notes.length ? notes.join(", ") : "ok");
  });
  return { issues, status };
}

function entriesFor(p: Project, i: number, mode: string): [string, string][] {
  const b = baseIdx(p);
  const out: [string, string][] = [];
  const rows = p.settings.sort ? [...p.rows].sort((x, y) => String(x.key).localeCompare(String(y.key), "en")) : p.rows;
  for (const r of rows) {
    const key = String(r.key ?? "").trim();
    if (!key) continue;
    let v = val(r, i);
    if (v === undefined || (v === "" && i !== b)) {
      if (mode === "omit") continue;
      v = mode === "base" ? val(r, b) ?? "" : "";
    }
    out.push([key, v]);
  }
  return out;
}

const def: AppDef = {
  name: NAME,
  version: VERSION,
  prefix: "i18n",
  title: ["多语言文案表", "i18n Sheet"],
  openDescription:
    "Put app translation files (locale JSON or YAML such as en.json, zh.json, ja.yml; nested or flat keys; Rails-style `ja:` root) side by side in one grid: one row per key, one column per language. Finds missing and empty translations, keys only present in non-base files, placeholder mismatches ({name}, {{name}}, %s, %1$s, %{name}, ${name}, ICU {count, plural…}), HTML tag differences and strings that look untranslated. Edit cells or add keys, then write the locale files back (same format, nesting, key order and indentation) and/or an Excel sheet for translators. A filled-in translator sheet (.xlsx/.csv with a key column plus language columns) can be opened with the files to import it back.",
  inputs: { exts: [".json", ".yaml", ".yml", ".xlsx", ".csv"], min: 1, max: 30, label: ["选择各语言的文案文件（可加一份翻译回来的表格）", "Pick the locale files (plus an optional translated sheet)"] },
  settings: [
    { key: "base", label: ["基准语言（留空自动选 en）", "Base language (blank = en or first)"], type: "text", default: "" },
    { key: "missing", label: ["导出时缺失的文案", "Missing strings on export"], type: "select", default: "omit", options: [{ value: "omit", label: ["不写（让程序回退到基准语言）", "Leave out (app falls back)"] }, { value: "base", label: ["用基准语言填充", "Fill with base language"] }, { value: "empty", label: ["写空字符串", "Write empty string"] }] },
    { key: "sort", label: ["按键名排序", "Sort keys A–Z"], type: "bool", default: false },
  ],
  columns: (p) => [
    { key: "key", label: ["键", "Key"] },
    ...localesOf(p).map((l, i): Column => ({ key: col(i), label: [l.code + (i === baseIdx(p) ? "（基准）" : ""), l.code + (i === baseIdx(p) ? " (base)" : "")], wide: true })),
    { key: "_status", label: ["状态", "Status"], readOnly: true },
  ],
  newRow: (p) => Object.fromEntries([["key", ""], ...localesOf(p).map((_, i) => [col(i), ""])]),
  async load({ ws, files }) {
    const locales: LocaleFile[] = [];
    const flats: Map<string, string>[] = [];
    const sheets: string[] = [];
    for (const f of files) {
      if (/\.(xlsx|csv)$/i.test(f)) { sheets.push(f); continue; }
      let parsed;
      try { parsed = parseLocale(f, decodeText(await ws.read(f, 20 * 1024 * 1024))); } catch (e) { throw new KitError("bad_locale", (e as Error).message); }
      if (locales.some((l) => l.code === parsed.meta.code)) throw new KitError("duplicate_locale", `Two files are both “${parsed.meta.code}”: ${locales.find((l) => l.code === parsed.meta.code)!.file} and ${f}. Open one namespace at a time.`);
      locales.push(parsed.meta);
      flats.push(parsed.flat);
    }
    if (!locales.length) throw new KitError("no_locales", "Pick at least one locale file (.json/.yaml) — a translator sheet alone is not enough.");
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const fl of flats) for (const k of fl.keys()) if (!seen.has(k)) { seen.add(k); keys.push(k); }
    const rows: Row[] = keys.map((k) => Object.fromEntries([["key", k], ...flats.map((fl, i) => [col(i), fl.get(k)])]));
    const imported: string[] = [];
    for (const s of sheets) {
      const t = await readTable(ws, s);
      const keyCol = t.columns.find((c) => /^(key|键|id)$/i.test(c.trim()));
      if (!keyCol) throw new KitError("bad_sheet", `${s}: needs a “key” column.`);
      let n = 0;
      for (const tr of t.rows) {
        const k = String(tr[keyCol] ?? "").trim();
        if (!k) continue;
        let found = rows.find((r) => r.key === k);
        if (!found) { found = Object.fromEntries([["key", k], ...locales.map((_, i) => [col(i), undefined])]) as Row; rows.push(found); }
        const row: Row = found;
        locales.forEach((l, i) => {
          const c = t.columns.find((h) => h.trim() === l.code); // “(base)” 列只是参考，不导回
          const v = c ? String(tr[c] ?? "").trim() : "";
          if (c && v && v !== row[col(i)]) { row[col(i)] = v; n++; }
        });
      }
      imported.push(`${s}: ${n} cell(s) imported`);
    }
    return { rows, meta: { locales, imported } };
  },
  compute(p) {
    const ls = localesOf(p);
    const b = baseIdx(p);
    const { issues, status } = check(p);
    const rows = p.rows.map((r, i) => ({ ...r, _status: status[i] }));
    for (const s of (p.meta.imported as string[]) ?? []) issues.unshift({ level: "info", message: s });
    const cover = ls.map((l, i) => {
      const have = p.rows.filter((r) => val(r, b) && val(r, i)).length;
      const total = p.rows.filter((r) => val(r, b)).length;
      return { code: l.code, have, total, pct: total ? Math.round((have / total) * 100) : 100 };
    });
    const preview = `<table style="border-collapse:collapse;font-size:13px">${cover.map((c, i) => `<tr><td style="padding:3px 10px"><b>${esc(c.code)}</b>${i === b ? " (base)" : ""}</td><td style="padding:3px 10px">${esc(ls[i].file)}</td><td style="padding:3px 10px">${c.have}/${c.total}</td><td style="padding:3px 10px;width:160px"><div style="background:#e5e7eb;height:8px;border-radius:4px"><div style="background:${c.pct === 100 ? "#16a34a" : "#f59e0b"};width:${c.pct}%;height:8px;border-radius:4px"></div></div></td><td>${c.pct}%</td></tr>`).join("")}</table>`;
    const missing = issues.filter((i) => / (is missing|is empty)\.$/.test(i.message)).length;
    return { rows, issues, preview, summary: `${p.rows.length} keys × ${ls.length} languages · ${missing} missing · ${issues.filter((i) => i.level === "error").length} placeholder error(s)`, stats: { keys: p.rows.length, languages: ls.length, missing, errors: issues.filter((i) => i.level === "error").length } };
  },
  exports: [
    {
      id: "locales", label: ["语言文件", "Locale files"], description: "Each locale file written back in its own format (same path inside the output folder)",
      async run({ project, write, computed }: ExportCtx) {
        const errs = (computed.issues ?? []).filter((i) => i.level === "error");
        if (errs.length) throw new KitError("has_errors", `Fix first: ${errs[0].message}`);
        const out: string[] = [];
        for (const [i, l] of localesOf(project).entries()) out.push(await write(l.file, serialize(l, entriesFor(project, i, String(project.settings.missing ?? "omit")))));
        return out;
      },
    },
    {
      id: "xlsx", label: ["给翻译的 Excel", "Sheet for translators"], description: "translations.xlsx — key, every language, placeholders; missing cells highlighted. Fill it in and open it together with the locale files to import (the base column is reference only).",
      async run({ project, write }: ExportCtx) {
        const ls = localesOf(project);
        const b = baseIdx(project);
        const order = [b, ...ls.map((_, i) => i).filter((i) => i !== b)];
        const marks: { row: number; col: number; color?: string; note?: string }[] = [];
        const { issues } = check(project);
        const rows = project.rows.map((r, ri) => {
          order.forEach((li, ci) => {
            const v = val(r, li);
            if (li !== b && val(r, b) && !v) marks.push({ row: ri, col: ci + 1, color: "#FDE68A" });
            const bad = issues.find((x) => x.row === ri && x.key === col(li) && x.level === "error");
            if (bad) marks.push({ row: ri, col: ci + 1, color: "#FCA5A5", note: bad.message });
          });
          return [r.key, ...order.map((li) => val(r, li) ?? ""), placeholders(val(r, b) ?? "").join(" ")];
        });
        const headers = ["key", ...order.map((li) => ls[li].code + (li === b ? " (base)" : "")), "placeholders"];
        return [await write("translations.xlsx", await writeXlsx([{ name: "Translations", headers, rows, marks, widths: [28, ...order.map(() => 40), 18] }]))];
      },
    },
  ],
};

export function createServer(options: { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }) {
  return createApp(def, options).server;
}
