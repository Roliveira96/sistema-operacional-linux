// Single HTTP client of the frontend (SPEC-004). Components never call fetch
// directly. Requests go to the same origin under /api/v1 and Next.js rewrites
// them to the Go backend, so session cookies stay first-party.

import { emitSessionEvent } from "./sessionEvents";

export const API_BASE_PATH = "/api/v1";
const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface InvalidParam {
  name: string;
  reason: string;
}

/** Error raised for RFC 7807 responses. */
export class ApiProblemError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly invalidParams: InvalidParam[];
  readonly retryAfterSeconds?: number;
  /** Extension members, such as the health components list. */
  readonly extensions: Record<string, unknown>;

  constructor(body: Record<string, unknown>, status: number) {
    const title = typeof body.title === "string" ? body.title : "Request failed";
    super(typeof body.detail === "string" ? body.detail : title);
    this.name = "ApiProblemError";
    this.type = typeof body.type === "string" ? body.type : "about:blank";
    this.title = title;
    this.status = typeof body.status === "number" ? body.status : status;
    this.detail = typeof body.detail === "string" ? body.detail : undefined;
    this.instance = typeof body.instance === "string" ? body.instance : undefined;
    this.invalidParams = Array.isArray(body.invalidParams) ? (body.invalidParams as InvalidParam[]) : [];
    this.retryAfterSeconds = typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : undefined;

    const standard = new Set(["type", "title", "status", "detail", "instance", "invalidParams", "retryAfterSeconds"]);
    this.extensions = Object.fromEntries(Object.entries(body).filter(([key]) => !standard.has(key)));
  }
}

/** Error raised when the server could not be reached. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Network request failed", { cause });
    this.name = "NetworkError";
  }
}

/** Error raised for a non-2xx response that is not RFC 7807. */
export class UnexpectedResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Unexpected response status ${status}`);
    this.name = "UnexpectedResponseError";
    this.status = status;
  }
}

export type ApiError = ApiProblemError | NetworkError | UnexpectedResponseError;

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiProblemError || error instanceof NetworkError || error instanceof UnexpectedResponseError
  );
}

export type Fetcher = typeof fetch;

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

export function createHttpClient(fetcher: Fetcher = (...args) => fetch(...args)) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { body, headers, ...init } = options;
    const finalHeaders = new Headers(headers);
    finalHeaders.set("Accept", `application/json, ${PROBLEM_CONTENT_TYPE}`);
    if (body !== undefined && !(body instanceof FormData)) {
      finalHeaders.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetcher(`${API_BASE_PATH}${path}`, {
        ...init,
        headers: finalHeaders,
        credentials: "same-origin",
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch (cause) {
      throw new NetworkError(cause);
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes(PROBLEM_CONTENT_TYPE)) {
      const problem = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const error = new ApiProblemError(problem, response.status);
      if (error.type === "session-expired") {
        emitSessionEvent({ kind: "session-expired", reason: String(error.extensions.reason ?? "") });
      } else if (error.type === "password-change-required") {
        emitSessionEvent({ kind: "password-change-required" });
      }
      throw error;
    }
    if (!response.ok) {
      throw new UnexpectedResponseError(response.status);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
    post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>(path, { ...options, method: "POST", body }),
    patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
      request<T>(path, { ...options, method: "PATCH", body }),
    delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "DELETE" }),
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;

export const httpClient = createHttpClient();
