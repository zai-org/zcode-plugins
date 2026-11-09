import { LIMITS, type Cell, type NotebookDoc, type Output } from "#nb/contract.ts";

// oxlint-disable-next-line no-control-regex -- ANSI / 终端控制字符是有意匹配的
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, "");

const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  return `${text.slice(0, head)}\n… [${text.length - limit} characters omitted] …\n${text.slice(-tail)}`;
}

/** 粗略 HTML → 文本，只在没有 text/plain 时使用。 */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(tr|p|div|h\d|li)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const str = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 1));

/** 单个输出给模型的文本形式。图片只写占位，由调用方决定是否附图片内容块。 */
export function outputText(output: Output): string {
  switch (output.output_type) {
    case "stream":
      return `[${output.name}]\n${stripAnsi(output.text)}`;
    case "error": {
      const trace = stripAnsi(output.traceback.join("\n"));
      return `[error] ${output.ename}: ${output.evalue}${trace ? `\n${trace}` : ""}`;
    }
    case "display_data":
    case "execute_result": {
      const label =
        output.output_type === "execute_result"
          ? `[Out${output.execution_count !== null ? `[${output.execution_count}]` : ""}]`
          : "[display]";
      const data = output.data;
      const parts: string[] = [];
      const image = IMAGE_MIMES.find((mime) => typeof data[mime] === "string");
      if (image) parts.push(`(${image} image${data["image/svg+xml"] ? ", also SVG" : ""})`);
      else if (data["image/svg+xml"]) parts.push("(image/svg+xml image)");
      if (data["application/vnd.jupyter.widget-view+json"])
        parts.push("(interactive widget; not supported here)");
      if (typeof data["text/markdown"] === "string") parts.push(str(data["text/markdown"]));
      else if (typeof data["text/latex"] === "string") parts.push(str(data["text/latex"]));
      else if (data["text/plain"] !== undefined) parts.push(stripAnsi(str(data["text/plain"])));
      else if (typeof data["text/html"] === "string") parts.push(htmlToText(data["text/html"]));
      else if (data["application/json"] !== undefined) parts.push(str(data["application/json"]));
      return `${label} ${parts.join("\n")}`.trim();
    }
  }
}

export interface ImageRef {
  cellId: string;
  mimeType: string;
  data: string;
}

/** 收集 cell 输出中的位图（base64），用于作为图片内容块返回给模型。 */
export function collectImages(cells: Cell[], limit: number = LIMITS.modelImages): ImageRef[] {
  const images: ImageRef[] = [];
  for (const cell of cells) {
    for (const output of cell.outputs) {
      if (output.output_type !== "display_data" && output.output_type !== "execute_result") continue;
      const mime = IMAGE_MIMES.find((item) => typeof output.data[item] === "string");
      if (!mime) continue;
      const data = (output.data[mime] as string).replace(/\s+/g, "");
      if (data.length * 0.75 > LIMITS.modelImageBytes) continue;
      images.push({ cellId: cell.id, mimeType: mime, data });
      if (images.length >= limit) return images;
    }
  }
  return images;
}

function runLabel(cell: Cell): string {
  if (cell.type !== "code") return "";
  const parts: string[] = [];
  if (cell.executionCount !== null) parts.push(`exec=${cell.executionCount}`);
  if (cell.run) parts.push(cell.run.state);
  else if (cell.executionCount === null) parts.push("not run");
  return parts.join(" ");
}

export function renderCell(
  cell: Cell,
  index: number,
  { includeOutputs = true, maxOutputChars = LIMITS.outputCharsPerCell }: { includeOutputs?: boolean; maxOutputChars?: number } = {},
): string {
  const head = `### [${index}] ${cell.type} id=${cell.id} rev=${cell.revision}${cell.type === "code" ? ` ${runLabel(cell)}` : ""}`;
  const fence = cell.source.includes("```") ? "````" : "```";
  const lang = cell.type === "code" ? "python" : cell.type === "markdown" ? "markdown" : "";
  const lines = [head, `${fence}${lang}`, cell.source, fence];
  if (includeOutputs && cell.type === "code" && cell.outputs.length) {
    const text = cell.outputs.map(outputText).join("\n");
    lines.push("Outputs:", clip(text, maxOutputChars));
  }
  return lines.join("\n");
}

export function notebookHeader(doc: NotebookDoc): string {
  const kernel = doc.kernel.displayName ?? doc.kernel.name ?? "no kernel";
  const running = doc.cells.filter((cell) => cell.run?.state === "running" || cell.run?.state === "queued").length;
  return [
    `Notebook \`${doc.path}\` (id ${doc.id}) on server ${doc.serverId}: revision ${doc.revision}, ${doc.cells.length} cells.`,
    `Kernel: ${kernel}, ${doc.kernel.status}${running ? `, ${running} cell(s) queued or running` : ""}. Save state: ${doc.save.state}${doc.save.error ? ` (${doc.save.error})` : ""}.`,
  ].join("\n");
}

/** read_notebook 的文本：在字符预算内依次渲染 cell，超出部分给出续读提示。 */
export function renderNotebook(
  doc: NotebookDoc,
  {
    cellIds,
    includeOutputs = true,
    maxOutputChars = LIMITS.outputCharsPerCell,
    budget = LIMITS.summaryChars,
  }: { cellIds?: string[]; includeOutputs?: boolean; maxOutputChars?: number; budget?: number } = {},
): string {
  const wanted = cellIds?.length ? new Set(cellIds) : null;
  const parts = [notebookHeader(doc)];
  if (!doc.cells.length) parts.push("The notebook has no cells yet.");
  let used = parts[0]!.length;
  const skipped: string[] = [];
  doc.cells.forEach((cell, index) => {
    if (wanted && !wanted.has(cell.id)) return;
    const text = renderCell(cell, index, { includeOutputs, maxOutputChars });
    if (used + text.length > budget) {
      skipped.push(cell.id);
      return;
    }
    used += text.length;
    parts.push(text);
  });
  if (wanted) {
    const missing = [...wanted].filter((id) => !doc.cells.some((cell) => cell.id === id));
    if (missing.length) parts.push(`No cells with ids: ${missing.join(", ")}.`);
  }
  if (skipped.length)
    parts.push(
      `… ${skipped.length} more cell(s) not shown to stay within the size limit: ${skipped.join(", ")}. Read them with cellIds, or set includeOutputs=false.`,
    );
  return parts.join("\n\n");
}
