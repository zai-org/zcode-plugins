// ZCode 官方生图 MCP 服务（stdio，零依赖）。
//
// 链路：ZCode 宿主在每次 tools/call 的 params._meta["com.zcode/official-mcp-auth"] 里下发
// 当前登录身份头 → 本进程带着这些头调 `${ZCODE_BASE_URL}/api/v1/toolhub/...` → zcode-server
// 校验身份后转发给 ToolHub。身份逐调用现取，不进 env、不落盘、不进日志。
//
// 接口契约见《ZCode ToolHub 工具接口文档（客户端）》。
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const SERVER_NAME = "image-generation";
const SERVER_VERSION = "0.1.0";
const AUTH_META_KEY = "com.zcode/official-mcp-auth";
const TOOL_NAME = "generate_image";

const INVOKE_PATH = "/api/v1/toolhub/tool/image_generate/invoke";
const UPLOAD_PATH = "/api/v1/toolhub/files";
// 文档要求同步生图的客户端超时不小于 130 秒。
const INVOKE_TIMEOUT_MS = 150_000;
const TRANSFER_TIMEOUT_MS = 60_000;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const CALLING_RETRY_DELAY_MS = Number(process.env.IMAGE_GENERATION_RETRY_DELAY_MS ?? 5_000);
const CALLING_MAX_ATTEMPTS = 3;
// 宿主的 timeoutMs（plugin.json 330s）是从调用开始算的硬上限，超时后已生成的图片就丢了。
// 上传、生成、重试、下载共用这一份预算；用完时返回已有结果或明确的错误。
const CALL_BUDGET_MS = Number(process.env.IMAGE_GENERATION_CALL_BUDGET_MS ?? 320_000);
const MAX_DOWNLOAD_BYTES = Number(process.env.IMAGE_GENERATION_MAX_DOWNLOAD_BYTES ?? 64 * 1024 * 1024);

const AUTH_REASON_TEXT = {
  official_auth_unavailable: "ZCode 未登录，或当前没有可用的连接。请登录后新建会话再试。",
  official_auth_plan_required:
    "生图需要已连接的 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接暂不可用。",
  official_mcp_origin_untrusted: "ZCode 拒绝向当前服务地址发送身份，属于客户端配置问题。",
};

const ERROR_CODE_TEXT = {
  3001: "请求参数不合法（提示词为空、参考图格式或大小不对等）",
  3002: "请求过于频繁，请稍后再试",
  3701: "生图服务暂不可用，请稍后再试",
  3702: "同一请求正在处理中，请稍后再试",
  3703: "生成失败（可能是内容未通过审核或上游繁忙），可调整提示词后重试",
  3705: "生图接口不存在，当前 ZCode 服务端可能还未开放该能力",
  3706: "当前账号无法使用生图：需要关联 Z.ai 账号并绑定手机号（海外账号需绑定邮箱）",
  3707: "参考图为空、过大或类型不支持（仅 png / jpeg / webp，最大 10 MiB）",
  2005: "参考图上传失败，请稍后重试",
  2007: "服务端或上游暂时故障，请稍后重试",
};

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const OUTPUT_EXTENSIONS = new Set(Object.keys(IMAGE_MIME));

const TOOL = {
  name: TOOL_NAME,
  description:
    "根据文字描述生成一张图片；传入参考图时按参考图改图（图生图）。生成结果会保存到工作区并返回文件路径。" +
    "每次调用约数秒到数十秒。",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "画面描述。写清主体、风格、构图、光线、色调；需要文字时写明文字内容。",
      },
      reference_image: {
        type: "string",
        description:
          "可选，一张参考图：工作区内的本地路径、https 地址或 data:image/...;base64 URL。仅支持 png / jpeg / webp，不超过 10 MiB。",
      },
      output_path: {
        type: "string",
        description: "可选，工作区内的保存位置，文件不能已存在。不填则保存到工作区 generated-images/ 下。",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  annotations: { title: "生图", readOnlyHint: false, openWorldHint: true },
};

