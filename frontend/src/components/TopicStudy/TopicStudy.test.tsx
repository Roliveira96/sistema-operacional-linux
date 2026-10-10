import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import { contentMessages } from "@/messages/content.pt-BR";
import type { SpeechResult } from "@/services/speechService";
import type { ContentBlock, PublicQuestion } from "@/services/contentService";
import { CHECK_DELAY_MS } from "@/hooks/useModuleCheck";
import "@/test/domMatchers";
import { TopicStudy, type TopicStudyProps } from "./TopicStudy";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const fake = vi.hoisted(() => {
  const window = {
    run: vi.fn(async () => {}),
    execute: vi.fn(async (step: { command: string; terminal?: number }) => ({
      status: step.command ? 0 : 1,
      output: "",
    })),
    history: vi.fn(() => []),
    setSpeed: vi.fn(),
    reset: vi.fn(),
    resetAnimated: vi.fn(async () => {}),
    loadScenario: vi.fn(async () => {}),
    snapshot: vi.fn(() => ({ formato: "exame-so/maquina" })),
    exportJson: vi.fn(),
    importJson: vi.fn(async () => {}),
    destroy: vi.fn(),
  };
  return {
    window,
    onCommand: undefined as undefined | ((snapshot: unknown) => void),
    mount: undefined as unknown,
  };
});

vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(
    async (
      _container: HTMLElement,
      _snapshot: unknown,
      callbacks: { onCommand(s: unknown): void },
    ) => {
      fake.onCommand = callbacks.onCommand;
      return fake.window;
    },
  ),
  cheatSheetHtml: vi.fn(
    async () => '<p class="cola-titulo-intro">Tabela Oficial</p>',
  ),
}));

const block = (
  position: number,
  type: string,
  payload: Record<string, unknown>,
): ContentBlock => ({ id: `b${position}`, type, position, payload });

const blocks: ContentBlock[] = [
  block(1, "LEGACY_HTML", { html: "<p>intro do módulo</p>" }),
  block(2, "COMMAND", {
    steps: [{ command: "uname -o", explanation: "nome do sistema" }],
  }),
  block(3, "TEXT", {
    title: "O Unix",
    command: "Unix",
    html: "<p>texto do card</p>",
  }),
  block(4, "COMMAND", {
    steps: [
      { command: "ls /etc", explanation: "lista" },
      {
        command: "whoami",
        terminal: 2,
        login: { user: "ricardo", password: "123" },
      },
    ],
  }),
  block(5, "CURIOSITY", { title: "Na vida real", html: "curiosidade" }),
];

const challenge = (
  id: string,
  extra: Partial<PublicQuestion> = {},
): PublicQuestion => ({
  id,
  kind: "PRACTICAL",
  usage: "EXERCISE",
  difficulty: "EASY",
  title: id,
  statement: `Enunciado ${id}`,
  hint: `Dica ${id}`,
  solution: [{ command: `echo ${id}` }, { command: "whoami", terminal: 2 }],
  ...extra,
});

const moduleDetails = {
  id: "m1",
  title: "História do Linux",
  description: "Unix · GNU — De onde veio o Linux.",
  icon: "📜",
  color: "--cor-hist",
} as never;

function defaultPractice() {
  return {
    scenario: vi
      .fn()
      .mockResolvedValue({ formato: "exame-so/maquina", cenario: "exercicio" }),
    topicScenario: vi
      .fn()
      .mockResolvedValue({ formato: "exame-so/maquina", cenario: "topico" }),
    checkModule: vi.fn().mockResolvedValue({ passed: [], progress: [] }),
    progress: vi.fn().mockResolvedValue([]),
  };
}

const visitor = () => ({
  me: vi
    .fn()
    .mockRejectedValue(
      new ApiProblemError(
        { type: "not-authenticated", title: "x", status: 401 },
        401,
      ),
    ),
  studentProfile: vi.fn(),
});

const spoken = (words: SpeechResult["words"] = []): SpeechResult => ({
  audioBase64: "QUJD",
  mimeType: "audio/mpeg",
  voice: "pt-BR-FranciscaNeural",
  words,
});

function defaultSpeech() {
  return { synthesize: vi.fn().mockResolvedValue(spoken()) };
}

function setup(overrides: Partial<TopicStudyProps> = {}) {
  const content = {
    content: vi.fn().mockResolvedValue({ blocks, setup: undefined }),
    questions: vi
      .fn()
      .mockResolvedValue([
        challenge("q1"),
        challenge("q2"),
        challenge("t1", { kind: "THEORETICAL" }),
      ]),
  };
  const modules = { getModuleById: vi.fn().mockResolvedValue(moduleDetails) };
  const practice = defaultPractice();
  const confirm = vi.fn().mockReturnValue(true);
  const speech = defaultSpeech();
  const utils = render(
    <TopicStudy
      moduleId="m1"
      backHref="/materials"
      content={content}
      modules={modules}
      practice={practice}
      speech={speech}
      identity={visitor()}
      confirm={confirm}
      {...overrides}
    />,
  );
  return { ...utils, content, modules, practice, confirm, speech };
}

