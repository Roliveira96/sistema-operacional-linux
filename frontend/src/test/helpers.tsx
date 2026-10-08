import { vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";

/** Builds an RFC 7807 error as the HTTP client would raise it. */
export function problem(type: string, status: number, extra: Record<string, unknown> = {}) {
  return new ApiProblemError({ type, status, title: "x", ...extra }, status);
}

/** Router stub for components that navigate with next/navigation. */
export const router = { replace: vi.fn(), push: vi.fn() };

/** Runs a test body once per theme, asserting structural parity (SPEC-006). */
export const themes = ["light", "dark"] as const;
export function setTheme(theme: (typeof themes)[number]) {
  document.documentElement.dataset.theme = theme;
}
