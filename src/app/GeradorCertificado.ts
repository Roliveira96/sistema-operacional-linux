import type { ModalidadeSimulado } from '../conteudo/Topico';

export interface DadosCertificado {
  nomeAluno: string;
  modalidade: ModalidadeSimulado;
  porcentagem: number;
  totalTarefas: number;
  tempoGeralSegundos: number;
  dataEmissao: Date;
  codigoAutenticidade: string;
}

export class GeradorCertificado {
  /**
   * Abre o modal solicitando o nome completo do aluno e dispara a emissão do certificado.
   */
  public static solicitarNomeEEmitir(
    modalidade: ModalidadeSimulado,
    porcentagem: number,
    totalTarefas: number,
    tempoGeralSegundos: number,
  ): void {
    // Remove modal anterior se houver
    const anterior = document.getElementById('sim-modal-certificado');
    if (anterior) anterior.remove();

    const overlay = document.createElement('div');
    overlay.id = 'sim-modal-certificado';
    overlay.className = 'sim-modal-certificado-overlay';

    overlay.innerHTML = `
      <div class="sim-modal-certificado-card">
        <div class="sim-modal-cert-topo">
          <span class="sim-modal-cert-icone">🎓</span>
          <div>
            <h3>Emissão de Certificado de Conclusão</h3>
            <p>Você atingiu <b>${porcentagem}%</b> de acertos em <b>${modalidade.titulo}</b>!</p>
          </div>
        </div>

        <form class="sim-modal-cert-form" id="form-emissao-cert">
          <label for="input-nome-aluno">
            <b>Nome completo do aluno:</b>
            <span class="dica-label">Como deve ser impresso no diploma oficial</span>
          </label>
          <input
            type="text"
            id="input-nome-aluno"
            name="nomeAluno"
            placeholder="Ex.: Ricardo Oliveira dos Santos"
            required
            minlength="3"
            autofocus
          />

          <div class="sim-modal-cert-info-box">
            <span>📋 <b>Módulo:</b> ${modalidade.titulo}</span>
            <span>⭐ <b>Aproveitamento:</b> ${porcentagem}% ${porcentagem === 100 ? '<b>(Com Excelência)</b>' : ''}</span>
            <span>✍️ <b>Coordenação:</b> Professora Sediane</span>
          </div>

          <div class="sim-modal-cert-acoes">
            <button type="button" class="botao-secundario btn-cancelar-cert">Cancelar</button>
            <button type="submit" class="botao-primario btn-confirmar-cert">📜 Gerar Certificado PDF</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(overlay);

    const inputNome = overlay.querySelector<HTMLInputElement>('#input-nome-aluno');
    inputNome?.focus();

    overlay.querySelector('.btn-cancelar-cert')?.addEventListener('click', () => {
      overlay.remove();
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const form = overlay.querySelector<HTMLFormElement>('#form-emissao-cert');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = inputNome?.value.trim();
      if (!nome || nome.length < 3) {
        alert('Por favor, informe seu nome completo para emissão do certificado.');
        return;
      }

      overlay.remove();

      const dados: DadosCertificado = {
        nomeAluno: nome,
        modalidade,
        porcentagem,
        totalTarefas,
        tempoGeralSegundos,
        dataEmissao: new Date(),
        codigoAutenticidade: `LINUX-CERT-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      };

