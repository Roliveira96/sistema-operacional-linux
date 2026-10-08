import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { moduleService } from "@/services/moduleService";
import { ptBR } from "@/messages/pt-BR";
import MaterialsPage from "./page";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    listPublicModules: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

afterEach(cleanup);

describe("MaterialsPage (/materials)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header, search bar, and public modules", async () => {
    vi.mocked(moduleService.listPublicModules).mockResolvedValueOnce({
      items: [
        {
          id: "mod-1",
          teacherId: "t-1",
          title: "Sistemas de Arquivos",
          description: "Estrutura do VFS",
          visibility: "PUBLIC",
          status: "ACTIVE",
          totalExercises: 3,
          totalMaterials: 2,
          isActiveNow: true,
          createdAt: "2026-10-08T00:00:00Z",
          updatedAt: "2026-10-08T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 10,
    });

    render(<MaterialsPage />);

    expect(screen.getByRole("heading", { level: 1, name: ptBR.modules.publicTitle })).toBeDefined();
    expect(screen.getByText(ptBR.modules.publicSubtitle)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText("Sistemas de Arquivos")).toBeDefined();
      expect(screen.getByText("Estrutura do VFS")).toBeDefined();
    });
  });

  it.each(["light", "dark"])("renders consistently under %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    vi.mocked(moduleService.listPublicModules).mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      limit: 10,
    });

    const { container } = render(<MaterialsPage />);

    await waitFor(() => {
      expect(container.querySelector("header")).toBeTruthy();
      expect(container.querySelector("main")).toBeTruthy();
      expect(container.querySelector("footer")).toBeTruthy();
    });
  });
});
