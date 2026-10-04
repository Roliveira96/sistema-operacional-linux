import type { Licao, Topico } from '../conteudo/Topico';

/** A "cola" oficial de estudo: resumo padronizado de todos os tópicos e comandos. */
export class ColaDeComandos {
  public static html(topicos: Topico[]): string {
    let html = '<div class="cola-topo">';
    html += '  <div class="cola-topo-texto">';
    html += '    <p class="cola-titulo-intro">Tabela Oficial de Comandos e Atalhos para Estudo e Revisão</p>';
    html += '    <p class="cola-subtitulo-intro">Consulte a sintaxe, objetivo e exemplos de cada comando cobrado em aula e provas oficiais.</p>';
    html += '  </div>';
    html += '  <button type="button" class="botao-secundario btn-imprimir-cola" onclick="window.print()" title="Imprimir cola ou salvar como PDF">🖨️ Imprimir / PDF</button>';
    html += '</div>';

    // Barra padronizada de navegação rápida por tópicos
    html += '<nav class="cola-atalhos-rapidos" aria-label="Navegação rápida por tópicos">';
    html += '  <span class="cola-rotulo-ir">Ir para:</span>';

    for (const topico of topicos) {
      if (topico.licoes.length === 0) continue;
      const nomeCurto = ColaDeComandos.nomeCurto(topico);
      html += `  <button type="button" class="cola-tag-link" onclick="document.getElementById('cola-topico-${topico.id}')?.scrollIntoView({behavior:'smooth', block:'start'})">${topico.icone} ${ColaDeComandos.escapar(nomeCurto)}</button>`;
      if (topico.id === 'arquivos') {
        html += `  <button type="button" class="cola-tag-link" onclick="document.getElementById('cola-topico-nano')?.scrollIntoView({behavior:'smooth', block:'start'})">📄 Nano</button>`;
        html += `  <button type="button" class="cola-tag-link" onclick="document.getElementById('cola-topico-vim')?.scrollIntoView({behavior:'smooth', block:'start'})">🖋️ Vim</button>`;
      }
    }
    html += '</nav>';

    for (const topico of topicos) {
      if (topico.licoes.length === 0) continue;

      html += `<section id="cola-topico-${topico.id}" class="cola-secao-topico">`;
      html += `  <div class="cola-secao-cabecalho">`;
      html += `    <h3>${topico.icone} ${ColaDeComandos.escapar(topico.titulo)}</h3>`;
      html += `  </div>`;
      html += '  <table class="tabela cola">';
      html += '    <thead>';
      html += '      <tr>';
      html += '        <th style="width:26%;">Comando / Atalho</th>';
      html += '        <th style="width:40%;">O que faz</th>';
      html += '        <th style="width:34%;">Exemplo / Sintaxe</th>';
      html += '      </tr>';
      html += '    </thead>';
      html += '    <tbody>';

      for (const licao of topico.licoes) {
        let titulo = ColaDeComandos.escapar(licao.titulo);
        let exemplo = ColaDeComandos.escapar(ColaDeComandos.exemplo(licao));

        if (licao.comando === 'nano') {
          titulo = 'Editor de texto simples de terminal';
          exemplo = 'nano arquivo.txt';
        } else if (licao.comando === 'vim') {
          titulo = 'Editor de texto modal padrão Unix/LPIC-1';
          exemplo = 'vim arquivo.txt';
        }

        html += `      <tr>`;
        html += `        <td><code>${ColaDeComandos.escapar(licao.comando)}</code></td>`;
        html += `        <td>${titulo}</td>`;
        html += `        <td><code>${exemplo}</code></td>`;
        html += `      </tr>`;
      }

      html += '    </tbody>';
      html += '  </table>';

      // Logo após o tópico de arquivos, inclui as seções padronizadas do Nano e do Vim
      if (topico.id === 'arquivos') {
        html += ColaDeComandos.nanoHtml();
        html += ColaDeComandos.vimHtml();
      }

      html += `</section>`;
    }

    return html;
  }

