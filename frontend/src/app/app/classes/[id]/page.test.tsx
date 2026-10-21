import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { classService, type ClassGroup, type ClassMember } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import { classroomService } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { scheduleService, startLiveFromSession } from "@/services/scheduleService";
import ClassPage from "./page";

const replaceMock = vi.fn();
const pushMock = vi.hoisted(() => vi.fn());
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/scheduleService", async () => {
  const { octoberCalendar } = await import("@/test/scheduleFixtures");
  return {
    scheduleService: {
      classCalendar: vi.fn().mockResolvedValue(octoberCalendar()),
      updateSession: vi.fn().mockResolvedValue({}),
      revertSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
      applyPeriod: vi.fn(),
      deletePeriod: vi.fn(),
      getSessionContent: vi.fn().mockResolvedValue({ links: [] }),
      saveSessionContent: vi.fn().mockResolvedValue({ links: [] }),
      // SPEC-073: the timeline and the diary under the calendar
      timeline: vi.fn().mockResolvedValue({ now: "2026-10-13T10:00:00-03:00", current: null, past: [], upcoming: [], liveSessionId: null }),
      getDiary: vi.fn().mockResolvedValue({ session: {}, content: { links: [] }, liveSessions: [] }),
    },
    startLiveFromSession: vi.fn().mockResolvedValue({ id: "r-1" }),
  };
});
vi.mock("@/components/Classroom/LiveClassPanel/LiveClassPanel", async () => {
  const React = await import("react");
  return {
    LiveClassPanel: (p: { classId: string; role: string; archived: boolean }) =>
      React.createElement("div", { "data-testid": "live-panel", "data-class": p.classId, "data-role": p.role, "data-archived": String(p.archived) }),
  };
});
vi.mock("@/services/studentService", () => ({
  listStudents: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, perPage: 20 }),
  createStudentManual: vi.fn(),
  importStudentsCSV: vi.fn(),
}));

function asRole(role: "TEACHER" | "STUDENT") {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: "u-1", email: "u@x.br", role, status: "ACTIVE", mustChangePassword: false, sessionCreatedAt: "", sessionExpiresAt: "" },
    refresh: vi.fn(),
    logout: vi.fn(),
  });
}

const theClass: ClassGroup = {
  id: "c-1",
  teacherId: "u-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  summary: "Linux na prática, do shell ao kernel.",
  syllabus: "<p>Processos e <strong>threads</strong></p>",
  institutionalGuidelines: "",
  startDate: new Date(2026, 7, 1).toISOString(),
  endDate: new Date(2026, 11, 1, 23, 59, 59).toISOString(),
  scheduleDescription: "Segundas, 08:20",
  enableVirtualClassroom: false,
  enableInviteLink: false,
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "",
  updatedAt: "",
};

const member: ClassMember = {
  id: "m-1",
  classId: "c-1",
  userId: "s-1",
  userName: "Ana Lima",
  userEmail: "ana@x.br",
  status: "ACTIVE",
  origin: "DIRECT_BY_TEACHER",
  requestedAt: "",
};

const params = Promise.resolve({ id: "c-1" });

beforeEach(() => {
  searchParams = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replaceMock.mockClear();
});

