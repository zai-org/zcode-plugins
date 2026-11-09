import { randomUUID } from "node:crypto";

/** Jupyter 消息协议 v5（经 Jupyter Server WebSocket 的旧版 JSON 帧）。 */
export type Channel = "shell" | "iopub" | "stdin" | "control";

export interface MessageHeader {
  msg_id: string;
  msg_type: string;
  username: string;
  session: string;
  date: string;
  version: string;
}

export interface KernelMessage<C = Record<string, unknown>> {
  channel: Channel;
  header: MessageHeader;
  parent_header: Partial<MessageHeader>;
  metadata: Record<string, unknown>;
  content: C;
  buffers?: unknown[];
}

export const PROTOCOL_VERSION = "5.3";

export function createMessage<C extends Record<string, unknown>>(
  channel: Channel,
  msgType: string,
  content: C,
  session: string,
): KernelMessage<C> {
  return {
    channel,
    header: {
      msg_id: randomUUID(),
      msg_type: msgType,
      username: "zcode",
      session,
      date: new Date().toISOString(),
      version: PROTOCOL_VERSION,
    },
    parent_header: {},
    metadata: {},
    content,
    buffers: [],
  };
}

export function executeRequest(code: string, session: string) {
  return createMessage(
    "shell",
    "execute_request",
    {
      code,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    },
    session,
  );
}

/** 解析一帧文本消息；二进制帧（带 buffers 的消息，如 widget comm）不支持，返回 null。 */
export function parseMessage(data: unknown): KernelMessage | null {
  if (typeof data !== "string") return null;
  try {
    const message = JSON.parse(data) as KernelMessage;
    if (!message || typeof message !== "object" || !message.header?.msg_type) return null;
    return message;
  } catch {
    return null;
  }
}

export const parentId = (message: KernelMessage) => message.parent_header?.msg_id ?? null;
