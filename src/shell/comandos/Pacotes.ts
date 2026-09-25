import { Comando, Opcoes } from '../Comando';
import type { Contexto } from '../Contexto';
import { CATALOGO, GerenciadorDePacotes, type EstadoDoPacote, type Pacote } from '../../linux/Pacotes';
import { simOuNao } from './util';

const esperar = (ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms));

/** 47 → "47,0 kB"; 1596 → "1.596 kB" (formato pt_BR do apt). */
function kb(valor: number): string {
  if (valor >= 1000) return Math.round(valor).toLocaleString('pt-BR') + ' kB';
  return valor.toFixed(1).replace('.', ',') + ' kB';
}

function origem(pacote: Pacote, atualizacao: boolean): string {
  return 'http://br.archive.ubuntu.com/ubuntu noble' + (atualizacao ? '-updates' : '') + '/' + pacote.repositorio;
}

/** Tudo que apt e apt-get têm em comum: travas de root, instalação, remoção, atualização. */
abstract class Gerenciador extends Comando {
  protected exigirRoot(contexto: Contexto, trava: 'listas' | 'dpkg'): boolean {
    if (contexto.ehRoot()) return true;
    if (trava === 'listas') {
      contexto.linha('Lendo listas de pacotes... Pronto');
      contexto.falhar('E: Não foi possível abrir arquivo de trava /var/lib/apt/lists/lock - open (13: Permissão negada)');
      contexto.falhar('E: Impossível criar trava no diretório /var/lib/apt/lists/');
    } else {
      contexto.falhar('E: Não foi possível abrir arquivo de trava /var/lib/dpkg/lock-frontend - open (13: Permissão negada)');
      contexto.falhar('E: Não foi possível obter trava do frontend dpkg (/var/lib/dpkg/lock-frontend), você é root?');
    }
    contexto.linha('Dica: gerenciar pacotes exige root. Use sudo na frente.', 'c-info');
    return false;
  }

  protected lendo(contexto: Contexto): void {
    contexto.linha('Lendo listas de pacotes... Pronto');
    contexto.linha('Construindo árvore de dependências... Pronto');
    contexto.linha('Lendo informação de estado... Pronto');
  }

  protected async confirmar(contexto: Contexto, sim: boolean): Promise<boolean> {
    if (sim) return true;
    const resposta: string = await contexto.interacao.perguntar('Deseja continuar? [S/n] ', false);
    if (resposta.trim() === '' || simOuNao(resposta)) return true;
    contexto.linha('Abortar.');
    return false;
  }

  protected contagem(contexto: Contexto, atualizados: number, novos: number, removidos: number, ger: GerenciadorDePacotes): void {
    const pendentes: number = ger.atualizaveis().length - atualizados;
    contexto.linha(atualizados + ' pacotes atualizados, ' + novos + ' pacotes novos instalados, ' + removidos +
      ' a serem removidos e ' + Math.max(0, pendentes) + ' não atualizados.');
  }

  protected listaIndentada(contexto: Contexto, nomes: string[]): void {
    contexto.linha('  ' + nomes.join(' '));
  }

  protected async update(contexto: Contexto): Promise<number> {
    if (!this.exigirRoot(contexto, 'listas')) return 100;
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    const linhas: string[] = [
      'Atingido:1 http://br.archive.ubuntu.com/ubuntu noble InRelease',
      'Obter:2 http://br.archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]',
      'Obter:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]',
      'Obter:4 http://br.archive.ubuntu.com/ubuntu noble-backports InRelease [126 kB]',
      'Obter:5 http://br.archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages [512 kB]',
    ];
    for (const linha of linhas) {
      contexto.linha(linha);
      await esperar(120);
    }
    contexto.linha('Baixados 890 kB em 2s (445 kB/s)');
    ger.marcarListasAtualizadas();
    this.lendo(contexto);
    const n: number = ger.atualizaveis().length;
    contexto.linha(n > 0 ? n + ' pacotes podem ser atualizados. Execute \'apt list --upgradable\' para vê-los.' : 'Todos os pacotes estão atualizados.');
    return 0;
  }

