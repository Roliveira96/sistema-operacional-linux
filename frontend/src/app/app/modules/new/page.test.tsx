import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classService } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import NewModulePage from "./page";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    createModule: vi.fn(),
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

describe("NewModulePage (/app/modules/new)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders form, loads classes, and creates module", async () => {
    vi.mocked(classService.listClasses).mockResolvedValueOnce({
      items: [
        {
          id: "cls-1",
          name: "Sistemas Operacionais",
          semester: "2026/2",
        } as never,
      ],
      totalCount: 1,
      page: 1,
      limit: 50,
    });
    vi.mocked(moduleService.createModule).mockResolvedValueOnce({} as never);

    render(<NewModulePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Criar Novo Módulo de Ensino" })).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), {
      target: { value: "Módulo Gerenciamento de Memória" },
    });
    fireEvent.change(screen.getByLabelText(/Descrição e Ementa/i), {
      target: { value: "Paginação e segmentação" },
    });

    const submitBtn = screen.getByRole("button", { name: "Criar Módulo" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(moduleService.createModule).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Módulo Gerenciamento de Memória",
          description: "Paginação e segmentação",
          visibility: "PUBLIC",
        })
      );
      expect(mockPush).toHaveBeenCalledWith("/app/modules");
    });
  });
});