async function loaded() {
  const utils = setup();
  await screen.findByRole("heading", { name: "História do Linux" });
  await waitFor(() => expect(fake.window.setSpeed).toHaveBeenCalled());
  return utils;
}

beforeEach(() => {
  // jsdom does not implement scrolling.
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  // The screen tests of SPEC-016 run without the voice; the narration tests turn it on.
  localStorage.setItem("exame-so:narracao", "off");
  Object.values(fake.window).forEach((fn) =>
    (fn as ReturnType<typeof vi.fn>).mockClear?.(),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TopicStudy loading", () => {
  it("shows the loading state first", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
  });

  // Covers SPEC-016 CA-05 and CA-09 (errors of the routes).
  it.each([
    [404, /não existe/i, false],
    [401, /Entre na plataforma/, true],
    [403, /restrito/i, false],
    [500, /Não foi possível/, false],
  ])("shows the message for a %s", async (status, text, login) => {
    setup({
      content: {
        content: vi
          .fn()
          .mockRejectedValue(
            new ApiProblemError({ type: "x", title: "x", status }, status),
          ),
        questions: vi.fn(),
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(Boolean(screen.queryByRole("link", { name: "Entrar" }))).toBe(login);
    expect(
      screen.getByRole("link", { name: /Voltar aos materiais/ }),
    ).toHaveAttribute("href", "/materials");
  });
});

// Covers CA-01: header with player and speed, tabs on the left, terminal on the right.
describe("TopicStudy screen", () => {
  it("shows the header, the tabs, the lesson cards and the terminal", async () => {
    await loaded();
    expect(screen.getByRole("link", { name: /Materiais/ })).toHaveAttribute(
      "href",
      "/materials",
    );
    expect(screen.getByText("Unix · GNU")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Roteiro automático" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(
      screen.getByRole("tab", { name: /Comandos e dicas/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Desafios/ })).toHaveTextContent(
      "0/2",
    );
    expect(screen.getByText("Antes dos comandos")).toBeInTheDocument();
    expect(screen.getByText("O Unix")).toBeInTheDocument();
    expect(screen.getByText("intro do módulo")).toBeInTheDocument();
  });

  it("starts the terminal on the topic scenario", async () => {
    const { practice } = await loaded();
    expect(practice.topicScenario).toHaveBeenCalledWith("m1");
    const { mountTerminalWindow } = await import("@/engine/terminalWindow");
    expect(vi.mocked(mountTerminalWindow).mock.calls.at(-1)?.[1]).toEqual({
      formato: "exame-so/maquina",
      cenario: "topico",
    });
  });

  // Covers CA-06: the machine survives a reload.
  it("starts from the machine saved in the browser and saves after each command", async () => {
    await loaded();
    act(() => fake.onCommand?.({ salvo: 1 }));
    const key = Object.keys(localStorage).find((k) => k.includes("topic-m1-"));
    expect(key).toBeDefined();
    expect(JSON.parse(localStorage.getItem(key!)!)).toEqual({ salvo: 1 });

    const { mountTerminalWindow } = await import("@/engine/terminalWindow");
    vi.mocked(mountTerminalWindow).mockClear();
    setup();
    await waitFor(() => expect(mountTerminalWindow).toHaveBeenCalled());
    expect(vi.mocked(mountTerminalWindow).mock.calls.at(-1)?.[1]).toEqual({
      salvo: 1,
    });
  });

  // Covers CA-03: the play of a command, of a card and of the whole script.
  it("runs a single command from its play button", async () => {
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: /Executar no terminal 1: uname -o/ }),
    );
    await waitFor(() =>
      expect(fake.window.run).toHaveBeenCalledWith(
        expect.objectContaining({ command: "uname -o" }),
      ),
    );
  });

  it("runs a whole card and shows the stop label while it plays", async () => {
    await loaded();
    const cards = screen.getAllByRole("button", { name: /Rodar este card/ });
    fireEvent.click(cards[1]!);
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(fake.window.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ command: "ls /etc" }),
    );
    expect(fake.window.run).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "whoami",
        terminal: 2,
        login: { user: "ricardo", password: "123" },
      }),
    );
  });

  it("steps forward with the next button and back with the previous one", async () => {
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: /Executa só o próximo/ }),
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Volta um passo/ }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Volta um passo/ }));
    await waitFor(() =>
      expect(fake.window.reset).toHaveBeenCalledWith({
        formato: "exame-so/maquina",
        cenario: "topico",
      }),
    );
    expect(await screen.findByText(/Voltou ao início/)).toBeInTheDocument();
  });

  it("plays the whole script with the space bar and ignores keys typed in the terminal", async () => {
    await loaded();
    const terminal = document.createElement("div");
    terminal.className = "term";
    const field = document.createElement("textarea");
    terminal.appendChild(field);
    document.body.appendChild(terminal);
    fireEvent.keyDown(field, { key: "ArrowRight" });
    expect(fake.window.run).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() => expect(fake.window.reset).toHaveBeenCalled());
    fireEvent.keyDown(document.body, { key: " " });
    expect(
      await screen.findByRole("button", { name: /Pausa o roteiro/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    terminal.remove();
  });

  // Covers SPEC-018 RF-07 and CA-13: two sliders, one for the typing and one for the voice.
  it("has a slider for the typing speed and another for the reading speed of the voice", async () => {
    await loaded();
    const typing = screen.getByRole("slider", {
      name: /digitação/,
    }) as HTMLInputElement;
    const voice = screen.getByRole("slider", {
      name: /leitura/,
    }) as HTMLInputElement;
    expect([typing.min, typing.max, voice.min, voice.max]).toEqual([
      "0.5",
      "4",
      "0.5",
      "2",
    ]);
    expect(typing.value).toBe("1");
    expect(voice.value).toBe("1");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("applies and remembers the typing speed on its own", async () => {
    await loaded();
    fireEvent.change(screen.getByRole("slider", { name: /digitação/ }), {
      target: { value: "2.5" },
    });
    expect(fake.window.setSpeed).toHaveBeenLastCalledWith(2.5);
    expect(localStorage.getItem("exame-so:velocidade")).toBe("2.5");
    expect(localStorage.getItem("exame-so:velocidade-voz")).toBeNull();
    expect(screen.getByText("2,5×")).toBeTruthy();
  });

  it("applies and remembers the reading speed of the voice without touching the terminal", async () => {
    await loaded();
    fake.window.setSpeed.mockClear();
    fireEvent.change(screen.getByRole("slider", { name: /leitura/ }), {
      target: { value: "1.5" },
    });
    expect(localStorage.getItem("exame-so:velocidade-voz")).toBe("1.5");
    expect(localStorage.getItem("exame-so:velocidade")).toBeNull();
    expect(fake.window.setSpeed).not.toHaveBeenCalled();
  });

  it("starts from the speeds saved in the browser", async () => {
    localStorage.setItem("exame-so:velocidade", "3");
    localStorage.setItem("exame-so:velocidade-voz", "0.75");
    await loaded();
    expect(
      (screen.getByRole("slider", { name: /digitação/ }) as HTMLInputElement)
        .value,
    ).toBe("3");
    expect(
      (screen.getByRole("slider", { name: /leitura/ }) as HTMLInputElement)
        .value,
    ).toBe("0.75");
  });
});

// Covers SPEC-016 CA-12: the student drags the divider to give the material or the terminal more room.
describe("TopicStudy divider", () => {
  const divider = () => screen.getByRole("separator");
  const columns = () =>
    (divider().parentElement as HTMLElement).getAttribute("style") ?? "";

  it("starts at the default share and shows it to assistive technology", async () => {
    await loaded();
    expect(divider()).toHaveAttribute("aria-valuenow", "44");
    expect(divider()).toHaveAttribute("aria-valuemin", "25");
    expect(divider()).toHaveAttribute("aria-valuemax", "75");
    expect(divider()).toHaveAttribute(
      "aria-valuetext",
      "Material com 44% da largura",
    );
    expect(columns()).toContain("minmax(0, 44fr) 10px minmax(0, 56fr)");
  });

  it("starts from the share saved in the browser, kept within the limits", async () => {
    localStorage.setItem("exame-so:divisao", "60");
    await loaded();
    expect(divider()).toHaveAttribute("aria-valuenow", "60");
    cleanup();
    localStorage.setItem("exame-so:divisao", "3");
    await loaded();
    expect(divider()).toHaveAttribute("aria-valuenow", "25");
  });

  it("moves with the arrow keys, faster with Shift, to the limits with Home and End, and remembers it", async () => {
    await loaded();
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(divider()).toHaveAttribute("aria-valuenow", "46");
    expect(localStorage.getItem("exame-so:divisao")).toBe("46");
    fireEvent.keyDown(divider(), { key: "ArrowLeft", shiftKey: true });
    expect(divider()).toHaveAttribute("aria-valuenow", "40");
    fireEvent.keyDown(divider(), { key: "End" });
    expect(divider()).toHaveAttribute("aria-valuenow", "75");
    fireEvent.keyDown(divider(), { key: "ArrowRight" });
    expect(divider()).toHaveAttribute("aria-valuenow", "75");
    fireEvent.keyDown(divider(), { key: "Home" });
    expect(divider()).toHaveAttribute("aria-valuenow", "25");
    expect(columns()).toContain("minmax(0, 25fr) 10px minmax(0, 75fr)");
    fireEvent.keyDown(divider(), { key: "Tab" });
    expect(divider()).toHaveAttribute("aria-valuenow", "25");
  });

  it("follows the pointer while dragging, stays within the limits and saves when released", async () => {
    await loaded();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerMove(divider(), { clientX: 700 });
    expect(divider()).toHaveAttribute("aria-valuenow", "44");

    fireEvent.pointerDown(divider(), { pointerId: 1 });
    fireEvent.pointerMove(divider(), { clientX: 620 });
    expect(divider()).toHaveAttribute("aria-valuenow", "62");
    expect(localStorage.getItem("exame-so:divisao")).toBeNull();
    fireEvent.pointerMove(divider(), { clientX: 990 });
    expect(divider()).toHaveAttribute("aria-valuenow", "75");
    fireEvent.pointerMove(divider(), { clientX: 10 });
    expect(divider()).toHaveAttribute("aria-valuenow", "25");
    fireEvent.pointerUp(divider());
    expect(localStorage.getItem("exame-so:divisao")).toBe("25");

    fireEvent.pointerMove(divider(), { clientX: 500 });
    expect(divider()).toHaveAttribute("aria-valuenow", "25");
    vi.restoreAllMocks();
  });

  it("stops dragging when the pointer is cancelled", async () => {
    await loaded();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      right: 1000,
      bottom: 800,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(divider(), { pointerId: 1 });
    fireEvent.pointerCancel(divider());
    fireEvent.pointerMove(divider(), { clientX: 800 });
    expect(divider()).toHaveAttribute("aria-valuenow", "44");
    vi.restoreAllMocks();
  });

  it("goes back to the default share on a double click, and a single click changes nothing", async () => {
    localStorage.setItem("exame-so:divisao", "70");
    await loaded();
    fireEvent.click(divider(), { detail: 1 });
    expect(divider()).toHaveAttribute("aria-valuenow", "70");
    fireEvent.click(divider(), { detail: 2 });
    expect(divider()).toHaveAttribute("aria-valuenow", "44");
    expect(localStorage.getItem("exame-so:divisao")).toBe("44");
  });
});

// Covers SPEC-016 CA-11: the signed-in user at the left of the header.
describe("TopicStudy user", () => {
  const student = {
    me: vi
      .fn()
      .mockResolvedValue({
        name: "Ana Souza",
        email: "ana@example.com",
        role: "STUDENT",
      }),
    studentProfile: vi
      .fn()
      .mockResolvedValue({
        name: "Ana Souza",
        academicId: "2345678",
        avatarUrl: "http://files/ana.png",
      }),
  };

  it("shows the photo, the name and the academic ID of the student at the right end of the header", async () => {
    setup({ identity: student });
    expect(await screen.findByText("RA 2345678")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Foto de Ana Souza" })).toBeTruthy();
    const header = screen
      .getByRole("heading", { name: "História do Linux" })
      .closest("header")!;
    expect(header.lastElementChild?.textContent).toContain("Ana Souza");
  });

  it("shows nobody for a visitor", async () => {
    await loaded();
    expect(screen.queryByText(/^RA /)).toBeNull();
    expect(screen.queryByTitle("Ana Souza")).toBeNull();
  });
});

// Covers SPEC-021 RN-05: the student's machine is prepared by the snapshots, the module first and then the cards.
describe("TopicStudy snapshots", () => {
  const withSetups = () => ({
    content: {
      content: vi.fn().mockResolvedValue({
        blocks: [
          block(1, "TEXT", {
            title: "A",
            html: "<p>a</p>",
            setup: { steps: [{ command: "card-a" }] },
          }),
          block(2, "TEXT", {
            title: "B",
            html: "<p>b</p>",
            setup: { steps: [{ command: "card-b", terminal: 2 }] },
          }),
        ],
        setup: { steps: [{ command: "module-1" }] },
      }),
      questions: vi.fn().mockResolvedValue([]),
    },
  });
  const ran = () =>
    fake.window.execute.mock.calls.map(([step]) => step.command);

  it("runs the snapshot of the module and then those of the cards, in order, on a new machine, and keeps the result", async () => {
    setup(withSetups());
    await waitFor(() =>
      expect(ran()).toEqual(["module-1", "card-a", "card-b"]),
    );
    expect(fake.window.execute.mock.calls[2]![0]).toMatchObject({
      terminal: 2,
    });
    await waitFor(() =>
      expect(
        Object.keys(localStorage).some(
          (k) =>
            k.startsWith("exame-so:maquina:") &&
            localStorage.getItem(k)?.includes("exame-so/maquina"),
        ),
      ).toBe(true),
    );
  });

  it("does not run them again when the student comes back to a saved machine", async () => {
    const first = setup(withSetups());
    await waitFor(() => expect(ran()).toHaveLength(3));
    first.unmount();
    fake.window.execute.mockClear();
    setup(withSetups());
    await screen.findByRole("heading", { name: "História do Linux" });
    await waitFor(() => expect(fake.window.setSpeed).toHaveBeenCalled());
    expect(ran()).toEqual([]);
  });

  it("runs them again after the machine is reset", async () => {
    setup(withSetups());
    await waitFor(() => expect(ran()).toHaveLength(3));
    fake.window.execute.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    await waitFor(() =>
      expect(ran()).toEqual(["module-1", "card-a", "card-b"]),
    );
    expect(fake.window.resetAnimated).toHaveBeenCalled();
  });

  it("starts at once when there are no snapshots", async () => {
    await loaded();
    expect(fake.window.execute).not.toHaveBeenCalled();
  });
});

describe("TopicStudy actions", () => {
  // Covers CA-02: Reset Máquina asks for confirmation and returns to the topic scenario.
  it("resets the machine after confirming", async () => {
    const { confirm } = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    await waitFor(() =>
      expect(fake.window.resetAnimated).toHaveBeenCalledWith({
        formato: "exame-so/maquina",
        cenario: "topico",
      }),
    );
    expect(confirm).toHaveBeenCalled();
    expect(
      await screen.findByText(/formatada e reiniciada/),
    ).toBeInTheDocument();
  });

  it("does nothing when the reset is not confirmed", async () => {
    const { confirm } = await loaded();
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    expect(fake.window.resetAnimated).not.toHaveBeenCalled();
  });

  // Covers CA-06: export and import of the machine.
  it("exports and imports the machine", async () => {
    await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: "Baixa a máquina em JSON" }),
    );
    expect(fake.window.exportJson).toHaveBeenCalledWith(
      "maquina-História do Linux",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Carrega uma máquina em JSON" }),
    );
    expect(await screen.findByText(/importada do JSON/)).toBeInTheDocument();

    fake.window.importJson.mockRejectedValueOnce(new Error("bad"));
    fireEvent.click(
      screen.getByRole("button", { name: "Carrega uma máquina em JSON" }),
    );
    expect(
      await screen.findByText(/Não foi possível ler o JSON/),
    ).toBeInTheDocument();
  });

  // Covers CA-07: the cheat sheet of the prototype.
  it("opens and closes the cheat sheet", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    const dialog = await screen.findByRole(
      "dialog",
      { name: /Cola de comandos/ },
      { timeout: 4000 },
    );
    expect(within(dialog).getByText("Tabela Oficial")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    const again = await screen.findByRole("dialog", {}, { timeout: 4000 });
    fireEvent.click(again.parentElement!);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Fechar" }, { timeout: 4000 }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

describe("TopicStudy challenges", () => {
  async function openChallenges() {
    const utils = await loaded();
    fireEvent.click(screen.getByRole("tab", { name: /Desafios/ }));
    return utils;
  }

  it("lists only the practical exercises with hint and solution", async () => {
    await openChallenges();
    expect(screen.getByText(/Enunciado q1/)).toBeInTheDocument();
    expect(screen.getByText(/Enunciado q2/)).toBeInTheDocument();
    expect(screen.queryByText(/Enunciado t1/)).not.toBeInTheDocument();
    expect(screen.getAllByText("💡 Dica")).toHaveLength(2);
    expect(
      screen.getAllByText("echo q1", { exact: false })[0],
    ).toHaveTextContent("[T2] whoami");
  });

  // Covers CA-10: starting an exercise loads its scenario into the same window.
  it("loads the scenario of the exercise in the same window", async () => {
    const { practice } = await openChallenges();
    fireEvent.click(screen.getAllByRole("button", { name: "▶ Iniciar" })[0]!);
    await waitFor(() =>
      expect(fake.window.loadScenario).toHaveBeenCalledWith({
        formato: "exame-so/maquina",
        cenario: "exercicio",
      }),
    );
    expect(practice.scenario).toHaveBeenCalledWith("q1");
  });

  // Covers SPEC-023 CA-06: an exercise of the module has no scenario; it starts from the topic machine with the snapshot of the
  // module and the one of the available exercises on it, and not with the snapshots of the cards.
  it("starts an exercise made in the editor from the layers of the module and of the available exercises", async () => {
    const withCardSnapshot = [
      block(1, "TEXT", {
        title: "Card",
        html: "<p>x</p>",
        setup: { steps: [{ command: "mkdir /card" }] },
      }),
    ];
    const { practice } = setup({
      content: {
        content: vi
          .fn()
          .mockResolvedValue({
            blocks: withCardSnapshot,
            setup: { summary: "", steps: [{ command: "mkdir /modulo" }] },
            exercisesSetup: {
              summary: "",
              steps: [{ command: "mkdir /treino" }],
            },
          }),
        questions: vi
          .fn()
          .mockResolvedValue([challenge("q1", { layered: true })]),
      },
    });
    await screen.findByRole("heading", { name: "História do Linux" });
    await waitFor(() => expect(fake.window.setSpeed).toHaveBeenCalled());
    fake.window.execute.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: /Desafios/ }));
    fireEvent.click(screen.getByRole("button", { name: "▶ Iniciar" }));
    await waitFor(() =>
      expect(fake.window.loadScenario).toHaveBeenCalledWith({
        formato: "exame-so/maquina",
        cenario: "topico",
      }),
    );
    await waitFor(() =>
      expect(
        fake.window.execute.mock.calls.map(
          (c) => (c as unknown as [{ command: string }])[0].command,
        ),
      ).toEqual(["mkdir /modulo", "mkdir /treino"]),
    );
    expect(practice.scenario).not.toHaveBeenCalled();
  });

  it("warns when the scenario cannot be loaded", async () => {
    const { practice } = await openChallenges();
    practice.scenario.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getAllByRole("button", { name: "▶ Iniciar" })[0]!);
    expect(
      await screen.findByText(/Não foi possível preparar a máquina/),
    ).toBeInTheDocument();
  });

  it("runs the reference solution in the terminal", async () => {
    await openChallenges();
    fireEvent.click(screen.getAllByText("▶ Executar a solução")[0]!);
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(fake.window.run).toHaveBeenNthCalledWith(1, { command: "echo q1" });
  });

  // Covers CA-04: after a command the server checks the challenges and the done ones are marked.
  it("checks the machine after the quiet time and marks the challenges met", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { practice } = await openChallenges();
    practice.checkModule.mockResolvedValue({
      passed: ["q1"],
      progress: [{ questionId: "q1", completedAt: "t" }],
    });
    act(() => fake.onCommand?.({ estado: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 50);
    });
    expect(practice.checkModule).toHaveBeenCalledWith("m1", { estado: 1 });
    expect(await screen.findByText(/Desafio concluído!/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Desafios/ })).toHaveTextContent(
      "1/2",
    );
    expect(
      screen.getAllByRole("img", { name: "Desafio atendido" }),
    ).toHaveLength(1);
  });

  it("starts with the progress the student already has", async () => {
    setup({
      practice: {
        ...defaultPractice(),
        progress: vi
          .fn()
          .mockResolvedValue([
            { questionId: "q2", completedAt: "t", attempts: 1 },
          ]),
      },
    });
    const tab = await screen.findByRole("tab", { name: /Desafios/ });
    await waitFor(() => expect(tab).toHaveTextContent("1/2"));
  });

  // Covers CA-05: a visitor is invited to sign in.
  it("invites a visitor to sign in when the check answers 401", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { practice } = await openChallenges();
    practice.checkModule.mockRejectedValue(
      new ApiProblemError(
        { type: "not-authenticated", title: "x", status: 401 },
        401,
      ),
    );
    act(() => fake.onCommand?.({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 50);
    });
    expect(
      await screen.findByText(/Entre na plataforma para o servidor conferir/),
    ).toBeInTheDocument();
  });

  it("shows an empty state for a module without challenges", async () => {
    setup({
      content: {
        content: vi.fn().mockResolvedValue({ blocks, setup: undefined }),
        questions: vi.fn().mockResolvedValue([]),
      },
    });
    fireEvent.click(await screen.findByRole("tab", { name: /Desafios/ }));
    expect(
      await screen.findByText(/ainda não tem desafios práticos/),
    ).toBeInTheDocument();
  });

  it("opens straight on the challenges when the module has no lesson content", async () => {
    setup({
      content: {
        content: vi.fn().mockResolvedValue({ blocks: [], setup: undefined }),
        questions: vi.fn().mockResolvedValue([challenge("q1")]),
      },
    });
    expect(await screen.findByText(/Enunciado q1/)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Roteiro automático" }),
    ).not.toBeInTheDocument();
  });
});

