import type { Tela } from './Tela';
import type { Desafio, ModalidadeSimulado, Passo, QuestaoQuiz } from '../conteudo/Topico';
import type { Maquina } from '../linux/Maquina';
import { Bancada } from './Bancada';
import { modalidades } from '../conteudo/simulado';
import { ColaDeComandos } from './ColaDeComandos';
import { Aviso } from './Aviso';

type FaseSimulado = 'hub' | 'pre-prova' | 'prova' | 'relatorio';

interface EstadoQuestao {
  id: string;
  concluida: boolean;
  pulada: boolean;
  usouSolucao?: boolean;
  tempoSegundos: number;
  respostaQuiz?: number;
}

const escapar = ColaDeComandos.escapar;

const formatarMinSeg = (segundos: number): string => {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};

const formatarExtenso = (segundos: number): string => {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
};

/**
 * Tela dedicada para Simulados e Exames Práticos:
 * - Hub de escolha de modalidade
 * - Pré-prova com objetivo, regras e botão de iniciar
 * - Exame cronometrado (30 min) com tempo individual por questão
 * - Avisos aos 10, 5, 2 e 1 minuto restante
 * - 30 segundos de margem de tolerância ao término do tempo oficial
 * - Validação automática em tempo real, animação comemorativa do pinguim e trava
 * - Relatório final detalhado com placar e tempos por exercício
 */
export class TelaSimulado implements Tela {
  private raiz!: HTMLElement;
  private fase: FaseSimulado = 'hub';
  private modalidadeSelecionada: ModalidadeSimulado = modalidades[0];
  private bancada: Bancada | null = null;

  // Estado do exame
  private tempoRestanteGeral: number = 30 * 60; // 30 minutos em segundos
  private tempoMargemExtra: number = 30; // 30 segundos de margem de tolerância
  private emMargemExtra: boolean = false;
  private avisosEmitidos: Set<number> = new Set();
  private timerBannerAviso: number | null = null;
  private intervaloTimer: number | null = null;
  private indiceQuestaoAtiva: number = 0;
  private estadosQuestoes: Map<string, EstadoQuestao> = new Map();
  private solucoesReveladas: Set<string> = new Set();
  private executandoSolucao: boolean = false;
  private modoRevisao: boolean = false;
  private animandoPinguim: boolean = false;
  private entregueManualmente: boolean = false;

  public montar(raiz: HTMLElement): void {
    this.raiz = raiz;
    this.renderizar();
  }

  public desmontar(): void {
    this.pararTimer();
    if (this.timerBannerAviso !== null) {
      clearTimeout(this.timerBannerAviso);
      this.timerBannerAviso = null;
    }
    this.bancada?.destruir();
    this.bancada = null;
  }

