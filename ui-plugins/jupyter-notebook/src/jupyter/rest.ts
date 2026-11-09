import { JupyterError } from "#nb/contract.ts";
import { KernelConnection, type WebSocketFactory } from "#nb/jupyter/kernel.ts";

/** 连接一个 Jupyter Server 所需的全部信息。token 只存在于插件进程内。 */
export interface JupyterEndpoint {
  /** 以 `/` 结尾的 base URL，例如 `http://127.0.0.1:8888/`。 */
  baseUrl: string;
  token: string | null;
}

export interface ContentsModel {
  name: string;
  path: string;
  type: "notebook" | "file" | "directory";
  last_modified: string;
  created?: string;
  writable?: boolean;
  format?: string | null;
  content?: unknown;
}

export interface SessionModel {
  id: string;
  path: string;
  name: string;
  type: string;
  kernel: KernelModel | null;
}

export interface KernelModel {
  id: string;
  name: string;
  execution_state?: string;
  last_activity?: string;
}

export interface KernelSpecsModel {
  default: string;
  kernelspecs: Record<
    string,
    { name: string; spec: { display_name: string; language: string } }
  >;
}

const REQUEST_TIMEOUT_MS = 20_000;

/** 去掉 query / hash，保证以 `/` 结尾。 */
export function normalizeBaseUrl(raw: string): { baseUrl: string; token: string | null } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new JupyterError("server_unreachable", `Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new JupyterError("server_unreachable", `Jupyter Server URLs must use http or https: ${raw}`);
  const token = url.searchParams.get("token");
  // 用户常粘贴 JupyterLab 页面地址；只保留到 base path。
  let path = url.pathname.replace(/\/(lab|tree|notebooks|edit|doc)(\/.*)?$/, "/");
  if (!path.endsWith("/")) path += "/";
  return { baseUrl: `${url.protocol}//${url.host}${path}`, token: token || null };
}

const encodePath = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export function createJupyterClient(
  endpoint: JupyterEndpoint,
  {
    fetchImpl = globalThis.fetch,
    webSocket,
  }: { fetchImpl?: typeof fetch; webSocket?: WebSocketFactory } = {},
) {
  const headers = (): Record<string, string> => ({
    ...(endpoint.token ? { Authorization: `token ${endpoint.token}` } : {}),
    "Content-Type": "application/json",
  });

  async function request<T>(
    method: string,
    path: string,
    { body, query, notFound = "jupyter_error" }: {
      body?: unknown;
      query?: Record<string, string>;
      notFound?: "notebook_not_found" | "kernel_not_found" | "jupyter_error";
    } = {},
  ): Promise<T> {
    const url = new URL(path, endpoint.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new JupyterError(
        "server_unreachable",
        `Cannot reach the Jupyter Server at ${endpoint.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const text = await response.text();
    if (response.status === 401 || response.status === 403)
      throw new JupyterError(
        "unauthorized",
        `The Jupyter Server at ${endpoint.baseUrl} rejected the token (HTTP ${response.status}).`,
      );
    if (!response.ok) {
      let message = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { message?: string; reason?: string };
        message = parsed.message || parsed.reason || message;
      } catch {
        // 非 JSON 错误体
      }
      const code = response.status === 404 ? notFound : "jupyter_error";
      throw new JupyterError(code, `${method} ${url.pathname} failed (HTTP ${response.status}): ${message}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    endpoint,
    /** `/api` 返回 server 版本；无需认证，但带 token 也能用。 */
    version: () => request<{ version: string }>("GET", "api"),
    /** `/api/status` 需要认证，用于校验 token。 */
    status: () => request<Record<string, unknown>>("GET", "api/status"),
    kernelspecs: () => request<KernelSpecsModel>("GET", "api/kernelspecs"),

    listSessions: () => request<SessionModel[]>("GET", "api/sessions"),
    /** 按 path 创建或复用 session；Jupyter Server 对已有 path 返回现有 session。 */
    createSession: (path: string, kernelName: string | null) =>
      request<SessionModel>("POST", "api/sessions", {
        body: { path, type: "notebook", name: path.split("/").pop() ?? path, kernel: kernelName ? { name: kernelName } : {} },
      }),
    /** 修改 session 的 kernel（切换 kernelspec 时使用）。 */
    changeSessionKernel: (sessionId: string, kernelName: string) =>
      request<SessionModel>("PATCH", `api/sessions/${encodeURIComponent(sessionId)}`, {
        body: { kernel: { name: kernelName } },
      }),
    deleteSession: (sessionId: string) =>
      request<void>("DELETE", `api/sessions/${encodeURIComponent(sessionId)}`),

    getKernel: (kernelId: string) =>
      request<KernelModel>("GET", `api/kernels/${encodeURIComponent(kernelId)}`, {
        notFound: "kernel_not_found",
      }),
    interruptKernel: (kernelId: string) =>
      request<void>("POST", `api/kernels/${encodeURIComponent(kernelId)}/interrupt`, {
        notFound: "kernel_not_found",
      }),
    restartKernel: (kernelId: string) =>
      request<KernelModel>("POST", `api/kernels/${encodeURIComponent(kernelId)}/restart`, {
        notFound: "kernel_not_found",
      }),

    /** 读取文件或目录；`content: false` 只取元数据（用于比较 last_modified）。 */
    getContents: (path: string, { content = true, type }: { content?: boolean; type?: string } = {}) =>
      request<ContentsModel>("GET", `api/contents/${encodePath(path)}`, {
        query: { content: content ? "1" : "0", ...(type ? { type } : {}) },
        notFound: "notebook_not_found",
      }),
    /** 逐级创建缺失的目录（Contents API 不会自动创建父目录）。 */
    async ensureDirectory(path: string) {
      const parts = path.split("/").filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        const exists = await request<ContentsModel>("GET", `api/contents/${encodePath(dir)}`, {
          query: { content: "0" },
          notFound: "notebook_not_found",
        }).catch((error) => {
          if (error instanceof JupyterError && error.code === "notebook_not_found") return null;
          throw error;
        });
        if (exists && exists.type !== "directory")
          throw new JupyterError("invalid_path", `${dir} exists and is not a directory.`);
        if (!exists)
          await request<ContentsModel>("PUT", `api/contents/${encodePath(dir)}`, { body: { type: "directory" } });
      }
    },
    saveNotebook: (path: string, content: unknown) =>
      request<ContentsModel>("PUT", `api/contents/${encodePath(path)}`, {
        body: { type: "notebook", format: "json", content },
      }),

    connectKernel: (kernelId: string, clientSession: string) => {
      const url = new URL(`api/kernels/${encodeURIComponent(kernelId)}/channels`, endpoint.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("session_id", clientSession);
      return new KernelConnection({
        url: url.toString(),
        token: endpoint.token,
        session: clientSession,
        webSocket,
      });
    },
  };
}

export type JupyterClient = ReturnType<typeof createJupyterClient>;
