// ZCode 官方 3D 建模（Hi3D）MCP 服务（stdio，零依赖）。
//
// 链路：ZCode 宿主在每次 tools/call 的 params._meta["com.zcode/official-mcp-auth"] 里下发
// 当前登录身份头 → 本进程带着这些头调 `${ZCODE_BASE_URL}/api/v1/toolhub/...` → zcode-server
// 校验身份后转发给 ToolHub 的 hi3d_model3d 工具。身份逐调用现取，不进 env、不落盘、不进日志。
//
// 3D 建模是「提交 + 查询」：任务成功才扣费，但提交一次就可能建出一个会扣费的任务，所以同一次提交的
// 所有重试都复用同一个 Idempotency-Key；单次工具调用等不完时把 task_id 交回给 Agent，由 get_hi3d_task 接着等。
// 产物链接只有 1 小时有效，下载因链接过期失败时重新查询一次拿新链接再下。
//
// 文件结构：本插件的常量、工具定义和 Hi3D 专属的校验 / 产物挑选在前。「共享核心」一段（信封、提交重放、等待、
// 下载、结果格式）、MCP 协议一段，以及 Meshy / Hyper3D 的动画库一段，与本仓库 plugins/meshy-3d、plugins/hi3d-3d、
// plugins/hyper3d-3d 三个 ZCode 官方 3D 插件的 server.mjs 逐字一致（与第三方 hyper3d-rodin、tripo-3d 无关），
// 改动时三个插件一起改；各插件的测试会对仓库里已存在的兄弟插件做逐字节比对。
// 接口契约见《ZCode ToolHub 工具接口文档（客户端）》和 hi3d_model3d 接入说明。
import { createHash, randomUUID } from "node:crypto";
import dns from "node:dns";
import { realpathSync } from "node:fs";
import { mkdir, open, readdir, readFile, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const SERVER_NAME = "hi3d-3d";
const SERVER_VERSION = "0.1.0";
const BRAND = "Hi3D";
const AUTH_META_KEY = "com.zcode/official-mcp-auth";
// 计费场景：zcode-server 把这个头透传给 ToolHub，用来按插件归类用量、在 MaaS 账单里按插件展示。
// 值是和服务端约定的计费场景名（白名单），改动前要先和服务端对齐。提交、查询、上传都带。
const USAGE_SCENARIO_HEADER = "X-Usage-Scenario";
const USAGE_SCENARIO = "hi3d_model3d";
const SCENARIO_HEADERS = { [USAGE_SCENARIO_HEADER]: USAGE_SCENARIO };
const SUBMIT_TOOL = "submit_hi3d_task";
const RESULT_TOOL = "get_hi3d_task";
const ENV_PREFIX = "HI3D_3D_";

const SUBMIT_PATH = "/api/v1/toolhub/tool/hi3d_model3d/invoke";
const QUERY_PATH = "/api/v1/toolhub/tool/hi3d_model3d/tasks/query";
const UPLOAD_PATH = "/api/v1/toolhub/files";
// 提交时 ToolHub 要先拉取参考图 / 模型再转交上游，接入文档建议 hi3d_model3d 的服务端超时配到 120s；
// 这里在其基础上放宽 10%，让服务端先返回明确结果，避免网络抖动时把已受理的提交误判为超时。
const SUBMIT_TIMEOUT_MS = 132_000;
const QUERY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
// Hi3D 拉取参考图的上限是每张 10 MB。
const MAX_IMAGE_MIB = 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MIB * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = envNumber("MAX_DOWNLOAD_BYTES", 300 * 1024 * 1024);
const MAX_DOWNLOAD_FILES = 20;
const RETRY_DELAY_MS = envNumber("RETRY_DELAY_MS", 5_000);
const SUBMIT_MAX_ATTEMPTS = 4;
const MIN_REQUEST_MS = 100;
// 文档建议每 5–15 秒查询一次。
const POLL_INTERVAL_MS = envNumber("POLL_INTERVAL_MS", 10_000);
// 宿主的 timeoutMs（plugin.json 330s）是从调用开始算的硬上限，进度通知不会续期；超时后 Agent 拿不到
// task_id / request_id，只能重新提交。所以上传、提交、轮询、下载共用这一份预算，都从调用开始算。
const CALL_BUDGET_MS = envNumber("CALL_BUDGET_MS", 320_000);
const WAIT_BUDGET_MS = envNumber("WAIT_BUDGET_MS", 220_000);
const LINK_TTL_TEXT = `产物链接 1 小时内有效、服务端不转存，过期后用 ${RESULT_TOOL} 再查一次即可拿到新链接（只查询，不会重新提交）。`;
const STILL_RUNNING_EXTRA = "贴图任务可能需要 7 分钟左右。";

const AUTH_REASON_TEXT = {
  official_auth_unavailable: "ZCode 未登录，或当前没有可用的连接。请登录后新建会话再试。",
  official_auth_plan_required:
    "3D 建模需要已连接的 Coding Plan（个人或团队）。只用 API Key 或 Start Plan 的连接暂不可用。",
  official_mcp_origin_untrusted: "ZCode 拒绝向当前服务地址发送身份，属于客户端配置问题。",
};

const ERROR_CODE_TEXT = {
  3001: "请求参数不合法（字段缺失或取值不对、图片或模型地址不被接受、task_id 类型与 action 不匹配等），没有创建任务",
  3002: "请求过于频繁，请稍后再试",
  3101: "当前账号在所选范围内没有有效的 Coding Plan 订阅：请订阅 Coding Plan，或在 ZCode 中切换到有订阅的个人 / 团队后再试",
  3701: "3D 建模服务暂不可用，请稍后再试",
  3702: "同一请求正在处理中，请稍后再试",
  3703:
    "提交被拒绝（上游拒绝、内容审核、参数不被上游接受、前一步任务尚未完成或上游限流等），没有创建任务，未扣费，可调整后重新提交",
  3704: "任务不存在、已过期（Hi3D 任务超过 30 天），或不是当前账号提交的",
  3705: "3D 接口未在 ZCode 服务端开放，当前 ZCode 服务端可能还未上线该能力",
  3706: "当前账号无法使用 3D 建模：需要关联 Z.ai 账号并绑定手机号（海外账号需绑定邮箱）",
  3707: `参考图为空、过大或类型不支持（本地上传仅支持 png / jpeg / webp，最大 ${MAX_IMAGE_MIB} MiB）`,
  2005: "参考图上传失败，请稍后重试",
  2007: "服务端或上游暂时故障，请稍后重试",
};
// 2005 上传失败、2007 上游暂时故障、3002 限流、3702 同一请求还在处理：都按暂时性故障处理。
const TRANSIENT_CODES = new Set([2005, 2007, 3002, 3702]);
const FORBIDDEN_TEXT = "当前账号没有使用 3D 建模的权限（HTTP 403）。";

const IMAGE_MIME = Object.assign(Object.create(null), {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
});
const DATA_IMAGE_EXT = Object.assign(Object.create(null), { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" });
// 常见 3D 模型扩展名：本地文件一律拒绝（上传接口不收 3D 文件），也不能当参考图用。
const MODEL_FILE_EXT = new Set([".glb", ".gltf", ".obj", ".stl", ".fbx", ".usdz", ".usd", ".usda", ".usdc", ".3mf", ".ply", ".blend", ".dae"]);
const LOCAL_MODEL_TEXT =
  "本地 3D 模型文件无法使用：ZCode 上传接口不接受 3D 文件。请提供模型的 https 地址（model_url），或用 task_id 串联本插件之前的任务。";

// ── Hi3D 的取值范围（以 hi3d_model3d 接入说明为准）──
const ACTIONS = ["generate", "texture", "split"];
const VIEWS = ["front", "back", "left", "right"];
const FORMATS = ["obj", "glb", "stl", "fbx", "usdz", "3mf"];
const SPLIT_TYPES = ["character", "general"];
const PARTS = ["a", "b", "c", "d", "e", "f"];
const JOINTS = ["none", "ball", "dovetail", "pin"];
const MERGES = ["yes", "no"];
const LEVELS = ["low", "medium", "high"];
const MAX_IMAGES = 4;
const FACE_MIN = 100_000;
const FACE_MAX = 2_000_000;
// 各 action 能用的字段；其余字段传了就报错，免得被静默忽略。
const ACTION_FIELDS = {
  generate: ["images", "views", "geometry_only", "face", "format"],
  texture: ["task_id", "model_url", "image", "format"],
  split: ["task_id", "model_url", "type", "part", "joint", "merge", "level", "format"],
};
const ALL_FIELDS = [...new Set(Object.values(ACTION_FIELDS).flat())];
// 用 task_id 串联时，前一步任务的种类（task_id 前缀）必须对得上。
const TASK_PREFIXES = { texture: ["gen:"], split: ["gen:", "tex:"] };
const MODEL_URL_EXTENSIONS = { texture: [".glb"], split: [".glb", ".obj", ".stl"] };

// ── 工具定义（描述与 Meshy / Hyper3D 插件同一结构：是什么 → 计费与等待 → action → 串联规则 → 输入限制）──

const IMAGE_DESCRIPTION = `https 地址、工作区内的本地路径或 data:image/...;base64 URL（本地文件和 data: 会先上传到 ZCode）；仅支持 png / jpeg / webp，不超过 ${MAX_IMAGE_MIB} MiB`;
const OUTPUT_DIR_PROPERTY = {
  type: "string",
  description:
    "可选，产物保存目录（相对工作区或工作区内的绝对路径），不存在会自动创建，已有文件不会被覆盖。" +
    "不填则保存到工作区 generated-3d/<时间>-<类型>-<描述>/ 下。",
};
const REQUEST_ID_PROPERTY = {
  type: "string",
  description: "可选，仅在上一次调用返回「提交未确认」并给出 request_id 时原样传回，用于重放同一次提交而不重复扣费；其余参数保持不变。",
};

const SUBMIT = {
  name: SUBMIT_TOOL,
  description:
    "ZCode 官方 Hi3D 3D 建模（按 Coding Plan 计费，无需 Hi3D 账号）：提交一个任务并等待结果，完成后把模型和封面图下载到工作区。" +
    `任务成功才扣费（失败不扣费），每次调用都会提交一个新任务：本工具等不完时会返回 task_id，请改用 ${RESULT_TOOL} 继续等待，不要重复调用本工具。\n` +
    "action：generate（用 1–4 张参考图生成 3D 模型；1 张为单图，2–4 张为多视角，必须包含正面）、" +
    "texture（给白模贴图，必须给参考图 image）、split（把模型拆成部件）。\n" +
    "texture / split 的模型来源是 task_id 或 model_url（https）二选一：texture 的 task_id 只接受 gen: 开头、model_url 只支持 .glb；" +
    "split 的 task_id 接受 gen: / tex: 开头、model_url 支持 .glb / .obj / .stl。用 task_id 串联时前一步任务必须已经成功。\n" +
    "Hi3D 只接受图片：只有文字描述时，需要先用 Seedream（image-generation 插件的 generate_image）生成一张参考图（单个物体、纯色背景、完整视角）再提交。" +
    "调用 Seedream 前先告诉用户参考图要用 Seedream 生成、单独计费；用户不同意或 Seedream 不可用时，不调用 Seedream，请用户提供参考图（Hi3D 不能只用文字生成）。生图失败时如实报告，不要自己画图代替。\n" +
    `本地参考图（png / jpg / jpeg / webp，不超过 ${MAX_IMAGE_MIB} MiB）会自动上传；本地 3D 模型文件无法上传，请给 https 地址或用 task_id 串联。` +
    "task_id 原样传入，不要截断或改写。",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ACTIONS,
        description: "任务类型，见工具说明。",
      },
      images: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: MAX_IMAGES,
        description: `generate 必填：参考图 1–${MAX_IMAGES} 张（2–${MAX_IMAGES} 张为多视角，必须包含正面）。每张为${IMAGE_DESCRIPTION}。`,
      },
      views: {
        type: "array",
        items: { type: "string", enum: VIEWS },
        minItems: 1,
        maxItems: MAX_IMAGES,
        description:
          "generate 用，可选：与 images 一一对应的视角，取值 front / back / left / right，不能重复，长度必须与 images 相同。" +
          "不传时多张图按 front、back、left、right 的顺序理解。",
      },
      geometry_only: {
        type: "boolean",
        default: false,
        description: "generate 用，可选：true 只生成白模（不贴图，更便宜）；不传或 false 则生成带贴图的模型。",
      },
      face: {
        type: ["integer", "string"],
        description: `generate 用，可选：目标面数，${FACE_MIN}–${FACE_MAX} 的整数；不传由上游决定。不影响价格。`,
      },
      format: {
        type: "string",
        enum: FORMATS,
        description: `可选，输出格式：${FORMATS.join(" / ")}，默认 glb，每个任务只出一种格式。`,
      },
      task_id: {
        type: "string",
        description:
          "texture / split 用：本插件之前返回的 task_id，原样传入。texture 只接受 gen: 开头的；split 接受 gen: / tex: 开头的。与 model_url 二选一。",
      },
      model_url: {
        type: "string",
        description:
          "texture / split 用：自己的模型 https 地址（不超过 200 MB，由 Hi3D 直接拉取）。texture 只支持 .glb；split 支持 .glb / .obj / .stl。与 task_id 二选一。不接受本地文件。",
      },
      image: {
        type: "string",
        description: `texture 必填：贴图参考图，${IMAGE_DESCRIPTION}。`,
      },
      type: {
        type: "string",
        enum: SPLIT_TYPES,
        description: "split 用，可选：character（角色，默认）或 general（通用物体）。",
      },
      part: {
        type: "string",
        enum: PARTS,
        description: "split 且 type=character 时可选：拆分模板 a–f，默认 a（6 个部件）。",
      },
      joint: {
        type: "string",
        enum: JOINTS,
        description: "split 且 type=character 时可选：关节样式 none / ball / dovetail / pin，默认 ball。",
      },
      merge: {
        type: "string",
        enum: MERGES,
        description: "split 且 type=character 时可选：是否合并，yes / no，默认 yes。",
      },
      level: {
        type: "string",
        enum: LEVELS,
        description: "split 且 type=general 时可选：拆分粒度 low / medium / high，默认 medium。",
      },
      output_dir: OUTPUT_DIR_PROPERTY,
      request_id: REQUEST_ID_PROPERTY,
    },
    required: ["action"],
    additionalProperties: false,
  },
  annotations: { title: "提交 Hi3D 3D 任务", readOnlyHint: false, openWorldHint: true },
};

