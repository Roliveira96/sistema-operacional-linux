import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Step, TerminalWindow } from "@/engine/engine";
import { contentMessages } from "@/messages/content.pt-BR";
import type { ContentBlock, PublicQuestion } from "@/services/contentService";
import type { CourseModuleDetails } from "@/services/moduleService";
import { problem } from "@/test/helpers";
import { TopicScreen, type TopicScreenProps } from "./TopicScreen";

afterEach(cleanup);
const m = contentMessages.topic;

const moduleDetails = {
  id: "m1",
  title: "Navegação e diretórios",
  description: "pwd · ls — Onde estou",
  icon: "📁",
  color: "--cor-dir",
} as CourseModuleDetails;

const blocks: ContentBlock[] = [
  { id: "c", type: "LEGACY_HTML", position: 1, payload: { html: "<p>conceitos</p>" } },
  { id: "d", type: "COMMAND", position: 2, payload: { steps: [{ command: "ls /", explanation: "a raiz" }] } },
  { id: "l", type: "TEXT", position: 3, payload: { title: "Mostrar onde estou", command: "pwd", html: "<p>imprime</p><pre><code>pwd [-P]</code></pre>" } },
  { id: "o", type: "TEXT", position: 4, payload: { html: "<table><tbody><tr><td>-P</td></tr></tbody></table>" } },
  { id: "e", type: "COMMAND", position: 5, payload: { steps: [{ command: "pwd" }, { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } }] } },
  { id: "t", type: "TIP", position: 6, payload: { html: "<ul><li>dica</li></ul>" } },
  { id: "w", type: "TIP", position: 7, payload: { variant: "WARNING", html: "pegadinha" } },
  { id: "r", type: "CURIOSITY", position: 8, payload: { html: "na vida real" } },
  { id: "x", type: "WIDGET", position: 9, payload: { component: "LS_ANATOMY" } },
  { id: "s", type: "STEP_BY_STEP", position: 10, payload: { steps: ["um"] } },
];

const challenges: PublicQuestion[] = [
  { id: "q1", kind: "PRACTICAL", usage: "EXERCISE", difficulty: "EASY", title: "t", statement: "Crie /a", hint: "use mkdir", solution: [{ command: "mkdir /a" }, { command: "ls", terminal: 2 }] },
  { id: "q2", kind: "PRACTICAL", usage: "EXERCISE", difficulty: "EASY", title: "t", statement: "Crie /b" },
  { id: "q3", kind: "THEORETICAL_SINGLE", usage: "EXERCISE", difficulty: "EASY", title: "t", statement: "teórica" },
];

