// Adapter of the terminal window of the prototype (SPEC-016). It mounts the
// legacy GNOME Terminal window (up to 3 SSH tabs, nano and vim included) in a
// container and exposes a small typed API. Like the rest of src/engine/, it is
// the only place that imports the legacy code, and it loads it on demand.

import { addEngineBinaries, registerEngineCommands } from "./commands";
import type { CommandRegistry } from "./commands/types";
import { addProcessBinaries, registerProcessCommands } from "./processes/register";
import { processSnapshot, watchEnded } from "./processes/snapshot";

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

/** A piece of what a terminal printed, with the class that colors it (SPEC-051). */
export interface ScreenSegment {
  text: string;
  className?: string;
}

/** The line a terminal is waiting for a command on, at every key (SPEC-051). */
export interface TerminalInputEvent {
  terminal: number;
  line: string;
}

/** A command that ended: what was typed, what it printed and the machine after it (SPEC-051). */
export interface TerminalCommandEvent {
  terminal: number;
  line: string;
  /** What the command printed, without the prompt and the echo of the line. */
  output: string;
  status: number | null;
  /** Everything the terminal printed from the prompt on, with its colors, to be printed again on a copy. */
  segments: ScreenSegment[];
  user: string;
  cwd: string;
  state: unknown;
}

export interface TerminalWindowCallbacks {
  /** Called after every command with the serialized machine. */
  onCommand(snapshot: unknown): void;
  /** Called at every key typed on a command line, and when the line is empty again (SPEC-051). A password is never reported. */
  onInput?(event: TerminalInputEvent): void;
  /** Called when a command ends, typed or sent by run() (SPEC-051). */
  onCommandDone?(event: TerminalCommandEvent): void;
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
  /** Makes the window a read-only copy: no focus and no keyboard, so only the calls below change what it shows (SPEC-051). */
  setReadOnly(on: boolean): void;
  /** Shows `line` as what is being typed on the command line of the terminal, without running it (SPEC-051). */
  showInput(terminal: number, line: string): Promise<void>;
  /** Prints what another terminal printed and leaves the command line empty, without running anything (SPEC-051). */
  printScreen(terminal: number, segments: ScreenSegment[]): Promise<void>;
  /** Puts the machine of another window under this one, keeping the screen, and the folder of the terminal that ran the command (SPEC-051). */
  syncMachine(state: unknown, terminal?: { terminal: number; cwd: string }): Promise<void>;
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

/** The machine as it goes to a copy of the window: the passwords of the accounts stay behind, a copy never logs in (SPEC-051). */
function withoutPasswords(state: unknown): unknown {
  const machine = state as { contas?: { usuarios?: Array<Record<string, unknown>> } };
  if (!machine.contas?.usuarios) return state;
  return { ...machine, contas: { ...machine.contas, usuarios: machine.contas.usuarios.map((user) => ({ ...user, senha: null })) } };
}

const PREPARING_MESSAGE = "Preparando máquina…\n";
const PREPARING_PAUSE_MS = 700;
const processTable = (machine: unknown) => (machine as { processos: { listar(): Array<{ encerrado: boolean }> } }).processos.listar();

/** The longest wait, and the step, for the processes a signal ended to leave the process table. */
const SETTLE_MS = 300;
const SETTLE_STEP_MS = 10;
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

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
    import("@engine-core/estilos/terminal.css"),
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
    numero: number;
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

