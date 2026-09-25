import type { Tela } from './Tela';
import type { Desafio, ModalidadeSimulado, Passo, QuestaoQuiz } from '../conteudo/Topico';
import type { Maquina } from '../linux/Maquina';
import type { TerminalUbuntu } from '../terminal/TerminalUbuntu';
import { Bancada } from './Bancada';
import { ArmazemDeMaquinas } from './ArmazemDeMaquinas';
import { MotorQuestoesSimulado } from './MotorQuestoesSimulado';
import { modalidades, sortearQuestoesExame } from '../conteudo/simulado';
import { ColaDeComandos } from './ColaDeComandos';
import { Aviso } from './Aviso';

type FaseSimulado = 'hub' | 'pre-prova' | 'prova' | 'relatorio';

interface EstadoQuestao {
  id: string;
  concluida: boolean;
  pulada: boolean;
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
 * - Relatório final com terminal ao lado para visualização e reprodução da solução recomendada
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
  private indiceQuestaoRevisao: number = 0;
  private estadosQuestoes: Map<string, EstadoQuestao> = new Map();
  private solucoesReveladasRevisao: Set<string> = new Set();
  private executandoSolucao: boolean = false;
  private animandoPinguim: boolean = false;
  private entregueManualmente: boolean = false;
  private questoesExameAtual: Array<Desafio | QuestaoQuiz> = [];
  private chaveSessaoExame: string = '';

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
    ArmazemDeMaquinas.limparSimulados();
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
            <span>🎯 10 ${tipo} sorteadas (banco de 30)</span>
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
              <span><b>Estrutura:</b> 10 ${tipo} sorteadas (banco de 30: 🟢 4 Fáceis · 🟡 3 Médias · 🔴 3 Difíceis)</span>
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
        ArmazemDeMaquinas.limparSimulados();
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
    this.indiceQuestaoRevisao = 0;
    this.solucoesReveladasRevisao.clear();
    this.estadosQuestoes.clear();
    this.animandoPinguim = false;
    this.entregueManualmente = false;

    // Limpa resíduos de avaliações anteriores e gera chave única para isolamento absoluto de kernel/ambiente
    ArmazemDeMaquinas.limparSimulados();
    this.chaveSessaoExame = `simulado-exame-${mod.id}-${Date.now()}`;

