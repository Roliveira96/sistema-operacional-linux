import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { problem, setTheme, themes } from "@/test/helpers";
import { ResetPasswordForm } from "./ResetPasswordForm";

afterEach(cleanup);

function fill(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(messages.auth.newPassword), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(messages.auth.confirmPassword), { target: { value: confirm } });
}

function submitButton() {
  return screen.getByRole("button", { name: messages.auth.reset.submit }) as HTMLButtonElement;
}

// Covers SPEC-003 CA-11 and CA-12 (interface side).
describe("ResetPasswordForm", () => {
  it("resets the password", async () => {
    const resetPassword = vi.fn().mockResolvedValue({ sessionsRevoked: 1 });
    render(<ResetPasswordForm token="tok" service={{ resetPassword }} />);
    fill("a brand new passphrase", "a brand new passphrase");
    fireEvent.click(submitButton());
    expect((await screen.findByRole("status")).textContent).toBe(messages.auth.reset.success);
    expect(resetPassword).toHaveBeenCalledWith("tok", "a brand new passphrase");
  });

  it("validates the policy and the confirmation while typing", () => {
    render(<ResetPasswordForm token="tok" service={{ resetPassword: vi.fn() }} />);
    fill("short", "different");
    expect(screen.getByText(messages.auth.policy.TOO_SHORT!)).toBeTruthy();
    expect(screen.getByText(messages.auth.mismatch)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    fireEvent.submit(submitButton().closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.mismatch);
  });

  it("asks for a new link when the token is missing or invalid", async () => {
    const { unmount } = render(<ResetPasswordForm token={null} service={{ resetPassword: vi.fn() }} />);
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.reset.missingToken);
    unmount();

    render(<ResetPasswordForm token="tok" service={{ resetPassword: vi.fn().mockRejectedValue(problem("reset-token-invalid", 410)) }} />);
    fill("a brand new passphrase", "a brand new passphrase");
    fireEvent.click(submitButton());
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.reset.invalidToken);
  });

  it("shows server policy errors", async () => {
    render(
      <ResetPasswordForm
        token="tok"
        service={{ resetPassword: vi.fn().mockRejectedValue(problem("weak-password", 400, { violations: ["EQUALS_EMAIL"] })) }}
      />,
    );
    fill("a brand new passphrase", "a brand new passphrase");
    fireEvent.click(submitButton());
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.policy.EQUALS_EMAIL);
  });

  it("requires a password before submitting", () => {
    render(<ResetPasswordForm token="tok" service={{ resetPassword: vi.fn() }} />);
    fireEvent.submit(submitButton().closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.required);
  });

  it.each(themes)("renders the same structure in the %s theme", (theme) => {
    setTheme(theme);
    const { container } = render(<ResetPasswordForm token="tok" service={{ resetPassword: vi.fn() }} />);
    expect(container.querySelectorAll("section.card input")).toHaveLength(2);
  });
});