  private renderizar(): void {
    this.pararTimer();
    this.bancada?.destruir();
    this.bancada = null;

    switch (this.fase) {
      case 'hub':
        this.renderizarHub();
        break;
      case 'pre-prova':
        this.renderizarPreProva();
        break;
      case 'prova':
        this.renderizarProva();
        break;
      case 'relatorio':
        this.renderizarRelatorio();
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FASE 1: HUB DE SIMULADOS (Menu Inicial)
  // ══════════════════════════════════════════════════════════════════

  private renderizarHub(): void {
    let cardsHtml: string = '';
    for (const mod of modalidades) {
      const totalItens = (mod.desafios?.length ?? 0) || (mod.questoes?.length ?? 0);
      const tipo = mod.questoes ? 'questões teóricas' : 'tarefas práticas';
      cardsHtml += `
        <div class="sim-hub-card" data-mod="${mod.id}">
          <div class="sim-hub-card-topo">
            <span class="sim-hub-card-ico">${mod.icone}</span>
            ${mod.badge ? `<span class="sim-hub-card-badge">${mod.badge}</span>` : ''}
          </div>
          <h2>${mod.titulo}</h2>
          <p class="sim-hub-card-desc">${mod.descricao}</p>
          <div class="sim-hub-card-meta">
            <span>⏱️ 30 minutos</span>
            <span>🎯 ${totalItens} ${tipo}</span>
          </div>
          <button class="botao-primario sim-hub-card-btn">Acessar Prova →</button>
        </div>
      `;
    }

    this.raiz.innerHTML = `
      <div class="tela-simulado sim-hub">
        <header class="sim-hub-cabecalho">
          <a class="botao-voltar" href="#/">← Menu Principal</a>
          <div class="sim-hub-titulos">
            <span class="menu-selo">Simulador Oficial de Exame · Modo Prova</span>
            <h1>Simulados de Certificação Linux 🐧</h1>
            <p>Escolha o nível ou exame desejado para realizar uma prova cronometrada de <b>30 minutos</b> com validação em tempo real e relatório de desempenho.</p>
          </div>
        </header>
        <div class="sim-hub-grid">
          ${cardsHtml}
        </div>
      </div>
    `;

    this.raiz.querySelectorAll<HTMLElement>('.sim-hub-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.mod;
        const encontrada = modalidades.find((m) => m.id === id);
        if (encontrada) {
          this.modalidadeSelecionada = encontrada;
          this.fase = 'pre-prova';
          this.renderizar();
          window.scrollTo(0, 0);
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // FASE 2: TELA DE PRÉ-PROVA (Objetivo, Regras e Iniciar)
  // ══════════════════════════════════════════════════════════════════

  private renderizarPreProva(): void {
    const mod = this.modalidadeSelecionada;
    const totalItens = (mod.desafios?.length ?? 0) || (mod.questoes?.length ?? 0);
    const tipo = mod.questoes ? 'questões de múltipla escolha' : 'desafios práticos no terminal';

    this.raiz.innerHTML = `
      <div class="tela-simulado sim-pre-prova">
        <div class="sim-pre-container">
          <header class="sim-pre-cabecalho">
            <button class="botao-secundario btn-voltar-hub">← Voltar aos Simulados</button>
            <div class="sim-pre-identificacao">
              <span class="sim-pre-ico">${mod.icone}</span>
              <div>
                <h2>${mod.titulo}</h2>
                ${mod.badge ? `<span class="sim-hub-card-badge">${mod.badge}</span>` : ''}
              </div>
            </div>
          </header>

          <main class="sim-pre-card">
            <section class="sim-pre-secao">
              <h3>🎯 Objetivo da Prova</h3>
              <p>${mod.objetivo ?? mod.descricao}</p>
            </section>

            <section class="sim-pre-secao">
              <h3>📋 Instruções e Regras do Exame</h3>
              <div class="sim-regras-grid">
                <div class="sim-regra">
                  <span class="sim-regra-ico">⏱️</span>
                  <div>
                    <b>Tempo limite geral: 30 minutos</b>
                    <p>O cronômetro regressivo começará assim que você clicar em iniciar.</p>
                  </div>
                </div>
                <div class="sim-regra">
                  <span class="sim-regra-ico">⏳</span>
                  <div>
                    <b>Tempo individual por questão</b>
                    <p>Ao mudar de questão, o tempo da questão anterior pausa e o da nova retoma.</p>
                  </div>
                </div>
                <div class="sim-regra">
                  <span class="sim-regra-ico">🔒</span>
                  <div>
                    <b>Validação e trava automática</b>
                    <p>Ao realizar a operação correta no terminal, o sistema valida, comemora com o pinguim 🐧, trava a questão e avança para a próxima pendente.</p>
                  </div>
                </div>
                <div class="sim-regra">
                  <span class="sim-regra-ico">⏭️</span>
                  <div>
                    <b>Pular questões</b>
                    <p>Se tiver dúvida em alguma tarefa, use o botão "Pular questão" para resolvê-la mais tarde.</p>
                  </div>
                </div>
              </div>
            </section>

            <div class="sim-pre-resumo-meta">
              <span><b>Estrutura:</b> ${totalItens} ${tipo}</span>
              <span><b>Duração:</b> 30 minutos</span>
              <span><b>Aprovação recomendada:</b> 70% de acertos</span>
            </div>

            <footer class="sim-pre-rodape">
              <button class="botao-secundario btn-voltar-hub">Cancelar</button>
              <button class="botao-primario btn-iniciar-prova">🚀 Iniciar Prova Agora</button>
            </footer>
          </main>
        </div>
      </div>
    `;

    this.raiz.querySelectorAll('.btn-voltar-hub').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.fase = 'hub';
        this.renderizar();
        window.scrollTo(0, 0);
      });
    });

    this.raiz.querySelector('.btn-iniciar-prova')?.addEventListener('click', () => {
      this.iniciarExame();
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // FASE 3: MODO EXAME (Prova em Andamento)
  // ══════════════════════════════════════════════════════════════════

  private iniciarExame(): void {
    const mod = this.modalidadeSelecionada;
    this.tempoRestanteGeral = 30 * 60; // 30 minutos
    this.tempoMargemExtra = 30; // 30 segundos de margem de tolerância
    this.emMargemExtra = false;
    this.avisosEmitidos.clear();
    this.indiceQuestaoAtiva = 0;
    this.solucoesReveladas.clear();
    this.modoRevisao = false;
    this.estadosQuestoes.clear();
    this.animandoPinguim = false;
    this.entregueManualmente = false;

    const lista = mod.desafios ?? mod.questoes ?? [];
    for (const item of lista) {
      this.estadosQuestoes.set(item.id, {
        id: item.id,
        concluida: false,
        pulada: false,
        tempoSegundos: 0,
      });
    }

    this.fase = 'prova';
    this.renderizar();
    this.iniciarTimer();
  }

  public iniciarModoRevisao(indice: number = 0): void {
    this.pararTimer();
    this.modoRevisao = true;
    this.fase = 'prova';
    this.indiceQuestaoAtiva = indice;
    const itens = this.obterItens();
    if (itens[indice]) {
      this.solucoesReveladas.add(itens[indice].id);
    }
    this.renderizar();
    window.scrollTo(0, 0);
  }

  private iniciarTimer(): void {
    this.pararTimer();
    this.intervaloTimer = window.setInterval(() => {
      if (!this.emMargemExtra) {
        if (this.tempoRestanteGeral > 0) {
          this.tempoRestanteGeral--;

          // Avisos aos 10, 5, 2 e 1 minuto restante
          if (this.tempoRestanteGeral === 600 && !this.avisosEmitidos.has(600)) {
            this.avisosEmitidos.add(600);
            Aviso.mostrar('⚠️ Atenção: Restam 10 minutos para o término da prova!');
            this.exibirBannerAviso('⚠️ Restam 10 minutos para o término da prova.');
          } else if (this.tempoRestanteGeral === 300 && !this.avisosEmitidos.has(300)) {
            this.avisosEmitidos.add(300);
            Aviso.mostrar('⚠️ Atenção: Restam 5 minutos! Revise as questões pendentes.');
            this.exibirBannerAviso('⚠️ Restam 5 minutos! Revise as tarefas pendentes.');
          } else if (this.tempoRestanteGeral === 120 && !this.avisosEmitidos.has(120)) {
            this.avisosEmitidos.add(120);
            Aviso.mostrar('⚠️ Restam 2 minutos para o encerramento da prova!');
            this.exibirBannerAviso('⚠️ Restam apenas 2 minutos de prova!');
          } else if (this.tempoRestanteGeral === 60 && !this.avisosEmitidos.has(60)) {
            this.avisosEmitidos.add(60);
            Aviso.mostrar('⚠️ Resta apenas 1 minuto! O tempo de 30 minutos está acabando.');
            this.exibirBannerAviso('⚠️ Resta 1 minuto! Prepare-se para a entrega da prova.');
          }

          // Contabiliza tempo da questão ativa se não estiver concluída
          const questaoAtual = this.obterItemAtual();
          if (questaoAtual) {
            const estado = this.estadosQuestoes.get(questaoAtual.id);
            if (estado && !estado.concluida) {
              estado.tempoSegundos++;
            }
          }

          this.atualizarDisplaysDeTempo();

          if (this.tempoRestanteGeral === 0) {
            // Tempo esgotado: entra na margem de tolerância de 30 segundos
            this.emMargemExtra = true;
            Aviso.mostrar('⏳ Tempo oficial esgotado! Você tem 30 segundos de tolerância final!');
            this.atualizarBannerTolerancia();
            this.atualizarDisplaysDeTempo();
          }
        }
      } else {
        // Modo margem de tolerância extra (30 segundos)
        if (this.tempoMargemExtra > 0) {
          this.tempoMargemExtra--;

          const questaoAtual = this.obterItemAtual();
          if (questaoAtual) {
            const estado = this.estadosQuestoes.get(questaoAtual.id);
            if (estado && !estado.concluida) {
              estado.tempoSegundos++;
            }
          }

          this.atualizarBannerTolerancia();
          this.atualizarDisplaysDeTempo();

          if (this.tempoMargemExtra === 0) {
            // Encerra definitivamente a prova e mostra o relatório
            this.finalizarProva();
          }
        }
      }
    }, 1000);
  }

  private pararTimer(): void {
    if (this.intervaloTimer !== null) {
      clearInterval(this.intervaloTimer);
      this.intervaloTimer = null;
    }
  }

  private atualizarDisplaysDeTempo(): void {
    const elGeral = this.raiz.querySelector('.sim-tempo-geral') as HTMLElement | null;
    if (elGeral) {
      if (this.emMargemExtra) {
        elGeral.textContent = `⏳ Margem: ${this.tempoMargemExtra}s`;
        elGeral.className = 'sim-tempo-geral tempo-margem';
      } else {
        elGeral.textContent = `⏱️ ${formatarMinSeg(this.tempoRestanteGeral)}`;
        if (this.tempoRestanteGeral <= 60) {
          elGeral.className = 'sim-tempo-geral tempo-critico';
        } else if (this.tempoRestanteGeral <= 300) {
          elGeral.className = 'sim-tempo-geral tempo-alerta';
        } else {
          elGeral.className = 'sim-tempo-geral';
        }
      }
    }

    const questaoAtual = this.obterItemAtual();
    if (questaoAtual) {
      const estado = this.estadosQuestoes.get(questaoAtual.id);
      const elQuestao = this.raiz.querySelector('.sim-tempo-questao-valor') as HTMLElement | null;
      if (elQuestao && estado) {
        elQuestao.textContent = formatarMinSeg(estado.tempoSegundos);
      }
    }
  }

  private exibirBannerAviso(texto: string): void {
    const banner = this.raiz.querySelector('.sim-banner-aviso') as HTMLElement | null;
    const bannerTexto = this.raiz.querySelector('.sim-banner-aviso-texto') as HTMLElement | null;
    if (!banner || !bannerTexto) return;

    if (this.timerBannerAviso !== null) {
      clearTimeout(this.timerBannerAviso);
      this.timerBannerAviso = null;
    }

    bannerTexto.textContent = texto;
    banner.hidden = false;
    banner.className = 'sim-banner-aviso visivel';

    this.timerBannerAviso = window.setTimeout(() => {
      if (!this.emMargemExtra) {
        banner.classList.remove('visivel');
        banner.hidden = true;
      }
    }, 6000);
  }

  private atualizarBannerTolerancia(): void {
    const banner = this.raiz.querySelector('.sim-banner-aviso') as HTMLElement | null;
    const bannerTexto = this.raiz.querySelector('.sim-banner-aviso-texto') as HTMLElement | null;
    if (!banner || !bannerTexto) return;

    banner.hidden = false;
    banner.className = 'sim-banner-aviso banner-tolerancia visivel';
    bannerTexto.innerHTML = `⏳ <b>Tempo oficial de 30 minutos esgotado!</b> Margem de tolerância: <b>${this.tempoMargemExtra} segundos restantes</b>. Conclua seus comandos e finalize a prova!`;
  }

  private obterItens(): Array<Desafio | QuestaoQuiz> {
    const mod = this.modalidadeSelecionada;
    return mod.desafios ?? mod.questoes ?? [];
  }

  private obterItemAtual(): Desafio | QuestaoQuiz | undefined {
    const itens = this.obterItens();
    return itens[this.indiceQuestaoAtiva];
  }

  private renderizarProva(): void {
    const mod = this.modalidadeSelecionada;
    const ehQuiz = mod.questoes !== undefined && mod.questoes.length > 0;

    this.raiz.innerHTML = `
      <div class="tela-simulado sim-modo-prova ${ehQuiz ? 'prova-teorica' : 'prova-pratica'}">
        <header class="sim-prova-cabecalho ${this.modoRevisao ? 'barra-modo-revisao' : ''}">
          <div class="sim-prova-esquerda">
            ${
              this.modoRevisao
                ? '<button class="botao-secundario btn-voltar-relatorio-topo">← Voltar ao Relatório</button>'
                : '<button class="botao-secundario btn-abandonar-prova" title="Abandonar a prova">← Abandonar</button>'
            }
            <div class="sim-prova-titulo">
              <span class="sim-prova-ico">${this.modoRevisao ? '🎓' : mod.icone}</span>
              <h2>${this.modoRevisao ? `Revisão Prática · ${mod.titulo}` : mod.titulo}</h2>
              <span class="sim-prova-contador-resumo"></span>
            </div>
          </div>

          <div class="sim-prova-direita">
            ${
              this.modoRevisao
                ? `
                  <div class="sim-tempo-geral modo-revisao-tag" title="Sem limite de tempo no modo revisão">
                    📖 Modo Revisão Livre
                  </div>
                  <button class="botao-primario btn-voltar-relatorio-topo" title="Voltar ao relatório">📋 Relatório</button>
                `
                : `
                  <div class="sim-tempo-geral" title="Tempo restante da prova">
                    ⏱️ ${formatarMinSeg(this.tempoRestanteGeral)}
                  </div>
                  <button class="botao-primario btn-entregar-prova" title="Finalizar a prova e ver o relatório de desempenho">🏁 Finalizar Prova</button>
                `
            }
          </div>
        </header>

        <div class="sim-banner-aviso" hidden>
          <span class="sim-banner-aviso-texto"></span>
        </div>

        <main class="sim-prova-divisao">
          <section class="sim-prova-estudo">
            <nav class="sim-questoes-nav" aria-label="Navegação de questões"></nav>
            <div class="sim-questao-ativa-container"></div>
            <div class="sim-prova-estudo-rodape">
              ${
                this.modoRevisao
                  ? '<button class="botao-primario btn-voltar-relatorio-rodape">📋 Voltar ao Relatório de Desempenho</button>'
                  : '<button class="botao-secundario btn-entregar-prova-rodape">🏁 Finalizar Prova</button>'
              }
            </div>
            <!-- Overlay comemorativo do pinguim -->
            <div class="sim-pinguim-overlay" aria-hidden="true" hidden>
              <div class="sim-pinguim-card">
                <div class="pinguim-animado">🐧✨</div>
                <h3>Excelente! Questão Concluída!</h3>
                <p class="sim-pinguim-msg-tempo"></p>
                <div class="sim-pinguim-barra"></div>
              </div>
            </div>
          </section>

          ${
            ehQuiz
              ? ''
              : `
            <section class="sim-prova-terminal">
              <div class="sim-terminal-janela"></div>
              <p class="topico-rodape">🔑 senhas: <b>root</b> = <code>123</code> · <b>ricardo</b> = <code>123</code> · <kbd>Tab</kbd> completa · <kbd>Ctrl</kbd>+<kbd>C</kbd> cancela</p>
            </section>
          `
          }
        </main>
      </div>
    `;

    // Inicializa a Bancada de terminais se for prova prática
    if (!ehQuiz) {
      const containerJanela = this.raiz.querySelector('.sim-terminal-janela') as HTMLElement;
      this.bancada = new Bancada(
        containerJanela,
        `simulado-exame-${mod.id}`,
        (maquina: Maquina) => {
          mod.preparar?.(maquina);
        },
        (maquina: Maquina) => {
          this.verificarComandoMaquina(maquina);
        },
      );
    }

    this.renderizarBotoesQuestoes();
    this.renderizarQuestaoAtiva();

    this.raiz.querySelectorAll('.btn-voltar-relatorio-topo, .btn-voltar-relatorio-rodape').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.fase = 'relatorio';
        this.modoRevisao = false;
        this.renderizar();
        window.scrollTo(0, 0);
      });
    });

    this.raiz.querySelector('.btn-abandonar-prova')?.addEventListener('click', () => {
      if (confirm('Tem certeza de que deseja abandonar a prova em andamento? O progresso desta tentativa será cancelado.')) {
        this.fase = 'hub';
        this.renderizar();
        window.scrollTo(0, 0);
      }
    });

    const confirmarFinalizacao = (): void => {
      const concluidas = Array.from(this.estadosQuestoes.values()).filter((e) => e.concluida && !e.usouSolucao).length;
      const total = this.obterItens().length;
      if (
        confirm(
          `Deseja realmente finalizar a prova agora?\n\nVocê concluiu ${concluidas} de ${total} tarefas de forma autônoma.\nAo confirmar, a prova será entregue e o relatório final será gerado.`,
        )
      ) {
        this.entregueManualmente = true;
        this.finalizarProva();
      }
    };

    this.raiz.querySelector('.btn-entregar-prova')?.addEventListener('click', confirmarFinalizacao);
    this.raiz.querySelector('.btn-entregar-prova-rodape')?.addEventListener('click', confirmarFinalizacao);
  }