    const lista: Array<Desafio | QuestaoQuiz> = mod.desafios ?? mod.questoes ?? [];
    this.questoesExameAtual = sortearQuestoesExame(lista, 10);
    for (const item of this.questoesExameAtual) {
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
    if ((this.fase === 'prova' || this.fase === 'relatorio') && this.questoesExameAtual.length > 0) {
      return this.questoesExameAtual;
    }
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
        <header class="sim-prova-cabecalho">
          <div class="sim-prova-esquerda">
            <button class="botao-secundario btn-abandonar-prova" title="Abandonar a prova">← Abandonar</button>
            <div class="sim-prova-titulo">
              <span class="sim-prova-ico">${mod.icone}</span>
              <h2>${mod.titulo}</h2>
              <span class="sim-prova-contador-resumo"></span>
            </div>
          </div>

          <div class="sim-prova-direita">
            <div class="sim-tempo-geral" title="Tempo restante da prova">
              ⏱️ ${formatarMinSeg(this.tempoRestanteGeral)}
            </div>
            <button class="botao-primario btn-entregar-prova" title="Finalizar a prova e ver o relatório de desempenho">🏁 Finalizar Prova</button>
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
              <button class="botao-secundario btn-entregar-prova-rodape">🏁 Finalizar Prova</button>
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

    // Inicializa a Bancada de terminais se for prova prática com ambiente Linux 100% novo e isolado
    if (!ehQuiz) {
      const containerJanela = this.raiz.querySelector('.sim-terminal-janela') as HTMLElement;
      this.bancada = new Bancada(
        containerJanela,
        this.chaveSessaoExame || `simulado-exame-${mod.id}-${Date.now()}`,
        (maquina: Maquina) => {
          mod.preparar?.(maquina);
          MotorQuestoesSimulado.prepararPrerequisitos(this.questoesExameAtual, maquina);
        },
        (maquina: Maquina) => {
          this.verificarComandoMaquina(maquina);
        },
      );
    }

    this.renderizarBotoesQuestoes();
    this.renderizarQuestaoAtiva();

    this.raiz.querySelector('.btn-abandonar-prova')?.addEventListener('click', () => {
      if (confirm('Tem certeza de que deseja abandonar a prova em andamento? O progresso desta tentativa será cancelado.')) {
        ArmazemDeMaquinas.limparSimulados();
        this.fase = 'hub';
        this.renderizar();
        window.scrollTo(0, 0);
      }
    });

    const confirmarFinalizacao = (): void => {
      const concluidas = Array.from(this.estadosQuestoes.values()).filter((e) => e.concluida).length;
      const total = this.obterItens().length;
      if (
        confirm(
          `Deseja realmente finalizar a prova agora?\n\nVocê concluiu ${concluidas} de ${total} tarefas.\nAo confirmar, a prova será entregue e o relatório com o terminal de soluções será exibido.`,
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
      const nivelDesc = item.nivel === 'facil' ? '🟢 Fácil' : item.nivel === 'medio' ? '🟡 Médio' : item.nivel === 'dificil' ? '🔴 Difícil' : '';
      const tooltip = `Questão #${index + 1} (${nivelDesc})`;
      html += `
        <button class="sim-btn-questao ${statusClass}${ehAtiva}" data-idx="${index}" title="${tooltip}">
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
    let item = itens[this.indiceQuestaoAtiva];
    if (!item) return;

    const estado = this.estadosQuestoes.get(item.id) ?? {
      id: item.id,
      concluida: false,
      pulada: false,
      tempoSegundos: 0,
    };

    const ehQuiz = 'opcoes' in item;

    // Se for desafio prático pendente e já temos uma máquina instanciada na bancada,
    // verifica se o estado do sistema já atende prematuramente o desafio (ex: criado por engano em questão anterior).
    // Se sim, adapta a questão dinamicamente gerando novo alvo e enunciado.
    if (!ehQuiz && !estado.concluida && this.bancada) {
      const maquina = this.bancada.obterMaquina();
      const desafioAdaptado = MotorQuestoesSimulado.adaptarQuestaoSeJaAtendida(item as Desafio, maquina);
      if (desafioAdaptado !== item) {
        item = desafioAdaptado;
        if (this.questoesExameAtual[this.indiceQuestaoAtiva]) {
          this.questoesExameAtual[this.indiceQuestaoAtiva] = desafioAdaptado;
        }
      }
    }

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

    const nivelBadge = item.nivel === 'facil'
      ? '<span class="sim-badge-nivel nivel-facil">🟢 Fácil</span>'
      : item.nivel === 'medio'
        ? '<span class="sim-badge-nivel nivel-medio">🟡 Médio</span>'
        : item.nivel === 'dificil'
          ? '<span class="sim-badge-nivel nivel-dificil">🔴 Difícil</span>'
          : '';

    container.innerHTML = `
      <div class="sim-card-questao ${estado.concluida ? 'questao-travada' : ''}">
        <div class="sim-questao-header">
          <div class="sim-questao-status-tag">
            <span class="tag-numero">Questão ${this.indiceQuestaoAtiva + 1} de ${itens.length}</span>
            ${nivelBadge}
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
              <b>Tarefa concluída com sucesso!</b>
              <p>Esta questão está travada e pontuada com o tempo de <b>${formatarExtenso(estado.tempoSegundos)}</b>.</p>
            </div>
          </div>
        `
            : `
          <div class="sim-questao-acoes">
            <button class="botao-secundario btn-pular-questao">⏭️ Pular questão / Não sei agora</button>
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
          </div>
        `
        }
      </div>
    `;

    // Eventos
    container.querySelector('.btn-pular-questao')?.addEventListener('click', () => {
      this.pularQuestaoAtiva();
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

  private pularQuestaoAtiva(): void {
    const item = this.obterItemAtual();
    if (!item) return;
    const estado = this.estadosQuestoes.get(item.id);
    if (estado && !estado.concluida) {
      estado.pulada = true;
    }
    this.avancarParaProximaPendente();
  }

  private responderQuizOpcao(q: QuestaoQuiz, opcao: number): void {
    const estado = this.estadosQuestoes.get(q.id);
    if (!estado || estado.concluida) return;

    estado.respostaQuiz = opcao;
    if (opcao === q.correta) {
      this.concluirQuestaoAtivaComSucesso(estado);
    } else {
      // Errou no quiz: dá feedback e avança
      estado.concluida = false;
      estado.pulada = true;
      this.renderizarBotoesQuestoes();
      this.renderizarQuestaoAtiva();
      setTimeout(() => this.avancarParaProximaPendente(), 1000);
    }
  }

  private verificarComandoMaquina(maquina: Maquina): void {
    if (this.animandoPinguim) return;

    const item = this.obterItemAtual();
    if (!item || !('verificar' in item)) return;

    const desafio = item as Desafio;
    const estado = this.estadosQuestoes.get(desafio.id);
    if (!estado || estado.concluida) return;

    let acertou = false;
    try {
      acertou = desafio.verificar(maquina);
    } catch {
      acertou = false;
    }

    if (acertou) {
      this.concluirQuestaoAtivaComSucesso(estado);
    }
  }

  private concluirQuestaoAtivaComSucesso(estado: EstadoQuestao): void {
    estado.concluida = true;
    estado.pulada = false;
    this.animandoPinguim = true;

    // Dispara animação comemorativa do pinguim 🐧
    const overlay = this.raiz.querySelector('.sim-pinguim-overlay') as HTMLElement | null;
    const msgTempo = this.raiz.querySelector('.sim-pinguim-msg-tempo') as HTMLElement | null;
    const tituloMsg = overlay?.querySelector('h3');

    if (overlay && msgTempo) {
      if (tituloMsg) tituloMsg.textContent = 'Excelente! Questão Concluída!';
      msgTempo.textContent = `Resolvido em ${formatarExtenso(estado.tempoSegundos)} · Travando questão e avançando...`;
      overlay.hidden = false;
      overlay.classList.add('visivel');
    }

    setTimeout(() => {
      if (overlay) {
        overlay.classList.remove('visivel');
        overlay.hidden = true;
      }
      this.animandoPinguim = false;
      this.renderizarBotoesQuestoes();
      this.renderizarQuestaoAtiva();

      // Checa se todas foram concluídas no exame oficial
      const todasConcluidas = Array.from(this.estadosQuestoes.values()).every((e) => e.concluida);
      if (todasConcluidas) {
        setTimeout(() => this.finalizarProva(), 600);
      } else {
        this.avancarParaProximaPendente();
      }
    }, 1500);
  }

  private async reproduzirSolucaoNoTerminal(passos: Passo[], botao?: HTMLButtonElement | null): Promise<void> {
    if (!this.bancada || this.executandoSolucao) return;
    this.executandoSolucao = true;
    this.atualizarLinhasTabelaRevisao();

    const btnCard = this.raiz.querySelector<HTMLButtonElement>('.btn-revisao-solucao-terminal');
    if (botao) {
      botao.disabled = true;
      botao.innerHTML = '⏳ Digitando no terminal...';
    }
    if (btnCard && btnCard !== botao) {
      btnCard.disabled = true;
      btnCard.innerHTML = '⏳ Digitando no terminal...';
    }

    try {
      for (let i = 0; i < passos.length; i++) {
        const p = passos[i];
        const terminal: TerminalUbuntu = await this.bancada.janela.obter(p.terminal ?? 1, p.login);
        terminal.focar();
        await terminal.executarAutomatico(p.comando, p.respostas ?? []);
        if (i < passos.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
    } catch (e) {
      console.error('Erro ao reproduzir comando no terminal:', e);
    } finally {
      this.executandoSolucao = false;
      this.renderizarRevisaoQuestaoAtiva();
      this.atualizarLinhasTabelaRevisao();
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
    const itens = this.obterItens();
    const primeiraIncompleta = itens.findIndex((item) => {
      const e = this.estadosQuestoes.get(item.id);
      return !e || !e.concluida;
    });
    this.indiceQuestaoRevisao = primeiraIncompleta !== -1 ? primeiraIncompleta : 0;
    this.renderizar();
    window.scrollTo(0, 0);
  }

  private renderizarRelatorio(): void {
    const mod = this.modalidadeSelecionada;
    const itens = this.obterItens();
    const totalItens = itens.length;
    const concluidas = Array.from(this.estadosQuestoes.values()).filter((e) => e.concluida).length;
    const porcentagem = totalItens > 0 ? Math.round((concluidas / totalItens) * 100) : 0;
    const aprovado = porcentagem >= 70;
    const tempoGeralUtilizado = 30 * 60 - this.tempoRestanteGeral;
    const ehQuiz = mod.questoes !== undefined && mod.questoes.length > 0;

    this.raiz.innerHTML = `
      <div class="tela-simulado sim-relatorio-tela ${ehQuiz ? 'sim-relatorio-modo-quiz' : 'sim-relatorio-modo-terminal'}">
        <header class="sim-relatorio-cabecalho">
          <div class="sim-relatorio-esquerda">
            <button class="botao-secundario btn-ir-menu-simulados" title="Voltar ao menu de simulados">← Menu de Simulados</button>
            <div class="sim-relatorio-titulo-grupo">
              <span class="sim-relatorio-ico">${mod.icone}</span>
              <div>
                <h2>Resultado: ${mod.titulo}</h2>
                <span class="sim-relatorio-subtitulo">${concluidas} de ${totalItens} tarefas concluídas (${porcentagem}%) · ${aprovado ? '🎉 Aprovado' : '📚 Em Treinamento'} · ${this.entregueManualmente ? 'Entregue pelo candidato' : (this.tempoRestanteGeral === 0 ? 'Tempo esgotado' : 'Todas as tarefas concluídas')}</span>
              </div>
            </div>
          </div>
          <div class="sim-relatorio-direita">
            <div class="sim-relatorio-meta-pill" title="Tempo total utilizado">
              ⏱️ Tempo: <b>${formatarExtenso(tempoGeralUtilizado)}</b>
            </div>
            <button class="botao-primario btn-refazer-prova" title="Refazer esta prova">🔄 Refazer Prova</button>
          </div>
        </header>

        <main class="sim-relatorio-divisao">
          <section class="sim-relatorio-estudo">
            <div class="sim-relatorio-placar-compacto ${aprovado ? 'aprovado' : 'reciclagem'}">
              <div class="placar-topo-linha">
                <span class="placar-trofeu-pequeno">${aprovado ? '🏆' : '📝'}</span>
                <div>
                  <b>${aprovado ? 'Parabéns! Aprovado no Simulado Prático!' : 'Prova Finalizada · Modo de Correção e Aprendizado'}</b>
                  <p>${concluidas} de ${totalItens} tarefas concluídas (${porcentagem}%). ${
                    aprovado
                      ? 'Seu desempenho atingiu a nota de corte para aprovação em exames oficiais.'
                      : 'Veja a correção passo a passo de cada tarefa no terminal ao lado para dominar todos os comandos.'
                  }</p>
                </div>
              </div>
            </div>

            <div class="sim-relatorio-navegacao-secao">
              <span class="sim-relatorio-secao-rotulo">Navegue pelas questões para revisar a resolução:</span>
              <nav class="sim-relatorio-questoes-nav" aria-label="Navegação de revisão das questões"></nav>
            </div>

            <div class="sim-relatorio-questao-ativa-container"></div>

            <section class="sim-relatorio-tabela-secao">
              <details class="sim-relatorio-tabela-detalhes" open>
                <summary><b>⏱️ Tabela de Desempenho Detalhada (${concluidas}/${totalItens})</b></summary>
                <div class="tabela-container">
                  <table class="sim-tabela-desempenho">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Nível</th>
                        <th>Exercício / Tarefa</th>
                        <th>Resultado</th>
                        <th>Tempo</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${this.gerarLinhasTabelaHtml(itens)}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>

            <div class="sim-relatorio-rodape-acoes">
              <button class="botao-secundario btn-refazer-prova-rodape">🔄 Refazer Esta Prova</button>
              <button class="botao-secundario btn-ir-menu-simulados-rodape">← Voltar ao Menu de Simulados</button>
            </div>
          </section>

          ${
            ehQuiz
              ? ''
              : `
            <section class="sim-relatorio-terminal">
              <div class="sim-relatorio-terminal-janela"></div>
              <p class="topico-rodape">🔑 senhas: <b>root</b> = <code>123</code> · <b>ricardo</b> = <code>123</code> · <kbd>Tab</kbd> completa · <kbd>Ctrl</kbd>+<kbd>C</kbd> cancela</p>
            </section>
          `
          }
        </main>
      </div>
    `;

    // Inicializa a Bancada de terminais para revisão em tempo real
    if (!ehQuiz) {
      const containerJanela = this.raiz.querySelector('.sim-relatorio-terminal-janela') as HTMLElement;
      if (containerJanela) {
        this.bancada = new Bancada(
          containerJanela,
          `simulado-revisao-${mod.id}-${Date.now()}`,
          (maquina: Maquina) => {
            mod.preparar?.(maquina);
            MotorQuestoesSimulado.prepararPrerequisitos(this.questoesExameAtual, maquina);
          },
          () => {},
        );
      }
    }

    this.renderizarBotoesRevisao();
    this.renderizarRevisaoQuestaoAtiva();

    // Eventos de navegação global
    this.raiz.querySelectorAll('.btn-ir-menu-simulados, .btn-ir-menu-simulados-rodape').forEach((btn) => {
      btn.addEventListener('click', () => {
        ArmazemDeMaquinas.limparSimulados();
        this.fase = 'hub';
        this.renderizar();
        window.scrollTo(0, 0);
      });
    });

    this.raiz.querySelectorAll('.btn-refazer-prova, .btn-refazer-prova-rodape').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.iniciarExame();
        window.scrollTo(0, 0);
      });
    });

    this.anexarEventosTabelaRevisao();
  }

  private renderizarBotoesRevisao(): void {
    const nav = this.raiz.querySelector('.sim-relatorio-questoes-nav') as HTMLElement | null;
    const rotulo = this.raiz.querySelector('.sim-relatorio-secao-rotulo') as HTMLElement | null;
    if (!nav) return;

    const itens = this.obterItens();
    const itemAtual = itens[this.indiceQuestaoRevisao];
    const estadoAtual = itemAtual ? this.estadosQuestoes.get(itemAtual.id) : undefined;

    let statusTexto = '❌ Não realizada';
    let statusClasse = 'erro';
    if (estadoAtual?.concluida) {
      statusTexto = '✅ Concluída no exame';
      statusClasse = 'ok';
    } else if (estadoAtual?.pulada) {
      statusTexto = '⏭️ Pulada no exame';
      statusClasse = 'pulou';
    }

    const nivelBadge = itemAtual?.nivel === 'facil'
      ? '<span class="sim-badge-nivel nivel-facil">🟢 Fácil</span>'
      : itemAtual?.nivel === 'medio'
        ? '<span class="sim-badge-nivel nivel-medio">🟡 Médio</span>'
        : itemAtual?.nivel === 'dificil'
          ? '<span class="sim-badge-nivel nivel-dificil">🔴 Difícil</span>'
          : '';

    if (rotulo) {
      rotulo.innerHTML = `
        <span class="rotulo-titulo">📍 Visualizando agora: <b class="destaque-questao">Questão #${this.indiceQuestaoRevisao + 1} de ${itens.length}</b></span>
        ${nivelBadge}
        <span class="relatorio-badge ${statusClasse}">${statusTexto}</span>
      `;
    }

    let html = '';
    itens.forEach((item, index) => {
      const estado = this.estadosQuestoes.get(item.id);
      let statusClass = 'erro';
      let icon = '✗';
      if (estado?.concluida) {
        statusClass = 'concluida';
        icon = '✓';
      } else if (estado?.pulada) {
        statusClass = 'pulada';
        icon = '⏭';
      }

      const nivelDesc = item.nivel === 'facil' ? '🟢 Fácil' : item.nivel === 'medio' ? '🟡 Médio' : item.nivel === 'dificil' ? '🔴 Difícil' : '';
      const ehAtiva = index === this.indiceQuestaoRevisao ? ' ativa' : '';
      html += `
        <button class="sim-btn-questao ${statusClass}${ehAtiva}" data-idx="${index}" title="Ir para Questão #${index + 1} (${nivelDesc})">
          <span class="sim-btn-questao-idx">#${index + 1}</span>
          <span class="sim-btn-questao-num">${icon}</span>
        </button>
      `;
    });

    nav.innerHTML = html;

    nav.querySelectorAll<HTMLButtonElement>('.sim-btn-questao').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        if (!isNaN(idx) && idx !== this.indiceQuestaoRevisao) {
          this.trocarQuestaoRevisao(idx);
        }
      });
    });
  }

  private trocarQuestaoRevisao(novoIndex: number): void {
    this.indiceQuestaoRevisao = novoIndex;
    this.renderizarBotoesRevisao();
    this.renderizarRevisaoQuestaoAtiva();
    this.atualizarLinhasTabelaRevisao();
  }

  private renderizarRevisaoQuestaoAtiva(): void {
    const container = this.raiz.querySelector('.sim-relatorio-questao-ativa-container') as HTMLElement | null;
    if (!container) return;

    const itens = this.obterItens();
    const item = itens[this.indiceQuestaoRevisao];
    if (!item) return;

    const estado = this.estadosQuestoes.get(item.id);
    const ehQuiz = 'opcoes' in item;

    const nivelBadge = item.nivel === 'facil'
      ? '<span class="sim-badge-nivel nivel-facil">🟢 Fácil</span>'
      : item.nivel === 'medio'
        ? '<span class="sim-badge-nivel nivel-medio">🟡 Médio</span>'
        : item.nivel === 'dificil'
          ? '<span class="sim-badge-nivel nivel-dificil">🔴 Difícil</span>'
          : '';

    let badgeStatusHtml = '<span class="tag-status erro">❌ Não realizada</span>';
    if (estado?.concluida) {
      badgeStatusHtml = `<span class="tag-status concluida">✅ Concluída no exame (${formatarExtenso(estado.tempoSegundos)})</span>`;
    } else if (estado?.pulada) {
      badgeStatusHtml = '<span class="tag-status pulada">⏭️ Pulada no exame</span>';
    }

    if (!ehQuiz) {
      const d = item as Desafio;
      const jaRevelada = this.solucoesReveladasRevisao.has(d.id);
      const comandosFormatados = d.solucao.map((p) => {
        let texto = `$ ${p.comando}`;
        if (p.respostas && p.respostas.length > 0) {
          texto += `   # entrada: ${p.respostas.join(', ')}`;
        }
        return escapar(texto);
      }).join('\n');

      container.innerHTML = `
        <div class="sim-card-questao sim-card-revisao">
          <div class="sim-questao-header">
            <div class="sim-questao-status-tag">
              <span class="tag-numero">Questão #${this.indiceQuestaoRevisao + 1} de ${itens.length}</span>
              ${nivelBadge}
              ${badgeStatusHtml}
            </div>
            <div class="sim-tempo-questao">
              <span class="sim-tempo-questao-rotulo">Tempo gasto:</span>
              <span class="sim-tempo-questao-valor">${formatarExtenso(estado?.tempoSegundos ?? 0)}</span>
            </div>
          </div>

          <div class="sim-questao-enunciado">
            <p><b>Tarefa exigida:</b> ${d.enunciado}</p>
          </div>

          <div class="sim-revisao-acao-principal">
            <button class="botao-primario btn-revisao-solucao-terminal" ${this.executandoSolucao ? 'disabled' : ''}>
              ${this.executandoSolucao ? '⏳ Digitando no terminal...' : (jaRevelada ? '▶️ Reproduzir Solução Novamente no Terminal' : '👀 Ver Solução & Reproduzir no Terminal ao Lado')}
            </button>
          </div>

          ${
            jaRevelada
              ? `
            <div class="sim-bloco-solucao-ativa">
              <div class="sim-solucao-topo">
                <span class="sim-solucao-rotulo">💻 Solução recomendada no Terminal Ubuntu:</span>
              </div>
              <div class="sim-solucao-comandos-container">
                <pre class="sim-solucao-codigo">${comandosFormatados}</pre>
              </div>
              ${
                d.dica
                  ? `<div class="sim-solucao-dica-bloco">
                      <span class="sim-solucao-rotulo-sub">📖 O que é cobrado nesta questão:</span>
                      <p class="sim-solucao-dica">${d.dica}</p>
                    </div>`
                  : ''
              }
            </div>
          `
              : ''
          }
        </div>
      `;

      container.querySelector('.btn-revisao-solucao-terminal')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        await this.executarSolucaoRevisao(this.indiceQuestaoRevisao, btn);
      });
    } else {
      const q = item as QuestaoQuiz;

      container.innerHTML = `
        <div class="sim-card-questao sim-card-revisao">
          <div class="sim-questao-header">
            <div class="sim-questao-status-tag">
              <span class="tag-numero">Questão Teórica #${this.indiceQuestaoRevisao + 1} de ${itens.length}</span>
              ${nivelBadge}
              ${badgeStatusHtml}
            </div>
          </div>

          <div class="sim-questao-enunciado">
            <p><b>Pergunta:</b> ${q.pergunta}</p>
          </div>

          <div class="sim-quiz-opcoes-revisao">
            ${q.opcoes
              .map((opcao, optIdx) => {
                const letra = ['A', 'B', 'C', 'D'][optIdx] ?? String(optIdx + 1);
                let classe = 'sim-quiz-opcao-revisao';
                if (optIdx === q.correta) classe += ' correta';
                else if (estado?.respostaQuiz === optIdx) classe += ' errada';
                return `
                  <div class="${classe}">
                    <span class="quiz-letra">${letra}</span>
                    <span class="quiz-texto">${opcao}</span>
                    ${optIdx === q.correta ? '<span class="quiz-badge-gabarito">✓ Gabarito Oficial</span>' : ''}
                    ${estado?.respostaQuiz === optIdx && optIdx !== q.correta ? '<span class="quiz-badge-sua-resposta">✗ Sua Resposta</span>' : ''}
                  </div>
                `;
              })
              .join('')}
          </div>

          <div class="sim-bloco-solucao-ativa">
            <span class="sim-solucao-rotulo">📖 Justificativa oficial (${q.certificacao}):</span>
            <p class="sim-solucao-dica">${q.explicacao}</p>
          </div>
        </div>
      `;
    }
  }

  private async executarSolucaoRevisao(idx: number, botaoClicado?: HTMLButtonElement | null): Promise<void> {
    const itens = this.obterItens();
    const item = itens[idx];
    if (!item) return;

    this.indiceQuestaoRevisao = idx;
    this.solucoesReveladasRevisao.add(item.id);
    this.renderizarBotoesRevisao();
    this.renderizarRevisaoQuestaoAtiva();
    this.atualizarLinhasTabelaRevisao();

    // Rola suavemente até o card da questão na coluna da esquerda
    this.raiz.querySelector('.sim-relatorio-questao-ativa-container')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if ('solucao' in item) {
      const btnCard = this.raiz.querySelector<HTMLButtonElement>('.btn-revisao-solucao-terminal');
      await this.reproduzirSolucaoNoTerminal(item.solucao, botaoClicado ?? btnCard);
    }
  }

  private gerarLinhasTabelaHtml(itens: Array<Desafio | QuestaoQuiz>): string {
    return itens
      .map((item, index) => {
        const estado = this.estadosQuestoes.get(item.id);
        const foiConcluida = estado?.concluida ?? false;
        const foiPulada = estado?.pulada ?? false;

        const badgeResultado = foiConcluida
          ? '<span class="relatorio-badge ok">✅ Concluída</span>'
          : foiPulada
            ? '<span class="relatorio-badge pulou">⏭️ Pulada</span>'
            : '<span class="relatorio-badge erro">❌ Não realizada</span>';

        const tempoGasto = estado ? formatarExtenso(estado.tempoSegundos) : '0s';
        const enunciado = 'enunciado' in item ? item.enunciado : (item as QuestaoQuiz).pergunta;
        const ehAtual = index === this.indiceQuestaoRevisao;
        const ehDesafio = 'solucao' in item;

        let acaoHtml = '';
        if (ehDesafio) {
          acaoHtml = `
            <button class="botao-primario btn-ir-questao-revisao ${this.executandoSolucao && ehAtual ? 'executando' : ''}" data-idx="${index}" ${this.executandoSolucao ? 'disabled' : ''}>
              ${this.executandoSolucao && ehAtual ? '⏳ Digitando...' : '▶️ Reproduzir no Terminal'}
            </button>
          `;
        } else {
          acaoHtml = `
            <button class="botao-secundario btn-ir-questao-revisao" data-idx="${index}">
              🔍 Ver Gabarito
            </button>
          `;
        }

        const nivelBadge = item.nivel === 'facil'
          ? '<span class="sim-badge-nivel nivel-facil">🟢 Fácil</span>'
          : item.nivel === 'medio'
            ? '<span class="sim-badge-nivel nivel-medio">🟡 Médio</span>'
            : item.nivel === 'dificil'
              ? '<span class="sim-badge-nivel nivel-dificil">🔴 Difícil</span>'
              : '';

        return `
          <tr class="${ehAtual ? 'linha-selecionada' : ''}" data-idx="${index}">
            <td class="col-num">#${index + 1}</td>
            <td class="col-nivel">${nivelBadge}</td>
            <td class="col-enunciado">${enunciado}</td>
            <td class="col-status">${badgeResultado}</td>
            <td class="col-tempo"><b>${tempoGasto}</b></td>
            <td class="col-acao">${acaoHtml}</td>
          </tr>
        `;
      })
      .join('');
  }

  private atualizarLinhasTabelaRevisao(): void {
    const tbody = this.raiz.querySelector('.sim-tabela-desempenho tbody');
    if (tbody) {
      tbody.innerHTML = this.gerarLinhasTabelaHtml(this.obterItens());
      this.anexarEventosTabelaRevisao();
    }
  }

  private anexarEventosTabelaRevisao(): void {
    this.raiz.querySelectorAll<HTMLButtonElement>('.btn-ir-questao-revisao').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx ?? 0);
        await this.executarSolucaoRevisao(idx, btn);
      });
    });

    this.raiz.querySelectorAll('.sim-tabela-desempenho tbody tr[data-idx]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        const idx = Number((e.currentTarget as HTMLElement).dataset.idx ?? 0);
        this.trocarQuestaoRevisao(idx);
        this.raiz.querySelector('.sim-relatorio-questao-ativa-container')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }
}
