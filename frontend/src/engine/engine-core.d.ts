// Typed boundary of the POSIX/VFS engine core (SPEC-014, SPEC-034). The engine lives
// in src/engine/core and keeps its Portuguese identifiers; these declarations list
// only what src/engine/ uses, so the frontend type check does not compile the
// whole engine core with the stricter frontend settings.

declare module "@engine-core/linux/Contas" {
  export interface Usuario {
    nome: string;
    uid: number;
  }
}

declare module "@engine-core/linux/Sessao" {
  import type { Usuario } from "@engine-core/linux/Contas";
  export interface Sessao {
    atual(): { usuario: Usuario; cwd: string };
    caminhoCurto(): string;
    readonly historico: string[];
  }
}

declare module "@engine-core/linux/Maquina" {
  import type { Usuario } from "@engine-core/linux/Contas";
  import type { Sessao } from "@engine-core/linux/Sessao";
  export class Maquina {
    hostname: string;
    /** The file system: only what the window needs to know about a folder. */
    fs: { obter(caminho: string): { ehDiretorio(): boolean } | null };
    contas: { usuario(nome: string): Usuario | undefined };
    abrirSessao(usuario: Usuario): Sessao;
    fecharSessao(sessao: Sessao): void;
    atualizarProc(): void;
    static criar(): Maquina;
  }
}

declare module "@engine-core/linux/Serializador" {
  import type { Maquina } from "@engine-core/linux/Maquina";
  export class Serializador {
    static paraJson(maquina: Maquina): unknown;
    static deJson(json: unknown): Maquina;
  }
}

// SPEC-016: the terminal window of the prototype and the cheat sheet.
declare module "@engine-core/terminal/JanelaDeTerminais" {
  import type { Maquina } from "@engine-core/linux/Maquina";

  export interface TerminalUbuntu {
    readonly numero: number;
    executarAutomatico(comando: string, respostas?: string[]): Promise<void>;
    escrever(texto: string, classe?: string): void;
    usuarioAtual(): string | null;
    focar(): void;
  }

  export interface OuvinteDaJanela {
    aoExecutar(): void;
  }

  export class JanelaDeTerminais {
    constructor(container: HTMLElement, maquina: Maquina, ouvinte: OuvinteDaJanela, emColunas?: boolean);
    obter(numero: number, login?: { usuario: string; senha: string }): Promise<TerminalUbuntu>;
    trocarMaquina(maquina: Maquina): void;
    executarResetAnimado(recriar: () => Maquina): Promise<void>;
    definirVelocidade(velocidade: number): void;
    aoMudarTitulo(): void;
    destruir(): void;
  }
}

declare module "@engine-core/app/ArmazemDeMaquinas" {
  import type { Maquina } from "@engine-core/linux/Maquina";
  export class ArmazemDeMaquinas {
    static baixar(maquina: Maquina, nome: string): void;
    static importar(): Promise<Maquina>;
  }
}

declare module "@engine-core/conteudo/CatalogoDeTopicos" {
  export class CatalogoDeTopicos {
    listar(): unknown[];
  }
}

declare module "@engine-core/app/ColaDeComandos" {
  export class ColaDeComandos {
    static html(topicos: unknown[]): string;
  }
}

declare module "@engine-core/estilos/terminal.css" {
  const stylesheet: string;
  export default stylesheet;
}

declare module "@engine-core/shell/Shell" {
  /** The help of a command (SPEC-027), as the tests of the engine read it. */
  export interface AjudaDoComando {
    uso: string;
    descricao: string;
    opcoes?: [string, string][];
    exemplos?: [string, string][];
    h?: "ajuda" | "outra";
    soPrimeiro?: boolean;
    semOpcaoDeAjuda?: boolean;
  }
  export interface ComandoDoSimulador {
    readonly nome: string;
    readonly resumo: string;
    readonly ajuda?: AjudaDoComando;
  }
  export class Shell {
    static obterRegistro(): {
      listar(): ComandoDoSimulador[];
      obter(nome: string): ComandoDoSimulador | undefined;
      registrar(...comandos: ComandoDoSimulador[]): void;
    };
  }
}

declare module "@engine-core/shell/Saida" {
  /** Where a command prints: the terminal, a file (>) or the next command of a pipe (|). */
  export class SaidaEmTexto {
    texto: string;
    escrever(texto: string): void;
  }
  export class SaidaParaArquivo {
    escrever(texto: string): void;
  }
}

declare module "@engine-core/shell/comandos/Processos" {
  /** One line of ps: a system process, a service, an SSH session or a user command. */
  export interface LinhaDeProcesso {
    pid: number;
    ppid: number;
    usuario: string;
    tty: string;
    estado: string;
    comando: string;
    inicio: Date;
    cpu: number;
    mem: number;
    tipo: "sistema" | "servico" | "sshd" | "shell" | "usuario";
    processo?: object;
  }
  export function listarProcessos(maquina: unknown): LinhaDeProcesso[];
}

declare module "@engine-core/linux/Pacotes" {
  /** A package of the simulated apt: `programas` are "bin/name" or "sbin/name". */
  export interface Pacote {
    nome: string;
    programas: string[];
    base?: boolean;
  }
  export const CATALOGO: Pacote[];
}
