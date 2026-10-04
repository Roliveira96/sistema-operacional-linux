import { describe, it, expect } from 'vitest';
import { CatalogoDeTopicos } from '../src/conteudo/CatalogoDeTopicos';
import { ColaDeComandos } from '../src/app/ColaDeComandos';

describe('ColaDeComandos', () => {
  it('gera HTML com resumo de tópicos e guia detalhado de editores', () => {
    const catalogo = new CatalogoDeTopicos();
    const html = ColaDeComandos.html(catalogo.listar());

    // Deve conter navegação rápida
    expect(html).toContain('cola-atalhos-rapidos');
    expect(html).toContain('📄 Nano');
    expect(html).toContain('🖋️ Vim');

    // Deve conter comandos principais dos tópicos
    expect(html).toContain('pwd');
    expect(html).toContain('ls');
    expect(html).toContain('mkdir');
    expect(html).toContain('chmod');
    expect(html).toContain('chown');

    // Deve conter as seções padronizadas de editores
    expect(html).toContain('id="cola-topico-nano"');
    expect(html).toContain('id="cola-topico-vim"');
    expect(html).toContain('GNU nano');
    expect(html).toContain('Vim (Editor Modal');

    // Atalhos essenciais do Nano
    expect(html).toContain('Ctrl</kbd> + <kbd>O');
    expect(html).toContain('Ctrl</kbd> + <kbd>X');
    expect(html).toContain('Ctrl</kbd> + <kbd>K');
    expect(html).toContain('Ctrl</kbd> + <kbd>U');
    expect(html).toContain('Ctrl</kbd> + <kbd>W');

    // Modos e comandos essenciais do Vim
    expect(html).toContain(':wq');
    expect(html).toContain(':q!');
    expect(html).toContain(':w');
    expect(html).toContain('dd');
    expect(html).toContain('yy');
    expect(html).toContain('<kbd>i</kbd>');
    expect(html).toContain('<kbd>Esc</kbd>');
  });

  it('escapa caracteres especiais adequadamente', () => {
    expect(ColaDeComandos.escapar('echo "teste" > arq & cat < in')).toBe('echo "teste" &gt; arq &amp; cat &lt; in');
  });
});
