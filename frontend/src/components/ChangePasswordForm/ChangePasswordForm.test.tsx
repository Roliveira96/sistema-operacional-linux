import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { problem, setTheme, themes } from "@/test/helpers";
import { ChangePasswordForm } from "./ChangePasswordForm";

afterEach(cleanup);

function fill(current: string, password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText(messages.auth.change.current), { target: { value: current } });
  fireEvent.change(screen.getByLabelText(messages.auth.newPassword), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(messages.auth.confirmPassword), { target: { value: confirm } });
}

const submit = () => fireEvent.click(screen.getByRole("button", { name: messages.auth.change.submit }));

describe("ChangePasswordForm", () => {
  it("changes the password", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    render(<ChangePasswordForm email="a@b.co" onSuccess={onSuccess} service={{ changePassword }} />);
    fill("old password!!", "a brand new passphrase");
    submit();
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(changePassword).toHaveBeenCalledWith("old password!!", "a brand new passphrase");
  });

  it("reports a wrong current password and other errors", async () => {
    const changePassword = vi.fn().mockRejectedValueOnce(problem("invalid-credentials", 401)).mockRejectedValueOnce(new Error("x"));
    render(<ChangePasswordForm onSuccess={vi.fn()} service={{ changePassword }} />);
    fill("wrong current!", "a brand new passphrase");
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.change.wrongCurrent);
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.errors.unexpected);
  });

  it("validates locally before calling the server", () => {
    const changePassword = vi.fn();
    render(<ChangePasswordForm email="a@b.co" onSuccess={vi.fn()} service={{ changePassword }} />);
    fill("same password!", "same password!");
    expect(screen.getByText(messages.auth.policy.SAME_AS_CURRENT!)).toBeTruthy();
    fill("old password!!", "a brand new passphrase", "something else");
    fireEvent.submit(screen.getByRole("button", { name: messages.auth.change.submit }).closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.mismatch);
    fill("", "a brand new passphrase");
    fireEvent.submit(screen.getByRole("button", { name: messages.auth.change.submit }).closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.required);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it.each(themes)("renders the same structure in the %s theme", (theme) => {
    setTheme(theme);
    const { container } = render(<ChangePasswordForm onSuccess={vi.fn()} service={{ changePassword: vi.fn() }} />);
    expect(container.querySelectorAll("form.form input")).toHaveLength(3);
  });
});
