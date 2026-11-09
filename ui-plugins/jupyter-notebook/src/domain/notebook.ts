import { randomBytes } from "node:crypto";
import {
  JupyterError,
  LIMITS,
  type Cell,
  type CellType,
  type EditOperation,
  type MimeBundle,
  type Output,
  type Position,
} from "#nb/contract.ts";

const CELL_ID = /^[a-zA-Z0-9-_]{1,64}$/;
const CELL_TYPES = new Set<CellType>(["code", "markdown", "raw"]);

export const newCellId = () => randomBytes(4).toString("hex");

const joinText = (value: unknown): string =>
  Array.isArray(value) ? value.join("") : typeof value === "string" ? value : "";

/** JSON 类 mime 保留对象；其他（文本、base64 图片）多行数组合并为字符串。 */
const isJsonMime = (mime: string) => mime === "application/json" || mime.endsWith("+json");

export function normalizeBundle(data: unknown): MimeBundle {
  if (!data || typeof data !== "object") return {};
  const out: MimeBundle = {};
  for (const [mime, value] of Object.entries(data as Record<string, unknown>))
    out[mime] = isJsonMime(mime) ? value : Array.isArray(value) ? value.join("") : value;
  return out;
}

export function normalizeOutput(raw: unknown): Output | null {
  if (!raw || typeof raw !== "object") return null;
  const output = raw as Record<string, unknown>;
  switch (output.output_type) {
    case "stream":
      return {
        output_type: "stream",
        name: output.name === "stderr" ? "stderr" : "stdout",
        text: joinText(output.text),
      };
    case "display_data":
      return {
        output_type: "display_data",
        data: normalizeBundle(output.data),
        metadata: (output.metadata as Record<string, unknown>) ?? {},
      };
    case "execute_result":
      return {
        output_type: "execute_result",
        data: normalizeBundle(output.data),
        metadata: (output.metadata as Record<string, unknown>) ?? {},
        execution_count:
          typeof output.execution_count === "number" ? output.execution_count : null,
      };
    case "error":
      return {
        output_type: "error",
        ename: String(output.ename ?? "Error"),
        evalue: String(output.evalue ?? ""),
        traceback: Array.isArray(output.traceback) ? output.traceback.map(String) : [],
      };
    default:
      return null;
  }
}

export interface NotebookContent {
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
}

/** 读入任意 nbformat 4 JSON：source 归一为字符串，补齐 / 去重 cell id。 */
export function normalizeNotebook(raw: unknown): NotebookContent {
  const nb = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const nbformat = typeof nb.nbformat === "number" ? nb.nbformat : 4;
  if (nbformat !== 4)
    throw new JupyterError(
      "jupyter_error",
      `Only nbformat 4 notebooks are supported (this one is nbformat ${nbformat}).`,
    );
  const seen = new Set<string>();
  const cells: Cell[] = (Array.isArray(nb.cells) ? nb.cells : []).map((rawCell) => {
    const cell = (rawCell ?? {}) as Record<string, unknown>;
    const type: CellType = CELL_TYPES.has(cell.cell_type as CellType)
      ? (cell.cell_type as CellType)
      : "raw";
    let id = typeof cell.id === "string" && CELL_ID.test(cell.id) ? cell.id : newCellId();
    while (seen.has(id)) id = newCellId();
    seen.add(id);
    return {
      id,
      type,
      source: joinText(cell.source),
      revision: 1,
      executionCount:
        type === "code" && typeof cell.execution_count === "number" ? cell.execution_count : null,
      outputs:
        type === "code" && Array.isArray(cell.outputs)
          ? cell.outputs.map(normalizeOutput).filter((output): output is Output => output !== null)
          : [],
      metadata: (cell.metadata as Record<string, unknown>) ?? {},
      ...(cell.attachments && typeof cell.attachments === "object"
        ? { attachments: cell.attachments as Record<string, MimeBundle> }
        : {}),
      run: null,
    };
  });
  return {
    cells,
    metadata: (nb.metadata as Record<string, unknown>) ?? {},
    nbformat: 4,
    nbformatMinor: typeof nb.nbformat_minor === "number" ? nb.nbformat_minor : 5,
  };
}

/** 与 Jupyter 写盘格式一致：多行文本存为按行切分的数组。 */
export function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/(?<=\n)/);
  return lines;
}

function serializeBundle(data: MimeBundle): MimeBundle {
  const out: MimeBundle = {};
  for (const [mime, value] of Object.entries(data))
    out[mime] =
      typeof value === "string" && !isJsonMime(mime) && (mime.startsWith("text/") || mime === "image/svg+xml")
        ? splitLines(value)
        : value;
  return out;
}

export function serializeOutput(output: Output): Record<string, unknown> {
  switch (output.output_type) {
    case "stream":
      return { output_type: "stream", name: output.name, text: splitLines(output.text) };
    case "display_data":
      return { output_type: "display_data", data: serializeBundle(output.data), metadata: output.metadata };
    case "execute_result":
      return {
        output_type: "execute_result",
        data: serializeBundle(output.data),
        metadata: output.metadata,
        execution_count: output.execution_count,
      };
    case "error":
      return {
        output_type: "error",
        ename: output.ename,
        evalue: output.evalue,
        traceback: output.traceback,
      };
  }
}

/** 写回 nbformat 4.5+（cell id 需要 4.5）。 */
export function serializeNotebook(content: NotebookContent): Record<string, unknown> {
  return {
    nbformat: 4,
    nbformat_minor: Math.max(content.nbformatMinor, 5),
    metadata: content.metadata,
    cells: content.cells.map((cell) => {
      const base: Record<string, unknown> = {
        id: cell.id,
        cell_type: cell.type,
        metadata: cell.metadata,
        source: splitLines(cell.source),
      };
      if (cell.type === "code") {
        base.execution_count = cell.executionCount;
        base.outputs = cell.outputs.map(serializeOutput);
      } else if (cell.attachments) {
        base.attachments = cell.attachments;
      }
      return base;
    }),
  };
}

