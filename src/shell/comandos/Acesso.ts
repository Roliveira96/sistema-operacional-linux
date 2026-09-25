import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Diretorio, type No } from '../../linux/No';
import { Permissoes } from '../../linux/Permissoes';
import type { Grupo, Usuario } from '../../linux/Contas';
import { mensagemDe } from './util';

/** Aplica uma ação no nó e, com -R, em tudo que estiver dentro dele. */
function percorrer(no: No, caminho: string, recursivo: boolean, acao: (no: No, caminho: string) => boolean): boolean {
  let ok: boolean = acao(no, caminho);
  if (recursivo && no instanceof Diretorio) {
    for (const nome of no.nomesOrdenados()) {
      ok = percorrer(no.obter(nome) as No, caminho.replace(/\/+$/, '') + '/' + nome, true, acao) && ok;
    }
  }
  return ok;
}

export class Chmod extends Comando {
  public readonly nome: string = 'chmod';
  public readonly resumo: string = 'muda as permissões: chmod 755 arq  |  chmod u+x,g-w arq  |  -R recursivo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const flags: Set<string> = new Set();
    const resto: string[] = [];
    for (const arg of args) {
      if (/^-[Rvcf]+$/.test(arg) || arg === '--recursive' || arg === '--verbose') {
        for (const letra of arg === '--recursive' ? 'R' : arg === '--verbose' ? 'v' : arg.substring(1)) flags.add(letra);
      } else {
        resto.push(arg);
      }
    }
    if (resto.length < 2) {
      contexto.falhar(resto.length === 0 ? 'chmod: falta operando' : 'chmod: falta operando após ' + citar(resto[0]));
      contexto.falhar("Tente 'chmod --help' para mais informações.");
      return 1;
    }
    const [expressao, ...caminhos] = resto;
    const octal: number | null = Permissoes.lerOctal(expressao);
    if (octal === null && Permissoes.aplicarSimbolico(0, expressao, false) === null) {
      contexto.falhar('chmod: modo inválido: ' + citar(expressao));
      return 1;
    }

    let status: number = 0;
    for (const caminho of caminhos) {
      let no: No;
      try {
        no = contexto.localizar(caminho);
      } catch (erro) {
        contexto.falhar('chmod: não foi possível acessar ' + citar(caminho) + ': ' + mensagemDe(erro));
        status = 1;
        continue;
      }
      const ok: boolean = percorrer(no, caminho, flags.has('R'), (atual: No, nomeAtual: string): boolean => {
        if (!contexto.ehRoot() && contexto.credencial.uid !== atual.dono) {
          if (!flags.has('f')) {
            contexto.falhar('chmod: alterando as permissões de ' + citar(nomeAtual) + ': Operação não permitida');
          }
          return false;
        }
        const antes: number = atual.modo;
        const depois: number = octal ?? (Permissoes.aplicarSimbolico(antes, expressao, atual.ehDiretorio()) as number);
        atual.modo = depois;
        const mudou: boolean = antes !== depois;
        if (flags.has('v') || (flags.has('c') && mudou)) {
          const descrever = (modo: number): string => Permissoes.paraOctal(modo, true) + ' (' + Permissoes.paraTexto(modo, atual.tipoLs()).substring(1) + ')';
          contexto.linha(mudou
            ? 'o modo de ' + citar(nomeAtual) + ' foi alterado de ' + descrever(antes) + ' para ' + descrever(depois)
            : 'o modo de ' + citar(nomeAtual) + ' foi mantido como ' + descrever(antes));
        }
        return true;
      });
      if (!ok) status = 1;
    }
    return status;
  }
}

