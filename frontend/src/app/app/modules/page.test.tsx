import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { moduleService } from "@/services/moduleService";
import ModulesPage from "./page";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    listModules: vi.fn(),
    updateModule: vi.fn(),
    reorderModules: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ModulesPage (/app/modules)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page header, filters, and module cards", async () => {
    vi.mocked(moduleService.listModules).mockResolvedValueOnce({
      items: [
        {
          id: "m-1",
          teacherId: "t-1",
          title: "Módulo de VFS",
          description: "Sistema Virtual de Arquivos",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 4,
          totalMaterials: 2,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    render(<ModulesPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Módulos de Ensino" })).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Módulo de VFS")).toBeDefined();
      expect(screen.getByText("Sistema Virtual de Arquivos")).toBeDefined();
    });
  });

  it("toggles module status when toggle button is clicked", async () => {
    vi.mocked(moduleService.listModules).mockResolvedValue({
      items: [
        {
          id: "m-1",
          teacherId: "t-1",
          title: "Módulo de VFS",
          description: "Desc",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 0,
          totalMaterials: 0,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    vi.mocked(moduleService.updateModule).mockResolvedValue({} as never);

    render(<ModulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Módulo de VFS")).toBeDefined();
    });

    const toggleBtn = screen.getByRole("button", { name: "Desativar" });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(moduleService.updateModule).toHaveBeenCalledWith("m-1", { status: "INACTIVE" });
    });
  });

  it("toggles reorder mode and saves new module order", async () => {
    vi.mocked(moduleService.listModules).mockResolvedValue({
      items: [
        {
          id: "m-1",
          teacherId: "t-1",
          title: "Módulo 1",
          description: "Desc 1",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 0,
          totalMaterials: 0,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
        {
          id: "m-2",
          teacherId: "t-1",
          title: "Módulo 2",
          description: "Desc 2",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 0,
          totalMaterials: 0,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
      ],
      total: 2,
      page: 1,
      limit: 50,
    });
    vi.mocked(moduleService.reorderModules).mockResolvedValue({ message: "ok", reorderedCount: 2 });

    render(<ModulesPage />);

    await waitFor(() => {
      expect(screen.getByText("Módulo 1")).toBeDefined();
    });

    const editOrderBtn = screen.getByRole("button", { name: "Editar Ordem" });
    fireEvent.click(editOrderBtn);

    const saveOrderBtn = screen.getByRole("button", { name: "Salvar Ordem" });
    expect(saveOrderBtn).toBeDefined();

    fireEvent.click(saveOrderBtn);

    await waitFor(() => {
      expect(moduleService.reorderModules).toHaveBeenCalledWith(["m-1", "m-2"]);
    });
  });
});
