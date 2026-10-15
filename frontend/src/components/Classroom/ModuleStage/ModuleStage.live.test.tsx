import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import { ModuleStage } from "./ModuleStage";

const topic = vi.fn();
vi.mock("@/components/TopicStudy/TopicStudy", async () => {
  const React = await import("react");
  return {
    TopicStudy: (p: { live?: unknown }) => {
      topic(p);
      return React.createElement("div", { "data-testid": "topic" });
    },
  };
});

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: {},
  blocks: [{ id: "b-1", type: "TEXT", position: 0, payload: { html: "Primeiro bloco" } }],
};

afterEach(() => {
  cleanup();
  topic.mockClear();
  vi.restoreAllMocks();
});

// SPEC-058 CA-01: the header of the module tells the time of the class and the raised hands, for the teacher and for the student
describe("ModuleStage, for the header of the live class", () => {
  it.each(["teacher", "student"] as const)("gives the screen of the module, for the %s, the start of the class and the number of raised hands", async (role) => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role={role} moduleFocusBlockId={null} terminal={{ screen: null }} startedAt="2026-10-14T10:00:00Z" handCount={3} />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live).toMatchObject({ startedAt: "2026-10-14T10:00:00Z", handCount: 3 });
  });

  // SPEC-062 CA-01: the click of the hand is the student's; the teacher's header stays an indicator
  it("gives the student the click of the hand and whether the hand is up, so the hand of the header is a button", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    const onHand = vi.fn();
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={{ screen: null }} startedAt="2026-10-14T10:00:00Z" handCount={1} onHand={onHand} handRaised />);
    await screen.findByTestId("topic");
    const live = topic.mock.lastCall![0].live;
    expect(live.handRaised).toBe(true);
    live.onHand();
    expect(onHand).toHaveBeenCalledTimes(1);
  });

  it("gives the teacher no click of the hand, even when it is given one", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="teacher" moduleFocusBlockId={null} terminal={{ screen: null }} startedAt="2026-10-14T10:00:00Z" handCount={1} onHand={vi.fn()} handRaised />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live.onHand).toBeUndefined();
  });

  it("gives no start when the room has none yet, so the header stays the title only", async () => {
    vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
    render(<ModuleStage classId="c-1" role="student" moduleFocusBlockId={null} terminal={{ screen: null }} />);
    await screen.findByTestId("topic");
    expect(topic.mock.lastCall![0].live.startedAt).toBeUndefined();
  });
});
