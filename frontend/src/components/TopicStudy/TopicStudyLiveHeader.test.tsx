import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import { LiveTopicScreen, type TopicLive } from "@/components/TopicStudy/LiveTopicScreen";
import type { LiveModuleContent } from "@/services/classroomService";

// The terminal engine is not loaded: the teacher's window is mounted by a stand-in, and the copy of the student never mounts it.
vi.mock("@/engine/terminalWindow", () => ({ mountTerminalWindow: vi.fn() }));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [{ id: "b-1", type: "TEXT", position: 0, payload: { title: "Primeiro", command: "Um", html: "<p>Primeiro bloco</p>" } }],
};

const STARTED = "2026-10-14T10:00:00Z";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T11:05:30Z"));
  vi.mocked(mountTerminalWindow).mockImplementation(async (container) => {
    const window_ = document.createElement("div");
    window_.className = "janela";
    container.append(window_);
    return { setSpeed: vi.fn(), destroy: vi.fn() } as never;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const screenOf = (over: Partial<TopicLive> = {}) => {
  const live: TopicLive = { module: module_, role: "student", terminal: { screen: null }, focusBlockId: null, startedAt: STARTED, handCount: 0, ...over };
  return <LiveTopicScreen live={live} />;
};

const head = () => document.querySelector("header") as HTMLElement;

/** The tag and the classes of an element: what can be compared between two screens, with no layout to measure. */
const nameOf = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).join(".")}`;
const flowOf = (el: Element): unknown => [nameOf(el), el.getAttribute("role"), ...Array.from(el.children).map(flowOf)];

// SPEC-058 CA-01, CA-02: the header of the module in the live class
describe("the header of the module in the live class", () => {
  it("shows the time of the class and the raised hands on the right of the title", () => {
    render(screenOf({ handCount: 2 }));
    const bar = within(head());
    expect(bar.getByRole("heading", { level: 1, name: "Permissões de arquivos" })).toBeDefined();
    expect(bar.getByRole("timer", { name: "Tempo de aula" }).textContent).toBe("01:05:30");
    expect(bar.getByRole("img", { name: "2 mãos levantadas" }).textContent).toBe("2");
    const title = head().querySelector("h1")!;
    const timer = bar.getByRole("timer");
    const hands = bar.getByRole("img", { name: "2 mãos levantadas" });
    expect(title.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timer.compareDocumentPosition(hands) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says 0 when the room tells no number of hands", () => {
    render(screenOf({ handCount: undefined }));
    expect(within(head()).getByRole("img", { name: "0 mãos levantadas" }).textContent).toBe("0");
  });

  // CA-02
  it("follows the raised hands as they go up and down, and the clock as it runs", () => {
    const view = render(screenOf({ handCount: 1 }));
    expect(within(head()).getByRole("img", { name: "1 mão levantada" })).toBeDefined();
    view.rerender(screenOf({ handCount: 3 }));
    expect(within(head()).getByRole("img", { name: "3 mãos levantadas" })).toBeDefined();
    view.rerender(screenOf({ handCount: 0 }));
    expect(within(head()).getByRole("img", { name: "0 mãos levantadas" })).toBeDefined();
    act(() => void vi.advanceTimersByTime(2000));
    expect(within(head()).getByRole("timer").textContent).toBe("01:05:32");
  });

  it("corrects the clock when the room tells another start", () => {
    const view = render(screenOf());
    view.rerender(screenOf({ startedAt: "2026-10-14T11:00:00Z" }));
    expect(within(head()).getByRole("timer").textContent).toBe("00:05:30");
  });

  // CA-01: the same for the teacher and for the student, which CA-22 of SPEC-057 asks of everything in the stage
  it("is the same for the teacher and for the student", async () => {
    const teacher = render(screenOf({ role: "teacher", handCount: 2 }));
    await waitFor(() => expect(teacher.container.querySelector(".janela")).not.toBeNull());
    const teacherHeader = flowOf(head());
    const teacherText = head().textContent;
    teacher.unmount();
    const student = render(screenOf({ role: "student", handCount: 2 }));
    expect(flowOf(head())).toEqual(teacherHeader);
    expect(head().textContent).toBe(teacherText);
    student.unmount();
  });

  // CA-09: the room gives no start, as in the screens that are not a live class: the header is the one it always was
  it("shows only the title when the room tells no start", () => {
    render(screenOf({ startedAt: undefined, handCount: 4 }));
    expect(within(head()).getByRole("heading", { level: 1 })).toBeDefined();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("img", { name: /mão|mãos/ })).toBeNull();
  });
});
