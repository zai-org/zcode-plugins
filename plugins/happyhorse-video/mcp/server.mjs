// ZCode 官方 HappyHorse 视频生成 MCP 服务（stdio，零依赖）。
//
// 链路：ZCode 宿主在每次 tools/call 的 params._meta["com.zcode/official-mcp-auth"] 里下发
// 当前登录身份头 → 本进程带着这些头调 `${ZCODE_BASE_URL}/api/v1/toolhub/...` → zcode-server
// 校验身份、注入 ToolHub 凭证与用户身份后转发给 ToolHub 的 `happyhorse_video` 工具。
// 身份逐调用现取，不进 env、不落盘、不进日志。
//
// 视频生成是「提交 + 轮询」：每次提交都会计费，所以同一次提交的所有重试都复用同一个
// Idempotency-Key；单次工具调用等不完时把 task_id 交回给 Agent，由 get_happyhorse_video_result 接着等。
//
// 接口契约见《ZCode ToolHub 工具接口文档（客户端）》与《HappyHorse 视频生成 · 接入说明》。
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const SERVER_NAME = "happyhorse-video";
const SERVER_VERSION = "0.1.1";
const AUTH_META_KEY = "com.zcode/official-mcp-auth";
// 计费场景：zcode-server 把这个头透传给 ToolHub，用来按插件归类用量、在 MaaS 账单里按插件展示。
// 值是和服务端约定的计费场景名（白名单），改动前要先和服务端对齐。
const USAGE_SCENARIO_HEADER = "X-Usage-Scenario";
const USAGE_SCENARIO = "happyhorse-video";
const GENERATE_TOOL = "generate_happyhorse_video";
const RESULT_TOOL = "get_happyhorse_video_result";

const SUBMIT_PATH = "/api/v1/toolhub/tool/happyhorse_video/invoke";
const QUERY_PATH = "/api/v1/toolhub/tool/happyhorse_video/tasks/query";
const UPLOAD_PATH = "/api/v1/toolhub/files";
const SUBMIT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = Number(process.env.HAPPYHORSE_VIDEO_MAX_DOWNLOAD_BYTES ?? 512 * 1024 * 1024);
const RETRY_DELAY_MS = Number(process.env.HAPPYHORSE_VIDEO_RETRY_DELAY_MS ?? 5_000);
const SUBMIT_MAX_ATTEMPTS = 4;
const MIN_REQUEST_MS = 100;
// 接入说明建议每 10–15 秒轮询一次：上游查询接口按整个账号限频，不要压到秒级。
const POLL_INTERVAL_MS = Number(process.env.HAPPYHORSE_VIDEO_POLL_INTERVAL_MS ?? 12_000);
// 宿主的 timeoutMs（plugin.json 330s）是从调用开始算的硬上限，进度通知不会续期；超时后 Agent 拿不到
// task_id / request_id，只能重新提交。所以上传、提交、轮询、下载共用这一份预算，都从调用开始算。
const CALL_BUDGET_MS = Number(process.env.HAPPYHORSE_VIDEO_CALL_BUDGET_MS ?? 320_000);
const WAIT_BUDGET_MS = Number(process.env.HAPPYHORSE_VIDEO_WAIT_BUDGET_MS ?? 220_000);

const AUTH_REASON_TEXT = {
  official_auth_unavailable: "ZCode 未登录，或当前没有可用的连接。请登录后新建会话再试。",
  official_auth_plan_required:
    "HappyHorse 视频生成需要已连接的 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接暂不可用。",
  official_mcp_origin_untrusted: "ZCode 拒绝向当前服务地址发送身份，属于客户端配置问题。",
};

