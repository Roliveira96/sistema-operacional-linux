/** Um link de contato exibido na capa. */
export interface LinkDoAutor {
  rotulo: string;
  endereco: string;
  icone: string;
}

/** Dados de quem apresenta o trabalho (vindos do perfil público do Gravatar). */
export class Autor {
  private readonly nome: string;
  private readonly cargo: string;
  private readonly local: string;
  private readonly sobre: string;
  private readonly foto: string;
  private readonly links: LinkDoAutor[];

  constructor(nome: string, cargo: string, local: string, sobre: string, foto: string, links: LinkDoAutor[]) {
    this.nome = nome;
    this.cargo = cargo;
    this.local = local;
    this.sobre = sobre;
    this.foto = foto;
    this.links = links;
  }

  public gerarHtml(): string {
    let links: string = '';
    for (const link of this.links) {
      links += '<a class="autor-link" href="' + link.endereco + '" target="_blank" rel="noopener">' +
        link.icone + '<span>' + link.rotulo + '</span></a>';
    }
    return '<section class="autor">' +
      '<img class="autor-foto" src="' + this.foto + '" alt="Foto de ' + this.nome + '" width="112" height="112">' +
      '<div class="autor-dados">' +
      '  <span class="autor-rotulo">Apresentado por</span>' +
      '  <h2>' + this.nome + '</h2>' +
      '  <p class="autor-cargo">' + this.cargo + ' · ' + this.local + '</p>' +
      '  <p class="autor-sobre">' + this.sobre + '</p>' +
      '  <nav class="autor-links">' + links + '</nav>' +
      '</div>' +
      '</section>';
  }
}
