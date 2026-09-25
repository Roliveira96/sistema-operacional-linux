import { Comando, Opcoes, citar } from '../Comando';
import type { Contexto } from '../Contexto';
import { Acl, Diretorio, type No } from '../../linux/No';
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
        let depois: number = octal ?? (Permissoes.aplicarSimbolico(antes, expressao, atual.ehDiretorio()) as number);
        // chmod 755 numa pasta mantém SUID/SGID (só some com 4 dígitos, ex.: 0755)
        if (octal !== null && atual.ehDiretorio() && expressao.length <= 3) depois |= antes & (Permissoes.SUID | Permissoes.SGID);
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

function textoPerms(p: number): string {
  return ((p & 4) ? 'r' : '-') + ((p & 2) ? 'w' : '-') + ((p & 1) ? 'x' : '-');
}

function lerPerms(texto: string): number | null {
  if (/^[0-7]$/.test(texto)) return Number(texto);
  if (!/^[rwxX-]{0,3}$/.test(texto)) return null;
  return (texto.includes('r') ? 4 : 0) | (texto.includes('w') ? 2 : 0) | (/[xX]/.test(texto) ? 1 : 0);
}

export class Setfacl extends Comando {
  public readonly nome: string = 'setfacl';
  public readonly resumo: string = 'permissão para um usuário/grupo específico: setfacl -m u:maria:rw arq | -x u:maria | -b (remove tudo)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let recursivo: boolean = false;
    const acoes: Array<['m' | 'x' | 'b', string]> = [];
    const caminhos: string[] = [];
    for (let i: number = 0; i < args.length; i++) {
      const arg: string = args[i];
      if (arg === '-R') recursivo = true;
      else if (arg === '-b' || arg === '-k') acoes.push(['b', '']);
      else if (arg === '-m' || arg === '-x') acoes.push([arg.charAt(1) as 'm' | 'x', args[++i] ?? '']);
      else if (/^-R?[mx]$/.test(arg)) { recursivo = arg.includes('R'); acoes.push([arg.slice(-1) as 'm' | 'x', args[++i] ?? '']); }
      else if (arg === '-d') {
        contexto.falhar('setfacl: ACL padrão (-d) não é simulada; aplique a ACL nos arquivos (use -R).');
        return 1;
      } else caminhos.push(arg);
    }
    if (acoes.length === 0 || caminhos.length === 0) {
      contexto.falhar('Uso: setfacl [-R] {-m|-x} u:USUÁRIO:rwx|g:GRUPO:rwx ARQUIVO... | setfacl -b ARQUIVO');
      return 2;
    }
    let status: number = 0;
    for (const caminho of caminhos) {
      let no: No;
      try {
        no = contexto.localizar(caminho);
      } catch (erro) {
        contexto.falhar('setfacl: ' + caminho + ': ' + mensagemDe(erro));
        status = 1;
        continue;
      }
      const ok: boolean = percorrer(no, caminho, recursivo, (atual: No, nomeAtual: string): boolean => {
        if (!contexto.ehRoot() && contexto.credencial.uid !== atual.dono) {
          contexto.falhar('setfacl: ' + nomeAtual + ': Operação não permitida');
          return false;
        }
        for (const [acao, especificacao] of acoes) {
          const erro: string | null = this.aplicar(atual, acao, especificacao, contexto);
          if (erro !== null) {
            contexto.falhar('setfacl: ' + nomeAtual + ': ' + erro);
            return false;
          }
        }
        return true;
      });
      if (!ok) status = 1;
    }
    return status;
  }

  private aplicar(no: No, acao: 'm' | 'x' | 'b', especificacao: string, contexto: Contexto): string | null {
    if (acao === 'b') {
      if (no.acl !== null) no.modo = (no.modo & ~0o070) | (no.acl.grupoDono << 3);
      no.acl = null;
      return null;
    }
    for (const parte of especificacao.split(',')) {
      const [tipoBruto, nome = '', permsTexto = ''] = parte.split(':');
      const tipo: string = tipoBruto.replace(/^user$/, 'u').replace(/^group$/, 'g').replace(/^other$/, 'o').replace(/^mask$/, 'm');
      const perms: number | null = acao === 'm' ? lerPerms(permsTexto) : 0;
      if (perms === null) return 'Argumento inválido perto do caractere 1';
      if (tipo === 'o') { no.modo = (no.modo & ~0o007) | perms; continue; }
      if (tipo === 'u' && nome === '') { no.modo = (no.modo & ~0o700) | (perms << 6); continue; }
      if (no.acl === null) {
        if (acao === 'x') continue;
        no.acl = new Acl((no.modo >> 3) & 7);
      }
      const acl: Acl = no.acl;
      if (tipo === 'm') { no.modo = (no.modo & ~0o070) | (perms << 3); continue; }
      if (tipo === 'g' && nome === '') { acl.grupoDono = perms; }
      else if (tipo === 'u') {
        const usuario = contexto.contas.acharUsuario(nome);
        if (usuario === undefined) return 'usuário inválido: ' + nome;
        if (acao === 'm') acl.usuarios.set(usuario.uid, perms); else acl.usuarios.delete(usuario.uid);
      } else if (tipo === 'g') {
        const grupo = contexto.contas.acharGrupo(nome);
        if (grupo === undefined) return 'grupo inválido: ' + nome;
        if (acao === 'm') acl.grupos.set(grupo.gid, perms); else acl.grupos.delete(grupo.gid);
      } else {
        return 'tipo de entrada inválido: ' + tipoBruto;
      }
      // a máscara é recalculada sozinha, como no setfacl real
      no.modo = (no.modo & ~0o070) | (acl.mascaraCalculada() << 3);
    }
    if (no.acl !== null && no.acl.vazia()) {
      no.modo = (no.modo & ~0o070) | (no.acl.grupoDono << 3);
      no.acl = null;
    }
    return null;
  }
}

