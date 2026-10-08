import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import type { Maquina } from '../../linux/Maquina';
import { Servicos } from '../../linux/Pacotes';
import { SINAIS, numeroDoSinal, type Processo } from '../../linux/Processos';
import type { Job, Sessao } from '../../linux/Sessao';
import { Arquivo } from '../../linux/No';
import { Interpretador } from '../Interpretador';
import { SaidaParaArquivo, type Saida } from '../Saida';
import { saidaEhTerminal } from './util';

/** Uma linha do ps: processo de sistema, serviço, sessão SSH ou comando de usuário. */
export interface LinhaDeProcesso {
  pid: number;
  ppid: number;
  usuario: string;
  tty: string;
  estado: string;
  comando: string;
  inicio: Date;
  cpu: number;
  mem: number;
  /** O que acontece se receber um sinal que encerra. */
  tipo: 'sistema' | 'servico' | 'sshd' | 'shell' | 'usuario';
  servico?: string;
  sessao?: Sessao;
  processo?: Processo;
}

const INICIO_DO_SISTEMA: Date = new Date(Date.now() - 5231 * 1000);

export function listarProcessos(maquina: Maquina): LinhaDeProcesso[] {
  const linhas: LinhaDeProcesso[] = [];
  const sistema: Array<[number, string, string]> = [
    [1, 'root', '/sbin/init'], [2, 'root', '[kthreadd]'], [312, 'root', '/usr/lib/systemd/systemd-journald'],
    [355, 'root', '/usr/lib/systemd/systemd-udevd'], [512, 'systemd+', '/usr/lib/systemd/systemd-resolved'],
    [640, 'root', '/usr/lib/systemd/systemd-logind'],
  ];
  for (const [pid, usuario, comando] of sistema) {
    linhas.push({ pid, ppid: pid === 1 ? 0 : pid === 2 ? 0 : 1, usuario, tty: '?', estado: 'Ss', comando, inicio: INICIO_DO_SISTEMA, cpu: 0, mem: 0.3, tipo: 'sistema' });
  }
  const servicos: Servicos = new Servicos(maquina);
  for (const nome of servicos.listar().filter((n: string) => servicos.ativo(n))) {
    const base: number = servicos.pid(nome);
    servicos.processos(nome).forEach((comando: string, i: number) => {
      const usuario: string = i > 0 && (nome === 'nginx' || nome === 'apache2') ? 'www-data' : nome === 'mysql' ? 'mysql' : 'root';
      linhas.push({
        pid: base + i, ppid: i === 0 ? 1 : base, usuario, tty: '?', estado: i === 0 ? 'Ss' : 'S', comando,
        inicio: servicos.desde(nome) ?? INICIO_DO_SISTEMA, cpu: 0, mem: nome === 'mysql' ? 9.8 : 0.2, tipo: 'servico', servico: nome,
      });
    });
  }
  const sshd: number = servicos.pid('ssh');
  for (const sessao of maquina.listarSessoes()) {
    const conexao: string = sessao.usuarioDaConexao();
    linhas.push({ pid: sessao.pidSshd, ppid: sshd, usuario: conexao, tty: '?', estado: 'S', comando: 'sshd: ' + conexao + '@' + sessao.tty,
      inicio: new Date(), cpu: 0, mem: 0.2, tipo: 'sshd', sessao });
    sessao.listarQuadros().forEach((quadro, i: number) => {
      linhas.push({ pid: quadro.pid, ppid: sessao.pidSshd, usuario: quadro.usuario.nome, tty: sessao.tty, estado: 'Ss',
        comando: i === 0 ? '-bash' : '-bash', inicio: new Date(), cpu: 0, mem: 0.1, tipo: 'shell', sessao });
    });
  }
  for (const processo of maquina.processos.listar()) {
    linhas.push({
      pid: processo.pid, ppid: processo.pai?.pid ?? processo.sessao?.atual().pid ?? 1, usuario: maquina.contas.nomeDoUsuario(processo.uid),
      tty: processo.nohup && processo.sessao !== null && !maquina.listarSessoes().includes(processo.sessao) ? '?' : processo.tty,
      estado: processo.estado() + (processo.nohup ? 'N' : ''), comando: processo.comando, inicio: processo.inicio, cpu: 0, mem: 0.1,
      tipo: 'usuario', processo,
    });
  }
  return linhas.sort((a, b) => a.pid - b.pid);
}