const ERROR_CODE_TEXT = {
  3001: "请求参数不合法（提示词为空或过长、时长 / 分辨率 / 画幅不在范围内、图片地址不合法等）",
  3002: "请求过于频繁或上游繁忙，请稍后再试",
  3101: "当前 Coding Plan 范围下没有有效订阅，无法计费：请订阅 Coding Plan，或切换到有订阅的个人 / 团队",
  3701: "HappyHorse 视频生成暂不可用，请稍后再试",
  3702: "同一请求正在处理中，请稍后再试",
  3703: "提交被拒绝（可能是内容未通过审核、图片不合规或上游限流），没有创建任务，可调整后重新生成",
  3704: "任务不存在、已过期（上游只保留 24 小时），或不是当前账号提交的",
  3705: "HappyHorse 视频生成接口不存在，当前 ZCode 服务端可能还未开放该能力",
  3706: "当前账号无法使用视频生成：需要关联 Z.ai 账号并绑定手机号（海外账号需绑定邮箱）",
  3707: "图片为空、过大或类型不支持（本地上传仅支持 png / jpeg / webp，最大 10 MiB）",
  2005: "图片上传失败，请稍后重试",
  2007: "服务端或上游暂时故障（也可能是额度不足），请稍后重试",
};

// 任务失败时 ToolHub 归类后的 failure.code → 给 Agent 的处理建议（见接入说明第七章）。
const FAILURE_ADVICE = {
  HAPPYHORSE_CONTENT_REJECTED: "提示词、图片或生成内容没过审核，需要换提示词或图片，原样重试没有意义。",
  HAPPYHORSE_INVALID_INPUT: "图片下载失败或尺寸不合要求（首帧宽高都不小于 300 像素，参考图短边不低于 400 像素），修正后再生成。",
  HAPPYHORSE_TASK_FAILED: "多为上游自身问题，可以重新生成。",
  HAPPYHORSE_TASK_CANCELED: "任务在上游被取消，可以重新生成。",
  WATERMARK_FAILED: "视频已生成但加水印失败，不会交付，可以重新生成。",
  RESULT_EXPIRED: "视频临时链接已失效，只能重新生成（会再次计费）。",
};

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const VIDEO_EXT = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" };
const OUTPUT_EXTENSIONS = new Set(Object.values(VIDEO_EXT));

// 取值范围以《HappyHorse 视频生成 · 接入说明》为准：不传时服务端默认 5 秒、720P、16:9。
const MIN_DURATION = 3;
const MAX_DURATION = 15;
const DEFAULT_DURATION = 5;
const RESOLUTIONS = ["480P", "720P", "1080P"];
const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "9:21", "21:9"];
const MAX_PROMPT_CHARS = 10_000;
const MAX_REFERENCES = 9;
const MAX_URL_CHARS = 2048;

const IMAGE_DESCRIPTION = "工作区内的本地图片（png / jpeg / webp，不超过 10 MiB，会先上传）或 https 公网地址";

const GENERATE = {
  name: GENERATE_TOOL,
  description:
    "用 HappyHorse 根据文字描述生成一段短视频；可指定首帧图（图生视频），或给 1–9 张参考图（参考生视频）。" +
    "生成通常需要 1–5 分钟，按成功生成的秒数和分辨率计费（720P 5 秒约 4.8 元），失败不计费。" +
    "每次调用都会提交一个新任务：本工具等不完时会返回 task_id，请改用 get_happyhorse_video_result 继续等待，不要重复调用本工具。",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          `视频描述：主体、动作、场景、镜头运动、风格，最长 ${MAX_PROMPT_CHARS} 个字符（上游只取前 2500 个中文字符）。` +
          "用 reference_images 时按顺序用 [Image 1]、[Image 2] 指代参考图。",
      },
      duration: {
        type: ["integer", "string"],
        description:
          `可选，视频时长（秒）：${MIN_DURATION} 到 ${MAX_DURATION} 的整数。不传默认 ${DEFAULT_DURATION} 秒。` +
          "用户说了时长才传；时长越长耗时和费用越高。",
      },
      resolution: {
        type: "string",
        description: `可选，分辨率：${RESOLUTIONS.join(" / ")}，不区分大小写。不传默认 720P；分辨率越高单价越高。`,
      },
      ratio: {
        type: "string",
        description: `可选，画幅（宽高比）：${RATIOS.join(" / ")}。不传默认 16:9。用了 first_frame 时画幅跟随首帧图，本参数不起作用。`,
      },
      first_frame: {
        type: "string",
        description: `可选，首帧图（图生视频，画面从这张图开始动）：${IMAGE_DESCRIPTION}。宽高都不小于 300 像素。与 reference_images 互斥。`,
      },
      reference_images: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_REFERENCES,
        description:
          `可选，参考图 1 到 ${MAX_REFERENCES} 张（人物、物品、风格素材，不是首帧）：${IMAGE_DESCRIPTION}。` +
          "顺序就是提示词里 [Image N] 的序号，短边不低于 400 像素。与 first_frame 互斥。",
      },
      output_path: {
        type: "string",
        description: "可选，工作区内的保存位置，文件不能已存在。不填则保存到工作区 generated-videos/ 下。",
      },
      request_id: {
        type: "string",
        description:
          "可选，仅在上一次调用返回「提交未确认」并给出 request_id 时原样传回，用于重放同一次提交而不重复扣费。",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  annotations: { title: "HappyHorse 生成视频", readOnlyHint: false, openWorldHint: true },
};

