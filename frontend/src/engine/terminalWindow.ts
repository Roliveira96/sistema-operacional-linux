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
    sessao: { atual(): { usuario: { nome: string }; escopo: { ultimoStatus: number } }; historico: string[] } | null;
    usuarioAtual(): string | null;
    renderizarEntrada(): void;
  }
  interface WindowInternals {
    maquina: typeof machine;
    terminais: Array<TerminalInternals | null>;
  }

  return {
    async run(step) {
      const login = step.login ? { usuario: step.login.user, senha: step.login.password } : undefined;
      const terminal = (await window3.obter(step.terminal ?? 1, login)) as unknown as TerminalInternals & { executarAutomatico(command: string, answers?: string[]): Promise<void> };
      const before = terminal.sessao?.historico.length ?? 0;
      await terminal.executarAutomatico(step.command, step.answers ?? []);
      // The legacy terminal keeps the status of the last command in the scope of the session. When the
      // history did not grow the command never ran (the terminal was busy), so there is no status.
      const session = terminal.sessao;
      if (!session || session.historico.length <= before) return null;
      return session.atual().escopo.ultimoStatus;
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
