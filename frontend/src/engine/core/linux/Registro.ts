import type { Maquina } from './Maquina';
import { Arquivo, type No } from './No';

const MESES: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 25 11:10:01", o carimbo de tempo clássico do syslog. */
export function carimbo(data: Date = new Date()): string {
  const dois = (n: number): string => String(n).padStart(2, '0');
  return MESES[data.getMonth()] + ' ' + String(data.getDate()).padStart(2, ' ') + ' ' + dois(data.getHours()) + ':' + dois(data.getMinutes()) + ':' + dois(data.getSeconds());
}

/**
 * Escreve uma linha de log como o rsyslog faria: "Sep 25 11:10:01 servidor sshd[1234]: mensagem".
 * syslog = mensagens gerais (serviços); auth.log = logins, sudo, contas; kern.log = kernel.
 */
export function registrar(maquina: Maquina, arquivo: 'syslog' | 'auth.log' | 'kern.log', programa: string, mensagem: string): void {
  const caminho: string = '/var/log/' + arquivo;
  let no: No | null = maquina.fs.obter(caminho);
  if (!(no instanceof Arquivo)) {
    no = maquina.criarArquivo(caminho, '', 0, 4, 0o640);
  }
  (no as Arquivo).acrescentar(carimbo() + ' ' + maquina.hostname + ' ' + programa + ': ' + mensagem + '\n');
}

/** PID "de mentira" para as linhas de log. */
export function pidDeLog(): number {
  return 1000 + Math.floor(Math.random() * 8000);
}