/** Lógica comum de chown e chgrp: quem pode mudar o quê. */
abstract class MudancaDePosse extends Comando {
  protected aplicar(caminhos: string[], novoDono: Usuario | null, novoGrupo: Grupo | null, opcoes: Opcoes, contexto: Contexto): number {
    let status: number = 0;
    for (const caminho of caminhos) {
      let no: No;
      try {
        no = contexto.localizar(caminho);
      } catch (erro) {
        contexto.falhar(this.nome + ': não foi possível acessar ' + citar(caminho) + ': ' + mensagemDe(erro));
        status = 1;
        continue;
      }
      const ok: boolean = percorrer(no, caminho, opcoes.tem('R'), (atual: No, nomeAtual: string): boolean => {
        const trocaDono: boolean = novoDono !== null && novoDono.uid !== atual.dono;
        if (!contexto.ehRoot()) {
          // Só o root pode dar um arquivo para outra pessoa.
          if (trocaDono) {
            contexto.falhar(this.nome + ': alterando o dono de ' + citar(nomeAtual) + ': Operação não permitida');
            return false;
          }
          // O dono pode trocar o grupo, mas só para um grupo do qual ele faz parte.
          if (novoGrupo !== null && (contexto.credencial.uid !== atual.dono || !contexto.credencial.gids.includes(novoGrupo.gid))) {
            contexto.falhar(this.nome + ': alterando o grupo de ' + citar(nomeAtual) + ': Operação não permitida');
            return false;
          }
        }
        const soGrupo: boolean = novoDono === null;
        const descrever = (): string => soGrupo ? contexto.contas.nomeDoGrupo(atual.grupo)
          : contexto.contas.nomeDoUsuario(atual.dono) + ':' + contexto.contas.nomeDoGrupo(atual.grupo);
        const antes: string = descrever();
        if (novoDono !== null) atual.dono = novoDono.uid;
        if (novoGrupo !== null) atual.grupo = novoGrupo.gid;
        const depois: string = descrever();
        if (opcoes.tem('v') || (opcoes.tem('c') && antes !== depois)) {
          const oQue: string = soGrupo ? 'o grupo de ' : 'o dono de ';
          contexto.linha(antes !== depois
            ? oQue + citar(nomeAtual) + ' foi alterado de ' + antes + ' para ' + depois
            : oQue + citar(nomeAtual) + ' foi mantido como ' + depois);
        }
        return true;
      });
      if (!ok) status = 1;
    }
    return status;
  }
}

export class Chown extends MudancaDePosse {
  public readonly nome: string = 'chown';
  public readonly resumo: string = 'muda o dono (e o grupo): chown maria arq  |  chown maria:dev arq  |  -R recursivo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { recursive: 'R', verbose: 'v', changes: 'c' });
    if (opcoes.operandos.length < 2) {
      contexto.falhar(opcoes.operandos.length === 0 ? 'chown: falta operando' : 'chown: falta operando após ' + citar(opcoes.operandos[0]));
      contexto.falhar("Tente 'chown --help' para mais informações.");
      return 1;
    }
    const [especificacao, ...caminhos] = opcoes.operandos;
    const [parteDono, parteGrupo] = especificacao.split(/[:.]/);
    const temSeparador: boolean = /[:.]/.test(especificacao);
    let dono: Usuario | null = null;
    let grupo: Grupo | null = null;
    if (parteDono !== '') {
      dono = contexto.contas.acharUsuario(parteDono) ?? null;
      if (dono === null) {
        contexto.falhar('chown: usuário inválido: ' + citar(especificacao));
        return 1;
      }
    }
    if (temSeparador) {
      if (parteGrupo === '' || parteGrupo === undefined) {
        // "maria:" = maria e o grupo principal dela
        grupo = dono !== null ? contexto.contas.grupoPorGid(dono.gid) ?? null : null;
      } else {
        grupo = contexto.contas.acharGrupo(parteGrupo) ?? null;
        if (grupo === null) {
          contexto.falhar('chown: grupo inválido: ' + citar(especificacao));
          return 1;
        }
      }
    }
    return this.aplicar(caminhos, dono, grupo, opcoes, contexto);
  }
}

export class Chgrp extends MudancaDePosse {
  public readonly nome: string = 'chgrp';
  public readonly resumo: string = 'muda só o grupo: chgrp dev arq  |  -R recursivo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { recursive: 'R', verbose: 'v', changes: 'c' });
    if (opcoes.operandos.length < 2) {
      contexto.falhar(opcoes.operandos.length === 0 ? 'chgrp: falta operando' : 'chgrp: falta operando após ' + citar(opcoes.operandos[0]));
      contexto.falhar("Tente 'chgrp --help' para mais informações.");
      return 1;
    }
    const [nomeGrupo, ...caminhos] = opcoes.operandos;
    const grupo: Grupo | undefined = contexto.contas.acharGrupo(nomeGrupo);
    if (grupo === undefined) {
      contexto.falhar('chgrp: grupo inválido: ' + citar(nomeGrupo));
      return 1;
    }
    return this.aplicar(caminhos, null, grupo, opcoes, contexto);
  }
}

export class Umask extends Comando {
  public readonly nome: string = 'umask';
  public readonly resumo: string = 'mostra/define a máscara que tira permissões dos arquivos novos (padrão 0002 ou 0022)';
  public readonly embutido: boolean = true;

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const simbolico: boolean = args.includes('-S');
    const valor: string | undefined = args.find((a: string) => a !== '-S');
    if (valor === undefined) {
      const mascara: number = contexto.quadro.umask;
      contexto.linha(simbolico ? Permissoes.paraSimbolicoCompleto(0o777 & ~mascara) : Permissoes.paraOctal(mascara, true));
      return 0;
    }
    const lido: number | null = Permissoes.lerOctal(valor);
    if (lido === null || lido > 0o777) {
      contexto.falhar('bash: umask: ' + valor + ': número octal fora do intervalo');
      return 1;
    }
    contexto.quadro.umask = lido;
    return 0;
  }
}
