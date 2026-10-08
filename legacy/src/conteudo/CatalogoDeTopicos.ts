import type { Topico } from './Topico';
import { historia } from './historia';
import { estrutura } from './estrutura';
import { diretorios } from './diretorios';
import { arquivos } from './arquivos';
import { exclusao } from './exclusao';
import { permissoes } from './permissoes';
import { usuarios } from './usuarios';
import { pacotes } from './pacotes';
import { simulado } from './simulado';

/** Todos os tópicos do material, na ordem de estudo sugerida. */
export class CatalogoDeTopicos {
  private readonly topicos: Topico[] = [historia, estrutura, diretorios, arquivos, exclusao, permissoes, usuarios, pacotes, simulado];

  public listar(): Topico[] {
    return this.topicos;
  }

  public obter(id: string): Topico | undefined {
    return this.topicos.find((t: Topico) => t.id === id);
  }
}
