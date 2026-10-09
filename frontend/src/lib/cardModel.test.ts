import { describe, expect, it } from "vitest";
import type { AuthoredBlock } from "@/services/contentAuthoringService";
import { buildBlocks, cardCounts, checkCard, classify, elementHtml, emptyCard, groupCards, looksSafe, newElement, parseCard, placeServerErrors } from "./cardModel";

const block = (id: string, type: string, position: number, payload: Record<string, unknown>): AuthoredBlock => ({
  id,
  type,
  position,
  payload,
  edited: false,
  active: true,
  updatedAt: `2026-10-09T12:00:0${position}Z`,
});

const stored = [
  block("intro", "LEGACY_HTML", 1, { html: "<p>Boas-vindas</p>" }),
  block("h1", "TEXT", 2, { title: "Atualizar", command: "apt update", html: "<p>Texto <code>apt</code></p>" }),
  block("code1", "TEXT", 3, { html: '<pre class="md-code"><code class="language-bash">sudo apt update</code></pre>' }),
  block("c1", "COMMAND", 4, { steps: [{ command: "apt update", explanation: "sincroniza", outputExplanation: "baixou", terminal: 1 }, { command: "su", terminal: 2, login: { user: "ana", password: "1" }, answers: ["s"] }] }),
  block("w1", "WIDGET", 5, { component: "LS_ANATOMY", params: {} }),
  block("t1", "TIP", 6, { variant: "DEFAULT", title: "LPIC-1 102.4", html: "<p>dica</p>" }),
  block("r1", "CURIOSITY", 7, { title: "Na vida real", html: "<p>real</p>" }),
  block("e1", "TIP", 8, { variant: "WARNING", title: "Cai na prova", html: "<p>prova</p>" }),
  block("h2", "TEXT", 9, { title: "Segundo", html: "<p>outro</p>" }),
  block("c2", "COMMAND", 10, { steps: [{ command: "ls" }] }),
];

describe("groupCards", () => {
  it("opens a card at each text with a title, with the introduction before the first", () => {
    const groups = groupCards([...stored].reverse());
    expect(groups.map((g) => g.key)).toEqual(["intro", "h1", "h2"]);
    expect(groups[0]!.header).toBeUndefined();
    expect(groups[1]!.blocks.map((b) => b.id)).toEqual(["h1", "code1", "c1", "w1", "t1", "r1", "e1"]);
    expect(groups[2]!.blocks.map((b) => b.id)).toEqual(["h2", "c2"]);
  });

  it("is empty for a module with no blocks", () => {
    expect(groupCards([])).toEqual([]);
  });
});

describe("parseCard", () => {
  const card = parseCard(groupCards(stored)[1]!);

  it("reads the header, the elements, the commands and the boxes", () => {
    expect(card.pill).toBe("apt update");
    expect(card.title).toBe("Atualizar");
    expect(card.elements.map((e) => e.kind)).toEqual(["text", "code", "block"]);
    expect(card.elements[0]!.html).toContain("<code>apt</code>");
    expect(card.elements[1]).toMatchObject({ kind: "code", lang: "bash", code: "sudo apt update", blockId: "code1" });
    expect(card.elements[2]!.block?.type).toBe("WIDGET");
    expect(card.commands.map((c) => c.command)).toEqual(["apt update", "su"]);
    expect(card.commands[1]).toMatchObject({ terminal: 2, login: { user: "ana", password: "1" }, answers: ["s"] });
    expect(card.tips[0]).toMatchObject({ title: "LPIC-1 102.4", blockId: "t1" });
    expect(card.realWorld[0]!.blockId).toBe("r1");
    expect(card.exams[0]!.blockId).toBe("e1");
  });

  it("builds the same blocks back, keeping the identity of each one", () => {
    const { blocks } = buildBlocks(card);
    expect(blocks.map((b) => [b.id, b.type])).toEqual([
      ["h1", "TEXT"],
      ["code1", "TEXT"],
      ["w1", "WIDGET"],
      ["c1", "COMMAND"],
      ["t1", "TIP"],
      ["r1", "CURIOSITY"],
      ["e1", "TIP"],
    ]);
    // The first text lives in the heading block, as it was stored.
    expect(blocks[0]!.payload).toEqual({ title: "Atualizar", command: "apt update", html: "<p>Texto <code>apt</code></p>" });
    expect(blocks[3]!.payload).toEqual({
      steps: [
        { command: "apt update", terminal: 1, explanation: "sincroniza", outputExplanation: "baixou" },
        { command: "su", terminal: 2, login: { user: "ana", password: "1" }, answers: ["s"] },
      ],
    });
    expect(blocks[4]!.payload).toEqual({ variant: "DEFAULT", title: "LPIC-1 102.4", html: "<p>dica</p>" });
    expect(blocks[6]!.payload).toMatchObject({ variant: "WARNING" });
  });

  it("merges the command blocks of a card into one", () => {
    const two = parseCard(groupCards([stored[1]!, block("ca", "COMMAND", 2, { steps: [{ command: "a" }] }), block("cb", "COMMAND", 3, { steps: [{ command: "b" }] })])[0]!);
    const built = buildBlocks(two).blocks.filter((b) => b.type === "COMMAND");
    expect(built).toHaveLength(1);
    expect(built[0]!.id).toBe("ca");
    expect((built[0]!.payload.steps as unknown[]).length).toBe(2);
  });

  it("keeps the introduction without a header", () => {
    const intro = parseCard(groupCards(stored)[0]!);
    expect(intro.title).toBe("");
    const { blocks } = buildBlocks(intro);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ id: "intro", type: "LEGACY_HTML" });
  });
});

