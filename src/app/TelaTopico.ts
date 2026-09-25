import type { Tela } from './Tela';
import type { Desafio, Passo, Topico } from '../conteudo/Topico';
import type { Maquina } from '../linux/Maquina';
import type { TerminalUbuntu } from '../terminal/TerminalUbuntu';
import { Bancada } from './Bancada';
import { JanelaModal } from './JanelaModal';
import { ColaDeComandos } from './ColaDeComandos';
import { CatalogoDeTopicos } from '../conteudo/CatalogoDeTopicos';
import { Widgets } from './Widgets';
import { Aviso } from './Aviso';

/** Um card (ou o bloco de conceitos) e o intervalo dos seus passos no roteiro. */
interface Bloco {
  rotulo: string;
  titulo: string;
  inicio: number;
  fim: number;
}

const esperar = (ms: number): Promise<void> => new Promise((resolver) => window.setTimeout(resolver, ms));
const escapar = ColaDeComandos.escapar;

/**
 * Tela de estudo de um tópico: à esquerda os comandos (aula) e os desafios;
 * à direita o servidor simulado com até 3 terminais. O reprodutor digita os exemplos por você.
 */
export class TelaTopico implements Tela {
  private static readonly CHAVE_VELOCIDADE: string = 'exame-so:velocidade';

  private readonly topico: Topico;
  private readonly passos: Passo[] = [];
  private readonly blocos: Bloco[] = [];
  /** Card tocando pelo seu próprio play (null = nenhum ou o roteiro inteiro). */
  private blocoTocando: number | null = null;
  private executando: number | null = null;
  private raiz!: HTMLElement;
  private bancada!: Bancada;
  private modal: JanelaModal | null = null;
  private indice: number = -1;
  private tocando: boolean = false;
  private ocupado: boolean = false;
  private velocidade: number = 1;
  private concluidos: Set<string> = new Set();
  private readonly aoTeclar: (evento: KeyboardEvent) => void;

  constructor(topico: Topico) {
    this.topico = topico;
    const demonstracao: Passo[] = topico.demonstracao ?? [];
    if (demonstracao.length > 0) this.adicionarBloco('conceitos', 'Antes dos comandos', demonstracao);
    for (const licao of topico.licoes) this.adicionarBloco(licao.comando, licao.titulo, licao.exemplos);
    this.aoTeclar = (evento: KeyboardEvent) => this.teclar(evento);
  }

  private adicionarBloco(rotulo: string, titulo: string, passos: Passo[]): void {
    this.blocos.push({ rotulo, titulo, inicio: this.passos.length, fim: this.passos.length + passos.length });
    this.passos.push(...passos);
  }

