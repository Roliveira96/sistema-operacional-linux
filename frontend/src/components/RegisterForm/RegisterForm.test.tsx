import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterForm, validateAcademicId } from "./RegisterForm";
import { messages } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";

afterEach(() => {
  cleanup();
});

describe("validateAcademicId", () => {
  it("treats empty or whitespace string as valid with no normalized value", () => {
    expect(validateAcademicId("")).toEqual({ valid: true });
    expect(validateAcademicId("   ")).toEqual({ valid: true });
  });

  it("normalizes RA with 7 digits and optional leading a/A", () => {
    expect(validateAcademicId("1234567")).toEqual({ valid: true, normalized: "1234567" });
    expect(validateAcademicId("a1234567")).toEqual({ valid: true, normalized: "1234567" });
    expect(validateAcademicId("A1234567")).toEqual({ valid: true, normalized: "1234567" });
  });

  it("rejects RA with non-7 digits or non-numeric characters", () => {
    expect(validateAcademicId("12345")).toEqual({ valid: false });
    expect(validateAcademicId("12345678")).toEqual({ valid: false });
    expect(validateAcademicId("abcdefg")).toEqual({ valid: false });
    expect(validateAcademicId("a12345b")).toEqual({ valid: false });
  });
});

describe("RegisterForm", () => {
  it("renders all fields and labels", () => {
    render(<RegisterForm onSuccess={vi.fn()} />);
    expect(screen.getByLabelText(messages.auth.register.name)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.email)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.academicId)).toBeDefined();
    expect(screen.getByLabelText(messages.auth.register.password)).toBeDefined();
    expect(screen.getByRole("button", { name: messages.auth.register.submit })).toBeDefined();
  });

  it("validates required fields before submitting", () => {
    const registerMock = vi.fn();
    render(<RegisterForm onSuccess={vi.fn()} service={{ register: registerMock }} />);

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.required);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("validates academic ID format if provided", () => {
    const registerMock = vi.fn();
    render(<RegisterForm onSuccess={vi.fn()} service={{ register: registerMock }} />);

    fireEvent.change(screen.getByLabelText(messages.auth.register.name), { target: { value: "Aluno" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.email), { target: { value: "aluno@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.academicId), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.password), { target: { value: "senhaSegura10!" } });

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));
    expect(screen.getByRole("alert").textContent).toBe(messages.auth.errors.invalidAcademicId);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it("submits successfully with normalized RA and calls onSuccess", async () => {
    const onSuccess = vi.fn();
    const registerMock = vi.fn().mockResolvedValue({
      userId: "u-123",
      name: "Aluno Teste",
      email: "aluno@utfpr.edu.br",
      role: "STUDENT",
    });

    render(<RegisterForm onSuccess={onSuccess} service={{ register: registerMock }} />);

    fireEvent.change(screen.getByLabelText(messages.auth.register.name), { target: { value: "Aluno Teste" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.email), { target: { value: "aluno@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.academicId), { target: { value: "a7654321" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.password), { target: { value: "senhaSegura10!" } });

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));

    await vi.waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("Aluno Teste", "aluno@utfpr.edu.br", "senhaSegura10!", "7654321");
      expect(onSuccess).toHaveBeenCalledWith({
        userId: "u-123",
        name: "Aluno Teste",
        email: "aluno@utfpr.edu.br",
        role: "STUDENT",
      });
    });
  });

  it("submits successfully without RA", async () => {
    const onSuccess = vi.fn();
    const registerMock = vi.fn().mockResolvedValue({
      userId: "u-456",
      name: "Sem RA",
      email: "semra@utfpr.edu.br",
      role: "STUDENT",
    });

    render(<RegisterForm onSuccess={onSuccess} service={{ register: registerMock }} />);

    fireEvent.change(screen.getByLabelText(messages.auth.register.name), { target: { value: "Sem RA" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.email), { target: { value: "semra@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.password), { target: { value: "senhaSegura10!" } });

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));

    await vi.waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith("Sem RA", "semra@utfpr.edu.br", "senhaSegura10!", undefined);
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("displays conflict error when email is already in use", async () => {
    const registerMock = vi.fn().mockRejectedValue(new ApiProblemError({ type: "email-taken" }, 409));
    render(<RegisterForm onSuccess={vi.fn()} service={{ register: registerMock }} />);

    fireEvent.change(screen.getByLabelText(messages.auth.register.name), { target: { value: "Duplicado" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.email), { target: { value: "duplicado@utfpr.edu.br" } });
    fireEvent.change(screen.getByLabelText(messages.auth.register.password), { target: { value: "senhaSegura10!" } });

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.submit }));

    expect((await screen.findByRole("alert")).textContent).toBe(messages.auth.errors.emailTaken);
  });

  it("calls onSwitchToLogin when the switch button is clicked", () => {
    const onSwitch = vi.fn();
    render(<RegisterForm onSuccess={vi.fn()} onSwitchToLogin={onSwitch} />);

    fireEvent.click(screen.getByRole("button", { name: messages.auth.register.loginAction }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});