const RESULT = {
  name: RESULT_TOOL,
  description:
    "继续等待一个已提交的 Hi3D 任务，完成后把模型和封面图下载到工作区。只查询，不会重新提交、不产生新任务、不额外扣费。" +
    "每次调用最多等几分钟，仍未完成时会再次返回 task_id。产物链接 1 小时内有效，过期后再调用一次本工具即可拿到新链接。",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string", description: `${SUBMIT_TOOL} 返回的 task_id，原样传入，不要截断或改写。` },
      output_dir: OUTPUT_DIR_PROPERTY,
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  annotations: { title: "获取 Hi3D 3D 任务结果", readOnlyHint: false, openWorldHint: true },
};

// ════════ Hi3D 专属：参数校验、请求体、产物挑选 ════════

function taskIdArg(value, action) {
  const taskId = opaqueTaskId(value);
  if (taskId === undefined) return undefined;
  const allowed = TASK_PREFIXES[action];
  if (!allowed.some((prefix) => taskId.startsWith(prefix))) {
    const what = action === "texture" ? "generate 任务的 id（gen: 开头）" : "generate 或 texture 任务的 id（gen: / tex: 开头）";
    throw new ToolError(`action=${action} 的 task_id 只能是 ${what}，收到：${preview(taskId)}`);
  }
  return taskId;
}

/** 整数参数，也接受十进制数字字符串。 */
function integerArg(value, name, min, max) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined;
  const n = typeof value === "string" ? (/^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ToolError(`${name} 必须是 ${min} 到 ${max} 的整数，收到：${preview(value)}。`);
  }
  return n;
}

/** 本地校验全部参数并读好本地参考图，返回不含图片的请求体骨架和待处理的图片；任何问题都在发请求之前抛出。 */
async function validateSubmit(args) {
  const action = enumArg(args.action, "action", ACTIONS);
  if (!action) throw new ToolError(`action 必填，可选：${ACTIONS.join(" / ")}。`);
  const allowed = new Set(ACTION_FIELDS[action]);
  for (const field of ALL_FIELDS) {
    if (!allowed.has(field) && present(args[field])) {
      const owners = ACTIONS.filter((name) => ACTION_FIELDS[name].includes(field)).join(" / ");
      throw new ToolError(`${field} 只用于 action=${owners}，action=${action} 不接受这个字段。`);
    }
  }
  const body = { action };
  const plan = { body, images: undefined, image: undefined };
  if (action === "generate") {
    const images = args.images;
    if (!Array.isArray(images) || images.length === 0) throw new ToolError(`action=generate 必须提供 images（1–${MAX_IMAGES} 张参考图）。`);
    if (images.length > MAX_IMAGES) throw new ToolError(`images 最多 ${MAX_IMAGES} 张，收到 ${images.length} 张。`);
    if (present(args.views)) {
      const views = args.views;
      if (!Array.isArray(views)) throw new ToolError("views 必须是数组。");
      if (views.length !== images.length) {
        throw new ToolError(`views 的长度必须与 images 相同（images ${images.length} 张，views ${views.length} 个）。`);
      }
      const normalized = views.map((view, index) => {
        const value = enumArg(view, `views[${index}]`, VIEWS);
        if (!value) throw new ToolError(`views[${index}] 必填，取值：${VIEWS.join(" / ")}。`);
        return value;
      });
      if (new Set(normalized).size !== normalized.length) throw new ToolError("views 不能有重复的视角。");
      if (normalized.length >= 2 && !normalized.includes("front")) throw new ToolError("多视角生成（2–4 张图）必须包含正面：views 里需要有 front。");
      body.views = normalized;
    }
    if (boolArg(args.geometry_only, "geometry_only") === true) body.geometry_only = true;
    const face = integerArg(args.face, "face", FACE_MIN, FACE_MAX);
    if (face !== undefined) body.face = face;
    plan.images = [];
    for (const [index, value] of images.entries()) plan.images.push(await prepareImage(value, `images[${index}]`));
  } else {
    const taskId = taskIdArg(args.task_id, action);
    const modelUrl = modelUrlArg(args.model_url, action, MODEL_URL_EXTENSIONS[action]);
    if (taskId && modelUrl) throw new ToolError(`${action} 的 task_id 和 model_url 只能二选一。`);
    if (!taskId && !modelUrl) throw new ToolError(`${action} 需要 task_id（本插件之前的任务）或 model_url（模型的 https 地址），二选一。`);
    if (taskId) body.task_id = taskId;
    else body.model_url = modelUrl;
    if (action === "texture") {
      if (!present(args.image)) throw new ToolError("action=texture 必须提供贴图参考图 image。");
      plan.image = await prepareImage(args.image, "image");
    } else {
      const type = enumArg(args.type, "type", SPLIT_TYPES);
      if (type) body.type = type;
      if ((type ?? "character") === "general") {
        for (const field of ["part", "joint", "merge"]) {
          if (present(args[field])) throw new ToolError(`${field} 只用于 type=character 的拆分，type=general 请改用 level。`);
        }
        const level = enumArg(args.level, "level", LEVELS);
        if (level) body.level = level;
      } else {
        if (present(args.level)) throw new ToolError("level 只用于 type=general 的拆分；type 不传时按 character 处理。");
        const part = enumArg(args.part, "part", PARTS);
        const joint = enumArg(args.joint, "joint", JOINTS);
        const merge = enumArg(args.merge, "merge", MERGES);
        if (part) body.part = part;
        if (joint) body.joint = joint;
        if (merge) body.merge = merge;
      }
    }
  }
  const format = enumArg(args.format, "format", FORMATS);
  if (format) body.format = format;
  return plan;
}

/** 校验通过后才上传本地图片，组装最终请求体（字段顺序固定，便于排查）。 */
async function buildSubmitBody(call, plan) {
  const { action, ...rest } = plan.body;
  const body = { action };
  if (plan.images) {
    body.images = [];
    for (const [index, prepared] of plan.images.entries()) body.images.push(await resolveImage(call, prepared, `images[${index}]`));
  }
  Object.assign(body, rest);
  if (plan.image) body.image = await resolveImage(call, plan.image, "image");
  return body;
}

function rejectionHint() {
  return "";
}

function submitFinishOptions() {
  return {};
}

function resultFinishOptions() {
  return {};
}

/**
 * succeeded 时 output.url 是模型（拆分时为拆分结果），output.cover_url 是封面图。上游可能先改状态、后写产物：
 * output 还不是对象、或者里面还没有模型地址时返回 undefined，由 waitForTask 继续轮询。
 */
function completedProducts(data) {
  const output = data.output;
  if (!isPlainObject(output) || typeof output.url !== "string" || !output.url) return undefined;
  return { output };
}

const PRODUCTS = [
  { key: "model", field: "url", label: "模型", fallback: "model" },
  { key: "cover", field: "cover_url", label: "封面图", fallback: "cover" },
];
// 产物链接过期（或被 CDN 拒绝）时的典型状态码：重新查询一次拿新链接再下。
const EXPIRED_STATUSES = new Set([401, 403, 404, 410]);

/**
 * 文件名取链接路径最后一段（不安全的部分由 sanitizeFileName 清洗），拿不到时用 fallback。
 * source_name 是链接里的原名（没有时为 null），结果里据此列出改过名的文件。
 */
function productName(url, fallback) {
  const source = urlFileName(url);
  return { name: sanitizeFileName(source, fallback), source_name: source || null };
}

