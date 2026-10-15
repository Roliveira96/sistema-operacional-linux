import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { classroomService, type AdmissionEntry, type HandRaiseItem, type LiveChatMessage, type LiveSession } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { NOTICE_KEY } from "../notices/noticePreference";
import { TeacherPanel } from "./TeacherPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/useLiveClassroom", () => ({ useLiveClassroom: vi.fn() }));
vi.mock("@/services/moduleService", () => ({ moduleService: { listModules: vi.fn() } }));
vi.mock("../SlideThumbnails/SlideThumbnails", async () => {
  const React = await import("react");
  return { SlideThumbnails: () => React.createElement("div", { "data-testid": "thumbs" }) };
});

const session: LiveSession = { id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "SLIDES", currentSlide: 1, startedAt: "2026-10-14T10:00:00Z" };
const ana: AdmissionEntry = { studentId: "u-1", name: "Ana Souza" };
const bruno: AdmissionEntry = { studentId: "u-2", name: "Bruno Lima" };

let seq = 0;
const fromStudent = (studentId: string, text: string): LiveChatMessage => ({ id: `m-${++seq}`, scope: "private", studentId, from: "STUDENT", text, createdAt: "2026-10-14T10:00:00Z" });
const hand = (entry: AdmissionEntry, question = ""): HandRaiseItem => ({ studentId: entry.studentId, name: entry.name, requestedAt: "2026-10-14T10:00:00Z", question });

function live(over: Record<string, unknown> = {}) {
  const value = {
    room: { mode: "SLIDES", slide: 1, moduleId: null, moduleFocusBlockId: null, deck: null, strokes: [], cursor: null, online: 2, blank: false },
    admissions: { waiting: [], admitted: [ana, bruno] },
    onlineStudents: ["u-1", "u-2"],
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

/** What the browser says about the page: the teacher is in another window, or looking at the panel. */
const awayFromThePage = (away: boolean) => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(away);
  vi.spyOn(document, "hasFocus").mockReturnValue(!away);
};

const beep = vi.fn();
const element = () => <TeacherPanel classId="c-1" session={session} beep={beep} />;
const flush = () => act(async () => void (await Promise.resolve()));
const conversation = () => screen.queryByRole("heading", { level: 3, name: /^Conversa com / });
const toggle = () => screen.getByRole("button", { name: "Notificações" });

beforeEach(() => {
  FakeNotification.permission = "granted";
  FakeNotification.instances = [];
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal("Notification", FakeNotification);
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(window, "focus").mockImplementation(() => undefined);
  awayFromThePage(true);
  localStorage.clear();
  beep.mockClear();
  vi.mocked(moduleService.listModules).mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 } as never);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue({ moduleId: "m", title: "t", scenario: {}, blocks: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// SPEC-064 CA-05: the button, next to the sound of the panel
describe("TeacherPanel, the button of the notices", () => {
  it("is in the side column, right after 'Som do aviso'", async () => {
    live();
    render(element());
    await flush();
    const side = screen.getByRole("complementary");
    const sound = within(side).getByRole("button", { name: "Som do aviso" });
    expect(side.contains(toggle())).toBe(true);
    expect(sound.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sound.nextElementSibling!.contains(toggle())).toBe(true);
  });

  it("is on and pressed once the permission is given, and a click turns it off, which the browser keeps", async () => {
    live();
    render(element());
    await flush();
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(NOTICE_KEY)).toBe("off");
  });

  it("starts off for who turned it off before", async () => {
    localStorage.setItem(NOTICE_KEY, "off");
    live();
    render(element());
    await flush();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("asks for the permission with 'Ativar notificações', and turns the notices on when it is given", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockImplementationOnce(async () => {
      FakeNotification.permission = "granted";
      return "granted";
    });
    live();
    render(element());
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Ativar notificações" }));
    await flush();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(NOTICE_KEY)).toBe("on");
  });

  it("tells that the browser or the address does not allow notices, with the sound of the panel untouched", async () => {
    vi.unstubAllGlobals();
    live();
    render(element());
    await flush();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Este navegador ou este endereço não permite notificações. Use https ou localhost.")).toBeDefined();
    expect((screen.getByRole("button", { name: "Som do aviso" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// SPEC-064 CA-01, CA-02, CA-06
describe("TeacherPanel, the notices of the hands and of the messages", () => {
  it("shows the notice of a hand that goes up, with the page away, and clicking it opens the conversation with that student", async () => {
    live();
    const view = render(element());
    await flush();
    expect(conversation()).toBeNull();
    live({ hands: [hand(bruno, "Como uso o chmod?")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(1);
    expect(first().title).toBe("Mão levantada");
    expect(first().options).toMatchObject({ body: "Bruno Lima levantou a mão: Como uso o chmod?", tag: "hand-u-2" });
    await click(first());
    expect(window.focus).toHaveBeenCalled();
    expect(first().close).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 3, name: "Conversa com Bruno Lima" })).toBeDefined();
  });

  it("shows the notice of a message of a student, and clicking it opens his conversation, with the message", async () => {
    live();
    const view = render(element());
    await flush();
    const written = fromStudent("u-1", "Não entendi o chmod");
    live({ chat: [written] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(1);
    expect(first().title).toBe("Mensagem de Ana Souza");
    expect(first().options).toMatchObject({ body: "Não entendi o chmod", tag: `chat-${written.id}` });
    await click(first());
    expect(screen.getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
    expect(within(screen.getByRole("log")).getByText("Não entendi o chmod")).toBeDefined();
  });

  it("opens the conversation of the student who wrote, and not the one that was open", async () => {
    live();
    const view = render(element());
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Conversar com Ana Souza" }));
    expect(screen.getByRole("heading", { level: 3, name: "Conversa com Ana Souza" })).toBeDefined();
    live({ chat: [fromStudent("u-2", "Oi, professor")] });
    view.rerender(element());
    await flush();
    await click(first());
    expect(screen.getByRole("heading", { level: 3, name: "Conversa com Bruno Lima" })).toBeDefined();
  });

  it("does not notify what the panel finds when it opens or is reloaded", async () => {
    live({ hands: [hand(ana, "Antiga")], chat: [fromStudent("u-2", "Antiga")] });
    render(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify with the panel in view and in focus", async () => {
    awayFromThePage(false);
    live();
    const view = render(element());
    await flush();
    live({ hands: [hand(ana)], chat: [fromStudent("u-2", "Oi")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("does not notify with the notices turned off by the teacher", async () => {
    live();
    const view = render(element());
    await flush();
    fireEvent.click(toggle());
    live({ hands: [hand(ana)], chat: [fromStudent("u-2", "Oi")] });
    view.rerender(element());
    await flush();
    expect(shown()).toHaveLength(0);
  });

  it("keeps the sound of the panel as it was, a beep for the hand, along with the notice", async () => {
    live();
    const view = render(element());
    await flush();
    live({ hands: [hand(ana)] });
    view.rerender(element());
    await flush();
    expect(beep).toHaveBeenCalledWith("hand");
    expect(shown()).toHaveLength(1);
  });
});
