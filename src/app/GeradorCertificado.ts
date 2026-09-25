import type { ModalidadeSimulado } from '../conteudo/Topico';
import { gerarQrCodeSvgSincrono } from './QrCodeCertificado';

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
          <div class="sim-modal-cert-brand">
            <img src="/utfpr-logo.svg" alt="UTFPR" class="logo-modal-cert" />
          </div>
          <div>
            <h3>Emissão de Certificado de Conclusão</h3>
            <p class="modal-cert-univ">Universidade Tecnológica Federal do Paraná · Campus Guarapuava</p>
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
            placeholder="Ex.: Ricardo Martins de Oliveira"
            required
            minlength="3"
            autofocus
          />

          <div class="sim-modal-cert-info-box">
            <span>🏛️ <b>Instituição:</b> Universidade Tecnológica Federal do Paraná - UTFPR (Campus Guarapuava)</span>
            <span>📋 <b>Módulo:</b> ${modalidade.titulo}</span>
            <span>⭐ <b>Aproveitamento:</b> ${porcentagem}% ${porcentagem === 100 ? '<b>(Com Excelência)</b>' : ''}</span>
            <span>✍️ <b>Avaliadora:</b> Professora Sediane Carmem Lunardi Hernandes</span>
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
   * Abre um exemplo oficial do certificado para visualização rápida.
   */
  public static exibirExemplo(nomeAluno: string = 'Ricardo Martins de Oliveira'): void {
    GeradorCertificado.exibirCertificado({
      nomeAluno,
      modalidade: {
        id: 'lpic1',
        titulo: 'LPIC-1: Administrador Linux Profissional',
        descricao: 'Exame de proficiência prática em administração e segurança de sistemas Linux.',
        icone: '🐧',
      },
      porcentagem: 100,
      totalTarefas: 10,
      tempoGeralSegundos: 840,
      dataEmissao: new Date(),
      codigoAutenticidade: `UTFPR-LPIC1-${Math.random().toString(36).substring(2, 7).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    });
  }

  /**
   * Gera o HTML completo do diploma oficial para exibição ou impressão.
   */
  public static gerarHtmlDiploma(dados: DadosCertificado): string {
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
    const logoUrl = typeof window !== 'undefined' && window.location ? (window.location.origin + '/utfpr-logo.svg') : '/utfpr-logo.svg';
    const logoTsiUrl = typeof window !== 'undefined' && window.location ? (window.location.origin + '/tsi.png') : '/tsi.png';
    const linkValidacao = `https://github.com/Roliveira96/sistema-operacional-linux?cert=${dados.codigoAutenticidade}`;
    const qrCodeSvg = gerarQrCodeSvgSincrono(linkValidacao);

    return `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Certificado - ${dados.nomeAluno} - Professora Sediane - UTFPR</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;800;900&family=Great+Vibes&family=Inter:wght@400;500;600;700;800&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300;1,400&display=swap" rel="stylesheet" />
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
            font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #18181b;
            color: #231F20;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
          }
          .folha-diploma {
            width: 1040px;
            height: 720px;
            max-height: 720px;
            background: #fffdf9;
            padding: 14px;
            position: relative;
            box-shadow: 0 20px 45px rgba(0,0,0,0.45);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow: hidden;
          }
          .borda-externa {
            width: 100%;
            height: 100%;
            border: 4px solid #231F20;
            padding: 5px;
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .borda-interna {
            width: 100%;
            height: 100%;
            border: 2.5px solid #F6C212;
            padding: 16px 28px 14px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
          }
          .canto {
            position: absolute;
            width: 22px;
            height: 22px;
            border: 2.5px solid #F6C212;
          }
          .canto-tl { top: 4px; left: 4px; border-right: none; border-bottom: none; }
          .canto-tr { top: 4px; right: 4px; border-left: none; border-bottom: none; }
          .canto-bl { bottom: 4px; left: 4px; border-right: none; border-top: none; }
          .canto-br { bottom: 4px; right: 4px; border-left: none; border-top: none; }

          .cabecalho-cert {
            text-align: center;
          }
          .cert-logo-topo {
            text-align: center;
            margin-bottom: 4px;
          }
          .logo-diploma-utfpr {
            height: 38px;
            width: auto;
            display: inline-block;
          }
          .instituicao-governo {
            font-size: 9px;
            letter-spacing: 2px;
            color: #71717a;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .instituicao-titulo {
            font-size: 15px;
            letter-spacing: 2px;
            color: #231F20;
            text-transform: uppercase;
            font-weight: 800;
            margin-bottom: 2px;
          }
          .instituicao-campus {
            font-size: 11px;
            letter-spacing: 1.5px;
            color: #b45309;
            font-weight: 800;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .diploma-titulo {
            font-family: 'Cinzel', serif;
            font-size: 26px;
            font-weight: 900;
            color: #231F20;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin: 2px 0;
          }
          .diploma-subtitulo {
            font-size: 11px;
            color: #52525b;
            font-weight: 700;
            letter-spacing: 1.5px;
            text-transform: uppercase;
          }

          .corpo-cert {
            text-align: center;
            margin: 4px 0;
          }
          .texto-certificamos {
            font-size: 13.5px;
            color: #52525b;
            font-style: italic;
            font-family: 'Merriweather', Georgia, serif;
          }
          .nome-aluno-destaque {
            font-family: 'Cinzel', serif;
            font-size: 25px;
            font-weight: 800;
            color: #231F20;
            text-transform: uppercase;
            letter-spacing: 2px;
            margin: 6px 0 8px;
            border-bottom: 2.5px solid #F6C212;
            display: inline-block;
            padding: 0 24px 4px;
          }
          .texto-conclusao {
            font-size: 12.5px;
            line-height: 1.55;
            color: #27272a;
            max-width: 860px;
            margin: 0 auto;
            font-family: 'Merriweather', Georgia, serif;
          }
          .destaque-modulo {
            font-weight: 700;
            color: #231F20;
          }

          .marca-dagua-utfpr {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 660px;
            max-width: 82%;
            opacity: 0.045;
            pointer-events: none;
            z-index: 1;
            user-select: none;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .marca-dagua-utfpr img {
            width: 100%;
            height: auto;
            display: block;
          }

          .texto-distincao-solene {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: #b45309;
            margin-top: 6px;
          }
          .docente-nome-destaque {
            font-size: 13.5px;
            font-weight: 700;
            color: #231F20;
            letter-spacing: 0.5px;
            margin: 4px 0 6px;
          }
          .texto-ementa {
            font-size: 10.5px;
            color: #71717a;
            margin-top: 4px;
            font-family: 'Inter', sans-serif;
            font-style: italic;
          }

          .cabecalho-cert,
          .corpo-cert,
          .rodape-cert {
            position: relative;
            z-index: 2;
          }

          .rodape-cert {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            margin-top: 8px;
            padding-top: 6px;
          }
          .bloco-assinatura {
            text-align: center;
            width: 250px;
          }
          .assinatura-rubrica {
            font-family: 'Great Vibes', 'Brush Script MT', cursive, serif;
            font-size: 24px;
            color: #231F20;
            margin-bottom: 2px;
            line-height: 1;
          }
          .linha-assinatura {
            border-top: 1.5px solid #231F20;
            margin-bottom: 4px;
          }
          .nome-assinante {
            font-size: 12px;
            font-weight: 700;
            color: #231F20;
          }
          .cargo-assinante {
            font-size: 10px;
            color: #52525b;
            font-family: 'Inter', sans-serif;
          }

          .bloco-centro-validacao {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
          }
          .bloco-selo {
            text-align: center;
          }
          .emblema-selo-tsi {
            width: 86px;
            height: 52px;
            background: #ffffff;
            border: 1.5px solid #231F20;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 3px;
            padding: 3px 6px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          }
          .logo-selo-tsi {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            display: block;
          }
          .bloco-qrcode {
            text-align: center;
          }
          .moldura-qrcode {
            width: 52px;
            height: 52px;
            background: #ffffff;
            border: 1.5px solid #231F20;
            border-radius: 4px;
            padding: 2px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 3px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          }
          .meta-emissao {
            font-size: 9.5px;
            color: #52525b;
            font-family: 'Inter', sans-serif;
            line-height: 1.3;
          }
          .meta-emissao code {
            font-family: monospace;
            font-size: 9px;
            color: #231F20;
            font-weight: bold;
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
            background: #F6C212;
            color: #231F20;
            border: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(246, 194, 18, 0.4);
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .btn-imprimir:hover {
            background: #e5b30d;
          }
          .btn-fechar {
            padding: 10px 18px;
            background: #3f3f46;
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
              max-height: 100vh;
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

              <div class="marca-dagua-utfpr" aria-hidden="true">
                <img src="${logoUrl}" alt="" />
              </div>

              <header class="cabecalho-cert">
                <div class="cert-logo-topo">
                  <img src="${logoUrl}" alt="UTFPR" class="logo-diploma-utfpr" />
                </div>
                <p class="instituicao-governo">REPÚBLICA FEDERATIVA DO BRASIL · MINISTÉRIO DA EDUCAÇÃO</p>
                <p class="instituicao-titulo">UNIVERSIDADE TECNOLÓGICA FEDERAL DO PARANÁ - UTFPR</p>
                <p class="instituicao-campus">CAMPUS GUARAPUAVA</p>
                <h1 class="diploma-titulo">Certificado de Conclusão</h1>
                <p class="diploma-subtitulo">EXAME PRÁTICO E AVALIAÇÃO DE COMPETÊNCIAS · PROFESSORA SEDIANE</p>
              </header>

              <main class="corpo-cert">
                <p class="texto-certificamos">Certificamos com louvor que</p>
                <h2 class="nome-aluno-destaque">${dados.nomeAluno}</h2>
                <p class="texto-conclusao">
                  concluiu com êxito o exame de certificação prática e avaliação de competências no módulo
                  <span class="destaque-modulo">${dados.modalidade.titulo}</span>,
                  demonstrando proficiência nas tarefas de terminal do sistema operacional Linux com aproveitamento de
                  <b>${dados.porcentagem}%</b> em avaliação técnica realizada na
                  <b>Universidade Tecnológica Federal do Paraná - UTFPR (Campus Guarapuava)</b>,
                  sob a orientação, supervisão e avaliação da docente <b>Professora Sediane Carmem Lunardi Hernandes</b>.
                </p>

                ${
                  ehExcelencia
                    ? `<p class="texto-distincao-solene">Distinção Acadêmica com Louvor · 100% de Aproveitamento</p>`
                    : ``
                }
                <p class="docente-nome-destaque">Professora Sediane Carmem Lunardi Hernandes</p>

                <p class="texto-ementa">
                  <b>Competências avaliadas:</b> ${descricaoModulo}
                </p>
              </main>

              <footer class="rodape-cert">
                <div class="bloco-assinatura">
                  <div class="assinatura-rubrica" aria-hidden="true">Sediane C. L. Hernandes</div>
                  <div class="linha-assinatura"></div>
                  <p class="nome-assinante">Professora Sediane Carmem Lunardi Hernandes</p>
                  <p class="cargo-assinante">Docente Avaliadora e Coordenadora</p>
                  <p class="cargo-assinante">UTFPR · Campus Guarapuava</p>
                </div>

                <div class="bloco-centro-validacao">
                  <div class="bloco-selo">
                    <div class="emblema-selo-tsi" title="Tecnologia em Sistemas para Internet - UTFPR">
                      <img src="${logoTsiUrl}" alt="TSI UTFPR" class="logo-selo-tsi" />
                    </div>
                    <p class="meta-emissao"><b>TSI · Campus Guarapuava</b></p>
                    <p class="meta-emissao">${dataFormatada} às ${horaFormatada}</p>
                  </div>

                  <div class="bloco-qrcode">
                    <div class="moldura-qrcode" title="Escaneie para validar a autenticidade deste certificado">
                      ${qrCodeSvg}
                    </div>
                    <p class="meta-emissao"><b>Autenticidade</b></p>
                    <p class="meta-emissao"><code>${dados.codigoAutenticidade}</code></p>
                  </div>
                </div>

                <div class="bloco-assinatura">
                  <div class="assinatura-rubrica" aria-hidden="true">Coord. Sistemas Operacionais</div>
                  <div class="linha-assinatura"></div>
                  <p class="nome-assinante">Laboratório de Sistemas Operacionais</p>
                  <p class="cargo-assinante">Universidade Tecnológica Federal do Paraná</p>
                  <p class="cargo-assinante">Campus Guarapuava</p>
                </div>
              </footer>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Renderiza a visualização do certificado e disponibiliza botão de impressão/PDF.
   */
  public static exibirCertificado(dados: DadosCertificado): void {
    const htmlDiploma = GeradorCertificado.gerarHtmlDiploma(dados);
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
