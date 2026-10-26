import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssessmentHistory } from "./AssessmentHistory";

afterEach(cleanup);

const lines = () => screen.getAllByRole("listitem").map((li) => li.textContent);

// SPEC-075 section 3.1 and RN-15: who did what, when, with the old and new dates and the reason.
describe("AssessmentHistory", () => {
  it("tells what happened, by whom and when, in the order the server gives", () => {
    render(
      <AssessmentHistory
        events={[
          { kind: "CREATED", actorName: "Profa. Sediane", createdAt: "2026-10-20T16:00:00-03:00" },
          { kind: "UPDATED", actorName: "Profa. Sediane", createdAt: "2026-10-20T16:30:00-03:00", changedFields: ["title", "items"] },
          {
            kind: "RESCHEDULED",
            actorName: "Admin",
            createdAt: "2026-10-21T08:00:00-03:00",
            oldStartsAt: "2026-10-23T09:00:00-03:00",
            oldEndsAt: "2026-10-23T11:00:00-03:00",
            newStartsAt: "2026-10-24T14:00:00-03:00",
            newEndsAt: "2026-10-24T16:00:00-03:00",
            reason: "Laboratório indisponível",
          },
          { kind: "CANCELED", actorName: "Profa. Sediane", createdAt: "2026-10-22T09:15:00-03:00", reason: "Falta de energia" },
        ]}
      />,
    );
    expect(lines()).toEqual([
      "Criada por Profa. Sediane em 20/10/2026 às 16:00.",
      "Alterada por Profa. Sediane em 20/10/2026 às 16:30: título, questões.",
      "Reagendada por Admin em 21/10/2026 às 08:00: de 23/10/2026, 09:00–11:00 para 24/10/2026, 14:00–16:00. Motivo: Laboratório indisponível",
      "Cancelada por Profa. Sediane em 22/10/2026 às 09:15. Motivo: Falta de energia",
    ]);
  });

  it("does not tell the value of what changed, only the name of the field", () => {
    render(<AssessmentHistory events={[{ kind: "UPDATED", actorName: "Profa. Sediane", createdAt: "2026-10-20T16:30:00-03:00", changedFields: ["description", "audience", "students", "module", "type", "duration", "composition", "draw"] }]} />);
    expect(lines()[0]).toBe(
      "Alterada por Profa. Sediane em 20/10/2026 às 16:30: instruções, público, alunos, módulo, tipo, duração, composição, sorteio.",
    );
  });

  // SPEC-076 RN-11: each action on the clearance is one line, and the new fields have their names.
  it("tells the actions on the clearance, and names the modality and the requirement", () => {
    render(
      <AssessmentHistory
        events={[
          { kind: "CLEARANCE_UPDATED", actorName: "Profa. Sediane", createdAt: "2026-10-21T09:30:00-03:00", changedFields: ["clearances"] },
          { kind: "UPDATED", actorName: "Admin", createdAt: "2026-10-21T09:40:00-03:00", changedFields: ["modality", "requires_clearance", "max_score"] },
        ]}
      />,
    );
    expect(lines()).toEqual([
      "Habilitações atualizadas por Profa. Sediane em 21/10/2026 às 09:30.",
      "Alterada por Admin em 21/10/2026 às 09:40: modalidade, exigência de habilitação, nota máxima.",
    ]);
  });

  // SPEC-086 CA-05 (RN-05, D-02): the clearances in a row, by the same author on the same day, are one line with the count and the first and
  // last time; in the same minute, with the single time; the other lines do not change.
  it("joins the clearances in a row into one line", () => {
    const clear = (actorName: string, createdAt: string) => ({ kind: "CLEARANCE_UPDATED" as const, actorName, createdAt, changedFields: ["clearances"] });
    render(
      <AssessmentHistory
        events={[
          { kind: "CREATED", actorName: "Admin", createdAt: "2026-10-21T18:37:00-03:00" },
          ...[45, 46, 47, 48, 49, 50].map((s) => clear("Admin", `2026-10-22T13:35:${s}-03:00`)),
          clear("Admin", "2026-10-22T13:38:10-03:00"),
          clear("Admin", "2026-10-22T13:41:30-03:00"),
        ]}
      />,
    );
    expect(lines()).toEqual([
      "Criada por Admin em 21/10/2026 às 18:37.",
      "Habilitações atualizadas por Admin em 22/10/2026: 8 ações, das 13:35 às 13:41.",
    ]);
  });

  it("gives the single time when all the clearances in a row are in the same minute", () => {
    const clear = (s: number) => ({ kind: "CLEARANCE_UPDATED" as const, actorName: "Admin", createdAt: `2026-10-22T13:35:${s}-03:00`, changedFields: ["clearances"] });
    render(<AssessmentHistory events={[10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(clear)} />);
    expect(lines()).toEqual(["Habilitações atualizadas por Admin em 22/10/2026 às 13:35: 10 ações."]);
  });

  // SPEC-086 CA-06 (RN-05): another kind of event, another author or another day between two clearances ends the row, and the order holds.
  it("ends the row at another event, another author or another day, keeping the order of the lines", () => {
    const clear = (actorName: string, createdAt: string) => ({ kind: "CLEARANCE_UPDATED" as const, actorName, createdAt, changedFields: ["clearances"] });
    render(
      <AssessmentHistory
        events={[
          clear("Ana", "2026-10-22T09:00:00-03:00"),
          clear("Ana", "2026-10-22T09:01:00-03:00"),
          { kind: "UPDATED", actorName: "Ana", createdAt: "2026-10-22T09:02:00-03:00", changedFields: ["title"] },
          clear("Ana", "2026-10-22T09:03:00-03:00"),
          clear("Bruno", "2026-10-22T09:04:00-03:00"),
          clear("Bruno", "2026-10-22T09:05:00-03:00"),
          clear("Bruno", "2026-10-23T08:00:00-03:00"),
        ]}
      />,
    );
    expect(lines()).toEqual([
      "Habilitações atualizadas por Ana em 22/10/2026: 2 ações, das 09:00 às 09:01.",
      "Alterada por Ana em 22/10/2026 às 09:02: título.",
      "Habilitações atualizadas por Ana em 22/10/2026 às 09:03.",
      "Habilitações atualizadas por Bruno em 22/10/2026: 2 ações, das 09:04 às 09:05.",
      "Habilitações atualizadas por Bruno em 23/10/2026 às 08:00.",
    ]);
  });

  // SPEC-086 CA-03 (RN-01): an author with no name (a removed user) is told as such, in every kind of line, and never as a gap.
  it("says the user was removed when the name is empty", () => {
    render(
      <AssessmentHistory
        events={[
          { kind: "CREATED", actorName: "", createdAt: "2026-10-20T16:00:00-03:00" },
          { kind: "CANCELED", actorName: "", createdAt: "2026-10-20T17:00:00-03:00" },
          { kind: "CLEARANCE_UPDATED", actorName: "", createdAt: "2026-10-21T09:00:00-03:00", changedFields: ["clearances"] },
          { kind: "CLEARANCE_UPDATED", actorName: "", createdAt: "2026-10-21T09:05:00-03:00", changedFields: ["clearances"] },
        ]}
      />,
    );
    expect(lines()).toEqual([
      "Criada por Usuário removido em 20/10/2026 às 16:00.",
      "Cancelada por Usuário removido em 20/10/2026 às 17:00.",
      "Habilitações atualizadas por Usuário removido em 21/10/2026: 2 ações, das 09:00 às 09:05.",
    ]);
  });

  it("has a heading for the list, and says when there is nothing", () => {
    render(<AssessmentHistory events={[]} />);
    expect(screen.getByRole("heading", { name: "Histórico" })).toBeDefined();
    expect(screen.getByText("Nenhum registro ainda.")).toBeDefined();
  });
});
