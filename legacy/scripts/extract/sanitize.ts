// Allowlist HTML filter for legacy content (SPEC-005 RN-08). Only known
// visual tags and attributes survive; scripts, event handlers, inline styles
// and javascript: URLs are removed. The backend filters again on import.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'small', 'code', 'pre', 'kbd', 'samp', 'span', 'div',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h3', 'h4', 'h5', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'details', 'summary', 'figure', 'figcaption', 'iframe',
]);
// Tags removed together with everything inside them.
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'object', 'embed']);
const VOID_TAGS = new Set(['br', 'hr']);
const GLOBAL_ATTRIBUTES = new Set(['class', 'title']);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
  iframe: new Set(['src', 'allowfullscreen']),
};
const SAFE_URL = /^(https?:\/\/|#|\/(?!\/))/i;
const VIDEO_EMBED = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//i;
const CLASS_TOKEN = /^[A-Za-z0-9_-]+$/;

function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function filterAttributes(tag: string, raw: string): string {
  const out: string[] = [];
  const re = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1]!.toLowerCase();
    const value = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
    if (!GLOBAL_ATTRIBUTES.has(name) && !TAG_ATTRIBUTES[tag]?.has(name)) continue;
    if (name === 'class') {
      const tokens = value.split(/\s+/).filter((t) => CLASS_TOKEN.test(t));
      if (tokens.length) out.push(`class="${tokens.join(' ')}"`);
      continue;
    }
    if (name === 'href') {
      const url = value.replace(/[\s\u0000-\u001f]/g, '');
      if (SAFE_URL.test(url)) out.push(`href="${escapeAttr(value.trim())}"`);
      continue;
    }
    if (name === 'src') {
      if (VIDEO_EMBED.test(value.trim())) out.push(`src="${escapeAttr(value.trim())}"`);
      continue;
    }
    if (name === 'allowfullscreen') {
      out.push('allowfullscreen');
      continue;
    }
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

/** Returns the HTML keeping only allowlisted tags and attributes. */
export function sanitizeHtml(html: string): string {
  let out = '';
  let i = 0;
  const open: string[] = [];
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out += escapeText(html.slice(i));
      break;
    }
    out += escapeText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const m = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9-]*)([^>]*)>/.exec(html.slice(lt));
    if (!m) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    i = lt + m[0].length;
    if (DROPPED_WITH_CONTENT.has(tag)) {
      if (!closing) {
        const close = new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'i').exec(html.slice(i));
        i = close ? i + close.index + close[0].length : html.length;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx >= 0) {
        while (open.length > idx) out += `</${open.pop()}>`;
      }
      continue;
    }
    if (tag === 'iframe' && !/\bsrc\s*=\s*["']?https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//i.test(m[3]!)) {
      const close = /<\s*\/\s*iframe\s*>/i.exec(html.slice(i));
      i = close ? i + close.index + close[0].length : i;
      continue;
    }
    out += `<${tag}${filterAttributes(tag, m[3]!.replace(/\/\s*$/, ''))}>`;
    if (!VOID_TAGS.has(tag)) open.push(tag);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Plain text of an HTML fragment, used for titles. */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
