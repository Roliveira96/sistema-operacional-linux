import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Grupo, Usuario, type Contas } from '../../linux/Contas';
import { Diretorio, type No } from '../../linux/No';
import { SistemaDeArquivos } from '../../linux/SistemaDeArquivos';
import { simOuNao } from './util';
import { pidDeLog, registrar } from '../../linux/Registro';

const NOME_VALIDO: RegExp = /^[a-z_][a-z0-9_-]{0,31}$/;

/** useradd, usermod... só funcionam como root; esta é a mensagem do Ubuntu. */
export function exigirRoot(nome: string, arquivo: string, contexto: Contexto): boolean {
  if (contexto.ehRoot()) {
    return true;
  }
  contexto.falhar(nome + ': Permissão negada.');
  contexto.falhar(nome + ': não foi possível bloquear ' + arquivo + '; tente novamente mais tarde.');
  contexto.falhar('Dica: rode como root (ou com sudo na frente).');
  return false;
}

/** Pede a senha duas vezes, como o passwd. Devolve null se não conferir. */
export async function pedirNovaSenha(contexto: Contexto): Promise<string | null> {
  const primeira: string = await contexto.interacao.perguntar('Nova senha: ', true);
  const segunda: string = await contexto.interacao.perguntar('Redigite a nova senha: ', true);
  if (primeira === '') {
    contexto.falhar('Nenhuma senha foi fornecida.');
    return null;
  }
  if (primeira !== segunda) {
    contexto.falhar('Sinto muito, as senhas não coincidem.');
    return null;
  }
  return primeira;
}

export class Whoami extends Comando {
  public readonly nome: string = 'whoami';
  public readonly resumo: string = 'mostra com qual usuário você está agindo agora';

  public async executar(_args: string[], contexto: Contexto): Promise<number> {
    contexto.linha(contexto.contas.nomeDoUsuario(contexto.credencial.uid));
    return 0;
  }
}

export class Id extends Comando {
  public readonly nome: string = 'id';
  public readonly resumo: string = 'mostra UID, GID e todos os grupos de um usuário';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args);
    let uid: number = contexto.credencial.uid;
    let gids: number[] = contexto.credencial.gids;
    if (opcoes.operandos.length > 0) {
      const usuario: Usuario | undefined = contexto.contas.acharUsuario(opcoes.operandos[0]);
      if (usuario === undefined) {
        contexto.falhar("id: '" + opcoes.operandos[0] + "': usuário inexistente");
        return 1;
      }
      uid = usuario.uid;
      gids = contexto.contas.gidsDe(usuario);
    }
    const contas: Contas = contexto.contas;
    const nomeado = (numero: number, nome: string): string => opcoes.tem('n') ? nome : String(numero);
    if (opcoes.tem('u')) {
      contexto.linha(nomeado(uid, contas.nomeDoUsuario(uid)));
    } else if (opcoes.tem('g')) {
      contexto.linha(nomeado(gids[0], contas.nomeDoGrupo(gids[0])));
    } else if (opcoes.tem('G')) {
      contexto.linha(gids.map((g: number) => nomeado(g, contas.nomeDoGrupo(g))).join(' '));
    } else {
      contexto.linha('uid=' + uid + '(' + contas.nomeDoUsuario(uid) + ') gid=' + gids[0] + '(' + contas.nomeDoGrupo(gids[0]) + ') grupos=' +
        gids.map((g: number) => g + '(' + contas.nomeDoGrupo(g) + ')').join(','));
    }
    return 0;
  }
}

export class Groups extends Comando {
  public readonly nome: string = 'groups';
  public readonly resumo: string = 'lista os grupos de que um usuário participa';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    if (args.length === 0) {
      contexto.linha(contexto.credencial.gids.map((g: number) => contexto.contas.nomeDoGrupo(g)).join(' '));
      return 0;
    }
    let status: number = 0;
    for (const nome of args) {
      const usuario: Usuario | undefined = contexto.contas.usuario(nome);
      if (usuario === undefined) {
        contexto.falhar("groups: '" + nome + "': usuário inexistente");
        status = 1;
        continue;
      }
      contexto.linha(nome + ' : ' + contexto.contas.gidsDe(usuario).map((g: number) => contexto.contas.nomeDoGrupo(g)).join(' '));
    }
    return status;
  }
}