class ToolError extends Error {}

function projectDir() {
  return process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** 按真实路径判断（符号链接不能带出工作区），目标不存在时取最近的已存在祖先。 */
async function resolveInWorkspace(value, label) {
  const base = projectDir();
  const absolute = isAbsolute(value) ? value : resolve(base, value);
  let root;
  let real;
  try {
    root = await realpath(base);
    real = await realpathOfNearest(absolute);
  } catch {
    throw new ToolError(`${label} 无法访问：${value}`);
  }
  const rel = relative(root, real);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`${label} 必须在工作区内：${value}`);
  }
  return real;
}

async function realpathOfNearest(path) {
  const missing = [];
  for (let current = path; ; current = dirname(current)) {
    try {
      return join(await realpath(current), ...missing.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT" || dirname(current) === current) throw error;
      missing.push(basename(current));
    }
  }
}

async function resolveOutputPath(value) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (!requested) return undefined;
  const target = await resolveInWorkspace(requested, "output_path");
  const extension = extname(target).toLowerCase();
  if (extension && !OUTPUT_EXTENSIONS.has(extension)) {
    throw new ToolError(`output_path 的扩展名只能是 ${[...OUTPUT_EXTENSIONS].join(" / ")}：${requested}`);
  }
  if (await pathExists(target)) throw new ToolError(`output_path 已存在，不会覆盖：${requested}`);
  return target;
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readLimited(response) {
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) throw new Error("download too large");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    if (total > MAX_DOWNLOAD_BYTES) throw new Error("download too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 单次请求的超时不能超过整次调用剩余的预算。 */
function withinBudget(call, ms) {
  return Math.max(1, Math.min(ms, call.startedAt + CALL_BUDGET_MS - Date.now()));
}

/** 只接受宿主注入的 https origin（本机回环允许 http，供开发自测）。 */
function resolveApiOrigin() {
  const raw = (process.env.ZCODE_BASE_URL ?? "").trim();
  if (!raw) throw new ToolError("ZCODE_BASE_URL 未注入：请在 ZCode 中使用本插件。");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ToolError(`ZCODE_BASE_URL 无法解析：${raw}`);
  }
  if (url.username || url.password) throw new ToolError("ZCODE_BASE_URL 不能包含账号信息。");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ToolError(`ZCODE_BASE_URL 必须是 https：${raw}`);
  }
  return url.origin;
}

function readAuthHeaders(meta) {
  const payload = meta && typeof meta === "object" ? meta[AUTH_META_KEY] : undefined;
  if (!payload || typeof payload !== "object") {
    throw new ToolError("没有拿到 ZCode 登录身份：请在已登录的 ZCode 中使用本插件。");
  }
  if (payload.ok !== true) {
    const reason = typeof payload.reason === "string" ? payload.reason : "official_auth_unavailable";
    throw new ToolError(AUTH_REASON_TEXT[reason] ?? `ZCode 未提供登录身份（${reason}）。`);
  }
  const headers = {};
  for (const [name, value] of Object.entries(payload.headers ?? {})) {
    if (typeof value === "string" && value.trim()) headers[name] = value;
  }
  if (!Object.keys(headers).length) throw new ToolError(AUTH_REASON_TEXT.official_auth_unavailable);
  return headers;
}

