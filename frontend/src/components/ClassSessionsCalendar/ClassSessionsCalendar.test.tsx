import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classroomService } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { scheduleService } from "@/services/scheduleService";
import { octoberCalendar, session } from "@/test/scheduleFixtures";
import { ClassSessionsCalendar } from "./ClassSessionsCalendar";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  push.mockClear();
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const calendar = vi.spyOn(scheduleService, "classCalendar").mockResolvedValue(octoberCalendar());
  const update = vi.spyOn(scheduleService, "updateSession").mockResolvedValue(session({ id: "s-26", date: "2026-10-26" }));
  const create = vi.spyOn(scheduleService, "createSession").mockResolvedValue(session({ id: "s-new", date: "2026-10-15" }));
  const revert = vi.spyOn(scheduleService, "revertSession").mockResolvedValue(session({ id: "s-21", date: "2026-10-21" }));
  render(<ClassSessionsCalendar classId="c-1" initialMonth={new Date(2026, 9, 1)} today={new Date(2026, 9, 13)} />);
  return { calendar, update, create, revert };
}

async function openDay(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name }));
}

// SPEC-044, section 3.1.2 (turma salva)
describe("ClassSessionsCalendar", () => {
  // CA-16
  it("shows the real calendar of the class with its holidays", async () => {
    const { calendar } = setup();
    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
    expect(calendar).toHaveBeenCalledWith("c-1", "2026-09-27", "2026-10-31");
    expect((await screen.findByRole("button", { name: /^segunda-feira, 12 de outubro/ })).getAttribute("aria-label")).toContain(
      "feriado: Nossa Senhora Aparecida",
    );
  });

  // CA-17
  it("cancels a lesson with a reason and loads the calendar again", async () => {
    const { calendar, update } = setup();
    await openDay(/^segunda-feira, 26 de outubro/);
    const panel = screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" });
    fireEvent.click(within(panel).getByRole("button", { name: "Alterar esta aula" }));
    const dialog = await screen.findByRole("dialog", { name: "Alterar a aula de 26/10/2026" });
    fireEvent.click(within(dialog).getByLabelText("Cancelada"));
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Viagem do professor" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alteração" }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.lastCall?.[0]).toBe("c-1");
    expect(update.mock.lastCall?.[1]).toBe("s-26");
    expect(update.mock.lastCall?.[2]).toMatchObject({ status: "CANCELED", reason: "Viagem do professor" });
    await waitFor(() => expect(calendar.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  // CA-17
  it("adjusts the time of a lesson", async () => {
    const { update } = setup();
    await openDay(/^segunda-feira, 26 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" })).getByRole("button", { name: "Alterar esta aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "11:20" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar alteração" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.lastCall?.[2]).toMatchObject({ status: "SCHEDULED", startTime: "08:20", endTime: "11:20" });
  });

  // CA-17
  it("reverts an adjusted lesson", async () => {
    const { revert } = setup();
    await openDay(/^quarta-feira, 21 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "quarta-feira, 21 de outubro de 2026" })).getByRole("button", { name: "Alterar esta aula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer alteração" }));
    await waitFor(() => expect(revert).toHaveBeenCalledWith("c-1", "s-21"));
  });

  // CA-18
  it("adds an extra lesson on the selected day", async () => {
    const { create, calendar } = setup();
    await openDay(/^quinta-feira, 15 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "quinta-feira, 15 de outubro de 2026" })).getByRole("button", { name: "Incluir aula avulsa" }));
    const dialog = await screen.findByRole("dialog", { name: "Incluir aula avulsa" });
    expect((within(dialog).getByLabelText("Data") as HTMLInputElement).value).toBe("2026-10-15");
    fireEvent.click(within(dialog).getByRole("button", { name: "Incluir aula" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.lastCall?.[0]).toBe("c-1");
    expect(create.mock.lastCall?.[1]).toMatchObject({ date: "2026-10-15" });
    await waitFor(() => expect(calendar.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  // CA-20
  it("has no buttons for events or special periods", async () => {
    setup();
    await openDay(/^segunda-feira, 26 de outubro/);
    expect(screen.queryByRole("button", { name: "Incluir evento" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selecionar período" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desfazer período" })).toBeNull();
  });

  it("loads again when the reload key changes", async () => {
    const calendar = vi.spyOn(scheduleService, "classCalendar").mockResolvedValue(octoberCalendar());
    const { rerender } = render(<ClassSessionsCalendar classId="c-1" initialMonth={new Date(2026, 9, 1)} reloadKey={0} />);
    await screen.findByRole("heading", { name: "outubro de 2026" });
    const before = calendar.mock.calls.length;
    rerender(<ClassSessionsCalendar classId="c-1" initialMonth={new Date(2026, 9, 1)} reloadKey={1} />);
    await waitFor(() => expect(calendar.mock.calls.length).toBeGreaterThan(before));
  });

  // SPEC-053 CA-09: the content of each lesson, from the Horários tab
  it("edits the content of a lesson in a dialog, saves it and loads the calendar again", async () => {
    const { calendar } = setup();
    vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    vi.spyOn(classroomService, "listDecks").mockResolvedValue([]);
    vi.spyOn(scheduleService, "getSessionContent").mockResolvedValue({ links: [] });
    const save = vi.spyOn(scheduleService, "saveSessionContent").mockResolvedValue({ links: [] });
    await openDay(/^segunda-feira, 26 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" })).getByRole("button", { name: "Conteúdo da aula" }));
    const dialog = await screen.findByRole("dialog", { name: "Conteúdo da aula de 26/10/2026" });
    const before = calendar.mock.calls.length;
    fireEvent.change(within(dialog).getByLabelText("Tema"), { target: { value: "Permissões" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("c-1", "s-26", expect.objectContaining({ topic: "Permissões" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conteúdo da aula de 26/10/2026" })).toBeNull());
    await waitFor(() => expect(calendar.mock.calls.length).toBeGreaterThan(before));
  });

  // SPEC-053 CA-11: start the live class from the lesson of the day
  it("starts the live class from the lesson, tied to it, and goes to the room", async () => {
    setup();
    const start = vi.spyOn(classroomService, "startSession").mockResolvedValue({
      id: "r-1", classId: "c-1", title: "Sistemas Operacionais", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "",
    });
    await openDay(/^segunda-feira, 26 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" })).getByRole("button", { name: "Iniciar aula ao vivo" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", { title: "Sistemas Operacionais", classSessionId: "s-26" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/classes/c-1/live"));
  });

  it("tells when the live class could not be started and stays where it is", async () => {
    setup();
    vi.spyOn(classroomService, "startSession").mockRejectedValue(new Error("boom"));
    await openDay(/^segunda-feira, 26 de outubro/);
    fireEvent.click(within(screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" })).getByRole("button", { name: "Iniciar aula ao vivo" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Não foi possível iniciar a aula.");
    expect(push).not.toHaveBeenCalled();
  });
});