async function deliverProducts(call, taskId, { output }, target, base, { invocationId }) {
  const items = PRODUCTS.filter((product) => typeof output[product.field] === "string" && output[product.field]).map((product) => ({
    key: product.key,
    label: product.label,
    field: product.field,
    fallback: product.fallback,
    url: output[product.field],
    ...productName(output[product.field], product.fallback),
  }));
  const files = await saveProducts(call, items, target);
  const expired = files.filter((file) => !file.path && EXPIRED_STATUSES.has(file.status));
  if (expired.length && call.startedAt + CALL_BUDGET_MS - Date.now() > QUERY_TIMEOUT_MS / 10) {
    // 链接 1 小时有效、不转存；重新查询同一个 task_id 会拿到新链接（只查询，不会重新提交）。
    // 查询失败就保留原链接和原因；宿主取消照常往外抛。新链接同样校验第一个链接并逐跳校验重定向（downloadProduct）。
    const refreshed = await queryTask(call, taskId).catch((error) => {
      if (error instanceof Cancelled) throw error;
      return undefined;
    });
    const fresh = refreshed?.data?.status === "succeeded" && isPlainObject(refreshed.data.output) ? refreshed.data.output : undefined;
    if (fresh) {
      for (const file of expired) {
        const url = fresh[file.field];
        if (typeof url !== "string" || !url) continue;
        const named = productName(url, file.fallback);
        Object.assign(file, { url, ...named, status: undefined, warning: undefined }, await downloadProduct(call, url, target, named.name));
      }
    }
  }
  const links = Object.fromEntries(files.map((file) => [file.key, file.url]));
  return completedResult(taskId, base, { files, links, invocationId });
}

function nextStepHint(taskId) {
  if (taskId.startsWith("gen:")) return "可把这个 task_id 原样用于 action=texture（贴图）或 action=split（拆分）。";
  if (taskId.startsWith("tex:")) return "可把这个 task_id 原样用于 action=split（拆分）。";
  return undefined;
}

// ════════ 共享核心：plugins/meshy-3d、plugins/hi3d-3d、plugins/hyper3d-3d 三个插件逐字一致，只通过文件开头的常量区分 ════════

class ToolError extends Error {}

/** 任务已到终态（失败 / 不存在），不能再用查询工具接回。 */
class TaskEndedError extends ToolError {}

/**
 * 2xx 但响应体不是信封（JSON 被截短、代理插页等）：服务端可能已经受理。提交时按结果不明处理、
 * 同键重放；查询和上传仍当作普通错误。
 */
class UnreadableSuccessError extends ToolError {}

/** 宿主取消了这次调用（notifications/cancelled）：不再发请求、不再重试、不再下载，也不回结果。 */
class Cancelled extends Error {}

// 接口 JSON（信封、上传响应）的读取上限；产物下载另有 MAX_DOWNLOAD_BYTES。
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
// 产物下载手动跟随重定向的最多跳数，第一个链接按 downloadableUrl、每一跳按 redirectAllowed 校验（非回环模式下另有 dnsRefusal）。
const MAX_DOWNLOAD_REDIRECTS = 5;
// 开始下载一个产物时，整次调用至少还要剩这么多时间，否则只给链接（测试钩子可以调大，让结果不取决于机器快慢）。
const MIN_DOWNLOAD_MS = envNumber("MIN_DOWNLOAD_MS", MIN_REQUEST_MS);
// 服务端把这个请求转给了上游、上游明确拒绝：上游拒绝（3703）、参考图不合格（3707）。只有这个键此前从没被服务端
// 受理过（没收到过 code 0 的 UNKNOWN / CALLING / 缺 task_id、2xx 读不懂或过大的响应、3702 同键处理中）时，
// 才能据此认定这个键没有建出任务：删掉暂存记录，按提交失败报告，不再提示重放。受理过的键在重放时被拒绝
// （例如上游限流、参考图地址过期），证明不了之前那次没建出任务，照旧交回 request_id。
// 3001 也可能是当前团队 / 个人范围不完整，和这个键无关；它和 401、3101、3705、3706、无法识别的响应、
// 暂时性故障等一样，都证明不了任务没建，照旧交回 request_id。
const DEFINITE_REJECTION_CODES = new Set([3703, 3707]);

function stopIfCancelled(call) {
  if (call.signal.aborted) throw new Cancelled();
}

/** 重试、轮询之间的等待：被取消时立刻醒来并抛 Cancelled。 */
async function pause(call, ms) {
  stopIfCancelled(call);
  await new Promise((done) => {
    const wake = () => {
      clearTimeout(timer);
      call.signal.removeEventListener("abort", wake);
      done();
    };
    const timer = setTimeout(wake, ms);
    call.signal.addEventListener("abort", wake, { once: true });
  });
  stopIfCancelled(call);
}

/**
 * 每个请求一个信号：到时（不超过整次调用剩余的预算）或宿主取消这次调用时中止，覆盖连接和读响应体。
 * run 结束后清掉计时器和监听，长时间轮询也不会在调用的信号上越积越多。
 */
async function withRequestSignal(call, ms, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), withinBudget(call, ms));
  const cancel = () => controller.abort(call.signal.reason);
  if (call.signal.aborted) cancel();
  else call.signal.addEventListener("abort", cancel, { once: true });
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    call.signal.removeEventListener("abort", cancel);
  }
}

/** 测试钩子：`<ENV_PREFIX><NAME>`，空值或非法值回落到默认值。 */
function envNumber(name, fallback) {
  const raw = process.env[`${ENV_PREFIX}${name}`];
  const value = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

// ── 未确认提交的请求体 ──

// request_id → 首次提交的请求体 body，以及调用方首次传入的业务参数的指纹 args（每个字段一个 sha256，
// 用来在重放时指出哪些修改没有生效；只存指纹，不存 data: 图片和本地路径原文）。重放必须逐字节复用请求体：
// 本地参考图重新上传会换 URL，请求体一变，同一个 Idempotency-Key 就会被服务端判成 3702。存到插件数据目录
// （macOS / Linux 上文件权限 0600、目录 0700；Windows 上依赖用户配置目录的 ACL），MCP 进程重启后也能重放。
// 记录只含首次保存的时间 createdAt、服务端是否受理过这个键 accepted、action、参数、素材地址和参数指纹，
// 不含身份；确认、明确拒绝或过期后删除。
const PENDING_DIR = join(
  process.env.ZCODE_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), `.zcode-${SERVER_NAME}`),
  "pending",
);
// 参考图预签名地址默认 24 小时过期，超过这个时间的请求体重放也没有意义，到期清理。
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function pendingPath(key) {
  return /^[A-Za-z0-9-]{1,64}$/.test(key) ? join(PENDING_DIR, `${key}.json`) : undefined;
}

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** 读一条记录（JSON 对象）；不存在、读不到或格式不对时返回 undefined。 */
async function readPendingRecord(path) {
  try {
    const record = JSON.parse(await readFile(path, "utf8"));
    return isPlainObject(record) ? record : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 有效期从首次保存时写入的 createdAt（毫秒）算起，24 小时；重放时重写记录不会续期。
 * 没有 createdAt，或它离现在超过有效期（含系统时钟被往回调的情况）都算过期。
 */
function pendingFresh(record) {
  return Number.isFinite(record?.createdAt) && Math.abs(Date.now() - record.createdAt) <= PENDING_TTL_MS;
}

/** 读未确认提交的记录 `{ body, args, createdAt, accepted }`；不存在、过期或格式不对时返回 undefined。 */
async function loadPending(key) {
  const path = key && pendingPath(key);
  if (!path) return undefined;
  const record = await readPendingRecord(path);
  if (!record || !isPlainObject(record.body)) return undefined;
  // 过期的请求体按不存在处理并删除：素材地址已失效，服务端也未必还记得这个幂等键，重放不再安全。
  if (!pendingFresh(record)) {
    await rm(path, { force: true }).catch(() => {});
    return undefined;
  }
  return {
    body: record.body,
    args: isPlainObject(record.args) ? record.args : {},
    createdAt: record.createdAt,
    accepted: record.accepted === true,
  };
}

/**
 * 清理过期记录。修改时间都超过有效期的一定过期（createdAt 不会晚于修改时间）；其余按 createdAt 判断。
 * 读不懂的记录可能正被别的调用写到一半，先不动，等它的修改时间也过期再删。
 */
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
      if (!info) return;
      const record = info.mtimeMs < cutoff ? undefined : await readPendingRecord(path);
      if (info.mtimeMs < cutoff || (Number.isFinite(record?.createdAt) && !pendingFresh(record))) {
        await rm(path, { force: true }).catch(() => {});
      }
    }),
  );
}

/**
 * 写入记录：写好返回 "saved"；写不进去（数据目录不可写等）返回 "failed"；记录已过有效期返回 "expired"，不写。
 * 按 request_id 重放时传入 loadPending 读到的 createdAt：有效期始终从第一次保存算起，重放跨过 24 小时也不会
 * 被当成新记录续期。accepted 记下服务端是否受理过这个键，一旦为 true 就一直保留。
 */
async function savePending(key, body, args, { createdAt = Date.now(), accepted = false } = {}) {
  const path = pendingPath(key);
  if (!path) return "failed";
  if (!pendingFresh({ createdAt })) {
    await rm(path, { force: true }).catch(() => {});
    return "expired";
  }
  await prunePendingBodies();
  try {
    await mkdir(PENDING_DIR, { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ createdAt, accepted, body, args: args ?? {} }), { mode: 0o600 });
    return "saved";
  } catch {
    return "failed";
  }
}

// 只在本地用、不进请求体的参数：不算「业务参数」，重放时改了也不用提示。
const LOCAL_ARGS = new Set(["request_id", "output_dir"]);

/** 稳定序列化：对象键排序、字符串去首尾空白，同样的值不管键顺序都得到同一个串。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(typeof value === "string" ? value.trim() : value) ?? "null";
}

/** schema 里的类型列表（type 可以是字符串或数组）。 */
function schemaTypes(schema) {
  return [schema?.type].flat().filter((type) => typeof type === "string");
}

/**
 * 按参数 schema 把值整理成校验器眼里的等价形式，免得只是写法不同也被当成「改过」：
 * 枚举不分大小写（也认带点的格式名，如 .GLB）；integer / number 接受十进制数字字符串；https 地址取规范形式；
 * uniqueItems 的数组去重。不认识的值原样保留。
 */
function canonicalArg(schema, value) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalArg(schema?.items, item));
    return schema?.uniqueItems ? items.filter((item, index) => items.findIndex((other) => stableJson(other) === stableJson(item)) === index) : items;
  }
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (Array.isArray(schema?.enum)) {
    const lower = text.toLowerCase();
    const found = schema.enum.find((item) => typeof item === "string" && [lower, lower.replace(/^\./, "")].includes(item.toLowerCase()));
    if (found !== undefined) return found;
  }
  const types = schemaTypes(schema);
  if (types.includes("integer") && /^-?\d+$/.test(text)) return Number(text);
  if (types.includes("number") && /^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return httpsHref(text) ?? text;
}

/**
 * 调用方传入的业务参数（上传、解析之前）的指纹，先按 canonicalArg 整理。没传的不进指纹：undefined、null、
 * 空白字符串、空数组，以及等于 schema 里 default 的值（校验器对它们和不传一视同仁）。
 */
function argsFingerprint(args) {
  const fingerprint = {};
  const properties = SUBMIT.inputSchema.properties;
  for (const [key, value] of Object.entries(args)) {
    if (LOCAL_ARGS.has(key) || value === undefined || value === null) continue;
    const schema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    const canonical = canonicalArg(schema, value);
    if (canonical === "" || (Array.isArray(canonical) && !canonical.length)) continue;
    if (schema && Object.hasOwn(schema, "default") && stableJson(canonical) === stableJson(schema.default)) continue;
    fingerprint[key] = createHash("sha256").update(stableJson(canonical)).digest("hex");
  }
  return fingerprint;
}

async function dropPending(key) {
  const path = pendingPath(key);
  if (path) await rm(path, { force: true }).catch(() => {});
}

