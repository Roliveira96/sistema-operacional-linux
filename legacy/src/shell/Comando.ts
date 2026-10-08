import type { Contexto } from './Contexto';

/** Todo comando do simulador: um nome, uma linha de ajuda e o que ele faz. */
export abstract class Comando {
  public abstract readonly nome: string;
  public abstract readonly resumo: string;
  /** Comandos embutidos no bash (cd, umask, exit...) não existem para o sudo. */
  public readonly embutido: boolean = false;

  public abstract executar(args: string[], contexto: Contexto): Promise<number>;
}

/**
 * Lê opções no estilo getopt: "-la" vira l + a; "-n 5" e "-n5" dão valor ao n;
 * "--recursive" pode ser traduzida para "R"; "--" encerra as opções.
 */
export class Opcoes {
  public readonly flags: Set<string> = new Set();
  public readonly valores: Map<string, string> = new Map();
  public readonly operandos: string[] = [];
  public faltaValor: string | null = null;

  public static ler(args: string[], comValor: string = '', longas: Record<string, string> = {}): Opcoes {
    const opcoes: Opcoes = new Opcoes();
    let fimDasOpcoes: boolean = false;
    for (let i: number = 0; i < args.length; i++) {
      const arg: string = args[i];
      if (fimDasOpcoes || arg === '-' || !arg.startsWith('-')) {
        opcoes.operandos.push(arg);
        continue;
      }
      if (arg === '--') {
        fimDasOpcoes = true;
        continue;
      }
      if (arg.startsWith('--')) {
        const [nomeLongo, valor] = arg.substring(2).split('=');
        const curta: string = longas[nomeLongo] ?? '--' + nomeLongo;
        opcoes.flags.add(curta);
        if (valor !== undefined) {
          opcoes.valores.set(curta, valor);
        } else if (comValor.includes(curta) && i + 1 < args.length) {
          opcoes.valores.set(curta, args[++i]);
        }
        continue;
      }
      for (let j: number = 1; j < arg.length; j++) {
        const letra: string = arg.charAt(j);
        opcoes.flags.add(letra);
        if (comValor.includes(letra)) {
          const resto: string = arg.substring(j + 1);
          if (resto !== '') {
            opcoes.valores.set(letra, resto);
          } else if (i + 1 < args.length) {
            opcoes.valores.set(letra, args[++i]);
          } else {
            opcoes.faltaValor = letra;
          }
          break;
        }
      }
    }
    return opcoes;
  }

  public tem(...letras: string[]): boolean {
    return letras.some((letra: string) => this.flags.has(letra));
  }

  public valor(letra: string): string | undefined {
    return this.valores.get(letra);
  }
}

/** Nome entre aspas simples, como o coreutils em pt_BR mostra nas mensagens. */
export function citar(nome: string): string {
  return "'" + nome + "'";
}
