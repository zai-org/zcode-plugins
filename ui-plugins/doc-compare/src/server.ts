
import { z } from "zod";
import { createKitServer } from "./kit/server-kit.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KitError, safeFileName, Workspace } from "./kit/workspace.ts";
import { compare, type Options } from "./compare.ts";
import { extract } from "./extract.ts";
import { reportCsv, reportHtml, type Review, type Reviewed, type Status } from "./report.ts";

export const NAME = "doc-compare";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");

export function createServer(options: ServerOptions) {
  const ws = new Workspace(options.workspaceRoot);
  const { server, tool } = createKitServer({
    name: NAME,
    version: VERSION,
    panelUri: PANEL_URI,
    surface: "editor",
    panelHtml: () => readFile(join(options.assetRoot, "ui/panel.html"), "utf8"),
    log: options.log,
  });

  // 评审标记是“读-改-写”，排队执行，避免并发请求互相覆盖。
  let reviewQueue: Promise<unknown> = Promise.resolve();
  const reviewPath = (a: string, b: string) => `doc-compare/${safeFileName(`${stem(a)}__${stem(b)}`, "compare")}.review.json`;
  async function loadReviews(a: string, b: string): Promise<{ reviews: Record<string, Review>; options: Options }> {
    const p = reviewPath(a, b);
    if (!(await ws.exists(p))) return { reviews: {}, options: {} };
    try {
      const j = JSON.parse(await ws.readText(p));
      return { reviews: j.reviews ?? {}, options: j.options ?? {} };
    } catch {
      return { reviews: {}, options: {} };
    }
  }

  async function run(a: string, b: string, opts?: Options) {
    if (!a || !b) throw new KitError("missing_file", "Pass both `old` and `new` files.");
    if (a === b) throw new KitError("same_file", "`old` and `new` are the same file.");
    const saved = await loadReviews(a, b);
    const o: Options = { ignoreCase: opts?.ignoreCase ?? saved.options.ignoreCase ?? false, ignorePunctuation: opts?.ignorePunctuation ?? saved.options.ignorePunctuation ?? false };
    const [bufA, bufB] = [await ws.read(a), await ws.read(b)];
    const [A, B] = await Promise.all([extract(a, bufA, options.assetRoot), extract(b, bufB, options.assetRoot)]);
    if (!A.length) throw new KitError("empty", `${a}: no text found.`);
    if (!B.length) throw new KitError("empty", `${b}: no text found.`);
    const r = compare(A, B, o);
    const changes: Reviewed[] = r.changes.map((c) => ({ ...c, status: saved.reviews[c.id]?.status ?? "open", note: saved.reviews[c.id]?.note ?? "" }));
    return { A, B, rows: r.rows, changes, stats: r.stats, o, reviews: saved.reviews };
  }
  async function saveReviews(a: string, b: string, reviews: Record<string, Review>, o: Options) {
    await ws.write(reviewPath(a, b), JSON.stringify({ old: a, new: b, options: o, reviews, saved: new Date().toISOString() }, null, 1) + "\n");
  }
  const reviewCounts = (changes: Reviewed[]) => ({ ok: changes.filter((c) => c.status === "ok").length, question: changes.filter((c) => c.status === "question").length, open: changes.filter((c) => c.status === "open").length });
  function describe(a: string, b: string, x: Awaited<ReturnType<typeof run>>, limit = 80) {
    const s = x.stats, rc = reviewCounts(x.changes);
    const lines = x.changes.slice(0, limit).map((c) => `[${c.id}] ${c.kind}${c.numbers ? " #" : ""} (${c.oldLoc ?? "—"} → ${c.newLoc ?? "—"})${c.status !== "open" ? ` {${c.status}${c.note ? `: ${c.note}` : ""}}` : ""}: ${c.summary}`);
    return [
      `${a} (${s.oldParas} paragraphs) → ${b} (${s.newParas} paragraphs): ${x.changes.length} change(s): ${s.modified} modified, ${s.added} added, ${s.deleted} deleted, ${s.moved} moved; ${s.numbers} involve numbers (#). Review: ${rc.ok} confirmed, ${rc.question} questioned, ${rc.open} open.`,
      ...lines,
      x.changes.length > limit ? `… ${x.changes.length - limit} more in the panel.` : "",
    ].filter(Boolean).join("\n");
  }
  const structured = (a: string, b: string, x: Awaited<ReturnType<typeof run>>) => ({ kind: "compare", old: a, new: b, A: x.A, B: x.B, rows: x.rows, changes: x.changes, stats: x.stats, options: x.o, review: reviewCounts(x.changes) });

  tool(
    "compare_open",
    {
      description:
        "Compare two versions of a document (.docx, .pdf with a text layer, .md or .txt; formats can differ). Paragraphs are aligned, then each changed paragraph gets a word-level diff (character-level for Chinese/Japanese/Korean). Lists every change (modified/added/deleted/moved, # = involves numbers such as amounts or dates) with locations, and opens a side-by-side review panel where each change can be marked confirmed or questioned. Earlier review marks are kept.",
      input: { old: z.string().describe("Older version"), new: z.string().describe("Newer version"), ignoreCase: z.boolean().optional(), ignorePunctuation: z.boolean().optional() },
      openPanel: true,
      readOnly: true,
      timeoutMs: 180_000,
    },
    async (args) => {
      const x = await run(args.old, args.new, { ignoreCase: args.ignoreCase, ignorePunctuation: args.ignorePunctuation });
      return { text: describe(args.old, args.new, x), structured: structured(args.old, args.new, x) };
    },
  );

  tool(
    "compare_review",
    {
      description: "Mark changes as confirmed (ok), questioned (question) or open, with an optional note (e.g. why a change matters or what to ask the other side). Ids come from compare_open. Saved next to the comparison and kept when it is re-run.",
      input: {
        old: z.string(),
        new: z.string(),
        reviews: z.array(z.object({ id: z.string(), status: z.enum(["open", "ok", "question"]).optional(), note: z.string().optional() })),
        ignoreCase: z.boolean().optional(),
        ignorePunctuation: z.boolean().optional(),
      },
      timeoutMs: 180_000,
    },
    (args) => {
      const job = reviewQueue.catch(() => undefined).then(async () => {
      const x = await run(args.old, args.new, { ignoreCase: args.ignoreCase, ignorePunctuation: args.ignorePunctuation });
      const unknown: string[] = [];
      for (const r of args.reviews) {
        const c = x.changes.find((ch) => ch.id === r.id);
        if (!c) { unknown.push(r.id); continue; }
        if (r.status) c.status = r.status as Status;
        if (r.note !== undefined) c.note = r.note.slice(0, 2000);
      }
      const reviews: Record<string, Review> = { ...x.reviews };
      for (const c of x.changes) if (c.status !== "open" || c.note) reviews[c.id] = { status: c.status, note: c.note }; else delete reviews[c.id];
      await saveReviews(args.old, args.new, reviews, x.o);
      const rc = reviewCounts(x.changes);
      return { text: `Saved ${args.reviews.length - unknown.length} review(s): ${rc.ok} confirmed, ${rc.question} questioned, ${rc.open} open.${unknown.length ? ` Unknown id(s): ${unknown.join(", ")} (re-run compare_open; ids change when a paragraph changes).` : ""}`, structured: structured(args.old, args.new, x) };
      });
      reviewQueue = job;
      return job;
    },
  );

  tool(
    "compare_export",
    {
      description: "Export the comparison report: HTML (side-by-side with highlighted insertions/deletions, statuses and notes; printable) and/or CSV (one row per change, opens in Excel). `only` limits it to open or questioned changes.",
      input: { old: z.string(), new: z.string(), format: z.enum(["html", "csv", "both"]).optional(), only: z.enum(["all", "open", "question"]).optional() },
      timeoutMs: 180_000,
    },
    async (args) => {
      const x = await run(args.old, args.new);
      const list = args.only && args.only !== "all" ? x.changes.filter((c) => c.status === args.only) : x.changes;
      const base = `doc-compare/${safeFileName(`${stem(args.old)}__${stem(args.new)}`, "compare")}${args.only && args.only !== "all" ? `-${args.only}` : ""}`;
      const files: string[] = [];
      const fmt = args.format ?? "both";
      if (fmt !== "csv") files.push(await ws.write(`${base}.html`, reportHtml({ oldName: args.old, newName: args.new, changes: list, stats: x.stats, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" })));
      if (fmt !== "html") files.push(await ws.write(`${base}.csv`, reportCsv(list)));
      return { text: `Exported ${list.length} change(s) → ${files.join(", ")}`, structured: { kind: "exported", files, count: list.length } };
    },
  );

  tool(
    "workspace_files",
    { description: "Documents for the panel.", input: {}, visibility: ["app"], readOnly: true },
    async () => ({ text: "", structured: { files: (await ws.list({ exts: [".docx", ".pdf", ".md", ".markdown", ".txt"], limit: 3000 })).map((f) => f.path).filter((p) => !p.startsWith("doc-compare/")) } }),
  );

  return server;
}
