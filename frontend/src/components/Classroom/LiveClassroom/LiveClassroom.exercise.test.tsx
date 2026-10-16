import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { END, exerciseModule, half, none, picture, round, START, terminalHarness } from "@/test/exerciseFixtures";
import { LiveClassroom } from "./LiveClassroom";

const mount = vi.hoisted(() => vi.fn());
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: mount }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  return { ModuleStage: () => React.createElement("div", { "data-testid": "module" }) };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: START };
const stageView = { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} };
let h: ReturnType<typeof terminalHarness>;

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView,
    hands: [],
    handCount: 0,
    myHand: null,
    chat: [],
    sendChat: vi.fn(() => true),
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: false,
    exercise: round(),
    watchedByTeacher: false,
    sendExerciseProgress: vi.fn(() => true),
    sendExerciseScreen: vi.fn(() => true),
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(), requestEntry: vi.fn(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value;
}

const element = () => <LiveClassroom classId="c-1" userId="u-1" session={session} />;
const strip = () => screen.getByRole("toolbar", { name: "Controles da aula" });
const areaName = { name: "Exercício ao vivo" };
const area = () => screen.findByRole("region", areaName);
const settled = () => waitFor(() => expect(screen.queryByText("Carregando o terminal…")).toBeNull());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(START) });
  localStorage.clear();
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
  h = terminalHarness(mount);
  h.set(none());
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(exerciseModule);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mount.mockReset();
  vi.restoreAllMocks();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