// ── 工作区路径 ──

function projectDir() {
  return process.env.ZCODE_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * 按真实路径判断（符号链接不能带出工作区），目标不存在时取最近的已存在祖先。
 * allowRoot：目录参数可以就是工作区根目录；文件参数不行。
 */
async function resolveInWorkspace(value, label, { allowRoot = false } = {}) {
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
  if ((!rel && !allowRoot) || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
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

/** 用户给的保存目录：必须在工作区内；已存在时必须是目录。提交前就检查，免得任务成功扣了费却存不下来。 */
async function resolveOutputDir(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError("output_dir 必须是字符串。");
  const requested = value.trim();
  if (!requested) return undefined;
  const target = await resolveInWorkspace(requested, "output_dir", { allowRoot: true });
  const info = await stat(target).catch(() => undefined);
  if (info && !info.isDirectory()) throw new ToolError(`output_dir 已存在且不是目录：${requested}`);
  return target;
}

// ── 调用上下文：origin、身份、预算、进度 ──

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
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new ToolError(`ZCODE_BASE_URL 必须是 https：${raw}`);
  }
  return url.origin;
}

function isLoopback(hostname) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}

function readAuthHeaders(meta) {
  const payload = meta && typeof meta === "object" ? meta[AUTH_META_KEY] : undefined;
  if (!payload || typeof payload !== "object") {
    throw new ToolError("没有拿到 ZCode 登录身份：请在已登录的 ZCode 中使用本插件。");
  }
  if (payload.ok !== true) {
    const reason = typeof payload.reason === "string" ? payload.reason : "official_auth_unavailable";
    const known = Object.hasOwn(AUTH_REASON_TEXT, reason) ? AUTH_REASON_TEXT[reason] : undefined;
    throw new ToolError(known ?? `ZCode 未提供登录身份（${cleanText(reason, 64) || "原因未知"}）。`);
  }
  const headers = {};
  // headers 必须是普通对象：字符串、数组会被 Object.entries 拆成一堆下标头发出去。
  for (const [name, value] of Object.entries(isPlainObject(payload.headers) ? payload.headers : {})) {
    if (typeof value === "string" && value.trim()) headers[name] = value;
  }
  if (!Object.keys(headers).length) throw new ToolError(AUTH_REASON_TEXT.official_auth_unavailable);
  try {
    // 头名或头值不合法（比如带换行）时 fetch 会在发请求前抛错，容易被误当成网络故障、进而提示「提交未确认」；这里先验掉。
    new Headers(headers);
  } catch {
    throw new ToolError("ZCode 提供的登录身份头不合法，请求没有发出。请重新登录后新建会话再试。");
  }
  return headers;
}

/**
 * 一次工具调用的上下文：所有预算都从 startedAt 算起；进度序号在整个调用内单调递增；
 * signal 在宿主取消这次调用时中止（等待、请求、下载都跟着停）。
 */
function newCall(meta, signal) {
  return {
    origin: resolveApiOrigin(),
    authHeaders: readAuthHeaders(meta),
    startedAt: Date.now(),
    progressToken: meta?.progressToken,
    progress: 0,
    signal: signal ?? new AbortController().signal,
  };
}

function sendProgress(call, message) {
  if (call.progressToken === undefined || call.progressToken === null || call.signal.aborted) return;
  call.progress += 1;
  send({ method: "notifications/progress", params: { progressToken: call.progressToken, progress: call.progress, message } });
}

// ── ZCode 信封 ──

/** 服务端 code 只认安全整数和规范的十进制整数字符串，其余一律当作没有 code（NaN），免得被当成成功。 */
function parseCode(value) {
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) ? value : NaN;
}

/** 服务端原文是不可信内容：去掉控制字符、折叠空白、按码点截断。 */
function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** 在报错里回显用户输入时截短。 */
function preview(value) {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  const chars = [...text];
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : text;
}

/** 固定文案只是大类，服务端 msg 才说清具体原因（BAD_PART、TASK_NOT_READY 等），一并带上，再附 code 和 logid。 */
function envelopeMessage(envelope) {
  const code = parseCode(envelope.code);
  const known = ERROR_CODE_TEXT[code];
  const serverMsg = cleanText(envelope.msg ?? envelope.message, 300);
  const quoted = serverMsg ? `服务端消息：“${serverMsg}”` : "";
  const detail = known ? (quoted ? `${known}；${quoted}` : known) : quoted || "未知错误";
  const logid = typeof envelope.logid === "string" && /^[\w.:-]{1,128}$/.test(envelope.logid) ? envelope.logid : "";
  const parts = [Number.isFinite(code) ? `code ${code}` : "", logid ? `logid ${logid}` : ""].filter(Boolean);
  return parts.length ? `${detail}（${parts.join("，")}）` : detail;
}

function parseEnvelope(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 接口响应只读前 max 字节：正常的 JSON 远小于它。声明的长度超限就不读；没声明的边读边数，
 * 读满就停（提前退出循环会取消响应流）。超限时 tooLarge 为 true，调用方不再解析。
 */
async function readTextLimited(response, max) {
  if (Number(response.headers.get("content-length")) > max) {
    await response.body?.cancel().catch(() => {});
    return { text: "", tooLarge: true };
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.length;
    if (total > max) return { text: "", tooLarge: true };
    chunks.push(chunk);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), tooLarge: false };
}

/**
 * 返回 `{ data }`；暂时性故障（网络、超时、429、2005、2007、3002、3702、无法解析的 5xx、读响应体时断线）
 * 返回 `{ transient, message }`；响应体超过 1 MiB 返回 `{ transient, tooLarge, message }`（提交按结果不明同键重放，
 * 其余调用方直接报错）；读响应体断线和响应过大时，answered2xx 表示状态码是 2xx（服务端已经受理）；
 * 其余错误码返回 `{ code, message }`，由调用方决定怎么处理。
 * 401 / 403 / 重定向 / 无法识别的响应直接抛 ToolError，其中 2xx 的无法识别响应抛 UnreadableSuccessError。
 * 宿主取消这次调用时抛 Cancelled。
 */
async function apiRequest(call, path, { headers, body, timeoutMs }) {
  stopIfCancelled(call);
  return withRequestSignal(call, timeoutMs, async (signal) => {
    let response;
    try {
      response = await fetch(call.origin + path, {
        method: "POST",
        headers: { ...call.authHeaders, ...headers, ...SCENARIO_HEADERS },
        body,
        // 身份头只能发往 ZCode 自己的 origin，禁止跟随重定向。
        redirect: "manual",
        signal,
      });
    } catch (error) {
      stopIfCancelled(call);
      return { transient: true, message: error?.name === "TimeoutError" ? "请求超时" : "网络错误" };
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      throw new ToolError("ZCode 登录身份已失效：请重新登录后再试。");
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      throw new ToolError("服务端返回了重定向，已拒绝。");
    }
    let read;
    try {
      read = await readTextLimited(response, MAX_API_RESPONSE_BYTES);
    } catch (error) {
      stopIfCancelled(call);
      if (response.status === 403) throw new ToolError(FORBIDDEN_TEXT);
      // 响应头已到、读响应体时断线：服务端可能已受理，按暂时性故障交给调用方同键重放。
      return {
        transient: true,
        answered2xx: response.ok,
        message: error?.name === "TimeoutError" ? "读取响应超时" : "读取响应时连接中断",
      };
    }
    if (read.tooLarge) {
      if (response.status === 403) throw new ToolError(FORBIDDEN_TEXT);
      return {
        transient: true,
        tooLarge: true,
        answered2xx: response.ok,
        message: `服务端响应过大（超过 1 MiB），没有读取（HTTP ${response.status}）`,
      };
    }
    const envelope = parseEnvelope(read.text);
    const code = envelope ? parseCode(envelope.code) : NaN;
    // 403 先看响应体：信封 3101 表示当前范围没有 Coding Plan 订阅、3706 表示账号未绑定等，照实报错误码和 logid；
    // 不是信封时才笼统地说没有权限。
    if (response.status === 403) {
      if (Number.isFinite(code) && code !== 0) throw new ToolError(envelopeMessage(envelope));
      throw new ToolError(FORBIDDEN_TEXT);
    }
    if (response.status === 429) {
      return { transient: true, message: Number.isFinite(code) && code !== 0 ? envelopeMessage(envelope) : ERROR_CODE_TEXT[3002] };
    }
    if (!Number.isFinite(code) || (code === 0 && !response.ok)) {
      if (response.status >= 500) return { transient: true, message: `服务端错误 HTTP ${response.status}` };
      const problem = `服务端返回了无法识别的响应（HTTP ${response.status}）`;
      if (response.ok) throw new UnreadableSuccessError(problem);
      throw new ToolError(`${problem}。`);
    }
    if (code === 0) {
      const data = envelope.data;
      return { data: isPlainObject(data) ? data : {} };
    }
    const message = envelopeMessage(envelope);
    if (TRANSIENT_CODES.has(code)) return { transient: true, code, message };
    return { code, message };
  });
}

/**
 * inputSchema 写了 additionalProperties: false，这里照着执行：拼错或多传的参数在本地明确拒绝（不登录、不发请求），
 * 不悄悄丢掉后按默认值提交、扣费。宿主的 _meta 走 params._meta，不是参数。
 */
function toolArguments(args, tool) {
  if (args === undefined || args === null) return {};
  if (!isPlainObject(args)) throw new ToolError(`${tool.name} 的参数必须是对象。`);
  const properties = tool.inputSchema.properties;
  const unknown = Object.keys(args).filter((key) => !Object.hasOwn(properties, key));
  if (unknown.length) {
    const named = unknown.slice(0, 5).map((key) => cleanText(key, 40) || "?");
    throw new ToolError(
      `${tool.name} 不支持的参数：${named.join("、")}${unknown.length > 5 ? ` 等 ${unknown.length} 个` : ""}。` +
        `可用的参数：${Object.keys(properties).join("、")}。没有发出任何请求，也没有扣费；请检查拼写后重试。`,
    );
  }
  return args;
}

// ── 参数校验工具（纯本地，不发请求）──