function fakeWindow() {
  const ran: Step[] = [];
  let onCommand = () => {};
  const win: TerminalWindow = {
    run: vi.fn(async (step: Step) => {
      ran.push(step);
      onCommand();
    }),
    setSpeed: vi.fn(),
    snapshot: vi.fn(() => ({ machine: ran.length })),
    reset: vi.fn(async () => {}),
    load: vi.fn(),
    prepare: vi.fn(async () => {}),
    exportJson: vi.fn(),
    importJson: vi.fn(async () => false),
    focus: vi.fn(),
    destroy: vi.fn(),
  };
  const mount = vi.fn(async (_c: HTMLElement, _s: unknown, events: { onCommand(): void }) => {
    onCommand = events.onCommand;
    return win;
  });
  return { win, mount, ran };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function services(overrides: Partial<NonNullable<TopicScreenProps["practice"]>> = {}) {
  return {
    content: { blocks: vi.fn().mockResolvedValue(blocks), questions: vi.fn().mockResolvedValue(challenges) },
    modules: { getModuleById: vi.fn().mockResolvedValue(moduleDetails) },
    practice: {
      scenario: vi.fn().mockResolvedValue({ exercise: 1 }),
      topicScenario: vi.fn().mockResolvedValue({ topic: 1 }),
      checkModule: vi.fn().mockResolvedValue({ passed: ["q2"], progress: [] }),
      progress: vi.fn().mockResolvedValue([{ questionId: "q1", completedAt: "t", attempts: 0 }]),
      ...overrides,
    },
  };
}

async function open(props: Partial<TopicScreenProps> = {}) {
  const fake = fakeWindow();
  const storage = memoryStorage();
  const svc = services();
  await act(async () => {
    render(<TopicScreen moduleId="m1" backHref="/materials" mount={fake.mount} storage={storage} cheatSheet={async () => "<p>cola</p>"} {...svc} {...props} />);
  });
  await screen.findByRole("heading", { level: 1 });
  return { ...fake, storage, svc };
}

const click = async (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

// Covers SPEC-016 CA-01 to CA-07 and CA-10 (interface side).
describe("TopicScreen", () => {
  it("renders the prototype layout: header, player, lesson cards and the terminal window on the topic machine", async () => {
    const { mount, svc } = await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Navegação e diretórios");
    expect(screen.getByText("pwd · ls")).toBeTruthy();
    expect(mount).toHaveBeenCalledWith(expect.any(HTMLElement), { topic: 1 }, expect.anything());
    expect(svc.practice.topicScenario).toHaveBeenCalledWith("m1");
    expect(screen.getByRole("group", { name: m.player })).toBeTruthy();
    expect(screen.getByText(m.nextCard(1, 2, m.conceptsShort, m.conceptsTitle))).toBeTruthy();
    expect(document.querySelector(".rep-contador")!.textContent).toBe("0/3");
    // Lesson card rebuilt from the blocks (P-01).
    const lesson = screen.getByRole("heading", { level: 2, name: "Mostrar onde estou" }).closest("article")!;
    expect(lesson.className).toContain("licao");
    expect(within(lesson).getByText("pwd [-P]").closest(".licao-sintaxe")).toBeTruthy();
    expect(lesson.querySelector("table.licao-opcoes")).toBeTruthy();
    expect(lesson.querySelector("ul.licao-dicas")).toBeTruthy();
    expect(within(lesson).getByText("pegadinha").closest(".licao-pegadinha")).toBeTruthy();
    expect(within(lesson).getByText("na vida real").closest(".na-pratica")).toBeTruthy();
    expect(within(lesson).getByText(m.terminalTag(2))).toBeTruthy();
    expect(screen.getByText("conceitos").closest(".conceitos")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: m.runCard })).toHaveLength(2);
  });

  it("runs steps with ▶, the card play, the player and ⏮ at the chosen speed", async () => {
    const { win, ran, storage } = await open();
    await click(screen.getByRole("button", { name: `${m.runStep(1)}: ls /` }));
    expect(ran.map((s) => s.command)).toEqual(["ls /"]);

    await click(screen.getAllByRole("button", { name: m.runCard })[1]!);
    expect(ran.map((s) => s.command)).toEqual(["ls /", "pwd", "whoami"]);
    expect(ran[2]!.login).toEqual({ user: "ricardo", password: "123" });

    await click(screen.getByRole("button", { name: m.previous }));
    expect(win.load).toHaveBeenCalledWith({ topic: 1 });
    expect(win.setSpeed).toHaveBeenCalledWith(30);

    fireEvent.change(screen.getByRole("combobox", { name: m.speed }), { target: { value: "4" } });
    expect(win.setSpeed).toHaveBeenLastCalledWith(4);
    expect(storage.data.get("linux-lab:speed")).toBe("4");

    await click(screen.getByRole("button", { name: m.next }));
    await click(screen.getByRole("button", { name: m.playAll }));
    expect(ran.length).toBeGreaterThan(5);
    expect(screen.getByText(m.scriptDone)).toBeTruthy();
  });

  it("resets, exports, imports and opens the cheat sheet", async () => {
    const { win } = await open();
    await click(screen.getByRole("button", { name: m.reset }));
    expect(win.reset).toHaveBeenCalledWith({ topic: 1 });
    await click(screen.getByRole("button", { name: m.exportTitle }));
    expect(win.exportJson).toHaveBeenCalledWith(m.exportName("Navegação e diretórios"));
    await click(screen.getByRole("button", { name: m.importTitle }));
    expect(screen.getByRole("alert").textContent).toContain(m.importFailed);
    await click(screen.getByRole("button", { name: m.close }));
    expect(screen.queryByRole("alert")).toBeNull();

    await click(screen.getByRole("button", { name: m.cheatSheet }));
    const dialog = screen.getByRole("dialog", { name: m.cheatSheetTitle });
    expect(dialog.textContent).toContain("cola");
    await click(within(dialog).getByRole("button", { name: m.close }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("checks the challenges automatically and prepares an exercise machine", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { win, svc, ran } = await open();
      await click(screen.getByRole("tab", { name: /Desafios/ }));
      const list = screen.getAllByRole("listitem").filter((li) => li.className.includes("desafio"));
      expect(list).toHaveLength(2);
      expect(list[0]!.className).toContain("concluido");
      expect(document.querySelector(".contador-desafios")!.textContent).toBe("1/2");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(svc.practice.checkModule).toHaveBeenCalledWith("m1", { machine: 0 });
      expect(document.querySelector(".contador-desafios")!.textContent).toBe("2/2");

      await click(within(list[0]!).getByRole("button", { name: m.start }));
      expect(svc.practice.scenario).toHaveBeenCalledWith("q1");
      expect(win.prepare).toHaveBeenCalledWith({ exercise: 1 }, m.preparing(1));

      await click(within(list[0]!).getByRole("button", { name: m.runSolution }));
      expect(ran.map((s) => s.command)).toEqual(["mkdir /a", "ls"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invites visitors to log in and reports a challenge that cannot be prepared", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fake = fakeWindow();
      const svc = services({
        checkModule: vi.fn().mockRejectedValue(problem("not-authenticated", 401)),
        scenario: vi.fn().mockRejectedValue(new Error("404")),
        progress: vi.fn().mockRejectedValue(problem("not-authenticated", 401)),
      });
      await act(async () => {
        render(<TopicScreen moduleId="m1" backHref="/materials" mount={fake.mount} storage={null} {...svc} />);
      });
      await screen.findByRole("heading", { level: 1 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      await click(screen.getByRole("tab", { name: /Desafios/ }));
      expect(screen.getByRole("status").textContent).toContain(m.challengesLogin);
      await click(screen.getAllByRole("button", { name: m.start })[1]!);
      expect(screen.getByRole("alert").textContent).toContain(m.challengeFailed);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the machine saved in the browser and shows when the terminal cannot open", async () => {
    const first = fakeWindow();
    const storage = memoryStorage();
    await act(async () => {
      render(<TopicScreen moduleId="m1" backHref="/materials" mount={first.mount} storage={storage} {...services()} />);
    });
    await screen.findByRole("heading", { level: 1 });
    await click(screen.getByRole("button", { name: `${m.runStep(1)}: ls /` }));
    const key = [...storage.data.keys()].find((k) => k.startsWith("linux-lab:machine:m1:"))!;
    expect(JSON.parse(storage.data.get(key)!)).toEqual({ machine: 1 });
    cleanup();

    const second = fakeWindow();
    await act(async () => {
      render(<TopicScreen moduleId="m1" backHref="/materials" mount={second.mount} storage={storage} {...services()} />);
    });
    await screen.findByRole("heading", { level: 1 });
    expect(second.mount).toHaveBeenCalledWith(expect.any(HTMLElement), { machine: 1 }, expect.anything());
    cleanup();

    storage.data.set(key, "{broken");
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    await act(async () => {
      render(<TopicScreen moduleId="m1" backHref="/materials" mount={failing} storage={storage} {...services()} />);
    });
    expect(await screen.findByText(m.terminalFailed)).toBeTruthy();
    expect(failing).toHaveBeenCalledWith(expect.any(HTMLElement), { topic: 1 }, expect.anything());
  });

  it.each([
    [problem("module-not-found", 404), contentMessages.notFound, false],
    [problem("not-authenticated", 401), contentMessages.needsLogin, true],
    [problem("forbidden", 403), contentMessages.forbidden, false],
    [new Error("offline"), contentMessages.unexpected, false],
  ])("explains why a module cannot be opened (%#)", async (error, message, login) => {
    const svc = services();
    svc.content.blocks.mockRejectedValue(error);
    await act(async () => {
      render(<TopicScreen moduleId="m1" backHref="/materials" mount={fakeWindow().mount} storage={null} {...svc} />);
    });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByRole("link", { name: contentMessages.goToLogin }) !== null).toBe(login);
  });
});