// SPEC-065 CA-13: the area is in the room, beside the stage and out of its box, in the place of the stage
describe("LiveClassroom, the area of the exercise", () => {
  it("puts the area in the room, as a sibling of the stage and outside its fixed box, never inside it", async () => {
    live();
    render(element());
    const found = await area();
    const stage = screen.getByTestId("fixed-stage");
    expect(stage.contains(found)).toBe(false);
    expect(screen.getByRole("main").contains(found)).toBe(true);
    expect(found.parentElement).toBe(stage.parentElement);
  });

  it("keeps the stage of the teacher mounted under the area, so the mirror loses nothing", async () => {
    live();
    render(element());
    await area();
    expect(screen.getByTestId("slides")).toBeDefined();
    live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 } });
    cleanup();
    render(element());
    await area();
    expect(screen.getByTestId("module")).toBeDefined();
  });

  it("gives the area the round, and what the student sends goes through the room", async () => {
    const l = live({ watchedByTeacher: true });
    render(element());
    await area();
    await settled();
    expect(l.sendExerciseProgress).toHaveBeenCalledWith({ runId: "r-1", met: 0, total: 2, last: "", commands: 0 }); // SPEC-071 adds the commands
    act(() => h.show(picture("oi")));
    expect(l.sendExerciseScreen).toHaveBeenCalledWith("r-1", picture("oi"));
  });

  it("has no area, no clock and no button when the class has no round, or when its result is hidden and the student did not see it run", () => {
    live({ exercise: null });
    const view = render(element());
    expect(screen.queryByRole("region", areaName)).toBeNull();
    expect(screen.queryByRole("timer", { name: "Tempo do exercício" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver a aula" })).toBeNull();
    live({ exercise: round({ status: "CLOSED", endedBy: "TIMER", endedAt: END, closedAt: END }) }); // SPEC-071: the class went back to the lesson
    view.rerender(element());
    expect(screen.queryByRole("region", areaName)).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver a aula" })).toBeNull();
  });
});

// SPEC-065 3.3: the strip has the time of the exercise and the button between the exercise and the lesson
describe("LiveClassroom, the strip while the exercise runs", () => {
  it("shows the time left of the exercise, by the clock of the server, next to the time of the class", async () => {
    live({ exercise: round({ skewMs: 30_000 }) });
    render(element());
    await area();
    expect(within(strip()).getByRole("timer", { name: "Tempo do exercício" }).textContent).toBe("04:30");
    expect(within(strip()).getByRole("timer", { name: "Tempo de aula" })).toBeDefined();
  });

  it("goes between the exercise and the lesson with one button, without stopping the exercise", async () => {
    const l = live();
    const view = render(element());
    await area();
    await settled();
    const hidden = () => screen.getByLabelText("Exercício ao vivo").hasAttribute("hidden");
    expect(hidden()).toBe(false);
    fireEvent.click(within(strip()).getByRole("button", { name: "Ver a aula" }));
    expect(hidden()).toBe(true);
    expect(within(strip()).queryByRole("button", { name: "Ver a aula" })).toBeNull();
    expect(h.win.destroy).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(within(strip()).getByRole("timer", { name: "Tempo do exercício" })).toBeDefined();
    // The stage of the teacher is the one on screen, and the exercise is still being followed.
    act(() => h.type("mkdir /dois", half()));
    expect(screen.getByText("1 de 2 condições")).toBeDefined();
    expect(l.sendExerciseProgress).toHaveBeenCalled();
    fireEvent.click(within(strip()).getByRole("button", { name: "Voltar ao exercício" }));
    expect(hidden()).toBe(false);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(h.win.destroy).not.toHaveBeenCalled();
    view.unmount();
  });

  it("brings the student back to the exercise when a new round starts", async () => {
    live();
    const view = render(element());
    await area();
    fireEvent.click(within(strip()).getByRole("button", { name: "Ver a aula" }));
    live({ exercise: round({ runId: "r-2", title: "Outra" }) });
    view.rerender(element());
    expect(await screen.findByRole("region", areaName)).toBeDefined();
    expect(within(strip()).getByRole("button", { name: "Ver a aula" })).toBeDefined();
  });

  it("takes the clock and the button away when the round ends, and tells the student in the stage", async () => {
    live();
    const view = render(element());
    await area();
    await settled();
    live({ exercise: round({ status: "CLOSED", endedBy: "TEACHER", endedAt: END, closedAt: END }) }); // SPEC-071: the class went back to the lesson
    view.rerender(element());
    expect(screen.queryByRole("region", areaName)).toBeNull();
    expect(within(strip()).queryByRole("timer", { name: "Tempo do exercício" })).toBeNull();
    expect(within(strip()).queryByRole("button", { name: "Ver a aula" })).toBeNull();
    expect(screen.getByText("Exercício encerrado")).toBeDefined();
    expect(screen.getByRole("main").contains(screen.getByText("Exercício encerrado"))).toBe(true);
    expect(screen.getByTestId("fixed-stage").contains(screen.getByText("Exercício encerrado"))).toBe(false);
  });

  it("shows the result in the stage when the teacher shows it, with no button of the strip", async () => {
    live();
    const view = render(element());
    await area();
    const result = { runId: "r-1", visible: true, completed: 1, participants: 2, scoreboard: [{ studentId: "u-1", name: "Bia", elapsedSeconds: 75, points: 30 }] };
    live({ exercise: round({ status: "ENDED", endedBy: "TIMER", endedAt: END, resultVisible: true, result }) });
    view.rerender(element());
    const region = await screen.findByRole("region", { name: "Resultado do exercício" });
    expect(screen.getByTestId("fixed-stage").contains(region)).toBe(false);
    expect(within(strip()).queryByRole("button", { name: "Ver a aula" })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Voltar à aula" }));
    expect(screen.queryByRole("region", { name: "Resultado do exercício" })).toBeNull();
  });
});

// SPEC-065 3.3: the conversation, the doubt and the full screen go on working during the exercise
describe("LiveClassroom, the rest of the room during the exercise", () => {
  it("opens the conversation beside the stage with the area still there, since the hints come by it", async () => {
    live({ chat: [{ id: "m1", scope: "private", studentId: "u-1", from: "TEACHER", text: "Use mkdir -p", createdAt: START }] });
    render(element());
    await area();
    fireEvent.click(within(strip()).getByRole("button", { name: /Conversa/ }));
    const column = screen.getByRole("complementary", { name: "Conversa com o professor" });
    expect(within(column).getByText("Use mkdir -p")).toBeDefined();
    expect(screen.getByRole("region", areaName)).toBeDefined();
  });

  it("opens the modal of the doubt over the area", async () => {
    live();
    render(element());
    const found = await area();
    fireEvent.click(within(strip()).getByRole("button", { name: "Levantar a mão" }));
    const dialog = screen.getByRole("dialog", { name: "Sua dúvida para o professor" });
    expect(found.parentElement!.contains(dialog)).toBe(true);
    expect(screen.getByTestId("fixed-stage").contains(dialog)).toBe(false);
    expect(screen.getByRole("region", areaName)).toBeDefined();
  });

  it("does not take the key F typed in the terminal for the full screen, and still does it everywhere else", async () => {
    live();
    render(element());
    await area();
    await settled();
    fireEvent.keyDown(h.screen(), { key: "f" });
    expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "f" });
    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("LiveClassroom, an old state of the room", () => {
  it("works with a room that tells nothing of the exercise", () => {
    live({ exercise: undefined, watchedByTeacher: undefined });
    render(element());
    expect(screen.queryByRole("region", areaName)).toBeNull();
    expect(within(strip()).queryByRole("button", { name: "Ver a aula" })).toBeNull();
  });
});
