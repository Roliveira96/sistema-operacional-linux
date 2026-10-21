import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { CourseModuleSummary, ListModulesResult } from "@/services/moduleService";
import { ClassForm } from "./ClassForm";

afterEach(cleanup);

const mod = (id: string, title: string): CourseModuleSummary => ({
  id,
  teacherId: "t-1",
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
const modules: ListModulesResult = { items: [mod("m-1", "Fundamentos de Processos"), mod("m-2", "Sistemas de Arquivos")], total: 2, page: 1, limit: 50 };

const saved = {
  name: "Turma A",
  courseCode: "SO34E",
  semester: "2026/2",
  startDate: "2026-08-01T03:00:00Z",
  endDate: "2026-12-01T03:00:00Z",
};

function setup(over: Partial<React.ComponentProps<typeof ClassForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const loadModules = vi.fn().mockResolvedValue(modules);
  render(<ClassForm onSubmit={onSubmit} initialData={saved} classId="c-1" loadModules={loadModules} initialModuleIds={["m-1"]} submitLabel="Salvar Alterações" {...over} />);
  fireEvent.click(screen.getByRole("tab", { name: "Conteúdo" })); // the modules are in this tab
  return { onSubmit, loadModules };
}

const content = () => document.getElementById(screen.getByRole("tab", { name: "Conteúdo" }).getAttribute("aria-controls")!)!;
const save = () => fireEvent.click(screen.getByRole("button", { name: "Salvar Alterações" }));

// SPEC-078 CA-12, CA-16 (section 3.1): the modules of a saved class are chosen in the Conteúdo tab and saved with everything else.
describe("ClassForm modules of the class", () => {
  it("shows the section after the syllabus and the guidelines, with the included module marked", async () => {
    setup();
    const section = await within(content()).findByRole("region", { name: "Módulos de ensino da turma" });
    expect((await within(section).findByRole("checkbox", { name: "Incluir Fundamentos de Processos" }) as HTMLInputElement).checked).toBe(true);
    const guidelines = within(content()).getByRole("textbox", { name: "Diretrizes institucionais" });
    expect(guidelines.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends no change of modules when the choice did not change", async () => {
    const { onSubmit } = setup();
    await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.lastCall?.[2]).toBeUndefined();
  });

  it("sends the whole set when a module is marked or unmarked, and an empty list when none is left", async () => {
    const { onSubmit } = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }));
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.lastCall?.[2]).toEqual(["m-1", "m-2"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Fundamentos de Processos" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }));
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.lastCall?.[2]).toEqual([]);
  });

  it("only changes what is saved when Salvar is pressed", async () => {
    const { onSubmit } = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("while the class is being created, only says to include the modules afterwards", () => {
    const loadModules = vi.fn();
    render(<ClassForm onSubmit={vi.fn()} loadModules={loadModules} />);
    expect(within(content()).getByText("Depois de criar a turma, inclua os módulos em Configurações.")).toBeDefined();
    expect(within(content()).queryByRole("region", { name: "Módulos de ensino da turma" })).toBeNull();
    expect(loadModules).not.toHaveBeenCalled();
  });

  it("tells why a private module cannot leave its only class", async () => {
    const problem = new ApiProblemError({ type: "module-needs-a-class", status: 409, moduleId: "m-1" }, 409);
    setup({ onSubmit: vi.fn().mockRejectedValue(problem) });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" }));
    save();
    expect((await screen.findByRole("alert")).textContent).toMatch(/módulo privado precisa de ao menos uma turma/i);
  });
});
