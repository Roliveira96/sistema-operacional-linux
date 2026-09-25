import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import { Servicos } from '../../linux/Pacotes';

const PATH: string[] = ['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin'];

export class Systemctl extends Comando {
  public readonly nome: string = 'systemctl';
  public readonly resumo: string = 'controla serviços: systemctl status|start|stop|restart|enable|disable SERVIÇO';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const agora: boolean = args.includes('--now');
    const limpos: string[] = args.filter((a: string) => !a.startsWith('--') && a !== '--now');
    const [acao, ...nomesBrutos] = limpos;
    const servicos: Servicos = new Servicos(contexto.maquina);
    const nomes: string[] = nomesBrutos.map(Servicos.normalizar);

    if (acao === undefined || acao === 'list-units') {
      return this.listar(servicos, contexto);
    }
    if (nomes.length === 0) {
      contexto.falhar('Too few arguments.');
      return 1;
    }
    for (const nome of nomes) {
      if (!servicos.existe(nome)) {
        if (acao === 'is-active') { contexto.linha('inactive'); return 3; }
        contexto.falhar((acao === 'status' ? 'Unit ' : 'Failed to ' + acao + ' ' + nome + '.service: Unit ') + nome + '.service could not be found.');
        contexto.linha('Dica: o serviço vem com o pacote. Instale antes, por exemplo: apt install nginx', 'c-info');
        return acao === 'status' ? 4 : 5;
      }
    }
    const alteraAlgo: boolean = ['start', 'stop', 'restart', 'reload', 'enable', 'disable'].includes(acao);
    if (alteraAlgo && !contexto.ehRoot()) {
      const verbo: string = acao === 'enable' || acao === 'disable' ? acao + ' unit' : acao + ' ' + nomes[0] + '.service';
      contexto.falhar('Failed to ' + verbo + ': Interactive authentication required.');
      contexto.falhar('See system logs and \'systemctl status ' + nomes[0] + '.service\' for details.');
      contexto.linha('Dica: gerenciar serviços exige root: use sudo systemctl ' + acao + ' ' + nomes[0], 'c-info');
      return 1;
    }
    let status: number = 0;
    for (const nome of nomes) {
      switch (acao) {
        case 'status': status = this.status(nome, servicos, contexto); break;
        case 'start': servicos.iniciar(nome); break;
        case 'stop': servicos.parar(nome); break;
        case 'restart':
        case 'reload': servicos.parar(nome); servicos.iniciar(nome); break;
        case 'enable':
          if (servicos.habilitar(nome)) {
            contexto.linha('Created symlink /etc/systemd/system/multi-user.target.wants/' + nome + '.service → /usr/lib/systemd/system/' + nome + '.service.');
          }
          if (agora) servicos.iniciar(nome);
          break;
        case 'disable':
          if (servicos.desabilitar(nome)) {
            contexto.linha('Removed "/etc/systemd/system/multi-user.target.wants/' + nome + '.service".');
          }
          if (agora) servicos.parar(nome);
          break;
        case 'is-active':
          contexto.linha(servicos.ativo(nome) ? 'active' : 'inactive');
          status = servicos.ativo(nome) ? 0 : 3;
          break;
        case 'is-enabled':
          contexto.linha(servicos.habilitado(nome) ? 'enabled' : 'disabled');
          status = servicos.habilitado(nome) ? 0 : 1;
          break;
        default:
          contexto.falhar('Unknown command verb \'' + acao + '\'.');
          return 1;
      }
    }
    return status;
  }

  private status(nome: string, servicos: Servicos, contexto: Contexto): number {
    const ativo: boolean = servicos.ativo(nome);
    const habilitado: string = servicos.habilitado(nome) ? 'enabled' : 'disabled';
    contexto.escrever('●', ativo ? 'c-ok' : '');
    contexto.linha(' ' + nome + '.service - ' + servicos.descricao(nome));
    contexto.linha('     Loaded: loaded (/usr/lib/systemd/system/' + nome + '.service; ' + habilitado + '; preset: enabled)');
    contexto.escrever('     Active: ');
    if (ativo) {
      const desde: Date = servicos.desde(nome) ?? new Date();
      const segundos: number = Math.max(1, Math.round((Date.now() - desde.getTime()) / 1000));
      contexto.escrever('active (running)', 'c-ok');
      contexto.linha(' since ' + desde.toString().substring(0, 24) + '; ' + (segundos < 60 ? segundos + 's' : Math.floor(segundos / 60) + 'min') + ' ago');
      const pid: number = servicos.pid(nome);
      contexto.linha('   Main PID: ' + pid + ' (' + nome + ')');
      contexto.linha('      Tasks: ' + (servicos.processos(nome).length + 1) + ' (limit: 4558)');
      contexto.linha('     Memory: ' + (2 + nome.length / 3).toFixed(1) + 'M');
      contexto.linha('     CGroup: /system.slice/' + nome + '.service');
      servicos.processos(nome).forEach((processo: string, i: number, lista: string[]) => {
        contexto.linha('             ' + (i === lista.length - 1 ? '└─' : '├─') + (pid + i) + ' "' + processo + '"');
      });
      return 0;
    }
    contexto.linha('inactive (dead)');
    return 3;
  }

  private listar(servicos: Servicos, contexto: Contexto): number {
    contexto.linha('  UNIT                  LOAD   ACTIVE   SUB     DESCRIPTION');
    const nomes: string[] = servicos.listar();
    for (const nome of nomes) {
      const ativo: boolean = servicos.ativo(nome);
      contexto.linha('  ' + (nome + '.service').padEnd(21) + ' loaded ' + (ativo ? 'active  ' : 'inactive') + ' ' + (ativo ? 'running' : 'dead   ') + ' ' + servicos.descricao(nome));
    }
    contexto.linha();
    contexto.linha(nomes.length + ' loaded units listed.');
    return 0;
  }
}

