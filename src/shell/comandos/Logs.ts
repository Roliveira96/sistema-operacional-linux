import { Comando } from '../Comando';
import type { Contexto } from '../Contexto';
import { Arquivo, type No } from '../../linux/No';
import { registrar } from '../../linux/Registro';
import { linhasDe } from './util';

/** Linhas do "journal": o simulador junta syslog, auth.log e kern.log em ordem de horário. */
function lerJornal(contexto: Contexto): string[] {
  const linhas: Array<[string, number, string]> = [];
  let ordem: number = 0;
  for (const caminho of ['/var/log/kern.log', '/var/log/syslog', '/var/log/auth.log']) {
    const no: No | null = contexto.fs.obter(caminho);
    if (!(no instanceof Arquivo)) continue;
    for (const linha of linhasDe(no.ler())) linhas.push([linha.substring(0, 15), ordem++, linha]);
  }
  return linhas.sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0].localeCompare(b[0])).map(([, , linha]) => linha);
}

export class Journalctl extends Comando {
  public readonly nome: string = 'journalctl';
  public readonly resumo: string = 'lê os logs do systemd: journalctl -u nginx | -n 20 | -f (acompanha) | -p err (só erros) | -k (kernel)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let unidade: string | null = null;
    let quantidade: number | null = null;
    let seguir: boolean = false;
    let erros: boolean = false;
    let kernel: boolean = false;
    let invertido: boolean = false;
    for (let i: number = 0; i < args.length; i++) {
      const a: string = args[i];
      if (a === '-u' || a === '--unit') unidade = (args[++i] ?? '').replace(/\.service$/, '');
      else if (a.startsWith('-u')) unidade = a.substring(2).replace(/\.service$/, '');
      else if (a === '-n' || a === '--lines') quantidade = Number(args[++i] ?? '10');
      else if (/^-n\d+$/.test(a)) quantidade = Number(a.substring(2));
      else if (a === '-f' || a === '--follow') seguir = true;
      else if (a === '-p' || a === '--priority') { const p: string = args[++i] ?? ''; erros = ['err', 'error', '3', 'crit', 'alert', 'emerg', '0', '1', '2', 'warning', '4'].includes(p); }
      else if (a === '-k' || a === '--dmesg') kernel = true;
      else if (a === '-r' || a === '--reverse') invertido = true;
      else if (a === '-e') quantidade = quantidade ?? 20;
    }
    const podeTudo: boolean = contexto.ehRoot() || contexto.credencial.gids.includes(4);
    const filtrar = (linhas: string[]): string[] => linhas.filter((linha: string) => {
      if (!podeTudo) return false;
      if (kernel && !/ kernel: /.test(linha)) return false;
      if (unidade !== null) {
        const nome: string = unidade === 'ssh' || unidade === 'sshd' ? '(ssh|sshd)' : unidade;
        if (!new RegExp(' ' + nome + '(\\[\\d+\\])?:| ' + nome + '\\.service', 'i').test(linha)) return false;
      }
      if (erros && !/error|fail|denied|refused|critical|segfault/i.test(linha)) return false;
      return true;
    });
    let linhas: string[] = filtrar(lerJornal(contexto));
    if (!podeTudo) {
      contexto.linha('Hint: You are currently not seeing messages from other users and the system.');
      contexto.linha("      Users in groups 'adm', 'systemd-journal' can see all messages.");
      contexto.linha("      Pass -q to turn off this notice.");
      contexto.linha('-- No entries --');
      return 0;
    }
    if (quantidade !== null || seguir) linhas = linhas.slice(-(quantidade ?? 10));
    if (invertido) linhas.reverse();
    if (linhas.length === 0) {
      contexto.linha('-- No entries --');
    } else {
      for (const linha of linhas) contexto.linha(linha, /error|fail|denied/i.test(linha) ? 'c-erro' : undefined);
    }
    if (!seguir) return 0;
    let vistas: number = lerJornal(contexto).length;
    while (await contexto.dormir(400)) {
      const todas: string[] = lerJornal(contexto);
      if (todas.length > vistas) {
        for (const linha of filtrar(todas.slice(vistas))) contexto.linha(linha, /error|fail|denied/i.test(linha) ? 'c-erro' : undefined);
        vistas = todas.length;
      }
    }
    return 0;
  }
}

