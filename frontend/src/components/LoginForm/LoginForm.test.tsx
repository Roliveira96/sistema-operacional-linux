import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { NetworkError } from "@/services/httpClient";
import { problem, setTheme, themes } from "@/test/helpers";
import { LoginForm } from "./LoginForm";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fill(identifier: string, password: string) {
  fireEvent.change(screen.getByLabelText(messages.auth.login.identifier), { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText(messages.auth.login.password), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: messages.auth.login.submit }));
}

// Covers SPEC-003 CA-03 (interface side).
describe("LoginForm", () => {
  it("logs in and reports the result", async () => {
    const result = { userId: "1", role: "ADMIN" as const, mustChangePassword: true, sessionExpiresAt: "" };
    const login = vi.fn().mockResolvedValue(result);
    const onSuccess = vi.fn();
    render(<LoginForm onSuccess={onSuccess} service={{ login }} />);

    fill("  a1234567 ", "correct horse battery");
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(login).toHaveBeenCalledWith("a1234567", "correct horse battery");
  });

  it("requires both fields", () => {
    const login = vi.fn();
    render(<LoginForm onSuccess={vi.fn()} service={{ login }} />);
    fireEvent.click(screen.getByRole("button", { name: messages.auth.login.submit }));
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.required);
    expect(login).not.toHaveBeenCalled();
  });

  it("shows the invalid credentials message and clears the password", async () => {
    render(<LoginForm onSuccess={vi.fn()} service={{ login: vi.fn().mockRejectedValue(problem("invalid-credentials", 401)) }} />);
    fill("a1234567", "wrong password!");
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.errors.invalidCredentials);
    expect((screen.getByLabelText(messages.auth.login.password) as HTMLInputElement).value).toBe("");
  });

  it("shows network errors", async () => {
    render(<LoginForm onSuccess={vi.fn()} service={{ login: vi.fn().mockRejectedValue(new NetworkError(null)) }} />);
    fill("a1234567", "x");
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.errors.network);
  });

  // Covers SPEC-003 CA-09 (interface side): countdown and disabled button.
  it("locks the form with a countdown when rate limited", async () => {
    vi.useFakeTimers();
    render(
      <LoginForm
        onSuccess={vi.fn()}
        service={{ login: vi.fn().mockRejectedValue(problem("rate-limited", 429, { retryAfterSeconds: 2 })) }}
      />,
    );
    fill("a1234567", "x");
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.login.rateLimited(2));
    const button = screen.getByRole("button", { name: messages.auth.login.submit }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.login.rateLimited(1));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(button.disabled).toBe(false);
  });

  it("explains why the user was sent to the login", () => {
    render(<LoginForm onSuccess={vi.fn()} reason="IDLE" service={{ login: vi.fn() }} />);
    expect(screen.getByRole("status").textContent).toBe(messages.auth.login.reason.IDLE);
  });

  it("toggles password visibility", () => {
    render(<LoginForm onSuccess={vi.fn()} service={{ login: vi.fn() }} />);
    const input = screen.getByLabelText(messages.auth.login.password) as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: messages.auth.showPassword }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: messages.auth.hidePassword }));
    expect(input.type).toBe("password");
  });

  // Covers SPEC-003 CA-16 structurally (SPEC-006): same structure in both themes.
  it.each(themes)("renders the same structure in the %s theme", (theme) => {
    setTheme(theme);
    const { container } = render(<LoginForm onSuccess={vi.fn()} service={{ login: vi.fn() }} />);
    expect(container.querySelectorAll("input")).toHaveLength(2);
    expect(container.querySelector("section.card form.form")).not.toBeNull();
  });
});