export class Service extends Comando {
  public readonly nome: string = 'service';
  public readonly resumo: string = 'jeito antigo de controlar serviços: service nginx status|start|stop|restart';
  private readonly systemctl: Systemctl = new Systemctl();

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args[0] === '--status-all') {
      const servicos: Servicos = new Servicos(contexto.maquina);
      for (const nome of servicos.listar()) contexto.linha(' [ ' + (servicos.ativo(nome) ? '+' : '-') + ' ]  ' + nome);
      return 0;
    }
    if (args.length < 2) {
      contexto.falhar('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]');
      return 1;
    }
    return this.systemctl.executar([args[1], args[0]], contexto);
  }
}

export class Which extends Comando {
  public readonly nome: string = 'which';
  public readonly resumo: string = 'mostra em qual pasta está o programa: which ls → /usr/bin/ls';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let status: number = 0;
    for (const nome of args.filter((a: string) => !a.startsWith('-'))) {
      const pasta: string | undefined = PATH.find((p: string) => contexto.fs.obter(p + '/' + nome) !== null);
      if (pasta !== undefined) contexto.linha(pasta + '/' + nome);
      else status = 1;
    }
    return status;
  }
}

export class LsbRelease extends Comando {
  public readonly nome: string = 'lsb_release';
  public readonly resumo: string = 'mostra a distribuição e a versão: lsb_release -a';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const todas: boolean = args.includes('-a') || args.length === 0;
    if (todas) contexto.falhar('No LSB modules are available.');
    if (todas || args.includes('-i')) contexto.linha('Distributor ID:\tUbuntu');
    if (todas || args.includes('-d')) contexto.linha('Description:\tUbuntu 24.04 LTS');
    if (todas || args.includes('-r')) contexto.linha('Release:\t24.04');
    if (todas || args.includes('-c')) contexto.linha('Codename:\tnoble');
    return 0;
  }
}

export class Df extends Comando {
  public readonly nome: string = 'df';
  public readonly resumo: string = 'espaço em disco de cada partição montada (-h legível)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const humano: boolean = args.some((a: string) => a.startsWith('-') && a.includes('h'));
    contexto.linha('Sist. Arq.      ' + (humano ? 'Tam. Usado Disp. Uso%' : '   1K-blocos    Usado Disponível Uso%') + ' Montado em');
    const linhas: Array<[string, string, string, string, string, string]> = [
      ['tmpfs', '392M', '1,1M', '391M', '1%', '/run'],
      ['/dev/sda2', '24G', '6,8G', '16G', '30%', '/'],
      ['tmpfs', '2,0G', '0', '2,0G', '0%', '/dev/shm'],
      ['/dev/sda1', '1,1G', '6,1M', '1,1G', '1%', '/boot/efi'],
    ];
    for (const [sistema, tam, usado, disp, uso, ponto] of linhas) {
      contexto.linha(humano
        ? sistema.padEnd(15) + ' ' + tam.padStart(4) + ' ' + usado.padStart(5) + ' ' + disp.padStart(5) + ' ' + uso.padStart(4) + ' ' + ponto
        : sistema.padEnd(15) + ' ' + '25107716'.padStart(12) + ' ' + '7126512'.padStart(8) + ' ' + '16680884'.padStart(10) + ' ' + uso.padStart(4) + ' ' + ponto);
    }
    return 0;
  }
}

export class Free extends Comando {
  public readonly nome: string = 'free';
  public readonly resumo: string = 'uso de memória RAM e swap (-h legível)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.includes('-h')) {
      contexto.linha('               total       usada       livre    compart.  buff/cache  disponível');
      contexto.linha('Mem.:          3,8Gi       1,1Gi       1,9Gi        12Mi       1,0Gi       2,7Gi');
      contexto.linha('Swap:          2,0Gi          0B       2,0Gi');
    } else {
      contexto.linha('               total       usada       livre    compart.  buff/cache  disponível');
      contexto.linha('Mem.:        4015604     1172484     1987332       12344     1055788     2843120');
      contexto.linha('Swap:        2097148           0     2097148');
    }
    return 0;
  }
}

export class Lsblk extends Comando {
  public readonly nome: string = 'lsblk';
  public readonly resumo: string = 'lista discos e partições (os dispositivos de bloco de /dev)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.linha('NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS');
    contexto.linha('sda      8:0    0   25G  0 disk ');
    contexto.linha('├─sda1   8:1    0    1G  0 part /boot/efi');
    contexto.linha('└─sda2   8:2    0   24G  0 part /');
    contexto.linha('sr0     11:0    1 1024M  0 rom  ');
    return 0;
  }
}
