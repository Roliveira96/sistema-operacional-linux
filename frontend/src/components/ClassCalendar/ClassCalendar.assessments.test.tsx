import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarAssessment } from "@/test/assessmentFixtures";
import { octoberCalendar } from "@/test/scheduleFixtures";
import type { CalendarAssessment } from "@/services/assessmentService";
import { ClassCalendar, type ClassCalendarProps } from "./ClassCalendar";

afterEach(cleanup);

const today = new Date(2026, 9, 13);

// The exam of Friday the 23rd, the assignment of the 26th to the 28th, the lesson of the 14th that became an exam, and the lesson of the 28th
// whose assessment was canceled.
const assessments = (teacher: boolean): CalendarAssessment[] => {
  const extra = teacher ? { eligibleStudents: 32, composition: "MANUAL" as const } : {};
  return [
    calendarAssessment({ id: "a-1", title: "Prova 1", ...extra }),
    calendarAssessment({ id: "a-2", title: "Trabalho em duplas", type: "ASSIGNMENT", startsAt: "2026-10-26T08:00:00-03:00", endsAt: "2026-10-28T23:59:00-03:00", durationMinutes: undefined, maxScore: 5, ...extra }),
    calendarAssessment({ id: "a-3", title: "Prova da unidade 1", classSessionId: "s-14", startsAt: "2026-10-14T13:50:00-03:00", endsAt: "2026-10-14T15:30:00-03:00", ...extra }),
    calendarAssessment({ id: "a-4", title: "Prova de reposição", classSessionId: "s-28", status: "CANCELED", cancelReason: "Falta de energia", startsAt: "2026-10-28T13:50:00-03:00", endsAt: "2026-10-28T15:30:00-03:00", ...extra }),
  ];
};

function setup(overrides: Partial<ClassCalendarProps> = {}, teacher = true) {
  const load = vi.fn().mockResolvedValue({ ...octoberCalendar(), assessments: assessments(teacher) });
  render(<ClassCalendar load={load} initialMonth={new Date(2026, 9, 1)} today={today} {...overrides} />);
}

const day = (name: RegExp) => screen.findByRole("button", { name });
const panel = (name: string) => screen.getByRole("region", { name });