  protected async upgrade(contexto: Contexto, sim: boolean, linhaDeComando: string): Promise<number> {
    if (!this.exigirRoot(contexto, 'dpkg')) return 100;
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    this.lendo(contexto);
    contexto.linha('Calculando atualização... Pronto');
    const lista: Pacote[] = ger.atualizaveis();
    if (lista.length === 0) {
      this.contagem(contexto, 0, 0, 0, ger);
      if (!ger.listasAtualizadas()) {
        contexto.linha('Dica: rode "apt update" antes: é ele que descobre as versões novas.', 'c-info');
      }
      return 0;
    }
    contexto.linha('Os pacotes a seguir serão atualizados:');
    this.listaIndentada(contexto, lista.map((p: Pacote) => p.nome));
    this.contagem(contexto, lista.length, 0, 0, ger);
    contexto.linha('É preciso baixar ' + kb(lista.reduce((t: number, p: Pacote) => t + p.baixarKb, 0)) + ' de arquivos.');
    if (!(await this.confirmar(contexto, sim))) return 1;
    lista.forEach((p: Pacote, i: number) => contexto.linha('Obter:' + (i + 1) + ' ' + origem(p, true) + ' amd64 ' + p.nome + ' amd64 ' + ger.versaoCandidata(p) + ' [' + kb(p.baixarKb) + ']'));
    await esperar(300);
    ger.registrarHistorico(linhaDeComando, 'Upgrade', lista);
    for (const p of lista) {
      const antiga: string = ger.versaoInstalada(p.nome) ?? '';
      contexto.linha('Preparando para desempacotar .../' + p.nome + '_' + ger.versaoCandidata(p).replace(/^\d+:/, '') + '_amd64.deb ...');
      contexto.linha('Desempacotando ' + p.nome + ' (' + ger.versaoCandidata(p) + ') sobre (' + antiga + ') ...');
      await esperar(100);
    }
    for (const p of lista) {
      contexto.linha('Configurando ' + p.nome + ' (' + ger.versaoCandidata(p) + ') ...');
      ger.atualizar(p);
    }
    contexto.linha('Processando gatilhos para man-db (2.12.0-4build2) ...');
    return 0;
  }

  protected async install(contexto: Contexto, nomes: string[], sim: boolean, linhaDeComando: string): Promise<number> {
    if (!this.exigirRoot(contexto, 'dpkg')) return 100;
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    this.lendo(contexto);
    for (const nome of nomes) {
      if (GerenciadorDePacotes.pacote(nome) === undefined) {
        contexto.falhar('E: Impossível encontrar o pacote ' + nome);
        return 100;
      }
    }
    const jaTem: string[] = nomes.filter((n: string) => ger.instalado(n));
    for (const nome of jaTem) {
      contexto.linha(nome + ' já é a versão mais recente (' + ger.versaoInstalada(nome) + ').');
    }
    const novos: Pacote[] = ger.resolver(nomes.filter((n: string) => !jaTem.includes(n)));
    if (novos.length === 0) {
      this.contagem(contexto, 0, 0, 0, ger);
      return 0;
    }
    const extras: Pacote[] = novos.filter((p: Pacote) => !nomes.includes(p.nome));
    if (extras.length > 0) {
      contexto.linha('Os pacotes adicionais a seguir serão instalados:');
      this.listaIndentada(contexto, extras.map((p: Pacote) => p.nome));
    }
    contexto.linha('Os NOVOS pacotes a seguir serão instalados:');
    this.listaIndentada(contexto, novos.map((p: Pacote) => p.nome).sort());
    this.contagem(contexto, 0, novos.length, 0, ger);
    contexto.linha('É preciso baixar ' + kb(novos.reduce((t: number, p: Pacote) => t + p.baixarKb, 0)) + ' de arquivos.');
    contexto.linha('Depois desta operação, ' + kb(novos.reduce((t: number, p: Pacote) => t + p.instaladoKb, 0)) + ' adicionais de espaço em disco serão usados.');
    if (extras.length > 0 && !(await this.confirmar(contexto, sim))) return 1;

    novos.forEach((p: Pacote, i: number) => contexto.linha('Obter:' + (i + 1) + ' ' + origem(p, false) + ' amd64 ' + p.nome + ' amd64 ' + ger.versaoCandidata(p) + ' [' + kb(p.baixarKb) + ']'));
    await esperar(350);
    contexto.linha('Baixados ' + kb(novos.reduce((t: number, p: Pacote) => t + p.baixarKb, 0)) + ' em 1s (' + kb(480) + '/s)');
    for (const p of novos) {
      contexto.linha('Selecionando pacote ' + p.nome + ' previamente não selecionado.');
      contexto.linha('(Lendo banco de dados ... 185432 arquivos e diretórios atualmente instalados.)');
      contexto.linha('Preparando para desempacotar .../' + p.nome + '_' + ger.versaoCandidata(p).replace(/^\d+:/, '') + '_amd64.deb ...');
      contexto.linha('Desempacotando ' + p.nome + ' (' + ger.versaoCandidata(p) + ') ...');
      await esperar(90);
    }
    ger.registrarHistorico(linhaDeComando, 'Install', novos);
    for (const p of novos) {
      contexto.linha('Configurando ' + p.nome + ' (' + ger.versaoCandidata(p) + ') ...');
      ger.instalar(p, !nomes.includes(p.nome));
      if (p.servico !== undefined) {
        contexto.linha('Created symlink /etc/systemd/system/multi-user.target.wants/' + p.servico.nome + '.service → /usr/lib/systemd/system/' + p.servico.nome + '.service.');
      }
    }
    contexto.linha('Processando gatilhos para man-db (2.12.0-4build2) ...');
    return 0;
  }

