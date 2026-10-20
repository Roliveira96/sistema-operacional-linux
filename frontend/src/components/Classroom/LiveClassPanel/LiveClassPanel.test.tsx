import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isoDate } from "@/lib/calendar";
import { classroomService, type ActiveRoom, type LiveSession, type LiveSessionSummary } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import { scheduleService } from "@/services/scheduleService";
import { readPdfInfo } from "../SlidePresenter/pdfRenderer";
import { LiveClassPanel } from "./LiveClassPanel";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../SlidePresenter/pdfRenderer", () => ({ readPdfInfo: vi.fn() }));
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: (p: { sessionId: string }) => React.createElement("div", { "data-testid": "notes", "data-session": p.sessionId }) };
});

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.restoreAllMocks();
  vi.mocked(readPdfInfo).mockReset();
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T13:30:00Z" };
const active = (): ActiveRoom => ({ hasActiveSession: true, session, displayMode: "SLIDES", currentSlide: 1, activeDeck: null, recentDrawings: [], terminal: { screen: null }, handRaises: [], onlineCount: 1 });
const past: LiveSessionSummary[] = [
  { id: "s-0", title: "Introdução", status: "FINISHED", startedAt: "2026-10-07T13:00:00Z", endedAt: "2026-10-07T14:40:00Z", durationMinutes: 100, hasNotes: true },
  { id: "s--1", title: "Revisão", status: "FINISHED", startedAt: "2026-09-30T13:00:00Z", endedAt: "2026-09-30T13:50:00Z", durationMinutes: 50, hasNotes: false },
];

