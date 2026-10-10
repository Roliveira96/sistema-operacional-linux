// Typed boundary of the legacy POSIX/VFS engine (SPEC-014). The engine lives
// in legacy/src and keeps its Portuguese identifiers; these declarations list
// only what src/engine/ uses, so the frontend type check does not compile the
// whole legacy code base with the stricter frontend settings.

declare module "@legacy-engine/linux/Contas" {
  export interface Usuario {
    nome: string;
    uid: number;
  }
}

declare module "@legacy-engine/linux/Sessao" {
  import type { Usuario } from "@legacy-engine/linux/Contas";
  export interface Sessao {
    atual(): { usuario: Usuario; cwd: string };
    caminhoCurto(): string;
    readonly historico: string[];
  }
}

declare module "@legacy-engine/linux/Maquina" {
  import type { Usuario } from "@legacy-engine/linux/Contas";
  import type { Sessao } from "@legacy-engine/linux/Sessao";
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

declare module "@legacy-engine/linux/Serializador" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  export class Serializador {
    static paraJson(maquina: Maquina): unknown;
    static deJson(json: unknown): Maquina;
  }
}

// SPEC-016: the terminal window of the prototype and the cheat sheet.
declare module "@legacy-engine/terminal/JanelaDeTerminais" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";

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

declare module "@legacy-engine/estilos/terminal.css" {
  const stylesheet: string;
  export default stylesheet;
}
