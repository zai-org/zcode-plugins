/**
 * db-connector MCP 服务器入口：stdio 上的 JSON-RPC 2.0（每行一个消息）。
 * 支持 initialize / notifications/* / ping / tools/list / tools/call。
 */
import * as readline from 'readline';
import { TOOL_DEFINITIONS, handleToolCall } from './tools';

const SERVER_NAME = 'db-connector';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function reply(id: number | string, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: number | string, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function log(...parts: unknown[]): void {
  process.stderr.write(`[db-connector] ${parts.join(' ')}\n`);
}

async function handleMessage(msg: JsonRpcMessage): Promise<void> {
  const { method, id, params } = msg;

  // 通知（无 id）：静默接收
  if (id === undefined || id === null) {
    return;
  }

  try {
    switch (method) {
      case 'initialize': {
        const requested = (params?.protocolVersion as string) ?? PROTOCOL_VERSION;
        reply(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;
      }
      case 'ping': {
        reply(id, {});
        return;
      }
      case 'tools/list': {
        reply(id, { tools: TOOL_DEFINITIONS });
        return;
      }
      case 'tools/call': {
        const name = String(params?.name ?? '');
        const args = (params?.arguments as Record<string, unknown>) ?? {};
        try {
          const result = await handleToolCall(name, args);
          reply(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: false,
          });
        } catch (toolError) {
          // 工具级错误：按 MCP 惯例返回 isError 内容而非协议错误，AI 可读取原因
          reply(id, {
            content: [{ type: 'text', text: `工具执行失败：${(toolError as Error).message}` }],
            isError: true,
          });
        }
        return;
      }
      default:
        replyError(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    replyError(id, -32603, `Internal error: ${(e as Error).message}`);
  }
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(text) as JsonRpcMessage;
    } catch {
      log('忽略无法解析的输入行');
      return;
    }
    if (!msg.method) return;
    void handleMessage(msg).catch((e) => log('消息处理异常:', (e as Error).message));
  });
  rl.on('close', () => {
    log('stdin 已关闭，服务器退出');
    process.exit(0);
  });
  process.on('uncaughtException', (e) => log('未捕获异常:', e.message));
  process.on('unhandledRejection', (r) => log('未处理的 Promise 拒绝:', String(r)));
}

void main();