async function apiRequest(call, path, { headers, body, timeoutMs }) {
  let response;
  try {
    response = await fetch(call.origin + path, {
      method: "POST",
      headers: { ...call.authHeaders, ...headers },
      body,
      // 身份头只能发往 ZCode 自己的 origin，禁止跟随重定向。
      redirect: "manual",
      signal: AbortSignal.timeout(withinBudget(call, timeoutMs)),
    });
  } catch (error) {
    return { transient: true, message: error?.name === "TimeoutError" ? "请求超时" : "网络错误" };
  }
  if (response.status === 401) throw new ToolError("ZCode 登录身份已失效：请重新登录后再试。");
  if (response.status === 403) throw new ToolError("当前账号没有使用生图的权限。");
  if (response.status >= 300 && response.status < 400) throw new ToolError("服务端返回了重定向，已拒绝。");
  if (response.status === 429) return { transient: true, message: ERROR_CODE_TEXT[3002] };
  let text;
  try {
    text = await response.text();
  } catch (error) {
    // 响应头已到、读响应体时断线：按暂时性故障交给调用方同键重试。
    return { transient: true, message: error?.name === "TimeoutError" ? "读取响应超时" : "读取响应时连接中断" };
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    if (response.status >= 500) return { transient: true, message: `服务端错误 HTTP ${response.status}` };
    throw new ToolError(`服务端返回了无法识别的响应（HTTP ${response.status}）。`);
  }
  if (envelope.code === 0) return { data: envelope.data ?? {} };
  const code = Number(envelope.code);
  const detail = ERROR_CODE_TEXT[code] ?? envelope.msg ?? "未知错误";
  const suffix = envelope.logid ? `（code ${code}，logid ${envelope.logid}）` : `（code ${code}）`;
  if (code === 2007 || code === 3702) return { transient: true, message: detail + suffix };
  throw new ToolError(detail + suffix);
}

async function uploadReference(call, filePath) {
  const absolute = await resolveInWorkspace(filePath, "参考图");
  const mime = IMAGE_MIME[extname(absolute).toLowerCase()];
  if (!mime) throw new ToolError("参考图只支持 png / jpeg / webp。");
  let bytes;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw new ToolError(`读不到参考图：${absolute}`);
  }
  if (bytes.length > MAX_REFERENCE_BYTES) throw new ToolError("参考图超过 10 MiB。");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), absolute.split(/[\\/]/).pop());
  const result = await apiRequest(call, UPLOAD_PATH, {
    body: form,
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
  if (result.transient) throw new ToolError(`参考图上传失败：${result.message}`);
  if (typeof result.data.url !== "string") throw new ToolError("参考图上传后没有返回地址。");
  return result.data.url;
}

async function resolveReference(call, reference) {
  const value = reference?.trim();
  if (!value) return undefined;
  if (/^https:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new ToolError("参考图地址只支持 https。");
  return uploadReference(call, value);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 同一个 Idempotency-Key 只用于「同一次生成」的重试：网络抖动 / 2007 / CALLING 时复用，
 * 不会多扣一次。UNKNOWN 按文档视为失败交回给 Agent，由它决定是否重新生成（换新键）。
 */
async function invokeGenerate(call, body) {
  const headers = { "Content-Type": "application/json", "Idempotency-Key": randomUUID() };
  let transientRetried = false;
  for (let attempt = 1; ; attempt += 1) {
    const result = await apiRequest(call, INVOKE_PATH, {
      headers,
      body: JSON.stringify(body),
      timeoutMs: INVOKE_TIMEOUT_MS,
    });
    if (result.transient) {
      if (transientRetried) throw new ToolError(`生图失败：${result.message}`);
      transientRetried = true;
      await sleep(CALLING_RETRY_DELAY_MS);
      continue;
    }
    const { state, output, replayed, invocation_id: invocationId } = result.data;
    if (state === "CALLING" && attempt < CALLING_MAX_ATTEMPTS) {
      await sleep(CALLING_RETRY_DELAY_MS);
      continue;
    }
    if (state === "SUCCEEDED" && typeof output?.image_url === "string") return { imageUrl: output.image_url, invocationId };
    if (state === "SUCCEEDED" && replayed) {
      throw new ToolError("这次生成的结果已经返回过、无法再取回图片地址，请重新生成。");
    }
    if (state === "UNKNOWN") throw new ToolError("生成结果未确认（上游超时），可以稍后重新生成。");
    if (state === "CALLING") {
      throw new ToolError("上一次生成请求还在处理，结果未确认。请稍等片刻再试，现在立刻重新生成可能重复扣费。");
    }
    throw new ToolError(`生图没有返回图片（state=${state ?? "未知"}）。`);
  }
}

function defaultOutputPath(prompt, extension) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const slug = prompt.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 24) || "image";
  return join(projectDir(), "generated-images", `${stamp}-${slug}${extension}`);
}

function urlExtension(url) {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    return OUTPUT_EXTENSIONS.has(extension) ? extension : undefined;
  } catch {
    return undefined;
  }
}