export class Getfacl extends Comando {
  public readonly nome: string = 'getfacl';
  public readonly resumo: string = 'mostra as permissões completas, incluindo a ACL (quem mais tem acesso)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let status: number = 0;
    const caminhos: string[] = args.filter((a) => !a.startsWith('-'));
    caminhos.forEach((caminho: string, indice: number) => {
      let no: No;
      try {
        no = contexto.localizar(caminho);
      } catch (erro) {
        contexto.falhar('getfacl: ' + caminho + ': ' + mensagemDe(erro));
        status = 1;
        return;
      }
      if (indice === 0 && caminho.startsWith('/')) contexto.falhar('getfacl: Removendo "/" inicial dos nomes de caminho');
      contexto.linha('# file: ' + caminho.replace(/^\/+/, ''));
      contexto.linha('# owner: ' + contexto.contas.nomeDoUsuario(no.dono));
      contexto.linha('# group: ' + contexto.contas.nomeDoGrupo(no.grupo));
      const especiais: string = ((no.modo & Permissoes.SUID) ? 's' : '-') + ((no.modo & Permissoes.SGID) ? 's' : '-') + ((no.modo & Permissoes.STICKY) ? 't' : '-');
      if (especiais !== '---') contexto.linha('# flags: ' + especiais);
      contexto.linha('user::' + textoPerms((no.modo >> 6) & 7));
      const mascara: number = (no.modo >> 3) & 7;
      const efetivo = (p: number): string => (p & ~mascara) !== 0 ? '\t\t\t#effective:' + textoPerms(p & mascara) : '';
      if (no.acl !== null) {
        for (const [uid, p] of no.acl.usuarios) contexto.linha('user:' + contexto.contas.nomeDoUsuario(uid) + ':' + textoPerms(p) + efetivo(p));
        contexto.linha('group::' + textoPerms(no.acl.grupoDono) + efetivo(no.acl.grupoDono));
        for (const [gid, p] of no.acl.grupos) contexto.linha('group:' + contexto.contas.nomeDoGrupo(gid) + ':' + textoPerms(p) + efetivo(p));
        contexto.linha('mask::' + textoPerms(mascara));
      } else {
        contexto.linha('group::' + textoPerms(mascara));
      }
      contexto.linha('other::' + textoPerms(no.modo & 7));
      contexto.linha();
    });
    return status;
  }
}
