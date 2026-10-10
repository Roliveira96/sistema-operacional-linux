import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import type { CurrentUser } from "@/services/authService";
import { emitSessionEvent } from "@/services/sessionEvents";
import { problem, router, setTheme, themes } from "@/test/helpers";
import { AuthProvider } from "./AuthProvider";

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const user: CurrentUser = {
  userId: "1",
  email: "admin@rmo.dev.br",
  role: "ADMIN",
  status: "ACTIVE",
  mustChangePassword: false,
  sessionCreatedAt: "2026-10-08T12:00:00Z",
  sessionExpiresAt: "2026-10-08T17:00:00Z",
};

function Probe() {
  const { user } = useAuth();
  return <p>{user.email}</p>;
}

beforeEach(() => {
  router.replace.mockClear();
});
afterEach(cleanup);

describe("AuthProvider", () => {
  it("renders children with the current user", async () => {
    render(
      <AuthProvider service={{ me: vi.fn().mockResolvedValue(user), logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe(messages.auth.loadingSession);
    expect(await screen.findByText(user.email)).toBeTruthy();
  });

  it("sends anonymous visitors to the login", async () => {
    render(
      <AuthProvider service={{ me: vi.fn().mockRejectedValue(problem("not-authenticated", 401)), logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });

  // Covers SPEC-003 CA-06 (interface side).
  it("enforces the mandatory password change", async () => {
    const me = vi.fn().mockResolvedValue({ ...user, mustChangePassword: true });
    const { unmount } = render(
      <AuthProvider service={{ me, logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/change-password"));
    unmount();

    render(
      <AuthProvider enforcePasswordChange={false} service={{ me, logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText(user.email)).toBeTruthy();
  });

  // Covers SPEC-003 CA-07 and CA-08 (interface side).
  it("reacts to session events", async () => {
    render(
      <AuthProvider service={{ me: vi.fn().mockResolvedValue(user), logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    await screen.findByText(user.email);
    act(() => emitSessionEvent({ kind: "session-expired", reason: "ABSOLUTE" }));
    expect(router.replace).toHaveBeenCalledWith("/login?reason=ABSOLUTE");
    expect(screen.queryByText(user.email)).toBeNull();
    act(() => emitSessionEvent({ kind: "password-change-required" }));
    expect(router.replace).toHaveBeenCalledWith("/change-password");
  });

  it("does not redirect twice when the session expired during load", async () => {
    render(
      <AuthProvider service={{ me: vi.fn().mockRejectedValue(problem("session-expired", 401)), logout: vi.fn() }}>
        <Probe />
      </AuthProvider>,
    );
    await act(async () => {});
    expect(router.replace).not.toHaveBeenCalledWith("/login");
  });

  it("logs out from the shell even if the server call fails", async () => {
    const logout = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <AuthProvider service={{ me: vi.fn().mockResolvedValue({ ...user, name: "Ricardo" }), logout }}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </AuthProvider>,
    );
    expect(await screen.findByText("Ricardo")).toBeTruthy();
    expect(screen.getByText(messages.home.role.ADMIN!)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: messages.auth.logout }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?reason=LOGOUT"));
  });

  it("refuses useAuth outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside AuthProvider");
  });

  it.each(themes)("renders the shell with the same structure in the %s theme", async (theme) => {
    setTheme(theme);
    const { container } = render(
      <AuthProvider service={{ me: vi.fn().mockResolvedValue(user), logout: vi.fn() }}>
        <AppShell>
          <p>content</p>
        </AppShell>
      </AuthProvider>,
    );
    await screen.findByText("content");
    expect(container.querySelector("header.bar nav")).not.toBeNull();
  });
});