const RESULT = {
  name: RESULT_TOOL,
  description:
    "继续等待一个已提交的视频任务，完成后把视频保存到工作区。不会重新提交、不消耗额度。" +
    "每次调用最多等几分钟，仍未完成时会再次返回 task_id。",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "generate_happyhorse_video 返回的 task_id。" },
      prompt: { type: "string", description: "可选，原提示词，仅用于生成默认文件名。" },
      output_path: {
        type: "string",
        description: "可选，工作区内的保存位置，文件不能已存在。不填则保存到工作区 generated-videos/ 下。",
      },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { title: "获取 HappyHorse 视频结果", readOnlyHint: false, openWorldHint: true },
};

class ToolError extends Error {}

/** 任务已到终态（失败 / 不存在），不能再用 get_happyhorse_video_result 接回。 */
class TaskEndedError extends ToolError {}

// request_id → 首次提交的请求体。重放必须逐字节复用：本地素材重新上传会换 URL，
// 请求体一变，同一个 Idempotency-Key 就会被服务端判成 3702。存到插件数据目录（仅本人可读），MCP 进程
// 重启后也能重放。请求体只含提示词、参数和图片地址，不含身份；确认、拒绝或过期后删除。
const PENDING_DIR = join(
  process.env.ZCODE_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), ".zcode-happyhorse-video"),
  "pending",
);
// 素材预签名地址默认 24 小时过期，超过这个时间的请求体重放也没有意义，到期清理。
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function pendingPath(key) {
  return /^[A-Za-z0-9-]{1,64}$/.test(key) ? join(PENDING_DIR, `${key}.json`) : undefined;
}

