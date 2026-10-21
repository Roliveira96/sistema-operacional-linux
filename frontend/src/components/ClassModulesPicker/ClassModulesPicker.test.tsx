import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CourseModuleSummary, ListModulesResult } from "@/services/moduleService";
import { ClassModulesPicker } from "./ClassModulesPicker";

afterEach(cleanup);

const mod = (id: string, title: string, visibility: CourseModuleSummary["visibility"] = "AUTHENTICATED"): CourseModuleSummary => ({
  id,
  teacherId: "t-1",
  title,
  description: "d",
  visibility,
  status: "ACTIVE",
  totalExercises: 0,
  totalMaterials: 0,
  isActiveNow: true,
  createdAt: "",
  updatedAt: "",
});
const page = (items: CourseModuleSummary[], total = items.length, current = 1): ListModulesResult => ({ items, total, page: current, limit: 50 });

const processes = mod("m-1", "Fundamentos de Processos", "PRIVATE");
const files = mod("m-2", "Sistemas de Arquivos", "PUBLIC");

// SPEC-078 CA-12, CA-16 (section 3.1): the modules a teacher includes in a class.
describe("ClassModulesPicker", () => {
  it("lists the modules with their visibility, marks the included ones and counts them", async () => {
    const load = vi.fn().mockResolvedValue(page([processes, files]));
    render(<ClassModulesPicker load={load} selected={["m-1"]} onChange={vi.fn()} />);

    expect(await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" })).toBeDefined();
    expect((screen.getByRole("checkbox", { name: "Incluir Fundamentos de Processos" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }) as HTMLInputElement).checked).toBe(false);
    const list = screen.getByRole("list", { name: "Módulos de ensino" });
    expect(within(list).getByText("Privado")).toBeDefined();
    expect(within(list).getByText("Público")).toBeDefined();
    expect(screen.getByRole("status", { name: "Módulos incluídos" }).textContent).toBe("1 módulo incluído");
    expect(load).toHaveBeenCalledWith({ page: 1, limit: 50 });
  });

  it("says how many are included: none, one or many", async () => {
    const load = vi.fn().mockResolvedValue(page([processes, files]));
    const { rerender } = render(<ClassModulesPicker load={load} selected={[]} onChange={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "Incluir Sistemas de Arquivos" });
    expect(screen.getByRole("status", { name: "Módulos incluídos" }).textContent).toBe("Nenhum módulo incluído");
    rerender(<ClassModulesPicker load={load} selected={["m-1", "m-2"]} onChange={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Módulos incluídos" }).textContent).toBe("2 módulos incluídos");
  });

  it("reports the new set when a module is marked or unmarked, keeping the ones it does not show", async () => {
    const onChange = vi.fn();
    render(<ClassModulesPicker load={vi.fn().mockResolvedValue(page([processes, files]))} selected={["m-1", "m-9"]} onChange={onChange} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Incluir Sistemas de Arquivos" }));
    expect(onChange).toHaveBeenLastCalledWith(["m-1", "m-9", "m-2"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir Fundamentos de Processos" }));
    expect(onChange).toHaveBeenLastCalledWith(["m-9"]);
  });

  it("searches by name and walks the pages of 50", async () => {
    const load = vi.fn(async (query: { search?: string; page: number }) => (query.page === 2 ? page([files], 51, 2) : page([processes], 51, 1)));
    render(<ClassModulesPicker load={load} selected={[]} onChange={vi.fn()} />);

    await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" });
    expect(screen.getByText("Página 1 de 2")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(await screen.findByRole("checkbox", { name: "Incluir Sistemas de Arquivos" })).toBeDefined();
    expect(load).toHaveBeenLastCalledWith({ page: 2, limit: 50 });

    fireEvent.change(screen.getByLabelText("Buscar módulo pelo nome"), { target: { value: "arquivos" } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ search: "arquivos", page: 1, limit: 50 }));
  });

  it("when there is no module at all, says so and leads to the modules to create the first one", async () => {
    render(<ClassModulesPicker load={vi.fn().mockResolvedValue(page([]))} selected={[]} onChange={vi.fn()} />);
    expect(await screen.findByText("Você ainda não criou módulos de ensino.")).toBeDefined();
    expect(screen.getByRole("link", { name: "Módulos de Ensino" }).getAttribute("href")).toBe("/app/modules");
  });

  it("when a search finds nothing, says so without sending anyone to create a module", async () => {
    const load = vi.fn(async (query: { search?: string }) => page(query.search ? [] : [processes]));
    render(<ClassModulesPicker load={load} selected={[]} onChange={vi.fn()} />);
    await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" });
    fireEvent.change(screen.getByLabelText("Buscar módulo pelo nome"), { target: { value: "xyz" } });
    expect(await screen.findByText("Nenhum módulo encontrado.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Módulos de Ensino" })).toBeNull();
  });

  it("shows when the modules could not be read and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(page([processes]));
    render(<ClassModulesPicker load={load} selected={[]} onChange={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível carregar os módulos.");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("checkbox", { name: "Incluir Fundamentos de Processos" })).toBeDefined();
  });
});
