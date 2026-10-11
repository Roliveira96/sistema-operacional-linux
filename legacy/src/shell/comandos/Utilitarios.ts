import { mostrarAjuda, mostrarManual, type AjudaDoComando } from '../Ajuda';
import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import type { RegistroDeComandos } from '../RegistroDeComandos';

export class Clear extends Comando {
  public readonly nome: string = 'clear';
  public readonly resumo: string = 'limpa a tela (atalho: Ctrl+L)';
  public readonly ajuda: AjudaDoComando = {
    uso: 'clear',
    descricao: 'Limpa a tela do terminal. O atalho Ctrl+L faz o mesmo.',
    exemplos: [['clear', 'limpa a tela']],
  };

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.interacao.limparTela();
    return 0;
  }
}

export class History extends Comando {
  public readonly nome: string = 'history';
  public readonly resumo: string = 'lista os comandos digitados (setas ↑ ↓ navegam por eles; -c limpa)';
  public readonly ajuda: AjudaDoComando = {
    uso: 'history [-c]',
    descricao: 'Lista os comandos que você digitou neste terminal, numerados.',
    opcoes: [['-c', 'apaga o histórico']],
    exemplos: [
      ['history', 'lista os comandos digitados'],
      ['history | grep apt', 'procura no histórico os comandos com apt'],
      ['history -c', 'apaga o histórico'],
    ],
  };
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
  public readonly ajuda: AjudaDoComando = {
    uso: 'hostname [-I]',
    descricao: 'Mostra o nome desta máquina na rede.',
    opcoes: [['-I', 'mostra o endereço IP em vez do nome']],
    exemplos: [
      ['hostname', 'mostra o nome da máquina'],
      ['hostname -I', 'mostra o endereço IP'],
    ],
    h: 'ajuda',
  };

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    contexto.linha(args[0] === '-I' ? '192.168.0.10' : contexto.maquina.hostname);
    return 0;
  }
}

export class Date_ extends Comando {
  public readonly nome: string = 'date';
  public readonly resumo: string = 'mostra data e hora';
  public readonly ajuda: AjudaDoComando = {
    uso: 'date',
    descricao: 'Mostra a data e a hora atuais do sistema.',
    exemplos: [['date', 'mostra a data e a hora de agora']],
  };

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
  public readonly ajuda: AjudaDoComando = {
    uso: 'uname [-a] [-s] [-n] [-r] [-m] [-o]',
    descricao: 'Mostra informações sobre o sistema. Sem opções, mostra só o nome do kernel.',
    opcoes: [
      ['-a', 'mostra tudo'],
      ['-s', 'nome do kernel (Linux)'],
      ['-n', 'nome da máquina'],
      ['-r', 'versão do kernel'],
      ['-m', 'arquitetura do processador'],
      ['-o', 'nome do sistema operacional'],
    ],
    exemplos: [
      ['uname -a', 'mostra todas as informações'],
      ['uname -r', 'mostra a versão do kernel'],
    ],
  };

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.includes('-a')) {
      contexto.linha('Linux ' + contexto.maquina.hostname + ' 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux');
    } else {
      const partes: string[] = [];
      if (args.length === 0 || args.includes('-s')) partes.push('Linux');
      if (args.includes('-n')) partes.push(contexto.maquina.hostname);
      if (args.includes('-r')) partes.push('6.8.0-45-generic');
      if (args.includes('-m')) partes.push('x86_64');
      if (args.includes('-o')) partes.push('GNU/Linux');
      contexto.linha(partes.join(' '));
    }
    return 0;
  }
}

export class Who extends Comando {
  public readonly nome: string = 'who';
  public readonly resumo: string = 'mostra quem está logado (cada terminal aberto é uma sessão SSH)';
  public readonly ajuda: AjudaDoComando = {
    uso: 'who',
    descricao: 'Mostra quem está conectado ao servidor: usuário, terminal, hora da conexão e endereço de origem.',
    exemplos: [['who', 'lista as sessões abertas']],
  };

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
  public readonly embutido: boolean = true;
  public readonly ajuda: AjudaDoComando = {
    uso: 'help [COMANDO]',
    descricao: 'Sem argumentos, lista os comandos do simulador. Com um COMANDO, mostra a ajuda daquele comando.',
    exemplos: [
      ['help', 'lista os comandos disponíveis'],
      ['help ls', 'mostra a ajuda do ls'],
    ],
  };
  private readonly registro: RegistroDeComandos;

  constructor(registro: RegistroDeComandos) {
    super();
    this.registro = registro;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    // `help COMANDO` mostra a ajuda daquele comando, a mesma de `COMANDO --help` (SPEC-027 RN-08).
    if (args.length > 0 && !args[0].startsWith('-')) {
      const alvo: Comando | undefined = this.registro.obter(args[0]);
      if (alvo === undefined) {
        contexto.falhar('bash: help: nenhum tópico de ajuda corresponde a `' + args[0] + "'. Tente `help help' ou `man -k " + args[0] + "' ou `info " + args[0] + "'.");
        return 1;
      }
      mostrarAjuda(alvo, contexto);
      return 0;
    }
    contexto.linha('Comandos disponíveis neste simulador (use "COMANDO --help" ou "man COMANDO" para saber mais):', 'c-info');
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
  public readonly ajuda: AjudaDoComando = {
    uso: 'man COMANDO',
    descricao: 'Mostra o manual de um comando. No simulador é um resumo: uso, descrição, opções e exemplos.',
    exemplos: [
      ['man ls', 'mostra o manual do ls'],
      ['man man', 'mostra o manual do próprio man'],
    ],
  };
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
    mostrarManual(comando, contexto);
    return 0;
  }
}