  public montar(raiz: HTMLElement): void {
    this.raiz = raiz;
    const temAula: boolean = this.topico.licoes.length > 0;
    raiz.innerHTML =
      '<div class="tela topico" style="--destaque: var(' + this.topico.cor + ')">' +
      '  <header class="tela-cabecalho">' +
      '    <a class="botao-voltar" href="#/">← Menu</a>' +
      '    <div class="tela-titulo"><span class="tela-icone">' + this.topico.icone + '</span>' +
      '      <div><h1>' + this.topico.titulo + '</h1><p>' + this.topico.subtitulo + '</p></div></div>' +
      (temAula ?
        '    <div class="reprodutor" aria-label="Roteiro automático">' +
        '      <button class="rep-botao" data-rep="voltar" title="Volta um passo: reinicia a máquina e refaz até o anterior">⏮</button>' +
        '      <button class="rep-botao rep-play" data-rep="play" title="Executa todos os exemplos em sequência">▶</button>' +
        '      <button class="rep-botao" data-rep="avancar" title="Executa só o próximo exemplo">⏭</button>' +
        '      <div class="rep-info"><div class="rep-linha"><span class="rep-bloco"></span><span class="rep-contador"></span></div>' +
        '        <span class="rep-titulo"></span>' +
        '        <div class="rep-trilho"><div class="rep-progresso"></div></div></div>' +
        '      <select class="rep-velocidade" title="Velocidade da digitação">' +
        '        <option value="0.5">🐢 0,5×</option><option value="1">1×</option><option value="2">2×</option><option value="4">🐇 4×</option></select>' +
        '    </div>' : '') +
      '    <nav class="tela-acoes">' +
      '      <button class="botao-secundario" data-acao="cola">📋 Cola</button>' +
      '      <button class="botao-secundario" data-acao="reiniciar" title="Volta a máquina ao estado inicial do tópico">🔄 Reiniciar</button>' +
      '      <button class="botao-secundario" data-acao="exportar" title="Baixa a máquina em JSON">💾</button>' +
      '      <button class="botao-secundario" data-acao="importar" title="Carrega uma máquina em JSON">📂</button>' +
      '    </nav>' +
      '  </header>' +
      '  <main class="topico-divisao">' +
      '    <section class="topico-estudo">' +
      '      <nav class="abas-estudo" role="tablist">' +
      (temAula ? '<button class="aba-estudo ativa" data-aba="aula">📘 Comandos e dicas</button>' : '') +
      '        <button class="aba-estudo' + (temAula ? '' : ' ativa') + '" data-aba="desafios">🎯 Desafios <span class="contador-desafios"></span></button>' +
      '      </nav>' +
      '      <div class="painel-estudo" data-painel="aula"' + (temAula ? '' : ' hidden') + '></div>' +
      '      <div class="painel-estudo" data-painel="desafios"' + (temAula ? ' hidden' : '') + '></div>' +
      '    </section>' +
      '    <section class="topico-terminal">' +
      '      <div class="topico-janela"></div>' +
      '      <p class="topico-rodape">🔑 senhas: <b>root</b> = <code>123</code> · <b>ricardo</b> = <code>123</code> · ' +
      '<kbd>Tab</kbd> completa · <kbd>↑</kbd> histórico · <kbd>Ctrl</kbd>+<kbd>C</kbd> cancela · <kbd>Ctrl</kbd>+<kbd>L</kbd> limpa</p>' +
      '    </section>' +
      '  </main>' +
      '</div>';

    this.concluidos = this.lerConcluidos();
    this.bancada = new Bancada(raiz.querySelector('.topico-janela') as HTMLElement, 'topico-' + this.topico.id,
      (maquina: Maquina) => this.topico.preparar(maquina), (maquina: Maquina) => this.conferirDesafios(maquina));
    this.modal = new JanelaModal();

    if (temAula) {
      this.montarAula(raiz.querySelector('[data-painel="aula"]') as HTMLElement);
      this.ligarReprodutor();
    }
    this.montarDesafios(raiz.querySelector('[data-painel="desafios"]') as HTMLElement);
    this.conferirDesafios(this.bancada.obterMaquina());
    this.ligarAcoes();
    document.addEventListener('keydown', this.aoTeclar);
  }

  public desmontar(): void {
    this.tocando = false;
    document.removeEventListener('keydown', this.aoTeclar);
    this.bancada.destruir();
    this.modal?.destruir();
  }

  // ───────────── aula ─────────────

