import { act, cleanup, fireEvent, render, type RenderResult } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classroomService, type LiveModuleContent, type LiveSession } from "@/services/classroomService";
import { LiveClassroom } from "./LiveClassroom";
import { PresenterStage } from "../PresenterStage/PresenterStage";

// What the teacher does on his window reaches the student's window, end to end: the real presentation window and the real room of the student, each with
// its own connection, and a room that does what the server does (it keeps the view of the stage, and passes what it gets on to the others, without echo).

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../StudentNotesPanel/StudentNotesPanel", async () => {
  const React = await import("react");
  return { StudentNotesPanel: () => React.createElement("div") };
});

// The window of terminals of the teacher is a stand-in with the same shape: it builds the DOM, and tells the picture of it with the locator, as the real one.
const teacherTerminal = vi.hoisted(() => {
  const state = { root: null as HTMLElement | null, onScreen: null as null | ((tree: unknown, locator: unknown) => void), lines: [] as string[] };
  const treeOf = (node: Node): unknown => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    const el = node as Element;
    const tree: { tag: string; attrs?: Record<string, string>; children?: unknown[] } = { tag: el.tagName.toLowerCase() };
    if (el.className) tree.attrs = { class: el.className };
    const children = Array.from(el.childNodes).map(treeOf);
    if (children.length) tree.children = children;
    return tree;
  };
  const locator = { offsetOf: () => 0, terminalOf: () => 1 };
  const show = () => {
    const lines = state.lines.map((text) => `<div class="term-linha">${text}</div>`).join("");
    state.root!.innerHTML = `<div class="janela"><div class="janela-corpo"><div class="term visivel"><div class="term-tela"><div class="term-linhas">${lines}</div></div></div></div></div>`;
    state.onScreen?.(treeOf(state.root!.firstElementChild!), locator);
  };
  return {
    state,
    mount(container: HTMLElement, onScreen: (tree: unknown, locator: unknown) => void) {
      state.root = container;
      state.onScreen = onScreen;
      state.lines = ["root@srv:~# ls"];
      show();
    },
    print(text: string) {
      state.lines.push(text);
      show();
    },
  };
});
vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async (container: HTMLElement, _snapshot: unknown, callbacks: { onScreen?: (tree: unknown, locator: unknown) => void }) => {
    teacherTerminal.mount(container, callbacks.onScreen!);
    return { setSpeed: vi.fn(), destroy: vi.fn() };
  }),
}));
vi.mock("@/engine/terminalScreen", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/engine/terminalScreen")>()), loadTerminalStyle: async () => undefined }));
vi.mock("../SlidePresenter/pdfRenderer", () => ({
  pdfLoader: { load: async () => ({ pageCount: 3, render: async () => undefined, destroy: () => undefined }) },
  readPdfInfo: vi.fn(),
}));

type Message = { type: string; data: unknown };

/** A connection that works as the browser's: the room hears what it sends, and gives it what the room says. */
class FakeSocket {
  static room: FakeRoom;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
      FakeSocket.room.join(this);
    });
  }
  send(data: string) {
    FakeSocket.room.hear(this, JSON.parse(data) as Message);
  }
  close() {
    this.readyState = 3;
  }
  tell(message: Message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/** What the server keeps in memory about the stage, as it does, and what it passes on. */
class FakeRoom {
  sockets: FakeSocket[] = [];
  sent: Message[] = [];
  view: Record<string, unknown> = { slideScroll: 0, slideScrollX: 0, materialScroll: 0, split: null, zoom: 1, selection: null, terminalScroll: {} };
  screen: unknown = null;
  constructor(readonly mode: "MODULE" | "SLIDES") {}

  snapshot(): Message {
    return {
      type: "live:snapshot",
      data: {
        hasActiveSession: true,
        session: session(),
        displayMode: this.mode,
        currentSlide: 1,
        activeModuleId: "m-1",
        moduleId: "m-1",
        moduleFocusBlockId: null,
        stageBlank: false,
        activeDeck: this.mode === "SLIDES" ? { id: "d-1", title: "Slides", pageCount: 3, downloadUrl: "https://x/slides.pdf" } : null,
        recentDrawings: [],
        terminal: { screen: this.screen },
        stageView: JSON.parse(JSON.stringify(this.view)),
        handRaises: [],
        onlineCount: 2,
      },
    };
  }

  join(socket: FakeSocket) {
    this.sockets.push(socket);
    socket.tell(this.snapshot());
  }

  hear(from: FakeSocket, message: Message) {
    this.sent.push(message);
    const data = message.data as Record<string, unknown>;
    if (message.type === "live:terminal:screen") this.screen = data.screen;
    if (message.type === "live:stage:zoom") this.view.zoom = data.zoom;
    if (message.type === "live:stage:split") this.view.split = data.ratio;
    if (message.type === "live:stage:selection") this.view.selection = data.clear ? null : data;
    if (message.type === "live:stage:scroll") {
      if (data.pane === "slide") Object.assign(this.view, { slideScroll: data.y, slideScrollX: data.x ?? 0 });
      if (data.pane === "material") this.view.materialScroll = data.y;
      if (data.pane === "terminal") this.view.terminalScroll = { ...(this.view.terminalScroll as object), [String(data.terminal)]: data.y };
    }
    for (const other of this.sockets) if (other !== from) other.tell(message);
  }
}

const session = (): LiveSession => ({ id: "s-1", classId: "c-1", title: "Permissões", status: "ACTIVE", displayMode: "MODULE", currentSlide: 1, startedAt: new Date().toISOString() });

const module_: LiveModuleContent = {
  moduleId: "m-1",
  title: "Permissões de arquivos",
  scenario: { n: 1 },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Primeiro", command: "Um", html: "<p>Primeiro bloco</p>" } },
    { id: "b-2", type: "TEXT", position: 1, payload: { title: "Segundo", command: "Dois", html: "<p>Segundo bloco</p>" } },
  ],
};

