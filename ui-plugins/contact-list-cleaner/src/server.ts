import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import ExcelJS from "exceljs";
import type { CountryCode } from "libphonenumber-js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { readTable } from "./kit/table.ts";
import { FIELDS, FIELD_LABEL, findDuplicates, guessMapping, mergeGroup, normalizeRow, type Contact, type Field, type Mapping, type Merged, type Pair } from "./clean.ts";

export const NAME = "contact-list-cleaner";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PROJECT = ".contact-cleaner/project.json";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }
interface FileCfg { file: string; sheet?: string; mapping: Mapping }
interface Project { version: 1; files: FileCfg[]; region: string; decisions: Record<string, "merge" | "keep">; output: string }
const MAP_VALUES = ["", ...FIELDS, "first", "last"] as const;

/** vCard 3.0（RFC 2426）：转义 \\ , ; 换行；按 75 字节折行且不拆开 UTF-8 字符；CRLF。 */
const vEsc = (v: string) => v.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
function vFold(line: string) {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
export function toVcf(list: Record<Field, string>[]): string {
  const cards = list.map((v) => {
    const name = v.name || v.company || v.email || v.phone || "?";
    const zhName = /[\u3400-\u9fff]/.test(v.name) && !/\s/.test(v.name);
    const parts = v.name.trim().split(/\s+/);
    const n = !v.name ? ";;;;" : zhName ? `${vEsc([...v.name].slice(0, 1).join(""))};${vEsc([...v.name].slice(1).join(""))};;;` : parts.length > 1 ? `${vEsc(parts.at(-1)!)};${vEsc(parts.slice(0, -1).join(" "))};;;` : `${vEsc(v.name)};;;;`;
    const notes = [v.wechat && `WeChat: ${v.wechat}`, v.notes].filter(Boolean).join("\n");
    const lines = [
      "BEGIN:VCARD", "VERSION:3.0", `FN:${vEsc(name)}`, `N:${n}`,
      v.phone && `TEL;TYPE=CELL:${vEsc(v.phone)}`, v.phone2 && `TEL;TYPE=VOICE:${vEsc(v.phone2)}`,
      v.email && `EMAIL;TYPE=INTERNET:${vEsc(v.email)}`, v.email2 && `EMAIL;TYPE=INTERNET:${vEsc(v.email2)}`,
      v.company && `ORG:${vEsc(v.company)}`, v.title && `TITLE:${vEsc(v.title)}`,
      v.city && `ADR;TYPE=WORK:;;;${vEsc(v.city)};;;`, v.wechat && `X-WECHAT:${vEsc(v.wechat)}`, notes && `NOTE:${vEsc(notes)}`,
      "END:VCARD",
    ].filter(Boolean) as string[];
    return lines.map(vFold).join("\r\n");
  });
  return cards.join("\r\n") + (cards.length ? "\r\n" : "");
}

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({ name: NAME, version: VERSION, panelUri: PANEL_URI, surface: "editor", panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"), log: options.log });

  async function loadProject(): Promise<Project | undefined> {
    return (await ws.exists(PROJECT)) ? JSON.parse(await ws.readText(PROJECT)) : undefined;
  }
  async function mustProject() {
    const p = await loadProject();
    if (!p) throw new KitError("no_project", "No contact lists loaded yet; call contacts_load first.");
    return p;
  }
  const save = (p: Project) => ws.write(PROJECT, JSON.stringify(p, null, 1) + "\n");

  /** 读表 → 规范化 → 查重 → 按决定合并。 */
  async function compute(p: Project) {
    const tables: { file: string; columns: string[]; mapping: Mapping; rows: number; sample: Record<string, string>[]; sheets: string[] }[] = [];
    const contacts: Contact[] = [];
    for (const f of p.files) {
      const t = await readTable(ws, f.file, f.sheet);
      tables.push({ file: f.file, columns: t.columns, mapping: f.mapping, rows: t.rows.length, sample: t.rows.slice(0, 3), sheets: t.sheets });
      t.rows.forEach((r, i) => contacts.push(normalizeRow(f.file, i + 2, r, f.mapping, p.region as CountryCode)));
    }
    const d = findDuplicates(contacts);
    // 用户确认“合并”的可能重复：把两组并起来
    const groupOf = new Map<string, Contact[]>();
    for (const g of d.groups) for (const c of g) groupOf.set(c.id, g);
    const merged: { group: Contact[]; manual: string[] }[] = d.groups.map((g) => ({ group: g, manual: [] }));
    const holder = new Map<Contact[], { group: Contact[]; manual: string[] }>(merged.map((m) => [m.group, m]));
    for (const pair of d.possible) {
      if (p.decisions[pair.id] !== "merge") continue;
      const a = holder.get(groupOf.get(pair.a)!)!, b = holder.get(groupOf.get(pair.b)!)!;
      if (a === b) continue;
      a.group.push(...b.group); a.manual.push(pair.id, ...b.manual);
      for (const c of b.group) groupOf.set(c.id, a.group);
      holder.delete(b.group); b.group = [];
    }
    const order = new Map(contacts.map((c, i) => [c.id, i]));
    const result = [...holder.values()].filter((m) => m.group.length).map((m) => {
      m.group.sort((x, y) => order.get(x.id)! - order.get(y.id)!);
      return { id: m.group[0].id, auto: m.group.length > 1 && m.manual.length === 0, manual: m.manual, ...mergeGroup(m.group) };
    }).sort((x, y) => order.get(x.id)! - order.get(y.id)!);
    const pairs = d.possible.map((pair) => ({ ...pair, decision: p.decisions[pair.id] ?? null }));
    return { tables, contacts, result, pairs, autoReasons: Object.fromEntries(d.reasons) };
  }
  type Computed = Awaited<ReturnType<typeof compute>>;
  const summary = (c: Computed) => ({
    rows: c.contacts.length, contacts: c.result.length, merged: c.result.filter((r) => r.sources.length > 1).length,
    removed: c.contacts.length - c.result.length, pending: c.pairs.filter((x) => !x.decision).length, issues: c.result.reduce((n, r) => n + r.issues.length, 0),
  });
  const view = (p: Project, c: Computed) => ({ kind: "contacts", project: p, ...c, summary: summary(c), byId: undefined, contacts: c.contacts.map((x) => ({ id: x.id, file: x.file, row: x.row, values: x.values, issues: x.issues })) });
  const label = (c: Contact | Merged["values"]) => { const v = "values" in c ? c.values : c; return [v.name || "(no name)", v.company, v.phone || v.email].filter(Boolean).join(" · "); };
  function brief(c: Computed) {
    const s = summary(c);
    const byId = new Map(c.contacts.map((x) => [x.id, x]));
    const lines = [`${s.rows} rows from ${c.tables.length} file(s) → ${s.contacts} contacts (${s.merged} merged groups, ${s.removed} duplicate rows removed). ${s.pending} possible duplicate pair(s) need a decision; ${s.issues} value problem(s).`];
    for (const t of c.tables) lines.push(`${t.file}: ${Object.entries(t.mapping).map(([k, v]) => `${k}→${v || "skip"}`).join(", ")}`);
    for (const pair of c.pairs.filter((x) => !x.decision)) lines.push(`? ${pair.id}: ${label(byId.get(pair.a)!)}  vs  ${label(byId.get(pair.b)!)} — ${pair.reason}`);
    for (const r of c.result) for (const i of r.issues) lines.push(`! ${r.values.name || r.id}: ${i.problem}${i.value ? ` (“${i.value}”)` : ""}`);
    return lines.join("\n");
  }

  const mappingSchema = z.record(z.string(), z.enum(MAP_VALUES as unknown as [string, ...string[]]));
  tool(
    "contacts_load",
    {
      description: `Load one or more contact lists (CSV/TSV/XLSX; GBK CSV from Chinese Excel is detected), map their columns to one template (${FIELDS.join(", ")}; first/last name columns are joined), normalise values (names, phones to international format with +86 default, emails, company names) and find duplicates. Rows sharing a phone or email with a compatible name (or sharing both) are merged automatically; likely duplicates (same phone but different name, same name + same company / phone tail / email name) are listed as pairs for the user to decide. Opens the panel. Column mappings are guessed from headers and contents; pass \`mappings\` to override.`,
      input: {
        files: z.array(z.string()).min(1).optional().describe("Workspace paths; omit to reuse the loaded files."),
        mappings: z.record(z.string(), mappingSchema).optional().describe("Per file: { column: field | 'first' | 'last' | '' }."),
        sheets: z.record(z.string(), z.string()).optional(),
        region: z.string().length(2).optional().describe("Default country for numbers without a country code (ISO 3166, default CN)."),
      },
      openPanel: true,
      timeoutMs: 300_000,
    },
    async ({ files, mappings, sheets, region }) => {
      const prev = await loadProject();
      const list = files ?? prev?.files.map((f) => f.file);
      if (!list?.length) throw new KitError("no_files", "Pass `files`: the contact lists (CSV or XLSX).");
      const cfgs: FileCfg[] = [];
      for (const file of list) {
        if (!/\.(csv|tsv|txt|xlsx)$/i.test(file)) throw new KitError("unsupported", `${file}: use CSV, TSV or XLSX (save .xls as .xlsx first).`);
        const old = prev?.files.find((f) => f.file === file);
        const sheet = sheets?.[file] ?? old?.sheet;
        const t = await readTable(ws, file, sheet);
        const mapping = { ...(old?.mapping ?? guessMapping(t.columns, t.rows)), ...(mappings?.[file] ?? {}) } as Mapping;
        for (const k of Object.keys(mapping)) if (!t.columns.includes(k)) throw new KitError("bad_column", `${file} has no column “${k}”. Columns: ${t.columns.join(", ")}`);
        cfgs.push({ file, ...(sheet ? { sheet } : {}), mapping });
      }
      const p: Project = { version: 1, files: cfgs, region: (region ?? prev?.region ?? "CN").toUpperCase(), decisions: prev?.decisions ?? {}, output: prev?.output ?? "cleaned" };
      await save(p);
      const c = await compute(p);
      return { text: brief(c) + "\nAsk the user about pending pairs (or decide clearly safe ones), record with contacts_decide, then contacts_export.", structured: view(p, c) };
    },
  );

  tool(
    "contacts_map",
    { description: "Change the column mapping of a loaded file (column → field, 'first'/'last' for split names, '' to skip) and recompute.", input: { file: z.string(), mapping: mappingSchema }, openPanel: true },
    async ({ file, mapping }) => {
      const p = await mustProject();
      const f = p.files.find((x) => x.file === file);
      if (!f) throw new KitError("unknown_file", `${file} is not loaded. Loaded: ${p.files.map((x) => x.file).join(", ")}`);
      const t = await readTable(ws, file, f.sheet);
      for (const k of Object.keys(mapping)) if (!t.columns.includes(k)) throw new KitError("bad_column", `${file} has no column “${k}”.`);
      f.mapping = { ...f.mapping, ...(mapping as Mapping) };
      await save(p);
      const c = await compute(p);
      return { text: brief(c), structured: view(p, c) };
    },
  );

  tool(
    "contacts_decide",
    { description: "Decide possible-duplicate pairs (ids from contacts_load): merge=true merges the two contacts, false keeps them separate. Decisions are kept while the files keep their rows.", input: { decisions: z.array(z.object({ pair: z.string(), merge: z.boolean() })).min(1) }, openPanel: true },
    async ({ decisions }) => {
      const p = await mustProject();
      for (const d of decisions) p.decisions[d.pair] = d.merge ? "merge" : "keep";
      await save(p);
      const c = await compute(p);
      const known = new Set(c.pairs.map((x) => x.id));
      const unknown = decisions.filter((d: { pair: string }) => !known.has(d.pair)).map((d: { pair: string }) => d.pair);
      return { text: `${decisions.length - unknown.length} decision(s) saved.${unknown.length ? ` Not a current pair: ${unknown.join(", ")}.` : ""}\n` + brief(c), structured: view(p, c) };
    },
  );

  tool(
    "contacts_export",
    {
      description: "Write the cleaned list: xlsx (sheets: contacts, merge log, problems, undecided pairs), csv (contacts + merge-log CSV, UTF-8 with BOM) or vcf (one vCard 3.0 file, UTF-8, for phone/Outlook/Google Contacts import; merge log is not included). Default folder `cleaned/`. Undecided pairs stay as separate contacts and are listed.",
      input: { format: z.enum(["xlsx", "csv", "vcf"]).optional(), output: z.string().optional().describe("Output folder (default cleaned)."), lang: z.enum(["zh", "en"]).optional() },
    },
    async ({ format, output, lang }) => {
      const p = await mustProject();
      if (output) { p.output = output.replace(/^\/+|\/+$/g, "") || "cleaned"; await save(p); }
      const c = await compute(p);
      const zh = lang ? lang === "zh" : c.tables.some((t) => t.columns.some((x) => /[\u4e00-\u9fff]/.test(x)));
      const k = zh ? 0 : 1;
      const head = [...FIELDS.map((f) => FIELD_LABEL[f][k]), zh ? "来源" : "Sources"];
      const rows = c.result.map((r) => [...FIELDS.map((f) => r.values[f as Field]), r.sources.join("; ")]);
      const logHead = zh ? ["联系人", "合并方式", "来源行", "冲突与处理"] : ["Contact", "How", "Source rows", "Conflicts"];
      const log = c.result.filter((r) => r.sources.length > 1).map((r) => [r.values.name, r.auto ? (zh ? "自动（电话/邮箱相同）" : "automatic (same phone/email)") : (zh ? "用户确认" : "confirmed by user"), r.sources.join("; "), r.conflicts.join("; ")]);
      const probHead = zh ? ["联系人", "字段", "原值", "问题"] : ["Contact", "Field", "Value", "Problem"];
      const probs = c.result.flatMap((r) => r.issues.map((i) => [r.values.name || r.id, FIELD_LABEL[i.field][k], i.value, i.problem]));
      const byId = new Map(c.contacts.map((x) => [x.id, x]));
      const pendHead = zh ? ["配对", "A", "B", "原因"] : ["Pair", "A", "B", "Reason"];
      const pend = c.pairs.filter((x) => !x.decision).map((x) => [x.id, label(byId.get(x.a)!), label(byId.get(x.b)!), x.reason]);
      const written: string[] = [];
      if ((format ?? "xlsx") === "xlsx") {
        const book = new ExcelJS.Workbook();
        book.creator = "Contact List Cleaner";
        const sheet = (name: string, h: string[], data: string[][], widths: number[]) => {
          const s = book.addWorksheet(name);
          s.addRow(h).font = { bold: true };
          for (const r of data) s.addRow(r);
          s.columns.forEach((col, i) => { col.width = widths[i] ?? 18; });
          s.views = [{ state: "frozen", ySplit: 1 }];
          s.getColumn(FIELDS.indexOf("phone") + 1).numFmt = "@";
          return s;
        };
        sheet(zh ? "联系人" : "Contacts", head, rows, [12, 20, 20, 30, 26, 26, 16, 12, 14, 40, 40]);
        sheet(zh ? "合并日志" : "Merge log", logHead, log, [14, 22, 50, 80]);
        sheet(zh ? "问题" : "Problems", probHead, probs, [16, 10, 30, 40]);
        sheet(zh ? "待确认" : "Undecided", pendHead, pend, [50, 40, 40, 40]);
        written.push(await ws.write(posix.join(p.output, "contacts-clean.xlsx"), new Uint8Array(await book.xlsx.writeBuffer())));
      } else if (format === "vcf") {
        written.push(await ws.write(posix.join(p.output, "contacts-clean.vcf"), toVcf(c.result.map((r) => r.values as Record<Field, string>))));
      } else {
        const csv = (h: string[], data: string[][]) => "\uFEFF" + [h, ...data].map((r) => r.map((v) => (/[",\n\r]/.test(v ?? "") ? `"${String(v).replace(/"/g, "\"\"")}"` : v ?? "")).join(",")).join("\r\n") + "\r\n";
        written.push(await ws.write(posix.join(p.output, "contacts-clean.csv"), csv(head, rows)));
        written.push(await ws.write(posix.join(p.output, "merge-log.csv"), csv(logHead, log)));
      }
      const s = summary(c);
      return { text: `Wrote ${written.join(", ")}: ${s.contacts} contacts from ${s.rows} rows (${s.merged} merged groups); ${s.pending} undecided pair(s) kept separate; ${s.issues} problem(s) listed.`, structured: { kind: "exported", files: written, summary: s } };
    },
  );

  tool("contacts_state", { description: "Current project for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => {
    const p = await loadProject();
    if (!p) return { text: "", structured: { kind: "empty" } };
    const c = await compute(p);
    return { text: "", structured: view(p, c) };
  });
  tool("workspace_files", { description: "Tables for the panel.", input: {}, visibility: ["app"], readOnly: true }, async () => ({
    text: "", structured: { files: (await ws.list({ exts: [".csv", ".tsv", ".xlsx"], limit: 3000 })).map((f) => f.path).filter((f) => !f.startsWith(".contact-cleaner/")) },
  }));
  return server;
}