function hora(data: Date): string {
  return String(data.getHours()).padStart(2, '0') + ':' + String(data.getMinutes()).padStart(2, '0');
}

export class Ps extends Comando {
  public readonly nome: string = 'ps';
  public readonly resumo: string = 'lista processos: ps (os seus), ps aux (todos, com usuário), ps -ef (com o pai)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const bsd: boolean = args.some((a: string) => /^[aux]+$/.test(a));
    const opcoes: Opcoes = Opcoes.ler(args.filter((a: string) => !/^[aux]+$/.test(a)), 'upC', { user: 'u', pid: 'p' });
    let linhas: LinhaDeProcesso[] = listarProcessos(contexto.maquina);
    const usuario: string | undefined = opcoes.valor('u');
    const pids: string | undefined = opcoes.valor('p');
    const nomeCmd: string | undefined = opcoes.valor('C');
    if (usuario !== undefined) linhas = linhas.filter((l) => l.usuario === usuario);
    if (pids !== undefined) linhas = linhas.filter((l) => pids.split(',').includes(String(l.pid)));
    if (nomeCmd !== undefined) linhas = linhas.filter((l) => l.comando.split(' ')[0].split('/').pop()?.replace(/^-/, '') === nomeCmd);
    if (bsd) {
      contexto.linha('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
      for (const l of linhas) {
        contexto.linha(l.usuario.padEnd(8).substring(0, 8) + ' ' + String(l.pid).padStart(7) + ' ' + l.cpu.toFixed(1).padStart(4) + ' ' + l.mem.toFixed(1).padStart(4) + ' ' +
          String(l.tipo === 'sistema' && l.pid === 2 ? 0 : 10000 + l.pid * 7 % 90000).padStart(6) + ' ' + String(l.tipo === 'sistema' && l.pid === 2 ? 0 : 4000 + l.pid % 6000).padStart(5) + ' ' +
          l.tty.padEnd(8) + ' ' + l.estado.padEnd(4) + ' ' + hora(l.inicio) + '   0:00 ' + l.comando);
      }
      return 0;
    }
    if (opcoes.tem('e') || opcoes.tem('f') || usuario !== undefined || pids !== undefined || nomeCmd !== undefined) {
      contexto.linha('UID          PID    PPID  C STIME TTY          TIME CMD');
      for (const l of linhas) {
        contexto.linha(l.usuario.padEnd(8).substring(0, 8) + ' ' + String(l.pid).padStart(7) + ' ' + String(l.ppid).padStart(7) + '  0 ' + hora(l.inicio) + ' ' +
          l.tty.padEnd(8) + '     00:00:00 ' + l.comando);
      }
      return 0;
    }
    // sem opções: só o que está no seu terminal
    contexto.linha('    PID TTY          TIME CMD');
    for (const l of linhas.filter((x) => x.tty === contexto.sessao.tty)) {
      contexto.linha(String(l.pid).padStart(7) + ' ' + l.tty.padEnd(8) + '     00:00:00 ' + l.comando.replace(/^-/, '').split(' ')[0].split('/').pop());
    }
    return 0;
  }
}

