import { Diretorio, Dispositivo, Link, type Arquivo, type No } from '../../linux/No';
import { ErroDeSistema } from '../../linux/ErroDeSistema';
import { SaidaEmTexto, SaidaParaArquivo } from '../Saida';
import type { Contexto } from '../Contexto';

const MESES: string[] = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "set 25 09:30", como o ls -l do Ubuntu em pt_BR. */
export function dataDoLs(data: Date): string {
  const dia: string = String(data.getDate()).padStart(2, ' ');
  const hora: string = String(data.getHours()).padStart(2, '0') + ':' + String(data.getMinutes()).padStart(2, '0');
  return MESES[data.getMonth()] + ' ' + dia + ' ' + hora;
}

export function dataCompleta(data: Date): string {
  const dois = (n: number): string => String(n).padStart(2, '0');
  return data.getFullYear() + '-' + dois(data.getMonth() + 1) + '-' + dois(data.getDate()) + ' ' +
    dois(data.getHours()) + ':' + dois(data.getMinutes()) + ':' + dois(data.getSeconds()) + '.000000000 -0300';
}

/** Cor que o ls/tree usam: azul para diretório, verde para executável, fundo verde para o /tmp. */
export function classeDoNo(no: No): string {
  if (no instanceof Diretorio) {
    return (no.modo & 0o1002) === 0o1002 ? 'c-sticky' : 'c-dir';
  }
  if (no instanceof Link) {
    return 'c-link';
  }
  if (no instanceof Dispositivo) {
    return 'c-dispositivo';
  }
  return (no.modo & 0o111) !== 0 ? 'c-exe' : '';
}

/** Saída indo para pipe/arquivo? O ls muda de formato (um por linha, sem aspas). */
export function saidaEhTerminal(contexto: Contexto): boolean {
  return !(contexto.saida instanceof SaidaEmTexto) && !(contexto.saida instanceof SaidaParaArquivo);
}

/** Nomes com espaço aparecem entre aspas simples no ls do terminal: 'Área de Trabalho'. */
export function nomeParaExibir(nome: string, contexto: Contexto): string {
  return saidaEhTerminal(contexto) && /[\s'"$*?]/.test(nome) ? "'" + nome + "'" : nome;
}

export function mensagemDe(erro: unknown): string {
  if (erro instanceof ErroDeSistema) {
    return erro.message;
  }
  throw erro;
}

export function simOuNao(resposta: string): boolean {
  return /^[sSyY]/.test(resposta.trim());
}

/** Lê o texto de entrada: dos arquivos citados ou, sem arquivos, do pipe. */
export function lerEntradas(nomeDoComando: string, arquivos: string[], contexto: Contexto): Array<{ nome: string | null; texto: string }> | null {
  if (arquivos.length === 0) {
    return [{ nome: null, texto: contexto.entrada ?? '' }];
  }
  const lidos: Array<{ nome: string | null; texto: string }> = [];
  let falhou: boolean = false;
  for (const caminho of arquivos) {
    try {
      const no: No = contexto.localizar(caminho);
      if (no instanceof Diretorio) {
        contexto.falhar(nomeDoComando + ': ' + caminho + ': É um diretório');
        falhou = true;
        continue;
      }
      if (!contexto.fs.pode(no, contexto.credencial, 'r')) {
        throw new ErroDeSistema('EACCES');
      }
      lidos.push({ nome: caminho, texto: (no as Arquivo).ler() });
    } catch (erro) {
      contexto.falhar(nomeDoComando + ': ' + caminho + ': ' + mensagemDe(erro));
      falhou = true;
    }
  }
  return falhou && lidos.length === 0 ? null : lidos;
}

/** "a\nb\n" → ["a", "b"] (sem a linha vazia do final). */
export function linhasDe(texto: string): string[] {
  if (texto === '') {
    return [];
  }
  const linhas: string[] = texto.split('\n');
  if (linhas[linhas.length - 1] === '') {
    linhas.pop();
  }
  return linhas;
}

export function exigirOperando(nome: string, operandos: string[], contexto: Contexto): boolean {
  if (operandos.length > 0) {
    return true;
  }
  contexto.falhar(nome + ': falta operando');
  contexto.falhar("Tente '" + nome + " --help' para mais informações.");
  return false;
}
