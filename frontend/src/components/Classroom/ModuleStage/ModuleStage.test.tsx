import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { ModuleStage } from "./ModuleStage";

const mirrored = vi.fn();
vi.mock("../MirroredModuleView/MirroredModuleView", async () => {
  const React = await import("react");
  return {
    MirroredModuleView: (p: { role: string; initialState?: unknown }) => {
      mirrored(p);
      return React.createElement("div", { "data-testid": "terminal", "data-role": p.role });
    },
  };
});
vi.mock("@/components/ContentRenderer/ContentRenderer", async () => {
  const React = await import("react");
  return {
    ContentRenderer: ({ blocks }: { blocks: Array<{ id: string; payload: { html?: string } }> }) =>
      React.createElement("div", null, blocks.map((b) => React.createElement("p", { key: b.id }, b.payload.html))),
  };
});

const terminal: LiveTerminal = { input: null, entries: [], state: null, revision: 0 };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { formato: "exame-so/maquina", n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro bloco" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { html: "Segundo bloco" } },
  ],
};

beforeEach(() => {
  mirrored.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// SPEC-054 CA-11 and CA-13
describe("ModuleStage", () => {
  it("shows the module of the room, read only, with the terminal on the machine of the module", async () => {
    const get = vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    expect(await screen.findByRole("heading", { name: "Permissões de arquivos" })).toBeDefined();
    expect(get).toHaveBeenCalledWith("c-1");
    expect(screen.getByText("Primeiro bloco")).toBeDefined();
    expect(screen.getByText("Segundo bloco")).toBeDefined();
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("student");
    expect(mirrored).toHaveBeenLastCalledWith(expect.objectContaining({ initialState: module_.scenario, role: "student" }));
    expect(screen.queryByRole("button", { name: /Colocar o bloco/ })).toBeNull();
  });

  it("highlights the block in focus and takes the student's eyes to it", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const view = render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-2" terminal={terminal} />);
    await screen.findByText("Segundo bloco");
    const focused = screen.getByText("Segundo bloco").closest("[data-block-id]")!;
    expect(focused.getAttribute("data-block-id")).toBe("b-2");
    expect(focused.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Primeiro bloco").closest("[data-block-id]")!.getAttribute("aria-current")).toBeNull();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-1" terminal={terminal} />);
    expect(screen.getByText("Primeiro bloco").closest("[data-block-id]")!.getAttribute("aria-current")).toBe("true");
  });

  it("lets the teacher put a block in focus", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const onFocusBlock = vi.fn();
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onFocusBlock={onFocusBlock} />);
    await screen.findByText("Primeiro bloco");
    fireEvent.click(screen.getAllByRole("button", { name: "Colocar este bloco em foco" })[1]!);
    expect(onFocusBlock).toHaveBeenCalledWith("b-2");
    expect(screen.getByTestId("terminal").getAttribute("data-role")).toBe("teacher");
  });

  it("tells when the module cannot be loaded", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockRejectedValue(new Error("down"));
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o módulo da aula."));
  });
});
