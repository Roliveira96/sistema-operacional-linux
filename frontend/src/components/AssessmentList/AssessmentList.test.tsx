import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { summary } from "@/test/assessmentFixtures";
import { AssessmentList, type AssessmentListProps } from "./AssessmentList";

afterEach(cleanup);

const handlers = () => ({ onNew: vi.fn(), onRetry: vi.fn(), onView: vi.fn(), onEdit: vi.fn(), onPreview: vi.fn(), onReschedule: vi.fn(), onCancel: vi.fn() });

function setup(over: Partial<AssessmentListProps> = {}) {
  const h = handlers();
  const props: AssessmentListProps = {
    status: "ready",
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

// SPEC-075 CA-23.
describe("AssessmentList", () => {
  it("shows the kind, title, period, phase, maximum score, composition and eligible students of each assessment", () => {
    setup();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Tipo", "Modalidade", "Título", "Período", "Situação", "Nota máxima", "Composição", "Elegíveis", "Ações"]);
    const exam = within(rowOf("Prova 1: permissões")).getAllByRole("cell").map((c) => c.textContent);
    expect(exam.slice(0, 8)).toEqual(["Prova", "Presencial", "Prova 1: permissões", "23/10/2026, 09:00–11:00", "Agendada", "10,00", "Manual", "32"]);
    const task = within(rowOf("Trabalho em duplas")).getAllByRole("cell").map((c) => c.textContent);
    expect(task.slice(0, 8)).toEqual(["Atividade", "Online", "Trabalho em duplas", "26/10/2026 08:00 a 30/10/2026 23:59", "Agendada", "5,00", "Sorteio por nível", "4"]);
  });

  it("names each phase", () => {
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

  it("offers every action while the assessment is still ahead, and runs the one that is pressed", () => {
    const { onView, onEdit, onPreview, onReschedule, onCancel } = setup();
    const row = within(rowOf("Prova 1: permissões"));
    for (const name of ["Ver", "Editar", "Pré-visualizar", "Reagendar", "Cancelar"]) {
      expect((row.getByRole("button", { name: new RegExp(`^${name}`) }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(row.getByRole("button", { name: /^Ver/ }));
    fireEvent.click(row.getByRole("button", { name: /^Editar/ }));
    fireEvent.click(row.getByRole("button", { name: /^Pré-visualizar/ }));
    fireEvent.click(row.getByRole("button", { name: /^Reagendar/ }));
    fireEvent.click(row.getByRole("button", { name: /^Cancelar/ }));
    for (const fn of [onView, onEdit, onPreview, onReschedule, onCancel]) expect(fn).toHaveBeenCalledWith(expect.objectContaining({ id: "a-1" }));
  });

  it("disables an action the phase does not allow and says why, in text", () => {
    setup({
      items: [
        summary({ id: "a-2", title: "Passada", phase: "ENDED" }),
        summary({ id: "a-3", title: "Desfeita", status: "CANCELED", cancelReason: "Falta de energia" }),
      ],
    });
    const ended = within(rowOf("Passada"));
    const reschedule = ended.getByRole("button", { name: /^Reagendar/ }) as HTMLButtonElement;
    expect(reschedule.disabled).toBe(true);
    expect(ended.getByText("A avaliação já terminou.")).toBeDefined();
    expect(reschedule.getAttribute("aria-describedby")).toBe(ended.getByText("A avaliação já terminou.").id);
    expect((ended.getByRole("button", { name: /^Editar/ }) as HTMLButtonElement).disabled).toBe(false);

    const canceled = within(rowOf("Desfeita"));
    for (const name of ["Editar", "Reagendar", "Cancelar"]) {
      expect((canceled.getByRole("button", { name: new RegExp(`^${name}`) }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(canceled.getAllByText("A avaliação está cancelada.").length).toBeGreaterThan(0);
    // reading and previewing never stop
    expect((canceled.getByRole("button", { name: /^Ver/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((canceled.getByRole("button", { name: /^Pré-visualizar/ }) as HTMLButtonElement).disabled).toBe(false);
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
