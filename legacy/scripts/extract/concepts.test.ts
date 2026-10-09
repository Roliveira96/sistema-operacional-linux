import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertConcepts, parse, textOf, visibleText } from './concepts';

const fixtures: Record<string, string> = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/concepts.json'), 'utf8'));
const noSpace = (s: string) => s.replace(/\s+/g, '');
const original = (html: string) => noSpace(textOf(parse(html)));

describe('convertConcepts (SPEC-005 RN-02)', () => {
  it('opens a card at each h3 and puts the first text inside the title block', () => {
    const blocks = convertConcepts('t', '<h3>🐧 Título</h3><p>Texto <code>ls</code></p><h3>Outro</h3><p>Mais</p>');
    expect(blocks).toEqual([
      { sourceKey: 't/concepts', type: 'TEXT', payload: { title: '🐧 Título', html: '<p>Texto <code>ls</code></p>' } },
      { sourceKey: 't/concepts/2', type: 'TEXT', payload: { title: 'Outro', html: '<p>Mais</p>' } },
    ]);
  });

  it('turns the 💡 note into a tip, and keeps the text before it in the card', () => {
    const blocks = convertConcepts('t', '<h3>A</h3><p>um</p><p class="conceitos-dica">💡 <b>Dica</b> dois</p><p>três</p>');
    expect(blocks.map((b) => b.type)).toEqual(['TEXT', 'TIP', 'TEXT']);
    expect(blocks[1]!.payload).toEqual({ variant: 'DEFAULT', html: '<p>💡 <b>Dica</b> dois</p>' });
    expect(blocks[2]!.payload).toEqual({ html: '<p>três</p>' });
  });

  it('makes a table block, with a header when the first row has th', () => {
    const [, plain, headed] = convertConcepts(
      't',
      '<h3>A</h3><table class="tabela"><tr><td><code>/</code></td><td>raiz</td></tr></table><table class="tabela"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(plain!.payload.html).toBe('<table class="md-table"><tbody><tr><td><code>/</code></td><td>raiz</td></tr></tbody></table>');
    expect(headed!.payload.html).toBe('<table class="md-table"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
  });

  it('writes code as a code block and keeps the colored fields of a line', () => {
    const blocks = convertConcepts(
      't',
      '<p>antes</p><pre class="anatomia-linha"><span class="an-dono">maria</span>:<span class="an-tipo">x</span></pre><div class="fhs-arvore-bloco"><b>/</b><br>├── <span class="dir">etc/</span>  <span class="coment">config</span><br>└── <span class="dir">usr/</span></div>',
    );
    expect(blocks.map((b) => b.type)).toEqual(['TEXT', 'TEXT', 'TEXT']);
    expect(blocks[1]!.payload.html).toBe('<pre class="anatomia-linha"><span class="an-dono">maria</span>:<span class="an-tipo">x</span></pre>');
    expect(blocks[2]!.payload.html).toBe('<pre><code>/\n├── etc/  config\n└── usr/</code></pre>');
  });

  it('turns a curiosity card into a real-world block', () => {
    const [b] = convertConcepts(
      't',
      '<div class="perm-curiosidade-card"><div class="perm-curiosidade-topo"><span class="perm-curiosidade-ico">🎡</span><b>Por que wheel?</b></div><p>Gíria <code>wheel</code>.</p></div>',
    );
    expect(b).toEqual({ sourceKey: 't/concepts', type: 'CURIOSITY', payload: { title: '🎡 Por que wheel?', html: '<p>Gíria <code>wheel</code>.</p>' } });
  });

  it('turns the recommended video into a link and a list of what it covers', () => {
    const blocks = convertConcepts(
      't',
      '<div class="video-recomendado"><div class="video-recomendado-topo"><div class="video-recomendado-titulo"><span class="video-badge">📺 Vídeo</span><span>Guia</span></div><a class="video-recomendado-link" href="https://www.youtube.com/watch?v=x"> ▶ Assistir </a></div><p class="video-recomendado-desc"> O vídeo.</p><div class="video-roteiro-grade"><div class="video-roteiro-item"><span class="video-tempo-tag">01:45</span><span><b>1. Um:</b> texto</span></div></div></div>',
    );
    expect(blocks[0]!.payload.html).toBe('<p><b>📺 Vídeo</b> Guia</p>');
    expect(blocks[1]!.payload.html).toBe('<p class="md-link"><a href="https://www.youtube.com/watch?v=x">▶ Assistir</a></p>');
    expect(blocks[2]!.payload.html).toBe('<p>O vídeo.</p><ul><li><b>01:45</b> <b>1. Um:</b> texto</li></ul>');
  });

  it('gives no blocks for empty html and an untitled card for content before the first h3', () => {
    expect(convertConcepts('t', '')).toEqual([]);
    const [first] = convertConcepts('t', '<p>sem título</p><h3>Depois</h3>');
    expect(first!.payload).toEqual({ html: '<p>sem título</p>' });
  });
});

describe('the eight legacy topics', () => {
  for (const [topic, html] of Object.entries(fixtures)) {
    describe(topic, () => {
      const blocks = convertConcepts(topic, html);

      it('keeps every word of the original', () => {
        expect(noSpace(visibleText(blocks))).toBe(original(html));
      });

      it('keeps the old block as the first one, with unique keys', () => {
        expect(blocks[0]!.sourceKey).toBe(`${topic}/concepts`);
        expect(new Set(blocks.map((b) => b.sourceKey)).size).toBe(blocks.length);
      });

      it('only has blocks the card model understands', () => {
        for (const b of blocks) {
          expect(['TEXT', 'TIP', 'CURIOSITY']).toContain(b.type);
          const html = String(b.payload.html ?? '');
          if (b.type !== 'TEXT' || !b.payload.title) expect(noSpace(html.replace(/<[^>]*>/g, '')) !== '' || html.includes('<table')).toBe(true);
          // The layout classes of the prototype are gone; only the ones the card screen knows remain.
          for (const cls of html.matchAll(/class="([^"]*)"/g)) {
            for (const token of cls[1]!.split(' ')) expect(['md-table', 'md-link', 'anatomia-linha', 'an-dono', 'an-tipo', 'an-grupo', 'an-outros', 'an-links', 'an-nome']).toContain(token);
          }
          expect(html).not.toContain('<script');
          expect(html).not.toContain('<div');
        }
      });
    });
  }

  it('makes real cards out of the topics that had many h3', () => {
    const permissoes = convertConcepts('permissoes', fixtures.permissoes!);
    expect(permissoes.filter((b) => b.payload.title && b.type === 'TEXT').length).toBeGreaterThanOrEqual(4);
    expect(permissoes.filter((b) => b.type === 'CURIOSITY')).toHaveLength(6);
    const pacotes = convertConcepts('pacotes', fixtures.pacotes!);
    expect(pacotes.filter((b) => b.type === 'TEXT' && b.payload.title).map((b) => b.payload.title)).toEqual([
      '📦 Pacote, repositório e dependência',
      '🔁 O ritual de sempre',
      '⚙️ Serviços',
    ]);
    expect(pacotes.filter((b) => b.type === 'TIP')).toHaveLength(1);
  });
});
