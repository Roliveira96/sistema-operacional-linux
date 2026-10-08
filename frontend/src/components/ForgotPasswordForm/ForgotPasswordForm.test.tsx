import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { problem, setTheme, themes } from "@/test/helpers";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

afterEach(cleanup);

function submit(value: string) {
  fireEvent.change(screen.getByLabelText(messages.auth.login.identifier), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: messages.auth.forgot.submit }));
}

// Covers SPEC-003 CA-10 (interface side): always the neutral answer.
describe("ForgotPasswordForm", () => {
  it("shows the neutral confirmation", async () => {
    const forgotPassword = vi.fn().mockResolvedValue({ message: "x" });
    render(<ForgotPasswordForm service={{ forgotPassword }} />);
    submit("a1234567");
    expect((await screen.findByRole("status")).textContent).toBe(messages.auth.forgot.sent);
    expect(forgotPassword).toHaveBeenCalledWith("a1234567");
  });

  it("validates and reports errors", async () => {
    render(<ForgotPasswordForm service={{ forgotPassword: vi.fn().mockRejectedValue(problem("rate-limited", 429, { retryAfterSeconds: 9 })) }} />);
    fireEvent.click(screen.getByRole("button", { name: messages.auth.forgot.submit }));
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.required);
    submit("a1234567");
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.login.rateLimited(9));
  });

  it.each(themes)("renders the same structure in the %s theme", (theme) => {
    setTheme(theme);
    const { container } = render(<ForgotPasswordForm service={{ forgotPassword: vi.fn() }} />);
    expect(container.querySelector("section.card form.form input")).not.toBeNull();
  });
});