export class Dmesg extends Comando {
  public readonly nome: string = 'dmesg';
  public readonly resumo: string = 'mensagens do kernel (hardware, discos, drivers). No Ubuntu, só root: sudo dmesg';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (!contexto.ehRoot()) {
      contexto.falhar('dmesg: falha ao ler o buffer do kernel: Operação não permitida');
      return 1;
    }
    const humano: boolean = args.includes('-T') || args.includes('-H');
    const mensagens: Array<[number, string]> = [
      [0.0, 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-115) (gcc 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC'],
      [0.0, 'Command line: BOOT_IMAGE=/vmlinuz-6.8.0-45-generic root=/dev/sda2 ro'],
      [0.21, 'Memory: 3921500K/4193784K available'],
      [0.52, 'smpboot: CPU0: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz'],
      [1.88, 'sd 2:0:0:0: [sda] 52428800 512-byte logical blocks: (26.8 GB/25.0 GiB)'],
      [1.9, ' sda: sda1 sda2'],
      [2.45, 'EXT4-fs (sda2): mounted filesystem 5a1c1b2e-0f4d-4a8e-9b6c-2d7e3f8a9b0c ro with ordered data mode'],
      [4.12, 'e1000 0000:00:03.0 enp0s3: renamed from eth0'],
      [5.01, 'e1000: enp0s3 NIC Link is Up 1000 Mbps Full Duplex, Flow Control: RX'],
    ];
    for (const disco of contexto.maquina.discos.listar()) {
      mensagens.push([disco.detectadoEm, 'sd 2:0:1:0: [' + disco.nome + '] ' + disco.tamanhoGb * 2097152 + ' 512-byte logical blocks: (' + (disco.tamanhoGb * 1.074).toFixed(2) + ' GB/' + disco.tamanhoGb + '.00 GiB)']);
      mensagens.push([disco.detectadoEm + 0.01, 'sd 2:0:1:0: [' + disco.nome + '] Attached SCSI disk']);
    }
    const kern: No | null = contexto.fs.obter('/var/log/kern.log');
    let segundo: number = 5230;
    if (kern instanceof Arquivo) {
      for (const linha of linhasDe(kern.ler())) {
        const texto: string | undefined = linha.split(' kernel: ')[1];
        if (texto !== undefined && !texto.startsWith('[    0.000000]')) mensagens.push([segundo++, texto.replace(/^\[[\s\d.]+\]\s*/, '')]);
      }
    }
    for (const [tempo, texto] of mensagens.sort((a, b) => a[0] - b[0])) {
      const quando: string = humano ? '[' + new Date(Date.now() - (5231 - tempo) * 1000).toString().substring(0, 24) + ']' : '[' + tempo.toFixed(6).padStart(12) + ']';
      contexto.linha(quando + ' ' + texto);
    }
    return 0;
  }
}

export class Logger extends Comando {
  public readonly nome: string = 'logger';
  public readonly resumo: string = 'escreve uma mensagem no log do sistema (syslog): logger "backup concluído"';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let etiqueta: string = contexto.contas.nomeDoUsuario(contexto.credencial.uid);
    const palavras: string[] = [];
    for (let i: number = 0; i < args.length; i++) {
      if (args[i] === '-t') etiqueta = args[++i] ?? etiqueta;
      else if (args[i] === '-p') i++;
      else palavras.push(args[i]);
    }
    const mensagem: string = palavras.length > 0 ? palavras.join(' ') : (contexto.entrada ?? '').trim();
    if (mensagem === '') return 0;
    registrar(contexto.maquina, 'syslog', etiqueta, mensagem);
    return 0;
  }
}