function setup(role: "teacher" | "student", over: { room?: ActiveRoom; list?: LiveSessionSummary[]; archived?: boolean } = {}) {
  vi.spyOn(classroomService, "getActive").mockResolvedValue(over.room ?? { hasActiveSession: false });
  vi.spyOn(classroomService, "listSessions").mockResolvedValue(over.list ?? []);
  vi.spyOn(scheduleService, "classCalendar").mockResolvedValue({
    classes: [], events: [], periods: [], holidays: [], meetings: [], assessments: [],
    sessions: [
      { id: "cs-1", classId: "c-1", date: isoDate(new Date()), startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON", status: "SCHEDULED", origin: "WEEKLY", overridden: false, onHoliday: false },
      { id: "cs-2", classId: "c-1", date: isoDate(new Date()), startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON", status: "CANCELED", origin: "WEEKLY", overridden: true, onHoliday: false },
    ],
  });
  return render(<LiveClassPanel classId="c-1" role={role} archived={over.archived ?? false} />);
}

// SPEC-051 CA-18 and CA-01
describe("LiveClassPanel", () => {
  it("shows the teacher the form to start a class when there is none", async () => {
    setup("teacher");
    expect(await screen.findByRole("heading", { name: "Aula ao vivo" })).toBeDefined();
    expect(await screen.findByLabelText("Título da aula")).toBeDefined();
    expect(screen.getByRole("button", { name: "Iniciar aula" })).toBeDefined();
    expect(screen.getByLabelText("Apresentação em PDF (opcional)")).toBeDefined();
  });

  it("tells the student that there is no class", async () => {
    setup("student");
    expect(await screen.findByText("Nenhuma aula em andamento.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Iniciar aula" })).toBeNull();
  });

  it("does not offer to start a class in an archived one", async () => {
    setup("teacher", { archived: true });
    expect(await screen.findByText("Turma arquivada: não é possível iniciar uma aula.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Iniciar aula" })).toBeNull();
  });

  it("asks for the title before starting", async () => {
    setup("teacher");
    const start = vi.spyOn(classroomService, "startSession");
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar aula" }));
    const title = screen.getByLabelText("Título da aula");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Informe o título da aula.")).toBeDefined();
    expect(start).not.toHaveBeenCalled();
  });

  // CA-01: any time of the day, linked or not to the lesson of the day
  it("starts the class and goes to the room", async () => {
    setup("teacher");
    const start = vi.spyOn(classroomService, "startSession").mockResolvedValue(session);
    fireEvent.change(await screen.findByLabelText("Título da aula"), { target: { value: "  Permissões  " } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar aula" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", { title: "Permissões" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/classes/c-1/live"));
  });

  it("offers the lessons of the day that are not canceled, and links the class to the chosen one", async () => {
    setup("teacher");
    const start = vi.spyOn(classroomService, "startSession").mockResolvedValue(session);
    const select = (await screen.findByLabelText("Aula agendada (opcional)")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    expect(select.options[0]!.textContent).toBe("Nenhuma (aula avulsa)");
    expect(select.options[1]!.textContent).toBe("08:20 às 10:00");
    fireEvent.change(select, { target: { value: "cs-1" } });
    fireEvent.change(screen.getByLabelText("Título da aula"), { target: { value: "Aula" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar aula" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", { title: "Aula", classSessionId: "cs-1" }));
  });

  it("reads the PDF in the browser, sends it with the page count and starts with it", async () => {
    setup("teacher");
    vi.mocked(readPdfInfo).mockResolvedValue({ pageCount: 12 });
    const upload = vi.spyOn(classroomService, "uploadDeck").mockResolvedValue({ id: "d-1", title: "Aula", pageCount: 12, downloadUrl: "u" });
    const start = vi.spyOn(classroomService, "startSession").mockResolvedValue(session);
    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Título da aula"), { target: { value: "Aula" } });
    fireEvent.change(screen.getByLabelText("Apresentação em PDF (opcional)"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar aula" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("c-1", file, "Aula", 12));
    await waitFor(() => expect(start).toHaveBeenCalledWith("c-1", { title: "Aula", deckId: "d-1" }));
  });

  it("refuses what is not a PDF, a PDF it cannot read and one with more than 100 pages", async () => {
    setup("teacher");
    const upload = vi.spyOn(classroomService, "uploadDeck");
    const input = await screen.findByLabelText("Apresentação em PDF (opcional)");
    fireEvent.change(input, { target: { files: [new File(["x"], "foto.png", { type: "image/png" })] } });
    expect(await screen.findByText("Escolha um arquivo PDF.")).toBeDefined();

    vi.mocked(readPdfInfo).mockRejectedValueOnce(new Error("password"));
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Não foi possível ler o PDF. Ele pode estar corrompido ou protegido por senha.")).toBeDefined();

    vi.mocked(readPdfInfo).mockResolvedValueOnce({ pageCount: 101 });
    fireEvent.change(input, { target: { files: [new File(["%PDF"], "b.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("O PDF pode ter até 100 páginas.")).toBeDefined();

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(25 * 1024 * 1024 + 1)], "c.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("O PDF pode ter até 25 MB.")).toBeDefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the problems of the server", async () => {
    setup("teacher");
    vi.mocked(readPdfInfo).mockResolvedValue({ pageCount: 3 });
    vi.spyOn(classroomService, "uploadDeck").mockRejectedValue(new ApiProblemError({ type: "deck-limit-exceeded", status: 409 }, 409));
    fireEvent.change(await screen.findByLabelText("Título da aula"), { target: { value: "Aula" } });
    fireEvent.change(screen.getByLabelText("Apresentação em PDF (opcional)"), { target: { files: [new File(["%PDF"], "a.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar aula" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Esta turma já tem 100 apresentações.");

    vi.spyOn(classroomService, "startSession").mockRejectedValue(new ApiProblemError({ type: "class-archived", status: 409 }, 409));
    fireEvent.change(screen.getByLabelText("Apresentação em PDF (opcional)"), { target: { files: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar aula" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Turma arquivada: não é possível iniciar uma aula."));
  });

  // CA-18, CA-12
  it("shows the class in progress, with enter for the student", async () => {
    setup("student", { room: active() });
    expect(await screen.findByText("Em andamento: Permissões")).toBeDefined();
    const enter = screen.getByRole("link", { name: "Entrar na aula" });
    expect(enter.getAttribute("href")).toBe("/app/classes/c-1/live");
    expect(screen.queryByRole("button", { name: "Encerrar aula" })).toBeNull();
  });

  it("shows the teacher the way back to the class and the end, after confirming", async () => {
    setup("teacher", { room: active() });
    const end = vi.spyOn(classroomService, "endSession").mockResolvedValue({ id: "s-1", status: "FINISHED", endedAt: "x" });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect((await screen.findByRole("link", { name: "Voltar para a aula" })).getAttribute("href")).toBe("/app/classes/c-1/live");
    expect(screen.queryByRole("button", { name: "Iniciar aula" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
    expect(end).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    vi.mocked(classroomService.getActive).mockResolvedValue({ hasActiveSession: false });
    fireEvent.click(screen.getByRole("button", { name: "Encerrar aula" }));
    await waitFor(() => expect(end).toHaveBeenCalledWith("c-1", "s-1"));
    expect(await screen.findByRole("button", { name: "Iniciar aula" })).toBeDefined();
  });

  it("lists the previous classes with date and duration", async () => {
    setup("teacher", { list: past });
    const list = await screen.findByRole("list", { name: "Aulas anteriores" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Introdução");
    expect(items[0]!.textContent).toContain("07/10/2026");
    expect(items[0]!.textContent).toContain("100 min");
    expect(screen.queryByRole("button", { name: "Ver minhas anotações" })).toBeNull();
  });

  it("says when there is no previous class", async () => {
    setup("student");
    expect(await screen.findByText("Nenhuma aula anterior.")).toBeDefined();
  });

  it("lets a student open his own notes of a class that has them", async () => {
    setup("student", { list: past });
    const open = await screen.findByRole("button", { name: "Ver minhas anotações" });
    expect(screen.getAllByRole("button", { name: "Ver minhas anotações" })).toHaveLength(1);
    fireEvent.click(open);
    expect(screen.getByTestId("notes").getAttribute("data-session")).toBe("s-0");
    fireEvent.click(screen.getByRole("button", { name: "Fechar anotações" }));
    expect(screen.queryByTestId("notes")).toBeNull();
  });

  it("says when it cannot load, and tries again", async () => {
    const getActive = vi.spyOn(classroomService, "getActive").mockRejectedValueOnce(new Error("down")).mockResolvedValue({ hasActiveSession: false });
    vi.spyOn(classroomService, "listSessions").mockResolvedValue([]);
    vi.spyOn(scheduleService, "classCalendar").mockResolvedValue({ classes: [], sessions: [], events: [], periods: [], holidays: [], meetings: [], assessments: [] });
    render(<LiveClassPanel classId="c-1" role="student" archived={false} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Não foi possível carregar a aula ao vivo.");
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Nenhuma aula em andamento.")).toBeDefined();
    expect(getActive).toHaveBeenCalledTimes(2);
  });
});
