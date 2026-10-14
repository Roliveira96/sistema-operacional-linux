import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { ModuleStage } from "./ModuleStage";

const topic = vi.fn();
vi.mock("@/components/TopicStudy/TopicStudy", async () => {
  const React = await import("react");
  return {
    TopicStudy: (p: { moduleId: string; live?: { role: string } }) => {
      topic(p);
      return React.createElement("div", { "data-testid": "topic", "data-role": p.live?.role });
    },
  };
});

const terminal: LiveTerminal = { screen: null };
const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { formato: "exame-so/maquina", n: 1 },
  blocks: [{ id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro bloco" } }],
};

afterEach(() => {
  cleanup();
  topic.mockClear();
  vi.restoreAllMocks();
});

// SPEC-060 CA-04: the teacher is told, in the window of the presentation, when an example cannot run; the student has no way to tell anything
describe("ModuleStage: the example that cannot run", () => {
  it("gives the teacher's study screen the way to tell that an example could not run, straight", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const onRunFailed = vi.fn();
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} onRunFailed={onRunFailed} />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live.onRunFailed).toBe(onRunFailed);
  });

  it("gives the student no way to tell it", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={terminal} onRunFailed={vi.fn()} />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live.onRunFailed).toBeUndefined();
  });

  it("works with no handler for it", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={terminal} />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live.onRunFailed).toBeUndefined();
  });
});
