// Converts the "conceitos" HTML of a legacy topic into the card model of the platform
// (SPEC-005 RN-02, SPEC-019). Each <h3> opens a card; what follows becomes blocks:
//   - plain paragraphs, lists and code  -> one text block (what the visual editor can edit);
//   - "💡" notes (p.conceitos-dica)      -> a tip block;
//   - the "curiosidades" cards            -> real-world blocks;
//   - tables                               -> a text block with the table;
//   - what has no equivalent (colored lines of /etc/passwd) -> a text block with its markup kept.
// No visible text is lost: the layout wrappers of the prototype are unwrapped, not dropped.

import type { BlockJson } from './build';

// ───────────── a tiny tolerant HTML tree ─────────────

type El = { tag: string; cls: string[]; href?: string; children: Node[] };
type Node = El | { text: string };

const VOID = new Set(['br', 'hr']);
const isEl = (n: Node): n is El => 'tag' in n;

function parse(html: string): Node[] {
  const root: El = { tag: '#root', cls: [], children: [] };
  const stack: El[] = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const top = stack[stack.length - 1]!;
    if (m[4] !== undefined) {
      top.children.push({ text: m[4] });
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const cls = /class="([^"]*)"/.exec(m[3]!)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    const href = /href="([^"]*)"/.exec(m[3]!)?.[1];
    const el: El = { tag, cls, ...(href ? { href } : {}), children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !m[3]!.trim().endsWith('/')) stack.push(el);
  }
  return root.children;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const squeeze = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The visible text of nodes, with <br> as a line break. */
function textOf(nodes: Node[]): string {
  return nodes
    .map((n) => (isEl(n) ? (n.tag === 'br' ? '\n' : textOf(n.children)) : decode(n.text)))
    .join('');
}

// ───────────── inline and block serialization ─────────────

const INLINE_KEEP = new Set(['b', 'strong', 'i', 'em', 'code', 'kbd']);
const INLINE_UNWRAP = new Set(['span', 'small', 'u', 'sup', 'sub']);
const isInline = (n: Node) => !isEl(n) || INLINE_KEEP.has(n.tag) || INLINE_UNWRAP.has(n.tag) || n.tag === 'a' || n.tag === 'br';

/** Inline html: keeps bold, italic, code, links and breaks; drops the wrappers and the classes. */
function inline(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (!isEl(n)) return n.text;
      if (n.tag === 'br') return '<br>';
      if (n.tag === 'a') return n.href ? `<a href="${n.href}">${inline(n.children)}</a>` : inline(n.children);
      if (INLINE_KEEP.has(n.tag)) return `<${n.tag}>${inline(n.children)}</${n.tag}>`;
      return inline(n.children);
    })
    .join('');
}

const blank = (html: string) => squeeze(textOf(parse(html))) === '';
const hasClass = (n: El, re: RegExp) => n.cls.some((c) => re.test(c));

type Item =
  | { k: 'h3'; text: string }
  | { k: 'simple'; html: string }
  | { k: 'raw'; html: string }
  | { k: 'table'; html: string }
  | { k: 'tip'; html: string }
  | { k: 'curiosity'; title: string; html: string };

function normalizeTable(t: El): string {
  const rows = (nodes: Node[]): El[] =>
    nodes.flatMap((n) => (isEl(n) ? (n.tag === 'tr' ? [n] : n.tag === 'thead' || n.tag === 'tbody' ? rows(n.children) : []) : []));
  const all = rows(t.children);
  const cell = (c: El) => `<${c.tag}>${inline(c.children)}</${c.tag}>`;
  const row = (r: El) => `<tr>${r.children.filter(isEl).filter((c) => c.tag === 'td' || c.tag === 'th').map(cell).join('')}</tr>`;
  const isHead = (r: El) => r.children.filter(isEl).every((c) => c.tag === 'th');
  const head = all.length > 0 && isHead(all[0]!) ? all[0]! : undefined;
  const body = head ? all.slice(1) : all;
  return `<table class="md-table">${head ? `<thead>${row(head)}</thead>` : ''}<tbody>${body.map(row).join('')}</tbody></table>`;
}

