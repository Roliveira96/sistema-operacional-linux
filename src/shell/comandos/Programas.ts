import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, Diretorio, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { GerenciadorDePacotes, Servicos } from '../../linux/Pacotes';
import type { Credencial } from '../../linux/SistemaDeArquivos';

/** Programas que só existem depois do apt install (o shell confere se o binário está no PATH). */

export class Htop extends Comando {
  public readonly nome: string = 'htop';
  public readonly resumo: string = 'monitor de processos interativo (CPU, memória, processos)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const servicos: Servicos = new Servicos(contexto.maquina);
    const linhas: Array<[number, string, string]> = [[1, 'root', '/sbin/init']];
    for (const nome of servicos.listar().filter((n: string) => servicos.ativo(n))) {
      servicos.processos(nome).forEach((p: string, i: number) => {
        const usuario: string = nome === 'nginx' && i > 0 ? 'www-data' : nome === 'apache2' && i > 0 ? 'www-data' : nome === 'mysql' ? 'mysql' : 'root';
        linhas.push([servicos.pid(nome) + i, usuario, p]);
      });
    }
    contexto.maquina.usuariosNasConexoes().forEach((u: string, i: number) => {
      linhas.push([2100 + i * 7, u, 'sshd: ' + u + '@pts/' + i]);
      linhas.push([2101 + i * 7, u, '-bash']);
    });
    const eu: string = contexto.contas.nomeDoUsuario(contexto.credencial.uid);
    linhas.push([2412, eu, 'htop']);
    contexto.escrever('    0', 'c-dir'); contexto.escrever('['); contexto.escrever('|||', 'c-ok'); contexto.linha('                   2.6%]   Tasks: ' + (linhas.length + 20) + ', 38 thr; 1 running');
    contexto.escrever('    1', 'c-dir'); contexto.escrever('['); contexto.escrever('||', 'c-ok'); contexto.linha('                    1.3%]   Load average: 0.08 0.03 0.01');
    contexto.escrever('  Mem', 'c-dir'); contexto.escrever('['); contexto.escrever('||||||||||', 'c-ok'); contexto.linha('    1.10G/3.83G]   Uptime: 01:27:11');
    contexto.escrever('  Swp', 'c-dir'); contexto.linha('[                  0K/2.00G]');
    contexto.linha();
    contexto.linha('    PID USER       PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command', 'c-negrito');
    for (const [pid, usuario, comando] of linhas.sort((a, b) => a[0] - b[0])) {
      contexto.linha(String(pid).padStart(7) + ' ' + usuario.padEnd(10) + '  20   0 ' + '22104'.padStart(5) + ' ' + '9344'.padStart(5) + ' ' +
        '6120'.padStart(5) + ' S  0.0  0.2  0:00.' + String(pid % 100).padStart(2, '0') + ' ' + comando);
    }
    contexto.linha('F1Help  F2Setup F3Search F4Filter F5Tree  F6SortBy F7Nice F8Nice+ F9Kill  F10Quit', 'c-negrito');
    contexto.linha('(No Ubuntu real o htop atualiza ao vivo; F9 encerra um processo e q sai. Aqui é uma foto do momento.)', 'c-info');
    return 0;
  }
}

