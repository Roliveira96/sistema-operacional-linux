import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "@/services/httpClient";
import type { SpeechResult } from "@/services/speechService";
import type { ContentBlock, PublicQuestion } from "@/services/contentService";
import { CHECK_DELAY_MS } from "@/hooks/useModuleCheck";
import "@/test/domMatchers";
import { TopicStudy, type TopicStudyProps } from "./TopicStudy";

// The terminal window of the prototype is exercised in src/engine; here it is replaced.
const fake = vi.hoisted(() => {
  const window = {
    run: vi.fn(async () => {}),
    setSpeed: vi.fn(),
    reset: vi.fn(),
    resetAnimated: vi.fn(async () => {}),
    loadScenario: vi.fn(async () => {}),
    snapshot: vi.fn(() => ({ formato: "exame-so/maquina" })),
    exportJson: vi.fn(),
    importJson: vi.fn(async () => {}),
    destroy: vi.fn(),
  };
  return { window, onCommand: undefined as undefined | ((snapshot: unknown) => void), mount: undefined as unknown };
});

vi.mock("@/engine/terminalWindow", () => ({
  mountTerminalWindow: vi.fn(async (_container: HTMLElement, _snapshot: unknown, callbacks: { onCommand(s: unknown): void }) => {
    fake.onCommand = callbacks.onCommand;
    return fake.window;
  }),
  cheatSheetHtml: vi.fn(async () => '<p class="cola-titulo-intro">Tabela Oficial</p>'),
}));

const block = (position: number, type: string, payload: Record<string, unknown>): ContentBlock => ({ id: `b${position}`, type, position, payload });

const blocks: ContentBlock[] = [
  block(1, "LEGACY_HTML", { html: "<p>intro do módulo</p>" }),
  block(2, "COMMAND", { steps: [{ command: "uname -o", explanation: "nome do sistema" }] }),
  block(3, "TEXT", { title: "O Unix", command: "Unix", html: "<p>texto do card</p>" }),
  block(4, "COMMAND", {
    steps: [
      { command: "ls /etc", explanation: "lista" },
      { command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } },
    ],
  }),
  block(5, "CURIOSITY", { title: "Na vida real", html: "curiosidade" }),
];

const challenge = (id: string, extra: Partial<PublicQuestion> = {}): PublicQuestion => ({
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
    scenario: vi.fn().mockResolvedValue({ formato: "exame-so/maquina", cenario: "exercicio" }),
    topicScenario: vi.fn().mockResolvedValue({ formato: "exame-so/maquina", cenario: "topico" }),
    checkModule: vi.fn().mockResolvedValue({ passed: [], progress: [] }),
    progress: vi.fn().mockResolvedValue([]),
  };
}

const spoken = (words: SpeechResult["words"] = []): SpeechResult => ({ audioBase64: "QUJD", mimeType: "audio/mpeg", voice: "pt-BR-FranciscaNeural", words });

function defaultSpeech() {
  return { synthesize: vi.fn().mockResolvedValue(spoken()) };
}

function setup(overrides: Partial<TopicStudyProps> = {}) {
  const content = {
    blocks: vi.fn().mockResolvedValue(blocks),
    questions: vi.fn().mockResolvedValue([challenge("q1"), challenge("q2"), challenge("t1", { kind: "THEORETICAL" })]),
  };
  const modules = { getModuleById: vi.fn().mockResolvedValue(moduleDetails) };
  const practice = defaultPractice();
  const confirm = vi.fn().mockReturnValue(true);
  const speech = defaultSpeech();
  const utils = render(<TopicStudy moduleId="m1" backHref="/materials" content={content} modules={modules} practice={practice} speech={speech} confirm={confirm} {...overrides} />);
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
  Object.values(fake.window).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockClear?.());
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
    setup({ content: { blocks: vi.fn().mockRejectedValue(new ApiProblemError({ type: "x", title: "x", status }, status)), questions: vi.fn() } });
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(Boolean(screen.queryByRole("link", { name: "Entrar" }))).toBe(login);
    expect(screen.getByRole("link", { name: /Voltar aos materiais/ })).toHaveAttribute("href", "/materials");
  });
});