      GeradorCertificado.exibirCertificado(dados);
    });
  }

  /**
   * Renderiza a visualização do certificado e disponibiliza botão de impressão/PDF.
   */
  public static exibirCertificado(dados: DadosCertificado): void {
    const dataFormatada = dados.dataEmissao.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    const horaFormatada = dados.dataEmissao.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const ehExcelencia = dados.porcentagem === 100;
    const descricaoModulo = GeradorCertificado.obterDescricaoConteudo(dados.modalidade.id);

    const htmlDiploma = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Certificado - ${dados.nomeAluno} - ${dados.modalidade.titulo}</title>
        <style>
          @page {
            size: landscape A4;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: 'Cinzel', 'Times New Roman', Times, serif;
            background: #0f172a;
            color: #1e293b;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .folha-diploma {
            width: 1050px;
            height: 742px;
            background: #fffdfa;
            padding: 30px;
            position: relative;
            box-shadow: 0 15px 40px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .borda-externa {
            width: 100%;
            height: 100%;
            border: 5px solid #1e3a8a;
            padding: 10px;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .borda-interna {
            width: 100%;
            height: 100%;
            border: 2px solid #b45309;
            padding: 24px 36px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
          }
          .canto {
            position: absolute;
            width: 24px;
            height: 24px;
            border: 3px solid #b45309;
          }
          .canto-tl { top: 4px; left: 4px; border-right: none; border-bottom: none; }
          .canto-tr { top: 4px; right: 4px; border-left: none; border-bottom: none; }
          .canto-bl { bottom: 4px; left: 4px; border-right: none; border-top: none; }
          .canto-br { bottom: 4px; right: 4px; border-left: none; border-top: none; }

          .cabecalho-cert {
            text-align: center;
          }
          .instituicao-titulo {
            font-size: 16px;
            letter-spacing: 5px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 700;
          }
          .diploma-titulo {
            font-size: 38px;
            font-weight: 900;
            color: #1e3a8a;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin: 4px 0 2px;
          }
          .diploma-subtitulo {
            font-size: 13.5px;
            color: #b45309;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
          }

          .corpo-cert {
            text-align: center;
            margin: 10px 0;
          }
          .texto-certificamos {
            font-size: 15px;
            color: #475569;
            font-style: italic;
            font-family: Georgia, serif;
          }
          .nome-aluno-destaque {
            font-size: 34px;
            font-weight: 900;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin: 10px 0 12px;
            border-bottom: 2px solid #b45309;
            display: inline-block;
            padding: 0 30px 4px;
          }
          .texto-conclusao {
            font-size: 15px;
            line-height: 1.6;
            color: #334155;
            max-width: 820px;
            margin: 0 auto;
            font-family: Georgia, serif;
          }
          .destaque-modulo {
            font-weight: bold;
            color: #1e3a8a;
          }
          .selo-excelencia {
            display: inline-block;
            margin-top: 8px;
            padding: 4px 16px;
            background: #fef3c7;
            border: 1px solid #d97706;
            color: #92400e;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 1px;
            text-transform: uppercase;
          }
          .texto-ementa {
            font-size: 12px;
            color: #64748b;
            margin-top: 8px;
            font-family: 'Segoe UI', Roboto, sans-serif;
            font-style: italic;
          }

          .rodape-cert {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-top: 15px;
            padding-top: 10px;
          }
          .bloco-assinatura {
            text-align: center;
            width: 320px;
          }
          .linha-assinatura {
            border-top: 1.5px solid #334155;
            margin-bottom: 6px;
          }
          .nome-assinante {
            font-size: 15px;
            font-weight: 700;
            color: #0f172a;
          }
          .cargo-assinante {
            font-size: 12px;
            color: #64748b;
            font-family: 'Segoe UI', Roboto, sans-serif;
          }

          .bloco-selo {
            text-align: center;
          }
          .emblema-selo {
            width: 76px;
            height: 76px;
            border-radius: 50%;
            background: #b45309;
            color: #ffffff;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 0 auto 6px;
            box-shadow: 0 4px 10px rgba(180, 83, 9, 0.3);
            border: 3px double #fef3c7;
          }
          .emblema-selo span {
            font-size: 22px;
          }
          .emblema-selo b {
            font-size: 9px;
            letter-spacing: 1px;
          }
          .meta-emissao {
            font-size: 11px;
            color: #64748b;
            font-family: 'Segoe UI', Roboto, sans-serif;
          }

          .barra-botoes-topo {
            position: fixed;
            top: 20px;
            right: 20px;
            display: flex;
            gap: 12px;
            z-index: 9999;
          }
          .btn-imprimir {
            padding: 10px 20px;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(37,99,235,0.4);
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .btn-imprimir:hover {
            background: #1d4ed8;
          }
          .btn-fechar {
            padding: 10px 18px;
            background: #475569;
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
          }

          @media print {
            body {
              background: none;
              padding: 0;
            }
            .barra-botoes-topo {
              display: none !important;
            }
            .folha-diploma {
              box-shadow: none;
              width: 100vw;
              height: 100vh;
              page-break-after: avoid;
            }
          }
        </style>
      </head>
      <body>
        <div class="barra-botoes-topo">
          <button class="btn-imprimir" onclick="window.print()">🖨️ Salvar como PDF / Imprimir</button>
          <button class="btn-fechar" onclick="window.close()">✕ Fechar</button>
        </div>

        <div class="folha-diploma">
          <div class="borda-externa">
            <div class="borda-interna">
              <div class="canto canto-tl"></div>
              <div class="canto canto-tr"></div>
              <div class="canto canto-bl"></div>
              <div class="canto canto-br"></div>

              <header class="cabecalho-cert">
                <p class="instituicao-titulo">SISTEMA OPERACIONAL LINUX · FORMAÇÃO PRÁTICA</p>
                <h1 class="diploma-titulo">Certificado de Conclusão</h1>
                <p class="diploma-subtitulo">EXAME PRÁTICO E AVALIAÇÃO DE COMPETÊNCIAS</p>
              </header>

              <main class="corpo-cert">
                <p class="texto-certificamos">Certificamos com louvor que</p>
                <h2 class="nome-aluno-destaque">${dados.nomeAluno}</h2>
                <p class="texto-conclusao">
                  concluiu com êxito o exame de certificação prática no módulo
                  <span class="destaque-modulo">${dados.modalidade.titulo}</span>,
                  demonstrando proficiência nas tarefas de terminal Linux com aproveitamento de
                  <b>${dados.porcentagem}%</b> em avaliação cronometrada de 10 desafios técnicos.
                </p>

                ${
                  ehExcelencia
                    ? `<div class="selo-excelencia">⭐ Distinção Acadêmica: 100% de Acertos (Com Excelência)</div>`
                    : `<div class="selo-excelencia">✓ Aprovado com Louvor (Nota Superior à Média de 70%)</div>`
                }

                <p class="texto-ementa">
                  <b>Competências avaliadas:</b> ${descricaoModulo}
                </p>
              </main>

              <footer class="rodape-cert">
                <div class="bloco-assinatura">
                  <div class="linha-assinatura"></div>
                  <p class="nome-assinante">Professora Sediane</p>
                  <p class="cargo-assinante">Coordenadora e Instrutora de Sistemas Operacionais</p>
                </div>

                <div class="bloco-selo">
                  <div class="emblema-selo">
                    <span>🐧</span>
                    <b>OFICIAL</b>
                  </div>
                  <p class="meta-emissao">Emitido em ${dataFormatada} às ${horaFormatada}</p>
                  <p class="meta-emissao">Registro: <code>${dados.codigoAutenticidade}</code></p>
                </div>

                <div class="bloco-assinatura">
                  <div class="linha-assinatura"></div>
                  <p class="nome-assinante">Laboratório de Sistemas Operacionais</p>
                  <p class="cargo-assinante">Ambiente Linux Ubuntu · Validação Automatizada</p>
                </div>
              </footer>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const janela = window.open('', '_blank');
    if (janela) {
      janela.document.write(htmlDiploma);
      janela.document.close();
    } else {
      // Fallback se popup bloqueado: abre no próprio documento via iframe invisível para impressão imediata
      const frame = document.createElement('iframe');
      frame.style.position = 'fixed';
      frame.style.right = '0';
      frame.style.bottom = '0';
      frame.style.width = '0';
      frame.style.height = '0';
      frame.style.border = '0';
      document.body.appendChild(frame);
      frame.contentDocument?.write(htmlDiploma);
      frame.contentDocument?.close();
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    }
  }

  private static obterDescricaoConteudo(idModalidade: string): string {
    switch (idModalidade) {
      case 'basico':
        return 'Navegação em diretórios FHS, manipulação de arquivos, cópia e movimentação, pipes, redirecionamentos de fluxos padrão I/O e filtros essenciais.';
      case 'medio':
        return 'Gerenciamento de contas de usuários e grupos, permissões octais e simbólicas (chmod, chown, chgrp), permissões especiais (SUID, SGID, Sticky Bit) e grupos secundários.';
      case 'avancado':
        return 'Administração de unidades e serviços no Systemd, gerenciamento e manutenção de pacotes APT, inspeção e controle de processos, arquivamento tar/gzip e links simbólicos.';
      case 'essentials':
        return 'Objetivos oficiais da certificação LPI Linux Essentials (010-160): padrão FHS, segurança de arquivos, usuários, linhas de comando e scripts bash.';
      case 'lpic1':
        return 'Objetivos profissionais do exame LPIC-1 (101 e 102): manutenção avançada do sistema, automação de boot, controle de serviços, sysctl e integridade do SO.';
      case 'escola':
        return 'Administração de servidores corporativos e acadêmicos Linux, isolamento departamental de permissões, políticas de senhas e auditoria de serviços.';
      case 'quiz-essentials':
      case 'quiz-lpic1':
      case 'quiz':
        return 'Conhecimentos teóricos de arquitetura, segurança, empacotamento e comandos em conformidade com as diretrizes oficiais LPI e CompTIA Linux+.';
      default:
        return 'Administração do sistema operacional Linux, comandos do interpretador Bash, manipulação de arquivos e serviços.';
    }
  }
}
