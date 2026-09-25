/** Pequenos componentes interativos que aparecem dentro dos cards de estudo. */
export class Widgets {
  public static html(tipo: 'calculadora-permissoes' | 'anatomia-ls'): string {
    return tipo === 'calculadora-permissoes' ? Widgets.calculadora() : Widgets.anatomia();
  }

  /** Liga os eventos depois que o HTML entrou na página. */
  public static ativar(raiz: HTMLElement): void {
    raiz.querySelectorAll<HTMLElement>('.calc').forEach((calc: HTMLElement) => Widgets.ativarCalculadora(calc));
  }

  private static calculadora(): string {
    const quem: Array<[string, string]> = [['u', 'Dono (u)'], ['g', 'Grupo (g)'], ['o', 'Outros (o)']];
    const valores: Record<string, number[]> = { u: [1, 1, 1], g: [1, 0, 1], o: [1, 0, 0] };
    let linhas: string = '';
    for (const [chave, rotulo] of quem) {
      linhas += '<tr><th>' + rotulo + '</th>';
      ['r', 'w', 'x'].forEach((letra: string, i: number) => {
        linhas += '<td><label class="calc-bit"><input type="checkbox" data-quem="' + chave + '" data-bit="' + (4 >> i) + '"' +
          (valores[chave][i] === 1 ? ' checked' : '') + '><span>' + letra + '</span></label></td>';
      });
      linhas += '<td class="calc-soma" data-soma="' + chave + '"></td></tr>';
    }
    return '<div class="calc">' +
      '<div class="calc-titulo">🧮 Calculadora de permissões: marque e veja o número</div>' +
      '<table class="calc-tabela"><tr><th></th><th>r = 4<br><small>ler</small></th><th>w = 2<br><small>escrever</small></th>' +
      '<th>x = 1<br><small>executar</small></th><th>soma</th></tr>' + linhas + '</table>' +
      '<div class="calc-resultado">' +
      '  <label>Octal <input class="calc-octal" maxlength="3" inputmode="numeric" spellcheck="false"></label>' +
      '  <span class="calc-texto"></span>' +
      '  <code class="calc-comando"></code>' +
      '</div></div>';
  }

  private static ativarCalculadora(calc: HTMLElement): void {
    const caixas: HTMLInputElement[] = Array.from(calc.querySelectorAll('input[type="checkbox"]'));
    const campo: HTMLInputElement = calc.querySelector('.calc-octal') as HTMLInputElement;
    const texto: HTMLElement = calc.querySelector('.calc-texto') as HTMLElement;
    const comando: HTMLElement = calc.querySelector('.calc-comando') as HTMLElement;
    const atualizar = (escreverCampo: boolean): void => {
      let octal: string = '';
      let simbolico: string = '-';
      for (const quem of ['u', 'g', 'o']) {
        let soma: number = 0;
        for (const caixa of caixas.filter((c: HTMLInputElement) => c.dataset.quem === quem)) {
          if (caixa.checked) soma += Number(caixa.dataset.bit);
          simbolico += caixa.checked ? (caixa.nextElementSibling as HTMLElement).textContent : '-';
        }
        octal += soma;
        (calc.querySelector('[data-soma="' + quem + '"]') as HTMLElement).textContent = String(soma);
      }
      if (escreverCampo) campo.value = octal;
      texto.textContent = simbolico;
      comando.textContent = 'chmod ' + octal + ' arquivo';
    };
    caixas.forEach((caixa: HTMLInputElement) => caixa.addEventListener('change', () => atualizar(true)));
    campo.addEventListener('input', () => {
      if (!/^[0-7]{3}$/.test(campo.value)) return;
      ['u', 'g', 'o'].forEach((quem: string, i: number) => {
        const valor: number = Number(campo.value.charAt(i));
        for (const caixa of caixas.filter((c: HTMLInputElement) => c.dataset.quem === quem)) {
          caixa.checked = (valor & Number(caixa.dataset.bit)) !== 0;
        }
      });
      atualizar(false);
    });
    atualizar(true);
  }

  private static anatomia(): string {
    const partes: Array<[string, string, string]> = [
      ['-', 'tipo', '<b>-</b> arquivo · <b>d</b> diretório · <b>l</b> link'],
      ['rwx', 'dono', 'o que o <b>dono</b> pode'],
      ['r-x', 'grupo', 'o que o <b>grupo</b> pode'],
      ['r--', 'outros', 'o que <b>os outros</b> podem'],
      ['1', 'links', 'nº de links'],
      ['maria', 'dono', 'usuário <b>dono</b>'],
      ['dev', 'grupo', '<b>grupo</b> do arquivo'],
      ['1024', 'tamanho', 'tamanho em bytes'],
      ['set 25 10:00', 'data', 'última modificação'],
      ['script.sh', 'nome', 'nome'],
    ];
    let linha: string = '';
    let legenda: string = '';
    partes.forEach(([texto, classe, descricao], i: number) => {
      linha += '<span class="an-' + classe + '" data-n="' + (i + 1) + '">' + texto + '</span>' + (i >= 3 ? ' ' : '');
      legenda += '<li class="an-' + classe + '"><b>' + (i + 1) + '</b> ' + descricao + '</li>';
    });
    return '<div class="anatomia"><div class="calc-titulo">🔬 Como ler uma linha do <code>ls -l</code></div>' +
      '<pre class="anatomia-linha">' + linha + '</pre><ol class="anatomia-legenda">' + legenda + '</ol></div>';
  }
}