async function loadPendingBody(key) {
  const path = key && pendingPath(key);
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function prunePendingBodies() {
  let names;
  try {
    names = await readdir(PENDING_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - PENDING_TTL_MS;
  await Promise.all(
    names.map(async (name) => {
      const path = join(PENDING_DIR, name);
      const info = await stat(path).catch(() => undefined);
      if (info && info.mtimeMs < cutoff) await rm(path, { force: true }).catch(() => {});
    }),
  );
}

async function savePendingBody(key, body) {
  const path = pendingPath(key);
  if (!path) return;
  await prunePendingBodies();
  await mkdir(PENDING_DIR, { recursive: true, mode: 0o700 }).catch(() => {});
  await writeFile(path, JSON.stringify(body), { mode: 0o600 }).catch(() => {});
}

async function dropPendingBody(key) {
  const path = pendingPath(key);
  if (path) await rm(path, { force: true }).catch(() => {});
}

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

/**
 * 返回 `{ data }`；暂时性故障（网络、超时、429、2007、3002、3702、无法解析的 5xx）返回
 * `{ transient, message }`；其余错误码返回 `{ code, message }`，由调用方决定怎么处理。
 */
async function apiRequest(call, path, { headers, body, timeoutMs }) {
  let response;
  try {
    response = await fetch(call.origin + path, {
      method: "POST",
      headers: { ...call.authHeaders, ...headers, [USAGE_SCENARIO_HEADER]: USAGE_SCENARIO },
      body,
      // 身份头只能发往 ZCode 自己的 origin，禁止跟随重定向。
      redirect: "manual",
      signal: AbortSignal.timeout(withinBudget(call, timeoutMs)),
    });
  } catch (error) {
    return { transient: true, message: error?.name === "TimeoutError" ? "请求超时" : "网络错误" };
  }
  if (response.status === 401) throw new ToolError("ZCode 登录身份已失效：请重新登录后再试。");
  if (response.status >= 300 && response.status < 400) throw new ToolError("服务端返回了重定向，已拒绝。");
  if (response.status === 429) return { transient: true, message: ERROR_CODE_TEXT[3002] };
  let text;
  try {
    text = await response.text();
  } catch (error) {
    // 响应头已到、读响应体时断线：服务端可能已受理，按暂时性故障交给调用方同键重放。
    return { transient: true, message: error?.name === "TimeoutError" ? "读取响应超时" : "读取响应时连接中断" };
  }
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    // 403 可能带 envelope（如 3101 没有 Coding Plan 订阅），所以先解析，解析不了才按无权限处理。
    if (response.status === 403) throw new ToolError("当前账号没有使用 HappyHorse 视频生成的权限。");
    if (response.status >= 500) return { transient: true, message: `服务端错误 HTTP ${response.status}` };
    throw new ToolError(`服务端返回了无法识别的响应（HTTP ${response.status}）。`);
  }
  if (envelope.code === 0) return { data: envelope.data ?? {} };
  const code = Number(envelope.code);
  const detail = ERROR_CODE_TEXT[code] ?? envelope.msg ?? "未知错误";
  const message = detail + (envelope.logid ? `（code ${code}，logid ${envelope.logid}）` : `（code ${code}）`);
  if (code === 2007 || code === 3002 || code === 3702) return { transient: true, message };
  return { code, message };
}

async function uploadImage(call, absolute) {
  const mime = IMAGE_MIME[extname(absolute).toLowerCase()];
  if (!mime) throw new ToolError(`本地图片只支持 png / jpeg / webp：${absolute}`);
  const bytes = await readLocal(absolute);
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ToolError(`图片超过 10 MiB：${absolute}`);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), absolute.split(/[\\/]/).pop());
  const result = await apiRequest(call, UPLOAD_PATH, { body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  if (!result.data) throw new ToolError(`素材上传失败：${result.message}`);
  if (typeof result.data.url !== "string") throw new ToolError("素材上传后没有返回地址。");
  return result.data.url;
}

async function readLocal(absolute) {
  try {
    return await readFile(absolute);
  } catch {
    throw new ToolError(`读不到本地文件：${absolute}`);
  }
}

/** 把一张图变成 HappyHorse 能用的地址：https 公网地址原样透传，工作区内的本地图片先上传换成预签名 URL。 */
async function resolveImage(call, value, label) {
  const item = typeof value === "string" ? value.trim() : "";
  if (!item) throw new ToolError(`${label}地址不能为空。`);
  if (/^https:\/\//i.test(item)) {
    let url;
    try {
      url = new URL(item);
    } catch {
      throw new ToolError(`${label}地址无法解析：${item}`);
    }
    if (url.username || url.password) throw new ToolError(`${label}地址不能包含账号信息。`);
    if (item.length > MAX_URL_CHARS) throw new ToolError(`${label}地址超过 ${MAX_URL_CHARS} 个字符。`);
    return item;
  }
  if (/^data:/i.test(item)) throw new ToolError(`${label}不支持 base64，请给工作区内的本地文件或 https 地址。`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(item) && !/^[a-z]:[\\/]/i.test(item)) {
    throw new ToolError(`${label}地址只支持 https：${item}`);
  }
  return uploadImage(call, await resolveInWorkspace(item, label));
}

function listArg(value, name, max) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ToolError(`${name} 必须是数组。`);
  if (value.length > max) throw new ToolError(`${name} 最多 ${max} 个。`);
  return value;
}

function durationArg(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
    throw new ToolError(`duration 必须是 ${MIN_DURATION} 到 ${MAX_DURATION} 的整数秒。`);
  }
  return n;
}

function resolutionArg(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const resolution = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!RESOLUTIONS.includes(resolution)) throw new ToolError(`resolution 只能是 ${RESOLUTIONS.join(" / ")}。`);
  return resolution;
}

