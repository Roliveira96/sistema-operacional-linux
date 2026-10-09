// Adapter of the legacy POSIX/VFS engine (SPEC-014). It is the only module of
// the frontend that imports the legacy code; components use the types below.
// The engine is loaded on demand, when a terminal opens.

/** A piece of terminal output. tone mirrors the legacy output classes. */
export interface OutputChunk {
  text: string;
  tone?: OutputTone;
}

export type OutputTone = "directory" | "executable" | "link" | "error" | "success" | "info" | "bold" | "warning" | "match";

/** A file opened by an editor command. */
export interface EditRequest {
  editor: "nano" | "vim";
  path: string;
  content: string;
  isNew: boolean;
  readOnly: boolean;
  warning: string | null;
}

/** What only the terminal can do for the engine. */
export interface EngineIO {
  /** Shows a prompt (password, confirmation) and resolves with the answer. */
  ask(question: string, hidden: boolean): Promise<string>;
  /** Opens an editor; resolves with the saved text, or null when cancelled. */
  edit(request: EditRequest): Promise<string | null>;
  clear(): void;
}

export interface Prompt {
  user: string;
  host: string;
  path: string;
  isRoot: boolean;
}

export interface EngineSession {
  prompt(): Prompt;
  /** Runs one command line, streaming its output. */
  run(line: string, write: (chunk: OutputChunk) => void): Promise<void>;
  /** Serialized machine (format exame-so/maquina) for server-side grading. */
  snapshot(): unknown;
}

const TONES: Record<string, OutputTone> = {
  "c-dir": "directory",
  "c-exe": "executable",
  "c-link": "link",
  "c-erro": "error",
  "c-ok": "success",
  "c-info": "info",
  "c-negrito": "bold",
  "c-laranja": "warning",
  "c-sticky": "warning",
  "c-dispositivo": "warning",
  "c-grep": "match",
  "c-grep-arquivo": "info",
  "c-grep-numero": "success",
};

/** Maps a legacy output class to a tone; unknown classes are plain text. */
export function toneOf(legacyClass?: string): OutputTone | undefined {
  return legacyClass ? TONES[legacyClass] : undefined;
}

/** Message shown when a command asks for vim, which is out of scope. */
export const VIM_UNSUPPORTED = "vim: this terminal supports nano only. Use: nano ";

/** Creates a shell session as root on a machine restored from the snapshot. */
export async function createSession(snapshot: unknown, io: EngineIO): Promise<EngineSession> {
  const [{ Serializador }, { Shell }] = await Promise.all([
    import("@legacy-engine/linux/Serializador"),
    import("@legacy-engine/shell/Shell"),
  ]);
  const machine = Serializador.deJson(snapshot);
  const root = machine.contas.usuario("root");
  if (!root) throw new Error("snapshot has no root account");

  const interpreter = Shell.criarInterpretador();
  let session = machine.abrirSessao(root);
  let write: (chunk: OutputChunk) => void = () => {};

  const interaction = {
    perguntar: (question: string, hidden: boolean) => io.ask(question, hidden),
    limparTela: () => io.clear(),
    editar: async (request: {
      editor: "nano" | "vim";
      caminho: string;
      conteudo: string;
      novo: boolean;
      somenteLeitura: boolean;
      aviso: string | null;
      gravar(text: string): string | null;
    }) => {
      if (request.editor === "vim") {
        write({ text: VIM_UNSUPPORTED + request.caminho + "\n", tone: "warning" });
        return;
      }
      const saved = await io.edit({
        editor: request.editor,
        path: request.caminho,
        content: request.conteudo,
        isNew: request.novo,
        readOnly: request.somenteLeitura,
        warning: request.aviso,
      });
      if (saved === null) return;
      const error = request.gravar(saved);
      if (error) write({ text: error + "\n", tone: "error" });
    },
    // "exit" in the last shell closes the connection: start a fresh root shell.
    desconectar: () => {
      session = machine.abrirSessao(root);
    },
  };

  return {
    prompt() {
      const frame = session.atual();
      return { user: frame.usuario.nome, host: machine.hostname, path: session.caminhoCurto(), isRoot: frame.usuario.uid === 0 };
    },
    async run(line, sink) {
      write = sink;
      const output = { escrever: (text: string, legacyClass?: string) => sink({ text, tone: toneOf(legacyClass) }) };
      await interpreter.executarLinha(line, machine, session, output, interaction);
    },
    snapshot() {
      return Serializador.paraJson(machine);
    },
  };
}