// SPEC-075 CA-27, D-09: the assessments in the calendar.
describe("ClassCalendar with assessments", () => {
  it("marks the day of an exam, and each day of an assignment, in the cell and in its name", async () => {
    setup();
    const friday = await day(/^sexta-feira, 23 de outubro/);
    expect(friday.getAttribute("aria-label")).toContain("prova: Prova 1");
    expect(within(friday).getByText("Prova 1")).toBeDefined();
    for (const name of [/^segunda-feira, 26 de outubro/, /^terça-feira, 27 de outubro/, /^quarta-feira, 28 de outubro/]) {
      expect((await day(name)).getAttribute("aria-label")).toContain("atividade: Trabalho em duplas");
    }
    expect((await day(/^quinta-feira, 29 de outubro/)).getAttribute("aria-label")).not.toContain("Trabalho em duplas");
  });

  it("shows the card of the assessment in the panel of the day, with the label, title, time, duration and maximum score", async () => {
    setup();
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    const card = within(panel("sexta-feira, 23 de outubro de 2026"));
    expect(card.getByText("Prova")).toBeDefined();
    expect(card.getByText("Prova 1")).toBeDefined();
    expect(card.getByText("09:00–11:00")).toBeDefined();
    expect(card.getByText("Duração: 60 minutos")).toBeDefined();
    expect(card.getByText("Nota máxima: 10,00")).toBeDefined();
    expect(card.getByText("Agendada")).toBeDefined();
  });

  it("gives the teacher the count of eligible students and the composition, and gives the student only what is public", async () => {
    setup();
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    expect(screen.getByText("32 alunos elegíveis")).toBeDefined();
    expect(screen.getByText("Composição: Manual")).toBeDefined();
    cleanup();

    setup({}, false);
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    expect(within(panel("sexta-feira, 23 de outubro de 2026")).getByText("Prova 1")).toBeDefined();
    expect(screen.queryByText(/alunos elegíveis/)).toBeNull();
    expect(screen.queryByText(/Composição/)).toBeNull();
  });

  it("writes the whole period of an assignment, and says it uses the period when it has no duration", async () => {
    setup();
    fireEvent.click(await day(/^terça-feira, 27 de outubro/));
    const card = within(panel("terça-feira, 27 de outubro de 2026"));
    expect(card.getByText("26/10/2026 08:00 a 28/10/2026 23:59")).toBeDefined();
    expect(card.getByText("Atividade")).toBeDefined();
    expect(card.getByText("Duração: o período inteiro")).toBeDefined();
  });

  it("shows the canceled one with the title struck out, a banner and the reason", async () => {
    setup();
    fireEvent.click(await day(/^quarta-feira, 28 de outubro/));
    const card = within(panel("quarta-feira, 28 de outubro de 2026"));
    expect(card.getByText("Prova de reposição").closest("s")).not.toBeNull();
    expect(card.getByText("Avaliação cancelada")).toBeDefined();
    expect(card.getByText("Falta de energia")).toBeDefined();
  });

  it("shows one card only for a lesson that became an assessment: the card of the assessment, and not the one of the lesson", async () => {
    setup({ editable: true, onEditSession: vi.fn() });
    const fourteenth = await day(/^quarta-feira, 14 de outubro/);
    expect(fourteenth.getAttribute("aria-label")).toContain("prova: Prova da unidade 1");
    expect(fourteenth.getAttribute("aria-label")).not.toMatch(/\d aula/);
    fireEvent.click(fourteenth);
    const card = within(panel("quarta-feira, 14 de outubro de 2026"));
    expect(card.getByText("Prova da unidade 1")).toBeDefined();
    expect(card.queryByText(/Sistemas Operacionais/)).toBeNull();
    expect(card.queryByRole("button", { name: "Alterar esta aula" })).toBeNull();
  });

  it("brings the card of the lesson back when its assessment is canceled", async () => {
    setup({ editable: true, onEditSession: vi.fn() });
    fireEvent.click(await day(/^quarta-feira, 28 de outubro/));
    const card = within(panel("quarta-feira, 28 de outubro de 2026"));
    expect(card.getByText("Prova de reposição")).toBeDefined();
    expect(card.getByText(/Sistemas Operacionais/)).toBeDefined();
    expect(card.getByRole("button", { name: "Alterar esta aula" })).toBeDefined();
  });

  it("shows no card to who is not eligible, because the server sends none", async () => {
    setup({ load: vi.fn().mockResolvedValue(octoberCalendar()) });
    const friday = await day(/^sexta-feira, 23 de outubro/);
    expect(friday.getAttribute("aria-label")).not.toMatch(/prova|atividade/);
    fireEvent.click(friday);
    expect(screen.getByText("Nenhuma aula ou evento neste dia.")).toBeDefined();
  });

  it("does not say the day is empty when it only has an assessment", async () => {
    setup();
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    expect(screen.queryByText("Nenhuma aula ou evento neste dia.")).toBeNull();
  });

  it("links the card to the assessment when it is given where it lives", async () => {
    setup({ assessmentHref: (a) => `/app/classes/${a.classId}/assessments/${a.id}` });
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    const link = within(panel("sexta-feira, 23 de outubro de 2026")).getByRole("link", { name: "Ver avaliação Prova 1" });
    expect(link.getAttribute("href")).toBe("/app/classes/c-1/assessments/a-1");
  });

  it("has no link when it is not told where the assessment lives", async () => {
    setup();
    fireEvent.click(await day(/^sexta-feira, 23 de outubro/));
    expect(within(panel("sexta-feira, 23 de outubro de 2026")).queryByRole("link", { name: /Ver avaliação/ })).toBeNull();
  });
});