/** The sizes the browser would compute; jsdom has none. They are the same for the teacher's window and the student's, as the stage is. */
const SIZES = { materialContent: 2400, materialView: 600, pageContent: 2000, pageWidth: 1600, areaWidth: 1280, areaHeight: 720, terminalContent: 1000, terminalView: 400 };

function layout() {
  const kind = (el: Element) => (el.hasAttribute("data-sheet") ? "sheet" : el.hasAttribute("data-live-content") ? "material" : el.hasAttribute("data-live-panel") ? "panel" : el.classList.contains("term-tela") ? "terminal" : el.getAttribute("role") === "group" ? "area" : "other");
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    const k = kind(this);
    return k === "sheet" ? SIZES.pageContent : k === "material" ? SIZES.materialContent : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    const k = kind(this);
    return k === "sheet" ? SIZES.pageWidth : k === "area" ? SIZES.areaWidth : 0;
  });
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    const k = kind(this);
    return k === "panel" ? SIZES.materialView : k === "area" ? SIZES.areaHeight : k === "terminal" ? SIZES.terminalView : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return kind(this) === "area" ? SIZES.areaWidth : 0;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
    return kind(this) === "terminal" ? SIZES.terminalContent : 0;
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The two windows, side by side, connected to the same room. */
async function classRoom(mode: "MODULE" | "SLIDES") {
  FakeSocket.room = new FakeRoom(mode);
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.spyOn(classroomService, "getLiveModule").mockResolvedValue(module_);
  const teacher = render(<PresenterStage classId="c-1" session={session()} />);
  await flush();
  const student = render(<LiveClassroom classId="c-1" userId="u-1" session={session()} />);
  await flush();
  await flush();
  return { teacher, student, room: FakeSocket.room };
}

const $ = (view: RenderResult, selector: string) => view.container.querySelector(selector) as HTMLElement;
const tick = (ms = 150) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  layout();
  document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.getSelection()?.removeAllRanges();
});