describe("ClassPage (SPEC-041)", () => {
  // CA-10 and the overview of the teacher
  it("shows the header with the summary and the overview to the teacher", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    render(<ClassPage params={params} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Sistemas Operacionais" })).toBeDefined();
    expect(screen.getByText("Linux na prática, do shell ao kernel.")).toBeDefined();
    expect(screen.getByRole("tab", { name: "Visão geral" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("threads")).toBeDefined();
    expect(screen.getByText("01/08/2026 a 01/12/2026")).toBeDefined();
    expect(screen.getAllByText("Não informado").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Configurações" }).getAttribute("href")).toBe("/app/classes/c-1/settings");
  });

  // CA-02
  it("shows the empty state with the three paths when the class has no members", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=students");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    expect(await screen.findByText(/Esta turma ainda não tem estudantes/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Selecionar estudantes cadastrados" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cadastrar novo estudante" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Importar CSV" })).toBeDefined();
    // The invite card is on the same tab, so the query is narrowed to the text of the empty state.
    expect(screen.getByText(/compartilhe o link de convite/i)).toBeDefined();
  });

  // CA-01: the message after creating, and the main action of the students tab
  it("welcomes a new class and opens the dialog to add students", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=students&created=1");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    render(<ClassPage params={params} />);

    expect(await screen.findByText("Turma criada. Agora adicione os estudantes.")).toBeDefined();
    expect(screen.getByText("Ana Lima")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar estudantes" }));
    expect(screen.getByRole("dialog", { name: /Adicionar estudantes/ })).toBeDefined();
  });

  // SPEC-078 CA-02: the confirmation after saving the settings is shown once, and the address is cleaned so a reload does not show it again.
  it("confirms that the settings were saved, once, and takes the mark out of the address", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("saved=1");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    expect((await screen.findByText("Configurações salvas.")).closest("[role=status]")).not.toBeNull();
    expect(replaceMock).toHaveBeenCalledWith("/app/classes/c-1", { scroll: false });
  });

  it("keeps the tab in the address when it takes the saved mark out", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=students&saved=1");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    expect(await screen.findByText("Configurações salvas.")).toBeDefined();
    expect(replaceMock).toHaveBeenCalledWith("/app/classes/c-1?tab=students", { scroll: false });
  });

  it("does not confirm anything when the class was not just saved", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);
    await screen.findByRole("heading", { name: theClass.name });
    expect(screen.queryByText("Configurações salvas.")).toBeNull();
  });

  // SPEC-078 CA-11: the summary is formatted text, shown with its formatting on the page of the class.
  it("shows the summary with its formatting", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue({ ...theClass, summary: '<p>Use <code>ls -l</code> e leia <a href="https://utfpr.edu.br">o plano</a>.</p>' });
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    const { container } = render(<ClassPage params={params} />);

    await screen.findByRole("heading", { name: theClass.name });
    expect(container.querySelector("code")?.textContent).toBe("ls -l");
    expect(screen.getByRole("link", { name: "o plano" }).getAttribute("href")).toBe("https://utfpr.edu.br");
    expect(container.textContent).not.toContain("<code>");
  });

  it("changes the tab in the address", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Estudantes" }));
    expect(replaceMock).toHaveBeenCalledWith("/app/classes/c-1?tab=students", { scroll: false });
  });

  // CA-13
  it("shows only the presentation of the class to an enrolled student", async () => {
    asRole("STUDENT");
    const getClass = vi.spyOn(classService, "getClass");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id,
      name: theClass.name,
      courseCode: theClass.courseCode,
      semester: theClass.semester,
      status: theClass.status,
      summary: theClass.summary ?? "",
      syllabus: theClass.syllabus ?? "",
      institutionalGuidelines: "",
      startDate: theClass.startDate,
      endDate: theClass.endDate,
      scheduleDescription: theClass.scheduleDescription ?? "",
      enableVirtualClassroom: false,
      teacherName: "Profa. Sediane",
    });
    render(<ClassPage params={params} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Sistemas Operacionais" })).toBeDefined();
    expect(screen.getByText("threads")).toBeDefined();
    expect(screen.getByText(/Profa. Sediane/)).toBeDefined();
    // SPEC-042 gives the student the "Agenda" tab; the students tab stays for the teacher only.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Visão geral", "Agenda"]);
    expect(screen.queryByRole("tab", { name: /Estudantes/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar estudantes" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Configurações" })).toBeNull();
    expect(getClass).not.toHaveBeenCalled();
  });

  it("explains when the class is not found", async () => {
    asRole("STUDENT");
    vi.spyOn(classService, "getMyClass").mockRejectedValue(new ApiProblemError({ type: "class-not-found", status: 404 }, 404));
    render(<ClassPage params={params} />);
    expect(await screen.findByText(/Turma não encontrada/)).toBeDefined();
  });

  it("offers to try again after a network error", async () => {
    asRole("TEACHER");
    const getClass = vi.spyOn(classService, "getClass").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<ClassPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(getClass).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { level: 1, name: "Sistemas Operacionais" })).toBeDefined();
  });

  // SPEC-042, section 3.1.4: the "Agenda" tab with the calendar of the class.
  it("shows the calendar of the class on the Agenda tab, editable by the teacher", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    render(<ClassPage params={params} />);
    expect((await screen.findByRole("tab", { name: "Agenda" })).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("button", { name: "Selecionar período" })).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ }));
    fireEvent.click(screen.getByRole("button", { name: "Alterar esta aula" }));
    expect(screen.getByRole("dialog", { name: "Alterar a aula de 19/10/2026" })).toBeDefined();
    expect(screen.getByText("O estudante ativo receberá um e-mail.")).toBeDefined();
  });

  it("shows the calendar read-only to a student", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    render(<ClassPage params={params} />);
    expect(await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Selecionar período" })).toBeNull();
  });

  // SPEC-048 CA-09 and CA-10: the links of the class on the overview
  it("shows the links section with the form to the teacher and read-only to the student", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    const getLinks = vi.spyOn(classService, "getLinks").mockResolvedValue([{ id: "l-1", name: "Link do Meet", url: "https://meet.google.com/abc", position: 0 }]);
    render(<ClassPage params={params} />);
    expect(await screen.findByRole("heading", { name: "Links da turma" })).toBeDefined();
    expect(getLinks).toHaveBeenCalledWith("c-1");
    expect(await screen.findByRole("button", { name: "Adicionar link" })).toBeDefined();
    cleanup();

    asRole("STUDENT");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id,
      name: theClass.name,
      courseCode: theClass.courseCode,
      semester: theClass.semester,
      status: theClass.status,
      summary: "",
      syllabus: "",
      institutionalGuidelines: "",
      startDate: theClass.startDate,
      endDate: theClass.endDate,
      scheduleDescription: "",
      enableVirtualClassroom: false,
      teacherName: "Profa. Sediane",
    });
    render(<ClassPage params={params} />);
    expect(await screen.findByRole("link", { name: /Link do Meet/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Adicionar link" })).toBeNull();
  });

  // SPEC-048 CA-09: an archived class only shows the links
  it("does not let the teacher edit the links of an archived class", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue({ ...theClass, status: "ARCHIVED" });
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(classService, "getLinks").mockResolvedValue([{ id: "l-1", name: "Link do Meet", url: "https://meet.google.com/abc", position: 0 }]);
    render(<ClassPage params={params} />);
    expect(await screen.findByRole("link", { name: /Link do Meet/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Adicionar link" })).toBeNull();
  });

  // SPEC-049 CA-07: the history of the class for the teacher
  it("shows who created, updated and archived the class, with when, to the teacher", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue({
      ...theClass,
      status: "ARCHIVED",
      archiveReason: "Semestre encerrado",
      createdAt: "2026-10-01T15:00:00Z",
      updatedAt: "2026-10-05T15:00:00Z",
      archivedAt: "2026-10-06T15:00:00Z",
      createdBy: "u-1",
      updatedBy: "u-2",
      archivedBy: "u-3",
      createdByName: "Ana Souza",
      updatedByName: "Bruno Lima",
      archivedByName: "Carla Dias",
    });
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(classService, "getLinks").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    expect(await screen.findByRole("heading", { name: "Histórico" })).toBeDefined();
    expect(screen.getByText(/Criada por Ana Souza em 01\/10\/2026/)).toBeDefined();
    expect(screen.getByText(/Atualizada por Bruno Lima em 05\/10\/2026/)).toBeDefined();
    expect(screen.getByText(/Arquivada por Carla Dias em 06\/10\/2026/)).toBeDefined();
    expect(screen.getByText(/Motivo: Semestre encerrado/)).toBeDefined();
  });

  // SPEC-049: a class never updated and not archived shows only the creation; an author that cannot be read is told so
  it("shows only the creation of a class that was never updated, and tells a removed user", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue({
      ...theClass,
      createdAt: "2026-10-01T15:00:00Z",
      updatedAt: "2026-10-01T15:00:00Z",
      createdBy: "u-9",
      updatedBy: "u-9",
    });
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(classService, "getLinks").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    expect(await screen.findByText(/Criada por Usuário removido em 01\/10\/2026/)).toBeDefined();
    expect(screen.queryByText(/Atualizada por/)).toBeNull();
    expect(screen.queryByText(/Arquivada por/)).toBeNull();
  });

  // SPEC-049 CA-07: the student does not see the history
  it("does not show the history to a student", async () => {
    asRole("STUDENT");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id,
      name: theClass.name,
      courseCode: theClass.courseCode,
      semester: theClass.semester,
      status: theClass.status,
      summary: "",
      syllabus: "",
      institutionalGuidelines: "",
      startDate: theClass.startDate,
      endDate: theClass.endDate,
      scheduleDescription: "",
      enableVirtualClassroom: false,
      teacherName: "Profa. Sediane",
    });
    vi.spyOn(classService, "getLinks").mockResolvedValue([]);
    render(<ClassPage params={params} />);
    await screen.findByRole("heading", { level: 1, name: "Sistemas Operacionais" });
    expect(screen.queryByRole("heading", { name: "Histórico" })).toBeNull();
  });

  // SPEC-051 CA-18: the section "Aula ao vivo" on the overview
  it("shows the live class section on the overview, with the role and whether the class is archived", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue({ ...theClass, status: "ARCHIVED" });
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(classService, "getLinks").mockResolvedValue([]);
    const teacher = render(<ClassPage params={params} />);
    const panel = await screen.findByTestId("live-panel");
    expect(panel.getAttribute("data-class")).toBe("c-1");
    expect(panel.getAttribute("data-role")).toBe("teacher");
    expect(panel.getAttribute("data-archived")).toBe("true");
    teacher.unmount();

    asRole("STUDENT");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id,
      name: theClass.name,
      courseCode: theClass.courseCode,
      semester: theClass.semester,
      status: theClass.status,
      summary: "",
      syllabus: "",
      institutionalGuidelines: "",
      startDate: theClass.startDate,
      endDate: theClass.endDate,
      scheduleDescription: "",
      enableVirtualClassroom: false,
      teacherName: "Profa. Sediane",
    });
    vi.spyOn(classService, "getLinks").mockResolvedValue([]);
    render(<ClassPage params={params} />);
    const studentPanel = await screen.findByTestId("live-panel");
    expect(studentPanel.getAttribute("data-role")).toBe("student");
    expect(studentPanel.getAttribute("data-archived")).toBe("false");
  });

  // SPEC-053 CA-09 and CA-11: the buttons of the content and of the live class in the agenda of the class
  it("lets the teacher edit the content of a lesson and start the live class from it, in the Agenda tab", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    vi.spyOn(classroomService, "listDecks").mockResolvedValue([]);
    render(<ClassPage params={params} />);

    fireEvent.click(await screen.findByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
    const panel = screen.getByRole("region", { name: "quarta-feira, 21 de outubro de 2026" });
    fireEvent.click(within(panel).getByRole("button", { name: "Iniciar aula ao vivo" }));
    await waitFor(() => expect(startLiveFromSession).toHaveBeenCalledWith("c-1", expect.objectContaining({ id: "s-21" }), "Sistemas Operacionais"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1/live"));

    fireEvent.click(within(panel).getByRole("button", { name: "Conteúdo da aula" }));
    expect(await screen.findByRole("dialog", { name: "Conteúdo da aula de 21/10/2026" })).toBeDefined();
    expect(scheduleService.getSessionContent).toHaveBeenCalledWith("c-1", "s-21");
  });

  it("does not give the student the buttons of the content nor of the live class", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    render(<ClassPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
    expect(screen.queryByRole("button", { name: "Conteúdo da aula" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar aula ao vivo" })).toBeNull();
  });

  // SPEC-053 CA-14: the notice of the live class in the Agenda tab, for the student too
  it("tells the student, in the Agenda tab, that the live class is going on, with the way in", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    vi.spyOn(classroomService, "getActive").mockResolvedValue({
      hasActiveSession: true,
      session: { id: "live-1", classId: "c-1", title: "Aula de hoje", classSessionId: "s-21", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-21T11:00:00Z" },
      displayMode: "SLIDES", currentSlide: 1, activeDeck: null, recentDrawings: [],
      terminal: { line: "", history: [], state: null }, handRaises: [], onlineCount: 3,
    } as never);
    render(<ClassPage params={params} />);

    expect(await screen.findByText("Aula ao vivo em andamento: Aula de hoje")).toBeDefined();
    expect(screen.getByRole("link", { name: "Entrar na aula" }).getAttribute("href")).toBe("/app/classes/c-1/live");

    fireEvent.click(await screen.findByRole("button", { name: /^quarta-feira, 21 de outubro/ }));
    const panel = screen.getByRole("region", { name: "quarta-feira, 21 de outubro de 2026" });
    expect(within(panel).getByText("Ao vivo agora")).toBeDefined();
    expect(within(panel).getByRole("link", { name: "Entrar na aula ao vivo" }).getAttribute("href")).toBe("/app/classes/c-1/live");
  });

  it("shows no notice of a live class when there is none", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    vi.spyOn(classroomService, "getActive").mockResolvedValue({ hasActiveSession: false });
    render(<ClassPage params={params} />);
    await screen.findByRole("button", { name: /^segunda-feira, 19 de outubro/ });
    expect(screen.queryByText(/Aula ao vivo em andamento/)).toBeNull();
  });
});

// SPEC-073 CA-07: the timeline of the class under the calendar of the Agenda tab
describe("timeline of the class (SPEC-073)", () => {
  it("shows the timeline under the calendar, for the student", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    vi.mocked(scheduleService.timeline).mockResolvedValue({
      now: "2026-10-19T09:00:00-03:00",
      current: {
        id: "s-19", classId: "c-1", date: "2026-10-19", startTime: "08:20", endTime: "10:00", lessonCount: 2, mode: "IN_PERSON", status: "SCHEDULED",
        origin: "WEEKLY", overridden: false, onHoliday: false, topic: "Permissões de arquivos", hasContent: true,
        startsAt: "2026-10-19T08:20:00-03:00", endsAt: "2026-10-19T10:00:00-03:00", liveSessionCount: 0, commandCount: 0, materialCount: 0,
      },
      past: [],
      upcoming: [],
      liveSessionId: null,
    });
    render(<ClassPage params={params} />);

    const region = await screen.findByRole("region", { name: "Linha do tempo da turma" });
    expect(within(region).getByText("Agora")).toBeDefined();
    expect(within(region).getByText("Permissões de arquivos")).toBeDefined();
    expect(scheduleService.timeline).toHaveBeenCalledWith("c-1");
    expect(within(region).getByText("A aula ao vivo ainda não começou.")).toBeDefined();
  });
});

// SPEC-073 CA-13: the teacher opens the content and changes a lesson from the cards of the timeline
describe("actions of the timeline cards (SPEC-073 CA-13)", () => {
  const lesson = (id: string, date: string, over: Record<string, unknown> = {}) => ({
    id, classId: "c-1", date, startTime: "08:20", endTime: "10:20", lessonCount: 2, mode: "IN_PERSON", status: "SCHEDULED", origin: "WEEKLY",
    overridden: false, onHoliday: false, hasContent: false, startsAt: `${date}T08:20:00-03:00`, endsAt: `${date}T10:20:00-03:00`, liveSessionCount: 0, commandCount: 0, materialCount: 0,
    ...over,
  });
  const timeline = () => ({
    now: "2026-10-13T10:00:00-03:00",
    current: null,
    past: [],
    upcoming: [lesson("s-19", "2026-10-19", { topic: "teste" }), lesson("s-22", "2026-10-22")],
    liveSessionId: null,
  });

  it("opens the content dialog and the change dialog of the lesson of the card, and reads the timeline again when it saves", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    vi.spyOn(classroomService, "listDecks").mockResolvedValue([]);
    vi.mocked(scheduleService.timeline).mockReset().mockResolvedValue(timeline() as never);
    render(<ClassPage params={params} />);

    const region = await screen.findByRole("region", { name: "Linha do tempo da turma" });
    const upcoming = within(region).getByRole("region", { name: "Próximas aulas" });
    const callsBefore = vi.mocked(scheduleService.timeline).mock.calls.length;

    fireEvent.click(within(upcoming).getAllByRole("button", { name: "Conteúdo da aula" })[1]!);
    const dialog = await screen.findByRole("dialog", { name: "Conteúdo da aula de 22/10/2026" });
    expect(scheduleService.getSessionContent).toHaveBeenCalledWith("c-1", "s-22");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(scheduleService.saveSessionContent).toHaveBeenCalledWith("c-1", "s-22", expect.anything()));
    await waitFor(() => expect(vi.mocked(scheduleService.timeline).mock.calls.length).toBeGreaterThan(callsBefore));

    fireEvent.click(within(upcoming).getAllByRole("button", { name: "Alterar esta aula" })[0]!);
    expect(await screen.findByRole("dialog", { name: "Alterar a aula de 19/10/2026" })).toBeDefined();
  });

  it("does not give the student the buttons that edit", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue({
      id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE",
      summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
      scheduleDescription: "", enableVirtualClassroom: false,
    });
    vi.mocked(scheduleService.timeline).mockReset().mockResolvedValue(timeline() as never);
    render(<ClassPage params={params} />);

    const region = await screen.findByRole("region", { name: "Linha do tempo da turma" });
    expect(within(region).getByText("teste")).toBeDefined();
    expect(within(region).queryByRole("button", { name: "Conteúdo da aula" })).toBeNull();
    expect(within(region).queryByRole("button", { name: "Alterar esta aula" })).toBeNull();
  });
});

