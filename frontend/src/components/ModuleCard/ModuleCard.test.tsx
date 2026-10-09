import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ModuleCard } from "./ModuleCard";
import type { CourseModuleSummary } from "@/services/moduleService";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mockModule: CourseModuleSummary = {
  id: "mod-123",
  teacherId: "teacher-1",
  title: "Processos e Concorrência",
  description: "Estudo detalhado do escalonamento de processos.",
  visibility: "PUBLIC",
  status: "ACTIVE",
  totalExercises: 5,
  totalMaterials: 3,
  isActiveNow: true,
  createdAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
};

describe("ModuleCard", () => {
  it("renders module basic details and counters without management badges", () => {
    render(<ModuleCard module={mockModule} />);

    expect(screen.getByText("Processos e Concorrência")).toBeDefined();
    expect(screen.getByText("Estudo detalhado do escalonamento de processos.")).toBeDefined();
    expect(screen.queryByText("Público")).toBeNull();
    expect(screen.getByText("3 materiais")).toBeDefined();
    expect(screen.getByText("5 exercícios")).toBeDefined();
  });

  // Covers SPEC-015 CA-04.
  it("renders the prototype card: order, icon, accent, tags and a card-wide link", () => {
    const legacy: CourseModuleSummary = {
      ...mockModule,
      description: "pwd · ls · cd — Onde estou e o que tem aqui.",
      icon: "📁",
      color: "--cor-dir",
      displayOrder: 3,
    };
    render(<ModuleCard module={legacy} href="/materials/mod-123" />);

    expect(screen.getByText("03")).toBeDefined();
    expect(screen.getByText("📁")).toBeDefined();
    expect(screen.getByText("Onde estou e o que tem aqui.")).toBeDefined();
    const tags = screen.getByRole("list", { name: "Comandos e conceitos do módulo" });
    expect(Array.from(tags.querySelectorAll("code")).map((c) => c.textContent)).toEqual(["pwd", "ls", "cd"]);
    expect(screen.getByTestId("module-card-mod-123").getAttribute("style")).toContain("--module-accent: var(--color-module-dir)");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toBe("Processos e Concorrência");
    expect(links[0]!.getAttribute("href")).toBe("/materials/mod-123");
    expect(screen.getByText("Estudar →")).toBeDefined();
  });

  it("renders expired badge and alert when active but not active now", () => {
    const expiredMod: CourseModuleSummary = {
      ...mockModule,
      isActiveNow: false,
    };

    render(<ModuleCard module={expiredMod} />);

    expect(screen.getByText("Vigência expirada")).toBeDefined();
    expect(
      screen.getByText("Este módulo expirou e não está mais acessível para discentes.")
    ).toBeDefined();
  });

  it("renders management controls and triggers toggle callback", () => {
    const handleToggle = vi.fn();
    render(<ModuleCard module={mockModule} canManage onToggleStatus={handleToggle} />);

    expect(screen.getByText("Público")).toBeDefined();
    expect(screen.getByText("Ativo")).toBeDefined();

    const toggleBtn = screen.getByRole("button", { name: "Desativar" });
    expect(toggleBtn).toBeDefined();
    fireEvent.click(toggleBtn);
    expect(handleToggle).toHaveBeenCalledWith(mockModule);

    const editLink = screen.getByRole("link", { name: "Editar" });
    expect(editLink.getAttribute("href")).toBe("/app/modules/mod-123/edit");
  });
});
