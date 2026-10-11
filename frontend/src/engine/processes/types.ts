// What the commands of the process control (SPEC-029) rely on in the engine. They never import the legacy classes as
// types: these structural shapes are all they know, and the engine fills them in at run time.

export interface Output {
  escrever(text: string, className?: string): void;
}

/** A user process of the machine (one command line running now, in the foreground or in the background). */
export interface EngineProcess {
  pid: number;
  uid: number;
  /** The command line; the engine marks it readonly, but a command that replaces itself (nice) rewrites it. */
  comando: string;
  tty: string;
  pai: EngineProcess | null;
  /** The session that started it; its shell is the parent of a command with no other. */
  sessao?: { atual(): { pid: number } } | null;
  /** The signal that ended it, or null while it is alive. */
  sinal: number | null;
  pausado: boolean;
  /** A job whose PID the first command of the line may still take over. */
  reutilizavel: boolean;
  readonly encerrado: boolean;
  estaPausado(): boolean;
  receber(signal: number): void;
}

export interface EngineMachine {
  hostname: string;
  processos: { listar(): EngineProcess[]; porPid(pid: number): EngineProcess | undefined };
  contas: { nomeDoUsuario(uid: number): string };
}

export interface EngineExecutor {
  executarArgs(args: string[], context: EngineContext): Promise<number>;
  executarTexto(text: string, context: EngineContext): Promise<number>;
}

export interface EngineContext {
  maquina: EngineMachine;
  saida: Output;
  erro: Output;
  entrada: string | null;
  processo: EngineProcess | null;
  emFundo: boolean;
  credencial: { uid: number; gids: number[] };
  sessao: { tty: string; jobs: unknown[] };
  interacao: { limparTela(): void };
  executor: EngineExecutor;
  linha(text?: string, className?: string): void;
  escrever(text: string, className?: string): void;
  falhar(text: string): void;
  ehRoot(): boolean;
  /** Should the command stop? (Ctrl+C in the terminal, or a kill on its process.) */
  interrompido(): boolean;
  /** Waits ms (held while the process is stopped); false when it was interrupted. */
  dormir(ms: number): Promise<boolean>;
  com(changes: Partial<{ saida: Output; erro: Output; processo: EngineProcess | null }>): EngineContext;
}

/** The help of a command, in the shape `--help` reads (SPEC-027). */
export interface EngineHelp {
  uso: string;
  descricao: string;
  opcoes?: [string, string][];
  exemplos?: [string, string][];
  h?: "ajuda" | "outra";
  soPrimeiro?: boolean;
  semOpcaoDeAjuda?: boolean;
}

export interface EngineCommand {
  readonly nome: string;
  readonly resumo: string;
  readonly embutido?: boolean;
  ajuda?: EngineHelp;
  executar(args: string[], context: EngineContext): Promise<number>;
}
