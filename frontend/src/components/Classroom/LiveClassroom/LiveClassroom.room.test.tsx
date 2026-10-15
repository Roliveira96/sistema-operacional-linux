import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "./LiveClassroom";

const styleOf = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const styles = styleOf("./LiveClassroom.module.scss");

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { startedAt?: string | null; handCount?: number; onHand?(): void; handRaised?: boolean };
  return {
    ModuleStage: (p: P) =>
      React.createElement(
        "div",
        { "data-testid": "module", "data-started-at": p.startedAt ?? "", "data-hand-count": String(p.handCount), "data-hand-click": String(Boolean(p.onHand)), "data-hand-raised": String(p.handRaised) },
        p.onHand ? React.createElement("button", { onClick: p.onHand }, "mão do cabeçalho") : null,
      ),
  };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }, React.createElement("textarea", { "aria-label": "caderno" })) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const me = { studentId: "u-1", name: "Bia", requestedAt: "2026-10-14T10:02:00Z" };
const other = { studentId: "u-9", name: "Ana", requestedAt: "2026-10-14T10:01:00Z" };
const stageView = (fullscreen = false) => ({ slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {}, fullscreen });

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView: stageView(),
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
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(), requestEntry: vi.fn(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value as typeof value & { raiseHand: ReturnType<typeof vi.fn>; lowerHand: ReturnType<typeof vi.fn> };
}

const element = () => <LiveClassroom classId="c-1" userId="u-1" session={session} />;
const strip = () => screen.getByRole("toolbar", { name: "Controles da aula" });
const flush = () => act(async () => undefined);

