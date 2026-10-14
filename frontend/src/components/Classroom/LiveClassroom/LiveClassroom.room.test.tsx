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
  type P = { startedAt?: string | null; handCount?: number };
  return {
    ModuleStage: (p: P) => React.createElement("div", { "data-testid": "module", "data-started-at": p.startedAt ?? "", "data-hand-count": String(p.handCount) }),
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

// SPEC-058: the hand with a doubt, and the header of the module
describe("the hand and the doubt, on the strip of the student", () => {
  const field = () => within(strip()).getByRole("textbox", { name: "Escreva sua dúvida (opcional)" }) as HTMLInputElement;

  // CA-03
  it("raises the hand with one click and asks for no text", () => {
    const l = live();
    render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Levantar a mão" }));
    expect(l.raiseHand).toHaveBeenCalledTimes(1);
    expect(l.raiseHand).toHaveBeenCalledWith();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // CA-04
  it("has no field for the doubt while the hand is down", () => {
    live();
    render(element());
    expect(screen.queryByRole("textbox", { name: "Escreva sua dúvida (opcional)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar dúvida" })).toBeNull();
  });

  it("shows the field in the strip, with the counter and the button, as soon as the hand is up, and nothing over the material", () => {
    live({ hands: [other, me], myHand: { raised: true, question: "" } });
    render(element());
    expect(field().value).toBe("");
    expect(within(strip()).getByText("0/300")).toBeDefined();
    expect(within(strip()).getByRole("button", { name: "Enviar dúvida" })).toBeDefined();
    const stage = screen.getByTestId("fixed-stage");
    expect(stage.contains(field())).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
    // The button to lower the hand and the place in the line stay where they were.
    expect(within(strip()).getByRole("button", { name: "Abaixar a mão" })).toBeDefined();
    expect(within(strip()).getByText("2º na fila")).toBeDefined();
  });

  it("sends the doubt with the button, and with Enter", () => {
    const l = live({ hands: [me], myHand: { raised: true, question: "" } });
    render(element());
    fireEvent.change(field(), { target: { value: "Como uso o chmod?" } });
    fireEvent.click(within(strip()).getByRole("button", { name: "Enviar dúvida" }));
    expect(l.raiseHand).toHaveBeenLastCalledWith("Como uso o chmod?");
    fireEvent.change(field(), { target: { value: "E o chown?" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.raiseHand).toHaveBeenLastCalledWith("E o chown?");
    expect(l.raiseHand).toHaveBeenCalledTimes(2);
  });

  it("says 'Dúvida enviada' when the room has the doubt, and lets it be edited and sent again", () => {
    const l = live({ hands: [me], myHand: { raised: true, question: "Como uso o chmod?" } });
    render(element());
    expect(within(strip()).getByText("Dúvida enviada")).toBeDefined();
    fireEvent.change(field(), { target: { value: "Como uso o chmod -R?" } });
    expect(within(strip()).queryByText("Dúvida enviada")).toBeNull();
    fireEvent.click(within(strip()).getByRole("button", { name: "Enviar dúvida" }));
    expect(l.raiseHand).toHaveBeenLastCalledWith("Como uso o chmod -R?");
  });

  // CA-07: reconnecting gives the hand and the doubt back
  it("finds the hand and the doubt again after reconnecting, from what the room has for the student", () => {
    live({ hands: [other, me], myHand: { raised: true, question: "Como uso o chmod?" } });
    render(element());
    expect(within(strip()).getByText("Sua mão está levantada.")).toBeDefined();
    expect(field().value).toBe("Como uso o chmod?");
    expect(within(strip()).getByText("Dúvida enviada")).toBeDefined();
  });

  // CA-05: lowering the hand takes the doubt with it
  it("lowers the hand with the same button, and the field goes away with the doubt", () => {
    const l = live({ hands: [me], myHand: { raised: true, question: "Como uso o chmod?" } });
    const view = render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Abaixar a mão" }));
    expect(l.lowerHand).toHaveBeenCalledTimes(1);
    live({ hands: [], myHand: { raised: false, question: "" } });
    view.rerender(element());
    expect(screen.queryByRole("textbox")).toBeNull();
    live({ hands: [me], myHand: { raised: true, question: "" } });
    view.rerender(element());
    expect(field().value).toBe("");
    expect(within(strip()).queryByText("Dúvida enviada")).toBeNull();
  });

  it("starts with an empty field when the teacher lowered the hand and the student raised it again", () => {
    live();
    const view = render(element());
    live({ hands: [me], myHand: { raised: true, question: "dúvida velha" } });
    view.rerender(element());
    expect(field().value).toBe("dúvida velha");
    live({ hands: [], myHand: { raised: true, question: "dúvida velha" } });
    view.rerender(element());
    expect(screen.queryByRole("textbox")).toBeNull();
    live({ hands: [me], myHand: { raised: true, question: "" } });
    view.rerender(element());
    expect(field().value).toBe("");
  });

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
    expect(enter().mock.contexts[1]).toBe(screen.getByTestId("fixed-stage").parentElement);
  });

  it("styles the highlighted button with a pulse that respects who asks for less motion", () => {
    expect(styles).toMatch(/\[data-attention="true"\]/);
    expect(styles).toMatch(/@keyframes/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
