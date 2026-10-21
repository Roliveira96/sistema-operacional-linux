import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summary } from "@/test/assessmentFixtures";
import { AssessmentList, type AssessmentListProps } from "./AssessmentList";

afterEach(cleanup);

const handlers = () => ({ onNew: vi.fn(), onRetry: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn() });

function setup(over: Partial<AssessmentListProps> = {}) {
  const h = handlers();
  const props: AssessmentListProps = {
    status: "ready",
    hrefOf: (a) => `/app/classes/c-1/assessments/${a.id}`,
    items: [
      summary({ id: "a-1", title: "Prova 1: permissões" }),
      summary({
        id: "a-2",
        title: "Trabalho em duplas",
        type: "ASSIGNMENT",
        composition: "DRAW",
        startsAt: "2026-10-26T08:00:00-03:00",
        endsAt: "2026-10-30T23:59:00-03:00",
        durationMinutes: undefined,
        modality: "ONLINE",
        requiresClearance: false,
        maxScore: 5,
        eligibleStudents: 4,
        audience: "SELECTED",
      }),
    ],
    ...h,
    ...over,
  };
  return { ...render(<AssessmentList {...props} />), ...h };
}

const rowOf = (title: string) => screen.getByRole("row", { name: new RegExp(title) });

// SPEC-075 CA-23, as the list is shown after SPEC-080: five columns, the title is the link, and Editar is in view.
describe("AssessmentList", () => {
  it("shows the assessment, the period, the situation and the students of each one, in five columns", () => {
    setup();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Avaliação", "Período", "Situação", "Alunos", "Ações"]);
    const exam = within(rowOf("Prova 1: permissões")).getAllByRole("cell");
    expect(exam[0]!.textContent).toContain("Prova 1: permissões");
    expect(within(exam[0]!).getByText("Prova · Presencial · 10,00 pontos")).toBeDefined();
    expect(exam.slice(1, 4).map((c) => c.textContent)).toEqual(["23/10/2026, 09:00–11:00", "Agendada", "32"]);

    const task = within(rowOf("Trabalho em duplas")).getAllByRole("cell");
    expect(within(task[0]!).getByText("Atividade · Online · 5,00 pontos")).toBeDefined();
    expect(task.slice(1, 4).map((c) => c.textContent)).toEqual(["26/10/2026 08:00 a 30/10/2026 23:59", "Agendada", "4"]);
  });

  it("does not show the composition in the list", () => {
    setup();
    expect(screen.queryByRole("columnheader", { name: "Composição" })).toBeNull();
    expect(screen.queryByText("Sorteio por nível")).toBeNull();
    expect(screen.queryByText("Manual")).toBeNull();
  });

  it("makes the title the link to the assessment, and strikes it through when it is canceled", () => {
    setup({ items: [summary({ id: "a-1", title: "Prova 1: permissões" }), summary({ id: "a-3", title: "Desfeita", status: "CANCELED", cancelReason: "Falta de energia" })] });
    expect(screen.getByRole("link", { name: "Prova 1: permissões" }).getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
    const canceled = screen.getByRole("link", { name: "Desfeita" });
    expect(canceled.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-3");
    expect(canceled.querySelector("s")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Ver/ })).toBeNull();
  });

  it("names each situation on the row, and puts each assessment in its section", () => {
    setup({
      items: [
        summary({ id: "a-1", title: "Em curso", phase: "RUNNING" }),
        summary({ id: "a-2", title: "Passada", phase: "ENDED" }),
        summary({ id: "a-3", title: "Desfeita", status: "CANCELED", phase: "UPCOMING", cancelReason: "Falta de energia" }),
      ],
    });
    expect(within(rowOf("Em curso")).getByText("Em andamento")).toBeDefined();
    expect(within(rowOf("Passada")).getByText("Encerrada")).toBeDefined();
    expect(within(rowOf("Desfeita")).getByText("Cancelada")).toBeDefined();
  });

  it("keeps Editar in view, and runs it", () => {
    const { onEdit } = setup();
    const edit = within(rowOf("Prova 1: permissões")).getByRole("button", { name: "Editar Prova 1: permissões" }) as HTMLButtonElement;
    expect(edit.disabled).toBe(false);
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
  });

  it("disables Editar in a canceled assessment and says why, in text tied to the button", () => {
    setup({ items: [summary({ id: "a-3", title: "Desfeita", status: "CANCELED", cancelReason: "Falta de energia" })] });
    const row = within(rowOf("Desfeita"));
    const edit = row.getByRole("button", { name: "Editar Desfeita" }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    const reason = row.getByText("A avaliação está cancelada.");
    expect(edit.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("keeps Editar on in an ended assessment, which only cannot be rescheduled", () => {
    setup({ items: [summary({ id: "a-2", title: "Passada", phase: "ENDED" })] });
    expect((within(rowOf("Passada")).getByRole("button", { name: "Editar Passada" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(rowOf("Passada")).getByText("A avaliação já terminou.")).toBeDefined();
  });

  it("has the button of a new assessment at the top", () => {
    const { onNew } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Nova avaliação" }));
    expect(onNew).toHaveBeenCalled();
  });

  it("says it is loading", () => {
    setup({ status: "loading", items: [] });
    expect(screen.getByRole("status").textContent).toBe("Carregando avaliações…");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says there is none, with the way to make the first", () => {
    setup({ items: [] });
    expect(screen.getByText("Nenhuma avaliação agendada")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Nova avaliação" })).toBeDefined();
  });

  it("says it failed and tries again", () => {
    const { onRetry } = setup({ status: "error", items: [] });
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar as avaliações.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
