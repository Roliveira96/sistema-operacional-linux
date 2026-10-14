import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { ModuleStage } from "./ModuleStage";

const topic = vi.fn();
vi.mock("@/components/TopicStudy/TopicStudy", async () => {
  const React = await import("react");
  return {
    TopicStudy: (p: { moduleId: string; live?: { role: string; focusBlockId: string | null; module: { title: string }; onRead?: unknown; onScreen?: unknown } }) => {
      topic(p);
      return React.createElement("div", { "data-testid": "topic", "data-module": p.moduleId, "data-role": p.live?.role, "data-focus": p.live?.focusBlockId ?? "" }, p.live?.module.title);
    },
  };
});

const terminal: LiveTerminal = { screen: null };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { formato: "exame-so/maquina", n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro bloco" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { html: "Segundo bloco" } },
  ],
};

afterEach(() => {
  cleanup();
  topic.mockClear();
  vi.restoreAllMocks();
});

// SPEC-055 CA-13: the module of the room is the study screen of the module, in the live-class mode
describe("ModuleStage", () => {
  it("loads the module of the room and shows it in the study screen, in the live-class mode", async () => {
    const get = vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-2" terminal={terminal} />);
    expect(screen.getByRole("status").textContent).toBe("Carregando o módulo da aula…");
    const view = await screen.findByTestId("topic");
    expect(get).toHaveBeenCalledWith("c-1");
    expect(view.getAttribute("data-module")).toBe("m-1");
    expect(view.getAttribute("data-role")).toBe("student");
    expect(view.getAttribute("data-focus")).toBe("b-2");
    expect(topic.mock.lastCall![0].live).toMatchObject({ module: module_, terminal, role: "student" });
  });

  it("gives the student no way to send anything", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} onScreen={vi.fn()} onFocusBlock={vi.fn()} />);
    await screen.findByTestId("topic");
    const { live } = topic.mock.lastCall![0];
    expect(live.onScreen).toBeUndefined();
    expect(live.onRead).toBeUndefined();
  });

  it("gives the teacher the picture of the terminal screen and the reading, straight", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const onScreen = vi.fn();
    const onFocusBlock = vi.fn();
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onScreen={onScreen} onFocusBlock={onFocusBlock} />);
    await screen.findByTestId("topic");
    const { live } = topic.mock.lastCall![0];
    expect(live.onScreen).toBe(onScreen);
    expect(live.onRead).toBe(onFocusBlock);
  });

  it("loads the module again when the module of the room changes, and not at every focus", async () => {
    const get = vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const view = render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await screen.findByTestId("topic");
    view.rerender(<ModuleStage classId="c-1" role="student" moduleFocusBlockId="b-1" terminal={terminal} />);
    expect(get).toHaveBeenCalledTimes(1);
    view.rerender(<ModuleStage classId="c-1" moduleId="m-2" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it("tells when the module cannot be loaded", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockRejectedValue(new Error("down"));
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Não foi possível carregar o módulo da aula."));
  });
});
