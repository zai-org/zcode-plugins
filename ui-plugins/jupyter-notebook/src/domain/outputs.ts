import { LIMITS, type Output, type StreamOutput } from "#nb/contract.ts";
import { normalizeBundle } from "#nb/domain/notebook.ts";

/** 一个 cell 运行中的输出状态。clearPending 对应 `clear_output(wait=True)`：下一个输出到达时才清空。 */
export interface OutputState {
  outputs: Output[];
  clearPending: boolean;
  /** 仅内存：归一化文本不再包含回车，必须单独保留最后一个 stream 的写入位置。 */
  stream?: StreamCursor;
}

export interface StreamCursor {
  output: StreamOutput;
  cursor: number;
  lineStart: number;
}

/** 只处理新到达的文本；光标以最后一个未结束的行内 UTF-16 位置记录。 */
function appendStream(previous: string, text: string, cursor: number, lineStart: number) {
  let value = previous;
  // oxlint-disable-next-line no-control-regex -- 终端控制字符需要逐个处理，普通文字按块覆盖。
  for (const part of text.split(/([\r\n\x08])/)) {
    if (part === "\r") cursor = lineStart;
    else if (part === "\n") {
      value += "\n";
      cursor = value.length;
      lineStart = cursor;
    } else if (part === "\b") {
      if (cursor > lineStart) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor -= 1;
      }
    } else if (part) {
      value = value.slice(0, cursor) + part + value.slice(cursor + part.length);
      cursor += part.length;
    }
  }
  return { text: value, cursor, lineStart };
}

/** 处理终端控制字符：`\r` 回到行首（进度条覆盖），`\b` 删除光标前一字符。 */
export function applyControlChars(text: string): string {
  return appendStream("", text, 0, 0).text;
}

/** 超长 stream 保留首尾。 */
export function capText(text: string, limit: number = LIMITS.streamChars): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.4);
  const tail = limit - head;
  const dropped = text.length - limit;
  return `${text.slice(0, head)}\n… [${dropped} characters omitted] …\n${text.slice(-tail)}`;
}

const takeClear = (state: OutputState): Output[] => (state.clearPending ? [] : state.outputs);

/**
 * 把一条 iopub 消息并入当前 cell 的输出。返回新状态；不认识的消息原样返回。
 * update_display_data 跨 cell 生效，由调用方用 updateDisplay 处理。
 */
export function reduceOutput(
  state: OutputState,
  msgType: string,
  content: Record<string, unknown>,
): OutputState {
  switch (msgType) {
    case "stream": {
      const name = content.name === "stderr" ? "stderr" : "stdout";
      const text = typeof content.text === "string" ? content.text : "";
      const outputs = takeClear(state).slice();
      const last = outputs.at(-1);
      const previous = last?.output_type === "stream" && last.name === name ? last : undefined;
      const continuation = previous && state.stream?.output === previous ? state.stream : undefined;
      const next = appendStream(previous?.text ?? "", text, continuation?.cursor ?? previous?.text.length ?? 0,
        continuation?.lineStart ?? (previous ? previous.text.lastIndexOf("\n") + 1 : 0));
      const capped = capText(next.text);
      // 截断仍只保留首尾；把光标映射到保留片段，不能把标记当作新输出再解释。
      if (next.text.length > LIMITS.streamChars) {
        const head = Math.floor(LIMITS.streamChars * 0.4);
        const project = (position: number) => position <= head ? position
          : Math.max(head + capped.length - LIMITS.streamChars, capped.length - (next.text.length - position));
        next.cursor = project(next.cursor);
        next.lineStart = project(next.lineStart);
      }
      const output: StreamOutput = { output_type: "stream", name, text: capped };
      if (previous) outputs[outputs.length - 1] = output;
      else outputs.push(output);
      return { outputs, clearPending: false, stream: { output, cursor: next.cursor, lineStart: next.lineStart } };
    }
    case "display_data":
    case "execute_result": {
      const transient = content.transient as { display_id?: string } | undefined;
      const base = {
        data: normalizeBundle(content.data),
        metadata: (content.metadata as Record<string, unknown>) ?? {},
        ...(transient?.display_id ? { transient: { display_id: transient.display_id } } : {}),
      };
      const output: Output =
        msgType === "execute_result"
          ? {
              output_type: "execute_result",
              ...base,
              execution_count:
                typeof content.execution_count === "number" ? content.execution_count : null,
            }
          : { output_type: "display_data", ...base };
      return { outputs: [...takeClear(state), output], clearPending: false };
    }
    case "error":
      return {
        outputs: [
          ...takeClear(state),
          {
            output_type: "error",
            ename: String(content.ename ?? "Error"),
            evalue: String(content.evalue ?? ""),
            traceback: Array.isArray(content.traceback) ? content.traceback.map(String) : [],
          },
        ],
        clearPending: false,
      };
    case "clear_output":
      return content.wait ? { ...state, clearPending: true } : { outputs: [], clearPending: false };
    default:
      return state;
  }
}

/** update_display_data：替换所有带该 display_id 的输出的数据。返回是否有变化。 */
export function updateDisplay(
  outputs: Output[],
  displayId: string,
  content: Record<string, unknown>,
): Output[] | null {
  let changed = false;
  const next = outputs.map((output) => {
    if (
      (output.output_type === "display_data" || output.output_type === "execute_result") &&
      output.transient?.display_id === displayId
    ) {
      changed = true;
      return {
        ...output,
        data: normalizeBundle(content.data),
        metadata: (content.metadata as Record<string, unknown>) ?? {},
      };
    }
    return output;
  });
  return changed ? next : null;
}
