import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classService } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import EditModulePage from "./page";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    getModuleById: vi.fn(),
    updateModule: vi.fn(),
    reorderExercises: vi.fn(),
  },
}));

vi.mock("@/services/contentService", () => ({
  contentService: {
    blocks: vi.fn().mockResolvedValue([{ id: "b-1", type: "COMMAND", position: 1, payload: { title: "Listar arquivos" } }]),
  },
}));

vi.mock("@/services/classService", () => ({
  classService: {
    listClasses: vi.fn(),
  },
}));

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EditModulePage (/app/modules/:id/edit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads module and classes, allows updating module and reordering exercises", async () => {
    const stored = {
      id: "mod-1",
      teacherId: "teach-1",
      title: "Módulo Original",
      description: "Descrição Original",
      visibility: "PUBLIC",
      status: "ACTIVE",
      totalExercises: 2,
      totalMaterials: 1,
      isActiveNow: true,
      assignedClassIds: [],
      exerciseItems: [
        { id: "item-1", moduleId: "mod-1", exerciseId: "ex-11", sequenceOrder: 1, isMandatory: true },
        { id: "item-2", moduleId: "mod-1", exerciseId: "ex-22", sequenceOrder: 2, isMandatory: false },
      ],
      materials: [],
      createdAt: "2026-10-08T00:00:00Z",
      updatedAt: "2026-10-08T00:00:00Z",
    } as const;
    vi.mocked(moduleService.getModuleById)
      .mockResolvedValueOnce(stored as never)
      .mockResolvedValueOnce({ ...stored, title: "Módulo Novo" } as never);
    vi.mocked(classService.listClasses).mockResolvedValueOnce({
      items: [],
      totalCount: 0,
      page: 1,
      limit: 50,
    });
    vi.mocked(moduleService.updateModule).mockResolvedValueOnce({} as never);
    vi.mocked(moduleService.reorderExercises).mockResolvedValueOnce({ message: "ok", reorderedCount: 2 });

    render(<EditModulePage params={Promise.resolve({ id: "mod-1" })} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Editar Módulo de Ensino" })).toBeDefined();
    });

    expect(await screen.findByText("Listar arquivos")).toBeDefined();
    expect(screen.getByText("Comando")).toBeDefined();

    // Save module update: the page stays on the module and shows the confirmation
    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), { target: { value: "Módulo Novo" } });
    const submitBtn = screen.getByRole("button", { name: "Salvar Alterações" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(moduleService.updateModule).toHaveBeenCalledWith("mod-1", expect.any(Object));
    });
    expect(await screen.findByText("Módulo atualizado com sucesso!")).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();

    // Reorder exercises
    const reorderBtn = screen.getByRole("button", { name: "Salvar Ordem" });
    fireEvent.click(reorderBtn);

    await waitFor(() => {
      expect(moduleService.reorderExercises).toHaveBeenCalledWith("mod-1", ["ex-11", "ex-22"]);
    });
  });
});