const TITLE_CLASS = /(titulo|header|tag|badge)$/;

function flatten(nodes: Node[], out: Item[]): void {
  let run: Node[] = [];
  const flush = () => {
    const html = inline(run).trim();
    run = [];
    if (html && !blank(html)) out.push({ k: 'simple', html: `<p>${html}</p>` });
  };

  for (const n of nodes) {
    if (isInline(n)) {
      run.push(n);
      continue;
    }
    const el = n as El;
    flush();

    switch (el.tag) {
      case 'h3':
        out.push({ k: 'h3', text: squeeze(textOf(el.children)) });
        continue;
      case 'h4':
        out.push({ k: 'simple', html: `<h4>${squeeze(inline(el.children))}</h4>` });
        continue;
      case 'p': {
        const html = inline(el.children).trim();
        if (!html) continue;
        out.push(hasClass(el, /^conceitos-dica$/) ? { k: 'tip', html: `<p>${html}</p>` } : { k: 'simple', html: `<p>${html}</p>` });
        continue;
      }
      case 'ul':
      case 'ol': {
        const items = el.children.filter(isEl).filter((c) => c.tag === 'li').map((li) => `<li>${inline(li.children).trim()}</li>`);
        if (items.length) out.push({ k: 'simple', html: `<${el.tag}>${items.join('')}</${el.tag}>` });
        continue;
      }
      case 'table':
        out.push({ k: 'table', html: normalizeTable(el) });
        continue;
      case 'pre': {
        const hasSpans = el.children.some((c) => isEl(c) && c.tag === 'span');
        if (hasSpans) out.push({ k: 'raw', html: `<pre class="${el.cls.join(' ')}">${inline2(el.children)}</pre>` });
        else out.push({ k: 'simple', html: `<pre><code>${escape(textOf(el.children))}</code></pre>` });
        continue;
      }
      case 'div':
        div(el, out);
        continue;
      default:
        flatten(el.children, out);
    }
  }
  flush();
}

/** Keeps the span classes of a line (the colored fields of /etc/passwd) as they are. */
function inline2(nodes: Node[]): string {
  return nodes
    .map((n) => (!isEl(n) ? n.text : n.tag === 'span' ? `<span${n.cls.length ? ` class="${n.cls.join(' ')}"` : ''}>${inline2(n.children)}</span>` : inline2(n.children)))
    .join('');
}