export class Top extends Comando {
  public readonly nome: string = 'top';
  public readonly resumo: string = 'monitor de processos (CPU, memória, carga). No real, atualiza ao vivo e sai com q';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    const linhas: LinhaDeProcesso[] = listarProcessos(contexto.maquina);
    const agora: Date = new Date();
    const usuarios: number = new Set(contexto.maquina.usuariosNasConexoes()).size;
    contexto.linha('top - ' + hora(agora) + ':' + String(agora.getSeconds()).padStart(2, '0') + ' up  1:27,  ' + usuarios + ' users,  load average: 0,08, 0,03, 0,01');
    contexto.linha('Tarefas: ' + (linhas.length + 90) + ' total,   1 executando, ' + (linhas.length + 89) + ' dormindo,   0 parado,   0 zumbi');
    contexto.linha('%CPU(s):  1,3 us,  0,7 sis,  0,0 ni, 97,9 oc,  0,1 ag,  0,0 ih,  0,0 is,  0,0 tr');
    contexto.linha('MiB Mem :   3921,5 total,   1940,8 livre,   1128,4 usados,   1055,6 buff/cache');
    contexto.linha('MiB Swap:   2048,0 total,   2048,0 livre,      0,0 usados.   2776,5 mem dispon.');
    contexto.linha();
    contexto.linha('    PID USUARIO   PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TEMPO+ COMANDO', 'c-negrito');
    for (const l of linhas.slice().sort((a, b) => b.mem - a.mem)) {
      const nome: string = l.comando.replace(/^-/, '').split(' ')[0].split('/').pop() ?? l.comando;
      contexto.linha(String(l.pid).padStart(7) + ' ' + l.usuario.padEnd(8).substring(0, 8) + '  20   0 ' + String(12000 + l.pid * 13 % 90000).padStart(7) + ' ' +
        String(4000 + l.pid % 9000).padStart(6) + ' ' + String(3000 + l.pid % 5000).padStart(6) + ' ' + l.estado.charAt(0) + '   ' +
        l.cpu.toFixed(1).padStart(4) + '  ' + l.mem.toFixed(1).padStart(4) + '    0:00.' + String(l.pid % 100).padStart(2, '0') + ' ' + nome);
    }
    contexto.linha('(No servidor real o top fica atualizando: q sai, k mata um processo, M ordena por memória. Aqui é uma foto.)', 'c-info');
    return 0;
  }
}

/** Resolve "%1" (job) ou "2451" (PID) numa linha do ps. */
function alvo(texto: string, contexto: Contexto, linhas: LinhaDeProcesso[]): LinhaDeProcesso | 'job-inexistente' | null {
  if (texto.startsWith('%')) {
    const job: Job | undefined = acharJob(texto, contexto.sessao);
    if (job === undefined) return 'job-inexistente';
    return linhas.find((l) => l.processo === job.processo) ?? null;
  }
  return linhas.find((l) => l.pid === Number(texto)) ?? null;
}

function acharJob(texto: string | undefined, sessao: Sessao): Job | undefined {
  if (texto === undefined || texto === '%' || texto === '%+' || texto === '%%') return sessao.jobs[sessao.jobs.length - 1];
  const numero: number = Number(texto.replace(/^%/, ''));
  return sessao.jobs.find((j: Job) => j.numero === numero);
}

/** Entrega o sinal respeitando as permissões e o tipo de processo. Devolve a mensagem de erro, ou null. */
function sinalizar(linha: LinhaDeProcesso, sinal: number, contexto: Contexto): string | null {
  const dono: boolean = contexto.ehRoot() || linha.usuario === contexto.contas.nomeDoUsuario(contexto.credencial.uid);
  if (!dono) return 'Operação não permitida';
  if (sinal === 0) return null;
  const encerra: boolean = [1, 2, 3, 9, 15].includes(sinal);
  switch (linha.tipo) {
    case 'usuario':
      linha.processo?.receber(sinal);
      return null;
    case 'servico':
      if (encerra && linha.servico !== undefined && linha.ppid === 1) new Servicos(contexto.maquina).parar(linha.servico);
      return null;
    case 'shell':
    case 'sshd':
      if (encerra && (sinal === 9 || sinal === 1 || linha.tipo === 'sshd')) linha.sessao?.aoEncerrar?.();
      return null;
    default:
      return null; // o systemd (PID 1) ignora
  }
}

