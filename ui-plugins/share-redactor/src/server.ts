import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { KINDS, maskValue, valueKey, variants, type DetectOptions, type Kind, type Mask } from "./detect.ts";
import { docxApply, docxFind, textApply, textFind, xlsxApply, xlsxFind, zipAllText, type Decide, type Found } from "./formats.ts";
import { assemble, pdfFind, pdfText, type Rect } from "./pdf.ts";

export const NAME = "share-redactor";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PDFJS_URI = `ui://${NAME}/pdfjs/{kind}/{file}`;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

type FileType = "text" | "docx" | "xlsx" | "pdf";
const TYPES: Record<string, FileType> = { txt: "text", md: "text", markdown: "text", csv: "text", tsv: "text", json: "text", log: "text", docx: "docx", xlsx: "xlsx", pdf: "pdf" };
export interface Area { file: string; page: number; x: number; y: number; w: number; h: number }
export interface Settings { version: 1; files: string[]; kinds: Kind[]; keywords: string[]; mask: Mask; scrubMetadata: boolean; keep: string[]; areas: Area[]; dpi: number; output: string }
const SETTINGS = ".share-redactor/settings.json";

export function normalizeSettings(raw: any, prev?: Settings): Settings {
  const r = { ...(prev ?? {}), ...(raw ?? {}) };
  const files = [...new Set((Array.isArray(r.files) ? r.files : []).map(String))] as string[];
  return {
    version: 1,
    files,
    kinds: (Array.isArray(r.kinds) ? r.kinds : ["phone", "id", "bank", "email"]).filter((k: string) => KINDS.includes(k as Kind) && k !== "keyword") as Kind[],
    // 表格（TSV）行粘进来时只取第一列（通常是人名），否则整行当关键词永远匹配不上
    keywords: [...new Set((Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? "").split(/[,，;；\n]/)).flatMap((k: unknown) => String(k).split(/\r?\n/)).map((k: string) => k.split("\t")[0].trim()).filter((k: string) => k.length >= 2))] as string[],
    mask: ["label", "block", "partial"].includes(r.mask) ? r.mask : "label",
    scrubMetadata: r.scrubMetadata !== false,
    keep: [...new Set((Array.isArray(r.keep) ? r.keep : []).map(String))] as string[],
    areas: (Array.isArray(r.areas) ? r.areas : []).filter((a: any) => files.includes(a?.file) && [a.page, a.x, a.y, a.w, a.h].every(Number.isFinite)).map((a: any) => ({ file: a.file, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h })),
    dpi: Math.max(72, Math.min(300, Number(r.dpi) || 150)),
    output: String(r.output ?? "redacted").replace(/^\/+|\/+$/g, "") || "redacted",
  };
}

const typeOf = (f: string) => TYPES[f.toLowerCase().split(".").pop() ?? ""];
const outName = (s: Settings, f: string) => {
  const base = f.split("/").pop()!;
  const dot = base.lastIndexOf(".");
  return posix.join(s.output, `${dot > 0 ? base.slice(0, dot) : base}.redacted${dot > 0 ? base.slice(dot) : ""}`);
};

