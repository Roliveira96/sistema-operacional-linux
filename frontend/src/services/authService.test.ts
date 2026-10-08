import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthService } from "./authService";
import { describeAuthError } from "./authErrors";
import { ApiProblemError, createHttpClient, NetworkError } from "./httpClient";
import { onSessionEvent, type SessionEvent } from "./sessionEvents";

function json(body: unknown, status = 200, type = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": type } });
}

describe("authService", () => {
  it("calls every auth endpoint with the expected method and body", async () => {
    const fetcher = vi.fn().mockImplementation(async () => json({ ok: true }));
    const svc = createAuthService(createHttpClient(fetcher));

    await svc.login("a1234567", "pw");
    await svc.register("Maria Silva", "maria@utfpr.edu.br", "pw", "1234567");
    await svc.register("Maria Silva", "maria@utfpr.edu.br", "pw");
    await svc.logout();
    await svc.me();
    await svc.forgotPassword("a1234567");
    await svc.resetPassword("tok", "new pw");
    await svc.changePassword("old", "new");

    const calls = fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body]);
    expect(calls).toEqual([
      ["/api/v1/auth/login", "POST", JSON.stringify({ identifier: "a1234567", password: "pw" })],
      [
        "/api/v1/auth/register",
        "POST",
        JSON.stringify({ name: "Maria Silva", email: "maria@utfpr.edu.br", password: "pw", academicId: "1234567" }),
      ],
      [
        "/api/v1/auth/register",
        "POST",
        JSON.stringify({ name: "Maria Silva", email: "maria@utfpr.edu.br", password: "pw" }),
      ],
      ["/api/v1/auth/logout", "POST", undefined],
      ["/api/v1/auth/me", "GET", undefined],
      ["/api/v1/auth/forgot-password", "POST", JSON.stringify({ identifier: "a1234567" })],
      ["/api/v1/auth/reset-password", "POST", JSON.stringify({ token: "tok", newPassword: "new pw" })],
      ["/api/v1/auth/change-password", "POST", JSON.stringify({ currentPassword: "old", newPassword: "new" })],
    ]);
  });
});

describe("session events", () => {
  let unsubscribe: () => void = () => {};
  afterEach(() => unsubscribe());

  it("are emitted for expired sessions and pending password changes", async () => {
    const events: SessionEvent[] = [];
    unsubscribe = onSessionEvent((e) => events.push(e));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ type: "session-expired", status: 401, reason: "IDLE" }, 401, "application/problem+json"))
      .mockResolvedValueOnce(json({ type: "password-change-required", status: 403 }, 403, "application/problem+json"))
      .mockResolvedValueOnce(json({ type: "not-authenticated", status: 401 }, 401, "application/problem+json"));
    const client = createHttpClient(fetcher);

    await expect(client.get("/x")).rejects.toBeInstanceOf(ApiProblemError);
    await expect(client.get("/x")).rejects.toBeInstanceOf(ApiProblemError);
    await expect(client.get("/x")).rejects.toBeInstanceOf(ApiProblemError);
    expect(events).toEqual([{ kind: "session-expired", reason: "IDLE" }, { kind: "password-change-required" }]);

    unsubscribe();
    await client.get("/x").catch(() => undefined);
    expect(events).toHaveLength(2);
  });
});

describe("describeAuthError", () => {
  const p = (type: string, extra: Record<string, unknown> = {}) => new ApiProblemError({ type, ...extra }, 400);

  it("maps every known problem to Portuguese", () => {
    expect(describeAuthError(p("invalid-credentials"))).toMatch(/incorretos/);
    expect(describeAuthError(p("validation-error", { invalidParams: [{ name: "identifier", reason: "x" }] }))).toMatch(/RA/);
    expect(describeAuthError(p("validation-error", { invalidParams: [{ name: "academicId", reason: "x" }] }))).toMatch(/7 dígitos/);
    expect(describeAuthError(p("validation-error", { invalidParams: [{ name: "email", reason: "x" }] }))).toMatch(/e-mail válido/);
    expect(describeAuthError(p("validation-error"))).toMatch(/Preencha/);
    expect(describeAuthError(p("rate-limited", { retryAfterSeconds: 30 }))).toMatch(/30 s/);
    expect(describeAuthError(p("rate-limited"))).toMatch(/60 s/);
    expect(describeAuthError(p("reset-token-invalid"))).toMatch(/expirou/);
    expect(describeAuthError(p("email-taken"))).toMatch(/já está em uso/);
    expect(describeAuthError(p("academic-id-taken"))).toMatch(/já está em uso/);
    expect(describeAuthError(p("account-inactive"))).toMatch(/suspensa ou inativa/);
    expect(describeAuthError(p("oauth-invalid-request"))).toMatch(/Google/);
    expect(describeAuthError(p("oauth-unauthorized"))).toMatch(/Google/);
    expect(describeAuthError(p("weak-password", { violations: ["TOO_SHORT", "UNKNOWN"] }))).toMatch(/10 caracteres.*UNKNOWN/);
    expect(describeAuthError(p("weak-password"))).toMatch(/inesperado/);
    expect(describeAuthError(new NetworkError(null))).toMatch(/conexão/);
    expect(describeAuthError(p("other"))).toMatch(/inesperado/);
    expect(describeAuthError(new Error("x"))).toMatch(/inesperado/);
  });
});