/** false、空字符串、空数组都算没给：Agent 常把默认值原样带上，不应因此报「字段不适用」。 */
function present(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function stringArg(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolError(`${name} 必须是字符串。`);
  return value.trim() || undefined;
}

function boolArg(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new ToolError(`${name} 必须是 true 或 false。`);
  return value;
}

/** 枚举不区分大小写，统一成文档里的写法再提交。 */
function enumArg(value, name, allowed) {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value.trim() : undefined;
  if (text === "") return undefined;
  const found = text !== undefined && allowed.find((item) => item.toLowerCase() === text.toLowerCase());
  if (!found) throw new ToolError(`${name} 只能是 ${allowed.join(" / ")}，收到：${preview(value)}。`);
  return found;
}

/** task_id 不透明、可能很长：只要求非空且中间没有空白或控制字符（复制时被折行会查不到），绝不截断或改写。 */
function opaqueTaskId(value) {
  const taskId = stringArg(value, "task_id");
  if (taskId !== undefined && /[\s\p{Cc}]/u.test(taskId)) {
    throw new ToolError("task_id 中间不能有空白或换行：请把之前返回的 task_id 原样完整传入。");
  }
  return taskId;
}

/** task_id 的种类前缀（gen、preview、rig 等），只用作标签；绝不拿整个 task_id 拼路径。 */
function taskKind(taskId) {
  const match = /^([a-z]{1,16}):/.exec(taskId);
  return match ? match[1] : undefined;
}

// ── 地址 ──

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** https、有主机名、不带账号密码、原文里没有空白和控制字符；合格时返回规范形式，否则返回 null。 */
function httpsHref(value) {
  if (typeof value !== "string" || /[\s\p{Cc}]/u.test(value)) return null;
  const url = parseUrl(value);
  return url && url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
}

/** URL 路径的扩展名（小写、带点），路径里的 %xx 先解码。 */
function urlPathExtension(href) {
  const url = parseUrl(href);
  if (!url) return "";
  try {
    return extname(decodeURIComponent(url.pathname)).toLowerCase();
  } catch {
    return extname(url.pathname).toLowerCase();
  }
}

/** 带协议名的写法（协议名至少两个字符，Windows 盘符 C:\ 仍按本地路径处理）。 */
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** 模型地址：只收 https，按 URL 路径扩展名判断类型；本地路径给出明确提示（上传接口不收 3D 文件）。 */
function modelUrlArg(value, action, allowed) {
  const raw = stringArg(value, "model_url");
  if (raw === undefined) return undefined;
  if (!SCHEME.test(raw)) throw new ToolError(LOCAL_MODEL_TEXT);
  const href = httpsHref(raw);
  if (!href) throw new ToolError(`model_url 只支持 https 地址（不能带空白或账号密码）：${preview(raw)}`);
  if (!allowed.includes(urlPathExtension(href))) {
    throw new ToolError(`action=${action} 的 model_url 路径必须以 ${allowed.join(" / ")} 结尾：${preview(raw)}`);
  }
  return href;
}

// ── 参考图：https 原样透传，本地文件和 data: 先上传换成预签名 https 地址 ──

/** 校验一张参考图并在本地读好内容（不发请求）：返回 `{ href }`，或待上传的 `{ bytes, mime, name }`。 */
async function prepareImage(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError(`${label} 不能为空：需要 https 地址、工作区内的本地图片或 data:image/...;base64。`);
  }
  const item = value.trim();
  if (/^https:\/\//i.test(item)) {
    const href = httpsHref(item);
    if (!href) throw new ToolError(`${label} 不是有效的 https 地址（不能带空白或账号密码）：${preview(item)}`);
    if (MODEL_FILE_EXT.has(urlPathExtension(href))) throw new ToolError(`${label} 需要图片，不能是 3D 模型：${preview(item)}`);
    return { href };
  }
  if (/^data:/i.test(item)) return decodeDataUrl(item, label);
  // 其余带协议的写法（http://、ftp://、file: 等）都不收。
  if (SCHEME.test(item)) {
    throw new ToolError(`${label} 只支持 https 地址、工作区内的本地图片或 data:image/...;base64：${preview(item)}`);
  }
  const absolute = await resolveInWorkspace(item, label);
  const extension = extname(absolute).toLowerCase();
  if (MODEL_FILE_EXT.has(extension)) throw new ToolError(LOCAL_MODEL_TEXT);
  const mime = IMAGE_MIME[extension];
  if (!mime) throw new ToolError(`${label} 的本地图片只支持 png / jpg / jpeg / webp：${item}`);
  let bytes;
  try {
    // 先看大小再读：超限的文件不读进内存；管道、设备、目录只收普通文件。
    const info = await stat(absolute);
    if (!info.isFile()) throw new ToolError(`${label} 不是普通文件：${item}`);
    if (info.size > MAX_IMAGE_BYTES) throw new ToolError(`${label} 超过 ${MAX_IMAGE_MIB} MiB：${item}`);
    bytes = await readFile(absolute);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`读不到 ${label}：${item}`);
  }
  if (!bytes.length) throw new ToolError(`${label} 是空文件：${item}`);
  return { bytes, mime, name: basename(absolute) };
}

/** data:image/...;base64 → 校验并解码。头部用字符串切（参数值可带引号，里面允许逗号），base64 先按结构校验。 */
function decodeDataUrl(value, label) {
  // 整串长度只做内存上限：给到 base64 长度的 3 倍（容忍每个字符后带空白的写法）。
  if (value.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) * 3 + 4096) throw new ToolError(`${label} 的 data: 数据过长（超过 ${MAX_IMAGE_MIB} MiB）。`);
  let comma = -1;
  for (let i = 5, quoted = false; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 92 /* \ */ && quoted) i++;
    else if (c === 34 /* " */) quoted = !quoted;
    else if (c === 44 /* , */ && !quoted) {
      comma = i;
      break;
    }
  }
  if (comma < 0) throw new ToolError(`${label} 的 data: 格式不对：找不到头部和数据之间的逗号。`);
  const header = value.slice(5, comma);
  if (!header.trimEnd().toLowerCase().endsWith(";base64")) {
    throw new ToolError(`${label} 的 data: 必须是 base64 编码（data:image/png;base64,...）。`);
  }
  const mime = header.slice(0, header.indexOf(";")).trim().toLowerCase().replace(/^image\/jpg$/, "image/jpeg");
  if (!DATA_IMAGE_EXT[mime]) throw new ToolError(`${label} 的 data: 仅支持 png / jpeg / webp。`);
  // Buffer.from 会静默丢掉非法字符，所以先按 base64 结构校验（线性扫描，不用回溯正则）。
  const encoded = value.slice(comma + 1).replace(/[ \t\r\n\f]+/g, "");
  let end = encoded.length;
  while (end > 0 && encoded.charCodeAt(end - 1) === 61 /* = */) end--;
  const data = encoded.slice(0, end);
  const padding = encoded.length - end;
  const wellFormed =
    /^[A-Za-z0-9+/]*$/.test(data) && data.length % 4 !== 1 && (padding === 0 || (padding <= 2 && encoded.length % 4 === 0));
  if (!wellFormed) throw new ToolError(`${label} 的 data: 不是有效的 base64。`);
  if (Math.floor((encoded.length * 3) / 4) - padding > MAX_IMAGE_BYTES) throw new ToolError(`${label} 超过 ${MAX_IMAGE_MIB} MiB。`);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw new ToolError(`${label} 的 data: 内容为空。`);
  return { bytes, mime, name: `reference${DATA_IMAGE_EXT[mime]}` };
}

/** 上传接口没有幂等键：暂时性故障只重试一次（最多多留一个临时对象，不扣费）。 */
async function uploadImage(call, { bytes, mime, name }, label) {
  let result;
  for (let attempt = 1; ; attempt += 1) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    try {
      result = await apiRequest(call, UPLOAD_PATH, { body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
    } catch (error) {
      throw error instanceof ToolError ? new ToolError(`${label} 上传失败，没有提交任务：${error.message}`) : error;
    }
    if (result.data) break;
    if (!result.transient || result.tooLarge || attempt >= 2 || withinBudget(call, Infinity) <= RETRY_DELAY_MS + MIN_REQUEST_MS) {
      throw new ToolError(`${label} 上传失败，没有提交任务：${result.message}`);
    }
    await pause(call, RETRY_DELAY_MS);
  }
  const href = httpsHref(result.data.url);
  if (!href) throw new ToolError(`${label} 上传后没有返回有效的 https 地址，没有提交任务。`);
  return href;
}

function resolveImage(call, prepared, label) {
  return prepared.href ? Promise.resolve(prepared.href) : uploadImage(call, prepared, label);
}

// ── 提交与等待 ──

/**
 * 提交任务。超时、断线、2xx 但响应体无法解析、2007、UNKNOWN、CALLING、code 0 却没有 task_id，
 * 都用同一个 Idempotency-Key 重放：成功过的提交会返回 replayed=true 和 upstream_req_id（即 task_id），
 * 不会重复建任务。一旦出现过结果不明的尝试（或本身就是 request_id 重放），任务可能已经建好：之后无论以
 * 什么错误结束，都把这个键作为 request_id 交回给 Agent，并保留请求体（连同首次参数的指纹 fingerprint），
 * 下次原样带回继续重放。唯一的例外是从没被服务端受理过的键收到 DEFINITE_REJECTION_CODES 的明确拒绝：这个键
 * 没有建出任务，删记录、报提交失败。受理过（accepted）的键，本次调用里的和之前调用里记下的都算，被拒绝时照旧交回。
 * prior 是按 request_id 重放时读到的记录：沿用它的 createdAt（不续期）和 accepted。
 * 宿主取消时立刻停止（Cancelled），不再重试；已确认的提交绝不会再提交一次。
 */
async function submitTask(call, body, requestId, fingerprint, prior) {
  const key = requestId || randomUUID();
  const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
  let uncertain = Boolean(requestId);
  let accepted = prior?.accepted === true;
  let lastIssue = "提交结果未确认";
  const unconfirmed = async (issue) => {
    const saved = await savePending(key, body, fingerprint, { createdAt: prior?.createdAt, accepted });
    const warning = {
      saved: "",
      failed: "本地没能保存这次的请求记录（插件数据目录不可写）",
      expired: "这次的请求记录已超过 24 小时有效期，已经删除",
    }[saved];
    return new ToolError(
      `${BRAND} 任务提交未确认（${issue}）。任务可能已经创建，为避免重复扣费，请稍后再调用 ${SUBMIT_TOOL}，` +
        `参数保持不变并带上 request_id：${key}` +
        (warning
          ? `\n注意：${warning}，带 request_id 重放会被拒绝。请把情况告诉用户，由用户决定是否重新提交（可能重复扣费）。`
          : ""),
    );
  };
  for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      if (withinBudget(call, Infinity) <= RETRY_DELAY_MS + MIN_REQUEST_MS) break;
      await pause(call, RETRY_DELAY_MS);
    }
    let result;
    try {
      result = await apiRequest(call, SUBMIT_PATH, { headers, body: JSON.stringify(body), timeoutMs: SUBMIT_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      if (error instanceof UnreadableSuccessError) {
        uncertain = true;
        accepted = true;
        lastIssue = error.message;
        continue;
      }
      if (uncertain) throw await unconfirmed(error instanceof ToolError ? error.message : String(error?.message ?? error));
      throw error;
    }
    if (result.transient) {
      uncertain = true;
      // 2xx 但响应体读不完或过大：服务端已经受理；3702 说明服务端正在处理这个键：都算受理过。
      if (result.answered2xx || result.code === 3702) accepted = true;
      lastIssue = result.message;
      continue;
    }
    if (!result.data) {
      const failure = `提交失败：${result.message}${rejectionHint(body, result.code)}`;
      const definite = DEFINITE_REJECTION_CODES.has(result.code);
      if (uncertain && definite && !accepted) {
        // 结果不明之后（或按 request_id 重放时）被明确拒绝，而这个键从没被受理过：没有建出任务，记录作废，绝不再提示重放。
        await dropPending(key);
        throw new ToolError(
          `${failure}\n服务端明确拒绝了这次提交：request_id ${key} 没有创建任务，不要再用这个 request_id 重放。` +
            "如有需要请调整输入，然后不带 request_id 重新提交；如果是前一步任务尚未完成（3703），" +
            `先用 ${RESULT_TOOL} 等前一步完成，再不带 request_id 重新提交。`,
        );
      }
      if (uncertain) {
        throw await unconfirmed(definite ? `${result.message}；服务端之前已受理过这次提交，这次拒绝不能说明任务没有创建` : result.message);
      }
      // 首次提交就被明确拒绝（3001 / 3703 等）：没有创建任务，不扣费，不重试。
      throw new ToolError(failure);
    }
    const { state, output, invocation_id: invocationId } = result.data;
    // task_id 依次取 output.task_id、顶层 task_id（宽容处理）、重放时的 upstream_req_id。
    const taskId = [output && typeof output === "object" ? output.task_id : undefined, result.data.task_id, result.data.upstream_req_id].find(
      (value) => typeof value === "string" && value,
    );
    if (state === "SUCCEEDED" && taskId) {
      await dropPending(key);
      const invocation = typeof invocationId === "string" || typeof invocationId === "number" ? String(invocationId) : undefined;
      return { taskId, invocationId: invocation };
    }
    // code 0 说明 ToolHub 已受理：UNKNOWN / CALLING，或者成功却没给 task_id、state 不认识，任务都可能已经建好，
    // 一律同键重放（重放会返回 upstream_req_id），绝不换新键；用完重试次数就把 request_id 交回。
    uncertain = true;
    accepted = true;
    lastIssue =
      state === "CALLING"
        ? "上一次提交仍在处理"
        : state === "UNKNOWN"
          ? "上游未确认提交结果"
          : `提交已受理但没有返回 task_id（state=${cleanText(String(state ?? "未知"), 40)}）`;
  }
  throw await unconfirmed(lastIssue);
}

function queryTask(call, taskId) {
  return apiRequest(call, QUERY_PATH, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_id: taskId }),
    timeoutMs: QUERY_TIMEOUT_MS,
  });
}

