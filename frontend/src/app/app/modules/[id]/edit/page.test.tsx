import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classService } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import EditModulePage from "./page";

vi.mock("@/services/moduleService", () => ({
  moduleService: {
    getModuleById: vi.fn(),
    updateModule: vi.fn(),
  },
}));

vi.mock("@/services/contentAuthoringService", () => ({
  contentAuthoringService: {
    list: vi.fn().mockResolvedValue([
      { id: "b-1", type: "COMMAND", position: 1, edited: false, active: true, updatedAt: "2026-10-09T12:00:00Z", payload: { steps: [{ command: "ls -la" }] } },
    ]),
    content: vi.fn().mockResolvedValue({ blocks: [], setup: undefined }),
  },
}));

vi.mock("@/services/moduleExerciseService", () => ({
  moduleExerciseService: { bank: vi.fn().mockResolvedValue({ items: [] }) },
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
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EditModulePage (/app/modules/:id/edit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads module and classes, allows updating the module and opens the bank of exercises", async () => {
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

    render(<EditModulePage params={Promise.resolve({ id: "mod-1" })} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Editar Módulo de Ensino" })).toBeDefined();
    });

    // The blocks live in the "Conteúdo" tab and the exercise order in "Exercícios".
    fireEvent.click(screen.getByRole("tab", { name: "Conteúdo" }));
    expect(await screen.findByText("Introdução")).toBeDefined();
    expect(screen.getByRole("link", { name: "+ Novo card" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Ações do card 1" })).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Detalhes" }));

    // Save module update: the page stays on the module and shows the confirmation
    fireEvent.change(screen.getByLabelText(/Título do Módulo/i), { target: { value: "Módulo Novo" } });
    const submitBtn = screen.getByRole("button", { name: "Salvar Alterações" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(moduleService.updateModule).toHaveBeenCalledWith("mod-1", expect.any(Object));
    });
    expect(await screen.findByText("Módulo atualizado com sucesso!")).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();

    // The tab of the exercises is the bank of the module (SPEC-023).
    fireEvent.click(screen.getByRole("tab", { name: "Exercícios" }));
    expect(await screen.findByRole("heading", { name: "Banco de exercícios do módulo" })).toBeDefined();
    expect(screen.getByRole("button", { name: /Testar Banco de Exercícios/ })).toBeDefined();
    expect(screen.getAllByRole("link", { name: "Criar nova questão" }).map((l) => l.getAttribute("href"))).toContain("/app/modules/mod-1/exercises/new");
  });
});
