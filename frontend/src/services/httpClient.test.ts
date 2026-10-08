import { describe, expect, it, vi } from "vitest";
import { ApiProblemError, createHttpClient, isApiError, NetworkError, UnexpectedResponseError } from "./httpClient";

function jsonResponse(body: unknown, status: number, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType } });
}

// Covers SPEC-004 CA-21.
describe("httpClient", () => {
  it("calls the same-origin API base path with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 200));
    const result = await createHttpClient(fetcher).get<{ ok: boolean }>("/health");

    expect(result).toEqual({ ok: true });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/v1/health");
    expect(init.credentials).toBe("same-origin");
  });

  it("serializes JSON bodies", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await createHttpClient(fetcher).post("/auth/logout", { a: 1 });

    const init = fetcher.mock.calls[0]![1];
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("turns RFC 7807 responses into a typed error", async () => {
    const problem = {
      type: "rate-limited",
      title: "Too Many Requests",
      status: 429,
      detail: "Slow down.",
      instance: "/api/v1/auth/login",
      retryAfterSeconds: 30,
      invalidParams: [{ name: "identifier", reason: "required" }],
      components: ["x"],
    };
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(problem, 429, "application/problem+json"));

    const error = await createHttpClient(fetcher).post("/auth/login", {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiProblemError);
    const p = error as ApiProblemError;
    expect(p.type).toBe("rate-limited");
    expect(p.status).toBe(429);
    expect(p.retryAfterSeconds).toBe(30);
    expect(p.invalidParams).toEqual([{ name: "identifier", reason: "required" }]);
    expect(p.extensions).toEqual({ components: ["x"] });
  });

  it("reports non-problem error responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(createHttpClient(fetcher).get("/health")).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("reports network failures", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(createHttpClient(fetcher).get("/health")).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("httpClient edge cases", () => {
  it("sends FormData untouched and supports patch and delete", async () => {
    const fetcher = vi.fn().mockImplementation(async () => jsonResponse({}, 200));
    const client = createHttpClient(fetcher);
    const form = new FormData();
    await client.patch("/students/me/avatar", form);
    await client.delete("/x");

    const [, patchInit] = fetcher.mock.calls[0]!;
    expect(patchInit.method).toBe("PATCH");
    expect(patchInit.body).toBe(form);
    expect(new Headers(patchInit.headers).has("Content-Type")).toBe(false);
    expect(fetcher.mock.calls[1]![1].method).toBe("DELETE");
  });

  it("fills defaults when the problem body is incomplete or invalid", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("not json", { status: 500, headers: { "Content-Type": "application/problem+json" } }));
    const error = (await createHttpClient(fetcher).get("/x").catch((e: unknown) => e)) as ApiProblemError;
    expect(error.type).toBe("about:blank");
    expect(error.status).toBe(500);
    expect(error.title).toBe("Request failed");
    expect(error.invalidParams).toEqual([]);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("identifies API errors", () => {
    expect(isApiError(new NetworkError(null))).toBe(true);
    expect(isApiError(new UnexpectedResponseError(502))).toBe(true);
    expect(isApiError(new ApiProblemError({}, 400))).toBe(true);
    expect(isApiError(new Error("x"))).toBe(false);
  });
});
