import { readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace } from "./kit/workspace.ts";
import { KINDS, kindOf, pdfRects, readDoc, type Doc } from "./docs.ts";
import { Index, STATUSES, VERDICTS, checkClaim, claimKey, claimsOf, mapRefs, type Claim, type Ref, type Status, type Verdict } from "./check.ts";
import { LABEL, exportCsv, exportHtml, exportMd, langOf } from "./report.ts";

export const NAME = "citation-checker";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const PDFJS_URI = `ui://${NAME}/pdfjs/{kind}/{file}`;
const DIR = ".citation-check";

export interface ServerOptions { workspaceRoot: string; assetRoot: string; log?: (line: string) => void }

export interface State { version: 1; report: string; title: string; sources: { file: string; title: string; kind: string; error?: string }[]; refs: Ref[]; checkedAt: string; claims: Claim[] }

const EXTS = Object.keys(KINDS).map((e) => `.${e}`);
const stateFile = (report: string) => posix.join(DIR, `${report.replace(/[\\/]/g, "__")}.json`);
const isOutput = (f: string) => f.startsWith(`${DIR}/`) || /\.citations\.(html|csv|md)$/i.test(f);

export function summarize(s: State) {
  const by = (st: Status) => s.claims.filter((c) => c.status === st).length;
  const reviewed = s.claims.filter((c) => c.review && c.review.verdict !== "open").length;
  return { claims: s.claims.length, ...Object.fromEntries(STATUSES.map((st) => [st, by(st)])), reviewed, citeMismatch: s.claims.filter((c) => c.citeMismatch).length } as Record<Status | "claims" | "reviewed" | "citeMismatch", number>;
}

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
  const cache = new Map<string, { mtime: number; size: number; doc: Doc }>();
  const indexes = new Map<string, Index>();

  async function load(file: string): Promise<Doc> {
    if (!kindOf(file)) throw new KitError("unsupported", `${file}: supported formats are PDF, DOCX, HTML, Markdown and TXT (save .doc as .docx first).`);
    let info;
    try { info = await stat(ws.resolve(file)); } catch { throw new KitError("not_found", `File not found: ${file}`); }
    const hit = cache.get(file);
    if (hit && hit.mtime === info.mtimeMs && hit.size === info.size) return hit.doc;
    const doc = await readDoc(file, await ws.read(file), options.assetRoot);
    cache.set(file, { mtime: info.mtimeMs, size: info.size, doc });
    return doc;
  }
  async function readState(report: string): Promise<State | undefined> {
    const f = stateFile(report);
    return (await ws.exists(f)) ? (JSON.parse(await ws.readText(f)) as State) : undefined;
  }
  const saveState = (s: State) => ws.write(stateFile(s.report), JSON.stringify(s, null, 1) + "\n");
  async function mustState(report: string) {
    const s = await readState(report);
    if (!s) throw new KitError("not_checked", `${report} has not been checked yet; run cite_check first.`);
    return s;
  }
  async function expandSources(report: string, sources?: string[]) {
    const out: string[] = [];
    const list = sources?.length ? sources : [posix.dirname(report) || "."];
    for (const src of list) {
      const p = src.replace(/\/+$/, "") || ".";
      const abs = ws.resolve(p);
      const info = await stat(abs).catch(() => undefined);
      if (!info) throw new KitError("not_found", `Source not found: ${src}`);
      if (info.isDirectory()) out.push(...(await ws.list({ dir: p, exts: EXTS, limit: 500 })).map((f) => f.path));
      else out.push(ws.rel(abs));
    }
    const files = [...new Set(out)].filter((f) => f !== report && !isOutput(f) && kindOf(f));
    if (!files.length) throw new KitError("no_sources", "No source documents found. Pass `sources`: the PDFs, web pages (.html), DOCX, Markdown or text files the report cites, or a folder containing them.");
    return files;
  }
  async function indexFor(s: Pick<State, "report" | "sources">) {
    const key = s.report + "\n" + s.sources.map((x) => x.file).join("\n");
    const docs = await Promise.all(s.sources.filter((x) => !x.error).map((x) => load(x.file)));
    const prev = indexes.get(key);
    if (prev && prev.docs.length === docs.length && prev.docs.every((d, i) => d === docs[i])) return prev;
    const idx = new Index(docs);
    indexes.set(key, idx);
    return idx;
  }

  const brief = (s: State, zh: boolean) => {
    const sum = summarize(s);
    const L = (st: Status) => LABEL[st][zh ? 0 : 1];
    const lines = [`${s.report}: ${sum.claims} checkable sentences against ${s.sources.filter((x) => !x.error).length} source(s) — ${STATUSES.map((st) => `${L(st)} ${sum[st]}`).join(", ")}; reviewed ${sum.reviewed}/${sum.claims}.`];
    for (const x of s.sources.filter((x) => x.error)) lines.push(`! ${x.file}: ${x.error}`);
    for (const c of s.claims) {
      if (c.status === "ok" && !c.citeMismatch && !c.review) continue;
      const ev = c.evidence[0];
      lines.push(`${c.id} [${c.status}${c.review ? ` → ${c.review.verdict}` : ""}] ${c.loc}: ${c.text}\n   ${c.reason}${c.citeMismatch ? `; ${c.citeMismatch}` : ""}${ev ? `\n   source ${ev.file} ${ev.loc}: “${ev.text}”` : ""}`);
    }
    const ok = s.claims.filter((c) => c.status === "ok" && !c.citeMismatch && !c.review).map((c) => c.id);
    if (ok.length) lines.push(`Supported automatically: ${ok.join(", ")}.`);
    return lines.join("\n");
  };

  tool(
    "cite_check",
    {
      description:
        "Check a report (Markdown, DOCX, TXT, PDF or HTML) against its source documents (PDF, HTML pages saved locally, DOCX, Markdown, TXT). Picks every sentence with a number, a quotation or a citation marker ([1], [^1], 【1】, (Smith, 2020)), finds the closest source passage, and compares each number (万/亿/million/%, ‰, 个百分点 aware; rounding allowed) and each quotation (verbatim). Statuses: number (a number differs — the source value is suggested), quote (quotation not verbatim — closest wording given), missing (no supporting passage), weak (partial or cross-language match; numbers agree but wording needs a human/agent look), ok. Also flags support found in a different source than the one cited. Opens the review panel where each claim jumps to the source page/paragraph with the passage highlighted. Earlier verdicts are kept for unchanged sentences. Everything runs locally.",
      input: {
        report: z.string().describe("Workspace path of the report to check."),
        sources: z.array(z.string()).optional().describe("Source files or folders. Default: every supported file in the report's folder (recursively) except the report."),
      },
      openPanel: true,
      timeoutMs: 600_000,
    },
    async ({ report, sources }) => {
      const rep = await load(report);
      const files = await expandSources(report, sources);
      const src: State["sources"] = [];
      for (const f of files) {
        try { const d = await load(f); src.push({ file: f, title: d.title, kind: d.kind, ...(d.blocks.some((b) => b.text.trim()) ? {} : { error: "no text layer (scanned? run OCR first)" }) }); }
        catch (error) { src.push({ file: f, title: f, kind: kindOf(f) ?? "", error: error instanceof Error ? error.message : String(error) }); }
      }
      const idx = await indexFor({ report, sources: src });
      const { claims, refs } = claimsOf(rep);
      const mapped = mapRefs(refs, idx.docs);
      const prev = await readState(report);
      const reviews = new Map((prev?.claims ?? []).filter((c) => c.review).map((c) => [c.key, c.review!]));
      const out: Claim[] = claims.map((c, i) => {
        const key = claimKey(c.text);
        const r = checkClaim(idx, c.text, mapped);
        return { id: `C${i + 1}`, key, loc: c.loc, ...(c.section ? { section: c.section } : {}), ...r, ...(reviews.has(key) ? { review: reviews.get(key) } : {}) };
      });
      const s: State = { version: 1, report, title: rep.title, sources: src, refs: mapped, checkedAt: new Date().toISOString(), claims: out };
      await saveState(s);
      const zh = langOf(rep) === "zh";
      return { text: brief(s, zh) + "\nReview the flagged claims (use cite_search to look for support, read the evidence), then record verdicts with cite_review; cite_export writes the table.", structured: { kind: "checked", state: s, summary: summarize(s) } };
    },
  );

  tool(
    "cite_review",
    {
      description: "Record verdicts for checked claims (ids from cite_check): supported, partly, wrong, unsupported or open, with an optional note (e.g. the correct figure) and optional evidence location you found yourself. Verdicts survive re-checks while the sentence is unchanged.",
      input: {
        report: z.string(),
        reviews: z.array(z.object({
          id: z.string(),
          verdict: z.enum(VERDICTS as [Verdict, ...Verdict[]]),
          note: z.string().optional(),
          evidence: z.object({ file: z.string(), loc: z.string().optional(), text: z.string().optional() }).optional(),
        })).min(1),
      },
    },
    async ({ report, reviews }) => {
      const s = await mustState(report);
      const unknown: string[] = [];
      for (const r of reviews) {
        const c = s.claims.find((x) => x.id === r.id);
        if (!c) { unknown.push(r.id); continue; }
        c.review = { verdict: r.verdict, ...(r.note?.trim() ? { note: r.note.trim() } : {}), ...(r.evidence ? { evidence: r.evidence } : {}), at: new Date().toISOString() };
      }
      if (unknown.length === reviews.length) throw new KitError("unknown_claim", `Unknown claim id(s): ${unknown.join(", ")}.`);
      await saveState(s);
      const sum = summarize(s);
      return { text: `Saved ${reviews.length - unknown.length} verdict(s); reviewed ${sum.reviewed}/${sum.claims}.${unknown.length ? ` Unknown: ${unknown.join(", ")}.` : ""}`, structured: { kind: "reviewed", state: s, summary: sum } };
    },
  );

  tool(
    "cite_search",
    {
      description: "Search the sources of a checked report for passages about something (keywords or a sentence, any language; numbers are matched by value). Use it to find support for a claim the automatic check missed, or to read more context.",
      input: { report: z.string(), query: z.string().min(1), file: z.string().optional().describe("Limit to one source file."), limit: z.number().int().min(1).max(20).optional() },
      readOnly: true,
    },
    async ({ report, query, file, limit }) => {
      const s = await mustState(report);
      const idx = await indexFor(s);
      const hits = idx.rank(query, { limit: 60 }).map((o) => idx.evidence(o, 200)).filter((e) => !file || e.file === file).slice(0, limit ?? 6);
      return { text: hits.length ? hits.map((e, i) => `${i + 1}. ${e.file} ${e.loc}${e.section ? ` (${e.section})` : ""} — ${Math.round(e.score * 100)}%\n   ${e.text}`).join("\n") : "No matching passage.", structured: { hits } };
    },
  );

  tool(
    "cite_export",
    {
      description: "Write the check table for a checked report: html (self-contained, for sharing), csv (UTF-8 with BOM for Excel) or md. Default html next to the report as <report>.citations.html.",
      input: { report: z.string(), format: z.enum(["html", "csv", "md"]).optional(), output: z.string().optional() },
    },
    async ({ report, format, output }) => {
      const s = await mustState(report);
      const fmt = format ?? "html";
      const rep = await load(report).catch(() => undefined);
      const zh = rep ? langOf(rep) === "zh" : /[\u4e00-\u9fff]/.test(s.claims.map((c) => c.text).join(""));
      const out = output ?? `${report.replace(/\.[^./]+$/, "")}.citations.${fmt}`;
      const body = fmt === "csv" ? exportCsv(s, zh) : fmt === "md" ? exportMd(s, zh) : exportHtml(s, zh);
      const path = await ws.write(out, body);
      return { text: `Wrote ${path} (${s.claims.length} claims).`, structured: { kind: "exported", path, format: fmt } };
    },
  );

  tool(
    "cite_status",
    { description: "Show the saved check results and verdicts for a report (and open the panel).", input: { report: z.string() }, readOnly: true, openPanel: true },
    async ({ report }) => {
      const s = await mustState(report);
      return { text: brief(s, /[\u4e00-\u9fff]/.test(s.title)), structured: { kind: "checked", state: s, summary: summarize(s) } };
    },
  );

  // ---- 面板专用 ----
  tool(
    "source_view",
    { description: "Context around a source passage for the panel (PDF: page + highlight boxes).", input: { report: z.string(), file: z.string(), block: z.number().int().min(0), start: z.number().int().min(0), end: z.number().int().min(0) }, visibility: ["app"], readOnly: true, timeoutMs: 120_000 },
    async ({ report, file, block, start, end }) => {
      const s = await mustState(report);
      if (!s.sources.some((x) => x.file === file)) throw new KitError("not_source", `${file} is not a source of ${report}.`);
      const d = await load(file);
      const b = d.blocks[block];
      if (!b) throw new KitError("bad_block", `${file} has no block ${block}.`);
      if (d.kind === "pdf") {
        const r = await pdfRects(await ws.read(file), options.assetRoot, b.page!, start, end);
        return { text: `${file} p.${b.page}`, structured: { kind: "pdf", file, page: b.page, pages: d.pages!.length, ...r, text: b.text.slice(start, end) } };
      }
      const around = (k: number) => d.blocks[k] && !d.blocks[k].heading ? d.blocks[k].text : d.blocks[k]?.text;
      return {
        text: `${file} ${b.loc}`,
        structured: { kind: "text", file, loc: b.loc, section: b.section, prev: [block - 2, block - 1].map(around).filter(Boolean), before: b.text.slice(0, start), match: b.text.slice(start, end), after: b.text.slice(end), next: [block + 1, block + 2].map(around).filter(Boolean) },
      };
    },
  );
  tool(
    "file_data",
    { description: "PDF bytes for the panel.", input: { report: z.string(), file: z.string() }, visibility: ["app"], readOnly: true, timeoutMs: 120_000 },
    async ({ report, file }) => {
      const s = await mustState(report);
      if (!s.sources.some((x) => x.file === file) || kindOf(file) !== "pdf") throw new KitError("not_pdf_source", file);
      const buf = await ws.read(file);
      return { text: `${buf.length} bytes`, structured: { data: buf.toString("base64") } };
    },
  );
  tool(
    "workspace_files",
    { description: "Documents for the panel, plus reports already checked.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const files = (await ws.list({ exts: EXTS, limit: 3000 })).map((f) => f.path).filter((f) => !isOutput(f));
      const checked = (await ws.exists(DIR)) ? (await ws.list({ dir: DIR, exts: [".json"], limit: 500 })).map((f) => f.path.slice(DIR.length + 1).replace(/\.json$/, "").replace(/__/g, "/")) : [];
      return { text: "", structured: { files, checked } };
    },
  );
  tool(
    "cite_state",
    { description: "Saved state for the panel.", input: { report: z.string() }, visibility: ["app"], readOnly: true },
    async ({ report }) => {
      const s = await mustState(report);
      return { text: "", structured: { kind: "checked", state: s, summary: summarize(s) } };
    },
  );

  server.registerResource("pdfjs-data", new ResourceTemplate(PDFJS_URI, { list: undefined }), { mimeType: "application/octet-stream" }, async (uri, { kind, file }) => {
    const folder = ({ cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" } as Record<string, string>)[String(kind)];
    const name = String(file);
    if (!folder || !/^[\w.-]+$/.test(name)) throw new KitError("bad_resource", uri.href);
    const data = await readFile(join(options.assetRoot, "pdfjs", folder, name));
    return { contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: data.toString("base64") }] };
  });

  return server;
}
