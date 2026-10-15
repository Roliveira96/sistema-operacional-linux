// What the tests of the live exercise share (SPEC-065): a module with a group of exercises, the round that runs it, the machines that meet its
// conditions, and a stand-in for the terminal engine, which the component tests never load.

import { vi, type Mock } from "vitest";
import type { TerminalStep, TerminalWindowCallbacks } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { TreeNode } from "@/lib/machineDiff";
import type { LiveExercise, LiveModuleContent } from "@/services/classroomService";

export const dir = (nome: string, filhos: TreeNode[] = []): TreeNode => ({ nome, tipo: "diretorio", dono: 0, grupo: 0, permissoes: "755", filhos });
export const file = (nome: string, conteudo = ""): TreeNode => ({ nome, tipo: "arquivo", dono: 0, grupo: 0, permissoes: "644", conteudo });
/** A machine as the engine serializes it, with the folders and files given at the root. */
export const machine = (children: TreeNode[] = []) => ({
  raiz: dir("", children),
  contas: { usuarios: [{ nome: "root", uid: 0, gid: 0 }], grupos: [{ nome: "root", gid: 0, membros: [] }] },
});

/** No condition of the exercise holds, one holds, and both do (the exercise at index 1 of the group of the module below). */
export const none = () => machine();
export const half = () => machine([dir("dois")]);
export const whole = () => machine([dir("dois", [file("x.txt")])]);

/** The scenario the module starts from, and the module: a card with a snapshot, its group of exercises, and a later card the exercise must not see. */
export const scenario = { base: "scenario" };
export const exerciseModule: LiveModuleContent = {
  moduleId: "m-1",
  title: "História do Linux",
  scenario,
  setup: { summary: "", steps: [{ command: "mkdir /base" }] },
  blocks: [
    { id: "b-1", type: "TEXT", position: 0, payload: { title: "Card A", html: "<p>A</p>", setup: { summary: "", steps: [{ command: "touch /a" }] } } },
    {
      id: "b-2",
      type: "EXERCISES",
      position: 1,
      payload: {
        setup: { summary: "", steps: [{ command: "touch /group" }] },
        items: [
          {
            title: "Primeiro",
            difficulty: "EASY",
            description: "<p>Crie a pasta um</p>",
            solution: { summary: "", steps: [{ command: "mkdir /um" }] },
            conditions: [{ kind: "DIR_EXISTS", path: "/um" }],
          },
          {
            title: "Segundo",
            difficulty: "MEDIUM",
            description: "<p>Crie a pasta <b>dois</b> com o arquivo x.txt</p>",
            solution: { summary: "", steps: [{ command: "mkdir /dois" }, { command: "touch /dois/x.txt" }] },
            conditions: [
              { kind: "DIR_EXISTS", path: "/dois" },
              { kind: "FILE_EXISTS", path: "/dois/x.txt" },
            ],
          },
        ],
      },
    },
    { id: "b-3", type: "TEXT", position: 2, payload: { title: "Card B", html: "<p>B</p>", setup: { summary: "", steps: [{ command: "touch /b" }] } } },
  ],
};

/** The round of the second exercise, started at 13:00:00 for five minutes by the clock of the server, which is the one of the browser. */
export const START = "2026-10-14T13:00:00.000Z";
export const END = "2026-10-14T13:05:00.000Z";
export const round = (over: Partial<LiveExercise> = {}): LiveExercise => ({
  runId: "r-1",
  blockId: "b-2",
  index: 1,
  title: "Criar as pastas",
  difficulty: "MEDIUM",
  durationSeconds: 300,
  startedAt: START,
  endsAt: END,
  status: "RUNNING",
  resultVisible: false,
  skewMs: 0,
  ...over,
});

/** What the server says of a state that meets the conditions: the student took 3 min 12 s and it was worth 30 points. */
export const approved = { passed: true, completedAt: "2026-10-14T13:03:12.000Z", elapsedSeconds: 192, points: 30 };

/** A promise the test settles when it wants, to hold a call of the service in flight. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A picture of the terminal, which only has to be told apart from another. */
export const picture = (text: string): ScreenElement => ({ tag: "div", children: [text] });

/**
 * The terminal engine as the component tests see it: `mountTerminalWindow` gives a window that keeps the commands it ran, says the machine it has, and
 * tells what the test makes it tell (a command typed, a picture). The window puts a screen of its own in the container, as the engine does, so a test can
 * type in it.
 */
export function terminalHarness(mount: Mock) {
  const history: string[] = [];
  let current: unknown = machine();
  const harness = {
    history,
    mounted: null as null | { container: HTMLElement; snapshot: unknown; callbacks: TerminalWindowCallbacks },
    /** What the keys typed on the screen of the window reach. */
    keys: vi.fn(),
    pasted: vi.fn(),
    win: {
      // A step of a snapshot goes through the history, as it does in the real terminal.
      execute: vi.fn(async (step: TerminalStep) => {
        history.push(step.command);
        return { status: 0, output: "" };
      }),
      setSpeed: vi.fn(),
      snapshot: vi.fn(() => current),
      history: vi.fn(() => [...history]),
      loadScenario: vi.fn(async () => undefined),
      destroy: vi.fn(),
    },
    /** The student types a command and the machine ends up as `state`. */
    type(command: string, state: unknown) {
      history.push(command);
      current = state;
      harness.mounted!.callbacks.onCommand(state);
    },
    /** The window tells its picture. */
    show(tree: ScreenElement) {
      harness.mounted!.callbacks.onScreen?.(tree, { offsetOf: () => null, terminalOf: () => null });
    },
    /** What the window has as its machine, without any command. */
    set(state: unknown) {
      current = state;
    },
    screen: () => harness.mounted!.container.querySelector<HTMLElement>(".term-tela")!,
  };
  mount.mockImplementation(async (container: HTMLElement, snapshot: unknown, callbacks: TerminalWindowCallbacks) => {
    const screen = document.createElement("div");
    screen.className = "term-tela";
    screen.tabIndex = 0;
    screen.addEventListener("keydown", (event) => harness.keys(event.key));
    screen.addEventListener("paste", () => harness.pasted());
    container.appendChild(screen);
    harness.mounted = { container, snapshot, callbacks };
    return harness.win;
  });
  return harness;
}