function div(el: El, out: Item[]): void {
  // A recommended video: the link, then what it covers.
  if (hasClass(el, /^video-recomendado$/)) {
    const link = find(el, (e) => e.tag === 'a' && !!e.href);
    const badge = find(el, (e) => hasClass(e, /^video-badge$/));
    const title = find(el, (e) => e.tag === 'span' && e.cls.length === 0);
    if (badge || title) {
      out.push({ k: 'simple', html: `<p><b>${escape(squeeze(textOf(badge?.children ?? [])))}</b> ${escape(squeeze(textOf(title?.children ?? [])))}</p>` });
    }
    if (link?.href) {
      out.push({ k: 'raw', html: `<p class="md-link"><a href="${link.href}">${escape(squeeze(textOf(link.children)))}</a></p>` });
    }
    for (const c of el.children) {
      if (!isEl(c)) continue;
      if (hasClass(c, /^video-recomendado-desc$/)) out.push({ k: 'simple', html: `<p>${squeeze(inline(c.children))}</p>` });
      if (hasClass(c, /^video-roteiro-grade$/)) {
        const items = c.children.filter(isEl).map((i) => {
          const time = find(i, (e) => hasClass(e, /^video-tempo-tag$/));
          const body = i.children.filter(isEl).find((e) => e !== time);
          return `<li><b>${escape(squeeze(textOf(time?.children ?? [])))}</b> ${inline(body?.children ?? [])}</li>`;
        });
        out.push({ k: 'simple', html: `<ul>${items.join('')}</ul>` });
      }
    }
    return;
  }

  // One of the "curiosidades": the title is the bold line of its top.
  if (hasClass(el, /^perm-curiosidade-card$/)) {
    const top = el.children.filter(isEl).find((c) => hasClass(c, /topo$/));
    const body = el.children.filter(isEl).find((c) => c.tag === 'p');
    const title = squeeze(textOf(find(top ?? el, (e) => e.tag === 'b')?.children ?? []));
    const icon = squeeze(textOf(find(top ?? el, (e) => hasClass(e, /ico$/))?.children ?? []));
    out.push({ k: 'curiosity', title: squeeze(`${icon} ${title}`), html: `<p>${inline(body?.children ?? []).trim()}</p>` });
    return;
  }

  // A code line in a box: the command.
  if (hasClass(el, /code-bloco$/)) {
    out.push({ k: 'simple', html: `<pre><code>${escape(squeeze(textOf(el.children)))}</code></pre>` });
    return;
  }

  // The tree of folders: its text, line by line, in a code block.
  if (hasClass(el, /arvore-bloco$/)) {
    const lines = textOf(el.children).split('\n').map((l) => l.replace(/\s+$/, ''));
    out.push({ k: 'simple', html: `<pre><code>${escape(lines.join('\n'))}</code></pre>` });
    return;
  }

  // A title line of a box (analogy, step, group of curiosities...): bold.
  if (el.children.every(isInline) && hasClass(el, TITLE_CLASS)) {
    const t = squeeze(inline(el.children));
    if (t) out.push({ k: 'simple', html: `<p><b>${t}</b></p>` });
    return;
  }

  // A box with only inline content (a note, a highlight): a paragraph.
  if (el.children.every(isInline)) {
    const html = inline(el.children).trim();
    if (html && !blank(html)) out.push({ k: 'simple', html: `<p>${html}</p>` });
    return;
  }

  flatten(el.children, out);
}

function find(el: El, test: (e: El) => boolean): El | undefined {
  for (const c of el.children) {
    if (!isEl(c)) continue;
    if (test(c)) return c;
    const deep = find(c, test);
    if (deep) return deep;
  }
  return undefined;
}

// ───────────── items -> blocks ─────────────

/** The blocks of a topic's concepts. The first keeps the old key (`<topic>/concepts`), so the block stays the same row. */
export function convertConcepts(topicId: string, html: string): BlockJson[] {
  const items: Item[] = [];
  flatten(parse(html), items);

  const blocks: BlockJson[] = [];
  let run = '';
  let header: BlockJson | undefined;
  const key = () => (blocks.length === 0 ? `${topicId}/concepts` : `${topicId}/concepts/${blocks.length + 1}`);
  const push = (type: BlockJson['type'], payload: Record<string, unknown>) => {
    const b: BlockJson = { sourceKey: key(), type, payload };
    blocks.push(b);
    return b;
  };
  const flush = () => {
    if (!run) return;
    // The first text after a title lives in the title block, as the card screen saves it.
    if (header && header.payload.html === '') header.payload.html = run;
    else push('TEXT', { html: run });
    header = undefined;
    run = '';
  };

  for (const item of items) {
    switch (item.k) {
      case 'h3':
        flush();
        header = push('TEXT', { title: item.text, html: '' });
        break;
      case 'simple':
        run += item.html;
        break;
      case 'tip':
        flush();
        header = undefined;
        push('TIP', { variant: 'DEFAULT', html: item.html });
        break;
      case 'curiosity':
        flush();
        header = undefined;
        push('CURIOSITY', { title: item.title, html: item.html });
        break;
      default:
        flush();
        header = undefined;
        push('TEXT', { html: item.html });
    }
  }
  flush();
  return blocks;
}

/** The visible text of a block, to check that nothing was lost. */
export function visibleText(blocks: BlockJson[]): string {
  return squeeze(
    blocks
      .map((b) => [b.payload.title, b.payload.html].filter((v): v is string => typeof v === 'string').map((h) => textOf(parse(h))).join(' '))
      .join(' '),
  );
}

export { squeeze, textOf, parse };