beforeEach(() => {
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

const MODULE_ROOM = { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 };

// SPEC-062: the hand and the doubt, in a modal that is in the full screen too
describe("the hand and the doubt, in the modal of the student", () => {
  const dialog = () => screen.queryByRole("dialog", { name: "Sua dúvida para o professor" });
  const field = () => within(dialog()!).getByRole("textbox", { name: "Escreva sua dúvida (opcional)" }) as HTMLInputElement;
  const headerHand = () => screen.getByRole("button", { name: "mão do cabeçalho" });
  const stageBox = () => screen.getByTestId("fixed-stage").parentElement as HTMLElement;

  // CA-06: the button of the strip raises the hand with one click, as before, and opens the modal
  it("raises the hand with one click and no text from the strip, and opens the modal for the doubt", () => {
    const l = live();
    render(element());
    expect(dialog()).toBeNull();
    fireEvent.click(within(strip()).getByRole("button", { name: "Levantar a mão" }));
    expect(l.raiseHand).toHaveBeenCalledTimes(1);
    expect(l.raiseHand).toHaveBeenCalledWith();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("has no modal and no field while the hand is down and nobody asked for it", () => {
    live();
    render(element());
    expect(dialog()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Escreva sua dúvida (opcional)" })).toBeNull();
  });

  // CA-06: the field is not in the strip any more; the strip keeps the state of the hand and the place in the line
  it("keeps no field in the strip with the hand up, only that the hand is up and the place in the line", () => {
    live({ hands: [other, me], myHand: { raised: true, question: "Como uso o chmod?" } });
    render(element());
    expect(within(strip()).queryByRole("textbox")).toBeNull();
    expect(within(strip()).queryByRole("button", { name: "Enviar dúvida" })).toBeNull();
    expect(within(strip()).getByText("Sua mão está levantada.")).toBeDefined();
    expect(within(strip()).getByText("2º na fila")).toBeDefined();
    expect(within(strip()).getByRole("button", { name: "Abaixar a mão" })).toBeDefined();
    // Coming back with the hand up does not open the modal by itself.
    expect(dialog()).toBeNull();
  });

  // CA-01, CA-02: the hand of the header is the click of the student
  it("gives the module the click of the hand and whether the hand of the student is up", () => {
    live({ room: MODULE_ROOM });
    const view = render(element());
    expect(screen.getByTestId("module").getAttribute("data-hand-click")).toBe("true");
    expect(screen.getByTestId("module").getAttribute("data-hand-raised")).toBe("false");
    live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "" } });
    view.rerender(element());
    expect(screen.getByTestId("module").getAttribute("data-hand-raised")).toBe("true");
  });

  it("raises the hand, with no text, and opens the modal when the hand of the header is clicked with the hand down", () => {
    const l = live({ room: MODULE_ROOM });
    render(element());
    fireEvent.click(headerHand());
    expect(l.raiseHand).toHaveBeenCalledTimes(1);
    expect(l.raiseHand).toHaveBeenCalledWith();
    expect(dialog()).not.toBeNull();
    expect(field().value).toBe("");
  });

  // CA-03
  it("only opens the modal, with the doubt the room has, when the hand of the header is clicked with the hand up", () => {
    const l = live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "Como uso o chmod?" } });
    render(element());
    fireEvent.click(headerHand());
    expect(l.raiseHand).not.toHaveBeenCalled();
    expect(field().value).toBe("Como uso o chmod?");
    expect(within(dialog()!).getByText("Dúvida enviada")).toBeDefined();
  });

  // CA-04
  it("sends the doubt from the modal, edited and sent again, and keeps the modal open", () => {
    const l = live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "" } });
    render(element());
    fireEvent.click(headerHand());
    fireEvent.change(field(), { target: { value: "Como uso o chmod?" } });
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Enviar dúvida" }));
    expect(l.raiseHand).toHaveBeenLastCalledWith("Como uso o chmod?");
    fireEvent.change(field(), { target: { value: "E o chown?" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.raiseHand).toHaveBeenLastCalledWith("E o chown?");
    expect(dialog()).not.toBeNull();
  });

  it("closes with the button or Esc and leaves the hand up", () => {
    const l = live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "" } });
    render(element());
    fireEvent.click(headerHand());
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Fechar" }));
    expect(dialog()).toBeNull();
    fireEvent.click(headerHand());
    fireEvent.keyDown(dialog()!, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(l.lowerHand).not.toHaveBeenCalled();
  });

  it("lowers the hand and closes with the button of the modal", () => {
    const l = live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "Como uso o chmod?" } });
    render(element());
    fireEvent.click(headerHand());
    fireEvent.click(within(dialog()!).getByRole("button", { name: "Abaixar a mão" }));
    expect(l.lowerHand).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("lowers the hand and closes the modal with the button of the strip too", () => {
    const l = live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "" } });
    render(element());
    fireEvent.click(headerHand());
    expect(dialog()).not.toBeNull();
    fireEvent.click(within(strip()).getByRole("button", { name: "Abaixar a mão" }));
    expect(l.lowerHand).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("closes the modal when the hand goes down by the teacher, and starts empty when the student raises it again", () => {
    live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "dúvida velha" } });
    const view = render(element());
    fireEvent.click(headerHand());
    expect(field().value).toBe("dúvida velha");
    live({ room: MODULE_ROOM, hands: [], myHand: { raised: false, question: "" } });
    view.rerender(element());
    expect(dialog()).toBeNull();
    live({ room: MODULE_ROOM, hands: [me], myHand: { raised: true, question: "" } });
    view.rerender(element());
    fireEvent.click(headerHand());
    expect(field().value).toBe("");
  });

  // CA-07: the modal is in the room of the stage, not in the box of the stage the teacher sees
  it("is over the room of the stage, outside the box of the stage, so the stage of the others does not change", () => {
    live({ room: MODULE_ROOM });
    render(element());
    fireEvent.click(headerHand());
    expect(stageBox().contains(dialog())).toBe(true);
    expect(screen.getByTestId("fixed-stage").contains(dialog())).toBe(false);
  });

  // CA-05: in every full screen, the hand of the header and the modal are inside what the browser shows (SPEC-063 CA-09: the whole room)
  it("is inside the room that the button of the full screen takes to the full screen, which is all the browser shows", () => {
    live({ room: MODULE_ROOM });
    const view = render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    const asked = vi.mocked(Element.prototype.requestFullscreen).mock.contexts[0] as HTMLElement;
    expect(asked).toBe(screen.getByRole("main"));
    // The hand of the header is in that room, so it is on the screen; the modal opens in it as well, and in no portal outside the room.
    expect(asked.contains(screen.getByTestId("module"))).toBe(true);
    fireEvent.click(headerHand());
    expect(asked.contains(dialog())).toBe(true);
    expect(view.container.contains(dialog())).toBe(true);
  });

  it("is inside the room that the request of the teacher takes to the full screen", () => {
    live({ room: MODULE_ROOM, fullscreenRequested: true, stageView: stageView(true) });
    const view = render(element());
    fireEvent.click(headerHand());
    expect(screen.getByRole("main").contains(dialog())).toBe(true);
    expect(view.container.contains(dialog())).toBe(true);
  });
});