export class Useradd extends Comando {
  public readonly nome: string = 'useradd';
  public readonly resumo: string = 'cria usuário: useradd -m -s /bin/bash maria  (-m cria a home, -G grupos extras)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'sgGdcu', {
      'create-home': 'm', shell: 's', gid: 'g', groups: 'G', home: 'd', comment: 'c', uid: 'u', 'no-create-home': 'M',
    });
    const nome: string | undefined = opcoes.operandos[0];
    if (nome === undefined) {
      contexto.falhar('Uso: useradd [opções] LOGIN');
      contexto.falhar('  -m  cria o diretório pessoal (/home/LOGIN)');
      contexto.falhar('  -s  shell de login (ex.: /bin/bash)');
      contexto.falhar('  -G  grupos suplementares (ex.: -G sudo,dev)');
      contexto.falhar('  -g  grupo primário');
      return 2;
    }
    if (!exigirRoot('useradd', '/etc/passwd', contexto)) return 1;
    if (!NOME_VALIDO.test(nome)) {
      contexto.falhar("useradd: nome de usuário '" + nome + "' inválido (use minúsculas, números, - e _)");
      return 3;
    }
    const contas: Contas = contexto.contas;
    if (contas.usuario(nome) !== undefined) {
      contexto.falhar("useradd: o usuário '" + nome + "' já existe");
      return 9;
    }
    let gidPrimario: number | null = null;
    const nomeGrupo: string | undefined = opcoes.valor('g');
    if (nomeGrupo !== undefined) {
      const grupo: Grupo | undefined = contas.acharGrupo(nomeGrupo);
      if (grupo === undefined) {
        contexto.falhar("useradd: o grupo '" + nomeGrupo + "' não existe");
        return 6;
      }
      gidPrimario = grupo.gid;
    } else if (contas.grupo(nome) !== undefined) {
      contexto.falhar('useradd: o grupo ' + nome + ' existe - se você deseja adicionar este usuário a esse grupo, use -g.');
      return 9;
    }
    const extras: Grupo[] = [];
    for (const nomeExtra of (opcoes.valor('G') ?? '').split(',').filter((g: string) => g !== '')) {
      const grupo: Grupo | undefined = contas.acharGrupo(nomeExtra);
      if (grupo === undefined) {
        contexto.falhar("useradd: o grupo '" + nomeExtra + "' não existe");
        return 6;
      }
      extras.push(grupo);
    }

    const uid: number = opcoes.valor('u') !== undefined ? Number(opcoes.valor('u')) : contas.proximoUid();
    if (gidPrimario === null) {
      gidPrimario = contas.grupoPorGid(uid) === undefined ? uid : contas.proximoGid();
      contas.adicionarGrupo(new Grupo(nome, gidPrimario));
    }
    const usuario: Usuario = new Usuario(nome, uid, gidPrimario, opcoes.valor('d') ?? '/home/' + nome,
      opcoes.valor('s') ?? '/bin/sh', null, opcoes.valor('c') ?? '');
    contas.adicionarUsuario(usuario);
    registrar(contexto.maquina, 'auth.log', 'useradd[' + pidDeLog() + ']', 'new user: name=' + usuario.nome + ', UID=' + usuario.uid + ', GID=' + usuario.gid +
      ', home=' + usuario.home + ', shell=' + usuario.shell + ', from=/dev/' + contexto.sessao.tty);
    for (const grupo of extras) {
      if (!grupo.membros.includes(nome)) grupo.membros.push(nome);
    }
    if (opcoes.tem('m')) {
      if (contexto.fs.obter(usuario.home) !== null) {
        contexto.falhar('useradd: aviso: o diretório pessoal já existe.');
        contexto.falhar('Não copiando nenhum arquivo do diretório skel para ele.');
      } else {
        contexto.maquina.criarHome(usuario);
      }
    }
    return 0;
  }
}

export class Adduser extends Comando {
  public readonly nome: string;
  public readonly resumo: string;

