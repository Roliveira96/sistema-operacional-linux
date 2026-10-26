import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classService, type ClassGroup } from "@/services/classService";
import { moduleService, type CourseModuleSummary } from "@/services/moduleService";
import { scheduleService, type Meeting } from "@/services/scheduleService";
import { octoberCalendar } from "@/test/scheduleFixtures";
import ClassSettingsPage from "./page";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

beforeEach(() => {
  // the modules of the class and the ones the teacher can include: none, unless a test says otherwise
  vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockClass: ClassGroup = {
  id: "class-123",
  teacherId: "teacher-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  syllabus: "Ementa",
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-12-01T00:00:00Z",
  enableVirtualClassroom: false,
  enableInviteLink: false,
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

describe("ClassSettingsPage", () => {
  it("loads class details and submits update", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    const updateSpy = vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByText("Configurações da Turma")).toBeDefined();
      expect(screen.getByDisplayValue("Sistemas Operacionais")).toBeDefined();
    });

    const nameInput = screen.getByDisplayValue("Sistemas Operacionais");
    fireEvent.change(nameInput, { target: { value: "SO Prática" } });

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith("class-123", expect.objectContaining({ name: "SO Prática" }));
      expect(pushMock).toHaveBeenCalledWith("/app/classes/class-123?saved=1");
    });
  });

  it("submits update with changed courseCode and semester", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    const updateSpy = vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("SO34E")).toBeDefined();
    });

    const codeInput = screen.getByDisplayValue("SO34E");
    fireEvent.change(codeInput, { target: { value: "SO35F" } });

    const semesterInput = screen.getByDisplayValue("2026/2");
    fireEvent.change(semesterInput, { target: { value: "2027/1" } });

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        "class-123",
        expect.objectContaining({
          courseCode: "SO35F",
          semester: "2027/1",
        }),
      );
      expect(pushMock).toHaveBeenCalledWith("/app/classes/class-123?saved=1");
    });
  });

  // SPEC-042: the form of a saved class starts from its meetings and saves them again.
  it("loads the saved meetings into the form and saves the changed ones", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    vi.spyOn(scheduleService, "getMeetings").mockResolvedValueOnce([
      { id: "m-1", classId: "class-123", weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON" } as unknown as Meeting,
    ]);
    vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);
    const meetingsSpy = vi.spyOn(scheduleService, "replaceMeetings").mockResolvedValueOnce([]);

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    expect((screen.getByLabelText("Início (Quarta-feira)") as HTMLInputElement).value).toBe("13:50");

    fireEvent.click(screen.getByText("Salvar Alterações"));

    await waitFor(() => expect(meetingsSpy).toHaveBeenCalledTimes(1));
    expect(meetingsSpy.mock.lastCall?.[0]).toBe("class-123");
    expect(meetingsSpy.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ weekday: 3, startTime: "13:50", endTime: "15:30", lessonCount: 2, mode: "IN_PERSON" }),
    ]);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/class-123?saved=1"));
  });

  // SPEC-044 CA-16: the settings screen shows the real calendar of the class in the Horários tab.
  it("shows the real calendar of the class in the Horários tab", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce({ ...mockClass, startDate: "2026-10-01T03:00:00Z", endDate: "2026-10-31T23:59:59Z" });
    vi.spyOn(scheduleService, "getMeetings").mockResolvedValueOnce([]);
    const calendar = vi.spyOn(scheduleService, "classCalendar").mockResolvedValue(octoberCalendar());

    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    fireEvent.click(screen.getByRole("tab", { name: "Horários" }));

    expect(await screen.findByRole("heading", { name: "outubro de 2026" })).toBeDefined();
    expect(calendar).toHaveBeenCalledWith("class-123", "2026-09-27", "2026-10-31");
    expect(screen.queryByRole("region", { name: "Prévia do calendário" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar horários ao calendário" })).toBeNull();
  });
});

