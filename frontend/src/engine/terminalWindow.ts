// Adapter of the terminal window of the prototype (SPEC-016). It mounts the
// legacy GNOME Terminal window (up to 3 SSH tabs, nano and vim included) in a
// container and exposes a small typed API. Like the rest of src/engine/, it is
// the only place that imports the legacy code, and it loads it on demand.

import { addEngineBinaries, registerEngineCommands } from "./commands";
import type { CommandRegistry } from "./commands/types";
import { addProcessBinaries, registerProcessCommands } from "./processes/register";
import { processSnapshot, watchEnded } from "./processes/snapshot";
import { loadTerminalStyle, SCREEN_ATTRS, SCREEN_TAGS, type ScreenAttrs, type ScreenElement, type ScreenNode } from "./terminalScreen";

/** One command of a script, as stored in the COMMAND content blocks. */
export interface TerminalStep {
  command: string;
  /** Terminal tab that runs the command (1 to 3). Defaults to 1. */
  terminal?: number;
  /** Opens the tab logged in as this user. */
  login?: { user: string; password: string };
  /** Answers typed to the questions the command asks (passwords, prompts). */
  answers?: string[];
}

/** What happened when a command ran (SPEC-020 RN-08). */
export interface CommandResult {
  /** Exit status (0 is success), or null when the command did not run. */
  status: number | null;
  /** What the command printed, without the prompt and the command line. */
  output: string;
}

export interface TerminalWindowCallbacks {
  /** Called after every command with the serialized machine. */
  onCommand(snapshot: unknown): void;
  /**
   * Called with the picture of the whole window as soon as it mounts and at every change: at most once every 100 ms and only when it changed
   * (SPEC-056). Only the teacher's window asks for it, to send it to the class.
   */
  onScreen?(tree: ScreenElement): void;
}

export interface TerminalWindow {
  /**
   * Types and runs a step in the tab it asks for, at the current speed. Resolves with the exit
   * status of the command (0 is success), or null when it did not run (SPEC-020 RN-08).
   */
  run(step: TerminalStep): Promise<number | null>;
  /** Like run, and also gives what the command printed, to show the error of a command that failed. */
  execute(step: TerminalStep): Promise<CommandResult>;
  setSpeed(speed: number): void;
  /** With true, a command is sent at once, without the typing and its pauses; the output, the status and the machine are the same (SPEC-032). */
  setInstant(on: boolean): void;
  /** Replaces the machine at once and reopens the root terminal. */
  reset(snapshot: unknown): void;
  /** Resets with the formatting and boot animation of the prototype. */
  resetAnimated(snapshot: unknown): Promise<void>;
  /**
   * Puts a fresh machine under the open terminals without clearing them: the screen, with every command typed and what it printed, stays to be read and
   * copied, and each terminal gets a new session (no variables, aliases or shell history of the machine before). `label` is written on the first terminal
   * as a mark. A terminal that was closed (exit, logout) cannot be kept, so the window is rebuilt (SPEC-030 RN-16).
   */
  swapMachine(snapshot: unknown, label?: string): Promise<void>;
  /** Loads a scenario under the open terminals, keeping their screen and history (CA-10). */
  loadScenario(snapshot: unknown): Promise<void>;
  snapshot(): unknown;
  /** The commands running and the ones a signal ended: they also go in the snapshot, and this gives them alone (SPEC-029). */
  processes(): { processos: unknown[]; encerrados: unknown[] };
  /** The commands typed in terminal 1 on the current session, oldest first (SPEC-020). */
  history(): string[];
  exportJson(name: string): void;
  /** Opens the file picker and loads the chosen machine. Rejects on an invalid file. */
  importJson(): Promise<void>;
  destroy(): void;
}

/** Cheat sheet of the prototype ("Cola"), as HTML. */
export async function cheatSheetHtml(): Promise<string> {
  const [{ ColaDeComandos }, { CatalogoDeTopicos }] = await Promise.all([
    import("@engine-core/app/ColaDeComandos"),
    import("@engine-core/conteudo/CatalogoDeTopicos"),
  ]);
  return ColaDeComandos.html(new CatalogoDeTopicos().listar());
}

