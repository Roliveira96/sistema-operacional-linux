import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classService, type ClassGroup } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService } from "@/services/moduleService";
import ClassSettingsPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.spyOn(moduleService, "listModules").mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const theClass: ClassGroup = {
  id: "class-123",
  teacherId: "teacher-1",
  name: "Sistemas Operacionais",
  courseCode: "SO34E",
  semester: "2026/2",
  startDate: "2026-10-01T00:00:00Z",
  endDate: "2026-12-01T00:00:00Z",
  enableVirtualClassroom: false,
  enableInviteLink: false,
  status: "ACTIVE",
  isExpiringSoon: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const params = Promise.resolve({ id: "class-123" });

// SPEC-078 CA-07 (section 3.1): what the page shows while it loads, when the class is not there and when it could not be read.
describe("ClassSettingsPage states", () => {
  it("shows a skeleton announced as loading while the class is read, and the form when it arrives", async () => {
    let arrive: (c: ClassGroup) => void = () => {};
    vi.spyOn(classService, "getClass").mockReturnValueOnce(new Promise<ClassGroup>((resolve) => (arrive = resolve)));
    render(<ClassSettingsPage params={params} />);

    const loading = await screen.findByRole("status", { name: "Carregando as configurações da turma" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("tablist")).toBeNull();

    await act(async () => arrive(theClass));
    expect(await screen.findByDisplayValue("Sistemas Operacionais")).toBeDefined();
    expect(screen.queryByRole("status", { name: "Carregando as configurações da turma" })).toBeNull();
  });

  it("says the class was not found when the server says so, with the way back to the classes", async () => {
    vi.spyOn(classService, "getClass").mockRejectedValueOnce(new ApiProblemError({ type: "class-not-found", status: 404 }, 404));
    render(<ClassSettingsPage params={params} />);

    expect(await screen.findByText("Turma não encontrada.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Voltar para as turmas" }).getAttribute("href")).toBe("/app/classes");
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("says the settings could not be loaded for any other failure, and tries again", async () => {
    const get = vi.spyOn(classService, "getClass").mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(theClass);
    render(<ClassSettingsPage params={params} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar as configurações da turma.");
    expect(screen.queryByText("Turma não encontrada.")).toBeNull();
    expect(screen.getByRole("link", { name: "Voltar para as turmas" }).getAttribute("href")).toBe("/app/classes");

    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByDisplayValue("Sistemas Operacionais")).toBeDefined();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