describe("buildBlocks", () => {
  it("makes a new card with a header, the first text inside it and new blocks without id", () => {
    const card = emptyCard();
    card.title = " Novo ";
    card.pill = "ls";
    card.elements = [{ ...newElement("text"), html: "<p>a</p>" }, { ...newElement("code"), code: "ls -la" }];
    card.commands = [{ id: "c", terminal: 1, expectError: false, command: "ls", explanation: "", outputExplanation: "", answers: [] }];
    card.realWorld = [{ id: "r", title: "Na vida real", html: "<p>x</p>" }];

    const { blocks, sources } = buildBlocks(card);
    expect(blocks.map((b) => b.type)).toEqual(["TEXT", "TEXT", "COMMAND", "CURIOSITY"]);
    expect(blocks.every((b) => b.id === undefined)).toBe(true);
    expect(blocks[0]!.payload).toEqual({ title: "Novo", command: "ls", html: "<p>a</p>" });
    expect(blocks[1]!.payload.html).toContain("ls -la");
    expect(sources[0]).toEqual(["header", card.elements[0]!.id]);
  });

  it("leaves the header without text when the first element is not a text", () => {
    const card = emptyCard();
    card.title = "T";
    card.elements = [{ ...newElement("code"), code: "x" }];
    expect(buildBlocks(card).blocks[0]!.payload).toMatchObject({ title: "T", html: "" });
  });

  it("builds a card with nothing in it as no blocks, so saving it removes the card", () => {
    expect(buildBlocks(emptyCard()).blocks).toEqual([]);
  });
});

describe("elements as html", () => {
  it("writes and reads back every kind", () => {
    const code = { ...newElement("code"), lang: "sh", code: "echo '<b>' && ls" };
    expect(classify(elementHtml(code))).toMatchObject({ kind: "code", lang: "sh", code: "echo '<b>' && ls" });

    const table = { ...newElement("table"), headers: "Caminho | Para quê", rows: ["/etc | config", "/var | dados"].join(String.fromCharCode(10)) };
    expect(classify(elementHtml(table))).toMatchObject({ kind: "table", headers: "Caminho | Para quê", rows: table.rows });

    const image = { ...newElement("image"), url: "https://x.com/a.png", caption: "Fluxo" };
    expect(classify(elementHtml(image))).toMatchObject({ kind: "image", url: "https://x.com/a.png", caption: "Fluxo" });

    const video = { ...newElement("video"), url: "https://www.youtube.com/embed/abc" };
    expect(classify(elementHtml(video))).toMatchObject({ kind: "video", url: "https://www.youtube.com/embed/abc" });

    const link = { ...newElement("link"), url: "https://debian.org", caption: "Debian" };
    expect(classify(elementHtml(link))).toMatchObject({ kind: "link", url: "https://debian.org", caption: "Debian" });
  });

  it("escapes what the author typed, and treats any other html as a text", () => {
    const evil = { ...newElement("image"), url: 'https://x.com/a.png" onerror="x()', caption: "<script>" };
    const html = elementHtml(evil);
    expect(html).not.toContain('onerror="x()"');
    expect(html).not.toContain("<script>");
    expect(classify("<p>só texto</p>").kind).toBe("text");
    expect(classify("<p>a</p><p>b</p>").kind).toBe("text");
    expect(elementHtml({ ...newElement("code"), lang: "bad lang!", code: "x" })).toContain("language-bash");
  });
});