export class Kill extends Comando {
  public readonly nome: string = 'kill';
  public readonly resumo: string = 'envia um sinal a um processo: kill PID (educado, 15), kill -9 PID (forçado), kill %1 (job)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args[0] === '-l') {
      contexto.linha(SINAIS.map(([n, nome]) => String(n).padStart(2) + ') SIG' + nome).join('\t'));
      return 0;
    }
    let sinal: number = 15;
    let resto: string[] = args;
    if (args[0] === '-s' && args[1] !== undefined) {
      sinal = numeroDoSinal(args[1]) ?? 15;
      resto = args.slice(2);
    } else if (args[0]?.startsWith('-') && numeroDoSinal(args[0]) !== null) {
      sinal = numeroDoSinal(args[0]) as number;
      resto = args.slice(1);
    }
    if (resto.length === 0) {
      contexto.falhar('kill: uso: kill [-s sinal | -n num | -sinal] pid | jobspec ... ou kill -l [sinal]');
      return 2;
    }
    let status: number = 0;
    const linhas: LinhaDeProcesso[] = listarProcessos(contexto.maquina);
    for (const texto of resto) {
      const achado = alvo(texto, contexto, linhas);
      if (achado === 'job-inexistente') {
        contexto.falhar('bash: kill: ' + texto + ': não há tal job');
        status = 1;
        continue;
      }
      if (achado === null) {
        contexto.falhar('bash: kill: (' + texto + ') - Processo inexistente');
        status = 1;
        continue;
      }
      const erro: string | null = sinalizar(achado, sinal, contexto);
      if (erro !== null) {
        contexto.falhar('bash: kill: (' + achado.pid + ') - ' + erro);
        status = 1;
      }
    }
    return status;
  }
}

/** killall NOME e pkill PADRÃO / pkill -u USUÁRIO. */
export class Killall extends Comando {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'killall' | 'pkill' | 'pgrep') {
    super();
    this.nome = nome;
    this.resumo = nome === 'killall' ? 'mata todos os processos com esse nome: killall sleep'
      : nome === 'pkill' ? 'mata por padrão ou por usuário: pkill sleep | pkill -u maria (derruba a maria)'
        : 'mostra os PIDs dos processos: pgrep nginx | pgrep -u maria -l';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let sinal: number = 15;
    const limpos: string[] = [];
    for (const arg of args) {
      if (/^-\d+$/.test(arg) || /^-[A-Z]+$/.test(arg)) sinal = numeroDoSinal(arg) ?? 15;
      else limpos.push(arg);
    }
    const opcoes: Opcoes = Opcoes.ler(limpos, 'us', { user: 'u', signal: 's' });
    if (opcoes.valor('s') !== undefined) sinal = numeroDoSinal(opcoes.valor('s') as string) ?? 15;
    const usuario: string | undefined = opcoes.valor('u');
    const padrao: string | undefined = opcoes.operandos[0];
    if (usuario === undefined && padrao === undefined) {
      contexto.falhar(this.nome + ': nenhum critério de correspondência especificado');
      return 2;
    }
    const nomeDe = (l: LinhaDeProcesso): string => l.comando.replace(/^-/, '').replace(/^sshd: .*/, 'sshd').split(' ')[0].split('/').pop() ?? '';
    const linhas: LinhaDeProcesso[] = listarProcessos(contexto.maquina).filter((l) => {
      if (usuario !== undefined && l.usuario !== usuario) return false;
      if (padrao === undefined) return l.tipo !== 'sistema';
      return this.nome === 'killall' ? nomeDe(l) === padrao : nomeDe(l).includes(padrao);
    });
    if (linhas.length === 0) {
      if (this.nome === 'killall') contexto.falhar(padrao + ': nenhum processo encontrado');
      return 1;
    }
    if (this.nome === 'pgrep') {
      for (const l of linhas) contexto.linha(opcoes.tem('l') ? l.pid + ' ' + nomeDe(l) : String(l.pid));
      return 0;
    }
    let status: number = 0;
    // sessões por último, para o comando terminar antes de a própria conexão cair
    for (const l of linhas.sort((a, b) => (a.tipo === 'sshd' ? 1 : 0) - (b.tipo === 'sshd' ? 1 : 0))) {
      if (sinalizar(l, sinal, contexto) !== null) {
        if (this.nome === 'killall') contexto.falhar(nomeDe(l) + '(' + l.pid + '): Operação não permitida');
        status = 1;
      }
    }
    return status;
  }
}

