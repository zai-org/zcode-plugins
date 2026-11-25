import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { decodeImage, encodeJpeg, fitWithin } from "./kit/raster.ts";
import { createKitServer } from "./kit/server-kit.ts";
import { KitError, Workspace, safeFileName } from "./kit/workspace.ts";
import { checkTable, normalizeTable, toCsv, type Issue, type ScanTable } from "./check.ts";
import { toXlsx } from "./xlsx.ts";

export const NAME = "table-scan-to-excel";
export const VERSION = "0.1.0";
export const PANEL_URI = `ui://${NAME}/panel.html`;
const IMAGE_EXTS = [".jpg", ".jpeg", ".png"];
const OUT = "tables";

export interface Session {
  version: 1;
  image: string;
  width: number;
  height: number;
  tables: ScanTable[];
  updated: string;
}

export interface ServerOptions {
  workspaceRoot: string;
  assetRoot: string;
  log?: (line: string) => void;
}

const stemOf = (image: string) => safeFileName(basename(image, extname(image)), "table");
export const sessionPath = (image: string) => `${OUT}/${stemOf(image)}.tablescan.json`;

const INSTRUCTIONS = `Transcribe the table(s) in this image, then call table_submit.
Rules:
- One entry per table, rows top to bottom, cells left to right. Copy text and numbers exactly as printed (keep thousands separators, %, currency, brackets, minus signs). Do NOT calculate, correct or fill in anything.
- Every row must have the same number of cells. For merged cells put the text in the top-left cell, "" in the covered cells, and list the merge as {row, col, rowSpan, colSpan} (0-based).
- headerRows = number of header rows at the top.
- List every cell you are not sure about (blurry, handwritten, cut off, ambiguous digit) in uncertain as [row, col]. Empty cells: "".
- bounds = the table's rectangle in the ORIGINAL image pixels {x, y, width, height}, if you can estimate it.
The plugin checks totals and number formats; the user reviews flagged cells in the panel before exporting to Excel.`;

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

  function checkImagePath(image: unknown): string {
    if (typeof image !== "string" || !image.trim()) throw new KitError("missing_image", "Pass `image`: a PNG or JPG in the workspace.");
    ws.resolve(image);
    if (!IMAGE_EXTS.includes(extname(image).toLowerCase())) throw new KitError("bad_image", "Only PNG and JPG images are supported (convert PDF pages or HEIC photos to PNG/JPG first).");
    return image;
  }
  async function decode(image: string) {
    return decodeImage(await ws.read(image, 60 * 1024 * 1024), image);
  }
  async function loadSession(image: string): Promise<Session | undefined> {
    try {
      const s = JSON.parse(await ws.readText(sessionPath(image))) as Session;
      if (s?.image === image && Array.isArray(s.tables)) return { ...s, tables: s.tables.map((t, i) => normalizeTable(t, i).table) };
    } catch {
      // 还没有会话
    }
    return undefined;
  }
  function normalizeAll(tables: unknown) {
    if (!Array.isArray(tables) || !tables.length) throw new KitError("missing_tables", "Pass `tables`: [{name, rows: string[][], headerRows, merges, uncertain, bounds}].");
    const issues: (Issue & { table: number })[] = [];
    const out = tables.map((t, i) => {
      const { table, issues: shape } = normalizeTable((t ?? {}) as Partial<ScanTable>, i);
      if (!table.rows.length) throw new KitError("empty_table", `Table ${i + 1} has no rows.`);
      issues.push(...shape.map((x) => ({ ...x, table: i })));
      return table;
    });
    return { tables: out, shapeIssues: issues };
  }
  async function save(image: string, tables: ScanTable[]) {
    const img = await decode(image);
    const session: Session = { version: 1, image, width: img.width, height: img.height, tables, updated: new Date().toISOString() };
    await ws.write(sessionPath(image), JSON.stringify(session, null, 1) + "\n");
    return session;
  }
  function summary(session: Session, extra: (Issue & { table: number })[] = []) {
    const issues = [...extra, ...session.tables.flatMap((t, i) => checkTable(t).map((x) => ({ ...x, table: i })))];
    const lines = session.tables.map((t, i) => `Table ${i + 1} "${t.name}": ${t.rows.length} rows × ${t.rows[0]?.length ?? 0} columns, ${t.merges.length} merged range(s).`);
    if (issues.length) lines.push(`${issues.length} cell(s) to review:`, ...issues.slice(0, 60).map((x) => `- [${session.tables[x.table].name}] ${x.message}`));
    else lines.push("All totals add up and no uncertain cells are left.");
    return { lines, issues };
  }

  tool(
    "table_scan_open",
    {
      description:
        "Open Table Scan to Excel for a photo or scan of a table (PNG/JPG in the workspace: invoice, statement, printed or handwritten form). Returns the image so you can read it, plus transcription rules; then call table_submit with the cells. Opens the side panel where the user compares the image with the table, fixes flagged cells and exports .xlsx/.csv. If the image was transcribed before, the saved table is loaded instead.",
      input: { image: z.string().describe("Workspace path of the table image.") },
      openPanel: true,
      readOnly: true,
      timeoutMs: 120_000,
    },
    async ({ image }) => {
      const path = checkImagePath(image);
      const img = await decode(path);
      const session = await loadSession(path);
      const view = fitWithin(img, 2000);
      const scale = img.width / view.width;
      const text = session
        ? [`${path} (${img.width}×${img.height}) was transcribed before (${sessionPath(path)}).`, ...summary(session).lines, "Call table_submit again only if the user wants a fresh transcription."].join("\n")
        : `${path}: ${img.width}×${img.height} px${scale > 1.01 ? ` (the copy below is scaled by 1/${scale.toFixed(2)}; give bounds in original pixels)` : ""}.\n\n${INSTRUCTIONS}`;
      return {
        text,
        images: session ? [] : [{ data: encodeJpeg(view, 88).toString("base64"), mimeType: "image/jpeg" }],
        structured: { kind: "open", image: path, width: img.width, height: img.height, session: session ?? null },
      };
    },
  );

  const tablesInput = z
    .array(z.record(z.string(), z.unknown()))
    .describe('[{name: "Sheet name", rows: [["Item","Qty","Amount"],["Paper","2","1,200.00"],["Total","","1,200.00"]], headerRows: 1, merges: [{row,col,rowSpan,colSpan}], uncertain: [[row,col]], bounds: {x,y,width,height}}] — 0-based rows/cols.');

  tool(
    "table_submit",
    {
      description:
        "Submit your transcription of the table image (after table_scan_open). The plugin pads ragged rows, checks every total/subtotal row against the numbers above it, finds non-numbers in numeric columns and lists uncertain cells; it saves the table and shows it next to the image in the panel for the user to review. Fix what you can see clearly by calling table_submit again; leave the rest to the user.",
      input: { image: z.string(), tables: tablesInput },
      timeoutMs: 120_000,
    },
    async ({ image, tables }) => {
      const path = checkImagePath(image);
      const { tables: clean, shapeIssues } = normalizeAll(tables);
      const previous = await loadSession(path);
      // 重新提交时保留用户确认过且文字没变的格子。
      if (previous)
        clean.forEach((t, i) => {
          const old = previous.tables[i];
          if (old) t.confirmed = old.confirmed.filter(([r, c]) => old.rows[r]?.[c] === t.rows[r]?.[c] && !t.confirmed.some(([a, b]) => a === r && b === c)).concat(t.confirmed);
        });
      const session = await save(path, clean);
      const { lines, issues } = summary(session, shapeIssues);
      lines.push("The user can now review in the panel; call table_export when they are done (or if they ask you to export directly).");
      return { text: lines.join("\n"), structured: { kind: "session", session, issues, sessionPath: sessionPath(path) } };
    },
  );

  tool(
    "table_save",
    {
      description: "Save edits made in the panel (cell text, confirmed cells, merges, table names).",
      input: { image: z.string(), tables: tablesInput },
      visibility: ["app"],
    },
    async ({ image, tables }) => {
      const path = checkImagePath(image);
      const session = await save(path, normalizeAll(tables).tables);
      return { text: `Saved ${sessionPath(path)}.`, structured: { kind: "saved", session } };
    },
  );

  tool(
    "table_export",
    {
      description:
        "Export the reviewed table(s) for an image: an .xlsx with one sheet per table (header rows bold and frozen, merged cells kept, numbers stored as real numbers with their thousands/decimal/percent format; cells still to check highlighted yellow and total mismatches red, each with a comment) and/or one UTF-8 .csv per table. Uses the saved transcription unless `tables` is given.",
      input: {
        image: z.string(),
        format: z.enum(["xlsx", "csv", "both"]).optional().describe("Default xlsx."),
        output: z.string().optional().describe(`Output .xlsx path (default ${OUT}/<image name>.xlsx).`),
        tables: tablesInput.optional(),
      },
      timeoutMs: 120_000,
    },
    async ({ image, format = "xlsx", output, tables }) => {
      const path = checkImagePath(image);
      const session = tables ? await save(path, normalizeAll(tables).tables) : await loadSession(path);
      if (!session) throw new KitError("not_transcribed", `${path} has not been transcribed yet — call table_scan_open, then table_submit.`);
      const base = output ? output.replace(/\.xlsx$/i, "") : `${OUT}/${stemOf(path)}`;
      ws.resolve(base);
      const files: string[] = [];
      if (format !== "csv") files.push(await ws.write(`${base}.xlsx`, await toXlsx(session.tables, path)));
      if (format !== "xlsx")
        for (const [i, t] of session.tables.entries()) files.push(await ws.write(session.tables.length > 1 ? `${base}-${safeFileName(t.name, `table${i + 1}`)}.csv` : `${base}.csv`, toCsv(t)));
      const { issues } = summary(session);
      const text = `Exported ${files.join(", ")}.${issues.length ? ` ${issues.length} cell(s) still flagged (highlighted with comments in Excel).` : ""}`;
      return { text, structured: { kind: "exported", files, open: issues.length, session } };
    },
  );

  tool(
    "image_view",
    { description: "Image for the panel (JPEG, max 2400 px).", input: { image: z.string() }, visibility: ["app"], readOnly: true },
    async ({ image }) => {
      const path = checkImagePath(image);
      const img = await decode(path);
      const view = fitWithin(img, 2400);
      return { text: `${img.width}×${img.height}`, structured: { data: encodeJpeg(view, 85).toString("base64"), width: img.width, height: img.height, session: (await loadSession(path)) ?? null } };
    },
  );

  tool(
    "workspace_files",
    { description: "List images (and which ones already have a transcription) for the panel picker.", input: {}, visibility: ["app"], readOnly: true },
    async () => {
      const images = (await ws.list({ exts: IMAGE_EXTS, limit: 3000 })).map((f) => f.path);
      const sessions = (await ws.list({ dir: OUT, exts: [".json"], recursive: false }).catch(() => [])).map((f) => f.path);
      return { text: `${images.length} image(s)`, structured: { images: images.map((p) => ({ path: p, done: sessions.includes(sessionPath(p)) })) } };
    },
  );

  return server;
}