  private renderizarBotoesQuestoes(): void {
    const nav = this.raiz.querySelector('.sim-questoes-nav') as HTMLElement | null;
    if (!nav) return;

    const itens = this.obterItens();
    let html = '';
    itens.forEach((item, index) => {
      const estado = this.estadosQuestoes.get(item.id);
      let statusClass = 'pendente';
      let icon = `${index + 1}`;
      if (estado?.concluida) {
        statusClass = 'concluida';
        icon = '✓';
      } else if (estado?.pulada) {
        statusClass = 'pulada';
        icon = '⏭';
      }

      const ehAtiva = index === this.indiceQuestaoAtiva ? ' ativa' : '';
      html += `
        <button class="sim-btn-questao ${statusClass}${ehAtiva}" data-idx="${index}" title="Questão ${index + 1}">
          <span class="sim-btn-questao-num">${icon}</span>
        </button>
      `;
    });

    nav.innerHTML = html;

    nav.querySelectorAll<HTMLButtonElement>('.sim-btn-questao').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (!isNaN(idx) && idx !== this.indiceQuestaoAtiva) {
          this.trocarQuestaoAtiva(idx);
        }
      });
    });

    // Atualiza contador resumo no cabeçalho
    const concluidas = Array.from(this.estadosQuestoes.values()).filter((e) => e.concluida).length;
    const resumo = this.raiz.querySelector('.sim-prova-contador-resumo');
    if (resumo) {
      resumo.textContent = `· ${concluidas}/${itens.length} concluídas`;
    }
  }

  private trocarQuestaoAtiva(novoIndex: number): void {
    this.indiceQuestaoAtiva = novoIndex;
    this.renderizarBotoesQuestoes();
    this.renderizarQuestaoAtiva();
  }

  private renderizarQuestaoAtiva(): void {
    const container = this.raiz.querySelector('.sim-questao-ativa-container') as HTMLElement | null;
    if (!container) return;

    const itens = this.obterItens();
    const item = itens[this.indiceQuestaoAtiva];
    if (!item) return;

    const estado = this.estadosQuestoes.get(item.id) ?? {
      id: item.id,
      concluida: false,
      pulada: false,
      tempoSegundos: 0,
    };

    const ehQuiz = 'opcoes' in item;

    let corpoHtml = '';
    if (ehQuiz) {
      const q = item as QuestaoQuiz;
      corpoHtml = `
        <div class="sim-quiz-opcoes">
          ${q.opcoes
            .map((opcao, optIdx) => {
              const letra = ['A', 'B', 'C', 'D'][optIdx] ?? String(optIdx + 1);
              let classe = 'sim-quiz-opcao';
              if (estado.concluida) {
                if (optIdx === q.correta) classe += ' correta';
                else if (estado.respostaQuiz === optIdx) classe += ' errada';
              }
              return `
                <button class="${classe}" data-opt="${optIdx}" ${estado.concluida ? 'disabled' : ''}>
                  <span class="quiz-letra">${letra}</span>
                  <span class="quiz-texto">${opcao}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="sim-card-questao ${estado.concluida ? 'questao-travada' : ''}">
        <div class="sim-questao-header">
          <div class="sim-questao-status-tag">
            <span class="tag-numero">Questão ${this.indiceQuestaoAtiva + 1} de ${itens.length}</span>
            ${
              estado.concluida
                ? '<span class="tag-status concluida">🔒 Concluída e Travada</span>'
                : estado.pulada
                  ? '<span class="tag-status pulada">⏭️ Pulada</span>'
                  : '<span class="tag-status em-andamento">⏱️ Em andamento</span>'
            }
          </div>
          <div class="sim-tempo-questao">
            <span class="sim-tempo-questao-rotulo">Tempo na questão:</span>
            <span class="sim-tempo-questao-valor">${formatarMinSeg(estado.tempoSegundos)}</span>
          </div>
        </div>

        <div class="sim-questao-enunciado">
          <p>${'enunciado' in item ? item.enunciado : (item as QuestaoQuiz).pergunta}</p>
        </div>

        ${corpoHtml}

        ${
          estado.concluida
            ? `
          <div class="sim-sucesso-trava">
            <span class="sim-sucesso-ico">✅</span>
            <div>
              <b>${estado.usouSolucao ? 'Tarefa resolvida com a solução!' : 'Tarefa concluída com sucesso!'}</b>
              <p>Esta questão está travada e pontuada com o tempo de <b>${formatarExtenso(estado.tempoSegundos)}</b>.</p>
            </div>
          </div>
          ${
            'solucao' in item
              ? `
            <details class="sim-dica-detalhe sim-solucao-concluida-detalhe" ${this.solucoesReveladas.has(item.id) ? 'open' : ''}>
              <summary>👀 Ver solução recomendada</summary>
              <div class="sim-bloco-solucao-ativa">
                <div class="sim-solucao-topo">
                  <span class="sim-solucao-rotulo">💻 Comando da solução:</span>
                  <button class="botao-secundario btn-reproduzir-solucao" data-idx="${this.indiceQuestaoAtiva}" title="Executar comandos no terminal ao lado">
                    ▶ Reproduzir no Terminal
                  </button>
                </div>
                <div class="sim-solucao-comandos-container">
                  <pre class="sim-solucao-codigo">${item.solucao.map((p) => ((p.terminal ?? 1) > 1 ? `[T${p.terminal}] ` : '') + escapar(p.comando)).join('\n')}</pre>
                </div>
                ${item.dica ? `<p class="sim-solucao-dica">📖 <i>${escapar(item.dica)}</i></p>` : ''}
              </div>
            </details>
          `
              : ''
          }
        `
            : `
          <div class="sim-questao-acoes">
            <div class="sim-acoes-linha">
              <button class="botao-secundario btn-pular-questao">⏭️ Pular questão / Não sei agora</button>
              ${
                'solucao' in item
                  ? `
                <button class="botao-secundario btn-ver-solucao" title="Mostrar comando abaixo da questão e reproduzir no terminal ao lado">
                  👀 Ver Solução & Reproduzir no Terminal
                </button>
              `
                  : ''
              }
            </div>

            ${
              'dica' in item && item.dica
                ? `
              <details class="sim-dica-detalhe">
                <summary>💡 Dica do exame</summary>
                <p>${item.dica}</p>
              </details>
            `
                : ''
            }

            ${
              'solucao' in item
                ? `
              <div class="sim-bloco-solucao-ativa" id="solucao-bloco-${item.id}" ${this.solucoesReveladas.has(item.id) ? '' : 'hidden'}>
                <div class="sim-solucao-topo">
                  <span class="sim-solucao-rotulo">💻 Solução recomendada:</span>
                  <button class="botao-secundario btn-reproduzir-solucao" data-idx="${this.indiceQuestaoAtiva}" title="Executar comandos no terminal ao lado">
                    ▶ Reproduzir no Terminal
                  </button>
                </div>
                <div class="sim-solucao-comandos-container">
                  <pre class="sim-solucao-codigo">${item.solucao.map((p) => ((p.terminal ?? 1) > 1 ? `[T${p.terminal}] ` : '') + escapar(p.comando)).join('\n')}</pre>
                </div>
                ${item.dica ? `<p class="sim-solucao-dica">📖 <i>${escapar(item.dica)}</i></p>` : ''}
              </div>
            `
                : ''
            }
          </div>
        `
        }
      </div>
    `;

    // Eventos
    container.querySelector('.btn-pular-questao')?.addEventListener('click', () => {
      this.pularQuestaoAtiva();
    });

    container.querySelector('.btn-ver-solucao')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!('solucao' in item)) return;

      this.solucoesReveladas.add(item.id);
      if (!estado.concluida) {
        estado.usouSolucao = true;
      }

      const bloco = container.querySelector(`#solucao-bloco-${item.id}`) as HTMLElement | null;
      if (bloco) {
        bloco.hidden = false;
        bloco.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      await this.reproduzirSolucaoNoTerminal((item as Desafio).solucao, btn);
    });

    container.querySelectorAll<HTMLButtonElement>('.btn-reproduzir-solucao').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!('solucao' in item)) return;
        await this.reproduzirSolucaoNoTerminal((item as Desafio).solucao, btn);
      });
    });

    if (ehQuiz) {
      container.querySelectorAll<HTMLButtonElement>('.sim-quiz-opcao').forEach((btn) => {
        btn.addEventListener('click', () => {
          const opt = Number(btn.dataset.opt);
          this.responderQuizOpcao(item as QuestaoQuiz, opt);
        });
      });
    }
  }

  private async reproduzirSolucaoNoTerminal(passos: Passo[], botao?: HTMLButtonElement | null): Promise<void> {
    if (!this.bancada || this.executandoSolucao) return;
    this.executandoSolucao = true;
    const textoOriginal = botao?.innerHTML ?? '';
    if (botao) {
      botao.disabled = true;
      botao.innerHTML = '⏳ Digitando no terminal...';
    }

    try {
      for (let i = 0; i < passos.length; i++) {
        const p = passos[i];
        const terminal: TerminalUbuntu = await this.bancada.janela.obter(p.terminal ?? 1, p.login);
        await terminal.executarAutomatico(p.comando, p.respostas ?? []);
        if (i < passos.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
    } catch (e) {
      console.error('Erro ao reproduzir comando no terminal:', e);
    } finally {
      this.executandoSolucao = false;
      if (botao) {
        botao.disabled = false;
        botao.innerHTML = textoOriginal;
      }
    }
  }

  private avancarParaProximaPendente(): void {
    const itens = this.obterItens();
    // Procura primeiro a partir da questão seguinte
    let proximo = -1;
    for (let i = this.indiceQuestaoAtiva + 1; i < itens.length; i++) {
      const e = this.estadosQuestoes.get(itens[i].id);
      if (e && !e.concluida) {
        proximo = i;
        break;
      }
    }
    // Se não achou na frente, procura do início até a atual
    if (proximo === -1) {
      for (let i = 0; i < this.indiceQuestaoAtiva; i++) {
        const e = this.estadosQuestoes.get(itens[i].id);
        if (e && !e.concluida) {
          proximo = i;
          break;
        }
      }
    }

    if (proximo !== -1) {
      this.trocarQuestaoAtiva(proximo);
    } else {
      this.renderizarBotoesQuestoes();
      this.renderizarQuestaoAtiva();
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // FASE 4: RELATÓRIO FINAL DE DESEMPENHO
  // ══════════════════════════════════════════════════════════════════

  private finalizarProva(): void {
    this.pararTimer();
    this.fase = 'relatorio';
    this.renderizar();
    window.scrollTo(0, 0);
  }

  private renderizarRelatorio(): void {
    const mod = this.modalidadeSelecionada;
    const itens = this.obterItens();
    const totalItens = itens.length;
    const concluidasSozinho = Array.from(this.estadosQuestoes.values()).filter((e) => e.concluida && !e.usouSolucao).length;
    const resolvidasComSolucao = Array.from(this.estadosQuestoes.values()).filter((e) => e.usouSolucao).length;
    const porcentagem = totalItens > 0 ? Math.round((concluidasSozinho / totalItens) * 100) : 0;
    const aprovado = porcentagem >= 70;
    const tempoGeralUtilizado = 30 * 60 - this.tempoRestanteGeral;

    let tabelaHtml = '';
    itens.forEach((item, index) => {
      const estado = this.estadosQuestoes.get(item.id);
      const foiConcluida = estado?.concluida ?? false;
      const foiPulada = estado?.pulada ?? false;

      let badgeResultado = foiConcluida
        ? '<span class="relatorio-badge ok">✅ Concluída</span>'
        : foiPulada
          ? '<span class="relatorio-badge pulou">⏭️ Pulada</span>'
          : '<span class="relatorio-badge erro">❌ Não realizada</span>';

      if (estado?.usouSolucao) {
        badgeResultado = '<span class="relatorio-badge solucao">💡 Resolvida com Solução</span>';
      }

      const tempoGasto = estado ? formatarExtenso(estado.tempoSegundos) : '0s';
      const enunciado = 'enunciado' in item ? item.enunciado : (item as QuestaoQuiz).pergunta;

      let solucaoHtml = '';
      if ('solucao' in item) {
        solucaoHtml = `
          <details class="relatorio-solucao">
            <summary>💻 Ver solução no Terminal Ubuntu</summary>
            ${this.gerarTerminalUbuntuMockup(item.solucao)}
          </details>
        `;
      } else if ('explicacao' in item) {
        const q = item as QuestaoQuiz;
        solucaoHtml = `
          <details class="relatorio-solucao">
            <summary>Gabarito: Opção ${['A', 'B', 'C', 'D'][q.correta]}</summary>
            <p>${q.explicacao}</p>
          </details>
        `;
      }

      tabelaHtml += `
        <tr>
          <td class="col-num">#${index + 1}</td>
          <td class="col-enunciado">
            ${enunciado}
            ${
              !foiConcluida || estado?.usouSolucao
                ? '<div class="relatorio-aviso-guia">💡 <i>Veja o passo a passo de como fazer no Guia de Correção abaixo</i></div>'
                : ''
            }
            ${solucaoHtml}
            ${
              'solucao' in item
                ? `<div class="relatorio-linha-praticar">
                    <button class="botao-secundario btn-praticar-revisao-item" data-idx="${index}">
                      🖥️ Praticar no Terminal ao Lado
                    </button>
                  </div>`
                : ''
            }
          </td>
          <td class="col-status">${badgeResultado}</td>
          <td class="col-tempo"><b>${tempoGasto}</b></td>
        </tr>
      `;
    });

    const questoesNaoFeitas = itens
      .map((item, index) => ({ item, index, estado: this.estadosQuestoes.get(item.id) }))
      .filter((q) => !(q.estado?.concluida ?? false) || (q.estado?.usouSolucao ?? false));

    let secaoComoFazerHtml = '';
    if (questoesNaoFeitas.length > 0) {
      secaoComoFazerHtml = `
        <section class="sim-relatorio-guia-secao">
          <div class="guia-secao-header">
            <span class="guia-secao-ico">🎓</span>
            <div>
              <h3>Como resolver as questões pendentes (${questoesNaoFeitas.length})</h3>
              <p>Estude os comandos corretos e pratique em tempo real com o terminal Linux interativo ao lado:</p>
            </div>
          </div>
          <div class="guia-cards-lista">
            ${questoesNaoFeitas.map((q) => this.gerarCardComoFazer(q.item, q.index, q.estado)).join('')}
          </div>
        </section>
      `;
    } else {
      secaoComoFazerHtml = `
        <section class="sim-relatorio-guia-secao sucesso-total">
          <div class="guia-secao-header">
            <span class="guia-secao-ico">🏆</span>
            <div>
              <h3>Incrível! Você acertou todas as tarefas de forma autônoma!</h3>
              <p>Nenhuma questão pendente para correção. Você atingiu 100% de precisão nesta prova prática!</p>
            </div>
          </div>
        </section>
      `;
    }

    this.raiz.innerHTML = `
      <div class="tela-simulado sim-relatorio">
        <div class="sim-relatorio-container">
          <header class="sim-relatorio-header">
            <span class="menu-selo">Resultado do Exame · Relatório de Desempenho</span>
            <h1>${aprovado ? '🎉 Aprovado no Simulado!' : '📚 Prova Finalizada!'}</h1>
            <p>${mod.titulo} · Duração máxima: 30 minutos · ${this.entregueManualmente ? 'Entregue pelo candidato' : (this.tempoRestanteGeral === 0 ? 'Tempo limite esgotado' : 'Todas as tarefas concluídas')}</p>
          </header>

          <section class="sim-relatorio-placar ${aprovado ? 'aprovado' : 'reciclagem'}">
            <div class="placar-resultado">
              <span class="placar-trofeu">${aprovado ? '🏆' : '📝'}</span>
              <div class="placar-textos">
                <h2>${concluidasSozinho} de ${totalItens} tarefas concluídas sozinho (${porcentagem}%)</h2>
                <p>${
                  resolvidasComSolucao > 0
                    ? `Você resolveu ${concluidasSozinho} de forma independente e ${resolvidasComSolucao} com auxílio do botão de solução no terminal.`
                    : aprovado
                      ? 'Parabéns! Seu índice de acertos atingiu o patamar esperado para aprovação em exames de certificação oficial.'
                      : 'Bom treino! Para certificações Linux (LPI, LPIC, Red Hat), recomenda-se atingir ao menos 70% de precisão autônoma.'
                }</p>
              </div>
            </div>
            <div class="placar-meta-tempos">
              <div class="meta-item">
                <span class="meta-rotulo">Tempo Total Utilizado</span>
                <span class="meta-valor">${formatarExtenso(tempoGeralUtilizado)}</span>
              </div>
              <div class="meta-item">
                <span class="meta-rotulo">Tempo Restante</span>
                <span class="meta-valor">${formatarMinSeg(this.tempoRestanteGeral)}</span>
              </div>
            </div>
          </section>

          <section class="sim-relatorio-tabela-secao">
            <h3>⏱️ Desempenho Detalhado por Questão</h3>
            <div class="tabela-container">
              <table class="sim-tabela-desempenho">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Exercício / Tarefa</th>
                    <th>Resultado</th>
                    <th>Tempo Gasto</th>
                  </tr>
                </thead>
                <tbody>
                  ${tabelaHtml}
                </tbody>
              </table>
            </div>
          </section>

          ${secaoComoFazerHtml}

          <footer class="sim-relatorio-acoes">
            <button class="botao-primario btn-abrir-revisao-geral">🖥️ Revisar Tarefas no Terminal ao Lado</button>
            <button class="botao-secundario btn-refazer-prova">🔄 Refazer Esta Prova</button>
            <button class="botao-secundario btn-ir-menu-simulados">← Voltar ao Menu de Simulados</button>
          </footer>
        </div>
      </div>
    `;

    this.raiz.querySelectorAll('.btn-praticar-revisao-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.idx ?? 0);
        this.iniciarModoRevisao(idx);
      });
    });

    this.raiz.querySelector('.btn-abrir-revisao-geral')?.addEventListener('click', () => {
      const primeiraIncompleta = questoesNaoFeitas[0]?.index ?? 0;
      this.iniciarModoRevisao(primeiraIncompleta);
    });

    this.raiz.querySelector('.btn-refazer-prova')?.addEventListener('click', () => {
      this.iniciarExame();
      window.scrollTo(0, 0);
    });

    this.raiz.querySelector('.btn-ir-menu-simulados')?.addEventListener('click', () => {
      this.fase = 'hub';
      this.renderizar();
      window.scrollTo(0, 0);
    });
  }

  private gerarCardComoFazer(item: Desafio | QuestaoQuiz, index: number, estado?: EstadoQuestao): string {
    const ehDesafio = 'solucao' in item;
    const num = index + 1;
    let statusTxt = '❌ Não Concluída';
    if (estado?.usouSolucao) {
      statusTxt = '💡 Resolvida com Solução';
    } else if (estado?.pulada) {
      statusTxt = '⏭️ Questão Pulada';
    }

    if (ehDesafio) {
      const d = item as Desafio;
      return `
        <div class="guia-card">
          <div class="guia-card-header">
            <span class="guia-badge-num">Questão #${num}</span>
            <span class="guia-badge-status ${estado?.usouSolucao ? 'solucao' : (estado?.pulada ? 'pulada' : 'erro')}">${statusTxt}</span>
          </div>
          <p class="guia-enunciado"><b>Tarefa exigida:</b> ${d.enunciado}</p>

          <div class="guia-bloco-solucao">
            <span class="guia-rotulo">💻 Como executar no Terminal Ubuntu:</span>
            ${this.gerarTerminalUbuntuMockup(d.solucao)}
          </div>

          <div class="guia-explicacao">
            <span class="guia-rotulo">📖 Por que esta é a forma correta e o que cai na prova:</span>
            <p>${d.dica}</p>
          </div>

          <div class="guia-card-acoes">
            <button class="botao-primario btn-praticar-revisao-item" data-idx="${index}">
              🖥️ Praticar no Terminal ao Lado (Ver Solução & Reproduzir)
            </button>
          </div>
        </div>
      `;
    } else {
      const q = item as QuestaoQuiz;
      const letraCorreta = ['A', 'B', 'C', 'D'][q.correta];
      const textoCorreto = q.opcoes[q.correta];
      return `
        <div class="guia-card">
          <div class="guia-card-header">
            <span class="guia-badge-num">Questão Teórica #${num}</span>
            <span class="guia-badge-status ${estado?.pulada ? 'pulada' : 'erro'}">${statusTxt}</span>
          </div>
          <p class="guia-enunciado"><b>Pergunta:</b> ${q.pergunta}</p>

          <div class="guia-bloco-solucao">
            <span class="guia-rotulo">✅ Resposta correta:</span>
            <div class="guia-opcao-correta"><b>Opção ${letraCorreta}:</b> ${textoCorreto}</div>
          </div>

          <div class="guia-explicacao">
            <span class="guia-rotulo">📖 Justificativa oficial de exame (${q.certificacao}):</span>
            <p>${q.explicacao}</p>
          </div>
        </div>
      `;
    }
  }

  private gerarTerminalUbuntuMockup(passos: Passo[]): string {
    if (!passos || passos.length === 0) return '';

    const primeiro = passos[0];
    const userInicial = primeiro?.login?.usuario ?? ((primeiro?.terminal ?? 1) > 1 ? 'ricardo' : 'root');
    const tituloAba = `${userInicial}@ubuntu: ~`;

    let linhasHtml = '';
    let ultimoUser = userInicial;
    let ultimoSimbolo = userInicial === 'root' ? '#' : '$';

    for (const p of passos) {
      const isUser = (p.terminal ?? 1) > 1 || p.login !== undefined;
      const user = p.login?.usuario ?? (isUser ? 'ricardo' : 'root');
      const simbolo = user === 'root' ? '#' : '$';
      ultimoUser = user;
      ultimoSimbolo = simbolo;

      const promptHtml = `<span class="mock-prompt-user">${user}@ubuntu</span>:<span class="mock-prompt-path">~</span><span class="mock-prompt-sym">${simbolo}</span> `;

      let respostasHtml = '';
      if (p.respostas && p.respostas.length > 0) {
        respostasHtml = p.respostas
          .map((r) => `<div class="mock-linha-resposta"><span class="mock-rotulo-entrada">[entrada]</span> ${escapar(r)}</div>`)
          .join('');
      }

      let explicacaoHtml = '';
      if (p.explicacao) {
        explicacaoHtml = `<div class="mock-linha-comentario"># ${escapar(p.explicacao)}</div>`;
      }

      linhasHtml += `
        ${explicacaoHtml}
        <div class="mock-linha-comando">
          ${promptHtml}<span class="mock-cmd-texto">${escapar(p.comando)}</span>
        </div>
        ${respostasHtml}
      `;
    }

    return `
      <div class="terminal-ubuntu-mockup">
        <div class="mock-janela-topo">
          <div class="mock-botoes-janela">
            <span class="mock-dot mock-dot-fechar" title="Fechar"></span>
            <span class="mock-dot mock-dot-minimizar" title="Minimizar"></span>
            <span class="mock-dot mock-dot-maximizar" title="Maximizar"></span>
          </div>
          <span class="mock-titulo-janela">terminal — ${tituloAba}</span>
          <span class="mock-tag-bash">bash</span>
        </div>
        <div class="mock-janela-corpo">
          ${linhasHtml}
          <div class="mock-linha-comando mock-linha-cursor">
            <span class="mock-prompt-user">${ultimoUser}@ubuntu</span>:<span class="mock-prompt-path">~</span><span class="mock-prompt-sym">${ultimoSimbolo}</span> <span class="mock-cursor-bloco"></span>
          </div>
        </div>
      </div>
    `;
  }
}