  private montarAula(painel: HTMLElement): void {
    let html: string = '';
    let bloco: number = 0;
    if ((this.topico.demonstracao ?? []).length > 0) {
      html += '<div class="conceitos bloco" data-bloco="0">' +
        '<div class="bloco-barra"><span class="bloco-rotulo">📖 Conceitos</span>' + this.botaoBloco(0) + '</div>' +
        this.topico.conceitos + this.naPraticaHtml(this.topico.naPratica) +
        '<div class="licao-rotulo">🧪 Veja na prática: clique para executar no terminal</div>' + this.exemplosHtml(this.blocos[0]) + '</div>';
      bloco++;
    } else {
      html += '<div class="conceitos">' + this.topico.conceitos + this.naPraticaHtml(this.topico.naPratica) + '</div>';
    }
    for (const licao of this.topico.licoes) {
      html += '<article class="licao bloco" data-bloco="' + bloco + '">' +
        '<header><code class="licao-comando">' + escapar(licao.comando) + '</code><h2>' + licao.titulo + '</h2>' +
        (licao.exemplos.length > 0 ? this.botaoBloco(bloco) : '') + '</header>' +
        '<p class="licao-descricao">' + licao.descricao + '</p>' +
        (licao.sintaxe !== '' ? '<div class="licao-sintaxe"><span>Sintaxe</span><code>' + escapar(licao.sintaxe) + '</code></div>' : '');
      if (licao.opcoes !== undefined && licao.opcoes.length > 0) {
        html += '<table class="tabela licao-opcoes">' + licao.opcoes.map(([opcao, descricao]) =>
          '<tr><td><code>' + escapar(opcao) + '</code></td><td>' + descricao + '</td></tr>').join('') + '</table>';
      }
      if (licao.extra !== undefined) {
        html += Widgets.html(licao.extra);
      }
      if (licao.exemplos.length > 0) {
        html += '<div class="licao-rotulo">▶ Exemplos: clique para executar no terminal</div>' + this.exemplosHtml(this.blocos[bloco]);
      }
      html += this.naPraticaHtml(licao.naPratica);
      if (licao.dicas !== undefined && licao.dicas.length > 0) {
        html += '<ul class="licao-dicas">' + licao.dicas.map((d: string) => '<li>' + d + '</li>').join('') + '</ul>';
      }
      if (licao.pegadinha !== undefined) {
        html += '<div class="licao-pegadinha"><b>⚠️ Cai na prova:</b> ' + licao.pegadinha + '</div>';
      }
      html += '</article>';
      bloco++;
    }
    painel.innerHTML = html;
    Widgets.ativar(painel);
    painel.querySelectorAll<HTMLElement>('.exemplo').forEach((item: HTMLElement) => {
      (item.querySelector('.exemplo-rodar') as HTMLElement).addEventListener('click', () => {
        void this.executarUm(Number(item.dataset.passo));
      });
    });
    painel.querySelectorAll<HTMLElement>('.bloco-play').forEach((botao: HTMLElement) => {
      botao.addEventListener('click', () => void this.alternarBloco(Number(botao.dataset.bloco)));
    });
  }

  private naPraticaHtml(texto: string | undefined): string {
    return texto === undefined ? '' : '<div class="na-pratica"><b>🏢 Na vida real</b><p>' + texto + '</p></div>';
  }

  private botaoBloco(indice: number): string {
    return '<button class="bloco-play" data-bloco="' + indice + '" title="Executa só os exemplos deste card">▶ Rodar este card</button>';
  }

  private exemplosHtml(bloco: Bloco): string {
    let html: string = '<ol class="exemplos">';
    for (let i: number = bloco.inicio; i < bloco.fim; i++) {
      const passo: Passo = this.passos[i];
      const terminal: number = passo.terminal ?? 1;
      html += '<li class="exemplo" data-passo="' + i + '">' +
        '<button class="exemplo-rodar" title="Executar no terminal ' + terminal + '">▶</button>' +
        '<div class="exemplo-corpo"><code class="exemplo-comando">' +
        (terminal > 1 ? '<span class="exemplo-terminal" title="Roda no terminal ' + terminal + '">T' + terminal + '</span>' : '') +
        escapar(passo.comando) + '</code>' +
        (passo.explicacao !== undefined ? '<span class="exemplo-explicacao">' + passo.explicacao + '</span>' : '') +
        '</div></li>';
    }
    return html + '</ol>';
  }

  /** Play de um card só: roda os exemplos dele do primeiro ao último (clicar de novo para). */
  private async alternarBloco(indice: number): Promise<void> {
    if (this.tocando) {
      this.tocando = false;
      this.atualizarReprodutor();
      return;
    }
    if (this.ocupado) {
      return;
    }
    const bloco: Bloco = this.blocos[indice];
    this.tocando = true;
    this.blocoTocando = indice;
    this.rolarParaBloco(indice);
    this.atualizarReprodutor();
    for (let i: number = bloco.inicio; i < bloco.fim && this.tocando; i++) {
      await this.executarUm(i);
      if (i < bloco.fim - 1) await esperar(800 / this.velocidade);
    }
    this.tocando = false;
    this.blocoTocando = null;
    this.atualizarReprodutor();
  }

  private blocoDe(passo: number): number {
    return this.blocos.findIndex((b: Bloco) => passo >= b.inicio && passo < b.fim);
  }

