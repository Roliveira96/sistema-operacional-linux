// The part of the legacy engine the new commands rely on (SPEC-028, RN-02). The commands never import
// the legacy classes as values: they only use these structural types and behave like engine commands.

export interface Output {
  escrever(text: string, className?: string): void;
}

/** A node of the simulated file system, seen by its capabilities (a file reads, a folder has children). */
export interface EngineNode {
  nome: string;
  modo: number;
  dono: number;
  grupo: number;
  modificadoEm: Date;
  ehDiretorio(): boolean;
  tamanho(): number;
  ler?(): string;
  escrever?(text: string): void;
  filhos?: Map<string, EngineNode>;
  nomesOrdenados?(): string[];
  obter?(name: string): EngineNode | undefined;
  /** Symbolic link target. */
  alvo?: string;
  /** Copy of the node, and (on a folder) adding a child: how the binaries of the new commands are made. */
  clonar?(): EngineNode;
  adicionar?(child: EngineNode): void;
  /** Archive kind of a compressed file. */
  formato?: string;
  /** Device letter ("c" or "b"). */
  letra?: string;
}

/** One line of `ps -ef`: the processes of the machine, the system ones included. */
export interface EngineProcess {
  pid: number;
  ppid: number;
  comando: string;
}

export interface EngineMachine {
  hostname: string;
  criarArquivo(path: string, content: string, owner: number, group: number, mode: number): EngineNode;
  criarDiretorio(path: string, owner: number, group: number, mode: number): EngineNode;
}

export interface EngineExecutor {
  executarArgs(args: string[], context: EngineContext): Promise<number>;
  executarTexto(text: string, context: EngineContext): Promise<number>;
  ehEmbutido(name: string): boolean;
  nomesDeComandos(): string[];
}

export interface EngineContext {
  maquina: EngineMachine;
  saida: Output;
  erro: Output;
  entrada: string | null;
  credencial: { uid: number; gids: number[] };
  executor: EngineExecutor;
  fs: { pode(node: EngineNode, credential: { uid: number; gids: number[] }, access: "r" | "w" | "x"): boolean };
  /** Asks the user for a line (passwords are asked hidden). */
  interacao: { perguntar(question: string, hidden: boolean): Promise<string> };
  quadro: { cwd: string };
  sessao: { tty: string };
  linha(text?: string, className?: string): void;
  escrever(text: string, className?: string): void;
  falhar(text: string): void;
  localizar(path: string): EngineNode;
  localizarSemSeguir(path: string): EngineNode;
  tentarLocalizar(path: string): EngineNode | null;
  ehRoot(): boolean;
  com(changes: Partial<{ saida: Output; erro: Output }>): EngineContext;
}

/** The help of a command, in the shape the help of the simulator reads (SPEC-027). */
export interface EngineHelp {
  uso: string;
  descricao: string;
  opcoes?: [string, string][];
  exemplos?: [string, string][];
  h?: "ajuda" | "outra";
  soPrimeiro?: boolean;
}

export interface EngineCommand {
  readonly nome: string;
  readonly resumo: string;
  readonly embutido?: boolean;
  ajuda?: EngineHelp;
  executar(args: string[], context: EngineContext): Promise<number>;
}

export interface CommandRegistry {
  registrar(...commands: EngineCommand[]): void;
  obter(name: string): EngineCommand | undefined;
}