function ratioArg(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const ratio = typeof value === "string" ? value.trim() : "";
  if (!RATIOS.includes(ratio)) throw new ToolError(`ratio 只能是 ${RATIOS.join(" / ")}。`);
  return ratio;
}

/** 本次调用和首次提交不一致的字段；参数非法时按「已修改」处理，不在重放路径里报错。 */
function replayDiffers(pending, prompt, args) {
  const changed = [];
  if (pending.prompt !== prompt) changed.push("提示词");
  const sameOr = (read, value, saved) => {
    try {
      return read(value) === saved;
    } catch {
      return false;
    }
  };
  if (!sameOr(durationArg, args.duration, pending.duration)) changed.push("时长");
  if (!sameOr(resolutionArg, args.resolution, pending.resolution)) changed.push("分辨率");
  if (!sameOr(ratioArg, args.ratio, pending.ratio)) changed.push("画幅");
  return changed;
}

async function buildSubmitBody(call, args, prompt) {
  const references = listArg(args.reference_images, "reference_images", MAX_REFERENCES);
  const firstFrame = typeof args.first_frame === "string" ? args.first_frame.trim() : "";
  if (firstFrame && references.length) {
    throw new ToolError("first_frame 与 reference_images 不能同时使用：首帧图是视频第一帧，参考图只作素材，请二选一。");
  }
  const body = { prompt };
  const duration = durationArg(args.duration);
  const resolution = resolutionArg(args.resolution);
  const ratio = ratioArg(args.ratio);
  if (duration !== undefined) body.duration = duration;
  if (resolution !== undefined) body.resolution = resolution;
  if (ratio !== undefined) body.ratio = ratio;
  if (firstFrame) body.image_url_list = [await resolveImage(call, firstFrame, "首帧图")];
  if (references.length) {
    body.reference_image_url_list = await Promise.all(
      references.map((value, index) => resolveImage(call, value, `第 ${index + 1} 张参考图`)),
    );
  }
  return body;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 提交视频任务。超时、断线、2007、UNKNOWN、CALLING 都用同一个 Idempotency-Key 重放：
 * 成功过的提交会返回 replayed=true 和 upstream_req_id（即 task_id），不会重复扣费。
 * 一旦出现过结果不明的尝试（或本身就是 request_id 重放），任务可能已经建好：之后无论以什么错误结束，
 * 都把这个键作为 request_id 交回给 Agent，并保留请求体，下次原样带回继续重放。
 */
async function submitTask(call, body, requestId) {
  const key = requestId || randomUUID();
  const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
  let uncertain = Boolean(requestId);
  let lastIssue = "提交结果未确认";
  const unconfirmed = async (issue) => {
    await savePendingBody(key, body);
    return new ToolError(
      `视频任务提交未确认（${issue}）。任务可能已经创建，为避免重复扣费，请稍后再调用 generate_happyhorse_video，` +
        `参数保持不变并带上 request_id：${key}`,
    );
  };
  for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      if (withinBudget(call, Infinity) <= RETRY_DELAY_MS + MIN_REQUEST_MS) break;
      await sleep(RETRY_DELAY_MS);
    }
    let result;
    try {
      result = await apiRequest(call, SUBMIT_PATH, {
        headers,
        body: JSON.stringify(body),
        timeoutMs: SUBMIT_TIMEOUT_MS,
      });
    } catch (error) {
      if (uncertain && error instanceof ToolError) throw await unconfirmed(error.message);
      throw error;
    }
    if (result.transient) {
      uncertain = true;
      lastIssue = result.message;
      continue;
    }
    if (!result.data) {
      if (uncertain) throw await unconfirmed(result.message);
      throw new ToolError(`提交失败：${result.message}`);
    }
    const { state, output, upstream_req_id: upstreamId, invocation_id: invocationId } = result.data;
    const taskId = typeof output?.task_id === "string" ? output.task_id : upstreamId;
    if (state === "SUCCEEDED" && typeof taskId === "string" && taskId) {
      await dropPendingBody(key);
      return { taskId, invocationId };
    }
    if (state === "UNKNOWN" || state === "CALLING") {
      uncertain = true;
      lastIssue = state === "CALLING" ? "上一次提交仍在处理" : "上游未确认提交结果";
      continue;
    }
    if (uncertain) throw await unconfirmed(`state=${state ?? "未知"}`);
    throw new ToolError(`提交没有返回 task_id（state=${state ?? "未知"}）。`);
  }
  throw await unconfirmed(lastIssue);
}

