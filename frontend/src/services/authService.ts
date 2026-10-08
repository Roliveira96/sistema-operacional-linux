import { httpClient, type HttpClient } from "./httpClient";

export type Role = "ADMIN" | "TEACHER" | "STUDENT";

export interface LoginResult {
  userId: string;
  name?: string;
  role: Role;
  mustChangePassword: boolean;
  sessionExpiresAt: string;
}

export interface CurrentUser {
  userId: string;
  email: string;
  name?: string;
  role: Role;
  status: string;
  mustChangePassword: boolean;
  sessionCreatedAt: string;
  sessionExpiresAt: string;
}

/** Auth API calls (SPEC-003). The session cookie is handled by the browser. */
export function createAuthService(client: HttpClient = httpClient) {
  return {
    login: (identifier: string, password: string) => client.post<LoginResult>("/auth/login", { identifier, password }),
    logout: () => client.post<void>("/auth/logout"),
    me: () => client.get<CurrentUser>("/auth/me", { cache: "no-store" }),
    forgotPassword: (identifier: string) => client.post<{ message: string }>("/auth/forgot-password", { identifier }),
    resetPassword: (token: string, newPassword: string) =>
      client.post<{ sessionsRevoked: number }>("/auth/reset-password", { token, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) =>
      client.post<void>("/auth/change-password", { currentPassword, newPassword }),
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export const authService = createAuthService();
