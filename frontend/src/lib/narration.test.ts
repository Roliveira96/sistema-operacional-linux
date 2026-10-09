import { afterEach, describe, expect, it } from "vitest";
import { alignWords, MAX_CHUNK_CHARS, readNarration, spokenCommand, splitIntoChunks, wordAt } from "./narration";

function html(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Covers SPEC-018 CA-11: the voice never reads markup, and decoration is dropped.
describe("readNarration", () => {
  it("reads the text without tags and with collapsed spaces", () => {
    const root = html("<p>Linux  é o <b>kernel</b>\n criado por <code>Linus</code>.</p>");
    expect(readNarration(root).text).toBe("Linux é o kernel criado por Linus.");
  });

  it("separates block elements and table cells with a space", () => {
    const root = html("<h3>Linha do tempo</h3><table><tr><td>1969</td><td>Unix nasce.</td></tr><tr><td>1991</td><td>Linux nasce.</td></tr></table>");
    expect(readNarration(root).text).toBe("Linha do tempo 1969 Unix nasce. 1991 Linux nasce.");
  });

  it("drops emoji and decoration but keeps accents and digits", () => {
    const root = html("<p>🐧 Linux em uma frase ✔️ 2026 ação</p>");
    expect(readNarration(root).text).toBe("Linux em uma frase 2026 ação");
  });

  it("skips buttons, scripts and elements marked to skip", () => {
    const root = html('<div><button>Rodar</button><span data-narration-skip="">T2</span><code>whoami</code><script>var a=1</script></div>');
    expect(readNarration(root).text).toBe("whoami");
  });

  it("returns an empty text for an element without words", () => {
    const empty = readNarration(html("<p>  🐧 </p>"));
    expect(empty.text).toBe("");
    expect(empty.locate(0, 1)).toBeNull();
  });

  // The highlight needs the exact page range of each spoken word.
  it("maps a range of the spoken text back to the page", () => {
    const root = html("<p>Linux é o <b>kernel</b> do sistema.</p>");
    const narration = readNarration(root);
    const start = narration.text.indexOf("kernel");
    const range = narration.locate(start, start + "kernel".length);
    expect(range?.toString()).toBe("kernel");

    const across = narration.locate(narration.text.indexOf("o kernel"), narration.text.indexOf("kernel") + 6);
    expect(across?.toString()).toBe("o kernel");
  });

  it("maps correctly after removed emoji and collapsed spaces", () => {
    const root = html("<p>🐧   Olá   mundo</p>");
    const narration = readNarration(root);
    expect(narration.text).toBe("Olá mundo");
    expect(narration.locate(4, 9)?.toString()).toBe("mundo");
  });

  it("clamps ranges outside the text and rejects empty ones", () => {
    const narration = readNarration(html("<p>abc</p>"));
    expect(narration.locate(-5, 99)?.toString()).toBe("abc");
    expect(narration.locate(2, 2)).toBeNull();
  });
});

// Covers CA-09: texts above the limit are split at the end of a sentence.
describe("splitIntoChunks", () => {
  it("keeps a short text in one chunk", () => {
    expect(splitIntoChunks("Uma frase.")).toEqual([{ start: 0, text: "Uma frase." }]);
  });

  it("splits at sentence ends and never passes the limit", () => {
    const sentence = "Esta é uma frase de tamanho razoável para o teste. ";
    const text = sentence.repeat(120).trim();
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(chunk.text.endsWith(".")).toBe(true);
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
    }
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("splits a long sentence without punctuation at a space", () => {
    const text = "palavra ".repeat(600).trim();
    const chunks = splitIntoChunks(text, 100);
    expect(chunks.every((c) => c.text.length <= 100)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("cuts a word longer than the limit in the middle as a last resort", () => {
    const chunks = splitIntoChunks("a".repeat(250), 100);
    expect(chunks.map((c) => c.text.length)).toEqual([100, 100, 50]);
  });

  it("returns nothing for blank text", () => {
    expect(splitIntoChunks("")).toEqual([]);
    expect(splitIntoChunks("   ")).toEqual([]);
  });
});

describe("alignWords", () => {
  const words = [
    { word: "Linux", startMs: 100, endMs: 400 },
    { word: "é", startMs: 410, endMs: 500 },
    { word: "o", startMs: 510, endMs: 600 },
    { word: "kernel.", startMs: 610, endMs: 1000 },
  ];

  it("finds each word in order inside the spoken text", () => {
    expect(alignWords("Linux é o kernel.", words)).toEqual([
      { start: 0, end: 5, startMs: 100, endMs: 400 },
      { start: 6, end: 7, startMs: 410, endMs: 500 },
      { start: 8, end: 9, startMs: 510, endMs: 600 },
      { start: 10, end: 17, startMs: 610, endMs: 1000 },
    ]);
  });

  it("skips words the voice added or normalized and keeps going", () => {
    const aligned = alignWords("Linux é o kernel.", [words[0]!, { word: "inexistente", startMs: 1, endMs: 2 }, { word: "", startMs: 3, endMs: 4 }, words[3]!]);
    expect(aligned.map((w) => w.start)).toEqual([0, 10]);
  });

  it("does not jump far ahead to a repeated word", () => {
    const far = "um " + "x ".repeat(100) + "dois";
    expect(alignWords(far, [{ word: "dois", startMs: 0, endMs: 1 }])).toEqual([]);
  });
});

describe("wordAt", () => {
  const aligned = [
    { start: 0, end: 1, startMs: 100, endMs: 200 },
    { start: 2, end: 3, startMs: 300, endMs: 400 },
  ];

  it("returns the last word that already started", () => {
    expect(wordAt(aligned, 0)).toBe(-1);
    expect(wordAt(aligned, 100)).toBe(0);
    expect(wordAt(aligned, 250)).toBe(0);
    expect(wordAt(aligned, 300)).toBe(1);
    expect(wordAt(aligned, 9999)).toBe(1);
    expect(wordAt([], 5)).toBe(-1);
  });
});

// Covers SPEC-018 RF-12: a command is said in Portuguese, not read symbol by symbol.
describe("spokenCommand", () => {
  it.each([
    ["uname -o", "uname traço o"],
    ["ls -l /etc", "ls traço l barra etc"],
    ["ls -la", "ls traço l a"],
    ["rm -rf pasta", "rm traço r f pasta"],
    ["cat /etc/os-release", "cat barra etc barra os traço release"],
    ["echo oi > a.txt", "echo oi redireciona para a ponto txt"],
    ["echo oi >> log.txt", "echo oi anexa em log ponto txt"],
    ["cat a.txt | sort | head -3", "cat a ponto txt pipe sort pipe head traço 3"],
    ["apt update && apt upgrade", "apt update e depois apt upgrade"],
    ["cd ~ && ls ..", "cd til e depois ls ponto ponto"],
    ["ls --help", "ls traço traço help"],
    ["sleep 100 &", "sleep 100 em segundo plano"],
    ["grep 'a b' f.txt", "grep a b f ponto txt"],
    ["cut -d: -f1 /etc/passwd", "cut traço d dois pontos traço f1 barra etc barra passwd"],
    ["echo $HOME", "echo cifrão HOME"],
    ["ls *.txt", "ls asterisco ponto txt"],
    ["sort < in 2> err", "sort lê de in redireciona os erros para err"],
    ["find . -name x", "find ponto traço name x"],
    ["   ", ""],
  ])("says %j as %j", (command, said) => {
    expect(spokenCommand(command)).toBe(said);
  });
});
