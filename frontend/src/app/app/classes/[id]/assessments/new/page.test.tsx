import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessmentService } from "@/services/assessmentService";
import { classService, type ClassMember } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import { scheduleService } from "@/services/scheduleService";
import { SERVER_NOW, summary } from "@/test/assessmentFixtures";
import NewAssessmentPage from "./page";

const pushMock = vi.hoisted(() => vi.fn());
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }), useSearchParams: () => searchParams }));

// The form has its own tests; here it is a stub that shows what the page gave it and sends what it is told to.
vi.mock("@/components/AssessmentForm/AssessmentForm", () => ({
  AssessmentForm: (p: {
    mode: string;
    initial?: unknown;
    modules: { id: string; title: string }[];
    students: { id: string; name: string; academicId?: string }[];
    onSubmit: (v: unknown) => Promise<void>;
  }) => (
    <div>
      <output data-testid="mode">{p.mode}</output>
      <output data-testid="initial">{JSON.stringify(p.initial ?? null)}</output>
      <output data-testid="modules">{JSON.stringify(p.modules)}</output>
      <output data-testid="students">{JSON.stringify(p.students)}</output>
      <button type="button" onClick={() => void p.onSubmit({ title: "Prova 1" }).catch(() => undefined)}>
        enviar
      </button>
    </div>
  ),
}));

const params = Promise.resolve({ id: "c-1" });
const member = (userId: string, userName: string, academicId: string): ClassMember => ({
  id: `m-${userId}`, classId: "c-1", userId, userName, userEmail: `${userId}@x.br`, userAcademicId: academicId, status: "ACTIVE", origin: "DIRECT_BY_TEACHER", requestedAt: "",
});

function mockReads() {
  vi.spyOn(moduleService, "listModules").mockResolvedValue({
    items: [{ id: "mod-1", title: "Permissões de arquivos" }, { id: "mod-2", title: "Processos" }] as never,
    total: 2, page: 1, limit: 100,
  });
  vi.spyOn(classService, "listMembers").mockResolvedValue([member("s-1", "Ana Souza", "1000001"), member("s-2", "Bruno Lima", "1000002")]);
}

const read = (id: string) => JSON.parse(screen.getByTestId(id).textContent!);

beforeEach(() => {
  searchParams = new URLSearchParams();
  pushMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-075 CA-25: the new assessment, empty or made from a lesson.
describe("new assessment page", () => {
  it("opens the form for a new assessment with the modules of the class and its active students", async () => {
    mockReads();
    const diary = vi.spyOn(scheduleService, "getDiary");
    render(<NewAssessmentPage params={params} />);
    await screen.findByTestId("mode");
    expect(screen.getByTestId("mode").textContent).toBe("create");
    expect(moduleService.listModules).toHaveBeenCalledWith(expect.objectContaining({ classId: "c-1" }));
    expect(classService.listMembers).toHaveBeenCalledWith("c-1", "ACTIVE");
    expect(read("modules")).toEqual([{ id: "mod-1", title: "Permissões de arquivos" }, { id: "mod-2", title: "Processos" }]);
    expect(read("students")).toEqual([{ id: "s-1", name: "Ana Souza", academicId: "1000001" }, { id: "s-2", name: "Bruno Lima", academicId: "1000002" }]);
    expect(read("initial")).toBeNull();
    expect(diary).not.toHaveBeenCalled();
  });

  it("opens with the start, end, title and module of the lesson when it comes from one", async () => {
    mockReads();
    searchParams = new URLSearchParams("sessionId=s-21");
    const diary = vi.spyOn(scheduleService, "getDiary").mockResolvedValue({
      session: { id: "s-21", startsAt: "2026-10-21T08:20:00-03:00", endsAt: "2026-10-21T10:00:00-03:00" },
      content: { topic: "Permissões de arquivos", module: { id: "mod-1", title: "Permissões de arquivos" }, links: [] },
      liveSessions: [],
      materials: [],
    } as never);
    render(<NewAssessmentPage params={params} />);
    await screen.findByTestId("mode");
    expect(diary).toHaveBeenCalledWith("c-1", "s-21");
    expect(read("initial")).toEqual({
      classSessionId: "s-21",
      title: "Permissões de arquivos",
      moduleId: "mod-1",
      startsAt: "2026-10-21T08:20:00-03:00",
      endsAt: "2026-10-21T10:00:00-03:00",
    });
  });

  it("leaves out what the lesson does not have, so the teacher fills it", async () => {
    mockReads();
    searchParams = new URLSearchParams("sessionId=s-26");
    vi.spyOn(scheduleService, "getDiary").mockResolvedValue({
      session: { id: "s-26", startsAt: "2026-10-26T08:20:00-03:00", endsAt: "2026-10-26T10:00:00-03:00" },
      content: { links: [] },
      liveSessions: [],
      materials: [],
    } as never);
    render(<NewAssessmentPage params={params} />);
    await screen.findByTestId("mode");
    expect(read("initial")).toEqual({ classSessionId: "s-26", startsAt: "2026-10-26T08:20:00-03:00", endsAt: "2026-10-26T10:00:00-03:00" });
  });

  it("creates the assessment and goes to its page", async () => {
    mockReads();
    const create = vi.spyOn(assessmentService, "create").mockResolvedValue({ ...summary({ id: "a-9" }), serverNow: SERVER_NOW });
    render(<NewAssessmentPage params={params} />);
    fireEvent.click(await screen.findByRole("button", { name: "enviar" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("c-1", { title: "Prova 1" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/app/classes/c-1/assessments/a-9"));
  });

  it("says when what the form needs could not be read, and tries again", async () => {
    vi.spyOn(moduleService, "listModules").mockRejectedValueOnce(new Error("down")).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<NewAssessmentPage params={params} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar os dados da avaliação.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByTestId("mode")).toBeDefined();
  });

  it("says the class has no module to take the questions from", async () => {
    vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
    vi.spyOn(classService, "listMembers").mockResolvedValue([]);
    render(<NewAssessmentPage params={params} />);
    expect(await screen.findByText("Esta turma ainda não tem módulo atribuído. Atribua um módulo à turma para montar a avaliação.")).toBeDefined();
    expect(screen.queryByTestId("mode")).toBeNull();
  });
});
