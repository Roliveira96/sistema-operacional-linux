import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/useAuth";
import { classService, type ClassGroup, type ClassMember } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import ClassPage from "./page";

const replaceMock = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
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
    },
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
});
