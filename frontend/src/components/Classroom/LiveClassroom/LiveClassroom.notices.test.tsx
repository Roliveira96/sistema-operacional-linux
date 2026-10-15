import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import type { HandRaiseItem, LiveChatMessage, LiveSession } from "@/services/classroomService";
import { NOTICE_KEY } from "../notices/noticePreference";
import { LiveClassroom } from "./LiveClassroom";

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
  return { StudentNotesPanel: () => React.createElement("div", { "data-testid": "notes" }, React.createElement("textarea", { "aria-label": "caderno" })) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const stageView = { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {}, fullscreen: false };

const forAll = (id: string, text = "Atenção, turma") => ({ id, scope: "all", from: "TEACHER", text, createdAt: "2026-10-14T10:05:00Z" }) as LiveChatMessage;
const toMe = (id: string, text = "Só para você") => ({ id, scope: "private", studentId: "u-1", from: "TEACHER", text, createdAt: "2026-10-14T10:06:00Z" }) as LiveChatMessage;
const mine = (id: string, text = "Minha dúvida") => ({ id, scope: "private", studentId: "u-1", from: "STUDENT", text, createdAt: "2026-10-14T10:07:00Z" }) as LiveChatMessage;
const hand = (studentId: string): HandRaiseItem => ({ studentId, name: "Bruno Lima", requestedAt: "2026-10-14T10:00:00Z" });

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 2, moduleId: null, moduleFocusBlockId: null, blank: false, deck: { id: "d", title: "t", pageCount: 5, downloadUrl: "https://x" }, strokes: [], cursor: null, online: 5 },
    admission: "ADMITTED",
    terminal: { screen: null },
    stageView,
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

/** The Notification of the browser, as a double: no test shows a real one. */
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];
  onclick: ((event: Event) => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}
const shown = () => FakeNotification.instances;
const first = () => FakeNotification.instances[0]!;
const click = (notification: FakeNotification) => act(() => void notification.onclick?.(new Event("click")));

/** What the browser says about the page: the student is in another tab, or looking at the room. */
const awayFromThePage = (away: boolean) => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(away);
  vi.spyOn(document, "hasFocus").mockReturnValue(!away);
};

const element = () => <LiveClassroom classId="c-1" userId="u-1" session={session} />;
const strip = () => screen.getByRole("toolbar", { name: "Controles da aula" });
const toggle = () => within(strip()).getByRole("button", { name: "Notificações" });
const chatToggle = () => within(strip()).getByRole("button", { name: /^Conversa/ });
const column = () => screen.queryByRole("complementary", { name: "Conversa com o professor" });
const flush = () => act(async () => undefined);

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  awayFromThePage(true);
  localStorage.clear();
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// SPEC-064 CA-05: the button, in the strip, after "Conversa"
describe("LiveClassroom, the button of the notices", () => {
  it("is in the strip, right after 'Conversa'", () => {
    live();
    render(element());
    const names = within(strip()).getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["Levantar a mão", "Anotações", "Conversa", "Notificações", "Tela cheia", "Sair da sala"]);
    expect(chatToggle().nextElementSibling!.contains(toggle())).toBe(true);
  });

  it("is on and pressed once the permission is given, and a click turns it off, which the browser keeps", () => {
    live();
    render(element());
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(NOTICE_KEY)).toBe("off");
  });

  it("asks for the permission with 'Ativar notificações'", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockImplementationOnce(async () => {
      FakeNotification.permission = "granted";
      return "granted";
    });
    live();
    render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Ativar notificações" }));
    await flush();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  it("tells that the browser or the address does not allow notices, as text in the strip", () => {
    vi.unstubAllGlobals();
    live();
    render(element());
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(within(strip()).getByText("Este navegador ou este endereço não permite notificações. Use https ou localhost.")).toBeDefined();
  });

  it("is not there for the student who waits, or whose class ended", () => {
    live({ admission: "WAITING", ready: false });
    const view = render(element());
    expect(screen.queryByRole("button", { name: "Notificações" })).toBeNull();
    live({ ended: true });
    view.rerender(element());
    expect(screen.queryByRole("button", { name: "Notificações" })).toBeNull();
  });
});

// SPEC-064 CA-03, CA-06
describe("LiveClassroom, the notices of the teacher", () => {
  it("shows the notice of a message for everybody, with the tab away, and clicking it opens the column 'Conversa'", async () => {
    live({ chat: [forAll("m-1")] });
    const view = render(element());
    await flush();
    expect(column()).toBeNull();
    live({ chat: [forAll("m-1"), forAll("m-2", "Prova na sexta")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(1);
    expect(first().title).toBe("Professor · para todos");
    expect(first().options).toMatchObject({ body: "Prova na sexta", tag: "chat-m-2" });
    await click(first());
    expect(window.focus).toHaveBeenCalled();
    expect(first().close).toHaveBeenCalled();
    expect(column()).not.toBeNull();
    expect(chatToggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("shows the notice of a message for him alone, as 'Professor', and opens the conversation over the notes", async () => {
    live();
    const view = render(element());
    fireEvent.click(within(strip()).getByRole("button", { name: "Anotações" }));
    expect(screen.getByTestId("notes")).toBeDefined();
    live({ chat: [toMe("m-1", "Veja o man")] });
    view.rerender(element());
    await flush();
    expect(first().title).toBe("Professor");
    await click(first());
    expect(screen.queryByTestId("notes")).toBeNull();
    expect(column()).not.toBeNull();
  });

  it("keeps the conversation open when it already is, and does not close it with the click", async () => {
    live();
    const view = render(element());
    fireEvent.click(chatToggle());
    live({ chat: [toMe("m-1")] });
    view.rerender(element());
    await flush();
    await click(first());
    expect(column()).not.toBeNull();
  });

  it("does not notify what the student wrote himself, which the room gives back, nor the hands", async () => {
    live();
    const view = render(element());
    await flush();
    live({ chat: [mine("m-1")], hands: [hand("u-2")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify the history that the room gives when the student comes in or reloads", async () => {
    live({ chat: [forAll("m-1"), toMe("m-2")] });
    render(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify with the room in view and in focus", async () => {
    awayFromThePage(false);
    live();
    const view = render(element());
    await flush();
    live({ chat: [forAll("m-1")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify with the notices turned off by the student", async () => {
    live();
    const view = render(element());
    fireEvent.click(toggle());
    live({ chat: [forAll("m-1")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify the student who is still waiting to be accepted", async () => {
    live({ admission: "WAITING", ready: false });
    const view = render(element());
    live({ admission: "WAITING", ready: false, chat: [forAll("m-1")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });
});