  protected async remove(contexto: Contexto, nomes: string[], purgar: boolean, sim: boolean, linhaDeComando: string): Promise<number> {
    if (!this.exigirRoot(contexto, 'dpkg')) return 100;
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    this.lendo(contexto);
    const estado: Map<string, EstadoDoPacote> = ger.estado();
    const alvos: Pacote[] = [];
    for (const nome of nomes) {
      const pacote: Pacote | undefined = GerenciadorDePacotes.pacote(nome);
      if (pacote === undefined) {
        contexto.falhar('E: Impossível encontrar o pacote ' + nome);
        return 100;
      }
      const e: EstadoDoPacote | undefined = estado.get(nome);
      if (e === undefined || (e.estado === 'rc' && !purgar)) {
        contexto.linha('O pacote \'' + nome + '\' não está instalado, então não será removido');
        continue;
      }
      if (pacote.essencial) {
        contexto.falhar('E: ' + nome + ' é um pacote ESSENCIAL: removê-lo quebraria o sistema. Operação recusada pelo simulador.');
        return 100;
      }
      alvos.push(pacote);
    }
    if (alvos.length === 0) {
      this.contagem(contexto, 0, 0, 0, ger);
      return 0;
    }
    contexto.linha('Os pacotes a seguir serão REMOVIDOS:');
    this.listaIndentada(contexto, alvos.map((p: Pacote) => p.nome + (purgar ? '*' : '')));
    this.contagem(contexto, 0, 0, alvos.length, ger);
    contexto.linha('Depois desta operação, ' + kb(alvos.reduce((t: number, p: Pacote) => t + p.instaladoKb, 0)) + ' de espaço em disco serão liberados.');
    if (!(await this.confirmar(contexto, sim))) return 1;
    contexto.linha('(Lendo banco de dados ... 185432 arquivos e diretórios atualmente instalados.)');
    ger.registrarHistorico(linhaDeComando, purgar ? 'Purge' : 'Remove', alvos);
    for (const p of alvos) {
      if (estado.get(p.nome)?.estado === 'ii') contexto.linha('Removendo ' + p.nome + ' (' + (ger.versaoInstalada(p.nome) ?? p.versao) + ') ...');
      if (purgar) contexto.linha('Purgando arquivos de configuração de ' + p.nome + ' (' + p.versao + ') ...');
      ger.remover(p, purgar);
      await esperar(90);
    }
    contexto.linha('Processando gatilhos para man-db (2.12.0-4build2) ...');
    const orfaos: Pacote[] = ger.orfaos();
    if (orfaos.length > 0) {
      contexto.linha('Os pacotes a seguir foram instalados automaticamente e já não são necessários:');
      this.listaIndentada(contexto, orfaos.map((p: Pacote) => p.nome));
      contexto.linha('Utilize \'sudo apt autoremove\' para removê-los.');
    }
    return 0;
  }

  protected async autoremove(contexto: Contexto, sim: boolean, linhaDeComando: string): Promise<number> {
    if (!this.exigirRoot(contexto, 'dpkg')) return 100;
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    const orfaos: Pacote[] = ger.orfaos();
    if (orfaos.length === 0) {
      this.lendo(contexto);
      this.contagem(contexto, 0, 0, 0, ger);
      return 0;
    }
    return this.remove(contexto, orfaos.map((p: Pacote) => p.nome), false, sim, linhaDeComando);
  }