  constructor(nome: 'adduser' | 'addgroup') {
    super();
    this.nome = nome;
    this.resumo = nome === 'adduser'
      ? 'jeito "amigável" do Debian/Ubuntu: cria usuário, grupo, home e já pede a senha. adduser maria sudo põe no grupo'
      : 'cria um grupo (atalho do Debian/Ubuntu para groupadd)';
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args);
    if (opcoes.operandos.length === 0) {
      contexto.falhar('fatal: Apenas um ou dois nomes são permitidos.');
      return 1;
    }
    if (!contexto.ehRoot()) {
      contexto.falhar('fatal: Apenas o root pode adicionar um usuário ou grupo ao sistema.');
      return 1;
    }
    const contas: Contas = contexto.contas;
    if (this.nome === 'addgroup' || opcoes.tem('--group')) {
      return this.criarGrupo(opcoes.operandos[0], contexto);
    }
    if (opcoes.operandos.length === 2) {
      const [nomeUsuario, nomeGrupo] = opcoes.operandos;
      const grupo: Grupo | undefined = contas.grupo(nomeGrupo);
      if (contas.usuario(nomeUsuario) === undefined) {
        contexto.falhar("fatal: O usuário `" + nomeUsuario + "' não existe.");
        return 1;
      }
      if (grupo === undefined) {
        contexto.falhar("fatal: O grupo `" + nomeGrupo + "' não existe.");
        return 1;
      }
      if (grupo.membros.includes(nomeUsuario)) {
        contexto.linha("info: O usuário `" + nomeUsuario + "' já é membro de `" + nomeGrupo + "'.");
        return 0;
      }
      contexto.linha("info: Adicionando usuário `" + nomeUsuario + "' ao grupo `" + nomeGrupo + "' ...");
      grupo.membros.push(nomeUsuario);
      return 0;
    }

    const nome: string = opcoes.operandos[0];
    if (!NOME_VALIDO.test(nome)) {
      contexto.falhar('fatal: Informe um nome de usuário que obedeça às regras (minúsculas, números, - e _).');
      return 1;
    }
    if (contas.usuario(nome) !== undefined) {
      contexto.falhar("fatal: O usuário `" + nome + "' já existe.");
      return 1;
    }
    const uid: number = contas.proximoUid();
    const gid: number = contas.grupoPorGid(uid) === undefined ? uid : contas.proximoGid();
    contexto.linha("info: Adicionando o usuário `" + nome + "' ...");
    contexto.linha('info: Selecionando UID/GID de intervalo 1000 a 59999 ...');
    contexto.linha("info: Adicionando novo grupo `" + nome + "' (" + gid + ') ...');
    contas.adicionarGrupo(new Grupo(nome, gid));
    contexto.linha("info: Adicionando novo usuário `" + nome + "' (" + uid + ") com grupo `" + nome + ' (' + gid + ")' ...");
    const usuario: Usuario = new Usuario(nome, uid, gid, '/home/' + nome, '/bin/bash', null, '');
    contas.adicionarUsuario(usuario);
    registrar(contexto.maquina, 'auth.log', 'useradd[' + pidDeLog() + ']', 'new user: name=' + usuario.nome + ', UID=' + usuario.uid + ', GID=' + usuario.gid +
      ', home=' + usuario.home + ', shell=' + usuario.shell + ', from=/dev/' + contexto.sessao.tty);
    contexto.linha("info: Criando diretório pessoal `/home/" + nome + "' ...");
    contexto.linha("info: Copiando arquivos de `/etc/skel' ...");
    if (contexto.fs.obter(usuario.home) === null) {
      contexto.maquina.criarHome(usuario);
    }
    for (let tentativa: number = 0; tentativa < 3 && usuario.senha === null; tentativa++) {
      const senha: string | null = await pedirNovaSenha(contexto);
      if (senha !== null) {
        usuario.senha = senha;
        contexto.linha('passwd: senha atualizada com sucesso');
      } else {
        contexto.falhar('passwd: Erro de manipulação de token de autenticação');
        contexto.falhar('passwd: senha não alterada');
        if (!simOuNao(await contexto.interacao.perguntar('Tentar de novo? [s/N] ', false))) break;
      }
    }
    contexto.linha('Modificando as informações de usuário para ' + nome);
    contexto.linha('Informe o novo valor ou pressione ENTER para aceitar o padrão');
    const campos: string[] = [];
    for (const rotulo of ['Nome Completo', 'Número da Sala', 'Fone de Trabalho', 'Fone Residencial', 'Outro']) {
      campos.push(await contexto.interacao.perguntar('\t' + rotulo + ' []: ', false));
    }
    usuario.comentario = campos.slice(0, 4).join(',');
    await contexto.interacao.perguntar('Esta informação está correta? [S/n] ', false);
    contexto.linha("info: Adicionando novo usuário `" + nome + "' a grupos extras ...");
    contexto.linha("info: Adicionando usuário `" + nome + "' ao grupo `users' ...");
    contas.grupo('users')?.membros.push(nome);
    return 0;
  }

  private criarGrupo(nome: string, contexto: Contexto): number {
    if (contexto.contas.grupo(nome) !== undefined) {
      contexto.falhar("fatal: O grupo `" + nome + "' já existe.");
      return 1;
    }
    const gid: number = contexto.contas.proximoGid();
    contexto.linha("info: Adicionando grupo `" + nome + "' (GID " + gid + ') ...');
    contexto.contas.adicionarGrupo(new Grupo(nome, gid));
    return 0;
  }
}

