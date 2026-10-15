import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { LiveChatMessage, LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "./LiveClassroom";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("../SlidePresenter/SlidePresenter", async () => {
  const React = await import("react");
  return { SlidePresenter: () => React.createElement("div", { "data-testid": "slides" }) };
});
vi.mock("../ModuleStage/ModuleStage", async () => {
  const React = await import("react");
  type P = { onHand?(): void };
  return { ModuleStage: (p: P) => React.createElement("div", { "data-testid": "module" }, p.onHand ? React.createElement("button", { onClick: p.onHand }, "mão do cabeçalho") : null) };
});
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }, React.createElement("textarea", { "aria-label": "caderno" })) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const stageView = (fullscreen = false) => ({ slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {}, fullscreen });
const MODULE_ROOM = { mode: "MODULE", slide: 1, moduleId: "m-1", moduleFocusBlockId: null, blank: false, deck: null, strokes: [], cursor: null, online: 2 };

const forAll = (id: string, text = "Atenção, turma") => ({ id, scope: "all", from: "TEACHER", text, createdAt: "2026-10-14T10:05:00Z" }) as LiveChatMessage;
const toMe = (id: string, text = "Só para você") => ({ id, scope: "private", studentId: "u-1", from: "TEACHER", text, createdAt: "2026-10-14T10:06:00Z" }) as LiveChatMessage;
const mine = (id: string, text = "Minha dúvida") => ({ id, scope: "private", studentId: "u-1", from: "STUDENT", text, createdAt: "2026-10-14T10:07:00Z" }) as LiveChatMessage;

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView: stageView(),
    hands: [],
    handCount: 0,
    myHand: null,
    chat: [] as LiveChatMessage[],
    fullscreenRequested: false,
    ready: true,
    ended: false,
    passive: false,
    connected: true,
    canControl: false,
    sendChat: vi.fn(() => true),
    changeSlide: vi.fn(), moveCursor: vi.fn(), draw: vi.fn(), clearDrawings: vi.fn(), raiseHand: vi.fn(), lowerHand: vi.fn(), requestEntry: vi.fn(),
    ...over,
  };
  vi.mocked(useLiveClassroom).mockReturnValue(value as never);
  return value;
}

const element = () => <LiveClassroom classId="c-1" userId="u-1" session={session} />;
const strip = () => screen.getByRole("toolbar", { name: "Controles da aula" });
const room = () => screen.getByRole("main");
const stageBox = () => screen.getByTestId("fixed-stage").parentElement as HTMLElement;
const toggle = (name: string | RegExp = /^Conversa/) => within(strip()).getByRole("button", { name });
const notesToggle = () => within(strip()).getByRole("button", { name: "Anotações" });
const column = () => screen.queryByRole("complementary", { name: "Conversa com o professor" });
const field = () => screen.getByRole("textbox", { name: "Mensagem para o professor" }) as HTMLTextAreaElement;
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