async function saveImage(call, imageUrl, prompt, outputPath) {
  let response;
  try {
    response = await fetch(imageUrl, { signal: AbortSignal.timeout(withinBudget(call, TRANSFER_TIMEOUT_MS)) });
  } catch {
    return { saved: undefined, warning: "图片已生成，但下载失败，可直接使用临时链接。" };
  }
  if (!response.ok) return { saved: undefined, warning: `图片已生成，但下载失败（HTTP ${response.status}）。` };
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const extension = Object.entries(IMAGE_MIME).find(([, mime]) => mime === type)?.[0] ?? urlExtension(imageUrl) ?? ".png";
  // 扩展名以实际媒体类型为准，用户写错也不会存出一个打不开的文件。
  const requested = outputPath && extname(outputPath).toLowerCase();
  const target = !outputPath
    ? defaultOutputPath(prompt, extension)
    : IMAGE_MIME[requested] === IMAGE_MIME[extension]
      ? outputPath
      : outputPath.slice(0, outputPath.length - extname(outputPath).length) + extension;
  try {
    const bytes = await readLimited(response);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  } catch {
    return { saved: undefined, warning: "图片已生成，但保存失败，可直接使用临时链接。" };
  }
  return { saved: target };
}

async function generateImage(args, meta) {
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) throw new ToolError("prompt 不能为空。");
  const call = { origin: resolveApiOrigin(), authHeaders: readAuthHeaders(meta), startedAt: Date.now() };
  const outputPath = await resolveOutputPath(args.output_path);
  const image = await resolveReference(call, args.reference_image);
  const { imageUrl, invocationId } = await invokeGenerate(call, image ? { query: prompt, image } : { query: prompt });
  const { saved, warning } = await saveImage(call, imageUrl, prompt, outputPath);
  const lines = [
    saved ? `已生成并保存：${saved}` : warning,
    `临时链接（会过期）：${imageUrl}`,
    invocationId ? `invocation_id：${invocationId}` : undefined,
  ].filter(Boolean);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { path: saved ?? null, image_url: imageUrl, invocation_id: invocationId ?? null },
  };
}

// ── 最小 MCP stdio 协议（逐行 JSON-RPC）──

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handle(request) {
  const { id, method, params } = request;
  const isNotification = id === undefined || id === null;
  switch (method) {
    case "initialize":
      return send({
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
    case "ping":
      return send({ id, result: {} });
    case "tools/list":
      return send({ id, result: { tools: [TOOL] } });
    case "tools/call": {
      if (params?.name !== TOOL_NAME) {
        return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      try {
        return send({ id, result: await generateImage(params.arguments ?? {}, params._meta) });
      } catch (error) {
        const text = error instanceof ToolError ? error.message : `生图失败：${error?.message ?? error}`;
        return send({ id, result: { isError: true, content: [{ type: "text", text }] } });
      }
    }
    default:
      if (!isNotification) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

export function main() {
  const inFlight = new Set();
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const task = handle(request).finally(() => inFlight.delete(task));
    inFlight.add(task);
  });
  // stdin 关闭时先把在途调用的响应写完再退出。
  lines.on("close", () => void Promise.allSettled([...inFlight]).then(() => process.exit(0)));
}

// Node 默认按真实路径加载入口模块，argv[1] 却保留符号链接（如 macOS 的 /var -> /private/var）；
// 带 --preserve-symlinks-main 时入口又保留符号链接，所以两种形式都要比，否则进程会一声不响地退出。
// argv[1] 不是文件时只可能是被宿主 import，由宿主调用 main()。
function startedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  if (import.meta.url === pathToFileURL(resolve(entry)).href) return true;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (startedDirectly()) main();
