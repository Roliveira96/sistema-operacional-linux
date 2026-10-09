// Text side of the karaoke reader (SPEC-018): what is spoken for a piece of the
// page, how long texts are split for the speech service, and where each spoken
// word sits in the page so it can be highlighted without touching the HTML.

/** Longest text the speech service accepts in one request (SPEC-017, RN-02). */
export const MAX_CHUNK_CHARS = 2000;

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT", "FIELDSET", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4",
  "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "SVG", "BUTTON", "SELECT", "TEXTAREA", "NOSCRIPT"]);
/** Elements carrying this attribute are shown but never spoken (for example the "T2" tag of a command). */
export const SKIP_ATTRIBUTE = "data-narration-skip";

/** Emoji and joiners are decoration for the eye and noise for the voice. */
const DECORATION = /\p{Extended_Pictographic}|[‍️⃣]/u;

export interface NarrationText {
  /** What the voice reads: tags removed, spaces collapsed, no emoji. */
  text: string;
  /** The page range of text[start, end), or null when it cannot be mapped. */
  locate(start: number, end: number): Range | null;
}

interface Ref {
  node: Text;
  /** UTF-16 offset of this character inside its text node. */
  offset: number;
}

function blockOf(node: Node, root: Element): Element {
  let current: Element | null = node.parentElement;
  while (current && current !== root) {
    if (BLOCK_TAGS.has(current.tagName)) return current;
    current = current.parentElement;
  }
  return root;
}

function skipped(node: Node, root: Element): boolean {
  let current: Element | null = node.parentElement;
  while (current) {
    if (SKIPPED_TAGS.has(current.tagName.toUpperCase()) || current.hasAttribute(SKIP_ATTRIBUTE)) return true;
    if (current === root) return false;
    current = current.parentElement;
  }
  return false;
}

/** Reads the text of an element for the voice, keeping the map back to the page. */
export function readNarration(root: Element): NarrationText {
  const units: string[] = [];
  const refs: Ref[] = [];

  const push = (unit: string, ref: Ref) => {
    units.push(unit);
    refs.push(ref);
  };
  const lastIsSpace = () => units.length === 0 || units[units.length - 1] === " ";

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let previousBlock: Element | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (skipped(node, root)) continue;
    const block = blockOf(node, root);
    if (previousBlock && block !== previousBlock && !lastIsSpace()) {
      push(" ", refs[refs.length - 1]!);
    }
    previousBlock = block;

    let offset = 0;
    for (const char of node.data) {
      const here = offset;
      offset += char.length;
      if (DECORATION.test(char)) continue;
      if (/\s/.test(char)) {
        if (!lastIsSpace()) push(" ", { node, offset: here });
        continue;
      }
      for (let i = 0; i < char.length; i++) push(char[i]!, { node, offset: here + i });
    }
  }
  while (units.length > 0 && units[units.length - 1] === " ") {
    units.pop();
    refs.pop();
  }

  return {
    text: units.join(""),
    locate(start, end) {
      const first = refs[Math.max(0, start)];
      const last = refs[Math.min(refs.length, end) - 1];
      if (!first || !last || end <= start) return null;
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
      return range;
    },
  };
}

export interface NarrationChunk {
  /** Index of the first character of the chunk in the narration text. */
  start: number;
  text: string;
}

const SENTENCE_END = /[.!?…]["')\]]*\s/g;

/** Splits a text into chunks of at most `max` characters, ending at a sentence when possible (CA-09). */
export function splitIntoChunks(text: string, max = MAX_CHUNK_CHARS): NarrationChunk[] {
  const chunks: NarrationChunk[] = [];
  let position = 0;
  while (position < text.length) {
    let end = Math.min(position + max, text.length);
    if (end < text.length) {
      const window = text.slice(position, end);
      let cut = -1;
      for (const match of window.matchAll(SENTENCE_END)) cut = match.index + match[0].length;
      if (cut <= 0) cut = window.lastIndexOf(" ") + 1;
      if (cut > 0) end = position + cut;
    }
    const raw = text.slice(position, end);
    const trimmed = raw.trimStart();
    if (trimmed.trim()) chunks.push({ start: position + (raw.length - trimmed.length), text: trimmed.trimEnd() });
    position = end;
  }
  return chunks;
}

export interface SpokenWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface AlignedWord {
  /** Offsets of the word inside the chunk text. */
  start: number;
  end: number;
  startMs: number;
  endMs: number;
}

/** How far the next word may be from the previous one before it is considered missing. */
const MAX_SKIP_CHARS = 60;

/** Finds each spoken word, in order, inside the text that was sent to the voice. */
export function alignWords(chunkText: string, words: SpokenWord[]): AlignedWord[] {
  const aligned: AlignedWord[] = [];
  let cursor = 0;
  for (const word of words) {
    if (!word.word) continue;
    const index = chunkText.indexOf(word.word, cursor);
    if (index < 0 || index - cursor > MAX_SKIP_CHARS) continue;
    aligned.push({ start: index, end: index + word.word.length, startMs: word.startMs, endMs: word.endMs });
    cursor = index + word.word.length;
  }
  return aligned;
}

/** The word being spoken at `ms`: the last one that already started. */
export function wordAt(words: AlignedWord[], ms: number): number {
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.startMs <= ms) found = i;
    else break;
  }
  return found;
}

/** Symbols of a shell command and how they are said in Portuguese. Longer ones first. */
const SAID: [string, string][] = [
  ["&&", " e depois "],
  ["||", " ou "],
  [">>", " anexa em "],
  ["2>", " redireciona os erros para "],
  [">", " redireciona para "],
  ["<", " lê de "],
  ["|", " pipe "],
  [";", " depois "],
  ["&", " em segundo plano "],
  ["--", " traço traço "],
  ["-", " traço "],
  ["/", " barra "],
  ["\\", " contra-barra "],
  ["~", " til "],
  ["*", " asterisco "],
  ["$", " cifrão "],
  [".", " ponto "],
  [":", " dois pontos "],
  ["=", " igual a "],
  ["#", " jogo da velha "],
  ["@", " arroba "],
  ["%", " por cento "],
  ["+", " mais "],
  ["!", " exclamação "],
  ['"', " "],
  ["'", " "],
  ["`", " "],
  ["(", " "],
  [")", " "],
];

/** Short option clusters such as -la or -rf are spelled out letter by letter (SPEC-018, RF-12). */
const OPTION_CLUSTER = /(^|\s)-([a-zA-Z]{2,3})(?=\s|$)/g;

/** The command as it is said aloud: symbols become words, short options are spelled. */
export function spokenCommand(command: string): string {
  let said = command.replace(OPTION_CLUSTER, (_match, space: string, letters: string) => `${space}-${letters.split("").join(" ")}`);
  let result = "";
  for (let i = 0; i < said.length; ) {
    const symbol = SAID.find(([from]) => said.startsWith(from, i));
    if (symbol) {
      result += symbol[1];
      i += symbol[0].length;
    } else {
      result += said[i];
      i++;
    }
  }
  said = result;
  return said.replace(/\s+/g, " ").trim();
}