// SPEC-063 CA-08: the conversation with the teacher, in a column beside the stage like the one of the notes
describe("the conversation of the student with the teacher", () => {
  it("has the button 'Conversa' in the strip, next to the notes, closed at first, and no column", () => {
    live();
    render(element());
    const names = within(strip()).getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["Levantar a mão", "Anotações", "Conversa", "Notificações", "Tela cheia", "Sair da sala"]);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(column()).toBeNull();
  });

  it("opens in a column beside the stage, as the notes do, and closes again", () => {
    live();
    render(element());
    fireEvent.click(notesToggle());
    const notesColumn = screen.getByRole("complementary", { name: "Anotações da aula" });
    fireEvent.click(notesToggle());
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const side = column()!;
    expect(side).not.toBeNull();
    expect(side.className).toBe(notesColumn.className);
    expect(side.parentElement).toBe(stageBox().parentElement);
    expect(stageBox().contains(side)).toBe(false);
    expect(screen.getByTestId("fixed-stage").contains(side)).toBe(false);
    expect(side.contains(within(side).getByRole("textbox", { name: "Mensagem para o professor" }))).toBe(true);
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(column()).toBeNull();
  });

  it("does not load the stage again when it opens and closes", () => {
    live();
    render(element());
    const box = screen.getByTestId("fixed-stage");
    const slides = screen.getByTestId("slides");
    fireEvent.click(toggle());
    expect(screen.getByTestId("fixed-stage")).toBe(box);
    expect(screen.getByTestId("slides")).toBe(slides);
    fireEvent.click(toggle());
    expect(screen.getByTestId("fixed-stage")).toBe(box);
  });

  it("shows the messages, marked, from the room, and tells what to do while there are none", () => {
    live();
    const view = render(element());
    fireEvent.click(toggle());
    expect(within(column()!).getByText("Escreva para o professor. As mensagens do professor para todos aparecem aqui.")).toBeDefined();
    live({ chat: [forAll("m-1"), toMe("m-2"), mine("m-3")] });
    view.rerender(element());
    const items = within(column()!).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Professor · para todosAtenção, turma",
      "Professor · só para vocêSó para você",
      "VocêMinha dúvida",
    ]);
  });

  it("draws a message of the teacher as text, never as HTML", () => {
    live({ chat: [forAll("m-1", "<script>x</script><b>oi</b>")] });
    render(element());
    fireEvent.click(toggle());
    expect(within(column()!).getByText("<script>x</script><b>oi</b>")).toBeDefined();
    expect(column()!.querySelector("script, b")).toBeNull();
  });

  it("sends what is written, and only the text, with Enter", () => {
    const l = live();
    render(element());
    fireEvent.click(toggle());
    fireEvent.change(field(), { target: { value: "Posso ir ao banheiro?" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).toHaveBeenCalledTimes(1);
    expect(l.sendChat).toHaveBeenCalledWith("Posso ir ao banheiro?");
    expect(field().value).toBe("");
  });

  it("sends with the button too, and keeps the text when the room did not take it", () => {
    const l = live({ sendChat: vi.fn(() => false) });
    render(element());
    fireEvent.click(toggle());
    fireEvent.change(field(), { target: { value: "Oi" } });
    fireEvent.click(within(column()!).getByRole("button", { name: "Enviar" }));
    expect(l.sendChat).toHaveBeenCalledWith("Oi");
    expect(field().value).toBe("Oi");
  });

  it("has the sending off without a connection, and says it", () => {
    const l = live({ connected: false });
    render(element());
    fireEvent.click(toggle());
    fireEvent.change(field(), { target: { value: "Oi" } });
    expect((within(column()!).getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(column()!).getByText("Sem conexão. Reconectando…")).toBeDefined();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).not.toHaveBeenCalled();
  });

  it("does not take the key F while the student writes in the conversation", () => {
    live();
    render(element());
    fireEvent.click(toggle());
    fireEvent.keyDown(field(), { key: "f" });
    expect(Element.prototype.requestFullscreen).not.toHaveBeenCalled();
  });

  it("is not there for the student who waits, or whose class ended", () => {
    live({ admission: "WAITING", ready: false });
    const view = render(element());
    expect(screen.queryByRole("button", { name: /^Conversa/ })).toBeNull();
    live({ ended: true });
    view.rerender(element());
    expect(screen.queryByRole("button", { name: /^Conversa/ })).toBeNull();
  });

  // The modal of the doubt and the conversation live in the same room
  it("lives with the modal of the doubt: both are in the room and neither is in the fixed stage", () => {
    live({ room: MODULE_ROOM });
    render(element());
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "mão do cabeçalho" }));
    const dialog = screen.getByRole("dialog", { name: "Sua dúvida para o professor" });
    expect(stageBox().contains(dialog)).toBe(true);
    expect(screen.getByTestId("fixed-stage").contains(dialog)).toBe(false);
    expect(column()).not.toBeNull();
    expect(room().contains(dialog)).toBe(true);
    expect(room().contains(column())).toBe(true);
  });
});