/** Remove a conta, o grupo pessoal (se ficou vazio) e, se pedido, a home. */
function apagarConta(usuario: Usuario, removerHome: boolean, contexto: Contexto): void {
  const contas: Contas = contexto.contas;
  contas.removerUsuario(usuario.nome);
  const grupoPessoal: Grupo | undefined = contas.grupoPorGid(usuario.gid);
  const outroUsaComoPrimario: boolean = contas.listarUsuarios().some((u: Usuario) => u.gid === usuario.gid);
  if (grupoPessoal !== undefined && grupoPessoal.nome === usuario.nome && grupoPessoal.membros.length === 0 && !outroUsaComoPrimario) {
    contas.removerGrupo(grupoPessoal.nome);
  }
  if (removerHome) {
    const home: No | null = contexto.fs.obter(usuario.home);
    if (home instanceof Diretorio && home.pai !== null) {
      home.pai.remover(home.nome);
    }
  }
}

export class Userdel extends Comando {
  public readonly nome: string = 'userdel';
  public readonly resumo: string = 'apaga um usuário (-r apaga também a home dele)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { remove: 'r', force: 'f' });
    const nome: string | undefined = opcoes.operandos[0];
    if (nome === undefined) {
      contexto.falhar('Uso: userdel [opções] LOGIN   (-r remove também o diretório pessoal)');
      return 2;
    }
    if (!exigirRoot('userdel', '/etc/passwd', contexto)) return 1;
    const usuario: Usuario | undefined = contexto.contas.usuario(nome);
    if (usuario === undefined) {
      contexto.falhar("userdel: o usuário '" + nome + "' não existe");
      return 6;
    }
    if (contexto.maquina.usuariosLogados().includes(nome) && !opcoes.tem('f')) {
      contexto.falhar('userdel: o usuário ' + nome + ' está sendo usado pelo processo ' + (2000 + usuario.uid));
      contexto.falhar('Dica: encerre a sessão de ' + nome + ' (exit no terminal dela/dele) e tente de novo.');
      return 8;
    }
    if (opcoes.tem('r')) {
      contexto.falhar('userdel: spool de e-mail de ' + nome + ' (/var/mail/' + nome + ') não encontrado');
      if (contexto.fs.obter(usuario.home) === null) {
        contexto.falhar('userdel: diretório pessoal de ' + nome + ' (' + usuario.home + ') não encontrado');
      }
    }
    apagarConta(usuario, opcoes.tem('r'), contexto);
    registrar(contexto.maquina, 'auth.log', 'userdel[' + pidDeLog() + ']', 'delete user \'' + nome + '\'');
    return 0;
  }
}

