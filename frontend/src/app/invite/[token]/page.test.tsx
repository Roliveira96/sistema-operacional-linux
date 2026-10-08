import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/messages/pt-BR";
import { joinByInvite } from "@/services/studentService";
import InviteJoinPage from "./page";

vi.mock("@/services/studentService", () => ({
  joinByInvite: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InviteJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders registration form for student join", async () => {
    render(<InviteJoinPage params={Promise.resolve({ token: "tok-abc" })} />);

    await waitFor(() => {
      expect(screen.getByText(messages.students.invite.title)).toBeDefined();
    });

    expect(screen.getByLabelText(messages.students.invite.name)).toBeDefined();
    expect(screen.getByLabelText(messages.students.invite.academicId)).toBeDefined();
    expect(screen.getByLabelText(messages.students.invite.email)).toBeDefined();
    expect(screen.getByLabelText(messages.students.invite.password)).toBeDefined();
  });

  it("validates academic ID before sending request", async () => {
    render(<InviteJoinPage params={Promise.resolve({ token: "tok-abc" })} />);

    await waitFor(() => {
      expect(screen.getByLabelText(messages.students.invite.academicId)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(messages.students.invite.name), {
      target: { value: "Aluno" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.academicId), {
      target: { value: "123" }, // invalid
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.email), {
      target: { value: "a@utfpr.edu.br" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.password), {
      target: { value: "Pass12345!" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: messages.students.invite.submit })
    );

    await waitFor(() => {
      expect(screen.getByText(messages.auth.errors.invalidAcademicId)).toBeDefined();
    });

    expect(joinByInvite).not.toHaveBeenCalled();
  });

  it("normalizes RA and shows pending moderation notice on success (CA-02, CA-07)", async () => {
    vi.mocked(joinByInvite).mockResolvedValueOnce({
      userId: "u-123",
      accountStatus: "ACTIVE",
      enrollmentStatus: "PENDING_MODERATION",
    });

    render(<InviteJoinPage params={Promise.resolve({ token: "tok-valid" })} />);

    await waitFor(() => {
      expect(screen.getByLabelText(messages.students.invite.academicId)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(messages.students.invite.name), {
      target: { value: "Lucas Silva" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.academicId), {
      target: { value: "a2345678" }, // with "a" prefix
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.email), {
      target: { value: "lucas@alunos.utfpr.edu.br" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.password), {
      target: { value: "SuperPassword123!" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: messages.students.invite.submit })
    );

    await waitFor(() => {
      expect(joinByInvite).toHaveBeenCalledWith("tok-valid", {
        academicId: "2345678",
        name: "Lucas Silva",
        email: "lucas@alunos.utfpr.edu.br",
        password: "SuperPassword123!",
        whatsapp: undefined,
        discord: undefined,
      });
    });

    expect(
      screen.getByText(messages.students.invite.pendingNotice)
    ).toBeDefined();
  });

  it("handles conflict error for email or RA (CA-03)", async () => {
    vi.mocked(joinByInvite).mockRejectedValueOnce(
      new Error("conflict: user with email already exists")
    );

    render(<InviteJoinPage params={Promise.resolve({ token: "tok-valid" })} />);

    await waitFor(() => {
      expect(screen.getByLabelText(messages.students.invite.academicId)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(messages.students.invite.name), {
      target: { value: "Lucas Silva" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.academicId), {
      target: { value: "2345678" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.email), {
      target: { value: "dup@alunos.utfpr.edu.br" },
    });
    fireEvent.change(screen.getByLabelText(messages.students.invite.password), {
      target: { value: "SuperPassword123!" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: messages.students.invite.submit })
    );

    await waitFor(() => {
      expect(screen.getByText(messages.students.invite.conflictEmail)).toBeDefined();
    });
  });
});
