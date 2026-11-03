import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SERVER_NOW } from "@/test/assessmentFixtures";
import type { AttemptRow } from "@/services/assessmentService";
import { AssessmentAttempts } from "./AssessmentAttempts";

afterEach(cleanup);

const rows: AttemptRow[] = [
  { attemptId: "t-1", studentId: "s-1", studentName: "Ana", academicId: "1000001", status: "IN_PROGRESS", startedAt: "2026-10-21T09:10:00-03:00" },
  {
    attemptId: "t-2", studentId: "s-2", studentName: "Bruno", academicId: "1000002", status: "SUBMITTED", startedAt: "2026-10-21T09:12:00-03:00",
    submittedAt: "2026-10-21T10:00:00-03:00", preliminaryScore: 7.5, pendingItems: 1,
  },
  {
    attemptId: "t-3", studentId: "s-3", studentName: "Carla", academicId: "1000003", status: "TIME_EXPIRED", startedAt: "2026-10-21T09:15:00-03:00",
    submittedAt: "2026-10-21T11:01:00-03:00", preliminaryScore: 4, pendingItems: 0,
  },
];

// SPEC-090 CA-15: the section of the attempts in the detail of the exam, for the teacher.
describe("AssessmentAttempts", () => {
  it("lists the attempts with the situation and the preliminary score, and the pending descriptive answers", async () => {
    render(<AssessmentAttempts maxScore={10} load={() => Promise.resolve({ items: rows, serverNow: SERVER_NOW })} />);
    const table = await screen.findByRole("table", { name: "Tentativas" });
    const lines = within(table).getAllByRole("row").slice(1);
    expect(lines).toHaveLength(3);
    expect(lines[0]!.textContent).toContain("Ana");
    expect(lines[0]!.textContent).toContain("Em andamento");
    expect(lines[1]!.textContent).toContain("Entregue");
    expect(lines[1]!.textContent).toContain("7,50 de 10,00 · 1 descritiva pendente");
    expect(lines[2]!.textContent).toContain("Tempo esgotado");
    expect(lines[2]!.textContent).toContain("4,00 de 10,00");
    expect(lines[2]!.textContent).not.toContain("pendente");
  });

  it("says nobody entered yet, and reads again on Atualizar", async () => {
    const load = vi.fn().mockResolvedValue({ items: [], serverNow: SERVER_NOW });
    render(<AssessmentAttempts maxScore={10} load={load} />);
    expect(await screen.findByText("Nenhum aluno entrou na prova ainda.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