/**
 * 轮询到终态或用完本次调用的等待时间；暂时性故障只退避，不重新提交。只看顶层 status：
 * succeeded 且产物齐了 → 完成；succeeded 但 completedProducts 还拿不到产物 → 继续等；failed → 终态；
 * 其余（queued / running / 其它词）继续等。等待时间用完时返回仍在进行，由调用方交回 task_id；最后一次查询是
 * 「已成功但还没有产物」时状态为 SUCCEEDED_PENDING_PRODUCTS，告诉 Agent 任务已成功、已计费，不要无限查下去。
 */
const SUCCEEDED_PENDING_PRODUCTS = "succeeded_pending_products";

async function waitForTask(call, taskId) {
  const deadline = call.startedAt + WAIT_BUDGET_MS;
  for (;;) {
    const result = await queryTask(call, taskId);
    if (result.tooLarge) throw new ToolError(`查询 ${BRAND} 任务失败：${result.message}。`);
    if (!result.transient && result.code === 3704) {
      throw new TaskEndedError(`查询 ${BRAND} 任务失败：${result.message}\ntask_id：${taskId}`);
    }
    if (!result.transient && result.code !== undefined) throw new ToolError(`查询 ${BRAND} 任务失败：${result.message}`);
    let status = "unknown";
    let note;
    if (result.data) {
      status = cleanText(result.data.status, 40).toLowerCase() || "unknown";
      if (status === "succeeded") {
        const products = completedProducts(result.data);
        if (products) return { done: true, ...products };
        status = SUCCEEDED_PENDING_PRODUCTS;
        note = "已完成，产物还在准备";
      } else if (status === "failed") {
        const failure = result.data.failure && typeof result.data.failure === "object" ? result.data.failure : {};
        const reason = [cleanText(failure.code, 100), cleanText(failure.message, 300)].filter(Boolean).join("：") || "未知原因";
        throw new TaskEndedError(`${BRAND} 任务失败（${reason}），未扣费，可调整后重新提交。\ntask_id：${taskId}`);
      }
    }
    const upstream = cleanText(result.data?.upstream_status, 40);
    sendProgress(
      call,
      result.transient
        ? `查询暂时失败，继续等待：${result.message}`
        : `${BRAND} 任务进行中（${note ?? status}${upstream ? `，${upstream}` : ""}）`,
    );
    if (Date.now() + POLL_INTERVAL_MS > deadline) return { done: false, status };
    await pause(call, POLL_INTERVAL_MS);
  }
}

// ── 产物下载 ──

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 目录名里的描述：取文字里的字母数字，最多 24 个字符（按码点），没有时用 model。 */
function slugOf(text) {
  const slug = (typeof text === "string" ? text : "").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return [...slug].slice(0, 24).join("").replace(/-+$/, "") || "model";
}

/** 默认目录的父目录 <工作区>/generated-3d：按真实路径检查（可能是指向工作区外的符号链接），create 时建好再复查。 */
async function defaultParent(create) {
  const requested = join(projectDir(), "generated-3d");
  const checked = await resolveInWorkspace(requested, "generated-3d");
  if (!create) return checked;
  await mkdir(checked, { recursive: true });
  return resolveInWorkspace(requested, "generated-3d");
}

/**
 * 默认目录：<工作区>/generated-3d/<时间>-<action 或任务种类>-<描述>，已存在时追加 -1、-2。名字绝不取自 task_id。
 * 用不带 recursive 的 mkdir 原子地占下目录：同一进程并行的调用即使在同一秒完成，也各自拿到不同的目录。
 */
async function claimDefaultOutputDir(label, slugSource) {
  const parent = await defaultParent(true);
  const kind = String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "task";
  const base = join(parent, `${timestamp()}-${kind}-${slugOf(slugSource)}`);
  for (let index = 0; index < 1000; index += 1) {
    const candidate = index ? `${base}-${index}` : base;
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new ToolError("同名目录过多");
}

/**
 * 产物的保存位置。默认目录在第一次真正要写文件时才占用；一个文件都没存下时 release() 删掉这个空目录。
 * 用户给的 output_dir 原样使用，不删。
 */
function outputTarget(outputDir, label, slugSource) {
  let claimed;
  let used = outputDir;
  return {
    /** 下载前的检查，不建目录：目录不可用时直接报原因，不白下载。 */
    check: () => (outputDir ? Promise.resolve() : defaultParent(false).then(() => undefined)),
    async dir() {
      if (outputDir) return outputDir;
      claimed ??= claimDefaultOutputDir(label, slugSource);
      return (used = await claimed);
    },
    get used() {
      return used;
    },
    async release() {
      const dir = claimed && (await claimed.catch(() => undefined));
      // rmdir 只删空目录：存下过文件时什么也不做。
      if (dir && (await rmdir(dir).then(() => true, () => false))) used = undefined;
    },
  };
}

/** 链接路径的最后一段（%xx 解码后）；拿不到时返回空字符串。 */
function urlFileName(url) {
  const parsed = parseUrl(url);
  if (!parsed) return "";
  const last = parsed.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// 产物文件名最多占的 UTF-8 字节数：常见文件系统的上限是 255 字节，这里留出重名时加的 -1 … -999 和余量。
const MAX_FILE_NAME_BYTES = 200;
// Windows 的保留设备名，不分大小写，带不带扩展名都算（CON、NUL.png、com1.tar.gz）；COM / LPT 也包括 0 和上标 ¹²³。
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;

/** 去掉开头和结尾的点和空格（Windows 会悄悄去掉结尾的点和空格；只由点组成的 . 和 .. 因此变成空）。 */
function trimFileName(name) {
  return name.replace(/^[. ]+|[. ]+$/g, "");
}

/**
 * 产物文件名：在 macOS、Linux、Windows 上都安全时逐字节保留上游原名（空格、括号、各种文字都保留，OBJ → MTL → 贴图的
 * 引用才不会断），只改真正不安全的部分：路径分隔符 / \、: * ? " < > | 和控制字符换成 _；去掉开头和结尾的点和空格；
 * Windows 保留设备名前加 _；超过 MAX_FILE_NAME_BYTES 时按码点截断、保留扩展名。为空时用 fallback。
 * 改过的名字由 completedResult 在结果里列出。
 */
export function sanitizeFileName(raw, fallback) {
  let name = trimFileName(String(raw ?? "").replace(/[/\\:*?"<>|\p{Cc}]/gu, "_"));
  if (Buffer.byteLength(name) > MAX_FILE_NAME_BYTES) {
    const extension = extname(name);
    const kept = Buffer.byteLength(extension) <= 16 ? extension : "";
    let stem = "";
    for (const char of name.slice(0, name.length - kept.length)) {
      if (Buffer.byteLength(stem + char + kept) > MAX_FILE_NAME_BYTES) break;
      stem += char;
    }
    name = trimFileName(`${trimFileName(stem)}${kept}`);
  }
  if (WINDOWS_RESERVED_NAME.test(name)) name = `_${name}`;
  return name || fallback;
}

/** API origin（ZCODE_BASE_URL）本身是本机回环地址：开发自测模式。只有这时才允许下载本机回环的产物链接。 */
function loopbackOrigin(apiOrigin) {
  const parsed = typeof apiOrigin === "string" ? parseUrl(apiOrigin) : null;
  return Boolean(parsed) && isLoopback(parsed.hostname);
}

/**
 * 判断产物链接时用的 API origin，通常就是本次调用的 origin。测试钩子 <前缀>TEST_API_ORIGIN 只能换成非回环的
 * origin（回环值会被忽略），也就是只能把规则收紧成生产规则，不能放宽。
 */
function downloadOrigin(call) {
  const override = process.env[`${ENV_PREFIX}TEST_API_ORIGIN`];
  return override && !loopbackOrigin(override) ? override : call.origin;
}

/**
 * 产物链接能不能下载。第一个链接和之后的每一跳重定向都先过这一条：不能带账号密码；API origin 是本机回环（开发自测）时，
 * 接受 https 和本机回环的 http；否则只接受 https，且主机不能是 localhost 或本机、内网、链路本地等地址（privateHost）。
 * 不合格的链接不下载，只作为链接列出。不传 apiOrigin 时按非回环（生产）规则判断。
 */
export function downloadableUrl(url, apiOrigin) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.username || parsed.password) return false;
  if (loopbackOrigin(apiOrigin)) return parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback(parsed.hostname));
  return parsed.protocol === "https:" && !privateHost(parsed.hostname);
}

/** IPv4 的本机、内网、链路本地、CGNAT、基准测试、组播和保留地址。 */
function privateIPv4([a, b]) {
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** IPv6 文本（不带方括号）→ 8 个 16 位组；末尾可以是点分 IPv4。不是合法 IPv6 时返回 undefined。 */
function ipv6Groups(host) {
  let text = host;
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((n) => n > 255)) return undefined;
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const split = (part) => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return undefined;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups.map((group) => parseInt(group, 16)) : undefined;
}

/** 主机名的比较形式：小写，去掉 IPv6 的方括号和结尾的点。 */
function bareHost(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/**
 * 主机是 localhost，或本机、内网、链路本地、CGNAT 等不该从公网链接跳进去的 IP 字面量。主机名应来自 URL 解析结果：
 * 解析器已经把 2130706433、0x7f.1、0177.0.0.1 这类写法规范成点分十进制，把 [::ffff:127.0.0.1] 规范成 [::ffff:7f00:1]。
 * 只看字面量；域名解析出的地址由 dnsRefusal 用同一套规则检查。
 */
function privateHost(hostname) {
  const host = bareHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return privateIPv4(host.split(".").map(Number));
  if (!host.includes(":")) return false;
  const groups = ipv6Groups(host);
  // 认不出的 IPv6 字面量宁可当作内网。
  if (!groups) return true;
  const zeros = (from, to) => groups.slice(from, to).every((group) => group === 0);
  const embedded = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255];
  // 内嵌 IPv4 的写法按里面的 IPv4 判断：::ffff:0:0/96（IPv4 映射）、::/96（IPv4 兼容，:: 和 ::1 也落在这里，
  // 内嵌的是 0.0.0.0 / 0.0.0.1）、64:ff9b::/96（NAT64）。
  if (zeros(0, 5) && (groups[5] === 0xffff || groups[5] === 0)) return privateIPv4(embedded);
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6)) return privateIPv4(embedded);
  // fc00::/7 唯一本地、fe80::/10 链路本地、fec0::/10 站点本地（已废弃）、ff00::/8 组播。
  const first = groups[0];
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00;
}