/** The printed text of a command without the prompt line that echoes it and the next prompt. */
export function cleanOutput(printed: string, command: string): string {
  const lines = printed.split("\n");
  if (lines[0]?.includes(command)) lines.shift();
  const prompt = /^\S+@\S+:\S*[#$]\s*$/;
  while (lines.length > 0 && (lines[lines.length - 1]!.trim() === "" || prompt.test(lines[lines.length - 1]!))) lines.pop();
  return lines.join("\n");
}

const PREPARING_MESSAGE = "Preparando máquina…\n";
const PREPARING_PAUSE_MS = 700;
const processTable = (machine: unknown) => (machine as { processos: { listar(): Array<{ encerrado: boolean }> } }).processos.listar();

/** The longest wait, and the step, for the processes a signal ended to leave the process table. */
const SETTLE_MS = 300;
const SETTLE_STEP_MS = 10;
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The picture is delivered at most this often (SPEC-056). */
const SCREEN_INTERVAL_MS = 100;
/** The message of the picture stays under this size, a little below the limit of the server (256 KB). */
const SCREEN_MAX_BYTES = 200_000;
/** The most text kept in one text node or one field of the picture. */
const SCREEN_MAX_TEXT = 20_000;
/** The most children kept in an element, from the end, and the smaller values tried when the message is still too big. */
const SCREEN_CHILD_LIMITS = [400, 200, 100, 50, 25, 12, 6, 3, 1];
/** What `{"screen":` and `}` add around the tree in the message. */
const SCREEN_ENVELOPE_BYTES = 11;

const clip = (text: string) => (text.length > SCREEN_MAX_TEXT ? text.slice(0, SCREEN_MAX_TEXT) : text);
const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** A password or hidden field, or any field inside something hidden: its value is never copied (SPEC-056 CA-06). */
function isSecret(field: Element): boolean {
  const type = (field.getAttribute("type") ?? "").toLowerCase();
  return type === "password" || type === "hidden" || field.closest("[hidden]") !== null;
}

/** The last `limit` children of an element, copied; a tag out of the list is left and what it holds takes its place. */
function copyChildren(parent: Element, limit: number): ScreenNode[] {
  const copied: ScreenNode[] = [];
  for (const node of Array.from(parent.childNodes).slice(-limit)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) copied.push(clip(node.textContent));
    } else if (node instanceof Element) {
      copied.push(...copyElement(node, limit));
    }
  }
  return copied.slice(-limit);
}

/** An element as a node of the picture, with the attributes of the list only; a field gives its live value, which is a property, not an attribute. */
function copyElement(element: Element, limit: number): ScreenNode[] {
  const tag = element.tagName.toLowerCase();
  if (!SCREEN_TAGS.has(tag)) return copyChildren(element, limit);
  const attrs: ScreenAttrs = {};
  for (const name of SCREEN_ATTRS) {
    if (name === "value") continue;
    if (name === "hidden") {
      if (element.hasAttribute("hidden")) attrs.hidden = true;
    } else {
      const value = element.getAttribute(name);
      if (value) attrs[name] = value;
    }
  }
  const field = tag === "textarea" || tag === "input";
  if (field && !isSecret(element)) {
    const value = (element as HTMLInputElement).value;
    if (value) attrs.value = clip(value);
  }
  const node: ScreenElement = { tag };
  if (Object.keys(attrs).length > 0) node.attrs = attrs;
  // A field is its value, and a line break is empty: the text inside them is not shown.
  if (!field && tag !== "br") {
    const children = copyChildren(element, limit);
    if (children.length > 0) node.children = children;
  }
  return [node];
}

/** The picture of the window, with its children cut from the start until the message fits the limit. */
function pictureOf(root: Element): { tree: ScreenElement; json: string } {
  let picture = { tree: { tag: "div" } as ScreenElement, json: "" };
  for (const limit of SCREEN_CHILD_LIMITS) {
    const tree = copyElement(root, limit)[0] as ScreenElement;
    picture = { tree, json: JSON.stringify(tree) };
    if (byteLength(picture.json) + SCREEN_ENVELOPE_BYTES <= SCREEN_MAX_BYTES) break;
  }
  return picture;
}

/**
 * Delivers the picture of the window to `deliver` as soon as this runs and whenever the window changes (SPEC-056): at most once every 100 ms (the
 * first change at once, the ones that follow together at the end of the interval) and only when it is not the same as the last one. Changes are
 * seen by a MutationObserver (children, text, class and hidden) and by the keys and the input events, because what is typed in a textarea or an
 * input changes no node of the DOM. Returns what stops it.
 */
function watchScreen(container: HTMLElement, deliver: (tree: ScreenElement) => void): () => void {
  let last = "";
  let sentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const send = () => {
    timer = undefined;
    if (stopped) return;
    sentAt = Date.now();
    const root = container.querySelector(".janela");
    if (!root) return;
    const { tree, json } = pictureOf(root);
    if (json === last) return;
    last = json;
    deliver(tree);
  };
  const schedule = () => {
    if (stopped || timer !== undefined) return;
    // The cap keeps a clock that went back from holding the delivery for longer than the interval.
    const wait = Math.min(sentAt + SCREEN_INTERVAL_MS - Date.now(), SCREEN_INTERVAL_MS);
    if (wait <= 0) send();
    else timer = setTimeout(send, wait);
  };

  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
  observer?.observe(container, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
  const events = ["keydown", "keyup", "input"];
  for (const name of events) container.addEventListener(name, schedule);
  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
    for (const name of events) container.removeEventListener(name, schedule);
  };
}

