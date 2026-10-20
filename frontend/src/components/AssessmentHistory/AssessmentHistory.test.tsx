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

  it("has a heading for the list, and says when there is nothing", () => {
    render(<AssessmentHistory events={[]} />);
    expect(screen.getByRole("heading", { name: "Histórico" })).toBeDefined();
    expect(screen.getByText("Nenhum registro ainda.")).toBeDefined();
  });
});