// Covers CA-01: header with player and speed, tabs on the left, terminal on the right.
describe("TopicStudy screen", () => {
  it("shows the header, the tabs, the lesson cards and the terminal", async () => {
    await loaded();
    expect(screen.getByRole("link", { name: /Materiais/ })).toHaveAttribute("href", "/materials");
    expect(screen.getByText("Unix · GNU")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Roteiro automático" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Velocidade/ })).toHaveValue("1");
    expect(screen.getByRole("tab", { name: /Comandos e dicas/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Desafios/ })).toHaveTextContent("0/2");
    expect(screen.getByText("Antes dos comandos")).toBeInTheDocument();
    expect(screen.getByText("O Unix")).toBeInTheDocument();
    expect(screen.getByText("intro do módulo")).toBeInTheDocument();
  });

  it("starts the terminal on the topic scenario", async () => {
    const { practice } = await loaded();
    expect(practice.topicScenario).toHaveBeenCalledWith("m1");
    const { mountTerminalWindow } = await import("@/engine/terminalWindow");
    expect(vi.mocked(mountTerminalWindow).mock.calls.at(-1)?.[1]).toEqual({ formato: "exame-so/maquina", cenario: "topico" });
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
    expect(vi.mocked(mountTerminalWindow).mock.calls.at(-1)?.[1]).toEqual({ salvo: 1 });
  });

  // Covers CA-03: the play of a command, of a card and of the whole script.
  it("runs a single command from its play button", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Executar no terminal 1: uname -o/ }));
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledWith(expect.objectContaining({ command: "uname -o" })));
  });

  it("runs a whole card and shows the stop label while it plays", async () => {
    await loaded();
    const cards = screen.getAllByRole("button", { name: /Rodar este card/ });
    fireEvent.click(cards[1]!);
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(fake.window.run).toHaveBeenNthCalledWith(1, expect.objectContaining({ command: "ls /etc" }));
    expect(fake.window.run).toHaveBeenNthCalledWith(2, expect.objectContaining({ command: "whoami", terminal: 2, login: { user: "ricardo", password: "123" } }));
  });

  it("steps forward with the next button and back with the previous one", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Executa só o próximo/ }));
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Volta um passo/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Volta um passo/ }));
    await waitFor(() => expect(fake.window.reset).toHaveBeenCalledWith({ formato: "exame-so/maquina", cenario: "topico" }));
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
    expect(await screen.findByRole("button", { name: /Pausa o roteiro/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: " " });
    terminal.remove();
  });

  it("remembers the chosen speed", async () => {
    await loaded();
    fireEvent.change(screen.getByRole("combobox", { name: /Velocidade/ }), { target: { value: "4" } });
    expect(fake.window.setSpeed).toHaveBeenLastCalledWith(4);
    expect(localStorage.getItem("exame-so:velocidade")).toBe("4");
  });
});

