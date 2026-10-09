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
    expect(readNarration(root).text).toBe("who am I");
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

// Covers SPEC-018 RF-12 and RF-13: a command is said in Portuguese, not read symbol by symbol,
// and the names of the commands go through the lexicon so the voice does not mangle them.
describe("spokenCommand", () => {
  it.each([
    ["uname -o", "iú name traço o"],
    ["ls -l /etc", "L S traço l barra E T C"],
    ["ls -la", "L S traço l a"],
    ["rm -rf pasta", "R M traço r f pasta"],
    ["cat /etc/os-release", "cát barra E T C barra O S release"],
    ["echo oi > a.txt", "écô oi redireciona para a ponto T X T"],
    ["echo oi >> log.txt", "écô oi anexa em log ponto T X T"],
    ["cat a.txt | sort | head -3", "cát a ponto T X T pipe sort pipe héd traço 3"],
    ["apt update && apt upgrade", "A P T update e depois A P T upgrade"],
    ["cd ~ && ls ..", "C D til e depois L S ponto ponto"],
    ["ls --help", "L S traço traço help"],
    ["sleep 100 &", "sleep 100 em segundo plano"],
    ["grep 'a b' f.txt", "grép a b f ponto T X T"],
    ["cut -d: -f1 /etc/passwd", "cut traço d dois pontos traço f1 barra E T C barra password"],
    ["echo $HOME", "écô cifrão HOME"],
    ["ls *.txt", "L S asterisco ponto T X T"],
    ["sort < in 2> err", "sort lê de in redireciona os erros para err"],
    ["find . -name x", "fáind ponto traço name x"],
    ["sudo systemctl status nginx", "sudô system C T L status engine X"],
    ["useradd -m joao", "user add traço m joao"],
    ["ssh ricardo@localhost", "S S H ricardo arroba localhost"],
    ["dpkg -i pacote.deb", "D P K G traço i pacote ponto D E B"],
    ["ls -l /dev/sda", "L S traço l barra dév barra sda"],
    ["apt-get install tree", "A P T get install tri"],
    ["git status", "guit status"],
    ["   ", ""],
  ])("says %j as %j", (command, said) => {
    expect(spokenCommand(command)).toBe(said);
  });

  // Permissions are read digit by digit, but other numbers are not.
  it("reads the permission after chmod and umask digit by digit, and only there", () => {
    expect(spokenCommand("chmod 755 script.sh")).toBe("chê mod 7 5 5 script ponto S H");
    expect(spokenCommand("chmod -R 644 pasta")).toBe("chê mod traço R 6 4 4 pasta");
    expect(spokenCommand("umask 022")).toBe("u mask 0 2 2");
    expect(spokenCommand("755")).toBe("7 5 5");
    expect(spokenCommand("sleep 100")).toBe("sleep 100");
    expect(spokenCommand("head -3")).toBe("héd traço 3");
  });

  it("says known compound names as one name", () => {
    expect(spokenCommand("www-data")).toBe("W W W data");
    expect(spokenCommand("apt-cache search x")).toBe("A P T cache search x");
  });
});

// Covers RF-13: the code in the middle of a lesson text is said as a command, and highlighted as a whole.
describe("readNarration of inline code", () => {
  it("says the code of a sentence as a command, not as a word", () => {
    const root = html("<p>Use o <code>ls -l</code> em <code>/etc</code> e depois o <kbd>chmod 755</kbd>.</p>");
    expect(readNarration(root).text).toBe("Use o L S traço l em barra E T C e depois o chê mod 7 5 5.");
  });

  it("does not change the prose around the code", () => {
    const root = html("<p>O comando ls lista; o usuário root manda.</p>");
    expect(readNarration(root).text).toBe("O comando ls lista; o usuário root manda.");
  });

  it("maps every spoken word of a snippet to the whole snippet on the page", () => {
    const root = html("<p>Rode <code>rm -rf pasta</code> com cuidado.</p>");
    const narration = readNarration(root);
    const start = narration.text.indexOf("traço");
    expect(narration.locate(start, start + "traço".length)?.toString()).toBe("rm -rf pasta");
    expect(narration.locate(narration.text.indexOf("com"), narration.text.indexOf("com") + 3)?.toString()).toBe("com");
  });

  it("does not repeat a word the snippet only shows as a symbol", () => {
    const root = html("<p>combinam com o pipe <code>|</code>, e o sistema.</p>");
    expect(readNarration(root).text).toBe("combinam com o pipe, e o sistema.");
  });

  it("separates a snippet from the words next to it", () => {
    const root = html("<p>veja<code>pwd</code>agora</p>");
    expect(readNarration(root).text).toBe("veja P W D agora");
  });
});