  protected search(contexto: Contexto, termo: string | undefined): number {
    if (termo === undefined) {
      contexto.falhar('E: Você deve informar pelo menos um padrão de pesquisa');
      return 100;
    }
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    contexto.linha('Ordenando... Pronto');
    contexto.linha('Pesquisa completa de texto... Pronto');
    const t: string = termo.toLowerCase();
    for (const p of CATALOGO.filter((c: Pacote) => c.nome.includes(t) || c.descricao.toLowerCase().includes(t))) {
      contexto.escrever(p.nome, 'c-exe');
      contexto.linha('/noble ' + ger.versaoCandidata(p) + ' amd64' + (ger.instalado(p.nome) ? ' [instalado]' : ''));
      contexto.linha('  ' + p.descricao);
      contexto.linha();
    }
    return 0;
  }

  protected show(contexto: Contexto, nome: string | undefined): number {
    const pacote: Pacote | undefined = nome !== undefined ? GerenciadorDePacotes.pacote(nome) : undefined;
    if (pacote === undefined) {
      contexto.falhar('N: Não foi possível localizar o pacote ' + (nome ?? ''));
      contexto.falhar('E: Nenhum pacote encontrado');
      return 100;
    }
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    contexto.linha('Package: ' + pacote.nome);
    contexto.linha('Version: ' + ger.versaoCandidata(pacote));
    contexto.linha('Priority: ' + (pacote.base ? 'important' : 'optional'));
    contexto.linha('Section: ' + (pacote.repositorio === 'universe' ? 'universe/' : '') + pacote.secao);
    contexto.linha('Origin: Ubuntu');
    contexto.linha('Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>');
    contexto.linha('Installed-Size: ' + kb(pacote.instaladoKb));
    if (pacote.dependencias.length > 0) contexto.linha('Depends: ' + pacote.dependencias.join(', '));
    contexto.linha('Download-Size: ' + kb(pacote.baixarKb));
    contexto.linha('APT-Manual-Installed: ' + (ger.instalado(pacote.nome) ? 'yes' : 'no'));
    contexto.linha('APT-Sources: ' + origem(pacote, false) + ' amd64 Packages');
    contexto.linha('Description: ' + pacote.descricao);
    contexto.linha();
    return 0;
  }
}

