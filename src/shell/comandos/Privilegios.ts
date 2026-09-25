import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { Contas, type Usuario } from '../../linux/Contas';
import { SaidaDoScript } from '../Interpretador';

export class Sudo extends Comando {
  public readonly nome: string = 'sudo';
  public readonly resumo: string = 'executa UM comando como root (pede a SUA senha; só para quem está no grupo sudo)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    let i: number = 0;
    let loginShell: boolean = false;
    let shell: boolean = false;
    let nomeAlvo: string = 'root';
    while (i < args.length && args[i].startsWith('-')) {
      if (args[i] === '-i') loginShell = true;
      else if (args[i] === '-s') shell = true;
      else if (args[i] === '-u' && i + 1 < args.length) nomeAlvo = args[++i];
      else if (args[i] === '-k') {
        contexto.sessao.sudoValidado.clear();
        if (args.length === 1) return 0;
      } else {
        contexto.falhar('sudo: opção inválida -- ' + args[i]);
        return 1;
      }
      i++;
    }
    const comando: string[] = args.slice(i);
    if (comando.length === 0 && !loginShell && !shell) {
      contexto.falhar('uso: sudo -h | -K | -k | -V');
      contexto.falhar('uso: sudo [-i | -s] [-u usuário] [comando [argumento ...]]');
      return 1;
    }
    const eu: Usuario = contexto.contas.usuarioPorUid(contexto.credencial.uid) as Usuario;
    if (!(await this.autorizar(eu, contexto))) {
      return 1;
    }
    const alvo: Usuario | undefined = contexto.contas.usuario(nomeAlvo);
    if (alvo === undefined) {
      contexto.falhar('sudo: usuário desconhecido ' + nomeAlvo);
      return 1;
    }
    if (loginShell || shell) {
      contexto.sessao.entrar(contexto.maquina.novoQuadro(alvo, loginShell ? alvo.home : contexto.quadro.cwd));
      return 0;
    }
    if (contexto.executor.ehEmbutido(comando[0])) {
      contexto.falhar('sudo: ' + comando[0] + ': comando não encontrado');
      contexto.falhar('Dica: ' + comando[0] + ' é embutido no bash; use sudo -i para abrir um shell de root.');
      return 1;
    }
    return contexto.executor.executarArgs(comando, contexto.comCredencial({ uid: alvo.uid, gids: contexto.contas.gidsDe(alvo) }));
  }

  private async autorizar(eu: Usuario, contexto: Contexto): Promise<boolean> {
    if (contexto.ehRoot()) {
      return true;
    }
    if (!contexto.sessao.sudoValidado.has(eu.nome)) {
      for (let tentativa: number = 1; ; tentativa++) {
        const senha: string = await contexto.interacao.perguntar('[sudo] senha para ' + eu.nome + ': ', true);
        if (senha === eu.senha && !eu.bloqueado) {
          break;
        }
        if (tentativa === 3) {
          contexto.falhar('sudo: 3 tentativas de senha incorretas');
          return false;
        }
        contexto.falhar('Sinto muito, tente novamente.');
      }
    }
    if (!contexto.credencial.gids.includes(Contas.GID_SUDO)) {
      contexto.falhar(eu.nome + ' não está no arquivo sudoers.  Este incidente será relatado.');
      contexto.falhar('Dica: como root, rode "usermod -aG sudo ' + eu.nome + '" e depois faça login de novo.');
      return false;
    }
    contexto.sessao.sudoValidado.add(eu.nome);
    return true;
  }
}

export class Su extends Comando {
  public readonly nome: string = 'su';
  public readonly resumo: string = 'troca de usuário: su - maria (pede a senha DELA; root não precisa de senha)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { login: 'l' });
    const login: boolean = args.includes('-') || opcoes.tem('l');
    const nome: string = opcoes.operandos.find((o: string) => o !== '-') ?? 'root';
    const alvo: Usuario | undefined = contexto.contas.usuario(nome);
    if (alvo === undefined) {
      contexto.falhar('su: o usuário ' + nome + ' não existe ou a entrada do usuário não contém todos os campos necessários');
      return 1;
    }
    if (!contexto.ehRoot()) {
      const senha: string = await contexto.interacao.perguntar('Senha: ', true);
      if (alvo.senha === null || alvo.bloqueado || senha !== alvo.senha) {
        contexto.falhar('su: Falha de autenticação');
        if (alvo.senha === null) {
          contexto.falhar('Dica: ' + nome + ' ainda não tem senha. Como root, rode "passwd ' + nome + '".');
        }
        return 1;
      }
    }
    if (alvo.shell.endsWith('nologin') || alvo.shell.endsWith('false')) {
      contexto.linha('This account is currently not available.');
      return 1;
    }
    let destino: string = contexto.quadro.cwd;
    if (login) {
      destino = alvo.home;
      if (contexto.fs.obter(alvo.home) === null) {
        contexto.falhar('su: aviso: não foi possível mudar o diretório para ' + alvo.home + ': Arquivo ou diretório inexistente');
        destino = '/';
      }
    }
    contexto.sessao.entrar(contexto.maquina.novoQuadro(alvo, destino));
    return 0;
  }
}

export class Exit extends Comando {
  public readonly nome: string;
  public readonly resumo: string = 'sai do shell atual (volta ao usuário anterior depois de um su, ou desconecta o SSH)';
  public readonly embutido: boolean = true;

  constructor(nome: 'exit' | 'logout') {
    super();
    this.nome = nome;
  }

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const codigo: number = args[0] !== undefined && /^\d+$/.test(args[0]) ? Number(args[0]) : contexto.escopo.ultimoStatus;
    if (contexto.escopo.emScript) {
      throw new SaidaDoScript(codigo);
    }
    contexto.linha('logout');
    if (!contexto.sessao.sair()) {
      contexto.interacao.desconectar();
    }
    return 0;
  }
}