/** Mounts the terminal window in container, on the machine of snapshot (null for the default one). */
export async function mountTerminalWindow(
  container: HTMLElement,
  snapshot: unknown,
  callbacks: TerminalWindowCallbacks,
): Promise<TerminalWindow> {
  const [{ Maquina }, { Serializador }, { JanelaDeTerminais }, { ArmazemDeMaquinas }, { Shell }] = await Promise.all([
    import("@engine-core/linux/Maquina"),
    import("@engine-core/linux/Serializador"),
    import("@engine-core/terminal/JanelaDeTerminais"),
    import("@engine-core/app/ArmazemDeMaquinas"),
    import("@engine-core/shell/Shell"),
    loadTerminalStyle(),
  ]);
  // SPEC-028: the commands the engine does not have yet are registered by the adapter, without touching legacy/.
  registerEngineCommands(Shell.obterRegistro() as unknown as CommandRegistry);
  // SPEC-029: the process control (nice, renice, yes, watch...) joins the catalog after those, also without touching legacy/.
  await registerProcessCommands(Shell.obterRegistro());

  const build = (state: unknown) => {
    const machine = state == null ? Maquina.criar() : Serializador.deJson(state);
    machine.atualizarProc();
    addEngineBinaries(machine as unknown as Parameters<typeof addEngineBinaries>[0]);
    addProcessBinaries(machine as unknown as Parameters<typeof addProcessBinaries>[0]);
    watchEnded(machine);
    return machine;
  };

  let machine = build(snapshot);
  const notify = () => callbacks.onCommand(Serializador.paraJson(machine));
  const window3 = new JanelaDeTerminais(container, machine, { aoExecutar: notify });

  /** The legacy terminal keeps these as plain (TypeScript-private) fields. */
  interface TerminalInternals {
    maquina: typeof machine;
    sessao: {
      atual(): {
        usuario: { nome: string };
        escopo: { ultimoStatus: number; variaveis: Map<string, string>; exportadas: Set<string>; aliases: Map<string, string> };
        cwd: string;
        anterior: string;
        umask: number;
      };
      historico: string[];
    } | null;
    usuarioAtual(): string | null;
    renderizarEntrada(): void;
    estado: string;
    buffer: string;
    cursor: number;
    emAutomacao: boolean;
    respostasAutomaticas: string[];
    enviarComando(): Promise<void>;
  }
  interface WindowInternals {
    maquina: typeof machine;
    terminais: Array<TerminalInternals | null>;
  }

  // SPEC-056: the teacher's window tells the class its whole screen. The legacy code is only read from outside, never changed.
  const stopScreen = callbacks.onScreen ? watchScreen(container, callbacks.onScreen) : null;

  let instant = false;
  const execute = async (step: TerminalStep): Promise<CommandResult> => {
      const login = step.login ? { usuario: step.login.user, senha: step.login.password } : undefined;
      const terminal = (await window3.obter(step.terminal ?? 1, login)) as unknown as TerminalInternals & {
        executarAutomatico(command: string, answers?: string[]): Promise<void>;
        escrever(text: string, className?: string): void;
      };
      const before = terminal.sessao?.historico.length ?? 0;

      // Everything the command prints goes through escrever, so it is collected there while it runs.
      const original = terminal.escrever;
      let printed = "";
      terminal.escrever = function (this: unknown, text: string, className?: string) {
        printed += text;
        original.call(terminal, text, className);
      };
      try {
        if (instant && terminal.estado === "comando") {
          // What executarAutomatico does without the typing and the pauses: the line goes to the buffer and is sent (SPEC-032 RN-01).
          terminal.emAutomacao = true;
          terminal.respostasAutomaticas = (step.answers ?? []).slice();
          terminal.buffer = step.command;
          terminal.cursor = step.command.length;
          try {
            await terminal.enviarComando();
          } finally {
            terminal.respostasAutomaticas = [];
            terminal.emAutomacao = false;
          }
        } else {
          await terminal.executarAutomatico(step.command, step.answers ?? []);
        }
      } finally {
        terminal.escrever = original;
      }

      // A process that got a signal leaves the table only when its own loop notices it, up to 100 ms later (legacy `dormir`). Waiting for that here keeps the
      // next command from seeing the dead process, which a person typing never would (SPEC-030 RN-22).
      for (let waited = 0; waited < SETTLE_MS && processTable(machine).some((process) => process.encerrado); waited += SETTLE_STEP_MS) await pause(SETTLE_STEP_MS);

      // The legacy terminal keeps the status of the last command in the scope of the session. When the
      // history did not grow the command never ran (the terminal was busy), so there is no status.
      const session = terminal.sessao;
      const ran = Boolean(session) && session!.historico.length > before;
      return { status: ran ? session!.atual().escopo.ultimoStatus : null, output: cleanOutput(printed, step.command) };
    };

  return {
    execute,
    async run(step) {
      return (await execute(step)).status;
    },

    setSpeed(speed) {
      window3.definirVelocidade(speed);
    },

    setInstant(on) {
      instant = on;
    },

    reset(state) {
      machine = build(state);
      window3.trocarMaquina(machine);
      notify();
    },

    async resetAnimated(state) {
      await window3.executarResetAnimado(() => {
        machine = build(state);
        notify();
        return machine;
      });
    },

    async swapMachine(state, label) {
      const first = await window3.obter(1);
      if (label) first.escrever(`${label}\n`, "c-info");
      const next = build(state);
      const internals = window3 as unknown as WindowInternals;
      if (internals.terminais.some((terminal) => terminal && !terminal.sessao)) {
        // A closed terminal asks for a login: the only way to open it again is to rebuild the window, which clears it.
        machine = next;
        window3.trocarMaquina(machine);
        notify();
        return;
      }
      for (const terminal of internals.terminais) {
        if (!terminal) continue;
        const previous = terminal.sessao;
        const user = next.contas.usuario(terminal.usuarioAtual() ?? "root") ?? next.contas.usuario("root");
        terminal.maquina = next;
        if (user) {
          const session = next.abrirSessao(user);
          // What ends the session from the outside (kill, pkill -u) keeps working on the new one.
          (session as unknown as { aoEncerrar?: unknown }).aoEncerrar = (previous as unknown as { aoEncerrar?: unknown } | null)?.aoEncerrar;
          terminal.sessao = session as unknown as typeof previous;
        }
        terminal.renderizarEntrada();
      }
      internals.maquina = next;
      machine = next;
      window3.aoMudarTitulo();
      notify();
    },

    async loadScenario(state) {
      const first = await window3.obter(1);
      first.escrever(PREPARING_MESSAGE, "c-info");
      await pause(PREPARING_PAUSE_MS);

      const next = build(state);
      const internals = window3 as unknown as WindowInternals;
      for (const terminal of internals.terminais) {
        if (!terminal) continue;
        const previous = terminal.sessao;
        const userName = terminal.usuarioAtual();
        terminal.maquina = next;
        if (previous && userName) {
          // Same user on the new machine (root if the scenario has no such user).
          const user = next.contas.usuario(userName) ?? next.contas.usuario("root");
          if (user) {
            const session = next.abrirSessao(user);
            session.historico.push(...previous.historico);
            // The terminal stays where it was: the folder, the variables and the umask survive the new machine.
            const was = previous.atual();
            const now = session.atual() as unknown as ReturnType<typeof previous.atual>;
            if (next.fs.obter(was.cwd)?.ehDiretorio()) {
              now.cwd = was.cwd;
              now.anterior = next.fs.obter(was.anterior)?.ehDiretorio() ? was.anterior : was.cwd;
            }
            now.umask = was.umask;
            for (const [name, value] of was.escopo.variaveis) now.escopo.variaveis.set(name, value);
            for (const name of was.escopo.exportadas) now.escopo.exportadas.add(name);
            for (const [name, value] of was.escopo.aliases) now.escopo.aliases.set(name, value);
            now.escopo.ultimoStatus = was.escopo.ultimoStatus;
            terminal.sessao = session as unknown as typeof previous;
          }
        }
        terminal.renderizarEntrada();
      }
      internals.maquina = next;
      machine = next;
      window3.aoMudarTitulo();
      notify();
    },

    processes() {
      return processSnapshot(machine);
    },

    snapshot() {
      // The machine, and the processes that only go along to be checked (SPEC-029): the engine does not save them.
      return { ...(Serializador.paraJson(machine) as object), ...processSnapshot(machine) };
    },

    history() {
      const first = (window3 as unknown as WindowInternals).terminais[0];
      return [...(first?.sessao?.historico ?? [])];
    },

    exportJson(name) {
      ArmazemDeMaquinas.baixar(machine, name);
    },

    async importJson() {
      const imported = await ArmazemDeMaquinas.importar();
      imported.atualizarProc();
      machine = imported;
      window3.trocarMaquina(machine);
      notify();
    },

    destroy() {
      stopScreen?.();
      window3.destruir();
      container.innerHTML = "";
    },
  };
}