export class Apt extends Gerenciador {
  public readonly nome: string = 'apt';
  public readonly resumo: string = 'gerenciador de pacotes: apt update | upgrade | install X | remove X | purge X | search X | show X | list';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { yes: 'y', 'assume-yes': 'y', installed: 'instalados', upgradable: 'atualizaveis', purge: 'purge' });
    const [acao, ...nomes] = opcoes.operandos;
    const linha: string = 'apt ' + args.join(' ');
    const sim: boolean = opcoes.tem('y');
    switch (acao) {
      case 'update': return this.update(contexto);
      case 'upgrade':
      case 'full-upgrade': return this.upgrade(contexto, sim, linha);
      case 'install':
      case 'reinstall':
        if (nomes.length === 0) return this.faltaPacote(contexto);
        return this.install(contexto, nomes, sim, linha);
      case 'remove':
        if (nomes.length === 0) return this.faltaPacote(contexto);
        return this.remove(contexto, nomes, opcoes.tem('purge'), sim, linha);
      case 'purge':
        if (nomes.length === 0) return this.faltaPacote(contexto);
        return this.remove(contexto, nomes, true, sim, linha);
      case 'autoremove': return this.autoremove(contexto, sim, linha);
      case 'search': return this.search(contexto, nomes[0]);
      case 'show': return this.show(contexto, nomes[0]);
      case 'list': return this.listar(contexto, opcoes, nomes[0]);
      default:
        contexto.linha('apt 2.7.14 (amd64)');
        contexto.linha('Uso: apt [opções] comando');
        contexto.linha();
        contexto.linha('Comandos mais usados:');
        const ajuda: Array<[string, string]> = [
          ['list', 'lista pacotes baseado nos nomes dos pacotes'], ['search', 'pesquisa descrições dos pacotes'],
          ['show', 'mostra detalhes do pacote'], ['install', 'instala pacotes'], ['remove', 'remove pacotes'],
          ['purge', 'remove pacotes e seus arquivos de configuração'], ['autoremove', 'remove automaticamente todos os pacotes não usados'],
          ['update', 'atualiza a lista de pacotes disponíveis'], ['upgrade', 'atualiza o sistema instalando/atualizando pacotes'],
          ['full-upgrade', 'atualiza o sistema removendo/instalando/atualizando pacotes'],
        ];
        for (const [c, d] of ajuda) contexto.linha('  ' + c + ' - ' + d);
        return acao === undefined ? 1 : 1;
    }
  }

  private faltaPacote(contexto: Contexto): number {
    contexto.falhar('E: Informe pelo menos um pacote (ex.: apt install tree)');
    return 100;
  }

  private listar(contexto: Contexto, opcoes: Opcoes, padrao: string | undefined): number {
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    const estado: Map<string, EstadoDoPacote> = ger.estado();
    contexto.linha('Listando... Pronto');
    const regex: RegExp | null = padrao !== undefined ? new RegExp('^' + padrao.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null;
    const atualizaveis: Pacote[] = ger.atualizaveis();
    for (const p of CATALOGO.slice().sort((a: Pacote, b: Pacote) => a.nome.localeCompare(b.nome))) {
      const e: EstadoDoPacote | undefined = estado.get(p.nome);
      if (regex !== null && !regex.test(p.nome)) continue;
      if (opcoes.tem('instalados') && e?.estado !== 'ii') continue;
      if (opcoes.tem('atualizaveis') && !atualizaveis.includes(p)) continue;
      contexto.escrever(p.nome, 'c-exe');
      if (atualizaveis.includes(p)) {
        contexto.linha('/noble-updates ' + ger.versaoCandidata(p) + ' amd64 [atualizável de: ' + e?.versao + ']');
      } else if (e?.estado === 'ii') {
        contexto.linha('/noble,now ' + e.versao + ' amd64 [instalado' + (e.automatico ? ',automático' : '') + ']');
      } else {
        contexto.linha('/noble ' + ger.versaoCandidata(p) + ' amd64' + (e?.estado === 'rc' ? ' [configuração-residual]' : ''));
      }
    }
    return 0;
  }
}

export class AptGet extends Gerenciador {
  public readonly nome: string = 'apt-get';
  public readonly resumo: string = 'versão "clássica" do apt, muito usada em scripts: apt-get update | upgrade | install -y X | remove X';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, '', { yes: 'y', 'assume-yes': 'y', purge: 'purge' });
    const [acao, ...nomes] = opcoes.operandos;
    const linha: string = 'apt-get ' + args.join(' ');
    const sim: boolean = opcoes.tem('y');
    switch (acao) {
      case 'update': return this.update(contexto);
      case 'upgrade':
      case 'dist-upgrade': return this.upgrade(contexto, sim, linha);
      case 'install': return this.install(contexto, nomes, sim, linha);
      case 'remove': return this.remove(contexto, nomes, opcoes.tem('purge'), sim, linha);
      case 'purge': return this.remove(contexto, nomes, true, sim, linha);
      case 'autoremove': return this.autoremove(contexto, sim, linha);
      case 'clean':
        return this.exigirRoot(contexto, 'dpkg') ? 0 : 100;
      case 'search':
      case 'show':
        contexto.falhar('E: Operação inválida ' + acao + ' (no apt-get, use apt-cache ' + acao + ')');
        return 100;
      default:
        contexto.linha('apt 2.7.14 (amd64)');
        contexto.linha('Uso: apt-get [opções] comando');
        contexto.linha('Comandos: update, upgrade, dist-upgrade, install, remove, purge, autoremove, clean');
        return 1;
    }
  }
}

export class AptCache extends Gerenciador {
  public readonly nome: string = 'apt-cache';
  public readonly resumo: string = 'consulta o catálogo de pacotes: apt-cache search X | show X | policy X';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const [acao, nome] = args;
    if (acao === 'search') {
      const termo: string = (nome ?? '').toLowerCase();
      for (const p of CATALOGO.filter((c: Pacote) => c.nome.includes(termo) || c.descricao.toLowerCase().includes(termo))) {
        contexto.linha(p.nome + ' - ' + p.descricao);
      }
      return 0;
    }
    if (acao === 'show') return this.show(contexto, nome);
    if (acao === 'policy' && nome !== undefined) {
      const pacote: Pacote | undefined = GerenciadorDePacotes.pacote(nome);
      if (pacote === undefined) return 0;
      const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
      contexto.linha(nome + ':');
      contexto.linha('  Instalado: ' + (ger.versaoInstalada(nome) ?? '(nenhum)'));
      contexto.linha('  Candidato: ' + ger.versaoCandidata(pacote));
      return 0;
    }
    contexto.falhar('Uso: apt-cache search PADRÃO | show PACOTE | policy PACOTE');
    return 1;
  }
}