export class Neofetch extends Comando {
  public readonly nome: string = 'neofetch';
  public readonly resumo: string = 'mostra o logo da distribuição e um resumo do sistema';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const usuario: string = contexto.contas.nomeDoUsuario(contexto.credencial.uid);
    const pacotes: number = new GerenciadorDePacotes(contexto.maquina).estado().size;
    const logo: string[] = [
      '            .-/+oossssoo+/-.',
      '        `:+ssssssssssssssssss+:`',
      '      -+ssssssssssssssssssyyssss+-',
      '    .ossssssssssssssssssdMMMNysssso.',
      '   /ssssssssssshdmmNNmmyNMMMMhssssss/',
      '  +ssssssssshmydMMMMMMMNddddyssssssss+',
      ' /sssssssshNMMMyhhyyyyhmNMMMNhssssssss/',
      '.ssssssssdMMMNhsssssssssshNMMMdssssssss.',
      '+sssshhhyNMMNyssssssssssssyNMMMysssssss+',
      'ossyNMMMNyMMhsssssssssssssshmmmhssssssso',
      '+sssshhhyNMMNyssssssssssssyNMMMysssssss+',
      '.ssssssssdMMMNhsssssssssshNMMMdssssssss.',
      ' /sssssssshNMMMyhhyyyyhdNMMMNhssssssss/',
      '  +sssssssssdmydMMMMMMMMddddyssssssss+',
      '   /ssssssssssshdmNNNNmyNMMMMhssssss/',
      '    .ossssssssssssssssssdMMMNysssso.',
    ];
    const info: string[] = [
      usuario + '@' + contexto.maquina.hostname, '-'.repeat(usuario.length + contexto.maquina.hostname.length + 1),
      'OS: Ubuntu 24.04 LTS x86_64', 'Host: KVM/QEMU (Standard PC)', 'Kernel: 6.8.0-45-generic', 'Uptime: 1 hour, 27 mins',
      'Packages: ' + pacotes + ' (dpkg)', 'Shell: bash 5.2.21', 'Terminal: /dev/pts/0', 'CPU: Intel Xeon E5-2680 v4 (2) @ 2.399GHz',
      'Memory: 1128MiB / 3921MiB',
    ];
    logo.forEach((linha: string, i: number) => {
      contexto.escrever(linha.padEnd(42), 'c-laranja');
      const texto: string | undefined = info[i];
      if (texto !== undefined && texto.includes(': ')) {
        const [chave, ...resto] = texto.split(': ');
        contexto.escrever(chave + ': ', 'c-laranja');
        contexto.linha(resto.join(': '));
      } else {
        contexto.linha(texto ?? '', 'c-negrito');
      }
    });
    return 0;
  }
}

export class Cowsay extends Comando {
  public readonly nome: string = 'cowsay';
  public readonly resumo: string = 'uma vaca que fala o que você escrever (clássico para testar instalação)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const texto: string = args.join(' ') || (contexto.entrada ?? '').trim() || 'Muuu!';
    contexto.linha(' ' + '_'.repeat(texto.length + 2));
    contexto.linha('< ' + texto + ' >');
    contexto.linha(' ' + '-'.repeat(texto.length + 2));
    contexto.linha('        \\   ^__^');
    contexto.linha('         \\  (oo)\\_______');
    contexto.linha('            (__)\\       )\\/\\');
    contexto.linha('                ||----w |');
    contexto.linha('                ||     ||');
    return 0;
  }
}

export class Git extends Comando {
  public readonly nome: string = 'git';
  public readonly resumo: string = 'controle de versão (no simulador: git --version e git init)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args[0] === '--version' || args[0] === 'version') {
      contexto.linha('git version 2.43.0');
      return 0;
    }
    if (args[0] === 'init') {
      try {
        const { pai, nome } = contexto.localizarPai('.git');
        if (!contexto.fs.pode(pai, contexto.credencial, 'w')) throw new ErroDeSistema('EACCES');
        if (pai.obter(nome) === undefined) pai.adicionar(new Diretorio(nome, contexto.credencial.uid, contexto.credencial.gids[0], 0o775));
        contexto.linha('Initialized empty Git repository in ' + contexto.quadro.cwd.replace(/\/$/, '') + '/.git/');
        return 0;
      } catch (erro) {
        contexto.falhar('fatal: não foi possível criar .git: ' + (erro instanceof Error ? erro.message : ''));
        return 128;
      }
    }
    contexto.linha('O simulador entende só "git --version" e "git init". O Git de verdade você estuda à parte.', 'c-info');
    return 1;
  }
}