describe("checkCard", () => {
  it("asks for the title, the text and the command", () => {
    const card = emptyCard();
    card.elements = [newElement("text"), newElement("image"), newElement("video"), newElement("link"), { ...newElement("code"), code: " " }];
    card.commands = [{ id: "c", terminal: 1, expectError: false, command: " ", explanation: "", outputExplanation: "", answers: [] }];
    card.tips = [{ id: "t", title: "", html: "<p></p>" }];
    const errors = checkCard(card, true);
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["title", "c", "t", ...card.elements.map((e) => e.id)]));
    expect(errors[card.elements[1]!.id]).toEqual(["https"]);
    expect(errors[card.elements[2]!.id]).toEqual(["youtube"]);
    expect(errors[card.elements[3]!.id]).toEqual(["url"]);
    expect(checkCard(card, false).title).toBeUndefined();
  });

  it("finds nothing wrong in a good card", () => {
    const card = emptyCard();
    card.title = "T";
    card.elements = [{ ...newElement("text"), html: "<p>x</p>" }, { ...newElement("image"), url: "https://x.com/a.png" }];
    expect(checkCard(card, true)).toEqual({});
  });
});

describe("placeServerErrors", () => {
  it("puts each error on the item behind the block", () => {
    const card = emptyCard();
    card.title = "T";
    card.elements = [{ ...newElement("text"), html: "<p>a</p>" }, { ...newElement("code"), code: "x" }];
    card.commands = [
      { id: "c0", terminal: 1, expectError: false, command: "a", explanation: "", outputExplanation: "", answers: [] },
      { id: "c1", terminal: 1, expectError: false, command: "b", explanation: "", outputExplanation: "", answers: [] },
    ];
    const built = buildBlocks(card);
    const { errors, rest } = placeServerErrors(built, [
      { name: "blocks[0].html", reason: "required" },
      { name: "blocks[0].title", reason: "too long" },
      { name: "blocks[1].html", reason: "bad" },
      { name: "blocks[2].steps[1].command", reason: "required" },
      { name: "replaceIds", reason: "x" },
      { name: "blocks[9].html", reason: "gone" },
    ]);
    expect(errors[card.elements[0]!.id]).toEqual(["html: required"]);
    expect(errors.title).toEqual(["title: too long"]);
    expect(errors[card.elements[1]!.id]).toEqual(["html: bad"]);
    expect(errors.c1).toEqual(["command: required"]);
    expect(rest).toEqual(["replaceIds: x", "blocks[9].html: gone"]);
  });
});

describe("cardCounts", () => {
  it("counts what a card holds", () => {
    expect(cardCounts(groupCards(stored)[1]!)).toEqual({ texts: 1, commands: 2, tips: 1, real: 1, exams: 1, others: 1 });
  });
});

