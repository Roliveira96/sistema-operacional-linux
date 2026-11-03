import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { assessmentService } from "@/services/assessmentService";
import { problem } from "@/test/helpers";
import { publicOf, studentAttempt } from "@/test/assessmentFixtures";
import { terminalMount } from "@/test/fakeTerminal";
import TakePage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("@/components/RichTextEditor/RichTextEditor", () => ({ RichTextEditor: () => <textarea aria-label="Sua resposta" /> }));

function asRole(role: "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}
const params = Promise.resolve({ id: "c-1", assessmentId: "a-1" });

beforeEach(() => {
  mount.mockImplementation(terminalMount().mount);
  vi.spyOn(assessmentService, "get").mockResolvedValue(publicOf());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

// SPEC-090 CA-01, CA-12 to CA-14: the window of the exam enters the attempt and shows it to the student.
describe("take page", () => {
  it("enters the exam and shows the questions", async () => {
    asRole("STUDENT");
    const enter = vi.spyOn(assessmentService, "enterAttempt").mockResolvedValue(studentAttempt());
    render(<TakePage params={params} />);
    expect(await screen.findByRole("heading", { name: "Questão 1 de 5" })).toBeDefined();
    expect(enter).toHaveBeenCalledWith("c-1", "a-1");
    expect(screen.getByText("Prova 1: permissões")).toBeDefined();
  });

  it("says why the exam cannot be entered", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "enterAttempt").mockRejectedValue(problem("assessment-not-started", 409));
    render(<TakePage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toBe("A docente ainda não iniciou a prova.");
  });

  it("says the exam was delivered when the attempt is closed", async () => {
    asRole("STUDENT");
    vi.spyOn(assessmentService, "enterAttempt").mockRejectedValue(problem("attempt-already-submitted", 409));
    render(<TakePage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Você já entregou esta prova.");
  });

  it("sends the teacher back to the assessment", async () => {
    asRole("TEACHER");
    render(<TakePage params={params} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-1"));
  });
});
