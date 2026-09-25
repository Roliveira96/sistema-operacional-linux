import type { Tela } from './Tela';
import { Bancada } from './Bancada';

/** Simulador livre: a máquina inteira com até 3 terminais lado a lado, sem roteiro. */
export class TelaLaboratorio implements Tela {
  private bancada: Bancada | null = null;

  public montar(raiz: HTMLElement): void {
    raiz.innerHTML =
      '<div class="tela tela-laboratorio">' +
      '  <header class="tela-cabecalho">' +
      '    <a class="botao-voltar" href="#/">← Menu</a>' +
      '    <div class="tela-titulo"><span class="tela-icone">🖥️</span>' +
      '      <div><h1>Laboratório livre</h1><p>Servidor Ubuntu simulado · até 3 conexões SSH</p></div></div>' +
      '    <div class="brand-utfpr-header" title="Universidade Tecnológica Federal do Paraná - Campus Guarapuava">' +
      '      <img src="/utfpr-logo.svg" alt="UTFPR" class="logo-utfpr-header" />' +
      '      <span class="brand-utfpr-campus-tag">Campus Guarapuava</span>' +
      '    </div>' +
      '    <span class="aviso-senhas">senhas: <b>root</b> = <b>123</b> · <b>ricardo</b> = <b>123</b></span>' +
      '    <nav class="tela-acoes">' +
      '      <button class="botao-secundario" data-acao="exportar" title="Baixa o sistema de arquivos e as contas em JSON">💾 Exportar JSON</button>' +
      '      <button class="botao-secundario" data-acao="importar" title="Carrega uma máquina salva em JSON">📂 Importar</button>' +
      '      <button class="botao-secundario" data-acao="reiniciar" title="Apaga tudo e volta ao estado inicial">🔄 Reiniciar máquina</button>' +
      '    </nav>' +
      '  </header>' +
      '  <main class="laboratorio-corpo"><div class="laboratorio-janela"></div>' +
      '    <p class="laboratorio-dica">💡 A aba <b>1</b> já está logada como <b>root</b>. Clique em <b>＋</b> para abrir outra conexão SSH e entrar com outro usuário ' +
      '(crie com <code>useradd -m -s /bin/bash maria</code> e defina a senha com <code>passwd maria</code>). ' +
      '<b>⊞ Lado a lado</b> mostra os terminais juntos. Tudo fica salvo no navegador.</p></main>' +
      '</div>';
    const bancada: Bancada = new Bancada(raiz.querySelector('.laboratorio-janela') as HTMLElement, 'laboratorio', () => undefined, () => undefined, true);
    this.bancada = bancada;
    raiz.querySelector('[data-acao="exportar"]')?.addEventListener('click', () => bancada.exportar());
    raiz.querySelector('[data-acao="importar"]')?.addEventListener('click', () => void bancada.importar());
    raiz.querySelector('[data-acao="reiniciar"]')?.addEventListener('click', () => {
      if (window.confirm('Reiniciar a máquina do laboratório? Arquivos, usuários e grupos criados serão apagados.')) bancada.reiniciar();
    });
  }

  public desmontar(): void {
    this.bancada?.destruir();
  }
}
