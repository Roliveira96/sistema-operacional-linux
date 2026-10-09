// Adapter of the prototype terminal window and its engine (SPEC-014,
// SPEC-016). It is the only module of the frontend that imports the legacy
// code; components use the types below. The legacy code is loaded on demand.

import type { Maquina } from "@legacy-engine/linux/Maquina";
import type { Sessao } from "@legacy-engine/linux/Sessao";
import type { JanelaDeTerminais, TerminalUbuntu } from "@legacy-engine/terminal/JanelaDeTerminais";

/** One example command of the content (COMMAND blocks, SPEC-011). */
export interface Step {
  command: string;
  explanation?: string;
  terminal?: number;
  login?: { user: string; password: string };
  /** Automatic answers to the questions of the command (passwords, nano text). */
  answers?: string[];
}

export interface TerminalWindow {
  /** Types and runs a step in the terminal it names, logging in when asked. */
  run(step: Step): Promise<void>;
  /** Typing speed of the automated steps (1 = normal). */
  setSpeed(speed: number): void;
  /** Serialized machine (format exame-so/maquina). */
  snapshot(): unknown;
  /** Factory reset with the prototype animation, back to the given machine. */
  reset(snapshot: unknown): Promise<void>;
  /** Swaps the machine at once, reopening the terminals (used by ⏮). */
  load(snapshot: unknown): void;
  /**
   * Prepares the machine of an exercise in the open terminals, keeping their
   * screens and command history (SPEC-016 CA-10).
   */
  prepare(snapshot: unknown, lines: readonly string[]): Promise<void>;
  /** Downloads the machine as JSON. */
  exportJson(name: string): void;
  /** Asks for a JSON file and loads it; resolves false when it is invalid. */
  importJson(): Promise<boolean>;
  focus(): void;
  destroy(): void;
}

export interface TerminalWindowEvents {
  /** Called after each command of any terminal. */
  onCommand(): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the terminal is idle (an automated step may be typing). */
async function idle(terminal: TerminalUbuntu): Promise<void> {
  for (let i = 0; i < 600 && !terminal.estaLivre(); i++) await sleep(50);
}

/**
 * Mounts the prototype terminal window (up to 3 terminals, side by side,
 * Tab completion, nano and vim) in the container, on the given machine or on
 * the default prototype machine when the snapshot is null.
 */
export async function mountTerminalWindow(
  container: HTMLElement,
  snapshot: unknown,
  events: TerminalWindowEvents,
): Promise<TerminalWindow> {
  const [{ Maquina }, { Serializador }, { JanelaDeTerminais }, { ArmazemDeMaquinas }] = await Promise.all([
    import("@legacy-engine/linux/Maquina"),
    import("@legacy-engine/linux/Serializador"),
    import("@legacy-engine/terminal/JanelaDeTerminais"),
    import("@legacy-engine/app/ArmazemDeMaquinas"),
  ]);

  const restore = (json: unknown): Maquina => {
    const machine = json == null ? Maquina.criar() : Serializador.deJson(json);
    machine.atualizarProc();
    return machine;
  };

  let machine = restore(snapshot);
  const terminalWindow: JanelaDeTerminais = new JanelaDeTerminais(container, machine, {
    aoExecutar: () => events.onCommand(),
  });

  const swap = (next: Maquina) => {
    machine = next;
    terminalWindow.trocarMaquina(next);
    events.onCommand();
  };

  return {
    async run(step) {
      const login = step.login ? { usuario: step.login.user, senha: step.login.password } : undefined;
      const terminal = await terminalWindow.obter(step.terminal ?? 1, login);
      await terminal.executarAutomatico(step.command, step.answers ?? []);
    },
    setSpeed(speed) {
      terminalWindow.definirVelocidade(speed);
    },
    snapshot() {
      return Serializador.paraJson(machine);
    },
    async reset(json) {
      await terminalWindow.executarResetAnimado(() => {
        machine = restore(json);
        return machine;
      });
      events.onCommand();
    },
    load(json) {
      swap(restore(json));
    },
    async prepare(json, lines) {
      const next = restore(json);
      const previous = machine;
      machine = next;
      // Terminals opened later connect to the new machine.
      terminalWindow.maquina = next;
      for (const terminal of terminalWindow.terminais) {
        if (!terminal) continue;
        await idle(terminal);
        for (const line of lines) {
          terminal.escrever(line + "\n", "c-laranja");
          await sleep(120);
        }
        const user = terminal.usuarioAtual();
        const history = terminal.sessao?.historico.slice() ?? [];
        if (terminal.sessao) previous.fecharSessao(terminal.sessao);
        terminal.sessao = null;
        terminal.maquina = next;
        const account = user ? next.contas.usuario(user) : undefined;
        if (!account) {
          terminal.pedirLogin();
          continue;
        }
        terminal.iniciarSessao(account);
        // iniciarSessao opened a new session; the cast drops the narrowing to null.
        (terminal.sessao as Sessao | null)?.historico.push(...history);
        terminal.posicaoHistorico = history.length;
      }
      events.onCommand();
    },
    exportJson(name) {
      ArmazemDeMaquinas.baixar(machine, name);
    },
    async importJson() {
      try {
        const imported = await ArmazemDeMaquinas.importar();
        imported.atualizarProc();
        swap(imported);
        return true;
      } catch {
        return false;
      }
    },
    focus() {
      terminalWindow.focar();
    },
    destroy() {
      terminalWindow.destruir();
      container.innerHTML = "";
    },
  };
}

/** HTML of the prototype cheat sheet (P-04: reused as it is). */
export async function cheatSheetHtml(): Promise<string> {
  const [{ ColaDeComandos }, { CatalogoDeTopicos }] = await Promise.all([
    import("@legacy-engine/app/ColaDeComandos"),
    import("@legacy-engine/conteudo/CatalogoDeTopicos"),
  ]);
  return ColaDeComandos.html(new CatalogoDeTopicos().listar());
}
