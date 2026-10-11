import { httpClient, type HttpClient } from "./httpClient";

export interface OAuthClient {
  id: string;
  name: string;
}

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  allow: boolean;
}

/** Consent step of the MCP client OAuth login (SPEC-024 RN-14). */
export function createOAuthService(client: HttpClient = httpClient) {
  return {
    getClient: (clientId: string) => client.get<OAuthClient>(`/oauth/clients/${encodeURIComponent(clientId)}`),
    authorize: (request: AuthorizeRequest) => client.post<{ redirectUrl: string }>("/oauth/authorize", request),
  };
}

export type OAuthService = ReturnType<typeof createOAuthService>;

export const oauthService = createOAuthService();