// SPEC-063 CA-08: the notes and the conversation are never open together
describe("the notes and the conversation", () => {
  it("closes the notes when the conversation opens, and the conversation when the notes open", () => {
    live();
    render(element());
    fireEvent.click(notesToggle());
    expect(screen.getByTestId("notes")).toBeDefined();
    expect(notesToggle().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle());
    expect(screen.queryByTestId("notes")).toBeNull();
    expect(notesToggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(column()).not.toBeNull();
    fireEvent.click(notesToggle());
    expect(screen.getByTestId("notes")).toBeDefined();
    expect(column()).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(notesToggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("has one column at a time beside the stage", () => {
    live();
    render(element());
    fireEvent.click(notesToggle());
    fireEvent.click(toggle());
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    fireEvent.click(notesToggle());
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
  });

  it("closes both with their own button, which leaves the stage with the whole window", () => {
    live();
    render(element());
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(notesToggle());
    fireEvent.click(notesToggle());
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  // SPEC-059: the stage has the whole window in focus mode
  it("closes the conversation when the teacher asks for the full screen, and lets the student open it again", async () => {
    live();
    const view = render(element());
    fireEvent.click(toggle());
    expect(column()).not.toBeNull();
    live({ fullscreenRequested: true, stageView: stageView(true) });
    view.rerender(element());
    await flush();
    expect(room().getAttribute("data-focus")).toBe("true");
    expect(column()).toBeNull();
    fireEvent.click(toggle());
    expect(column()).not.toBeNull();
  });

  it("starts with no column for who comes in with the request on, and the student opens it after", async () => {
    live({ fullscreenRequested: true, stageView: stageView(true) });
    render(element());
    await flush();
    expect(column()).toBeNull();
    fireEvent.click(toggle());
    expect(column()).not.toBeNull();
  });
});

// SPEC-063: what the student has not read, from the teacher, and which the strip tells
describe("the new messages of the teacher", () => {
  const badge = () => toggle().querySelector("span");

  it("has no number while nothing came", () => {
    live();
    render(element());
    expect(toggle().getAttribute("aria-label")).toBeNull();
    expect(toggle().textContent).toBe("Conversa");
    expect(badge()).toBeNull();
  });

  it("does not count the history that the snapshot brings, to who comes in or reloads", () => {
    live({ ready: true, chat: [forAll("m-1"), toMe("m-2"), mine("m-3")] });
    render(element());
    expect(toggle().textContent).toBe("Conversa");
    expect(badge()).toBeNull();
  });

  it("does not count the first list either, which is empty while the room is connecting and then comes whole", () => {
    live({ ready: false, connected: false, chat: [] });
    const view = render(element());
    expect(badge()).toBeNull();
    live({ ready: true, connected: true, chat: [forAll("m-1"), toMe("m-2"), forAll("m-3")] });
    view.rerender(element());
    expect(toggle().textContent).toBe("Conversa");
    expect(toggle().getAttribute("aria-label")).toBeNull();
  });

  it("counts the messages of the teacher that come, for everybody or only for the student, and tells the number", () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    live({ chat: [forAll("m-1"), forAll("m-2")] });
    view.rerender(element());
    expect(toggle("Conversa, 1 nova").textContent).toBe("Conversa1");
    live({ chat: [forAll("m-1"), forAll("m-2"), toMe("m-3")] });
    view.rerender(element());
    expect(toggle("Conversa, 2 novas").textContent).toBe("Conversa2");
    expect(toggle("Conversa, 2 novas").getAttribute("aria-expanded")).toBe("false");
    expect(badge()!.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not count what the student wrote himself", () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    live({ chat: [forAll("m-1"), mine("m-2")] });
    view.rerender(element());
    expect(toggle().textContent).toBe("Conversa");
  });

  it("keeps the count when the room tells the same history again, as it does after a reconnection", () => {
    live({ chat: [forAll("m-1"), toMe("m-2")] });
    const view = render(element());
    live({ chat: [forAll("m-1"), toMe("m-2"), forAll("m-3")] });
    view.rerender(element());
    expect(toggle("Conversa, 1 nova")).toBeDefined();
    // The room starts again after a reconnection and tells the same history, with the same ids.
    live({ chat: [forAll("m-1"), toMe("m-2"), forAll("m-3")] });
    view.rerender(element());
    expect(toggle("Conversa, 1 nova")).toBeDefined();
  });

  it("clears the number when the conversation opens", () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    live({ chat: [forAll("m-1"), forAll("m-2"), toMe("m-3")] });
    view.rerender(element());
    expect(toggle("Conversa, 2 novas")).toBeDefined();
    fireEvent.click(toggle());
    expect(toggle().textContent).toBe("Conversa");
    expect(toggle().getAttribute("aria-label")).toBeNull();
    expect(within(column()!).getAllByRole("listitem")).toHaveLength(3);
    // Closed again, it stays clear: what was read is not new.
    fireEvent.click(toggle());
    expect(toggle().textContent).toBe("Conversa");
  });

  it("counts as seen what comes while the column is open, and counts again only what comes after it is closed", () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    fireEvent.click(toggle());
    live({ chat: [forAll("m-1"), forAll("m-2")] });
    view.rerender(element());
    expect(toggle().textContent).toBe("Conversa");
    fireEvent.click(toggle());
    expect(toggle().textContent).toBe("Conversa");
    live({ chat: [forAll("m-1"), forAll("m-2"), toMe("m-3")] });
    view.rerender(element());
    expect(toggle("Conversa, 1 nova")).toBeDefined();
  });

  it("counts with the notes open, since the conversation is not in view", () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    fireEvent.click(notesToggle());
    live({ chat: [forAll("m-1"), forAll("m-2")] });
    view.rerender(element());
    expect(toggle("Conversa, 1 nova")).toBeDefined();
    fireEvent.click(toggle());
    expect(toggle().textContent).toBe("Conversa");
  });
});

// SPEC-063 CA-09: the full screen of the button and of the key F is the room, not only the stage
describe("the full screen of the student", () => {
  const asked = () => vi.mocked(Element.prototype.requestFullscreen);
  /** What the browser does when the full screen is entered or left: it tells the document. */
  const browserIsFullscreenOn = (el: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: el });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
  };

  it("takes the whole room to the full screen with the button, and not only the stage", () => {
    live();
    render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    expect(asked()).toHaveBeenCalledTimes(1);
    expect(asked().mock.contexts[0]).toBe(room());
    expect(asked().mock.contexts[0]).not.toBe(stageBox());
  });

  it("takes the whole room with the key F too, in lower or upper case", () => {
    live();
    render(element());
    fireEvent.keyDown(document.body, { key: "f" });
    fireEvent.keyDown(document.body, { key: "F" });
    expect(asked()).toHaveBeenCalledTimes(2);
    expect(asked().mock.contexts).toEqual([room(), room()]);
  });

  it("has in the room, which is what the browser shows, the strip, the stage, the notes and the conversation", () => {
    live();
    render(element());
    const full = room();
    expect(full.contains(strip())).toBe(true);
    expect(full.contains(screen.getByTestId("fixed-stage"))).toBe(true);
    fireEvent.click(notesToggle());
    expect(full.contains(screen.getByTestId("notes"))).toBe(true);
    fireEvent.click(toggle());
    expect(full.contains(column())).toBe(true);
    expect(full.contains(field())).toBe(true);
  });

  it("has the modal of the doubt in the room as well, and in no portal outside it", () => {
    live({ room: MODULE_ROOM });
    const view = render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    const full = asked().mock.contexts[0] as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "mão do cabeçalho" }));
    const dialog = screen.getByRole("dialog", { name: "Sua dúvida para o professor" });
    expect(full.contains(dialog)).toBe(true);
    expect(view.container.contains(dialog)).toBe(true);
  });

  it("keeps the conversation to write in while the room is in the full screen", () => {
    const l = live({ chat: [toMe("m-1")] });
    render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    browserIsFullscreenOn(room());
    fireEvent.click(toggle());
    fireEvent.change(field(), { target: { value: "Entendi" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(l.sendChat).toHaveBeenCalledWith("Entendi");
    expect(within(column()!).getByText("Só para você")).toBeDefined();
  });

  it("leaves the full screen with the same button or key when the room is in it, and asks for nothing", () => {
    live();
    render(element());
    browserIsFullscreenOn(room());
    fireEvent.keyDown(document.body, { key: "f" });
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(2);
    expect(asked()).not.toHaveBeenCalled();
  });

  // The teacher's request and the student's button go to the same element now
  it("has no button of the request once the student is in the full screen by his own button, and nothing waiting for a gesture", async () => {
    live({ fullscreenRequested: true, stageView: stageView(true) });
    asked().mockRejectedValueOnce(new TypeError("Fullscreen request denied: no user gesture"));
    render(element());
    await flush();
    const request = () => screen.queryByRole("button", { name: "Entrar em tela cheia (pedido do professor)" });
    expect(request()).not.toBeNull();
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    browserIsFullscreenOn(room());
    expect(request()).toBeNull();
    // Whatever the click asked for, it asked for the room, and now nothing is waiting for the next click.
    expect(asked().mock.contexts.every((el) => el === room())).toBe(true);
    const calls = asked().mock.calls.length;
    fireEvent.click(document.body);
    fireEvent.keyDown(document.body, { key: "x" });
    expect(asked()).toHaveBeenCalledTimes(calls);
  });

  it("goes out with the button while the request is on, does not go back in by itself, and offers the button of the request again", async () => {
    live({ fullscreenRequested: true, stageView: stageView(true) });
    render(element());
    await flush();
    browserIsFullscreenOn(room());
    fireEvent.click(within(strip()).getByRole("button", { name: "Tela cheia" }));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(asked()).toHaveBeenCalledTimes(1);
    browserIsFullscreenOn(null);
    await flush();
    expect(asked()).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Entrar em tela cheia (pedido do professor)" }).getAttribute("data-attention")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Entrar em tela cheia (pedido do professor)" }));
    expect(asked()).toHaveBeenCalledTimes(2);
    expect(asked().mock.contexts[1]).toBe(room());
  });
});
