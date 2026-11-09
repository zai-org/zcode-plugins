import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  APP_NAME,
  LIMITS,
  ZoteroError,
  type ConnectionState,
  type WriteAuth,
  type WriteSupport,
  type ZoteroStatus,
} from "#z/contract.ts";

export interface ZoteroResponse {
  status: number;
  headers: Headers;
  text: string;
  /** JSON 响应体；非 JSON 时为 undefined。 */
  json?: unknown;
}

export interface ClientOptions {
  /** 本地 API 根地址，默认 http://127.0.0.1:23119。 */
  baseUrl?: string;
  /** 保存“始终允许”key 的文件；省略时只存在内存中。 */
  keyFile?: string | null;
  /** 授权对话框等待时间。 */
  authorizeTimeoutMs?: number;
  onChange?: () => void;
  log?: (line: string) => void;
}

/** 写入请求的选项。 */
export interface WriteOptions {
  body?: string | Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
}

const READ_TIMEOUT_MS = 30_000;

/**
 * Zotero 本地 API 的唯一出口：探测连接、读取、经用户授权的写入。
 * 写入需要 Zotero-Server-ID 与本地 API key；key 由 POST /api/local/authorize 弹出的对话框发放。
 */
export class ZoteroClient {
  readonly baseUrl: string;
  private keyFile: string | null;
  private authorizeTimeoutMs: number;
  private key: { value: string; remember: boolean } | null = null;
  private keyLoaded = false;
  private authorizing: Promise<string> | null = null;
  private onChange: () => void;
  private log: (line: string) => void;
  status: ZoteroStatus = { state: "unknown", writes: "unknown", auth: "none", checkedAt: 0 };

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://127.0.0.1:23119").replace(/\/+$/, "");
    this.keyFile = options.keyFile ?? null;
    this.authorizeTimeoutMs = options.authorizeTimeoutMs ?? LIMITS.authorizeTimeoutMs;
    this.onChange = options.onChange ?? (() => undefined);
    this.log = options.log ?? (() => undefined);
  }

  get isAuthorizing() {
    return this.authorizing !== null;
  }

  private setStatus(patch: Partial<ZoteroStatus>) {
    const next = { ...this.status, ...patch, checkedAt: Date.now() };
    const changed =
      next.state !== this.status.state ||
      next.version !== this.status.version ||
      next.serverId !== this.status.serverId ||
      next.writes !== this.status.writes ||
      next.auth !== this.status.auth ||
      next.error !== this.status.error;
    this.status = next;
    if (changed) this.onChange();
  }

  // -------------------------------------------------------------------------
  // HTTP
  // -------------------------------------------------------------------------

  private async send(method: string, path: string, init: { body?: string | Uint8Array; headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ZoteroResponse> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const timeout = AbortSignal.timeout(init.timeoutMs ?? READ_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Zotero-API-Version": "3", ...init.headers },
        body: init.body as BodyInit | undefined,
        redirect: "manual",
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const cause = (error as { cause?: { code?: string } }).cause;
      if (timeout.aborted)
        throw new ZoteroError("zotero_error", `Zotero did not answer ${method} ${path} in time.`);
      if (cause?.code === "ECONNREFUSED" || cause?.code === "ECONNRESET" || cause?.code === "EPIPE") {
        this.setStatus({ state: "not_running", error: undefined });
        throw new ZoteroError(
          "zotero_not_running",
          "Zotero is not running. Ask the user to start the Zotero desktop app (version 7 or later), then try again.",
        );
      }
      throw new ZoteroError("zotero_error", `Could not reach Zotero at ${this.baseUrl}: ${String(cause?.code ?? error)}`);
    }
    const text = await response.text();
    let json: unknown;
    if ((response.headers.get("content-type") ?? "").includes("json") && text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const version = response.headers.get("x-zotero-version") ?? undefined;
    const serverId = response.headers.get("zotero-server-id") ?? undefined;
    if (response.status === 403 && /local api is not enabled/i.test(text)) {
      this.setStatus({ state: "api_disabled", version, error: undefined });
      throw new ZoteroError(
        "local_api_disabled",
        'Zotero is running, but its local API is turned off. Ask the user to enable "Allow other applications on this computer to communicate with Zotero" in Zotero Settings → Advanced, then try again.',
      );
    }
    if (this.status.state !== "ready" || (serverId && serverId !== this.status.serverId) || (version && version !== this.status.version)) {
      if (serverId && this.status.serverId && serverId !== this.status.serverId) {
        // 另一个 Zotero 实例（换了 profile 或机器）：作废旧 key。
        this.key = null;
        this.keyLoaded = false;
      }
      this.setStatus({ state: "ready", ...(version ? { version } : {}), ...(serverId ? { serverId } : {}), error: undefined });
    }
    return { status: response.status, headers: response.headers, text, json };
  }

  /** GET 一个本地 API 路径；非 2xx/304 抛出 ZoteroError。 */
  async get(path: string, options: { headers?: Record<string, string>; allow?: number[]; signal?: AbortSignal } = {}): Promise<ZoteroResponse> {
    const response = await this.send("GET", path, { headers: options.headers, signal: options.signal });
    if ((response.status >= 200 && response.status < 300) || response.status === 304 || options.allow?.includes(response.status))
      return response;
    throw httpError(response, `GET ${path}`);
  }

  async getJson<T>(path: string, options: { signal?: AbortSignal } = {}): Promise<{ data: T; response: ZoteroResponse }> {
    const response = await this.get(path, options);
    if (response.json === undefined) throw new ZoteroError("zotero_error", `GET ${path} did not return JSON.`);
    return { data: response.json as T, response };
  }

  /** 探测 Zotero：是否运行、本地 API 是否开启、是否支持写入。不抛出。 */
  async probe(): Promise<ZoteroStatus> {
    try {
      const response = await this.send("GET", "/api/", { timeoutMs: 5_000 });
      if (response.status === 404) {
        // Zotero 6 及更早没有本地 API。
        this.setStatus({ state: "api_disabled", error: "This Zotero version has no local API; Zotero 7 or later is required." });
        return this.status;
      }
      if (this.status.writes === "unknown") await this.detectWrites();
      if (!this.keyLoaded) await this.loadKey();
    } catch (error) {
      if (error instanceof ZoteroError && (error.code === "zotero_not_running" || error.code === "local_api_disabled")) return this.status;
      this.setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) });
    }
    return this.status;
  }

  /** 不带 Server-ID 的空写入：支持写入的版本回 428，只读版本回 4xx “不支持该方法”。没有副作用。 */
  private async detectWrites() {
    const response = await this.send("POST", "/api/users/0/items", {
      body: "[]",
      headers: { "Content-Type": "application/json" },
      timeoutMs: 5_000,
    });
    const writes: WriteSupport =
      response.status === 428 || response.status === 401 || response.status === 412 ? "available" : "unsupported";
    this.setStatus({ writes });
  }

  async ensureReady(): Promise<void> {
    if (this.status.state === "ready" && Date.now() - this.status.checkedAt < 1_000) return;
    const status = await this.probe();
    if (status.state === "not_running")
      throw new ZoteroError(
        "zotero_not_running",
        "Zotero is not running. Ask the user to start the Zotero desktop app (version 7 or later), then try again.",
      );
    if (status.state === "api_disabled")
      throw new ZoteroError(
        "local_api_disabled",
        status.error ??
          'Zotero is running, but its local API is turned off. Ask the user to enable "Allow other applications on this computer to communicate with Zotero" in Zotero Settings → Advanced.',
      );
    if (status.state === "error") throw new ZoteroError("zotero_error", status.error ?? "Zotero did not respond as expected.");
  }

  // -------------------------------------------------------------------------
  // 写入授权
  // -------------------------------------------------------------------------

  private async loadKey() {
    this.keyLoaded = true;
    if (!this.keyFile || !this.status.serverId) return;
    try {
      const stored = JSON.parse(await readFile(this.keyFile, "utf8")) as Record<string, string>;
      const value = stored[this.status.serverId];
      if (typeof value === "string" && /^[a-zA-Z0-9]{16,64}$/.test(value)) {
        this.key = { value, remember: true };
        this.setStatus({ auth: "remembered" });
      }
    } catch {
      // 没有保存的 key。
    }
  }

  private async storeKey(value: string | null) {
    if (!this.keyFile || !this.status.serverId) return;
    let stored: Record<string, string> = {};
    try {
      stored = JSON.parse(await readFile(this.keyFile, "utf8")) as Record<string, string>;
    } catch {
      stored = {};
    }
    if (value) stored[this.status.serverId] = value;
    else delete stored[this.status.serverId];
    await mkdir(dirname(this.keyFile), { recursive: true });
    await writeFile(this.keyFile, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await chmod(this.keyFile, 0o600).catch(() => undefined);
  }

  /** 弹出 Zotero 的授权对话框并等待用户选择。并发调用共享同一个对话框。 */
  authorize(): Promise<string> {
    this.authorizing ??= (async () => {
      this.onChange();
      try {
        // 授权请求本身也是写入方法，同样需要 Zotero-Server-ID（否则 428）。
        if (!this.status.serverId) await this.probe();
        const response = await this.send("POST", "/api/local/authorize", {
          body: JSON.stringify({ appName: APP_NAME }),
          headers: { "Content-Type": "application/json", "Zotero-Server-ID": this.status.serverId ?? "" },
          timeoutMs: this.authorizeTimeoutMs,
        }).catch((error) => {
          if (error instanceof ZoteroError && /in time/.test(error.message))
            throw new ZoteroError(
              "write_denied",
              "Nobody answered Zotero's permission dialog in time. Ask the user to approve the request in Zotero, then try again.",
            );
          throw error;
        });
        if (response.status === 403) {
          this.setStatus({ auth: "denied" });
          throw new ZoteroError("write_denied", "The user denied write access in Zotero. Do not retry unless the user asks.");
        }
        if (response.status === 429) {
          const wait = response.headers.get("retry-after") ?? "60";
          throw new ZoteroError("authorize_rate_limited", `Zotero is rate-limiting permission requests; try again in ${wait} s.`);
        }
        if (response.status === 404 || response.status === 405 || response.status === 400 && !response.json)
          throw new ZoteroError("writes_unsupported", "This Zotero version cannot write through its local API. Zotero 8 or later is required.");
        const body = response.json as { key?: string; remember?: boolean } | undefined;
        if (response.status !== 200 || !body?.key) throw httpError(response, "POST /api/local/authorize");
        this.key = { value: body.key, remember: !!body.remember };
        this.setStatus({ auth: body.remember ? "remembered" : "none", writes: "available" });
        if (body.remember) await this.storeKey(body.key);
        this.log(`write access granted (${body.remember ? "always" : "once"})`);
        return body.key;
      } finally {
        this.authorizing = null;
        this.onChange();
      }
    })();
    return this.authorizing;
  }

  /** 忘记保存的 key（用户在 Zotero 里撤销后）。 */
  async forgetKey() {
    this.key = null;
    await this.storeKey(null).catch(() => undefined);
    this.setStatus({ auth: "none" });
  }

  /**
   * 经授权的写入。没有 key 时先请求授权；key 失效（401：一次性 key 已用掉或被撤销）时重新授权一次。
   * 412/428 以外的非 2xx 由调用方根据状态码处理。
   */
  async write(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, options: WriteOptions = {}): Promise<ZoteroResponse> {
    await this.ensureReady();
    if (this.status.writes === "unsupported")
      throw new ZoteroError(
        "writes_unsupported",
        `Zotero ${this.status.version ?? ""} can only be read through its local API. Writing needs Zotero 8 or later.`.replace("  ", " "),
      );
    if (!this.keyLoaded) await this.loadKey();
    for (let attempt = 0; attempt < 2; attempt++) {
      const key = this.key?.value ?? (await this.authorize());
      const single = this.key && !this.key.remember;
      if (single) this.key = null; // 一次性 key：Zotero 校验时即作废。
      const response = await this.send(method, path, {
        body: options.body,
        timeoutMs: 120_000,
        headers: {
          ...(options.contentType ? { "Content-Type": options.contentType } : {}),
          ...options.headers,
          "Zotero-API-Key": key,
          "Zotero-Server-ID": this.status.serverId ?? "",
        },
      });
      if (response.status === 401 && attempt === 0) {
        if (!single) await this.forgetKey();
        continue;
      }
      if (response.status === 412 && /Zotero-Server-ID/i.test(response.text)) {
        this.setStatus({ serverId: undefined });
        await this.probe();
        throw new ZoteroError("zotero_error", "A different Zotero instance answered than before. Try the write again.");
      }
      if (response.status === 403 && /write access|denied/i.test(response.text))
        throw new ZoteroError("write_denied", response.text || "Zotero denied the write.");
      return response;
    }
    throw new ZoteroError("write_denied", "Zotero did not accept the write key.");
  }

  /** 字节上传到 /api/local/uploads/<key>（不需要 key 与 Server-ID）。 */
  async upload(url: string, bytes: Uint8Array, contentType: string): Promise<ZoteroResponse> {
    // 只接受 Zotero 自己返回的本机上传地址。
    const target = new URL(url);
    const base = new URL(this.baseUrl);
    if (!/^\/api\/local\/uploads\/[A-Za-z0-9]+$/.test(target.pathname) || target.port !== (base.port || "80"))
      throw new ZoteroError("zotero_error", `Unexpected upload URL from Zotero: ${url}`);
    return this.send("POST", `${this.baseUrl}${target.pathname}`, {
      body: bytes,
      headers: { "Content-Type": contentType },
      timeoutMs: 120_000,
    });
  }

  setConnection(state: ConnectionState) {
    this.setStatus({ state });
  }

  setAuth(auth: WriteAuth) {
    this.setStatus({ auth });
  }
}

export function httpError(response: ZoteroResponse, what: string): ZoteroError {
  const text = response.text.trim().slice(0, 500);
  if (response.status === 404) return new ZoteroError("not_found", `${what}: not found${text && text !== "Not found" ? ` (${text})` : ""}.`);
  if (response.status === 412) return new ZoteroError("version_conflict", `${what}: the object changed in Zotero meanwhile.`);
  if (response.status === 400) return new ZoteroError("invalid_input", `${what}: ${text || "bad request"}`);
  return new ZoteroError("zotero_error", `${what} failed with HTTP ${response.status}${text ? `: ${text}` : ""}`);
}