/** curl: só "acessa" o próprio servidor (localhost), servindo /var/www/html como o nginx/apache fariam. */
export class Curl extends Comando {
  public readonly nome: string = 'curl';
  public readonly resumo: string = 'faz requisições web pelo terminal: curl http://localhost (-I só os cabeçalhos)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'o', { head: 'I', silent: 's' });
    const url: string | undefined = opcoes.operandos[0];
    if (url === undefined) {
      contexto.falhar('curl: try \'curl --help\' or \'curl --manual\' for more information');
      return 2;
    }
    const semEsquema: string = url.replace(/^https?:\/\//, '');
    const barra: number = semEsquema.indexOf('/');
    const host: string = (barra >= 0 ? semEsquema.substring(0, barra) : semEsquema).replace(/:80$/, '');
    const caminho: string = barra >= 0 ? semEsquema.substring(barra) : '/';
    const locais: string[] = ['localhost', '127.0.0.1', '192.168.0.10', contexto.maquina.hostname];
    if (!locais.includes(host)) {
      contexto.falhar('curl: (6) Could not resolve host: ' + host);
      contexto.linha('(o servidor simulado não tem acesso à internet: teste com curl http://localhost)', 'c-info');
      return 6;
    }
    const servicos: Servicos = new Servicos(contexto.maquina);
    const servidor: string | null = servicos.ativo('nginx') ? 'nginx' : servicos.ativo('apache2') ? 'apache2' : null;
    if (servidor === null) {
      contexto.falhar('curl: (7) Failed to connect to ' + host + ' port 80 after 0 ms: Couldn\'t connect to server');
      contexto.linha('(nenhum servidor web rodando: instale e inicie o nginx ou o apache2)', 'c-info');
      return 7;
    }
    const [codigo, corpo] = this.responder(caminho, servidor, contexto);
    const assinatura: string = servidor === 'nginx' ? 'nginx/1.24.0 (Ubuntu)' : 'Apache/2.4.58 (Ubuntu)';
    this.registrar(servidor, caminho, codigo, corpo.length, contexto);
    if (opcoes.tem('I')) {
      const textos: Record<number, string> = { 200: 'OK', 403: 'Forbidden', 404: 'Not Found' };
      contexto.linha('HTTP/1.1 ' + codigo + ' ' + textos[codigo]);
      contexto.linha('Server: ' + assinatura);
      contexto.linha('Date: ' + new Date().toUTCString());
      contexto.linha('Content-Type: text/html');
      contexto.linha('Content-Length: ' + corpo.length);
      contexto.linha('Connection: keep-alive');
      contexto.linha();
      return 0;
    }
    contexto.escrever(corpo);
    return 0;
  }

  /** O servidor web roda como www-data: se ele não puder ler o arquivo, a resposta é 403. */
  private responder(caminho: string, servidor: string, contexto: Contexto): [number, string] {
    const wwwData: Credencial = { uid: 33, gids: [33] };
    const assinatura: string = servidor === 'nginx' ? 'nginx/1.24.0 (Ubuntu)' : 'Apache/2.4.58 (Ubuntu)';
    const pagina = (codigo: number, titulo: string): [number, string] => [codigo,
      '<html>\n<head><title>' + codigo + ' ' + titulo + '</title></head>\n<body>\n<center><h1>' + codigo + ' ' + titulo +
      '</h1></center>\n<hr><center>' + assinatura + '</center>\n</body>\n</html>\n'];
    try {
      let no: No = contexto.fs.localizar('/var/www/html' + caminho, '/', wwwData);
      if (no instanceof Diretorio) {
        const indices: string[] = servidor === 'nginx' ? ['index.html', 'index.htm', 'index.nginx-debian.html'] : ['index.html'];
        const nomeIndice: string | undefined = indices.find((n: string) => (no as Diretorio).obter(n) !== undefined);
        if (nomeIndice === undefined) return pagina(403, 'Forbidden');
        no = contexto.fs.localizar('/var/www/html' + caminho.replace(/\/?$/, '/') + nomeIndice, '/', wwwData);
      }
      if (!contexto.fs.pode(no, wwwData, 'r')) return pagina(403, 'Forbidden');
      return [200, (no as Arquivo).ler()];
    } catch (erro) {
      if (erro instanceof ErroDeSistema && erro.codigo === 'EACCES') return pagina(403, 'Forbidden');
      return pagina(404, 'Not Found');
    }
  }

