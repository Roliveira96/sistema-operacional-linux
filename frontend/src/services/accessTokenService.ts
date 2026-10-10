import { httpClient, type HttpClient } from "./httpClient";

export const TOKEN_VALIDITY_DAYS = [30, 90, 365] as const;
export type TokenValidityDays = (typeof TOKEN_VALIDITY_DAYS)[number];

/** A personal access token as the list returns it; the value is never part of it (SPEC-024 5). */
export interface AccessToken {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
}

/** The answer to the creation: the only time the value is shown. */
export interface CreatedAccessToken {
  id: string;
  name: string;
  expiresAt: string;
  token: string;
}

export type AccessTokenStatus = "active" | "expired" | "revoked";

export function tokenStatus(token: AccessToken, now: Date = new Date()): AccessTokenStatus {
  if (token.revokedAt) return "revoked";
  return new Date(token.expiresAt).getTime() <= now.getTime() ? "expired" : "active";
}

/** Personal access tokens of the MCP server (SPEC-024), for ADMIN and TEACHER. */
export function createAccessTokenService(client: HttpClient = httpClient) {
  return {
    list: async (): Promise<AccessToken[]> => {
      const r = await client.get<{ items: AccessToken[] }>("/access-tokens");
      return r.items ?? [];
    },
    create: (name: string, validityDays: TokenValidityDays) =>
      client.post<CreatedAccessToken>("/access-tokens", { name: name.trim(), validityDays }),
    revoke: async (id: string): Promise<void> => {
      await client.delete(`/access-tokens/${encodeURIComponent(id)}`);
    },
  };
}

export type AccessTokenService = ReturnType<typeof createAccessTokenService>;

export const accessTokenService = createAccessTokenService();
