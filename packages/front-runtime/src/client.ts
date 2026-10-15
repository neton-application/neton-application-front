"use client";

/**
 * 浏览器侧后端访问。
 *
 * 会话凭据是**后端下发的 HttpOnly Cookie**，前端不保管令牌：这里没有「取 token / 存 token」，
 * 只有 `credentials: "include"`。后端同时保留 `Authorization` 头这条路（移动端、服务间调用）。
 *
 * 错误统一成 [ApiError]（评审 R15）：保留 HTTP 状态、业务码、字段错误、请求 id、Retry-After，
 * 按类别区分「登录失效 / 无权限 / 限流 / 校验失败 / 业务失败 / 服务端错误 / 网络 / 超时」。
 * 只有明确的登录失效才回登录页；后端不可达、代理返回 HTML 502 都是可恢复的错误，不是退出登录。
 */
import type { Envelope, PermissionInfo } from "./types";

/**
 * 后端基址：构建期注入 `NEXT_PUBLIC_NETON_BACKEND_URL`，缺省同源。
 *
 * 🔴 用 Cookie 之后这个值不能随便改成跨源地址：跨源要携带 Cookie 需要后端配
 * `Access-Control-Allow-Credentials` 且 Cookie 必须 `SameSite=None; Secure`。
 * 当前部署是 nginx 同源反代 `/admin/`，保持同源即可。
 */
export function backendBaseUrl(): string {
  return process.env.NEXT_PUBLIC_NETON_BACKEND_URL ?? "";
}

/**
 * 凭 Cookie 认证的写请求必须带这个头（后端 RealmAuthenticator 的 CSRF 检查）。
 * 跨站页面要加自定义头就得先过 CORS 预检，而后端不允许跨源携带凭据，所以它们加不上。
 */
export const CSRF_HEADER = "X-Neton-Csrf";

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export type ApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "validation"
  | "business"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response";

/** 后端错误信封里的字段级错误：`field` 是请求里的字段路径，`code` 是可翻译的机器码。 */
export interface ApiFieldError {
  field?: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly details: {
      status?: number;
      code?: number;
      fieldErrors?: ApiFieldError[];
      requestId?: string;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 后端 message 是机器码（如 INVALID_CREDENTIALS）时返回它，供界面翻译；英文句子不算。 */
  get machineCode(): string | undefined {
    return /^[A-Z][A-Z0-9_]{2,}$/.test(this.message) ? this.message : undefined;
  }
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname === "/login") return;
  window.location.href = "/login";
}

/** 业务码段位（neton-core NetonErrorCode）→ 错误类别。 */
function kindOfCode(code: number): ApiErrorKind {
  if (code >= 10000 && code < 10100) return code === 10004 ? "forbidden" : "unauthorized";
  if (code >= 10100 && code < 10200) return "validation";
  if (code >= 10300 && code < 10400) return "rate_limited";
  if (code > 0 && code < 100) return "server";
  return "business";
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - Date.now()) / 1000));
}

/** 调用方的取消信号与超时合并成一个。 */
function withTimeout(signal: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let fired = false;
  const timer = setTimeout(() => { fired = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => fired,
    dispose: () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
  };
}

export interface ApiRequestInit extends RequestInit {
  /** 单次请求超时，默认 20 秒。 */
  timeoutMs?: number;
}

async function send(path: string, init: ApiRequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CSRF_HEADER, "1");
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const guard = withTimeout(init.signal, init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(`${backendBaseUrl()}${path}`, { ...init, headers, credentials: "include", signal: guard.signal });
  } catch (cause) {
    if (guard.timedOut()) throw new ApiError("timeout", "timeout");
    if (init.signal?.aborted) throw cause; // 调用方主动取消，原样抛出
    throw new ApiError("network", cause instanceof Error ? cause.message : "network");
  } finally {
    guard.dispose();
  }
}