  private registrar(servidor: string, caminho: string, codigo: number, bytes: number, contexto: Contexto): void {
    const log: No | null = contexto.fs.obter('/var/log/' + servidor + '/access.log');
    const d: Date = new Date();
    const meses: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dois = (n: number): string => String(n).padStart(2, '0');
    const quando: string = dois(d.getDate()) + '/' + meses[d.getMonth()] + '/' + d.getFullYear() + ':' + dois(d.getHours()) + ':' + dois(d.getMinutes()) + ':' + dois(d.getSeconds()) + ' -0300';
    const linha: string = '127.0.0.1 - - [' + quando + '] "GET ' + caminho + ' HTTP/1.1" ' + codigo + ' ' + bytes + ' "-" "curl/8.5.0"\n';
    if (log instanceof Arquivo) {
      log.acrescentar(linha);
    } else if (contexto.fs.obter('/var/log/' + servidor) instanceof Diretorio) {
      contexto.maquina.criarArquivo('/var/log/' + servidor + '/access.log', linha, 0, 4, 0o640);
    }
  }
}

export class Nginx extends Comando {
  public readonly nome: string = 'nginx';
  public readonly resumo: string = 'servidor web: nginx -v (versão) e nginx -t (testa a configuração)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.includes('-v') || args.includes('-V')) {
      contexto.falhar('nginx version: nginx/1.24.0 (Ubuntu)');
      return 0;
    }
    if (args.includes('-t')) {
      if (!contexto.ehRoot()) {
        contexto.falhar('nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)');
        contexto.falhar('nginx: configuration file /etc/nginx/nginx.conf test failed');
        return 1;
      }
      contexto.falhar('nginx: the configuration file /etc/nginx/nginx.conf syntax is ok');
      contexto.falhar('nginx: configuration file /etc/nginx/nginx.conf test is successful');
      return 0;
    }
    contexto.linha('Para iniciar/parar o nginx use o systemd: systemctl start nginx | systemctl status nginx', 'c-info');
    return 1;
  }
}

export class Mysql extends Comando {
  public readonly nome: string = 'mysql';
  public readonly resumo: string = 'cliente do banco MySQL (no simulador: mysql --version)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.includes('--version') || args.includes('-V')) {
      contexto.linha('mysql  Ver 8.0.39-0ubuntu0.24.04.2 for Linux on x86_64 ((Ubuntu))');
      return 0;
    }
    if (!contexto.ehRoot()) {
      contexto.falhar('ERROR 1045 (28000): Access denied for user \'' + contexto.contas.nomeDoUsuario(contexto.credencial.uid) + '\'@\'localhost\' (using password: NO)');
      return 1;
    }
    if (!new Servicos(contexto.maquina).ativo('mysql')) {
      contexto.falhar('ERROR 2002 (HY000): Can\'t connect to local MySQL server through socket \'/var/run/mysqld/mysqld.sock\' (2)');
      return 1;
    }
    contexto.linha('Welcome to the MySQL monitor.  Commands end with ; or \\g.');
    contexto.linha('Server version: 8.0.39-0ubuntu0.24.04.2 (Ubuntu)');
    contexto.linha('(O console SQL não é simulado. No servidor real, você digitaria comandos SQL e sairia com exit.)', 'c-info');
    return 0;
  }
}

export class Python3 extends Comando {
  public readonly nome: string = 'python3';
  public readonly resumo: string = 'interpretador Python (no simulador: python3 --version)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.linha('Python 3.12.3');
    return 0;
  }
}

export class Openssl extends Comando {
  public readonly nome: string = 'openssl';
  public readonly resumo: string = 'ferramentas de criptografia (openssl version mostra a versão instalada)';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const versao: string = new GerenciadorDePacotes(contexto.maquina).versaoInstalada('openssl') ?? '3.0.13';
    contexto.linha('OpenSSL 3.0.13 30 Jan 2024 (pacote ' + versao + ')');
    return 0;
  }
}
