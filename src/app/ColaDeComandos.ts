import type { Licao, Topico } from '../conteudo/Topico';

/** A "cola" oficial de estudo: todos os comandos de todos os tópicos numa tabela só. */
export class ColaDeComandos {
  public static html(topicos: Topico[]): string {
    let html: string = '<p>Resumo de todos os comandos do material. Use <b>🖨️ Imprimir</b> para levar no papel e revisar antes da prova.</p>';
    for (const topico of topicos) {
      if (topico.licoes.length === 0) continue;
      html += '<h3>' + topico.icone + ' ' + topico.titulo + '</h3><table class="tabela cola"><tr><th>Comando</th><th>O que faz</th><th>Exemplo</th></tr>';
      for (const licao of topico.licoes) {
        html += '<tr><td><code>' + licao.comando + '</code></td><td>' + licao.titulo + '</td><td><code>' +
          ColaDeComandos.escapar(ColaDeComandos.exemplo(licao)) + '</code></td></tr>';
      }
      html += '</table>';
    }
    return html;
  }

  private static exemplo(licao: Licao): string {
    const principal = licao.exemplos.find((p) => p.comando.startsWith(licao.comando.split(' ')[0])) ?? licao.exemplos[0];
    return principal !== undefined ? principal.comando : licao.sintaxe;
  }

  public static escapar(texto: string): string {
    return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