describe("raw html elements", () => {
  it("keeps as html what the visual editor could not hold", () => {
    expect(classify("<p>simples <b>negrito</b></p>").kind).toBe("text");
    expect(classify("<ul><li>um</li></ul><p>dois <a href=\"https://x.com\">link</a></p>").kind).toBe("text");
    // A table with markup in its cells, a colored line, a div and a class are not text.
    expect(classify('<table class="md-table"><tbody><tr><td><code>/</code></td><td>raiz</td></tr></tbody></table>')).toMatchObject({ kind: "html" });
    expect(classify('<pre class="anatomia-linha"><span class="an-dono">maria</span>:x</pre>').kind).toBe("html");
    expect(classify("<div><p>caixa</p></div>").kind).toBe("html");
    expect(classify('<p class="x">classe</p>').kind).toBe("html");
    // A plain table is still a table, with or without a header.
    expect(classify('<table class="md-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')).toMatchObject({ kind: "table", headers: "", rows: "a | b" });
  });

  it("writes a table without header and without an empty one", () => {
    const table = { ...newElement("table"), headers: "", rows: "a | b" };
    expect(elementHtml(table)).toBe('<table class="md-table"><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  });

  it("stores raw html as it is, in a block of its own that does not merge into the header", () => {
    const card = emptyCard();
    card.title = "T";
    card.elements = [{ ...newElement("html"), html: '<div class="x"><p>a</p></div>' }, { ...newElement("text"), html: "<p>b</p>" }];
    const { blocks } = buildBlocks(card);
    expect(blocks.map((b) => b.payload)).toEqual([{ title: "T", command: "", html: "" }, { html: '<div class="x"><p>a</p></div>' }, { html: "<p>b</p>" }]);
    expect(checkCard({ ...card, elements: [{ ...newElement("html"), html: " " }] }, true)).toMatchObject({});
    expect(Object.values(checkCard({ ...card, elements: [{ ...newElement("html"), html: " " }] }, true)).flat()).toContain("required");
  });

  it("reads a stored card with an html block back as an html element", () => {
    const group = groupCards([
      block("h", "TEXT", 1, { title: "Card", html: "<p>texto</p>" }),
      block("r", "TEXT", 2, { html: '<pre class="anatomia-linha"><span class="an-dono">m</span></pre>' }),
    ])[0]!;
    expect(parseCard(group).elements.map((e) => e.kind)).toEqual(["text", "html"]);
  });

  it("only previews html that is safe to show", () => {
    expect(looksSafe("<p>ok <b>x</b></p>")).toBe(true);
    for (const bad of ["<script>x()</script>", '<img src=x onerror="x()">', '<a href="javascript:x()">y</a>', "<iframe src=x></iframe>"]) expect(looksSafe(bad)).toBe(false);
  });
});

describe("snapshot and expected error (SPEC-020, SPEC-021)", () => {
  const withSetup = [
    block("h", "TEXT", 1, { title: "Card", html: "<p>t</p>", setup: { summary: "pronto", steps: [{ command: "mkdir /x" }, { command: "useradd ana", terminal: 2 }] } }),
    block("c", "COMMAND", 2, { steps: [{ command: "curl http://localhost", terminal: 1, expectError: true }, { command: "ls", terminal: 1 }] }),
  ];

  it("reads the snapshot of the header and the expected error of a command", () => {
    const card = parseCard(groupCards(withSetup)[0]!);
    expect(card.setup).toEqual({ summary: "pronto", steps: [{ command: "mkdir /x" }, { command: "useradd ana", terminal: 2 }] });
    expect(card.commands.map((c) => c.expectError)).toEqual([true, false]);
  });

  it("turns the environment of the first version into a snapshot", () => {
    const old = block("h", "TEXT", 1, { title: "Card", html: "", environment: { scenarioId: "x", summary: "s", commands: ["mkdir /a", "touch /a/b"] } });
    expect(parseCard(groupCards([old])[0]!).setup).toEqual({ summary: "s", steps: [{ command: "mkdir /a" }, { command: "touch /a/b" }] });
    const { blocks } = buildBlocks(parseCard(groupCards([old])[0]!));
    expect(blocks[0]!.payload).not.toHaveProperty("environment");
    expect(blocks[0]!.payload.setup).toEqual({ summary: "s", steps: [{ command: "mkdir /a" }, { command: "touch /a/b" }] });
  });

  it("builds them back, writing expectError only when it is true", () => {
    const { blocks } = buildBlocks(parseCard(groupCards(withSetup)[0]!));
    expect(blocks[0]!.payload.setup).toEqual({ summary: "pronto", steps: [{ command: "mkdir /x" }, { command: "useradd ana", terminal: 2 }] });
    expect(blocks[1]!.payload.steps).toEqual([
      { command: "curl http://localhost", terminal: 1, expectError: true },
      { command: "ls", terminal: 1 },
    ]);
  });

  it("has no snapshot unless the header has one, and needs the title and the commands to keep it", () => {
    const plain = parseCard(groupCards([block("h", "TEXT", 1, { title: "Card", html: "" })])[0]!);
    expect(plain.setup).toBeUndefined();
    expect(buildBlocks(plain).blocks[0]!.payload).not.toHaveProperty("setup");
    const card = emptyCard();
    card.setup = { summary: "", steps: [{ command: "mkdir /x" }, { command: " " }] };
    expect(checkCard(card, false).setup).toEqual(["needs-title"]);
    expect(checkCard(card, false)["setup-1"]).toEqual(["required"]);
    card.title = "T";
    expect(checkCard(card, true).setup).toBeUndefined();
  });

  it("puts the server's snapshot errors on the section or on the step", () => {
    const card = emptyCard();
    card.title = "T";
    card.setup = { summary: "", steps: [{ command: "a" }] };
    const built = buildBlocks(card);
    expect(placeServerErrors(built, [{ name: "blocks[0].setup.steps", reason: "too many" }]).errors.setup).toEqual(["setup.steps: too many"]);
    expect(placeServerErrors(built, [{ name: "blocks[0].setup.steps[0].command", reason: "required" }]).errors["setup-0"]).toEqual(["setup.steps[0].command: required"]);
  });
});
