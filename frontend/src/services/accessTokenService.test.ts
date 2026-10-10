import { describe, expect, it, vi } from "vitest";
import { createAccessTokenService, tokenStatus, type AccessToken } from "./accessTokenService";
import { ApiProblemError, createHttpClient } from "./httpClient";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/problem+json" } });

const make = (fetcher: ReturnType<typeof vi.fn>) => createAccessTokenService(createHttpClient(fetcher as unknown as typeof fetch));

describe("accessTokenService", () => {
  it("lists the tokens from the items of the response", async () => {
    const token = { id: "t1", name: "n", createdAt: "2026-10-10T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" };
    const fetcher = vi.fn().mockResolvedValueOnce(json({ items: [token] })).mockResolvedValueOnce(json({}));
    const service = make(fetcher);
    expect(await service.list()).toEqual([token]);
    expect(await service.list()).toEqual([]);
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/access-tokens");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET" });
  });

  it("creates a token with the trimmed name and the validity, and returns the value", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ id: "t1", name: "n", expiresAt: "x", token: "secret" }, 201));
    expect(await make(fetcher).create("  n ", 90)).toEqual({ id: "t1", name: "n", expiresAt: "x", token: "secret" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/v1/access-tokens");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "n", validityDays: 90 });
  });

  it("revokes by id with DELETE and resolves on 204", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(make(fetcher).revoke("a b")).resolves.toBeUndefined();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/access-tokens/a%20b");
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });
  });

  it("raises the RFC 7807 problem of the server", async () => {
    const fetcher = vi.fn().mockImplementation(async () => problem({ type: "rate-limited", title: "Too many", status: 429 }, 429));
    await expect(make(fetcher).create("n", 30)).rejects.toMatchObject({ type: "rate-limited", status: 429 });
    await expect(make(fetcher).create("n", 30)).rejects.toBeInstanceOf(ApiProblemError);
  });

  it("derives the status of a token", () => {
    const base: AccessToken = { id: "1", name: "n", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };
    const now = new Date("2026-10-10T00:00:00Z");
    expect(tokenStatus(base, now)).toBe("active");
    expect(tokenStatus({ ...base, expiresAt: "2026-10-01T00:00:00Z" }, now)).toBe("expired");
    expect(tokenStatus({ ...base, revokedAt: "2026-02-01T00:00:00Z" }, now)).toBe("revoked");
    expect(tokenStatus({ ...base, expiresAt: "2999-01-01T00:00:00Z" })).toBe("active");
  });
});