export class Jobs extends Comando {
  public readonly nome: string = 'jobs';
  public readonly resumo: string = 'lista os jobs deste terminal (comandos em segundo plano ou parados)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const jobs: Job[] = contexto.sessao.jobs;
    jobs.forEach((job: Job, i: number) => {
      const marca: string = i === jobs.length - 1 ? '+' : i === jobs.length - 2 ? '-' : ' ';
      const fundo: string = job.estado() === 'Executando' ? ' &' : '';
      contexto.linha('[' + job.numero + ']' + marca + '  ' + (args.includes('-l') ? job.processo.pid + ' ' : '') + job.estado().padEnd(23) + ' ' + job.comando + fundo);
    });
    return 0;
  }
}

export class Fg extends Comando {
  public readonly nome: string = 'fg';
  public readonly resumo: string = 'traz um job para o primeiro plano: fg %1';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const job: Job | undefined = acharJob(args[0], contexto.sessao);
    if (job === undefined) {
      contexto.falhar('bash: fg: ' + (args[0] ?? 'atual') + ': não há tal job');
      return 1;
    }
    contexto.linha(job.comando);
    job.emPrimeiroPlano = true;
    job.processo.receber(18);
    const sessao: Sessao = contexto.sessao;
    sessao.primeiroPlano.push(job.processo);
    try {
      const resultado: number | 'suspenso' = await Promise.race([job.promessa as Promise<number>, job.processo.suspensao()]);
      if (resultado === 'suspenso') {
        job.emPrimeiroPlano = false;
        contexto.falhar('\n[' + job.numero + ']+  Parado                  ' + job.comando);
        return 148;
      }
      return resultado;
    } finally {
      const i: number = sessao.primeiroPlano.indexOf(job.processo);
      if (i >= 0) sessao.primeiroPlano.splice(i, 1);
    }
  }
}

export class Bg extends Comando {
  public readonly nome: string = 'bg';
  public readonly resumo: string = 'continua em segundo plano um job parado com Ctrl+Z: bg %1';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const job: Job | undefined = acharJob(args[0], contexto.sessao);
    if (job === undefined) {
      contexto.falhar('bash: bg: ' + (args[0] ?? 'atual') + ': não há tal job');
      return 1;
    }
    job.processo.receber(18);
    contexto.linha('[' + job.numero + ']+ ' + job.comando + ' &');
    return 0;
  }
}

export class Wait extends Comando {
  public readonly nome: string = 'wait';
  public readonly resumo: string = 'espera os jobs em segundo plano terminarem (útil em scripts)';
  public readonly embutido: boolean = true;

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    for (const job of contexto.sessao.jobs.slice()) {
      await job.promessa;
    }
    return 0;
  }
}

export class Nohup extends Comando {
  public readonly nome: string = 'nohup';
  public readonly resumo: string = 'roda um comando que continua mesmo depois que você sair: nohup comando &';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.falhar('nohup: falta operando');
      return 125;
    }
    if (contexto.processo !== null) contexto.processo.nohup = true;
    let saida: Saida = contexto.saida;
    if (saidaEhTerminal(contexto)) {
      try {
        const arquivo: Arquivo = Interpretador.abrirParaEscrita('nohup.out', false, contexto.maquina, contexto.sessao, contexto.credencial);
        saida = new SaidaParaArquivo(arquivo);
        contexto.falhar("nohup: ignorando entrada e anexando saída a 'nohup.out'");
      } catch {
        contexto.falhar("nohup: ignorando entrada e anexando saída a '/dev/null'");
      }
    }
    return contexto.executor.executarArgs(args, contexto.com({ saida, erro: saida, entrada: null }));
  }
}

export class Uptime extends Comando {
  public readonly nome: string = 'uptime';
  public readonly resumo: string = 'há quanto tempo o servidor está ligado, quantos usuários e a carga';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.includes('-p')) {
      contexto.linha('up 1 hour, 27 minutes');
      return 0;
    }
    const agora: Date = new Date();
    const usuarios: number = contexto.maquina.usuariosNasConexoes().length;
    contexto.linha(' ' + hora(agora) + ':' + String(agora.getSeconds()).padStart(2, '0') + ' up  1:27,  ' + usuarios + ' user' + (usuarios === 1 ? '' : 's') + ',  load average: 0,08, 0,03, 0,01');
    return 0;
  }
}