  // SPEC-051: the teacher's terminals tell what is typed and what ends. It is read from outside the legacy code: the methods of each
  // terminal are wrapped, so nothing of src/engine/core changes. The typing is only reported on a command line, never at a password prompt.
  interface WatchedTerminal extends TerminalInternals {
    escrever(text: string, className?: string): void;
  }
  const watched = new WeakSet<object>();
  const watchTerminals = () => {
    if (!callbacks.onInput && !callbacks.onCommandDone) return;
    for (const internal of (window3 as unknown as WindowInternals).terminais) {
      if (!internal || watched.has(internal)) continue;
      watched.add(internal);
      const terminal = internal as unknown as WatchedTerminal;

      let collecting: ScreenSegment[] | null = null;
      const write = terminal.escrever;
      terminal.escrever = function (this: unknown, text: string, className?: string) {
        collecting?.push(className ? { text, className } : { text });
        write.call(terminal, text, className);
      };

      let lastLine = "";
      // After a password the legacy terminal may keep it in the buffer until the next line (when the answers come from a script), so
      // nothing is reported from the moment a hidden answer was typed until the buffer is empty again.
      let hiding = false;
      const render = terminal.renderizarEntrada;
      terminal.renderizarEntrada = function () {
        render.call(terminal);
        const hidden = terminal.estado !== "comando" && (terminal as unknown as { oculto: boolean }).oculto;
        if (hidden) hiding = true;
        if (hiding && terminal.estado === "comando" && terminal.buffer === "") hiding = false;
        if (hiding || terminal.estado !== "comando" || terminal.buffer === lastLine) return;
        lastLine = terminal.buffer;
        callbacks.onInput?.({ terminal: terminal.numero, line: lastLine });
      };

      const send = terminal.enviarComando;
      terminal.enviarComando = async function () {
        const line = terminal.buffer;
        collecting = [];
        try {
          await send.call(terminal);
        } finally {
          const segments = collecting ?? [];
          collecting = null;
          const frame = terminal.sessao?.atual();
          if (frame) {
            callbacks.onCommandDone?.({
              terminal: terminal.numero,
              line,
              output: cleanOutput(segments.map((segment) => segment.text).join(""), line),
              status: frame.escopo.ultimoStatus,
              segments,
              user: frame.usuario.nome,
              cwd: frame.cwd,
              state: withoutPasswords(Serializador.paraJson(machine)),
            });
          }
        }
      };
    }
  };
  watchTerminals();
  // A terminal opened by the buttons of the window is watched as soon as it appears.
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(watchTerminals);
  observer?.observe(container, { childList: true, subtree: true });

  // SPEC-051: a read-only copy takes no focus and no key; the capture listeners keep the events from reaching the legacy terminal.
  let readOnly = false;
  for (const name of ["keydown", "keypress", "beforeinput", "paste", "mousedown"]) {
    container.addEventListener(
      name,
      (event) => {
        if (!readOnly) return;
        event.stopPropagation();
        event.preventDefault();
      },
      true,
    );
  }

  let instant = false;
  const execute = async (step: TerminalStep): Promise<CommandResult> => {
      const login = step.login ? { usuario: step.login.user, senha: step.login.password } : undefined;
      const terminal = (await window3.obter(step.terminal ?? 1, login)) as unknown as TerminalInternals & {
        executarAutomatico(command: string, answers?: string[]): Promise<void>;
        escrever(text: string, className?: string): void;
      };
      watchTerminals();
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

    setReadOnly(on) {
      readOnly = on;
      container.toggleAttribute("inert", on);
    },

    async showInput(number, line) {
      const terminal = (await window3.obter(number)) as unknown as TerminalInternals;
      if (terminal.estado !== "comando") return;
      terminal.buffer = line;
      terminal.cursor = line.length;
      terminal.renderizarEntrada();
    },

    async printScreen(number, segments) {
      const terminal = (await window3.obter(number)) as unknown as WatchedTerminal;
      for (const segment of segments) terminal.escrever(segment.text, segment.className);
      terminal.buffer = "";
      terminal.cursor = 0;
      terminal.renderizarEntrada();
    },

    async syncMachine(state, where) {
      await (this as unknown as TerminalWindow).swapMachine(state);
      if (!where) return;
      const terminal = (window3 as unknown as WindowInternals).terminais[where.terminal - 1];
      const frame = terminal?.sessao?.atual();
      if (!terminal || !frame) return;
      // The folder of the terminal that ran the command, when the machine has it, so the prompt on the copy is the same.
      if ((machine as unknown as { fs: { obter(path: string): { ehDiretorio(): boolean } | undefined } }).fs.obter(where.cwd)?.ehDiretorio()) {
        frame.cwd = where.cwd;
        terminal.renderizarEntrada();
      }
    },

    destroy() {
      observer?.disconnect();
      window3.destruir();
      container.innerHTML = "";
    },
  };
}
