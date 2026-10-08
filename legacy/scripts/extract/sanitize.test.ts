import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeHtml } from './sanitize';

// Covers SPEC-005 CA-06.
describe('sanitizeHtml', () => {
  it('keeps allowed markup and classes', () => {
    expect(sanitizeHtml('<p class="dica ok">Use <code>ls -l</code><br></p>')).toBe('<p class="dica ok">Use <code>ls -l</code><br></p>');
  });

  it('removes scripts, events, styles and javascript URLs', () => {
    const out = sanitizeHtml(
      '<div onclick="steal()" style="color:red">x<script>alert(1)</script><a href="javascript:alert(1)">a</a>' +
        '<a href=" JaVaScRiPt:alert(1)">b</a><img src=x onerror=alert(1)><a href="https://utfpr.edu.br" target="_blank">c</a></div>',
    );
    expect(out).not.toMatch(/<script|onclick|onerror|javascript:|style=|<img|target=/i);
    expect(out).toContain('<a href="https://utfpr.edu.br">c</a>');
  });

  it('keeps only YouTube embeds', () => {
    expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/abc" allowfullscreen onload="x()"></iframe>')).toBe(
      '<iframe src="https://www.youtube.com/embed/abc" allowfullscreen></iframe>',
    );
    expect(sanitizeHtml('<iframe src="https://evil.example/x"></iframe>after')).toBe('after');
  });

  it('closes open tags, drops comments and escapes stray brackets', () => {
    expect(sanitizeHtml('<b>bold<!-- note --> 1 < 2')).toBe('<b>bold 1 &lt; 2</b>');
    expect(sanitizeHtml('<ul><li>a</ul>')).toBe('<ul><li>a</li></ul>');
  });

  it('extracts plain text', () => {
    expect(htmlToText('<b>Crie</b> o arquivo &quot;a&quot;  agora')).toBe('Crie o arquivo "a" agora');
  });
});