describe("TopicStudy actions", () => {
  // Covers CA-02: Reset Máquina asks for confirmation and returns to the topic scenario.
  it("resets the machine after confirming", async () => {
    const { confirm } = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Reset Máquina/ }));
    await waitFor(() => expect(fake.window.resetAnimated).toHaveBeenCalledWith({ formato: "exame-so/maquina", cenario: "topico" }));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText(/formatada e reiniciada/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Baixa a máquina em JSON" }));
    expect(fake.window.exportJson).toHaveBeenCalledWith("maquina-História do Linux");

    fireEvent.click(screen.getByRole("button", { name: "Carrega uma máquina em JSON" }));
    expect(await screen.findByText(/importada do JSON/)).toBeInTheDocument();

    fake.window.importJson.mockRejectedValueOnce(new Error("bad"));
    fireEvent.click(screen.getByRole("button", { name: "Carrega uma máquina em JSON" }));
    expect(await screen.findByText(/Não foi possível ler o JSON/)).toBeInTheDocument();
  });

  // Covers CA-07: the cheat sheet of the prototype.
  it("opens and closes the cheat sheet", async () => {
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    const dialog = await screen.findByRole("dialog", { name: /Cola de comandos/ });
    expect(within(dialog).getByText("Tabela Oficial")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    const again = await screen.findByRole("dialog");
    fireEvent.click(again.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Cola/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
    expect(screen.getAllByText("echo q1", { exact: false })[0]).toHaveTextContent("[T2] whoami");
  });

  // Covers CA-10: starting an exercise loads its scenario into the same window.
  it("loads the scenario of the exercise in the same window", async () => {
    const { practice } = await openChallenges();
    fireEvent.click(screen.getAllByRole("button", { name: "▶ Iniciar" })[0]!);
    await waitFor(() => expect(fake.window.loadScenario).toHaveBeenCalledWith({ formato: "exame-so/maquina", cenario: "exercicio" }));
    expect(practice.scenario).toHaveBeenCalledWith("q1");
  });

  it("warns when the scenario cannot be loaded", async () => {
    const { practice } = await openChallenges();
    practice.scenario.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(screen.getAllByRole("button", { name: "▶ Iniciar" })[0]!);
    expect(await screen.findByText(/Não foi possível preparar a máquina/)).toBeInTheDocument();
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
    practice.checkModule.mockResolvedValue({ passed: ["q1"], progress: [{ questionId: "q1", completedAt: "t" }] });
    act(() => fake.onCommand?.({ estado: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 50);
    });
    expect(practice.checkModule).toHaveBeenCalledWith("m1", { estado: 1 });
    expect(await screen.findByText(/Desafio concluído!/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Desafios/ })).toHaveTextContent("1/2");
    expect(screen.getAllByRole("img", { name: "Desafio atendido" })).toHaveLength(1);
  });

  it("starts with the progress the student already has", async () => {
    setup({ practice: { ...defaultPractice(), progress: vi.fn().mockResolvedValue([{ questionId: "q2", completedAt: "t", attempts: 1 }]) } });
    const tab = await screen.findByRole("tab", { name: /Desafios/ });
    await waitFor(() => expect(tab).toHaveTextContent("1/2"));
  });

  // Covers CA-05: a visitor is invited to sign in.
  it("invites a visitor to sign in when the check answers 401", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { practice } = await openChallenges();
    practice.checkModule.mockRejectedValue(new ApiProblemError({ type: "not-authenticated", title: "x", status: 401 }, 401));
    act(() => fake.onCommand?.({}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + 50);
    });
    expect(await screen.findByText(/Entre na plataforma para o servidor conferir/)).toBeInTheDocument();
  });

  it("shows an empty state for a module without challenges", async () => {
    setup({ content: { blocks: vi.fn().mockResolvedValue(blocks), questions: vi.fn().mockResolvedValue([]) } });
    fireEvent.click(await screen.findByRole("tab", { name: /Desafios/ }));
    expect(await screen.findByText(/ainda não tem desafios práticos/)).toBeInTheDocument();
  });

  it("opens straight on the challenges when the module has no lesson content", async () => {
    setup({ content: { blocks: vi.fn().mockResolvedValue([]), questions: vi.fn().mockResolvedValue([challenge("q1")]) } });
    expect(await screen.findByText(/Enunciado q1/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Roteiro automático" })).not.toBeInTheDocument();
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

  const callOrder = (fn: { mock: { invocationCallOrder: number[] } }, index = 0) => fn.mock.invocationCallOrder[index]!;

  const WATCH = "Veja o comando rodando no terminal ao lado.";

  // Covers CA-01 to CA-03 and CA-15: title and text, then each command is said, explained and announced before it runs.
  it("reads the card and says each command, what it does and the notice before running it", async () => {
    const { speech } = await loaded();
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    // The player pauses between commands, so the last block comes after a real wait.
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalledTimes(7), { timeout: 5000 });

    expect(speech.synthesize.mock.calls.map(([text]) => text)).toEqual([
      "O Unix",
      "texto do card",
      "L S barra E T C",
      "lista",
      WATCH,
      "who am I",
      // The notice of the second command is not asked for again: the audio is already in the cache (CA-10).
      "Na vida real curiosidade",
    ]);
    // Each command runs only after being said: first "ls /etc" (after its notice), then "whoami".
    expect(callOrder(speech.synthesize, 4)).toBeLessThan(callOrder(fake.window.run, 0));
    expect(callOrder(fake.window.run, 0)).toBeLessThan(callOrder(speech.synthesize, 5));
    expect(callOrder(speech.synthesize, 5)).toBeLessThan(callOrder(fake.window.run, 1));
    expect(fake.window.run).toHaveBeenCalledTimes(2);
  }, 20000);

  it("says the command and the notice for a step without explanation, then runs it", async () => {
    const { speech } = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Executar no terminal 2: whoami/ }));
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(1));
    expect(speech.synthesize.mock.calls.map(([text]) => text)).toEqual(["who am I", WATCH]);
    expect(callOrder(speech.synthesize, 1)).toBeLessThan(callOrder(fake.window.run, 0));
  });

  it("explains a step with the words of the page, highlighted one by one", async () => {
    const { speech } = await loaded();
    fireEvent.click(screen.getByRole("button", { name: /Executar no terminal 1: ls \/etc/ }));
    await waitFor(() => expect(fake.window.run).toHaveBeenCalled());
    expect(speech.synthesize.mock.calls.map(([text]) => text)).toEqual(["L S barra E T C", "lista", WATCH]);
  });

  // Covers CA-16: cutting the narration in the middle of a step keeps the command from running.
  it("does not run the command when the narration is stopped before it", async () => {
    const speech = {
      synthesize: vi.fn((text: string) => (text === "L S barra E T C" ? new Promise<SpeechResult>(() => {}) : Promise.resolve(spoken()))),
    };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalledWith("L S barra E T C"));
    fireEvent.click(await screen.findByRole("button", { name: /Parar/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull());
    expect(fake.window.run).not.toHaveBeenCalled();
  });

  // Covers CA-04: stopping the card silences the voice.
  it("silences the voice when the card is stopped", async () => {
    const speech = { synthesize: vi.fn().mockReturnValue(new Promise(() => {})) };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    await waitFor(() => expect(speech.synthesize).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: /Parar/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Parar/ })).toBeNull());
  });

  // Covers CA-07 and CA-08: the sound button and its memory.
  it("turns the sound off and keeps the choice, and the card plays without asking for voice", async () => {
    const { speech } = await loaded();
    const toggle = screen.getByRole("button", { name: /Som/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: /Mudo/ })).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("exame-so:narracao")).toBe("off");

    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(speech.synthesize).not.toHaveBeenCalled();
  });

  // Covers CA-06 (P-01): a visitor gets the invitation and the commands still run.
  it("invites a visitor to sign in and keeps running the commands in silence", async () => {
    const speech = { synthesize: vi.fn().mockRejectedValue(new ApiProblemError({ type: "not-authenticated", title: "x", status: 401 }, 401)) };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    expect(await screen.findByText(/Entre na plataforma para ouvir o material/)).toBeTruthy();
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(speech.synthesize).toHaveBeenCalledTimes(1);
  });

  // Covers CA-05: a failing voice warns once and the script goes on.
  it("warns once when the voice fails and still runs every command", async () => {
    const speech = { synthesize: vi.fn().mockRejectedValue(new ApiProblemError({ type: "speech-unavailable", title: "x", status: 503 }, 503)) };
    setup({ speech });
    await screen.findByRole("heading", { name: "História do Linux" });
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    expect(await screen.findByText(/Não foi possível gerar a voz agora/)).toBeTruthy();
    await waitFor(() => expect(fake.window.run).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText(/Não foi possível gerar a voz agora/)).toHaveLength(1);
  });

  it("tells the student when the browser blocks the sound", async () => {
    class BlockedAudio extends AutoAudio {
      play = vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    }
    vi.stubGlobal("Audio", BlockedAudio);
    await loaded();
    fireEvent.click(screen.getAllByRole("button", { name: /Rodar este card/ })[1]!);
    expect(await screen.findByText(/navegador bloqueou o som/)).toBeTruthy();
  });
});