  /** Seção padronizada de comandos e atalhos do GNU nano */
  public static nanoHtml(): string {
    return `<section id="cola-topico-nano" class="cola-secao-topico" style="margin-top:24px;">
      <div class="cola-secao-cabecalho">
        <h3>📄 GNU nano (Editor Simples de Terminal)</h3>
        <span class="cola-badge-topico">LPIC-1 103.8</span>
      </div>
      <table class="tabela cola">
        <thead>
          <tr>
            <th style="width:26%;">Comando / Atalho</th>
            <th style="width:40%;">O que faz</th>
            <th style="width:34%;">Exemplo / Sintaxe</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>nano arquivo</code></td>
            <td>Abrir ou criar arquivo no terminal</td>
            <td><code>nano /etc/hosts</code></td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>O</kbd></td>
            <td><b>Gravar / Salvar</b> alterações (<i>WriteOut</i>)</td>
            <td>Confirma com <kbd>Enter</kbd></td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>X</kbd></td>
            <td><b>Sair do editor</b> nano</td>
            <td>Pergunta <kbd>S</kbd> (salvar) ou <kbd>N</kbd> (descartar)</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>K</kbd></td>
            <td>Recortar linha inteira (<i>Cut</i>)</td>
            <td>Apaga a linha e armazena na memória</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>U</kbd></td>
            <td>Colar linha recortada (<i>Uncut</i>)</td>
            <td>Cola na posição atual do cursor</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>W</kbd></td>
            <td>Pesquisar palavra no arquivo (<i>Where Is</i>)</td>
            <td>Digite o termo e tecle <kbd>Enter</kbd></td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>\\</kbd></td>
            <td>Localizar e substituir texto no arquivo</td>
            <td>Substitui ocorrências no documento</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>G</kbd></td>
            <td>Ajuda integrada com todos os atalhos</td>
            <td>Exibe tela de ajuda do nano</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>_</kbd></td>
            <td>Pular para número de linha específico</td>
            <td>Digite o número da linha + <kbd>Enter</kbd></td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>C</kbd></td>
            <td>Cancelar prompt / Ver posição do cursor</td>
            <td>Mostra linha e coluna atuais</td>
          </tr>
        </tbody>
      </table>
    </section>`;
  }