/**
 * 产物下载的下一跳能不能跟：两端都先按同一个 API origin 过 downloadableUrl。非回环（生产）模式下两端因此都是
 * https，且都不在本机或内网。回环（开发自测）模式下：从本机回环 http 链接出发的一跳不再限制；从 https 链接出发只能
 * 跳到 https，且不能跳进本机或内网地址（例如 127.0.0.1 上的 http 服务、10.x 上的 https 地址、[::ffff:7f00:1]），
 * 同源跳转不会到达新的地方，照常跟随。不传 apiOrigin 时按非回环（生产）规则判断。
 */
export function redirectAllowed(from, to, apiOrigin) {
  if (!downloadableUrl(to, apiOrigin) || !downloadableUrl(from, apiOrigin)) return false;
  const origin = parseUrl(from);
  const next = parseUrl(to);
  if (origin.protocol === "http:") return true;
  return next.protocol === "https:" && (next.origin === origin.origin || !privateHost(next.hostname));
}

/**
 * 测试钩子 <前缀>TEST_DNS：JSON 对象，主机名 → 地址（或地址列表）。dnsRefusal 把它和真实解析结果合在一起判断，
 * 所以它只能让结果更严格：映射到内网地址会拒绝下载，映射到公网地址却不能让解析失败或解析到内网的主机通过。
 */
function testDnsAddresses(host) {
  let map;
  try {
    map = JSON.parse(process.env[`${ENV_PREFIX}TEST_DNS`] ?? "");
  } catch {
    return [];
  }
  if (!isPlainObject(map)) return [];
  return Object.entries(map)
    .filter(([name]) => bareHost(name) === host)
    .flatMap(([, addresses]) => [addresses].flat().map(String));
}

/**
 * 代理软件 fake-ip 模式的占位地址：Clash / mihomo / Surge 等开着 TUN 或增强模式时，给每个域名都回这段里的地址，
 * 连接由代理接管、再按真实域名去连。IPv4 是 198.18.0.0/15（mihomo、Surge 的默认段都在里面），IPv6 是 mihomo 默认的
 * fdfe:dcba:9876::/64。只对域名解析结果放行；链接里直接写这些地址仍按 privateHost 拒绝。
 */
function fakeIpAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 198 && (b === 18 || b === 19);
  }
  if (version !== 6) return false;
  const groups = ipv6Groups(bareHost(address));
  return Boolean(groups) && groups[0] === 0xfdfe && groups[1] === 0xdcba && groups[2] === 0x9876 && groups[3] === 0;
}

/** 解析出的地址不能连：落在 privateHost 的范围里（fake-ip 占位地址除外），或者根本不是 IP 地址（宁可当作内网）。 */
function unsafeAddress(address) {
  return !isIP(address) || (privateHost(address) && !fakeIpAddress(address));
}

/** 等 promise，signal 中止（超时或宿主取消）时立刻以中止原因失败；dns 解析本身取消不了，结果晚到也不再用。 */
function untilAborted(signal, promise) {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/**
 * 非回环（生产）模式下，连接第一个产物链接和每一跳重定向之前，先解析链接的主机名：任何一个地址落在 privateHost 的范围里
 * （本机、内网、链路本地、CGNAT 等），或者解析失败，都返回不下载的原因（subject 是「链接」或「跳转目标」）；可以下载时
 * 返回 undefined。代理 fake-ip 的占位地址（fakeIpAddress）不算内网：用这类代理的机器上每个域名都解析到那里，拒绝它
 * 等于不再下载任何产物；这时真实地址由代理在连接时决定，这里看不到，和下面的重绑定窗口同属剩余风险。
 * IP 字面量已由 downloadableUrl / redirectAllowed 检查，不再解析；回环（开发自测）模式不解析。
 * 解析受 signal 约束（单个下载的超时、整次调用的预算和宿主取消），中止时抛出。
 * 剩余风险（DNS 重绑定）：这里的解析和 fetch 连接时的解析是两次独立的查询，域名的权威服务器可以先回公网地址、
 * 连接时再回内网地址。彻底堵住要让连接直接用检查过的地址（带自定义 lookup 的 agent），零依赖的全局 fetch 做不到；
 * 即便如此，下载到的内容也只写进工作区文件，不会回传给模型。
 */
async function dnsRefusal(href, apiOrigin, signal, subject) {
  if (loopbackOrigin(apiOrigin)) return undefined;
  const host = bareHost(parseUrl(href).hostname);
  if (isIP(host)) return undefined;
  const privateText = `${subject}的域名解析到本机或内网地址，未下载`;
  if (testDnsAddresses(host).some(unsafeAddress)) return privateText;
  let addresses;
  try {
    addresses = await untilAborted(signal, dns.promises.lookup(host, { all: true, verbatim: true }));
  } catch (error) {
    if (signal.aborted) throw error;
    addresses = [];
  }
  if (!addresses.length) return `${subject}的域名无法解析，未下载`;
  return addresses.some(({ address }) => unsafeAddress(address)) ? privateText : undefined;
}

function tooLargeText() {
  const limit = MAX_DOWNLOAD_BYTES >= 1024 * 1024 ? `${Math.round(MAX_DOWNLOAD_BYTES / 1024 / 1024)} MiB` : `${MAX_DOWNLOAD_BYTES} 字节`;
  return `文件超过下载上限（单个文件上限 ${limit}），未下载`;
}

/** 路径检查之后才建目录；边下边写，写文件用 wx，同名时加 -1、-2，绝不覆盖。超过上限时删掉半截文件。 */
async function writeProduct(target, name, response) {
  const safeDir = await resolveInWorkspace(await target.dir(), "保存目录", { allowRoot: true });
  await mkdir(safeDir, { recursive: true });
  // 建完再按真实路径复查一次，防止中途被换成指向工作区外的符号链接。
  const realDir = await resolveInWorkspace(safeDir, "保存目录", { allowRoot: true });
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length) || "file";
  for (let index = 0; index < 1000; index += 1) {
    const path = join(realDir, index ? `${stem}-${index}${extension}` : name);
    let handle;
    try {
      handle = await open(path, "wx", 0o644);
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    try {
      let total = 0;
      for await (const chunk of response.body ?? []) {
        total += chunk.length;
        if (total > MAX_DOWNLOAD_BYTES) throw new ToolError(tooLargeText());
        await handle.write(chunk);
      }
      await handle.close();
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(path, { force: true }).catch(() => {});
      throw error;
    }
    return path;
  }
  throw new ToolError("同名文件过多");
}

/**
 * 下载一个产物。产物在第三方 CDN 上：绝不带任何身份头；第一个链接按 downloadableUrl 校验，重定向手动跟随，
 * 每一跳都按 redirectAllowed 校验（两者用同一个 API origin），最多 MAX_DOWNLOAD_REDIRECTS 跳；非回环模式下，
 * 连接第一个链接和每一跳之前还按 dnsRefusal 检查域名解析出的地址。失败（含跳到不允许的位置、跳转过多、域名解析到
 * 内网或解析失败）只返回原因（warning，HTTP 失败时附 status），不保存文件、不让整次调用失败，结果里照样列出原链接。
 * 宿主取消时抛 Cancelled。
 */
async function downloadProduct(call, url, target, name) {
  const apiOrigin = downloadOrigin(call);
  if (!downloadableUrl(url, apiOrigin)) return { path: null, warning: "链接不是 https，或指向本机、内网地址，未下载" };
  if (call.startedAt + CALL_BUDGET_MS - Date.now() <= MIN_DOWNLOAD_MS) return { path: null, warning: "本次调用时间不够，未下载" };
  try {
    await target.check();
  } catch (error) {
    return { path: null, warning: `保存失败（${error instanceof ToolError ? error.message : "保存目录不可用"}）` };
  }
  stopIfCancelled(call);
  return withRequestSignal(call, DOWNLOAD_TIMEOUT_MS, async (signal) => {
    let response;
    try {
      let current = url;
      const refusal = await dnsRefusal(current, apiOrigin, signal, "链接");
      if (refusal) return { path: null, warning: refusal };
      for (let hop = 0; ; hop += 1) {
        response = await fetch(current, { redirect: "manual", signal });
        if (response.status < 300 || response.status >= 400) break;
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (!location) return { path: null, warning: `下载失败（HTTP ${response.status}）`, status: response.status };
        const next = parseUrl(new URL(location, current).href);
        if (!next || !redirectAllowed(current, next.href, apiOrigin)) return { path: null, warning: "跳转到了不允许的位置，未下载" };
        if (hop >= MAX_DOWNLOAD_REDIRECTS) return { path: null, warning: "跳转次数过多，未下载" };
        const hopRefusal = await dnsRefusal(next.href, apiOrigin, signal, "跳转目标");
        if (hopRefusal) return { path: null, warning: hopRefusal };
        current = next.href;
      }
    } catch (error) {
      stopIfCancelled(call);
      // Location 无法解析也算跳到了不允许的位置。
      if (error instanceof TypeError && error.code === "ERR_INVALID_URL") return { path: null, warning: "跳转到了不允许的位置，未下载" };
      return { path: null, warning: "下载失败（网络错误或超时）" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { path: null, warning: `下载失败（HTTP ${response.status}）`, status: response.status };
    }
    if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel().catch(() => {});
      return { path: null, warning: tooLargeText() };
    }
    try {
      return { path: await writeProduct(target, name, response) };
    } catch (error) {
      // 目录检查失败时响应体还没读，主动取消，不占着连接。
      await response.body?.cancel().catch(() => {});
      stopIfCancelled(call);
      if (error instanceof ToolError) return { path: null, warning: error.message === tooLargeText() ? error.message : `保存失败（${error.message}）` };
      return { path: null, warning: error?.name === "TimeoutError" ? "下载超时" : "保存失败" };
    }
  });
}

/**
 * 依次下载产物（`{ key, label, url, name, source_name? }`：name 是清洗后要保存的名字，source_name 是上游原名，
 * 用来在结果里列出改过名的文件），单次最多 MAX_DOWNLOAD_FILES 个；超出的只给链接。
 */
async function saveProducts(call, items, target) {
  const files = [];
  const total = Math.min(items.length, MAX_DOWNLOAD_FILES);
  for (const [index, item] of items.entries()) {
    if (index >= MAX_DOWNLOAD_FILES) {
      files.push({ ...item, path: null, warning: `单次最多下载 ${MAX_DOWNLOAD_FILES} 个文件，未下载` });
      continue;
    }
    sendProgress(call, `正在下载产物 ${index + 1}/${total}：${item.name}`);
    files.push({ ...item, ...(await downloadProduct(call, item.url, target, item.name)) });
  }
  return files;
}

// ── 结果 ──

const STILL_RUNNING_TEXT = `请稍后调用 ${RESULT_TOOL} 继续等待（task_id 原样传入），不要重新调用 ${SUBMIT_TOOL}（会产生新任务、重复扣费）。`;

const RENAME_TEXT = "OBJ / MTL 等文件里按原名引用这些文件的地方（mtllib、map_Kd 等）可能需要手动修正。";

/**
 * 保存时改了名的文件：原名（产物条目的 source_name，没有时为 name）在某个系统上不安全被清洗过，或者和已有文件重名
 * 加了 -1、-2。没有改名时为空。
 */
function renamedFiles(saved) {
  return saved
    .map((f) => ({ key: f.key, from: f.source_name ?? f.name, to: basename(f.path) }))
    .filter(({ from, to }) => from !== to);
}

/** 统一的完成结果：已保存（及改名提示）→ 未能保存（附原因和链接）→ 其他链接 → 链接有效期 → task_id / invocation_id → 下一步。 */
function completedResult(taskId, base, { files, remaining = [], links, invocationId, extra = {} }) {
  const saved = files.filter((f) => f.path);
  const missed = files.filter((f) => !f.path);
  const renamed = renamedFiles(saved);
  const lines = [`${BRAND} 任务已完成${base.action ? `（${base.action}）` : ""}。`];
  if (saved.length) lines.push("已保存：", ...saved.map((f) => `- ${f.label}：${f.path}`));
  if (renamed.length) {
    lines.push(
      "以下文件保存时改了名（原名在 macOS / Linux / Windows 上不安全，或与已有文件重名）：",
      ...renamed.map(({ from, to }) => `- ${JSON.stringify(preview(from))} → ${JSON.stringify(to)}`),
      RENAME_TEXT,
    );
  }
  if (missed.length) lines.push("以下产物未能保存，可直接用链接下载：", ...missed.map((f) => `- ${f.label}（${f.warning}）：${f.url}`));
  if (remaining.length) lines.push("其他产物链接：", ...remaining.map((l) => `- ${l.label}：${l.url}`));
  lines.push(LINK_TTL_TEXT, `task_id：${taskId}`);
  if (invocationId) lines.push(`invocation_id：${invocationId}`);
  const hint = nextStepHint(taskId);
  if (hint) lines.push(hint);
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      status: "succeeded",
      ...base,
      invocation_id: invocationId ?? null,
      output_dir: null,
      files: files.map(({ path, url, name, key }) => ({ path: path ?? null, url, name, key })),
      links,
      ...(renamed.length ? { renamed_files: renamed, rename_warning: RENAME_TEXT } : {}),
      ...extra,
    },
  };
}