  private rolarParaBloco(indice: number): void {
    this.raiz.querySelector('.bloco[data-bloco="' + indice + '"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ───────────── reprodutor ─────────────

  private ligarReprodutor(): void {
    const botao = (nome: string): HTMLButtonElement => this.raiz.querySelector('[data-rep="' + nome + '"]') as HTMLButtonElement;
    botao('play').addEventListener('click', () => this.alternarPlay());
    botao('avancar').addEventListener('click', () => void this.executarUm(this.indice + 1));
    botao('voltar').addEventListener('click', () => void this.voltar());
    const seletor: HTMLSelectElement = this.raiz.querySelector('.rep-velocidade') as HTMLSelectElement;
    seletor.value = this.lerVelocidade();
    this.aplicarVelocidade(Number(seletor.value));
    seletor.addEventListener('change', () => {
      this.aplicarVelocidade(Number(seletor.value));
      try { localStorage.setItem(TelaTopico.CHAVE_VELOCIDADE, seletor.value); } catch { /* sem armazenamento */ }
    });
    this.atualizarReprodutor();
  }

  private aplicarVelocidade(velocidade: number): void {
    this.velocidade = velocidade;
    this.bancada.janela.definirVelocidade(velocidade);
  }

  private lerVelocidade(): string {
    try {
      return localStorage.getItem(TelaTopico.CHAVE_VELOCIDADE) ?? '1';
    } catch {
      return '1';
    }
  }

  private alternarPlay(): void {
    if (this.tocando) {
      this.tocando = false;
      this.atualizarReprodutor();
      return;
    }
    void this.tocar();
  }

  private async tocar(): Promise<void> {
    if (this.indice + 1 >= this.passos.length) {
      this.indice = -1;
    }
    this.tocando = true;
    this.atualizarReprodutor();
    while (this.tocando && this.indice + 1 < this.passos.length) {
      const proximo: number = this.indice + 1;
      if (proximo === this.blocos[this.blocoDe(proximo)]?.inicio) {
        this.rolarParaBloco(this.blocoDe(proximo));
        await esperar(350);
      }
      await this.executarUm(proximo);
      await esperar(900 / this.velocidade);
    }
    this.tocando = false;
    this.atualizarReprodutor();
  }

  /** Executa o passo i do roteiro no terminal que ele pede. */
  private async executarUm(i: number): Promise<void> {
    if (this.ocupado || i < 0 || i >= this.passos.length) {
      return;
    }
    this.ocupado = true;
    this.executando = i;
    this.marcarPasso(i, true);
    this.atualizarReprodutor();
    try {
      await this.rodarPasso(this.passos[i]);
      this.indice = i;
    } finally {
      this.ocupado = false;
      this.executando = null;
      this.marcarPasso(i, false);
      this.atualizarReprodutor();
    }
  }

  private async rodarPasso(passo: Passo): Promise<void> {
    const terminal: TerminalUbuntu = await this.bancada.janela.obter(passo.terminal ?? 1, passo.login);
    await terminal.executarAutomatico(passo.comando, passo.respostas ?? []);
  }

  /** ⏮: não dá para "desfazer" um comando, então reiniciamos a máquina e refazemos rápido até o passo anterior. */
  private async voltar(): Promise<void> {
    if (this.ocupado || this.indice < 0) {
      return;
    }
    this.tocando = false;
    const alvo: number = this.indice - 1;
    this.ocupado = true;
    this.bancada.reiniciar(true);
    this.bancada.janela.definirVelocidade(30);
    try {
      for (let i: number = 0; i <= alvo; i++) {
        await this.rodarPasso(this.passos[i]);
      }
    } finally {
      this.bancada.janela.definirVelocidade(this.velocidade);
      this.indice = alvo;
      this.ocupado = false;
      this.atualizarReprodutor();
      Aviso.mostrar(alvo < 0 ? '⏮ Voltou ao início (máquina reiniciada)' : '⏮ Máquina refeita até o passo ' + (alvo + 1));
    }
  }

  private marcarPasso(i: number, executando: boolean): void {
    const item: HTMLElement | null = this.raiz.querySelector('.exemplo[data-passo="' + i + '"]');
    if (item === null) return;
    item.classList.toggle('executando', executando);
    if (executando) {
      this.raiz.querySelectorAll('.exemplo.atual').forEach((e: Element) => e.classList.remove('atual'));
      item.classList.add('atual');
      window.setTimeout(() => item.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 400);
    } else {
      item.classList.add('feito');
    }
  }

  private atualizarReprodutor(): void {
    // cards: destaca o que está rodando e troca o texto do botão dele
    const alvo: number = this.executando ?? this.indice + 1;
    const blocoAtual: number = this.tocando || this.executando !== null ? this.blocoDe(alvo) : -1;
    this.raiz.querySelectorAll<HTMLElement>('.bloco').forEach((el: HTMLElement) => {
      el.classList.toggle('bloco-ativo', Number(el.dataset.bloco) === blocoAtual);
    });
    this.raiz.querySelectorAll<HTMLElement>('.bloco-play').forEach((botao: HTMLElement) => {
      const esteTocando: boolean = this.tocando && Number(botao.dataset.bloco) === (this.blocoTocando ?? blocoAtual);
      botao.textContent = esteTocando ? '⏹ Parar' : '▶ Rodar este card';
      botao.classList.toggle('tocando', esteTocando);
    });

    const play: HTMLElement | null = this.raiz.querySelector('[data-rep="play"]');
    if (play === null) return;
    const tocandoTudo: boolean = this.tocando && this.blocoTocando === null;
    play.textContent = tocandoTudo ? '⏸' : '▶';
    play.classList.toggle('pausado', !tocandoTudo);
    const indiceBloco: number = this.blocoDe(alvo);
    const bloco: Bloco | undefined = this.blocos[indiceBloco];
    const passo: Passo | undefined = this.passos[alvo];
    (this.raiz.querySelector('.rep-bloco') as HTMLElement).textContent = bloco !== undefined
      ? (this.executando !== null ? '▶ ' : 'Próximo card: ') + (indiceBloco + 1) + '/' + this.blocos.length + ' · ' + bloco.rotulo + ': ' + bloco.titulo
      : '✔ Roteiro concluído';
    (this.raiz.querySelector('.rep-titulo') as HTMLElement).textContent = passo !== undefined ? '$ ' + passo.comando : 'Aperte ▶ para recomeçar';
    (this.raiz.querySelector('.rep-contador') as HTMLElement).textContent = (this.indice + 1) + '/' + this.passos.length;
    (this.raiz.querySelector('.rep-progresso') as HTMLElement).style.setProperty('--progresso', ((this.indice + 1) / this.passos.length * 100) + '%');
    (this.raiz.querySelector('[data-rep="voltar"]') as HTMLButtonElement).disabled = this.indice < 0;
    (this.raiz.querySelector('[data-rep="avancar"]') as HTMLButtonElement).disabled = this.indice + 1 >= this.passos.length;
  }

  private teclar(evento: KeyboardEvent): void {
    const alvo: HTMLElement | null = evento.target as HTMLElement | null;
    if (alvo !== null && (alvo.closest('.term') !== null || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) {
      return;
    }
    if (this.topico.licoes.length === 0 || this.modal === null) return;
    if (evento.key === 'ArrowRight') { evento.preventDefault(); void this.executarUm(this.indice + 1); }
    if (evento.key === 'ArrowLeft') { evento.preventDefault(); void this.voltar(); }
    if (evento.key === ' ') { evento.preventDefault(); this.alternarPlay(); }
  }

  // ───────────── desafios ─────────────

  private montarDesafios(painel: HTMLElement): void {
    let html: string = '<p class="desafios-intro">Resolva digitando no terminal. Cada desafio é conferido <b>automaticamente</b> depois de cada comando, olhando o estado real da máquina. ' +
      'Travou? Abra a dica. Ainda travou? Veja a solução e execute.</p><ol class="desafios">';
    this.topico.desafios.forEach((desafio: Desafio, i: number) => {
      html += '<li class="desafio" data-desafio="' + desafio.id + '">' +
        '<span class="desafio-status" aria-hidden="true"></span>' +
        '<div class="desafio-corpo"><p class="desafio-enunciado"><b>' + (i + 1) + '.</b> ' + desafio.enunciado + '</p>' +
        '<details><summary>💡 Dica</summary><p>' + desafio.dica + '</p></details>' +
        '<details><summary>👀 Solução</summary><pre class="desafio-solucao">' +
        desafio.solucao.map((p: Passo) => ((p.terminal ?? 1) > 1 ? '[T' + p.terminal + '] ' : '') + escapar(p.comando)).join('\n') +
        '</pre><button class="botao-secundario desafio-rodar">▶ Executar a solução</button></details></div></li>';
    });
    html += '</ol>';
    painel.innerHTML = html;
    painel.querySelectorAll<HTMLElement>('.desafio').forEach((item: HTMLElement) => {
      const desafio: Desafio | undefined = this.topico.desafios.find((d: Desafio) => d.id === item.dataset.desafio);
      item.querySelector('.desafio-rodar')?.addEventListener('click', () => {
        if (desafio !== undefined) void this.rodarSolucao(desafio);
      });
    });
  }

  private async rodarSolucao(desafio: Desafio): Promise<void> {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      for (const passo of desafio.solucao) await this.rodarPasso(passo);
    } finally {
      this.ocupado = false;
    }
  }

  private conferirDesafios(maquina: Maquina): void {
    let mudou: boolean = false;
    for (const desafio of this.topico.desafios) {
      let ok: boolean = false;
      try {
        ok = desafio.verificar(maquina);
      } catch {
        ok = false;
      }
      if (ok && !this.concluidos.has(desafio.id)) {
        this.concluidos.add(desafio.id);
        mudou = true;
        Aviso.mostrar('🎯 Desafio concluído!');
      }
    }
    if (mudou) this.salvarConcluidos();
    this.raiz.querySelectorAll<HTMLElement>('.desafio').forEach((item: HTMLElement) => {
      item.classList.toggle('concluido', this.concluidos.has(item.dataset.desafio ?? ''));
    });
    const contador: HTMLElement | null = this.raiz.querySelector('.contador-desafios');
    if (contador !== null) contador.textContent = this.concluidos.size + '/' + this.topico.desafios.length;
  }

  private chaveDesafios(): string {
    return 'exame-so:desafios:' + this.topico.id;
  }

  private lerConcluidos(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(this.chaveDesafios()) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }

  private salvarConcluidos(): void {
    try {
      localStorage.setItem(this.chaveDesafios(), JSON.stringify(Array.from(this.concluidos)));
    } catch {
      // sem armazenamento
    }
  }

  // ───────────── botões do cabeçalho e abas ─────────────

  private ligarAcoes(): void {
    this.raiz.querySelectorAll<HTMLElement>('.aba-estudo').forEach((aba: HTMLElement) => {
      aba.addEventListener('click', () => {
        this.raiz.querySelectorAll('.aba-estudo').forEach((a: Element) => a.classList.toggle('ativa', a === aba));
        this.raiz.querySelectorAll<HTMLElement>('.painel-estudo').forEach((p: HTMLElement) => {
          p.hidden = p.dataset.painel !== aba.dataset.aba;
        });
      });
    });
    const acao = (nome: string, fazer: () => void): void => {
      this.raiz.querySelector('[data-acao="' + nome + '"]')?.addEventListener('click', fazer);
    };
    acao('cola', () => this.modal?.abrir('📋 Cola de comandos', ColaDeComandos.html(new CatalogoDeTopicos().listar())));
    acao('exportar', () => this.bancada.exportar());
    acao('importar', () => void this.bancada.importar());
    acao('reiniciar', () => {
      if (!window.confirm('Reiniciar a máquina deste tópico? Tudo o que foi criado aqui será apagado e os desafios voltam a ficar pendentes.')) return;
      this.tocando = false;
      this.concluidos.clear();
      this.salvarConcluidos();
      this.indice = -1;
      this.raiz.querySelectorAll('.exemplo').forEach((e: Element) => e.classList.remove('feito', 'atual'));
      this.bancada.reiniciar();
      this.atualizarReprodutor();
    });
  }
}