const mod = (id: string, title: string): CourseModuleSummary => ({
  id,
  teacherId: "teacher-1",
  title,
  description: "d",
  visibility: "AUTHENTICATED",
  status: "ACTIVE",
  totalExercises: 0,
  totalMaterials: 0,
  isActiveNow: true,
  createdAt: "",
  updatedAt: "",
});

// SPEC-078 CA-01 to CA-04 (section 3.1): the way back, the bar of actions and where saving leads.
describe("ClassSettingsPage navigation", () => {
  it("has the link back to the class above the title, and the bar of actions with Cancelar and Salvar", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");

    const back = screen.getByRole("link", { name: /Voltar para a turma/ });
    expect(back.getAttribute("href")).toBe("/app/classes/class-123");
    const title = screen.getByRole("heading", { name: "Configurações da Turma" });
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const bar = screen.getByRole("group", { name: "Ações do formulário" });
    expect(within(bar).getByRole("link", { name: "Cancelar" }).getAttribute("href")).toBe("/app/classes/class-123");
    expect(within(bar).getByRole("button", { name: "Salvar Alterações" })).toBeDefined();
  });

  it("stays on the page and says why when the server refuses the save", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    vi.spyOn(classService, "updateClass").mockRejectedValueOnce(new Error("boom"));
    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");

    fireEvent.click(screen.getByText("Salvar Alterações"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Não foi possível salvar a turma/);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

// SPEC-078 CA-12 (section 3.1): the modules of the class are read with the class and saved with it, only when they changed.
describe("ClassSettingsPage modules", () => {
  const assigned = mod("m-1", "Fundamentos de Processos");
  const other = mod("m-2", "Sistemas de Arquivos");
  const listOfTheTeacher = () =>
    vi.spyOn(moduleService, "listModules").mockImplementation(async (params = {}) =>
      params.classId ? { items: [assigned], total: 1, page: 1, limit: 50 } : { items: [assigned, other], total: 2, page: 1, limit: 50 },
    );

  it("starts from the modules assigned to the class, and saves the set once it changed", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);
    const list = listOfTheTeacher();
    const setModules = vi.spyOn(moduleService, "setClassModules").mockResolvedValueOnce({ moduleIds: ["m-1", "m-2"] });
    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    expect(list).toHaveBeenCalledWith({ classId: "class-123", limit: 50, page: 1 });

    fireEvent.click(screen.getByRole("tab", { name: "Conteúdo" }));
    expect((await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }));
    expect(setModules).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Salvar Alterações"));
    await waitFor(() => expect(setModules).toHaveBeenCalledWith("class-123", ["m-1", "m-2"]));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/class-123?saved=1"));
  });

  it("does not touch the modules when the choice did not change", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    vi.spyOn(classService, "updateClass").mockResolvedValueOnce(mockClass);
    listOfTheTeacher();
    const setModules = vi.spyOn(moduleService, "setClassModules");
    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");

    fireEvent.click(screen.getByText("Salvar Alterações"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/class-123?saved=1"));
    expect(setModules).not.toHaveBeenCalled();
  });

  it("reads every page of the modules already assigned, 50 at a time", async () => {
    vi.spyOn(classService, "getClass").mockResolvedValueOnce(mockClass);
    const list = vi.spyOn(moduleService, "listModules").mockImplementation(async (params = {}) => {
      if (!params.classId) return { items: [], total: 0, page: 1, limit: 50 };
      return params.page === 2
        ? { items: [other], total: 51, page: 2, limit: 50 }
        : { items: [assigned], total: 51, page: 1, limit: 50 };
    });
    render(<ClassSettingsPage params={Promise.resolve({ id: "class-123" })} />);
    await screen.findByDisplayValue("Sistemas Operacionais");
    await waitFor(() => expect(list).toHaveBeenCalledWith({ classId: "class-123", limit: 50, page: 2 }));
  });
});
