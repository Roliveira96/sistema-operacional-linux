import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { TeacherPanel } from "./TeacherPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../SlideThumbnails/SlideThumbnails", async () => {
  const React = await import("react");
  return { SlideThumbnails: () => React.createElement("div", { "data-testid": "thumbs" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const deck = { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" };

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, deck, strokes: [], cursor: null, online: 5, blank: false },
    admissions: { waiting: [], admitted: [] },
    onlineStudents: [],
    hands: [],
    chat: [],
    startedAt: "2026-10-14T10:00:00Z",
    presenterConnected: true,
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: true,
    changeSlide: vi.fn(), switchMode: vi.fn(), moderate: vi.fn(), acceptStudent: vi.fn(), acceptAll: vi.fn(), removeStudent: vi.fn(), focusBlock: vi.fn(),
    sendStageFullscreen: vi.fn(),
    sendChat: vi.fn(() => true),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as typeof value & { sendStageFullscreen: ReturnType<typeof vi.fn> };
}

const panel = () => render(<TeacherPanel classId="c-1" session={session} beep={vi.fn()} />);
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-14T10:05:00Z"));
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 } as never);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue({ moduleId: "m", title: "t", scenario: {}, blocks: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// SPEC-058 CA-06: the doubts of the raised hands are read in the panel
describe("TeacherPanel, the raised hands", () => {
  it("shows each hand with the name, how long ago and the doubt, as text", async () => {
    live({
      hands: [
        { studentId: "u-1", name: "Ana Souza", requestedAt: "2026-10-14T10:00:00Z", question: "Como uso o chmod?" },
        { studentId: "u-2", name: "Bruno Lima", requestedAt: "2026-10-14T10:04:30Z", question: "" },
      ],
    });
    panel();
    await flush();
    const list = within(screen.getByRole("heading", { name: "Mãos levantadas" }).closest("section")!);
    const ana = within(list.getByText("Ana Souza").closest("li")!);
    expect(ana.getByText("há 5 min")).toBeDefined();
    expect(ana.getByTestId("hand-question").textContent).toBe("Como uso o chmod?");
    const bruno = within(list.getByText("Bruno Lima").closest("li")!);
    expect(bruno.queryByTestId("hand-question")).toBeNull();
  });

  it("lowers one hand or all of them, as before", async () => {
    const l = live({ hands: [{ studentId: "u-1", name: "Ana Souza", requestedAt: "2026-10-14T10:00:00Z", question: "x" }] });
    panel();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Baixar a mão de Ana Souza" }));
    expect(l.moderate).toHaveBeenLastCalledWith("u-1");
    fireEvent.click(screen.getByRole("button", { name: "Baixar todas" }));
    expect(l.moderate).toHaveBeenLastCalledWith(undefined);
  });
});

// SPEC-059 CA-01: the button that puts the students in full screen, in the block that controls the class
describe("TeacherPanel, the full screen for the students", () => {
  const block = () => within(screen.getByRole("region", { name: "Controle da aula" }));

  it("has the button in the block that controls the class, off at first, with the state in view", async () => {
    live();
    panel();
    await flush();
    const button = block().getByRole("button", { name: "Tela cheia para os alunos" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(block().getByText("Desligada")).toBeDefined();
    expect(block().queryByText("Ligada")).toBeNull();
  });

  it("explains that the students go full screen at the first touch, if the browser asks for it", async () => {
    live();
    panel();
    await flush();
    expect(block().getByText(/ao primeiro toque, se o navegador pedir/)).toBeDefined();
  });

  it("turns the request on with a click, and sends it", async () => {
    const l = live();
    panel();
    await flush();
    fireEvent.click(block().getByRole("button", { name: "Tela cheia para os alunos" }));
    expect(l.sendStageFullscreen).toHaveBeenCalledTimes(1);
    expect(l.sendStageFullscreen).toHaveBeenCalledWith(true);
  });

  it("shows it on, as the room tells, and turns it off with a click", async () => {
    const l = live({ fullscreenRequested: true });
    panel();
    await flush();
    const button = block().getByRole("button", { name: "Tela cheia para os alunos" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(block().getByText("Ligada")).toBeDefined();
    expect(block().queryByText("Desligada")).toBeNull();
    fireEvent.click(button);
    expect(l.sendStageFullscreen).toHaveBeenCalledWith(false);
  });

  it("follows the room when the request is turned on or off from the presentation window", async () => {
    live({ fullscreenRequested: false });
    const view = panel();
    await flush();
    expect(block().getByText("Desligada")).toBeDefined();
    live({ fullscreenRequested: true });
    view.rerender(<TeacherPanel classId="c-1" session={session} beep={vi.fn()} />);
    expect(block().getByText("Ligada")).toBeDefined();
    expect(block().getByRole("button", { name: "Tela cheia para os alunos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("cannot be used by a panel that lost the control", async () => {
    live({ canControl: false, passive: true });
    panel();
    await flush();
    expect((block().getByRole("button", { name: "Tela cheia para os alunos" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
