// Typed boundary of the legacy code reused by the frontend (SPEC-014,
// SPEC-016). The legacy code lives in legacy/src and keeps its Portuguese
// identifiers; these declarations list only what src/engine/ uses, so the
// frontend type check does not compile the whole legacy code base with the
// stricter frontend settings.

declare module "@legacy-engine/linux/Contas" {
  export interface Usuario {
    nome: string;
    uid: number;
  }
}

declare module "@legacy-engine/linux/Sessao" {
  export interface Sessao {
    /** Command history of the shell, read by the arrow keys. */
    historico: string[];
  }
}

declare module "@legacy-engine/linux/Maquina" {
  import type { Usuario } from "@legacy-engine/linux/Contas";
  export class Maquina {
    static criar(): Maquina;
    hostname: string;
    contas: { usuario(nome: string): Usuario | undefined };
    fecharSessao(sessao: import("@legacy-engine/linux/Sessao").Sessao): void;
    atualizarProc(): void;
  }
}

declare module "@legacy-engine/linux/Serializador" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  export class Serializador {
    static paraJson(maquina: Maquina): unknown;
    static deJson(json: unknown): Maquina;
  }
}

declare module "@legacy-engine/terminal/JanelaDeTerminais" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  import type { Usuario } from "@legacy-engine/linux/Contas";
  import type { Sessao } from "@legacy-engine/linux/Sessao";

  // The class lives in terminal/TerminalUbuntu; only its type is used here.
  export interface TerminalUbuntu {
    readonly numero: number;
    usuarioAtual(): string | null;
    estaLivre(): boolean;
    escrever(texto: string, classe?: string): void;
    pedirLogin(): void;
    executarAutomatico(comando: string, respostas?: string[]): Promise<void>;
    // Members private to the legacy class, used only to swap the machine of
    // an open terminal while keeping its history (SPEC-016 CA-10).
    maquina: Maquina;
    sessao: Sessao | null;
    posicaoHistorico: number;
    iniciarSessao(usuario: Usuario): void;
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
    focar(): void;
    destruir(): void;
    // Private to the legacy class; see TerminalUbuntu.
    maquina: Maquina;
    terminais: Array<TerminalUbuntu | null>;
  }
}

declare module "@legacy-engine/app/ArmazemDeMaquinas" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  export class ArmazemDeMaquinas {
    static baixar(maquina: Maquina, nome: string): void;
    static importar(): Promise<Maquina>;
  }
}

declare module "@legacy-engine/conteudo/CatalogoDeTopicos" {
  export class CatalogoDeTopicos {
    listar(): unknown[];
  }
}

declare module "@legacy-engine/app/ColaDeComandos" {
  export class ColaDeComandos {
    static html(topicos: unknown[]): string;
  }
}

declare module "@legacy-engine/estilos/terminal.css";
declare module "@legacy-engine/estilos/topico.css";
