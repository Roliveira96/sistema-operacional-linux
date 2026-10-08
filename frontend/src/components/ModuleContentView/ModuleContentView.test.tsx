import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentMessages as m } from "@/messages/content.pt-BR";
import type { CourseModuleDetails } from "@/services/moduleService";
import { problem } from "@/test/helpers";
import { ModuleContentView } from "./ModuleContentView";

afterEach(cleanup);

const module = {
  id: "m1",
  title: "Navegação e diretórios",
  description: "pwd, ls, cd",
  icon: "📁",
  color: "--cor-dir",
} as CourseModuleDetails;

function content(overrides: Partial<{ blocks: unknown; questions: unknown }> = {}) {
  return {
    blocks: vi.fn().mockImplementation(async () => {
      if (overrides.blocks instanceof Error) throw overrides.blocks;
      return [{ id: "b", type: "TEXT", position: 1, payload: { html: "conteúdo do módulo" } }];
    }),
    questions: vi.fn().mockResolvedValue(
      overrides.questions ?? [{ id: "q", kind: "PRACTICAL", usage: "EXERCISE", difficulty: "EASY", title: "t", statement: "Crie <b>/a</b>", hint: "use mkdir" }],
    ),
  };
}

const modules = { getModuleById: vi.fn().mockResolvedValue(module) };

// Covers SPEC-012 CA-02.
describe("ModuleContentView", () => {
  it("renders the module, its blocks and its exercises", async () => {
    const svc = content();
    const { container } = render(<ModuleContentView moduleId="m1" backHref="/materials" content={svc} modules={modules} />);
    expect(screen.getByRole("status").textContent).toBe(m.loading);
    expect(await screen.findByRole("heading", { level: 1, name: /Navegação e diretórios/ })).toBeTruthy();
    expect(screen.getByText("conteúdo do módulo")).toBeTruthy();
    expect(screen.getByText("/a").tagName).toBe("B");
    expect(screen.getByText(m.difficulty.EASY!)).toBeTruthy();
    expect(svc.questions).toHaveBeenCalledWith("m1", "EXERCISE");
    expect((container.querySelector("article") as HTMLElement).style.getPropertyValue("--module-accent")).toBe("var(--color-module-dir)");
  });

  it("explains when there are no exercises", async () => {
    render(<ModuleContentView moduleId="m1" backHref="/materials" content={content({ questions: [] })} modules={{ getModuleById: vi.fn().mockResolvedValue({ ...module, color: undefined }) }} />);
    expect(await screen.findByText(m.noExercises)).toBeTruthy();
  });

  // Covers SPEC-012 CA-03 at the interface level.
  it.each([
    [problem("module-not-found", 404), m.notFound, false],
    [problem("not-authenticated", 401), m.needsLogin, true],
    [problem("forbidden", 403), m.forbidden, false],
    [new Error("offline"), m.unexpected, false],
  ])("shows an explanation for %s", async (error, message, login) => {
    render(<ModuleContentView moduleId="m1" backHref="/materials" content={content({ blocks: error })} modules={modules} />);
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByRole("link", { name: m.goToLogin }) !== null).toBe(login);
  });

  it.each(["light", "dark"])("renders the same structure in the %s theme", async (theme) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<ModuleContentView moduleId="m1" backHref="/materials" content={content()} modules={modules} />);
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelectorAll("article > header, article > section")).toHaveLength(2);
  });
});