export function emptyNotebook(kernel?: { name: string; displayName: string; language: string }) {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: kernel
      ? {
          kernelspec: { name: kernel.name, display_name: kernel.displayName, language: kernel.language },
          language_info: { name: kernel.language },
        }
      : {},
    cells: [],
  };
}

// ---------------------------------------------------------------------------
// 编辑
// ---------------------------------------------------------------------------

const fail = (message: string, details?: Record<string, unknown>): never => {
  throw new JupyterError("invalid_operation", message, details);
};

function indexOfCell(cells: Cell[], cellId: string): number {
  const index = cells.findIndex((cell) => cell.id === cellId);
  if (index < 0)
    throw new JupyterError("cell_not_found", `No cell with id "${cellId}".`, { cellId });
  return index;
}

function resolvePosition(cells: Cell[], position: Position): number {
  const given = [position.index !== undefined, !!position.after, !!position.before].filter(Boolean);
  if (given.length > 1) fail("Give at most one of index, after or before.");
  if (position.after) return indexOfCell(cells, position.after) + 1;
  if (position.before) return indexOfCell(cells, position.before);
  if (position.index !== undefined) {
    if (!Number.isInteger(position.index) || position.index < 0 || position.index > cells.length)
      fail(`index ${position.index} is out of range 0–${cells.length}.`);
    return position.index;
  }
  return cells.length;
}

const checkType = (type: unknown): CellType =>
  CELL_TYPES.has(type as CellType)
    ? (type as CellType)
    : fail(`Unknown cell type "${String(type)}"; use code, markdown or raw.`);

export interface ApplyResult {
  cells: Cell[];
  inserted: string[];
  /** 内容（source / 结构 / type）是否变化；只清输出不算。 */
  contentChanged: boolean;
  /** 被修改 source 或新插入的 cell。 */
  touched: string[];
}

/**
 * 原子应用一批操作：在副本上依次执行，任何一步失败都抛错，原数组不变。
 * cell 级 expectedRevision 不匹配时抛 revision_conflict 并附当前 cell。
 */
export function applyOperations(cells: Cell[], operations: EditOperation[]): ApplyResult {
  if (operations.length > LIMITS.operations)
    fail(`At most ${LIMITS.operations} operations per call.`);
  let next = cells.slice();
  const inserted: string[] = [];
  const touched = new Set<string>();
  let contentChanged = false;
  const replace = (index: number, patch: Partial<Cell>) => {
    next[index] = { ...next[index]!, ...patch };
  };

  operations.forEach((operation, step) => {
    switch (operation.op) {
      case "insert": {
        const type = checkType(operation.type ?? "code");
        let id = operation.id ?? newCellId();
        if (!CELL_ID.test(id)) fail(`Invalid cell id "${id}".`);
        if (next.some((cell) => cell.id === id)) {
          if (operation.id) fail(`A cell with id "${id}" already exists.`);
          while (next.some((cell) => cell.id === id)) id = newCellId();
        }
        const index = resolvePosition(next, operation);
        next.splice(index, 0, {
          id,
          type,
          source: operation.source ?? "",
          revision: 1,
          executionCount: null,
          outputs: [],
          metadata: {},
          run: null,
        });
        inserted.push(id);
        touched.add(id);
        contentChanged = true;
        break;
      }
      case "update": {
        const index = indexOfCell(next, operation.cellId);
        const cell = next[index]!;
        if (operation.expectedRevision !== undefined && operation.expectedRevision !== cell.revision)
          throw new JupyterError(
            "revision_conflict",
            `Cell ${cell.id} changed (revision ${cell.revision}, expected ${operation.expectedRevision}).`,
            { cellId: cell.id, revision: cell.revision, source: cell.source, step },
          );
        if (typeof operation.source !== "string") fail("update needs a string source.");
        if (cell.source === operation.source) break;
        replace(index, { source: operation.source, revision: cell.revision + 1 });
        touched.add(cell.id);
        contentChanged = true;
        break;
      }
      case "move": {
        const from = indexOfCell(next, operation.cellId);
        const [cell] = next.splice(from, 1);
        const to = resolvePosition(next, operation);
        next.splice(to, 0, cell!);
        if (to !== from) contentChanged = true;
        break;
      }
      case "delete": {
        const index = indexOfCell(next, operation.cellId);
        next.splice(index, 1);
        contentChanged = true;
        break;
      }
      case "set_type": {
        const index = indexOfCell(next, operation.cellId);
        const cell = next[index]!;
        const type = checkType(operation.type);
        if (cell.type === type) break;
        replace(index, {
          type,
          revision: cell.revision + 1,
          outputs: type === "code" ? cell.outputs : [],
          executionCount: type === "code" ? cell.executionCount : null,
        });
        touched.add(cell.id);
        contentChanged = true;
        break;
      }
      case "clear_outputs": {
        if (operation.cellId) {
          const index = indexOfCell(next, operation.cellId);
          replace(index, { outputs: [], executionCount: null });
        } else {
          next = next.map((cell) =>
            cell.type === "code" ? { ...cell, outputs: [], executionCount: null } : cell,
          );
        }
        break;
      }
      default:
        fail(`Unknown operation "${(operation as { op?: string }).op}".`);
    }
  });
  return { cells: next, inserted, contentChanged, touched: [...touched] };
}