// SPEC-058: the header of the module
describe("the header of the module, for the student", () => {
  // CA-01: the header of the module, as the room tells it, the same for everybody
  it("gives the module, for its header, the start of the class as the room tells it and the number of raised hands", () => {
    live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 }, startedAt: "2026-10-14T09:30:00Z", handCount: 3 });
    render(element());
    expect(screen.getByTestId("module").getAttribute("data-started-at")).toBe("2026-10-14T09:30:00Z");
    expect(screen.getByTestId("module").getAttribute("data-hand-count")).toBe("3");
  });

  it("falls back to the start the page was given while no snapshot has come", () => {
    live({ room: { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 }, handCount: 0 });
    render(element());
    expect(screen.getByTestId("module").getAttribute("data-started-at")).toBe(session.startedAt);
    expect(screen.getByTestId("module").getAttribute("data-hand-count")).toBe("0");
  });
});

// SPEC-059: the full screen that the teacher asks for
describe("the full screen that the teacher asks for", () => {
  const room = () => screen.getByRole("main");
  const request = () => screen.queryByRole("button", { name: "Entrar em tela cheia (pedido do professor)" });
  const enter = () => vi.mocked(Element.prototype.requestFullscreen);
  /** What the browser does when the full screen is entered or left: it tells the document. */
  const browserIsFullscreenOn = (el: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: el });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
  };
  const asked = (on: boolean) => live({ fullscreenRequested: on, stageView: stageView(on) });
  const refuseOnce = () => enter().mockRejectedValueOnce(new TypeError("Fullscreen request denied: no user gesture"));

  it("is the ordinary room while the teacher has not asked", () => {
    asked(false);
    render(element());
    expect(room().hasAttribute("data-focus")).toBe(false);
    expect(request()).toBeNull();
    expect(enter()).not.toHaveBeenCalled();
  });

  // CA-02
  it("goes into focus mode at once when the teacher asks, and tries the full screen of the room, which keeps the strip", async () => {
    asked(false);
    const view = render(element());
    asked(true);
    view.rerender(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(enter()).toHaveBeenCalledTimes(1);
    expect(enter().mock.contexts[0]).toBe(room());
    expect(room().contains(strip())).toBe(true);
    expect(within(strip()).getByRole("button", { name: "Levantar a mão" })).toBeDefined();
    expect(room().contains(screen.getByTestId("fixed-stage"))).toBe(true);
  });

  it("has the room over the menus of the platform in focus mode, and the stage with the whole window", () => {
    expect(styles).toMatch(/\.live\[data-focus="true"\]\s*\{[^}]*z-index:\s*\d+/);
  });

  it("gives the stage the whole window by closing the column of notes, which the student can open again", async () => {
    asked(false);
    const view = render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Anotações" }));
    expect(screen.getByTestId("notes")).toBeDefined();
    asked(true);
    view.rerender(element());
    await flush();
    expect(screen.queryByTestId("notes")).toBeNull();
    fireEvent.click(within(strip()).getByRole("button", { name: "Anotações" }));
    expect(screen.getByTestId("notes")).toBeDefined();
  });

  // CA-06
  it("applies the focus mode and tries the full screen for who comes in, or comes back, with the request on", async () => {
    asked(true);
    render(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(enter()).toHaveBeenCalledTimes(1);
  });

  // CA-03
  it("offers a button of one click in the strip, highlighted, when the browser refuses the full screen", async () => {
    refuseOnce();
    asked(true);
    render(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    const button = request()!;
    expect(button).not.toBeNull();
    expect(within(strip()).getByRole("button", { name: "Entrar em tela cheia (pedido do professor)" })).toBe(button);
    expect(screen.getByTestId("fixed-stage").contains(button)).toBe(false);
    expect(button.getAttribute("data-attention")).toBe("true");
  });

  it("enters the full screen at the next click anywhere in the room, once, when the browser refused it", async () => {
    refuseOnce();
    asked(true);
    render(element());
    await flush();
    expect(enter()).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("fixed-stage"));
    expect(enter()).toHaveBeenCalledTimes(2);
    expect(enter().mock.contexts[1]).toBe(room());
    fireEvent.click(screen.getByTestId("fixed-stage"));
    fireEvent.keyDown(document.body, { key: "x" });
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  it("enters the full screen at the next key too, but not at Escape, which is not a gesture", async () => {
    refuseOnce();
    asked(true);
    render(element());
    await flush();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(enter()).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "x" });
    expect(enter()).toHaveBeenCalledTimes(2);
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  it("enters the full screen with the button, once, and leaves nothing waiting for the next click", async () => {
    refuseOnce();
    asked(true);
    render(element());
    await flush();
    fireEvent.click(request()!);
    expect(enter()).toHaveBeenCalledTimes(2);
    expect(enter().mock.contexts[1]).toBe(room());
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  it("waits for the next gesture again when a gesture was not enough for the browser", async () => {
    refuseOnce();
    enter().mockRejectedValueOnce(new TypeError("Fullscreen request denied"));
    asked(true);
    render(element());
    await flush();
    fireEvent.keyDown(document.body, { key: "x" });
    await flush();
    expect(enter()).toHaveBeenCalledTimes(2);
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(3);
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(3);
  });

  it("takes a browser that throws, instead of refusing with a promise, as a refusal", async () => {
    enter().mockImplementationOnce(() => {
      throw new Error("not allowed");
    });
    asked(true);
    render(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(request()).not.toBeNull();
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  it("keeps the focus mode, and offers no button, in a browser that has no full screen at all", async () => {
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, writable: true, value: undefined });
    asked(true);
    render(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(request()).toBeNull();
    expect(() => fireEvent.click(document.body)).not.toThrow();
  });

  it("has no button once the full screen was entered, and nothing waiting for a click", async () => {
    asked(true);
    render(element());
    await flush();
    browserIsFullscreenOn(room());
    expect(request()).toBeNull();
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(1);
  });

  // CA-04
  it("does not enter again by itself when the student leaves the full screen: the focus stays and the button is highlighted again", async () => {
    asked(true);
    render(element());
    await flush();
    browserIsFullscreenOn(room());
    expect(request()).toBeNull();
    browserIsFullscreenOn(null);
    await flush();
    expect(enter()).toHaveBeenCalledTimes(1);
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(request()!.getAttribute("data-attention")).toBe("true");
    fireEvent.click(screen.getByTestId("fixed-stage"));
    fireEvent.keyDown(document.body, { key: "x" });
    expect(enter()).toHaveBeenCalledTimes(1);
    fireEvent.click(request()!);
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  it("does not enter again by itself either when the first click already took the student in and he leaves", async () => {
    refuseOnce();
    asked(true);
    render(element());
    await flush();
    fireEvent.click(document.body);
    browserIsFullscreenOn(room());
    browserIsFullscreenOn(null);
    fireEvent.click(document.body);
    expect(enter()).toHaveBeenCalledTimes(2);
  });

  // CA-05
  it("leaves the full screen and the focus mode when the teacher turns the request off", async () => {
    asked(true);
    const view = render(element());
    await flush();
    browserIsFullscreenOn(room());
    asked(false);
    view.rerender(element());
    await flush();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(room().hasAttribute("data-focus")).toBe(false);
    expect(request()).toBeNull();
  });

  it("leaves the focus mode, and does not touch a full screen that is the student's own, when the request goes off", async () => {
    asked(true);
    const view = render(element());
    await flush();
    browserIsFullscreenOn(screen.getByTestId("fixed-stage").parentElement);
    expect(room().getAttribute("data-focus")).toBe("true");
    asked(false);
    view.rerender(element());
    await flush();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(room().hasAttribute("data-focus")).toBe(false);
  });

  it("does not leave a full screen that is not there when the request goes off", async () => {
    refuseOnce();
    asked(true);
    const view = render(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    asked(false);
    view.rerender(element());
    await flush();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    expect(request()).toBeNull();
  });

  it("stops waiting for the next click when the request goes off", async () => {
    refuseOnce();
    asked(true);
    const view = render(element());
    await flush();
    asked(false);
    view.rerender(element());
    fireEvent.click(document.body);
    fireEvent.keyDown(document.body, { key: "x" });
    expect(enter()).toHaveBeenCalledTimes(1);
  });

  it("asks again when the teacher turns the request off and on", async () => {
    asked(true);
    const view = render(element());
    await flush();
    asked(false);
    view.rerender(element());
    asked(true);
    view.rerender(element());
    await flush();
    expect(enter()).toHaveBeenCalledTimes(2);
    expect(room().getAttribute("data-focus")).toBe("true");
  });

  it("does not keep waiting for a click when the room goes away", async () => {
    refuseOnce();
    asked(true);
    const view = render(element());
    await flush();
    view.unmount();
    fireEvent.click(document.body);
    fireEvent.keyDown(document.body, { key: "x" });
    expect(enter()).toHaveBeenCalledTimes(1);
  });

  it("keeps the full screen button of the strip and the key F as they are", async () => {
    asked(true);
    render(element());
    await flush();
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    expect(enter()).toHaveBeenCalledTimes(2);
    expect(enter().mock.contexts[1]).toBe(room());
  });

  it("styles the highlighted button with a pulse that respects who asks for less motion", () => {
    expect(styles).toMatch(/\[data-attention="true"\]/);
    expect(styles).toMatch(/@keyframes/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
