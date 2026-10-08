import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthContainer } from "./AuthContainer";
import { messages } from "@/messages/pt-BR";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

describe("AuthContainer", () => {
  it("renders in LOGIN mode by default with Google button and login fields", () => {
    render(<AuthContainer />);

    const loginTab = screen.getByRole("tab", { name: messages.auth.login.title });
    const registerTab = screen.getByRole("tab", { name: messages.auth.register.title });

    expect(loginTab.getAttribute("aria-selected")).toBe("true");
    expect(registerTab.getAttribute("aria-selected")).toBe("false");

    expect(screen.getByRole("button", { name: messages.auth.google.button })).toBeDefined();
    expect(screen.getByLabelText(messages.auth.login.identifier)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.login.password)).toBeDefined();
  });

  it("respects initialMode='REGISTER'", () => {
    render(<AuthContainer initialMode="REGISTER" />);

    const registerTab = screen.getByRole("tab", { name: messages.auth.register.title });
    expect(registerTab.getAttribute("aria-selected")).toBe("true");

    expect(screen.getByLabelText(messages.auth.register.name)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.email)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.academicId)).toBeDefined();
  });

  it("switches smoothly between LOGIN and REGISTER when clicking tabs", () => {
    render(<AuthContainer />);

    const registerTab = screen.getByRole("tab", { name: messages.auth.register.title });
    fireEvent.click(registerTab);

    expect(registerTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(messages.auth.register.name)).toBeDefined();

    const loginTab = screen.getByRole("tab", { name: messages.auth.login.title });
    fireEvent.click(loginTab);

    expect(loginTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(messages.auth.login.identifier)).toBeDefined();
  });

  it("switches mode when clicking bottom action links", () => {
    render(<AuthContainer />);

    // Click "Cadastre-se agora" from login form
    const registerAction = screen.getByRole("button", { name: messages.auth.unified.registerAction });
    fireEvent.click(registerAction);

    expect(screen.getByLabelText(messages.auth.register.name)).toBeDefined();

    // Click "Fazer login" from register form
    const loginAction = screen.getByRole("button", { name: messages.auth.register.loginAction });
    fireEvent.click(loginAction);

    expect(screen.getByLabelText(messages.auth.login.identifier)).toBeDefined();
  });

  it("invokes onLoginSuccess callback", async () => {
    const onLogin = vi.fn();
    const loginMock = vi.fn().mockResolvedValue({
      userId: "u-1",
      role: "STUDENT",
      mustChangePassword: false,
      sessionExpiresAt: "",
    });

    render(
      <AuthContainer
        onLoginSuccess={onLogin}
        service={{
          login: loginMock,
          register: vi.fn(),
          logout: vi.fn(),
          me: vi.fn(),
          forgotPassword: vi.fn(),
          resetPassword: vi.fn(),
          changePassword: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(messages.auth.login.identifier), { target: { value: "maria@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.login.password), { target: { value: "senhaSegura123!" } });
    fireEvent.click(screen.getByRole("button", { name: messages.auth.login.submit }));

    await vi.waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({
        userId: "u-1",
        role: "STUDENT",
        mustChangePassword: false,
        sessionExpiresAt: "",
      });
    });
  });

  it("invokes onRegisterSuccess callback", async () => {
    const onRegister = vi.fn();
    const registerMock = vi.fn().mockResolvedValue({
      userId: "u-2",
      name: "João",
      email: "joao@utfpr.edu.br",
      role: "STUDENT",
    });

    render(
      <AuthContainer
        initialMode="REGISTER"
        onRegisterSuccess={onRegister}
        service={{
          login: vi.fn(),
          register: registerMock,
          logout: vi.fn(),
          me: vi.fn(),
          forgotPassword: vi.fn(),
          resetPassword: vi.fn(),
          changePassword: vi.fn(),
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(messages.auth.register.name), { target: { value: "João" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.email), { target: { value: "joao@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.password), { target: { value: "senhaSegura123!" } });
    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));

    await vi.waitFor(() => {
      expect(onRegister).toHaveBeenCalledWith({
        userId: "u-2",
        name: "João",
        email: "joao@utfpr.edu.br",
        role: "STUDENT",
      });
    });
  });
});
