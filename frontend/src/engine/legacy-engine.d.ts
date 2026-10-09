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
  }
}

declare module "@legacy-engine/linux/Maquina" {
  import type { Usuario } from "@legacy-engine/linux/Contas";
  import type { Sessao } from "@legacy-engine/linux/Sessao";
  export class Maquina {
    hostname: string;
    contas: { usuario(nome: string): Usuario | undefined };
    abrirSessao(usuario: Usuario): Sessao;
  }
}

declare module "@legacy-engine/linux/Serializador" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  export class Serializador {
    static paraJson(maquina: Maquina): unknown;
    static deJson(json: unknown): Maquina;
  }
}

declare module "@legacy-engine/shell/Contexto" {
  export interface PedidoDeEdicao {
    editor: "nano" | "vim";
    caminho: string;
    conteudo: string;
    novo: boolean;
    somenteLeitura: boolean;
    aviso: string | null;
    gravar(texto: string): string | null;
  }
  export interface Interacao {
    perguntar(pergunta: string, oculto: boolean): Promise<string>;
    limparTela(): void;
    editar(pedido: PedidoDeEdicao): Promise<void>;
    desconectar(): void;
  }
}

declare module "@legacy-engine/shell/Saida" {
  export interface Saida {
    escrever(texto: string, classe?: string): void;
  }
}

declare module "@legacy-engine/shell/Shell" {
  import type { Maquina } from "@legacy-engine/linux/Maquina";
  import type { Sessao } from "@legacy-engine/linux/Sessao";
  import type { Interacao } from "@legacy-engine/shell/Contexto";
  import type { Saida } from "@legacy-engine/shell/Saida";
  export interface Interpretador {
    executarLinha(linha: string, maquina: Maquina, sessao: Sessao, saida: Saida, interacao: Interacao): Promise<number>;
  }
  export class Shell {
    static criarInterpretador(): Interpretador;
  }
}