function sendProgress(progressToken, progress, message) {
  if (progressToken === undefined || progressToken === null) return;
  send({ method: "notifications/progress", params: { progressToken, progress, message } });
}

/** 轮询到终态或用完本次调用的等待时间；暂时性故障只退避，不重新提交。 */
async function waitForTask(call, taskId, progressToken) {
  const deadline = call.startedAt + WAIT_BUDGET_MS;
  const headers = { "Content-Type": "application/json" };
  for (let round = 1; ; round += 1) {
    const result = await apiRequest(call, QUERY_PATH, {
      headers,
      body: JSON.stringify({ task_id: taskId }),
      timeoutMs: QUERY_TIMEOUT_MS,
    });
    if (result.code === 3704) throw new TaskEndedError(`查询视频任务失败：${result.message}`);
    if (result.code !== undefined) throw new ToolError(`查询视频任务失败：${result.message}`);
    const status = result.data?.status;
    if (status === "succeeded") {
      const videoUrl = result.data.output?.video_url;
      if (typeof videoUrl !== "string") throw new ToolError("任务已完成，但没有返回视频地址。");
      return { done: true, videoUrl };
    }
    if (status === "failed") {
      const failure = result.data.failure ?? {};
      const reason = [failure.code, failure.message].filter(Boolean).join("：") || "未知原因";
      const advice = FAILURE_ADVICE[failure.code] ?? "可以调整后重新生成。";
      throw new TaskEndedError(`视频生成失败（${reason}），这次不计费。${advice}`);
    }
    sendProgress(progressToken, round, result.transient ? `查询暂时失败，继续等待：${result.message}` : `视频生成中（${status ?? "未知"}）`);
    if (Date.now() + POLL_INTERVAL_MS > deadline) return { done: false, status: status ?? "unknown" };
    await sleep(POLL_INTERVAL_MS);
  }
}

function defaultOutputPath(prompt, extension) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const slug = (prompt ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 24) || "video";
  return join(projectDir(), "generated-videos", `${stamp}-${slug}${extension}`);
}

function urlExtension(url) {
  try {
    const extension = extname(new URL(url).pathname).toLowerCase();
    return OUTPUT_EXTENSIONS.has(extension) ? extension : undefined;
  } catch {
    return undefined;
  }
}

async function saveVideo(call, videoUrl, prompt, outputPath) {
  let response;
  try {
    response = await fetch(videoUrl, { signal: AbortSignal.timeout(withinBudget(call, DOWNLOAD_TIMEOUT_MS)) });
  } catch {
    return { saved: undefined, warning: "视频已生成，但下载失败，可直接使用临时链接。" };
  }
  if (!response.ok) return { saved: undefined, warning: `视频已生成，但下载失败（HTTP ${response.status}）。` };
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
  const extension = VIDEO_EXT[type] ?? urlExtension(videoUrl) ?? ".mp4";
  // 扩展名以实际媒体类型为准，用户写错也不会存出一个打不开的文件。
  const target = outputPath
    ? outputPath.slice(0, outputPath.length - extname(outputPath).length) + extension
    : defaultOutputPath(prompt, extension);
  try {
    const bytes = await readLimited(response);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  } catch {
    return { saved: undefined, warning: "视频已生成，但保存失败，可直接使用临时链接。" };
  }
  return { saved: target };
}