// A voice that finishes by itself, as soon as it starts.
class AutoAudio {
  src = "";
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(() => {
    window.setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  });
  pause = vi.fn();
}

// Covers SPEC-018: the card is read aloud and each command is spoken while it runs.
describe("TopicStudy narration", () => {
  beforeEach(() => {
    localStorage.setItem("exame-so:narracao", "on");
    vi.stubGlobal("Audio", AutoAudio);
  });
  afterEach(() => vi.unstubAllGlobals());

  const callOrder = (
    fn: { mock: { invocationCallOrder: number[] } },
    index = 0,
  ) => fn.mock.invocationCallOrder[index]!;

  const NOTICES = contentMessages.topic.narration.watchTerminal;
  const NOTICE = "<aviso>";
  /** The texts sent to the voice, with any of the 15 notices shown as one marker. */
  const said = (speech: { synthesize: { mock: { calls: unknown[][] } } }) =>
    speech.synthesize.mock.calls.map(([text]) =>
      NOTICES.includes(text as string) ? NOTICE : (text as string),
    );

  // Covers CA-01 to CA-03 and CA-15: title and text, then each command is said, explained and announced before it runs.
  it("reads the card and says each command, what it does and the notice before running it", async () => {
    const { speech } = await loaded();
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    // The player pauses between commands, so the last block comes after a real wait.
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalledTimes(8), {
      timeout: 5000,
    });

    // Two commands, two notices: the second one is a different phrase (CA-18).
    expect(said(speech)).toEqual([
      "O Unix",
      "texto do card",
      "L S barra E T C",
      "lista",
      NOTICE,
      "who am I",
      NOTICE,
      "Na vida real curiosidade",
    ]);
    expect(speech.synthesize.mock.calls[4]![0]).not.toBe(
      speech.synthesize.mock.calls[6]![0],
    );
    // Each command runs only after being said: first "ls /etc" (after its notice), then "whoami".
    expect(callOrder(speech.synthesize, 4)).toBeLessThan(
      callOrder(fake.window.run, 0),
    );
    expect(callOrder(fake.window.run, 0)).toBeLessThan(
      callOrder(speech.synthesize, 5),
    );
    expect(callOrder(speech.synthesize, 6)).toBeLessThan(
      callOrder(fake.window.run, 1),
    );
    expect(fake.window.run).toHaveBeenCalledTimes(2);
  }, 20000);

  // Covers SPEC-020 CA-07: a command that must fail on purpose is marked and announced.
  it("marks a command that must fail on purpose and warns before running it", async () => {
    const content = {
      content: vi
        .fn()
        .mockResolvedValue({
          blocks: [
            block(1, "TEXT", { title: "T", html: "<p>x</p>" }),
            block(2, "COMMAND", {
              steps: [
                { command: "uname -o", expectError: true },
                { command: "pwd" },
              ],
            }),
          ],
          setup: undefined,
        }),
      questions: vi.fn().mockResolvedValue([]),
    };
    const { speech } = setup({ content });
    await screen.findByRole("heading", { name: "História do Linux" });
    expect(screen.getAllByText("erro esperado")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", { name: /Executar no terminal 1: uname -o/ }),
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    expect(said(speech)).toEqual([
      "iú name traço o",
      "Atenção: este comando vai dar erro de propósito.",
      NOTICE,
    ]);

    // A normal command gets no such warning.
    fireEvent.click(
      screen.getByRole("button", { name: /Executar no terminal 1: pwd/ }),
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(said(speech).slice(3)).not.toContain(
      "Atenção: este comando vai dar erro de propósito.",
    );
  });

  it("says the command and the notice for a step without explanation, then runs it", async () => {
    const { speech } = await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: /Executar no terminal 2: whoami/ }),
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    expect(said(speech)).toEqual(["who am I", NOTICE]);
    expect(callOrder(speech.synthesize, 1)).toBeLessThan(
      callOrder(fake.window.run, 0),
    );
  });

  it("explains a step with the words of the page, highlighted one by one", async () => {
    const { speech } = await loaded();
    fireEvent.click(
      screen.getByRole("button", { name: /Executar no terminal 1: ls \/etc/ }),
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalled());
    expect(said(speech)).toEqual(["L S barra E T C", "lista", NOTICE]);
  });

  // Covers CA-16: cutting the narration in the middle of a step keeps the command from running.
  it("does not run the command when the narration is stopped before it", async () => {
    const speech = {
      synthesize: vi.fn((text: string) =>
        text === "L S barra E T C"
          ? new Promise<SpeechResult>(() => {})
          : Promise.resolve(spoken()),
      ),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    await waitFor(() =>
      expect(speech.synthesize).toHaveBeenCalledWith("L S barra E T C"),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Parar/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull(),
    );
    expect(fake.window.run).not.toHaveBeenCalled();
  });

  // The highlighted card is the one being played, not the next command of the script.
  it("highlights the card that was played and not the one below it", async () => {
    const speech = {
      synthesize: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    const card = (index: number) =>
      document.querySelector(`article[data-card="${index}"]`) as HTMLElement;
    expect(card(1).className).not.toContain("active");

    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalled());
    expect(card(1).className).toContain("active");
    expect(card(0).className).not.toContain("active");

    fireEvent.click(await screen.findByRole("button", { name: /Parar/ }));
    await waitFor(() => expect(card(1).className).not.toContain("active"));
  });

  // Covers CA-04: stopping the card silences the voice.
  it("silences the voice when the card is stopped", async () => {
    const speech = {
      synthesize: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /Parar/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull(),
    );
  });

  // Covers CA-07 and CA-08: the sound button and its memory.
  it("turns the sound off and keeps the choice, and the card plays without asking for voice", async () => {
    const { speech } = await loaded();
    const toggle = screen.getByRole("button", { name: /Som/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Mudo/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(localStorage.getItem("exame-so:narracao")).toBe("off");

    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(speech.synthesize).not.toHaveBeenCalled();
  });

  // Covers CA-06 (P-01): a visitor gets the invitation and the commands still run.
  it("invites a visitor to sign in and keeps running the commands in silence", async () => {
    const speech = {
      synthesize: vi
        .fn()
        .mockRejectedValue(
          new ApiProblemError(
            { type: "not-authenticated", title: "x", status: 401 },
            401,
          ),
        ),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    expect(
      await screen.findByText(/Entre na plataforma para ouvir o material/),
    ).toBeTruthy();
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(speech.synthesize).toHaveBeenCalledTimes(1);
  });

  // Covers CA-05: a failing voice warns once and the script goes on.
  it("warns once when the voice fails and still runs every command", async () => {
    const speech = {
      synthesize: vi
        .fn()
        .mockRejectedValue(
          new ApiProblemError(
            { type: "speech-unavailable", title: "x", status: 503 },
            503,
          ),
        ),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    expect(
      await screen.findByText(/Não foi possível gerar a voz agora/),
    ).toBeTruthy();
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(
      screen.getAllByText(/Não foi possível gerar a voz agora/),
    ).toHaveLength(1);
  });

  it("tells the student when the browser blocks the sound", async () => {
    class BlockedAudio extends AutoAudio {
      play = vi.fn(() =>
        Promise.reject(new DOMException("blocked", "NotAllowedError")),
      );
    }
    vi.stubGlobal("Audio", BlockedAudio);
    await loaded();
    fireEvent.click(
      screen.getAllByRole("button", { name: /Rodar este card/ })[1]!,
    );
    expect(await screen.findByText(/navegador bloqueou o som/)).toBeTruthy();
  });
});

// Covers SPEC-022 CA-06 and CA-11: the exercises of a card in the study screen check the machine of the student.
describe("TopicStudy exercises", () => {
  const exercises = block(4, "EXERCISES", {
    items: [
      {
        title: "Criar a pasta financeiro",
        difficulty: "EASY",
        description: "<p>Crie a pasta.</p>",
        hints: [{ text: "Use o mkdir", command: "mkdir /srv/financeiro" }],
        conditions: [{ kind: "DIR_EXISTS", path: "/srv/financeiro" }],
      },
    ],
  });
  const withExercises = [
    block(1, "TEXT", { title: "Pastas", html: "<p>texto</p>" }),
    block(2, "COMMAND", { steps: [{ command: "ls" }] }),
    exercises,
  ];
  const machine = (...folders: string[]) => ({
    raiz: {
      nome: "",
      tipo: "diretorio",
      dono: 0,
      grupo: 0,
      permissoes: "755",
      filhos: [
        {
          nome: "srv",
          tipo: "diretorio",
          dono: 0,
          grupo: 0,
          permissoes: "755",
          filhos: folders.map((nome) => ({
            nome,
            tipo: "diretorio",
            dono: 0,
            grupo: 0,
            permissoes: "755",
            filhos: [],
          })),
        },
      ],
    },
    contas: {
      usuarios: [{ nome: "root", uid: 0 }],
      grupos: [{ nome: "root", gid: 0 }],
    },
  });

  it("shows the exercise with its tip on demand and checks how it ended on the machine of the screen", async () => {
    setup({
      content: {
        content: vi
          .fn()
          .mockResolvedValue({ blocks: withExercises, setup: undefined }),
        questions: vi.fn().mockResolvedValue([]),
      },
    });
    await screen.findByRole("heading", { name: "Criar a pasta financeiro" });
    expect(screen.queryByText("Use o mkdir")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Mostrar dica (1 de 1)" }),
    );
    expect(screen.getByText("Use o mkdir")).toBeInTheDocument();

    // The student has not made the folder yet.
    fake.window.snapshot.mockReturnValue(machine() as never);
    fireEvent.click(
      screen.getByRole("button", { name: "Verificar meu exercício" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A pasta /srv/financeiro existe",
    );

    // Now the machine has it, however it got there.
    fake.window.snapshot.mockReturnValue(machine("financeiro") as never);
    fireEvent.click(
      screen.getByRole("button", { name: "Verificar meu exercício" }),
    );
    expect(screen.getByText("✓ Exercício concluído")).toBeInTheDocument();
    fake.window.snapshot.mockReturnValue({
      formato: "exame-so/maquina",
    } as never);
  });
});
