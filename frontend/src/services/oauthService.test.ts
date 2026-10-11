import { describe, expect, it, vi } from "vitest";
import { createHttpClient } from "./httpClient";
import { createOAuthService } from "./oauthService";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const make = (fetcher: ReturnType<typeof vi.fn>) => createOAuthService(createHttpClient(fetcher as unknown as typeof fetch));

describe("oauthService", () => {
  it("gets the client by encoded id", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ id: "a b", name: "Claude" }));
    expect(await make(fetcher).getClient("a b")).toEqual({ id: "a b", name: "Claude" });
    expect(fetcher.mock.calls[0]![0]).toBe("/api/v1/oauth/clients/a%20b");
  });

  it("posts the decision and returns the redirect url", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ redirectUrl: "http://localhost:1/cb?code=x" }));
    const body = { clientId: "c", redirectUri: "http://localhost:1/cb", codeChallenge: "ch", state: "s", allow: true };
    expect(await make(fetcher).authorize(body)).toEqual({ redirectUrl: "http://localhost:1/cb?code=x" });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("/api/v1/oauth/authorize");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });
});