  /** Seção padronizada de comandos e modos do Vim */
  public static vimHtml(): string {
    return `<section id="cola-topico-vim" class="cola-secao-topico" style="margin-top:24px;">
      <div class="cola-secao-cabecalho">
        <h3>🖋️ Vim (Editor Modal Padrão Unix / LPIC-1)</h3>
        <span class="cola-badge-topico">LPIC-1 103.8</span>
      </div>
      <table class="tabela cola">
        <thead>
          <tr>
            <th style="width:26%;">Comando / Atalho</th>
            <th style="width:40%;">O que faz</th>
            <th style="width:34%;">Exemplo / Sintaxe</th>
          </tr>
        </thead>
        <tbody>
          <tr class="cola-divisor"><td colspan="3">1. Alternância de Modos e Digitação</td></tr>
          <tr>
            <td><kbd>i</kbd></td>
            <td>Entrar no <b>Modo Inserção</b> (antes do cursor)</td>
            <td>Inicia digitação livre de texto</td>
          </tr>
          <tr>
            <td><kbd>a</kbd></td>
            <td>Inserir texto após o cursor (<i>append</i>)</td>
            <td>Adiciona texto após o caractere</td>
          </tr>
          <tr>
            <td><kbd>o</kbd> / <kbd>O</kbd></td>
            <td>Inserir em nova linha abaixo / acima</td>
            <td>Abre linha e já entra digitando</td>
          </tr>
          <tr>
            <td><kbd>Esc</kbd></td>
            <td><b>Voltar ao Modo Normal</b> (salva-vidas)</td>
            <td>Cancela comandos e volta ao Normal</td>
          </tr>

          <tr class="cola-divisor"><td colspan="3">2. Gravação e Saída (Modo de Comando com :)</td></tr>
          <tr>
            <td><code>:w</code></td>
            <td>Gravar alterações no disco (<i>write</i>)</td>
            <td><code>:w</code> (sem fechar o Vim)</td>
          </tr>
          <tr>
            <td><code>:q</code></td>
            <td>Sair do Vim (<i>quit</i>)</td>
            <td><code>:q</code> (recusa se houver alterações)</td>
          </tr>
          <tr>
            <td><code>:wq</code> ou <code>:x</code></td>
            <td><b>Salvar e sair</b> do editor</td>
            <td><code>:wq</code> (ou aperte <kbd>Z</kbd><kbd>Z</kbd>)</td>
          </tr>
          <tr>
            <td><code>:q!</code></td>
            <td><b>Sair forçado sem salvar</b> (salva-vidas)</td>
            <td><code>:q!</code> (descarta alterações)</td>
          </tr>
          <tr>
            <td><code>:w novo.txt</code></td>
            <td>Salvar como outro arquivo</td>
            <td><code>:w backup.txt</code></td>
          </tr>

          <tr class="cola-divisor"><td colspan="3">3. Edição Rápida, Cópia e Busca (no Modo Normal)</td></tr>
          <tr>
            <td><code>dd</code></td>
            <td>Apagar / recortar linha inteira</td>
            <td><code>dd</code> (ou <code>3dd</code> para 3 linhas)</td>
          </tr>
          <tr>
            <td><code>yy</code></td>
            <td>Copiar linha inteira (<i>yank</i>)</td>
            <td><code>yy</code> (ou <code>2yy</code> para 2 linhas)</td>
          </tr>
          <tr>
            <td><code>p</code> / <code>P</code></td>
            <td>Colar linha copiada ou recortada</td>
            <td><code>p</code> (abaixo) ou <code>P</code> (acima)</td>
          </tr>
          <tr>
            <td><code>x</code></td>
            <td>Apagar caractere sob o cursor</td>
            <td>Equivalente à tecla Delete</td>
          </tr>
          <tr>
            <td><code>u</code></td>
            <td><b>Desfazer</b> última alteração (<i>undo</i>)</td>
            <td>Restaura o estado anterior</td>
          </tr>
          <tr>
            <td><kbd>Ctrl</kbd> + <kbd>r</kbd></td>
            <td><b>Refazer</b> alteração desfeita (<i>redo</i>)</td>
            <td>Reaplica o que foi desfeito por <code>u</code></td>
          </tr>
          <tr>
            <td><code>/termo</code></td>
            <td>Buscar palavra para frente</td>
            <td><code>/root</code> (<kbd>n</kbd> próximo, <kbd>N</kbd> anterior)</td>
          </tr>
          <tr>
            <td><code>gg</code> / <code>G</code></td>
            <td>Ir para a primeira / última linha</td>
            <td><code>gg</code> (início) e <code>G</code> (fim)</td>
          </tr>
          <tr>
            <td><code>:42</code></td>
            <td>Pular direto para a linha indicada</td>
            <td><code>:42</code> (vai para a linha 42)</td>
          </tr>
          <tr>
            <td><code>:set number</code></td>
            <td>Exibir números de linha na margem</td>
            <td><code>:set number</code> (ou <code>:set nu</code>)</td>
          </tr>
        </tbody>
      </table>
    </section>`;
  }

  private static nomeCurto(topico: Topico): string {
    const nomes: Record<string, string> = {
      historia: 'História',
      estrutura: 'Estrutura FHS',
      diretorios: 'Diretórios',
      arquivos: 'Arquivos',
      exclusao: 'Exclusão',
      permissoes: 'Permissões',
      usuarios: 'Usuários',
      pacotes: 'Pacotes',
    };
    return nomes[topico.id] ?? topico.titulo.split(' ')[0];
  }

  private static exemplo(licao: Licao): string {
    const principal = licao.exemplos.find((p) => p.comando.startsWith(licao.comando.split(' ')[0])) ?? licao.exemplos[0];
    return principal !== undefined ? principal.comando : licao.sintaxe;
  }

  public static escapar(texto: string): string {
    return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