// SPEC-075: the way to the assessments of the class, and "Transformar em avaliação" on a lesson
describe("assessments from the class page (SPEC-075)", () => {
  const myClass = {
    id: theClass.id, name: theClass.name, courseCode: theClass.courseCode, semester: theClass.semester, status: "ACTIVE" as const,
    summary: "", syllabus: "", institutionalGuidelines: "", startDate: theClass.startDate, endDate: theClass.endDate,
    scheduleDescription: "", enableVirtualClassroom: false,
  };
  const upcoming = (id: string, date: string) => ({
    id, classId: "c-1", date, startTime: "08:20", endTime: "10:20", lessonCount: 2, mode: "IN_PERSON", status: "SCHEDULED", origin: "WEEKLY",
    overridden: false, onHoliday: false, hasContent: false, startsAt: `${date}T08:20:00-03:00`, endsAt: `${date}T10:20:00-03:00`, liveSessionCount: 0, commandCount: 0, materialCount: 0,
  });

  beforeEach(() => pushMock.mockClear());

  it("links the teacher and the student to the assessments of the class", async () => {
    asRole("TEACHER");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    render(<ClassPage params={params} />);
    expect((await screen.findByRole("link", { name: "Avaliações" })).getAttribute("href")).toBe("/app/classes/c-1/assessments");
    cleanup();

    asRole("STUDENT");
    vi.spyOn(classService, "getMyClass").mockResolvedValue(myClass);
    render(<ClassPage params={params} />);
    expect((await screen.findByRole("link", { name: "Avaliações" })).getAttribute("href")).toBe("/app/classes/c-1/assessments");
  });

  it("opens the form of a new assessment made from the lesson of the calendar", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    render(<ClassPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 26 de outubro/ }));
    // the timeline under the calendar offers it too, so the button is looked for in the panel of the day
    const panel = screen.getByRole("region", { name: "segunda-feira, 26 de outubro de 2026" });
    fireEvent.click(within(panel).getByRole("button", { name: "Transformar em avaliação" }));
    expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1/assessments/new?sessionId=s-26");
  });

  it("opens the form of a new assessment made from the lesson of the timeline", async () => {
    asRole("TEACHER");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getClass").mockResolvedValue(theClass);
    vi.spyOn(classService, "listMembers").mockResolvedValue([member]);
    vi.mocked(scheduleService.timeline).mockReset().mockResolvedValue({
      now: "2026-10-13T10:00:00-03:00", current: null, past: [], upcoming: [upcoming("s-22", "2026-10-22")], liveSessionId: null,
    } as never);
    render(<ClassPage params={params} />);
    const region = await screen.findByRole("region", { name: "Linha do tempo da turma" });
    fireEvent.click(within(region).getByRole("button", { name: "Transformar em avaliação" }));
    expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1/assessments/new?sessionId=s-22");
  });

  it("does not offer it to the student", async () => {
    asRole("STUDENT");
    searchParams = new URLSearchParams("tab=schedule");
    vi.spyOn(classService, "getMyClass").mockResolvedValue(myClass);
    vi.mocked(scheduleService.timeline).mockReset().mockResolvedValue({
      now: "2026-10-13T10:00:00-03:00", current: null, past: [], upcoming: [upcoming("s-22", "2026-10-22")], liveSessionId: null,
    } as never);
    render(<ClassPage params={params} />);
    await screen.findByRole("region", { name: "Linha do tempo da turma" });
    fireEvent.click(await screen.findByRole("button", { name: /^segunda-feira, 26 de outubro/ }));
    expect(screen.queryByRole("button", { name: "Transformar em avaliação" })).toBeNull();
  });
});
