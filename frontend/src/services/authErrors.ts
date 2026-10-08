import { messages } from "@/messages/pt-BR";
import { ApiProblemError, NetworkError } from "./httpClient";

/** Translates an auth API error into a Portuguese message for the user. */
export function describeAuthError(error: unknown): string {
  if (error instanceof NetworkError) return messages.auth.errors.network;
  if (error instanceof ApiProblemError) {
    switch (error.type) {
      case "invalid-credentials":
        return messages.auth.errors.invalidCredentials;
      case "validation-error":
        return error.invalidParams.some((p) => p.name === "identifier")
          ? messages.auth.errors.invalidIdentifier
          : messages.auth.errors.required;
      case "rate-limited":
        return messages.auth.login.rateLimited(error.retryAfterSeconds ?? 60);
      case "reset-token-invalid":
        return messages.auth.reset.invalidToken;
      case "weak-password": {
        const violations = Array.isArray(error.extensions.violations) ? (error.extensions.violations as string[]) : [];
        return violations.map((v) => messages.auth.policy[v] ?? v).join(" ") || messages.auth.errors.unexpected;
      }
    }
  }
  return messages.auth.errors.unexpected;
}