// SPEC-057 CA-07: the scroll of the material of the teacher happens on the screen of the student
describe("the module, from the teacher's window to the student's", () => {
  it("shows the student the module of the teacher, in the same stage", async () => {
    const { teacher, student } = await classRoom("MODULE");
    expect($(teacher, "[data-live-panel]")).not.toBeNull();
    expect($(student, "[data-live-panel]")).not.toBeNull();
    expect($(student, "[data-live-panel]").textContent).toBe($(teacher, "[data-live-panel]").textContent);
    expect($(teacher, "[data-testid='stage-box']").style.width).toBe($(student, "[data-testid='stage-box']").style.width);
  });

  it("scrolls the material of the student when the teacher scrolls his: teacher scrolls, the message goes, the student's panel moves", async () => {
    const { teacher, student, room } = await classRoom("MODULE");
    const panel = $(teacher, "[data-live-panel]");
    expect($(student, "[data-live-content]").style.transform).toBe("translate(0px, 0px)");
    panel.scrollTop = 900;
    fireEvent.scroll(panel);
    expect(room.sent.filter((m) => m.type === "live:stage:scroll")).toEqual([{ type: "live:stage:scroll", data: { pane: "material", y: 0.5 } }]);
    // Half of what can be scrolled: 900 of the 1800 that the material has beyond the panel.
    expect($(student, "[data-live-content]").style.transform).toBe("translate(0px, -900px)");
    // The student's own panel does not scroll: the material moves inside it.
    expect($(student, "[data-live-panel]").scrollTop).toBe(0);
  });

  it("follows the teacher all the way, up and down, with each message after the pace of 100 ms", async () => {
    const { teacher, student } = await classRoom("MODULE");
    const panel = $(teacher, "[data-live-panel]");
    const content = $(student, "[data-live-content]");
    panel.scrollTop = 450;
    fireEvent.scroll(panel);
    expect(content.style.transform).toBe("translate(0px, -450px)");
    panel.scrollTop = 1800;
    fireEvent.scroll(panel);
    tick();
    expect(content.style.transform).toBe("translate(0px, -1800px)");
    panel.scrollTop = 0;
    fireEvent.scroll(panel);
    tick();
    expect(content.style.transform).toBe("translate(0px, 0px)");
  });

  it("does not let the student scroll it: his panel is a box nobody scrolls, which the teacher moves", async () => {
    const { student, room } = await classRoom("MODULE");
    const panel = $(student, "[data-live-panel]");
    panel.scrollTop = 900;
    fireEvent.scroll(panel);
    expect(room.sent.filter((m) => m.type === "live:stage:scroll")).toEqual([]);
    expect(panel.classList.contains("follower")).toBe(true);
  });

  it("puts a student who comes in later where the teacher is, without waiting for the teacher", async () => {
    const { teacher, room } = await classRoom("MODULE");
    const panel = $(teacher, "[data-live-panel]");
    panel.scrollTop = 900;
    fireEvent.scroll(panel);
    const late = render(<LiveClassroom classId="c-1" userId="u-2" session={session()} />);
    await flush();
    await flush();
    expect($(late, "[data-live-content]").style.transform).toBe("translate(0px, -900px)");
    expect(room.view.materialScroll).toBe(0.5);
  });

  it("moves the divider of the student when the teacher moves his, and the student cannot move it", async () => {
    const { teacher, student, room } = await classRoom("MODULE");
    const divider = $(teacher, "[role='separator']");
    fireEvent.keyDown(divider, { key: "Home" });
    tick();
    expect(room.view.split).toBe(0.25);
    const studentDivider = $(student, "[role='separator']");
    expect(studentDivider.getAttribute("aria-valuenow")).toBe("25");
    fireEvent.keyDown(studentDivider, { key: "End" });
    expect(studentDivider.getAttribute("aria-valuenow")).toBe("25");
  });

  it("makes the student's stage the zoom of the teacher, and tells the student no way to change it", async () => {
    const { teacher, student } = await classRoom("MODULE");
    expect($(student, "[data-testid='stage-box']").style.width).toBe("1280px");
    fireEvent.keyDown(document.body, { key: "+" });
    tick();
    expect($(teacher, "[data-testid='stage-box']").style.width).toBe(`${1280 / 1.25}px`);
    expect($(student, "[data-testid='stage-box']").style.width).toBe(`${1280 / 1.25}px`);
    fireEvent.keyDown(document.body, { key: "+" });
    tick();
    expect($(student, "[data-testid='stage-box']").style.width).toBe(`${1280 / 1.5}px`);
    fireEvent.keyDown(document.body, { key: "0" });
    tick();
    expect($(student, "[data-testid='stage-box']").style.width).toBe("1280px");
  });

  it("marks on the student's material the text the teacher selected, and takes the mark away when he clears it", async () => {
    const registry = new Map<string, { ranges: Range[] }>();
    vi.stubGlobal("CSS", { ...CSS, highlights: registry });
    vi.stubGlobal("Highlight", class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges; } });
    const { teacher, student } = await classRoom("MODULE");
    const text = $(teacher, "[data-block='b-2'] p").firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    tick();
    const marked = registry.get("teacher-material")!.ranges[0]!;
    expect(marked.toString()).toBe("Segund");
    expect($(student, "[data-live-panel]").contains(marked.startContainer)).toBe(true);
    selection.removeAllRanges();
    act(() => void document.dispatchEvent(new Event("selectionchange")));
    tick();
    expect(registry.has("teacher-material")).toBe(false);
  });

  // CA-23: each terminal has the place the teacher has it
  describe("the history of the terminal", () => {
    const tela = (view: RenderResult) => $(view, ".term-tela");
    const scrollTo = (el: HTMLElement, top: number) => {
      el.scrollTop = top;
      act(() => void el.dispatchEvent(new Event("scroll")));
    };

    it("shows the student the screen of the terminal of the teacher, at the end", async () => {
      const { teacher, student } = await classRoom("MODULE");
      expect(student.container.querySelector("[data-testid='terminal-mirror']")!.textContent).toContain("root@srv:~# ls");
      expect(tela(student).scrollTop).toBe(SIZES.terminalContent);
      expect(tela(teacher)).not.toBeNull();
    });

    it("puts the terminal of the student where the teacher scrolled his, as a fraction of what can be scrolled", async () => {
      const { teacher, student, room } = await classRoom("MODULE");
      scrollTo(tela(teacher), 300);
      expect(room.sent.filter((m) => m.type === "live:stage:scroll")).toEqual([{ type: "live:stage:scroll", data: { pane: "terminal", terminal: 1, y: 0.5 } }]);
      // Half of what can be scrolled: 300 of the 600 that the screen has beyond what it shows.
      expect(tela(student).scrollTop).toBe(300);
    });

    it("stays at the end while the teacher is at the end, and follows the new output", async () => {
      const { teacher, student } = await classRoom("MODULE");
      scrollTo(tela(teacher), 600);
      SIZES.terminalContent = 1800;
      act(() => teacherTerminal.print("saida nova"));
      tick();
      expect(student.container.querySelector("[data-testid='terminal-mirror']")!.textContent).toContain("saida nova");
      expect(tela(student).scrollTop).toBe(1800);
      SIZES.terminalContent = 1000;
    });

    it("stops following the end when the teacher scrolls up, stays at the same place with new output, and follows again when he is back at the end", async () => {
      const { teacher, student } = await classRoom("MODULE");
      SIZES.terminalContent = 1800;
      act(() => teacherTerminal.print("linha dois"));
      tick();
      // 1800 - 400 = 1400 can be scrolled: a quarter of it is 350.
      scrollTo(tela(teacher), 350);
      tick();
      expect(tela(student).scrollTop).toBe(350);
      SIZES.terminalContent = 2600;
      act(() => teacherTerminal.print("linha tres"));
      tick();
      // The new output made 2200 to scroll, and the student is at the same quarter of it, and not at the end.
      expect(tela(student).scrollTop).toBe(550);
      scrollTo(tela(teacher), 2200);
      tick();
      expect(tela(student).scrollTop).toBe(2600);
      SIZES.terminalContent = 1000;
    });

    it("does not let the student scroll the terminal: it is inert", async () => {
      const { student, room } = await classRoom("MODULE");
      expect($(student, "[data-testid='terminal-mirror']").hasAttribute("inert")).toBe(true);
      scrollTo(tela(student), 100);
      expect(room.sent.filter((m) => m.type === "live:stage:scroll")).toEqual([]);
    });

    it("puts a student who comes in later where the teacher has the terminal", async () => {
      const { teacher } = await classRoom("MODULE");
      scrollTo(tela(teacher), 150);
      const late = render(<LiveClassroom classId="c-1" userId="u-2" session={session()} />);
      await flush();
      await flush();
      expect(tela(late).scrollTop).toBe(150 * 1);
    });
  });
});

// CA-04, CA-17: the scroll of the slide, down and sideways, and the zoom, on the slides
describe("the slides, from the teacher's window to the student's", () => {
  it("scrolls the page of the student down and sideways with the teacher's", async () => {
    const { teacher, student, room } = await classRoom("SLIDES");
    const area = teacher.container.querySelector("[role='group']") as HTMLElement;
    // The page is 2000 tall in a stage of 720 and 1600 wide in 1280: 1280 down and 320 sideways can be scrolled.
    area.scrollTop = 640;
    area.scrollLeft = 160;
    fireEvent.scroll(area);
    expect(room.sent.filter((m) => m.type === "live:stage:scroll")).toEqual([{ type: "live:stage:scroll", data: { pane: "slide", y: 0.5, x: 0.5 } }]);
    expect($(student, "[data-sheet]").style.transform).toBe("translate(-160px, -640px)");
  });

  it("makes the stage of the student the zoom of the teacher on the slides too", async () => {
    const { student } = await classRoom("SLIDES");
    fireEvent.keyDown(document.body, { key: "+" });
    tick();
    expect($(student, "[data-testid='stage-box']").style.height).toBe(`${720 / 1.25}px`);
  });
});