/**
 * 等待并交付产物。任务已经提交成功：除非它已到终态，否则报错里必须带上 task_id，问题恢复后才能接回、不必重新提交。
 * 每个插件只提供 deliverProducts（挑哪些产物、怎么命名）。
 */
async function finish(call, taskId, options) {
  const { action, outputDir, slugSource } = options;
  const kind = taskKind(taskId) ?? null;
  const base = { task_id: taskId, action: action ?? null, kind };
  let outcome;
  try {
    outcome = await waitForTask(call, taskId);
  } catch (error) {
    if (error instanceof TaskEndedError || error instanceof Cancelled) throw error;
    const reason = error instanceof ToolError ? error.message : `查询 ${BRAND} 任务出错：${error?.message ?? error}`;
    throw new ToolError(
      `${reason}\n${BRAND} 任务已提交，task_id：${taskId}\n` +
        `问题解决后请用 ${RESULT_TOOL} 继续查询，不要重新调用 ${SUBMIT_TOOL}（会产生新任务、重复扣费）。`,
    );
  }
  if (!outcome.done) {
    // 已成功（查询看到 succeeded 时就已按成功计费）却迟迟没有产物：如实说明，并给 Agent 一个停下来的条件。
    const text =
      outcome.status === SUCCEEDED_PENDING_PRODUCTS
        ? `${BRAND} 任务已成功（已按成功计费），但服务端还没有给出产物链接，task_id：${taskId}\n${STILL_RUNNING_TEXT}` +
          `如果再查询一次仍是这样，请停止查询，把 task_id 告诉用户，由用户决定怎么处理。`
        : `${BRAND} 任务还在进行（${outcome.status}），task_id：${taskId}\n${STILL_RUNNING_TEXT}${STILL_RUNNING_EXTRA}`;
    return {
      content: [{ type: "text", text }],
      structuredContent: { status: outcome.status, ...base, files: [], links: {} },
    };
  }
  const target = outputTarget(outputDir, action ?? kind, slugSource);
  let result;
  try {
    result = await deliverProducts(call, taskId, outcome, target, base, options);
  } finally {
    await target.release();
  }
  result.structuredContent.output_dir = target.used ?? null;
  return result;
}

/**
 * request_id 重放只会提交首次的内容：把本次调用的业务参数（不含 request_id、output_dir）逐字段和首次的指纹比较，
 * 改过、新加或去掉的字段都列出来，告诉 Agent 没有生效。
 */
function replayNote(pending, args) {
  const before = pending.args ?? {};
  const now = argsFingerprint(args);
  const order = Object.keys(SUBMIT.inputSchema.properties);
  const rank = (field) => (order.includes(field) ? order.indexOf(field) : order.length);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(now)])]
    .filter((field) => before[field] !== now[field])
    .sort((a, b) => rank(a) - rank(b));
  if (!changed.length) return "";
  const original = ["action", ...changed.filter((field) => field !== "action")]
    .filter((field) => pending.body[field] !== undefined)
    .map((field) => `${field}=${preview(pending.body[field])}`)
    .join("，");
  return (
    `注意：按 request_id 重放的是首次提交的内容${original ? `（${original}）` : ""}，` +
    `本次修改的 ${changed.map((field) => cleanText(field, 40) || "?").join("、")} 没有生效。`
  );
}

// ── 工具入口 ──

async function submitTaskTool(args, meta, signal) {
  // 未知参数最先拒绝：不需要登录身份，也不发任何请求。
  args = toolArguments(args, SUBMIT);
  const requestId = stringArg(args.request_id, "request_id") ?? "";
  // 先做纯本地的检查（含读取本地参考图）：参数不合法时不需要登录身份、也不发任何请求。
  const plan = requestId ? undefined : await validateSubmit(args);
  const call = newCall(meta, signal);
  const outputDir = await resolveOutputDir(args.output_dir);
  const pending = requestId ? await loadPending(requestId) : undefined;
  // 没有首次的请求体就重放不了：重建可能换参考图地址，服务端只会一直回 3702。
  if (requestId && !pending) {
    throw new ToolError(
      "找不到 request_id 对应的提交记录（可能已过期或已清理），无法确认原任务是否已创建。" +
        "请告诉用户这个情况，由用户决定是否重新提交（可能重复扣费）。",
    );
  }
  const body = pending ? pending.body : await buildSubmitBody(call, plan);
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) throw new ToolError("请求体超过 4 MiB：请缩短描述，或改用 https 地址。");
  const note = pending ? replayNote(pending, args) : "";
  try {
    // 重放时沿用首次的参数指纹，下次重放仍和首次比较。
    const { taskId, invocationId } = await submitTask(call, body, requestId, pending ? pending.args : argsFingerprint(args), pending);
    sendProgress(call, `${BRAND} 任务已提交，task_id：${taskId}，等待完成`);
    const result = await finish(call, taskId, {
      action: typeof body.action === "string" ? body.action : undefined,
      outputDir,
      invocationId,
      slugSource: body.prompt,
      ...submitFinishOptions(args, body, plan),
    });
    if (note) result.content[0].text = `${note}\n${result.content[0].text}`;
    return result;
  } catch (error) {
    if (note && error instanceof ToolError) {
      const Kind = error instanceof TaskEndedError ? TaskEndedError : ToolError;
      throw new Kind(`${note}\n${error.message}`);
    }
    throw error;
  }
}

async function getTaskTool(args, meta, signal) {
  args = toolArguments(args, RESULT);
  const taskId = opaqueTaskId(args.task_id);
  if (!taskId) throw new ToolError("task_id 不能为空。");
  const options = resultFinishOptions(args);
  const call = newCall(meta, signal);
  return finish(call, taskId, { outputDir: await resolveOutputDir(args.output_dir), ...options });
}

// ════════ 共享核心结束 ════════

const TOOLS = [SUBMIT, RESULT];
const HANDLERS = { [SUBMIT_TOOL]: submitTaskTool, [RESULT_TOOL]: getTaskTool };

// ════════ 共享：最小 MCP stdio 协议（逐行 JSON-RPC）════════

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
// 在途的 tools/call：请求 id → AbortController，收到 notifications/cancelled 时中止。
const running = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handle(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return send({ id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  const { id, method, params } = request;
  // 不带 id 的是通知：JSON-RPC 不许回任何消息，也不执行工具（免得白白提交一个会扣费、却没人收结果的任务）；
  // 只处理取消通知。
  if (id === undefined || id === null) {
    if (method === "notifications/cancelled") running.get(params?.requestId)?.abort(new Cancelled());
    return;
  }
  switch (method) {
    case "initialize":
      return send({
        id,
        result: {
          // 客户端要的版本我们支持就用它，否则回落到我们支持的最新版，由客户端决定是否继续。
          protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
    case "ping":
      return send({ id, result: {} });
    case "tools/list":
      return send({ id, result: { tools: TOOLS } });
    case "tools/call": {
      const name = params?.name;
      // 只认自己的工具名：constructor、toString 这类继承来的键不能被当成工具执行。
      const handler = typeof name === "string" && Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : undefined;
      if (!handler) return send({ id, error: { code: -32602, message: `Unknown tool: ${cleanText(String(name), 80)}` } });
      const controller = new AbortController();
      running.set(id, controller);
      try {
        const result = await handler(params.arguments, params._meta, controller.signal);
        // 取消后不回结果（MCP 约定）；已经提交的任务服务端照常执行，不会再提交第二次。
        return controller.signal.aborted ? undefined : send({ id, result });
      } catch (error) {
        if (controller.signal.aborted) return;
        const text = error instanceof ToolError ? error.message : `${BRAND} 3D 建模失败：${error?.message ?? error}`;
        return send({ id, result: { isError: true, content: [{ type: "text", text }] } });
      } finally {
        if (running.get(id) === controller) running.delete(id);
      }
    }
    default:
      send({ id, error: { code: -32601, message: `Method not found: ${cleanText(String(method), 80)}` } });
  }
}

export function main() {
  const inFlight = new Set();
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    line = line.replace(/^\uFEFF/, "");
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    // handle 自己抛错（协议层的意外）也不能变成未处理的 rejection 把进程带崩。
    const task = handle(request)
      .catch(() => send({ id: request?.id ?? null, error: { code: -32603, message: "Internal error" } }))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  });
  // 对端先关了 stdout（EPIPE）：没人收结果了，安静退出。别的写错误照常抛出，留下现场。
  process.stdout.on("error", (error) => {
    if (error?.code === "EPIPE") process.exit(0);
    throw error;
  });
  // stdin 关闭时先把在途调用的响应写完、等 stdout 排空再退出（直接 exit 会截断还在管道里的大响应）。
  lines.on("close", () => void Promise.allSettled([...inFlight]).then(() => process.stdout.write("", () => process.exit(0))));
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
