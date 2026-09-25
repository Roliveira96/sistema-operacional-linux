import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import type { RegistroDeComandos } from '../RegistroDeComandos';

export class Clear extends Comando {
  public readonly nome: string = 'clear';
  public readonly resumo: string = 'limpa a tela (atalho: Ctrl+L)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.interacao.limparTela();
    return 0;
  }
}

export class History extends Comando {
  public readonly nome: string = 'history';
  public readonly resumo: string = 'lista os comandos digitados (setas ↑ ↓ navegam por eles; -c limpa)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const historico: string[] = contexto.sessao.historico;
    if (args[0] === '-c') {
      historico.length = 0;
      return 0;
    }
    historico.forEach((linha: string, i: number) => contexto.linha(String(i + 1).padStart(5) + '  ' + linha));
    return 0;
  }
}

export class Hostname extends Comando {
  public readonly nome: string = 'hostname';
  public readonly resumo: string = 'mostra o nome da máquina (-I mostra o IP)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    contexto.linha(args[0] === '-I' ? '192.168.0.10' : contexto.maquina.hostname);
    return 0;
  }
}

export class Date_ extends Comando {
  public readonly nome: string = 'date';
  public readonly resumo: string = 'mostra data e hora';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const agora: Date = new Date();
    const dias: string[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const meses: string[] = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const dois = (n: number): string => String(n).padStart(2, '0');
    contexto.linha(dias[agora.getDay()] + ' ' + dois(agora.getDate()) + ' ' + meses[agora.getMonth()] + ' ' + agora.getFullYear() + ' ' +
      dois(agora.getHours()) + ':' + dois(agora.getMinutes()) + ':' + dois(agora.getSeconds()) + ' -03');
    return 0;
  }
}

export class Uname extends Comando {
  public readonly nome: string = 'uname';
  public readonly resumo: string = 'informações do sistema (-a tudo)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    contexto.linha(args.includes('-a')
      ? 'Linux ' + contexto.maquina.hostname + ' 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux'
      : 'Linux');
    return 0;
  }
}

export class Who extends Comando {
  public readonly nome: string = 'who';
  public readonly resumo: string = 'mostra quem está logado (cada terminal aberto é uma sessão SSH)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const agora: Date = new Date();
    const dois = (n: number): string => String(n).padStart(2, '0');
    const quando: string = agora.getFullYear() + '-' + dois(agora.getMonth() + 1) + '-' + dois(agora.getDate()) + ' ' +
      dois(agora.getHours()) + ':' + dois(agora.getMinutes());
    contexto.maquina.usuariosNasConexoes().forEach((nome: string, i: number) => {
      contexto.linha(nome.padEnd(9) + 'pts/' + i + '        ' + quando + ' (192.168.0.' + (50 + i) + ')');
    });
    return 0;
  }
}

export class Ajuda extends Comando {
  public readonly nome: string = 'help';
  public readonly resumo: string = 'lista os comandos disponíveis no simulador';
  private readonly registro: RegistroDeComandos;

  constructor(registro: RegistroDeComandos) {
    super();
    this.registro = registro;
  }

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.linha('Comandos disponíveis neste simulador (use "man COMANDO" para um resumo):', 'c-info');
    for (const comando of this.registro.listar().sort((a: Comando, b: Comando) => a.nome.localeCompare(b.nome))) {
      contexto.escrever('  ' + comando.nome.padEnd(10), 'c-exe');
      contexto.linha(comando.resumo);
    }
    return 0;
  }
}

export class Man extends Comando {
  public readonly nome: string = 'man';
  public readonly resumo: string = 'manual de um comando (no simulador, um resumo)';
  private readonly registro: RegistroDeComandos;

  constructor(registro: RegistroDeComandos) {
    super();
    this.registro = registro;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('Qual página do manual você quer?');
      contexto.falhar("Por exemplo, experimente 'man man'.");
      return 1;
    }
    const comando: Comando | undefined = this.registro.obter(args[0]);
    if (comando === undefined) {
      contexto.falhar('Nenhuma entrada de manual para ' + args[0]);
      return 16;
    }
    contexto.linha(comando.nome.toUpperCase() + '(1)', 'c-negrito');
    contexto.linha();
    contexto.linha('NOME', 'c-negrito');
    contexto.linha('       ' + comando.nome + ' - ' + comando.resumo);
    contexto.linha();
    contexto.linha('(Resumo do simulador. No Ubuntu real, o man abre o manual completo: setas rolam, / pesquisa e q sai.)', 'c-info');
    return 0;
  }
}