export class Dpkg extends Comando {
  public readonly nome: string = 'dpkg';
  public readonly resumo: string = 'nível mais baixo dos pacotes: dpkg -l (lista) | dpkg -L X (arquivos do pacote) | dpkg -s X (status)';

  public async executar(args: string[], contexto: Contexto): Promise<number> {
    const opcoes: Opcoes = Opcoes.ler(args, 'LsSi', { list: 'l', listfiles: 'L', status: 's', install: 'i' });
    const ger: GerenciadorDePacotes = new GerenciadorDePacotes(contexto.maquina);
    const estado: Map<string, EstadoDoPacote> = ger.estado();
    if (opcoes.tem('l')) {
      const padroes: string[] = opcoes.operandos;
      const regexes: RegExp[] = padroes.map((p: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
      const linhas: Array<[string, string, string]> = [];
      for (const [nome, e] of Array.from(estado).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (regexes.length > 0 && !regexes.some((r: RegExp) => r.test(nome))) continue;
        linhas.push([e.estado, nome, e.versao]);
      }
      if (linhas.length === 0) {
        contexto.falhar('dpkg-query: nenhum pacote encontrado casando com ' + padroes.join(' '));
        return 1;
      }
      contexto.linha('Desejado=desconhecido(U)/Instalar/Remover/aPagar/Manter');
      contexto.linha('| Estado=Não/Inst/arq-Conf/Desempacotado/semi-conFig/semi-Inst/gat-aGuard/gat-Pend');
      contexto.linha('|/ Erro?=(nenhum)/Reinstalação-requerida (Estado,Erro: maiúsculas=ruim)');
      contexto.linha('||/ Nome             Versão                   Arquitetura  Descrição');
      contexto.linha('+++-================-========================-============-=========================================');
      for (const [marca, nome, versao] of linhas) {
        contexto.linha(marca + '  ' + nome.padEnd(16) + ' ' + versao.padEnd(24) + ' amd64        ' + (GerenciadorDePacotes.pacote(nome)?.descricao ?? ''));
      }
      return 0;
    }
    const alvo: string | undefined = opcoes.valor('L') ?? opcoes.valor('s');
    if (alvo !== undefined) {
      const e: EstadoDoPacote | undefined = estado.get(alvo);
      const pacote: Pacote | undefined = GerenciadorDePacotes.pacote(alvo);
      if (e === undefined || pacote === undefined) {
        contexto.falhar('dpkg-query: o pacote \'' + alvo + '\' não está instalado' + (opcoes.tem('s') ? ' e nenhuma informação está disponível' : ''));
        return 1;
      }
      if (opcoes.tem('L')) {
        for (const caminho of ger.arquivosDe(pacote)) contexto.linha(caminho);
      } else {
        contexto.linha('Package: ' + alvo);
        contexto.linha('Status: ' + (e.estado === 'ii' ? 'install ok installed' : 'deinstall ok config-files'));
        contexto.linha('Section: ' + pacote.secao);
        contexto.linha('Installed-Size: ' + pacote.instaladoKb);
        contexto.linha('Architecture: amd64');
        contexto.linha('Version: ' + e.versao);
        contexto.linha('Description: ' + pacote.descricao);
      }
      return 0;
    }
    if (opcoes.tem('i')) {
      contexto.falhar('dpkg: erro ao processar o arquivo \'' + (opcoes.valor('i') ?? '') + '\' (--install): não foi possível acessar o arquivo');
      contexto.linha('Dica: para um .deb baixado, prefira "apt install ./arquivo.deb": o apt resolve as dependências.', 'c-info');
      return 1;
    }
    contexto.falhar('dpkg: é preciso uma ação: -l (listar), -L PACOTE (arquivos), -s PACOTE (status), -i ARQUIVO.deb (instalar)');
    return 2;
  }
}
