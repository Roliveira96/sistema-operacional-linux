// Adapter of the terminal window of the prototype (SPEC-016). It mounts the
// legacy GNOME Terminal window (up to 3 SSH tabs, nano and vim included) in a
// container and exposes a small typed API. Like the rest of src/engine/, it is
// the only place that imports the legacy code, and it loads it on demand.

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
  /** Replaces the machine at once and reopens the root terminal. */
  reset(snapshot: unknown): void;
  /** Resets with the formatting and boot animation of the prototype. */
  resetAnimated(snapshot: unknown): Promise<void>;
  /** Loads a scenario under the open terminals, keeping their screen and history (CA-10). */
  loadScenario(snapshot: unknown): Promise<void>;
  snapshot(): unknown;
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
    import("@legacy-engine/app/ColaDeComandos"),
    import("@legacy-engine/conteudo/CatalogoDeTopicos"),
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
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Mounts the terminal window in container, on the machine of snapshot (null for the default one). */
export async function mountTerminalWindow(
  container: HTMLElement,
  snapshot: unknown,
  callbacks: TerminalWindowCallbacks,
): Promise<TerminalWindow> {
  const [{ Maquina }, { Serializador }, { JanelaDeTerminais }, { ArmazemDeMaquinas }] = await Promise.all([
    import("@legacy-engine/linux/Maquina"),
    import("@legacy-engine/linux/Serializador"),
    import("@legacy-engine/terminal/JanelaDeTerminais"),
    import("@legacy-engine/app/ArmazemDeMaquinas"),
    import("@legacy-engine/estilos/terminal.css"),
  ]);

  const build = (state: unknown) => {
    const machine = state == null ? Maquina.criar() : Serializador.deJson(state);
    machine.atualizarProc();
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
  }
  interface WindowInternals {
    maquina: typeof machine;
    terminais: Array<TerminalInternals | null>;
  }

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
        await terminal.executarAutomatico(step.command, step.answers ?? []);
      } finally {
        terminal.escrever = original;
      }

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

    snapshot() {
      return Serializador.paraJson(machine);
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
      window3.destruir();
      container.innerHTML = "";
    },
  };
}
