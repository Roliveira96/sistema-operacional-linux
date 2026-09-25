import type { Tela } from './Tela';
import type { Topico } from '../conteudo/Topico';
import type { CatalogoDeTopicos } from '../conteudo/CatalogoDeTopicos';
import { Autor } from './Autor';
import { JanelaModal } from './JanelaModal';
import { ColaDeComandos } from './ColaDeComandos';

const ICONE_GITHUB: string =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
const ICONE_LINKEDIN: string =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 110-4.13 2.06 2.06 0 010 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>';
const ICONE_SITE: string =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.8 2.7 4 6.1 4 10s-1.2 7.3-4 10m0-20C9.2 4.7 8 8.1 8 12s1.2 7.3 4 10M2 12h20"/></svg>';

/** Tela inicial: os tópicos da prova, o laboratório livre e a cola. */
export class TelaMenu implements Tela {
  private readonly catalogo: CatalogoDeTopicos;
  private modal: JanelaModal | null = null;
  private readonly autor: Autor = new Autor(
    'Ricardo Martins de Oliveira',
    'Software Developer / Backend Engineer na Studio4You',
    'Guarapuava, PR',
    'Material de estudo e preparatório para exames de certificação Linux (LPIC-1, Linux Essentials, CompTIA Linux+, RHCSA) e avaliação de suficiência.',
    'ricardo.png',
    [
      { rotulo: 'github.com/Roliveira96', endereco: 'https://github.com/Roliveira96', icone: ICONE_GITHUB },
      { rotulo: 'LinkedIn', endereco: 'https://www.linkedin.com/in/ricardodeoliveira96/', icone: ICONE_LINKEDIN },
      { rotulo: 'rmo.dev.br', endereco: 'https://rmo.dev.br', icone: ICONE_SITE },
    ],
  );

  constructor(catalogo: CatalogoDeTopicos) {
    this.catalogo = catalogo;
  }

  public montar(raiz: HTMLElement): void {
    let cards: string = '';
    for (const topico of this.catalogo.listar()) {
      cards += this.card(topico);
    }
    raiz.innerHTML =
      '<div class="menu">' +
      '  <header class="menu-cabecalho">' +
      '    <span class="menu-selo">Preparatório Certificações Linux · LPIC-1 · Linux Essentials</span>' +
      '    <h1>Linux na prática <span class="menu-pinguim">🐧</span></h1>' +
      '    <p>Guia interativo e preparatório para <b>certificações Linux</b> (LPI Linux Essentials, LPIC-1, CompTIA Linux+ e RHCSA). ' +
      'Os comandos que caem nas provas explicados um a um, com dicas oficiais de exames, pegadinhas e um <b>servidor Ubuntu simulado</b> ao lado: ' +
      'veja o comando rodando, depois pratique você mesmo em até <b>3 terminais</b> (um como root e outros como usuários comuns).</p>' +
      '    <div class="menu-botoes">' +
      '      <a class="botao-primario" href="#/laboratorio">🖥️ Abrir o laboratório livre</a>' +
      '      <button class="botao-secundario" data-acao="cola">📋 Cola de comandos</button>' +
      '    </div>' +
      '  </header>' +
      '  <nav class="menu-cards">' + cards + '</nav>' +
      '  <section class="menu-como">' +
      '    <div><b>1</b><span><b>Leia</b> o card do comando: o que faz, sintaxe, opções e a pegadinha de prova.</span></div>' +
      '    <div><b>2</b><span><b>Clique ▶</b> nos exemplos (ou no play do topo) e veja o comando sendo digitado no terminal.</span></div>' +
      '    <div><b>3</b><span><b>Pratique</b> nos 🎯 desafios: eles se corrigem sozinhos conforme você digita.</span></div>' +
      '  </section>' +
      '  <div class="pessoas">' + this.autor.gerarHtml() +
      '    <section class="professor"><div class="professor-monograma" aria-hidden="true">SH</div><div>' +
      '      <span class="autor-rotulo">Professora avaliadora</span><h2>Sediane Carmem Lunardi Hernandes</h2>' +
      '      <p class="professor-disciplina">UTFPR · Campus Guarapuava</p>' +
      '      <p class="professor-avaliacao">Avaliação de suficiência de Linux: diretórios, arquivos, exclusão, segurança de acesso, usuários e grupos.</p>' +
      '      <a class="autor-link professor-link" href="https://www.linkedin.com/in/sediane-hernandes-77b632a9/" target="_blank" rel="noopener">' + ICONE_LINKEDIN + '<span>LinkedIn</span></a></div></section>' +
      '  </div>' +
      '</div>';
    this.modal = new JanelaModal();
    raiz.querySelector('[data-acao="cola"]')?.addEventListener('click', () => {
      this.modal?.abrir('📋 Cola de comandos', ColaDeComandos.html(this.catalogo.listar()));
    });
  }

  public desmontar(): void {
    this.modal?.destruir();
  }

  private card(topico: Topico): string {
    const comandos: string = topico.licoes.length > 0
      ? topico.subtitulo.split(' · ').map((item: string) => '<code>' + item + '</code>').join(' ')
      : '<code>' + (topico.modalidades && topico.modalidades.length > 0 ? topico.modalidades.length + ' modalidades de simulado' : topico.desafios.length + ' tarefas') + '</code>';
    return '<a class="card" href="#/' + topico.id + '" style="--cor-card: var(' + topico.cor + ')">' +
      '<span class="card-numero">0' + topico.numero + '</span>' +
      '<span class="card-icone">' + topico.icone + '</span>' +
      '<h2>' + topico.titulo + '</h2>' +
      '<p>' + topico.resumo + '</p>' +
      '<div class="card-comandos">' + comandos + '</div>' +
      '<span class="card-abrir">Estudar →</span></a>';
  }
}
