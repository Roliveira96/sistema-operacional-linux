import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Grupo, type Usuario } from '../../linux/Contas';
import { exigirRoot } from './Usuarios';

export class Groupadd extends Comando {
  public readonly nome: string = 'groupadd';
  public readonly resumo: string = 'cria um grupo: groupadd dev  (-g define o GID)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'g', { gid: 'g' });
    const nome: string | undefined = opcoes.operandos[0];
    if (nome === undefined) {
      contexto.falhar('Uso: groupadd [opções] GRUPO');
      return 2;
    }
    if (!exigirRoot('groupadd', '/etc/group', contexto)) return 10;
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(nome)) {
      contexto.falhar("groupadd: '" + nome + "' não é um nome de grupo válido");
      return 3;
    }
    if (contexto.contas.grupo(nome) !== undefined) {
      contexto.falhar("groupadd: o grupo '" + nome + "' já existe");
      return 9;
    }
    const gid: number = opcoes.valor('g') !== undefined ? Number(opcoes.valor('g')) : contexto.contas.proximoGid();
    if (contexto.contas.grupoPorGid(gid) !== undefined) {
      contexto.falhar("groupadd: GID '" + gid + "' já existe");
      return 4;
    }
    contexto.contas.adicionarGrupo(new Grupo(nome, gid));
    return 0;
  }
}

export class Groupdel extends Comando {
  public readonly nome: string = 'groupdel';
  public readonly resumo: string = 'apaga um grupo (não pode ser o grupo primário de ninguém)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const nome: string | undefined = Opcoes.ler(args).operandos[0];
    if (nome === undefined) {
      contexto.falhar('Uso: groupdel [opções] GRUPO');
      return 2;
    }
    if (!exigirRoot('groupdel', '/etc/group', contexto)) return 10;
    const grupo: Grupo | undefined = contexto.contas.grupo(nome);
    if (grupo === undefined) {
      contexto.falhar("groupdel: o grupo '" + nome + "' não existe");
      return 6;
    }
    const dono: Usuario | undefined = contexto.contas.listarUsuarios().find((u: Usuario) => u.gid === grupo.gid);
    if (dono !== undefined) {
      contexto.falhar("groupdel: não é possível remover o grupo primário do usuário '" + dono.nome + "'");
      return 8;
    }
    contexto.contas.removerGrupo(nome);
    return 0;
  }
}

export class Groupmod extends Comando {
  public readonly nome: string = 'groupmod';
  public readonly resumo: string = 'altera um grupo: groupmod -n novo_nome grupo';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'ng', { 'new-name': 'n', gid: 'g' });
    const nome: string | undefined = opcoes.operandos[0];
    if (nome === undefined) {
      contexto.falhar('Uso: groupmod [opções] GRUPO   (-n NOVO_NOME, -g NOVO_GID)');
      return 2;
    }
    if (!exigirRoot('groupmod', '/etc/group', contexto)) return 10;
    const grupo: Grupo | undefined = contexto.contas.grupo(nome);
    if (grupo === undefined) {
      contexto.falhar("groupmod: o grupo '" + nome + "' não existe");
      return 6;
    }
    const novoNome: string | undefined = opcoes.valor('n');
    if (novoNome !== undefined) {
      if (contexto.contas.grupo(novoNome) !== undefined) {
        contexto.falhar("groupmod: o grupo '" + novoNome + "' já existe");
        return 9;
      }
      grupo.nome = novoNome;
    }
    if (opcoes.valor('g') !== undefined) {
      grupo.gid = Number(opcoes.valor('g'));
    }
    return 0;
  }
}

export class Gpasswd extends Comando {
  public readonly nome: string = 'gpasswd';
  public readonly resumo: string = 'administra grupos: gpasswd -a maria dev (adiciona)  |  gpasswd -d maria dev (remove)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'adM', { add: 'a', delete: 'd', members: 'M' });
    const nomeGrupo: string | undefined = opcoes.operandos[0];
    if (nomeGrupo === undefined) {
      contexto.falhar('Uso: gpasswd [opção] GRUPO   (-a USUÁRIO adiciona, -d USUÁRIO remove, -M u1,u2 define membros)');
      return 2;
    }
    if (!contexto.ehRoot()) {
      contexto.falhar('gpasswd: Permissão negada.');
      return 3;
    }
    const grupo: Grupo | undefined = contexto.contas.grupo(nomeGrupo);
    if (grupo === undefined) {
      contexto.falhar("gpasswd: o grupo '" + nomeGrupo + "' não existe em /etc/group");
      return 3;
    }
    const adicionar: string | undefined = opcoes.valor('a');
    const remover: string | undefined = opcoes.valor('d');
    const membros: string | undefined = opcoes.valor('M');
    const alvo: string | undefined = adicionar ?? remover;
    if (alvo !== undefined && contexto.contas.usuario(alvo) === undefined) {
      contexto.falhar("gpasswd: o usuário '" + alvo + "' não existe");
      return 3;
    }
    if (adicionar !== undefined) {
      contexto.linha('Adicionando usuário ' + adicionar + ' ao grupo ' + nomeGrupo);
      if (!grupo.membros.includes(adicionar)) grupo.membros.push(adicionar);
    } else if (remover !== undefined) {
      if (!grupo.membros.includes(remover)) {
        contexto.falhar("gpasswd: o usuário '" + remover + "' não é membro de '" + nomeGrupo + "'");
        return 3;
      }
      contexto.linha('Removendo usuário ' + remover + ' do grupo ' + nomeGrupo);
      grupo.membros = grupo.membros.filter((m: string) => m !== remover);
    } else if (membros !== undefined) {
      grupo.membros = membros.split(',').filter((m: string) => m !== '');
    } else {
      contexto.falhar('gpasswd: use -a, -d ou -M');
      return 2;
    }
    return 0;
  }
}

export class Delgroup extends Comando {
  public readonly nome: string = 'delgroup';
  public readonly resumo: string = 'versão Debian/Ubuntu do groupdel';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const nome: string | undefined = Opcoes.ler(args).operandos[0];
    if (!contexto.ehRoot()) {
      contexto.falhar('fatal: Apenas o root pode remover um usuário ou grupo do sistema.');
      return 1;
    }
    const grupo: Grupo | undefined = nome !== undefined ? contexto.contas.grupo(nome) : undefined;
    if (grupo === undefined) {
      contexto.falhar("fatal: O grupo `" + (nome ?? '') + "' não existe.");
      return 3;
    }
    if (contexto.contas.listarUsuarios().some((u: Usuario) => u.gid === grupo.gid)) {
      contexto.falhar("fatal: O grupo `" + nome + "' ainda é o grupo primário de um usuário.");
      return 7;
    }
    contexto.linha("info: Removendo o grupo `" + nome + "' ...");
    contexto.contas.removerGrupo(grupo.nome);
    return 0;
  }
}