async function parse<T>(res: Response): Promise<T> {
  const requestId = res.headers.get("X-Request-Id") ?? undefined;
  if (res.status === 401) {
    redirectToLogin();
    throw new ApiError("unauthorized", "unauthorized", { status: 401, requestId });
  }
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("json")) {
    // 代理层的 HTML 错误页（502/504）之类：不要把 JSON 解析异常甩给用户。
    const kind: ApiErrorKind = res.status === 429 ? "rate_limited" : res.status >= 500 ? "server" : "invalid_response";
    throw new ApiError(kind, `HTTP ${res.status}`, { status: res.status, requestId, retryAfterSeconds: retryAfter(res) });
  }
  let body: Envelope<T> & { errors?: ApiFieldError[] };
  try {
    body = (await res.json()) as Envelope<T> & { errors?: ApiFieldError[] };
  } catch {
    throw new ApiError("invalid_response", `HTTP ${res.status}`, { status: res.status, requestId });
  }
  if (res.ok && body.code === 0) return body.data as T;
  const kind: ApiErrorKind =
    res.status === 403 ? "forbidden" :
    res.status === 429 ? "rate_limited" :
    body.code ? kindOfCode(body.code) :
    res.status >= 500 ? "server" : "business";
  if (kind === "unauthorized") redirectToLogin();
  throw new ApiError(kind, body.message || `code ${body.code}`, {
    status: res.status, code: body.code, fieldErrors: body.errors, requestId, retryAfterSeconds: retryAfter(res),
  });
}

/**
 * 发请求并取出 `data`。
 *
 * 只有幂等的读请求（GET/HEAD）在网络错误、超时或 502/503/504 时自动重试一次；写请求一律不重试，
 * 避免一笔操作被执行两次。
 */
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await send(path, init);
      if (idempotent && attempt === 0 && RETRYABLE_STATUS.has(res.status)) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      return await parse<T>(res);
    } catch (error) {
      const transient = error instanceof ApiError && (error.kind === "network" || error.kind === "timeout");
      if (idempotent && attempt === 0 && transient) {
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      throw error;
    }
  }
}

export function apiWrite<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  data?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  });
}

export type SessionResult =
  | { state: "authenticated"; info: PermissionInfo }
  | { state: "anonymous" }
  | { state: "unavailable"; error: ApiError };

/**
 * 会话快照。进入受保护区时取一次，之后页面切换只读这份快照。
 *
 * 三种结果分开：未登录才回登录页；后端不可达、5xx 只是「暂时用不了」，界面应当提示并允许重试 ——
 * 不能因为一次网络抖动就把正在工作的人踢出去。
 */
export async function fetchSession(): Promise<SessionResult> {
  try {
    const res = await send("/admin/system/auth/get-permission-info", { cache: "no-store" });
    if (res.status === 401) return { state: "anonymous" };
    const info = await parse<PermissionInfo>(res);
    return { state: "authenticated", info };
  } catch (error) {
    if (error instanceof ApiError && error.kind === "unauthorized") return { state: "anonymous" };
    return { state: "unavailable", error: error instanceof ApiError ? error : new ApiError("network", String(error)) };
  }
}

/** 登录：成功后会话 Cookie 由后端下发，前端不接触 token。 */
export interface LoginResult {
  status: "authenticated" | "mfa_required" | "mfa_enrollment_required";
  challengeToken?: string;
  challengeExpiresAt?: number;
}

export async function login(username: string, password: string): Promise<Envelope<LoginResult>> {
  const res = await send("/admin/system/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
  return (await res.json()) as Envelope<LoginResult>;
}

/**
 * 退出：后端吊销当前会话并清 Cookie。
 *
 * 请求失败时**不能**假装已经退出：Cookie 还在、会话还有效，换个人坐到这台电脑前照样能用。
 * 返回 false 让界面提示重试；成功才回登录页。
 */
export async function logout(): Promise<boolean> {
  try {
    const res = await send("/admin/system/auth/logout", { method: "POST" });
    if (!res.ok && res.status !== 401) return false;
  } catch {
    return false;
  }
  redirectToLogin();
  return true;
}