async function finish(call, taskId, { prompt, outputPath, progressToken, invocationId }) {
  let outcome;
  try {
    outcome = await waitForTask(call, taskId, progressToken);
  } catch (error) {
    // 任务已经提交成功：除非它已到终态，否则报错里必须带上 task_id，问题恢复后才能接回、不必重新提交。
    if (error instanceof TaskEndedError) throw error;
    const reason = error instanceof ToolError ? error.message : `查询视频任务出错：${error?.message ?? error}`;
    throw new ToolError(
      `${reason}\n视频任务已提交，task_id：${taskId}\n` +
        "问题解决后请用 get_happyhorse_video_result 继续查询，不要重新调用 generate_happyhorse_video（会重复扣费）。",
    );
  }
  if (!outcome.done) {
    return {
      content: [
        {
          type: "text",
          text:
            `视频还在生成（${outcome.status}），task_id：${taskId}\n` +
            "请稍后调用 get_happyhorse_video_result 继续等待，不要重新调用 generate_happyhorse_video（会重复扣费）。",
        },
      ],
      structuredContent: { status: outcome.status, task_id: taskId, path: null, video_url: null },
    };
  }
  const { saved, warning } = await saveVideo(call, outcome.videoUrl, prompt, outputPath);
  const lines = [
    saved ? `已生成并保存：${saved}` : warning,
    `临时链接（会过期）：${outcome.videoUrl}`,
    `task_id：${taskId}`,
    invocationId ? `invocation_id：${invocationId}` : undefined,
  ].filter(Boolean);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: { status: "succeeded", task_id: taskId, path: saved ?? null, video_url: outcome.videoUrl },
  };
}

async function generateVideo(args, meta) {
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) throw new ToolError("prompt 不能为空。");
  if (prompt.length > MAX_PROMPT_CHARS) throw new ToolError(`prompt 不能超过 ${MAX_PROMPT_CHARS} 个字符。`);
  const call = { origin: resolveApiOrigin(), authHeaders: readAuthHeaders(meta), startedAt: Date.now() };
  const outputPath = await resolveOutputPath(args.output_path);
  const requestId = typeof args.request_id === "string" ? args.request_id.trim() : "";
  const pending = await loadPendingBody(requestId);
  // 没有首次的请求体就重放不了：重建可能换素材地址，服务端只会一直回 3702。
  if (requestId && !pending) {
    throw new ToolError(
      `找不到 request_id 对应的提交记录（可能已过期或已清理），无法确认原任务是否已创建。` +
        "请告诉用户这个情况，由用户决定是否重新提交（可能重复扣费）。",
    );
  }
  const body = pending ?? (await buildSubmitBody(call, args, prompt));
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
    throw new ToolError("请求体超过 4 MiB：请缩短提示词或减少图片地址。");
  }
  const { taskId, invocationId } = await submitTask(call, body, requestId);
  const result = await finish(call, taskId, {
    prompt,
    outputPath,
    progressToken: meta?.progressToken,
    invocationId,
  });
  // request_id 重放的是首次提交的内容；这次参数不同也不会生效，要让 Agent 知道。
  if (pending) {
    const changed = replayDiffers(pending, prompt, args);
    if (changed.length) {
      const original = [
        `提示词：${pending.prompt}`,
        `时长：${pending.duration ?? "默认"}`,
        `分辨率：${pending.resolution ?? "默认"}`,
        `画幅：${pending.ratio ?? "默认"}`,
      ].join("，");
      result.content[0].text =
        `注意：按 request_id 重放的是首次提交的内容（${original}），本次修改的${changed.join("、")}没有生效。\n` +
        result.content[0].text;
    }
  }
  return result;
}

async function getVideoResult(args, meta) {
  const taskId = typeof args?.task_id === "string" ? args.task_id.trim() : "";
  if (!taskId) throw new ToolError("task_id 不能为空。");
  const call = { origin: resolveApiOrigin(), authHeaders: readAuthHeaders(meta), startedAt: Date.now() };
  return finish(call, taskId, {
    prompt: args.prompt,
    outputPath: await resolveOutputPath(args.output_path),
    progressToken: meta?.progressToken,
  });
}

const HANDLERS = { [GENERATE_TOOL]: generateVideo, [RESULT_TOOL]: getVideoResult };

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
      return send({ id, result: { tools: [GENERATE, RESULT] } });
    case "tools/call": {
      const handler = HANDLERS[params?.name];
      if (!handler) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      try {
        return send({ id, result: await handler(params.arguments ?? {}, params._meta) });
      } catch (error) {
        const text = error instanceof ToolError ? error.message : `视频生成失败：${error?.message ?? error}`;
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