export class Deluser extends Comando {
  public readonly nome: string = 'deluser';
  public readonly resumo: string = 'versão Debian/Ubuntu do userdel (--remove-home apaga a home). deluser maria sudo tira do grupo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args);
    if (!contexto.ehRoot()) {
      contexto.falhar('fatal: Apenas o root pode remover um usuário ou grupo do sistema.');
      return 1;
    }
    const [nome, nomeGrupo] = opcoes.operandos;
    const usuario: Usuario | undefined = nome !== undefined ? contexto.contas.usuario(nome) : undefined;
    if (usuario === undefined) {
      contexto.falhar("fatal: O usuário `" + (nome ?? '') + "' não existe.");
      return 2;
    }
    if (nomeGrupo !== undefined) {
      const grupo: Grupo | undefined = contexto.contas.grupo(nomeGrupo);
      if (grupo === undefined || !grupo.membros.includes(nome)) {
        contexto.falhar("fatal: O usuário `" + nome + "' não é membro do grupo `" + nomeGrupo + "'.");
        return 6;
      }
      contexto.linha("info: Removendo o usuário `" + nome + "' do grupo `" + nomeGrupo + "' ...");
      grupo.membros = grupo.membros.filter((m: string) => m !== nome);
      return 0;
    }
    if (contexto.maquina.usuariosLogados().includes(nome)) {
      contexto.falhar('fatal: O usuário ' + nome + ' está logado. Feche a sessão dele primeiro.');
      return 8;
    }
    if (opcoes.tem('--remove-home')) {
      contexto.linha('info: Procurando arquivos para fazer backup/remover ...');
      contexto.linha('info: Removendo arquivos ...');
    }
    contexto.linha("info: Removendo o usuário `" + nome + "' ...");
    apagarConta(usuario, opcoes.tem('--remove-home'), contexto);
    return 0;
  }
}

export class Usermod extends Comando {
  public readonly nome: string = 'usermod';
  public readonly resumo: string = 'altera usuário: -aG grupo (ADICIONA a grupos), -s shell, -l novo_nome, -L bloqueia, -U desbloqueia';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'gGsldc', {
      append: 'a', groups: 'G', gid: 'g', shell: 's', login: 'l', home: 'd', 'move-home': 'm', lock: 'L', unlock: 'U', comment: 'c',
    });
    const nome: string | undefined = opcoes.operandos[0];
    if (nome === undefined || opcoes.flags.size === 0) {
      contexto.falhar('Uso: usermod [opções] LOGIN');
      contexto.falhar('  -aG grupo   adiciona a grupos suplementares (sem tirar dos outros)');
      contexto.falhar('  -G  grupo   DEFINE a lista de grupos (tira dos que não estiverem na lista!)');
      contexto.falhar('  -g  grupo   muda o grupo primário');
      contexto.falhar('  -s  shell   muda o shell;  -l novo  renomeia;  -L/-U  bloqueia/desbloqueia');
      return 2;
    }
    if (!exigirRoot('usermod', '/etc/passwd', contexto)) return 1;
    const contas: Contas = contexto.contas;
    const usuario: Usuario | undefined = contas.usuario(nome);
    if (usuario === undefined) {
      contexto.falhar("usermod: o usuário '" + nome + "' não existe");
      return 6;
    }
    if (opcoes.tem('a') && !opcoes.tem('G')) {
      contexto.falhar('usermod: a opção -a só pode ser usada junto com -G');
      return 2;
    }
    const valorG: string | undefined = opcoes.valor('G');
    if (valorG !== undefined) {
      const grupos: Grupo[] = [];
      for (const nomeGrupo of valorG.split(',').filter((g: string) => g !== '')) {
        const grupo: Grupo | undefined = contas.acharGrupo(nomeGrupo);
        if (grupo === undefined) {
          contexto.falhar("usermod: o grupo '" + nomeGrupo + "' não existe");
          return 6;
        }
        grupos.push(grupo);
      }
      if (!opcoes.tem('a')) {
        for (const grupo of contas.listarGrupos()) {
          grupo.membros = grupo.membros.filter((m: string) => m !== nome);
        }
      }
      for (const grupo of grupos) {
        if (!grupo.membros.includes(nome)) grupo.membros.push(nome);
      }
    }
    const valorPrimario: string | undefined = opcoes.valor('g');
    if (valorPrimario !== undefined) {
      const grupo: Grupo | undefined = contas.acharGrupo(valorPrimario);
      if (grupo === undefined) {
        contexto.falhar("usermod: o grupo '" + valorPrimario + "' não existe");
        return 6;
      }
      usuario.gid = grupo.gid;
    }
    if (opcoes.valor('s') !== undefined) usuario.shell = opcoes.valor('s') as string;
    if (opcoes.valor('c') !== undefined) usuario.comentario = opcoes.valor('c') as string;
    if (opcoes.tem('L')) usuario.bloqueado = true;
    if (opcoes.tem('U')) usuario.bloqueado = false;
    const novaHome: string | undefined = opcoes.valor('d');
    if (novaHome !== undefined) {
      const antiga: No | null = contexto.fs.obter(usuario.home);
      if (opcoes.tem('m') && antiga instanceof Diretorio && antiga.pai !== null) {
        const partes: string[] = SistemaDeArquivos.segmentos(novaHome, '/');
        const nomeNovo: string = partes.pop() as string;
        const destino: No | null = contexto.fs.obter('/' + partes.join('/'));
        if (destino instanceof Diretorio) {
          antiga.pai.remover(antiga.nome);
          antiga.nome = nomeNovo;
          destino.adicionar(antiga);
        }
      }
      usuario.home = novaHome;
    }
    const novoLogin: string | undefined = opcoes.valor('l');
    if (novoLogin !== undefined) {
      if (contas.usuario(novoLogin) !== undefined) {
        contexto.falhar("usermod: o usuário '" + novoLogin + "' já existe");
        return 9;
      }
      for (const grupo of contas.listarGrupos()) {
        grupo.membros = grupo.membros.map((m: string) => m === nome ? novoLogin : m);
      }
      usuario.nome = novoLogin;
    }
    return 0;
  }
}

