import { LIMITS, type Output } from "#nb/contract.ts";
import { normalizeBundle } from "#nb/domain/notebook.ts";

/** 一个 cell 运行中的输出状态。clearPending 对应 `clear_output(wait=True)`：下一个输出到达时才清空。 */
export interface OutputState {
  outputs: Output[];
  clearPending: boolean;
}

/**
 * 处理终端控制字符：`\r` 回到行首（进度条覆盖），`\b` 退格。
 * 只对最后一个未结束的行生效时也正确，因为整段文本每次重算。
 */
export function applyControlChars(text: string): string {
  if (!text.includes("\r") && !text.includes("\b")) return text;
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      const last = index === lines.length - 1;
      // 行尾 `\r\n` 的 `\r` 无意义；未结束的最后一行保留结尾 `\r`，下一段输出会覆盖它。
      const pendingReturn = last && line.endsWith("\r");
      let value = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (value.includes("\r")) {
        // 后写的片段覆盖行首对应长度的字符。
        let current = "";
        for (const segment of value.split("\r"))
          current = segment + current.slice(segment.length);
        value = current;
      }
      // oxlint-disable-next-line no-control-regex -- ANSI / 终端控制字符是有意匹配的
      while (value.includes("\b")) value = value.replace(/[^\x08]\x08|^\x08+/, "");
      return pendingReturn ? `${value}\r` : value;
    })
    .join("\n");
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
      if (last?.output_type === "stream" && last.name === name) {
        outputs[outputs.length - 1] = {
          ...last,
          text: capText(applyControlChars(last.text + text)),
        };
      } else {
        outputs.push({ output_type: "stream", name, text: capText(applyControlChars(text)) });
      }
      return { outputs, clearPending: false };
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
      return content.wait ? { outputs: state.outputs, clearPending: true } : { outputs: [], clearPending: false };
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
