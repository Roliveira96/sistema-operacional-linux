import type { Comando } from './Comando';

/** Catálogo de comandos que o shell conhece, por nome. */
export class RegistroDeComandos {
  private readonly comandos: Map<string, Comando> = new Map();

  public registrar(...comandos: Comando[]): void {
    for (const comando of comandos) {
      this.comandos.set(comando.nome, comando);
    }
  }

  public obter(nome: string): Comando | undefined {
    return this.comandos.get(nome);
  }

  public nomes(): string[] {
    return Array.from(this.comandos.keys()).sort();
  }

  public listar(): Comando[] {
    return Array.from(this.comandos.values());
  }
}