export class Passwd extends Comando {
  public readonly nome: string = 'passwd';
  public readonly resumo: string = 'define/troca senha: passwd (a sua) ou passwd maria (como root). -l bloqueia, -u desbloqueia, -S status';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { lock: 'l', unlock: 'u', status: 'S', delete: 'd' });
    const contas: Contas = contexto.contas;
    const eu: Usuario = contas.usuarioPorUid(contexto.credencial.uid) as Usuario;
    const nome: string = opcoes.operandos[0] ?? eu.nome;
    const alvo: Usuario | undefined = contas.usuario(nome);
    if (alvo === undefined) {
      contexto.falhar("passwd: o usuário '" + nome + "' não existe");
      return 1;
    }
    if (!contexto.ehRoot() && alvo !== eu) {
      contexto.falhar('passwd: Você não pode ver ou modificar a informação de senha para ' + nome + '.');
      return 1;
    }
    if (opcoes.tem('S')) {
      const estado: string = alvo.senha === null ? 'L' : alvo.bloqueado ? 'L' : alvo.senha === '' ? 'NP' : 'P';
      contexto.linha(nome + ' ' + estado + ' 2025-09-25 0 99999 7 -1');
      return 0;
    }
    if (opcoes.tem('l', 'u', 'd')) {
      if (!contexto.ehRoot()) {
        contexto.falhar('passwd: Permissão negada.');
        return 1;
      }
      if (opcoes.tem('l')) alvo.bloqueado = true;
      if (opcoes.tem('u')) alvo.bloqueado = false;
      if (opcoes.tem('d')) alvo.senha = '';
      contexto.linha('passwd: informação de expiração de senha alterada.');
      return 0;
    }
    if (!contexto.ehRoot()) {
      contexto.linha('Mudando senha para ' + nome + '.');
      const atual: string = await contexto.interacao.perguntar('Senha atual: ', true);
      if (atual !== alvo.senha) {
        contexto.falhar('passwd: Falha de autenticação');
        contexto.falhar('passwd: senha não alterada');
        return 10;
      }
    }
    const nova: string | null = await pedirNovaSenha(contexto);
    if (nova === null) {
      contexto.falhar('passwd: Erro de manipulação de token de autenticação');
      contexto.falhar('passwd: senha não alterada');
      return 10;
    }
    alvo.senha = nova;
    registrar(contexto.maquina, 'auth.log', 'passwd[' + pidDeLog() + ']', 'pam_unix(passwd:chauthtok): password changed for ' + alvo.nome);
    contexto.linha('passwd: senha atualizada com sucesso');
    return 0;
  }
}

export class Getent extends Comando {
  public readonly nome: string = 'getent';
  public readonly resumo: string = 'consulta contas: getent passwd maria  |  getent group sudo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const [base, chave] = args;
    let texto: string;
    if (base === 'passwd') texto = contexto.contas.gerarPasswd();
    else if (base === 'group') texto = contexto.contas.gerarGroup();
    else {
      contexto.falhar('Banco de dados desconhecido: ' + (base ?? '') + ' (use passwd ou group)');
      return 1;
    }
    const linhas: string[] = texto.trim().split('\n').filter((l: string) => chave === undefined || l.split(':')[0] === chave || l.split(':')[2] === chave);
    for (const linha of linhas) contexto.linha(linha);
    return linhas.length > 0 ? 0 : 2;
  }
}

