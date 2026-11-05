import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVER_NOW, detail } from "@/test/assessmentFixtures";
import { assessmentService, type AttemptRow } from "@/services/assessmentService";
import { ExamReview } from "./ExamReview";

const rows: AttemptRow[] = [
  { attemptId: "t-1", studentId: "s-1", studentName: "Ana", academicId: "1000001", status: "SUBMITTED", startedAt: "2026-10-21T09:10:00-03:00", preliminaryScore: 7.5, reviewed: false },
  {
    attemptId: "t-2", studentId: "s-2", studentName: "Bruno", academicId: "1000002", status: "TIME_EXPIRED", startedAt: "2026-10-21T09:12:00-03:00", preliminaryScore: 4,
    reviewed: true, finalScore: 5,
  },
  { studentId: "s-3", studentName: "Carla", academicId: "1000003", status: "ABSENT" },
];

beforeEach(() => {
  vi.spyOn(assessmentService, "attempts").mockResolvedValue({ items: rows, serverNow: SERVER_NOW });
  vi.spyOn(assessmentService, "review").mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const exam = detail({ phase: "ENDED", maxScore: 10 });

// SPEC-097 CA-06 (T4): the screen of the correction lists who delivered, to review or reviewed, with the filter, and the teacher picks one.
describe("ExamReview, the list of the students", () => {
  it("lists who delivered, with the score and the situation of the review, and never who did not come", async () => {
    render(<ExamReview classId="c-1" assessment={exam} />);
    const list = await screen.findByRole("list", { name: "Alunos que entregaram" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Ana");
    expect(items[0]!.textContent).toContain("A revisar");
    expect(items[0]!.textContent).toContain("7,50");
    expect(items[1]!.textContent).toContain("Revisada");
    expect(items[1]!.textContent).toContain("5,00");
    expect(screen.queryByText("Carla")).toBeNull();
    expect(screen.getByText("Escolha um aluno para corrigir.")).toBeDefined();
  });

  it("filters by the situation of the review and picks a student", async () => {
    render(<ExamReview classId="c-1" assessment={exam} />);
    await screen.findByRole("list", { name: "Alunos que entregaram" });
    fireEvent.click(screen.getByRole("button", { name: "A revisar (1)" }));
    expect(screen.queryByRole("button", { name: /Bruno/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisados (1)" }));
    expect(screen.queryByRole("button", { name: /Ana/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Todos (2)" }));
    const ana = screen.getByRole("button", { name: /Ana/ });
    fireEvent.click(ana);
    expect(ana.getAttribute("aria-pressed")).toBe("true");
    expect(assessmentService.review).toHaveBeenCalledWith("c-1", "a-1", "t-1");
  });

  it("goes back to the assessment", async () => {
    render(<ExamReview classId="c-1" assessment={exam} />);
    expect((await screen.findByRole("link", { name: "Voltar para a prova" })).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
  });
});