interface HitOut { id: string; kind: Kind; value: string; key: string; loc: string; context: string; redact: boolean; preview: string; rects?: Rect[] }
interface FileOut { file: string; type: FileType; hits: HitOut[]; pages?: { w: number; h: number }[]; textChars?: number; error?: string }

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    panelMeta: { "zcode/csp": { wasmUnsafeEval: true } },
    log: options.log,
  });
  const zh = true;
  const pdfJobs = new Map<string, { w: number; h: number; data: Uint8Array }[]>();

  async function loadSettings(raw: any) {
    const prev = (await ws.exists(SETTINGS)) ? normalizeSettings(JSON.parse(await ws.readText(SETTINGS))) : undefined;
    const s = normalizeSettings(raw, prev);
    if (!s.files.length) throw new KitError("no_files", "Pass `files`: the documents to share (PDF, DOCX, XLSX, CSV, TXT, MD).");
    for (const f of s.files) if (!typeOf(f)) throw new KitError("unsupported", `${f}: supported formats are PDF, DOCX, XLSX, CSV, TXT and MD (save .doc/.xls as .docx/.xlsx first).`);
    await ws.write(SETTINGS, JSON.stringify(s, null, 1) + "\n");
    return s;
  }
  const opts = (s: Settings): DetectOptions => ({ kinds: s.kinds, keywords: s.keywords });

  async function scanFile(s: Settings, file: string, fi: number): Promise<FileOut> {
    const type = typeOf(file);
    try {
      const buf = await ws.read(file);
      let found: (Found & { rects?: Rect[] })[] = [];
      let pages: FileOut["pages"], textChars: number | undefined;
      if (type === "text") found = textFind(new TextDecoder().decode(buf), opts(s));
      else if (type === "docx") found = docxFind(buf, opts(s));
      else if (type === "xlsx") found = xlsxFind(buf, opts(s));
      else { const r = await pdfFind(buf, opts(s), options.assetRoot); found = r.found; pages = r.info.pages; textChars = r.info.text; }
      const hits = found.map((f, n) => {
        const key = valueKey(f.kind, f.value);
        return { id: `${fi}:${n}`, kind: f.kind, value: f.value, key, loc: f.loc, context: f.context, redact: !s.keep.includes(key), preview: maskValue(f.kind, f.value, s.mask, zh), rects: f.rects };
      });
      return { file, type, hits, pages, textChars };
    } catch (error) {
      return { file, type, hits: [], error: error instanceof Error ? error.message : String(error) };
    }
  }
  const scanAll = (s: Settings) => Promise.all(s.files.map((f, i) => scanFile(s, f, i)));

  function describe(s: Settings, files: FileOut[], limit = 60) {
    const lines: string[] = [];
    let shown = 0;
    for (const f of files) {
      const red = f.hits.filter((h) => h.redact).length;
      const areas = s.areas.filter((a) => a.file === f.file).length;
      lines.push(`${f.file}: ${f.error ? `ERROR ${f.error}` : `${f.hits.length} found (${red} to redact${f.hits.length - red ? `, ${f.hits.length - red} kept` : ""})${areas ? `, ${areas} manual area(s)` : ""}${f.type === "pdf" && f.textChars === 0 ? " — no text layer (scanned?): only manual areas can be redacted" : ""}`}`);
      for (const h of f.hits) {
        if (shown++ >= limit) break;
        const partial = maskValue(h.kind, h.value, "partial", zh);
        lines.push(`  [${h.id}] ${h.kind} ${h.loc} ${partial}${h.redact ? "" : " (kept)"} — ${h.context.replace(h.value, partial)}`);
      }
    }
    if (shown > limit) lines.push(`… more in the panel.`);
    return [`Looking for: ${s.kinds.join(", ")}${s.keywords.length ? ` + ${s.keywords.length} keyword(s)` : ""}; mask "${s.mask}".`, ...lines].join("\n");
  }
  const result = (kind: string, s: Settings, files: FileOut[], extra: Record<string, unknown> = {}) => ({ kind, settings: s, files, ...extra });

  const settingsSchema = z.record(z.string(), z.unknown()).describe('{files: [...], kinds: ["phone","id","bank","email","amount"], keywords: ["names or terms to hide"], mask: "label"|"block"|"partial", scrubMetadata (author etc., default true), keep: [value keys to leave as is], areas: [{file,page,x,y,w,h} manual PDF boxes], dpi (PDF raster, default 150), output (default "redacted")}');

  tool(
    "redact_scan",
    {
      description:
        "Find personal or sensitive data in documents before sharing them: mobile/landline phone numbers, Chinese ID numbers (checksum-verified), bank card numbers (Luhn-verified), emails, optionally amounts, plus any names or keywords you pass. Supports PDF, DOCX, XLSX, CSV, TXT and MD, including DOCX headers/footers/comments/links and XLSX numeric cells. Opens a panel to review every hit (keep or redact) and draw extra boxes on PDF pages. Values are shown partially masked here.",
      input: { settings: settingsSchema },
      openPanel: true,
      timeoutMs: 300_000,
    },
    async ({ settings }) => {
      const s = await loadSettings(settings);
      const files = await scanAll(s);
      return { text: `${describe(s, files)}\nNext: redact_save to keep some values (by id) or add keywords; redact_export to write the redacted copies (checked automatically).`, structured: result("scan", s, files) };
    },
  );

  tool(
    "redact_save",
    {
      description: "Update what to redact: kinds, keywords, mask style, metadata scrubbing, PDF areas, and which found values to keep unredacted (`keepIds` / `redactIds` from redact_scan; a decision applies to every occurrence of the same value).",
      input: { settings: settingsSchema, keepIds: z.array(z.string()).optional(), redactIds: z.array(z.string()).optional() },
      timeoutMs: 300_000,
    },
    async ({ settings, keepIds, redactIds }) => {
      let s = await loadSettings(settings);
      if (keepIds?.length || redactIds?.length) {
        const files = await scanAll(s);
        const byId = new Map(files.flatMap((f) => f.hits).map((h) => [h.id, h.key]));
        const keep = new Set(s.keep);
        for (const id of keepIds ?? []) { const k = byId.get(id); if (k) keep.add(k); }
        for (const id of redactIds ?? []) { const k = byId.get(id); if (k) keep.delete(k); }
        s = await loadSettings({ ...s, keep: [...keep] });
      }
      const files = await scanAll(s);
      return { text: describe(s, files), structured: result("scan", s, files) };
    },
  );

  async function check(s: Settings, f: FileOut, out: Uint8Array) {
    const type = f.type;
    const pdf = type === "pdf" ? await pdfText(out, options.assetRoot) : undefined;
    const text = pdf ? pdf.pages + pdf.extra : type === "text" ? new TextDecoder().decode(out) : zipAllText(out);
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const h of f.hits) {
      if (!h.redact || seen.has(h.key)) continue;
      seen.add(h.key);
      if (variants(h.kind, h.value).some((v) => text.toLowerCase().includes(v.toLowerCase()))) problems.push(`${h.kind} ${maskValue(h.kind, h.value, "partial", zh)} (${h.loc}) still present`);
    }
    if (pdf && pdf.pages.trim()) problems.push("output PDF still has a text layer");
    return { ok: problems.length === 0, problems, chars: text.length };
  }
  async function writeLog(s: Settings, files: FileOut[], results: Record<string, unknown>[]) {
    const rows = [["file", "location", "kind", "action", "shown_as"].join(",")];
    for (const f of files) for (const h of f.hits) rows.push([f.file, h.loc, h.kind, h.redact ? "redacted" : "kept", h.redact ? (f.type === "pdf" ? "black box" : h.preview) : maskValue(h.kind, h.value, "partial", zh)].map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
    for (const a of s.areas) rows.push([a.file, `p.${a.page}`, "area", "redacted", "black box"].join(","));
    await ws.write(posix.join(s.output, "redaction-log.csv"), "\ufeff" + rows.join("\r\n") + "\r\n");
    await ws.write(posix.join(s.output, "self-check.json"), JSON.stringify(results, null, 1) + "\n");
  }

  tool(
    "redact_export",
    {
      description:
        "Write redacted copies to the output folder (default `redacted/<name>.redacted.<ext>`) plus redaction-log.csv (no original values). DOCX/XLSX/text are edited in place (author metadata removed by default; XLSX numeric cells become text). PDFs are rasterised page by page in the panel with black boxes, so no text layer, links or metadata survive. Every output is re-read afterwards and checked that none of the redacted values remain.",
      input: { settings: settingsSchema },
      openPanel: true,
      timeoutMs: 600_000,
    },
    async ({ settings }) => {
      const s = await loadSettings(settings);
      const files = await scanAll(s);
      const bad = files.filter((f) => f.error);
      if (bad.length) throw new KitError("scan_failed", bad.map((f) => `${f.file}: ${f.error}`).join("; "));
      const results: Record<string, unknown>[] = [];
      const pending: string[] = [];
      for (const f of files) {
        if (f.type === "pdf") { pending.push(f.file); continue; }
        const byPos = new Map(f.hits.map((h) => [`${h.loc}|${h.value}|${h.kind}`, h]));
        const decide: Decide = (hit) => {
          const h = byPos.get(`${hit.loc}|${hit.value}|${hit.kind}`);
          const redact = h ? h.redact : !s.keep.includes(valueKey(hit.kind, hit.value));
          return redact ? maskValue(hit.kind, hit.value, s.mask, zh) : null;
        };
        const buf = await ws.read(f.file);
        const out = f.type === "text" ? new TextEncoder().encode(textApply(new TextDecoder().decode(buf), textFind(new TextDecoder().decode(buf), opts(s)), decide)) : f.type === "docx" ? docxApply(buf, opts(s), decide, s.scrubMetadata) : xlsxApply(buf, opts(s), decide, s.scrubMetadata);
        const path = await ws.write(outName(s, f.file), out);
        const c = await check(s, f, out);
        results.push({ file: f.file, output: path, redacted: f.hits.filter((h) => h.redact).length, kept: f.hits.filter((h) => !h.redact).length, check: c });
      }
      await writeLog(s, files, results);
      const lines = results.map((r: any) => `${r.output}: ${r.redacted} redacted, ${r.kept} kept — self-check ${r.check.ok ? "passed" : `FAILED: ${r.check.problems.join("; ")}`}`);
      if (pending.length) lines.push(`PDF(s) being rasterised in the panel (keep it open): ${pending.join(", ")}. The panel reports the self-check when done.`);
      return { text: lines.join("\n") || "Nothing to export.", structured: result("exported", s, files, { results, pending }) };
    },
  );

  tool(
    "file_data",
    { description: "PDF bytes for the panel.", input: { file: z.string() }, visibility: ["app"], readOnly: true, timeoutMs: 120_000 },
    async ({ file }) => {
      if (typeOf(file) !== "pdf") throw new KitError("not_pdf", file);
      const buf = await ws.read(file);
      return { text: `${buf.length} bytes`, structured: { data: buf.toString("base64") } };
    },
  );

  tool(
    "pdf_page",
    { description: "One rasterised, redacted PDF page from the panel.", input: { job: z.string(), index: z.number().int().min(0), data: z.string(), w: z.number(), h: z.number() }, visibility: ["app"] },
    async ({ job, index, data, w, h }) => {
      const pages = pdfJobs.get(job) ?? [];
      pages[index] = { data: Buffer.from(data, "base64"), w, h };
      pdfJobs.set(job, pages);
      return { text: `page ${index + 1}`, structured: { ok: true } };
    },
  );

  tool(
    "pdf_finish",
    { description: "Assemble the rasterised pages into the redacted PDF and self-check it.", input: { settings: settingsSchema, file: z.string(), job: z.string(), pages: z.number().int().min(1) }, visibility: ["app"], timeoutMs: 600_000 },
    async ({ settings, file, job, pages }) => {
      const s = await loadSettings(settings);
      const parts = pdfJobs.get(job) ?? [];
      pdfJobs.delete(job);
      if (parts.length !== pages || parts.some((p) => !p)) throw new KitError("missing_pages", `Got ${parts.filter(Boolean).length} of ${pages} pages; export again.`);
      const out = await assemble(parts);
      const path = await ws.write(outName(s, file), out);
      const f = await scanFile(s, file, s.files.indexOf(file));
      const c = await check(s, f, out);
      const r = { file, output: path, redacted: f.hits.filter((h) => h.redact).length + s.areas.filter((a) => a.file === file).length, kept: f.hits.filter((h) => !h.redact).length, check: c };
      const logPath = posix.join(s.output, "self-check.json");
      const prev = (await ws.exists(logPath)) ? (JSON.parse(await ws.readText(logPath)) as Record<string, unknown>[]).filter((x) => x.file !== file) : [];
      await ws.write(logPath, JSON.stringify([...prev, r], null, 1) + "\n");
      return { text: `${path}: ${r.redacted} redacted — self-check ${c.ok ? "passed" : `FAILED: ${c.problems.join("; ")}`}`, structured: r };
    },
  );

  tool(
    "workspace_files",
    { description: "Documents for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => ({ text: "", structured: { files: (await ws.list({ exts: Object.keys(TYPES).map((e) => `.${e}`), limit: 3000 })).map((f) => f.path).filter((p) => !p.startsWith("redacted/") && !p.startsWith(".share-redactor/")) } }),
  );

  // pdf.js 的 CMap 与标准字体：面板没有网络，经资源读取。
  server.registerResource("pdfjs-data", new ResourceTemplate(PDFJS_URI, { list: undefined }), { mimeType: "application/octet-stream" }, async (uri, { kind, file }) => {
    const folder = ({ cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>)[String(kind)];
    const name = String(file);
    if (!folder || !/^[\w.-]+$/.test(name)) throw new KitError("bad_resource", uri.href);
    const data = await readFile(join(options.assetRoot, "pdfjs", folder, name));
    return { contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: data.toString("base64") }] };
  });

  return server;
}
