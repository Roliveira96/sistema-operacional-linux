import { afterEach, describe, expect, it, vi } from "vitest";
import { materialRangeOf, materialSelectionOf, showHighlight, terminalSelectionOf } from "./selection";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Two cards of the material: a title, and blocks with their `data-block`, as the live class draws them. */
function material() {
  const root = document.createElement("div");
  // No spaces between the tags: the DOM that React draws has none.
  root.innerHTML =
    '<article><h2>Título do primeiro card</h2><div data-block="b-1"><p>Primeiro <b>bloco</b> de texto</p></div><div data-block="b-2"><p>Segundo bloco</p></div></article>' +
    '<article><h2>Título do segundo card</h2><div data-block="b-3"><p>Terceiro bloco</p></div></article>';
  document.body.append(root);
  const block = (id: string) => root.querySelector(`[data-block="${id}"]`)!;
  const textOf = (id: string, contains: string) => {
    const walker = document.createTreeWalker(block(id), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.includes(contains)) return node as Text;
    throw new Error(`no text with ${contains}`);
  };
  const range = (from: [Node, number], to: [Node, number]) => {
    const r = document.createRange();
    r.setStart(...from);
    r.setEnd(...to);
    return r;
  };
  return { root, block, textOf, range, title: (n: number) => root.querySelectorAll("h2")[n]!.firstChild as Text };
}

// SPEC-057 CA-20: the text the teacher selects on the material is told by block and by characters in the text of the block
describe("materialSelectionOf", () => {
  it("tells the block and the characters of a selection inside one block", () => {
    const { root, textOf, range } = material();
    const bold = textOf("b-1", "bloco");
    const picked = materialSelectionOf(root, range([bold, 0], [bold, 5]));
    // "Primeiro " has 9 characters.
    expect(picked).toEqual({ pane: "material", start: { block: "b-1", offset: 9 }, end: { block: "b-1", offset: 14 } });
  });

  it("counts the characters of the text of the block, tags aside", () => {
    const { root, textOf, range } = material();
    const tail = textOf("b-1", " de texto");
    const picked = materialSelectionOf(root, range([tail, 1], [tail, 3]));
    expect(picked).toEqual({ pane: "material", start: { block: "b-1", offset: 15 }, end: { block: "b-1", offset: 17 } });
  });

  it("tells the first and the last block of a selection that goes across blocks, and across cards", () => {
    const { root, textOf, range } = material();
    const first = textOf("b-1", "Primeiro ");
    const third = textOf("b-3", "Terceiro");
    const picked = materialSelectionOf(root, range([first, 3], [third, 4]));
    expect(picked).toEqual({ pane: "material", start: { block: "b-1", offset: 3 }, end: { block: "b-3", offset: 4 } });
  });

  it("starts at the first block when the selection starts in a title, which is no block", () => {
    const { root, textOf, range, title } = material();
    const second = textOf("b-2", "Segundo");
    const picked = materialSelectionOf(root, range([title(0), 2], [second, 4]));
    expect(picked).toEqual({ pane: "material", start: { block: "b-1", offset: 0 }, end: { block: "b-2", offset: 4 } });
  });

  it("ends at the end of the last block when the selection ends in a title", () => {
    const { root, textOf, range, title } = material();
    const second = textOf("b-2", "Segundo");
    const picked = materialSelectionOf(root, range([second, 3], [title(1), 3]));
    expect(picked).toEqual({ pane: "material", start: { block: "b-2", offset: 3 }, end: { block: "b-2", offset: "Segundo bloco".length } });
  });

  it("tells nothing when the selection is only in a title, or has no text", () => {
    const { root, textOf, range, title } = material();
    expect(materialSelectionOf(root, range([title(0), 1], [title(0), 5]))).toBeNull();
    const bold = textOf("b-1", "bloco");
    expect(materialSelectionOf(root, range([bold, 2], [bold, 2]))).toBeNull();
  });

  it("tells nothing about a selection that is outside of the material", () => {
    const { root, range } = material();
    const outside = document.createElement("p");
    outside.textContent = "fora do material";
    document.body.append(outside);
    expect(materialSelectionOf(root, range([outside.firstChild!, 0], [outside.firstChild!, 4]))).toBeNull();
  });

  it("takes a selection that starts and ends on elements, as the browser makes it when a whole block is picked", () => {
    const { root, block, range } = material();
    const picked = materialSelectionOf(root, range([block("b-2"), 0], [block("b-2"), 1]));
    expect(picked).toEqual({ pane: "material", start: { block: "b-2", offset: 0 }, end: { block: "b-2", offset: "Segundo bloco".length } });
  });
});

// CA-21: the student turns it back into the same stretch of his copy
describe("materialRangeOf", () => {
  const select = (root: HTMLElement, start: [string, number], end: [string, number]) =>
    materialRangeOf(root, { pane: "material", start: { block: start[0], offset: start[1] }, end: { block: end[0], offset: end[1] } });

  it("gives the range of the characters of the block", () => {
    const { root } = material();
    expect(select(root, ["b-1", 9], ["b-1", 14])!.toString()).toBe("bloco");
    expect(select(root, ["b-1", 14], ["b-1", 16])!.toString()).toBe(" d");
  });

  it("gives the range across blocks", () => {
    const { root } = material();
    expect(select(root, ["b-1", 14], ["b-2", 6])!.toString()).toBe(" de textoSegund");
  });

  it("is the way back of materialSelectionOf", () => {
    const { root, textOf, range } = material();
    const first = textOf("b-1", "Primeiro ");
    const second = textOf("b-2", "Segundo");
    const picked = materialSelectionOf(root, range([first, 3], [second, 5]))!;
    expect(materialRangeOf(root, picked)!.toString()).toBe(range([first, 3], [second, 5]).toString());
  });

  it("keeps the offsets inside the text of the block", () => {
    const { root } = material();
    expect(select(root, ["b-2", -4], ["b-2", 999])!.toString()).toBe("Segundo bloco");
  });

  it("tells nothing when a block is not on the screen, or the end comes before the start", () => {
    const { root } = material();
    expect(select(root, ["b-9", 0], ["b-1", 4])).toBeNull();
    expect(select(root, ["b-1", 0], ["b-9", 4])).toBeNull();
    expect(select(root, ["b-2", 4], ["b-1", 4])).toBeNull();
    expect(select(root, ["b-1", 4], ["b-1", 4])).toBeNull();
  });

  it("finds the block even when its id has characters of a selector", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-block="a&quot;]b"><p>texto</p></div>';
    document.body.append(root);
    expect(materialRangeOf(root, { pane: "material", start: { block: 'a"]b', offset: 0 }, end: { block: 'a"]b', offset: 5 } })!.toString()).toBe("texto");
  });

  it("tells nothing for a selection of the terminal", () => {
    const { root } = material();
    expect(materialRangeOf(root, { pane: "terminal", terminal: 1, start: 0, end: 3 })).toBeNull();
  });
});

describe("terminalSelectionOf", () => {
  const locator = (offsets: Record<string, number | null>, terminal: number | null = 1) => ({
    offsetOf: (node: Node, offset: number) => offsets[`${node.textContent}:${offset}`] ?? null,
    terminalOf: () => terminal,
  });
  const textNode = (text: string) => {
    const el = document.createElement("div");
    el.textContent = text;
    document.body.append(el);
    return el.firstChild as Text;
  };
  const rangeIn = (node: Text, start: number, end: number) => {
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    return r;
  };

  it("tells the terminal and the offsets over the text of the picture", () => {
    const node = textNode("ls -la");
    const picked = terminalSelectionOf(locator({ "ls -la:0": 12, "ls -la:2": 14 }, 2), rangeIn(node, 0, 2));
    expect(picked).toEqual({ pane: "terminal", terminal: 2, start: 12, end: 14 });
  });

  it("keeps the number of the terminal between 1 and 3", () => {
    const node = textNode("ls");
    const offsets = { "ls:0": 0, "ls:2": 2 };
    expect(terminalSelectionOf(locator(offsets, 7), rangeIn(node, 0, 2))).toMatchObject({ terminal: 3 });
    expect(terminalSelectionOf(locator(offsets, 0), rangeIn(node, 0, 2))).toMatchObject({ terminal: 1 });
  });

  it("tells nothing when the place is not in a terminal, or not in the picture, or there is no text between", () => {
    const node = textNode("ls");
    expect(terminalSelectionOf(locator({ "ls:0": 0, "ls:2": 2 }, null), rangeIn(node, 0, 2))).toBeNull();
    expect(terminalSelectionOf(locator({ "ls:0": 0 }), rangeIn(node, 0, 2))).toBeNull();
    expect(terminalSelectionOf(locator({ "ls:1": 4, "ls:1x": 4 }), rangeIn(node, 1, 1))).toBeNull();
    expect(terminalSelectionOf(locator({ "ls:0": 5, "ls:2": 5 }), rangeIn(node, 0, 2))).toBeNull();
  });
});

// The marks are painted with the highlight of the browser, and with marks that do not change the text where there is none
describe("showHighlight", () => {
  function highlightApi() {
    const registry = new Map<string, unknown>();
    vi.stubGlobal("CSS", { ...CSS, highlights: registry });
    vi.stubGlobal(
      "Highlight",
      class {
        ranges: Range[];
        constructor(...ranges: Range[]) {
          this.ranges = ranges;
        }
      },
    );
    return registry as Map<string, { ranges: Range[] }>;
  }

  it("sets the highlight of the browser under its name, and takes it away", () => {
    const registry = highlightApi();
    const { root, textOf, range } = material();
    const bold = textOf("b-1", "bloco");
    const picked = range([bold, 0], [bold, 5]);
    const hide = showHighlight("teacher-material", [picked]);
    expect(registry.get("teacher-material")!.ranges).toEqual([picked]);
    expect(root.querySelector("mark")).toBeNull();
    hide();
    expect(registry.has("teacher-material")).toBe(false);
  });

  it("keeps the text as it is when the browser has no highlight: the marks go around the stretch and come off", () => {
    vi.stubGlobal("CSS", { escape: CSS.escape });
    const { root, textOf, range } = material();
    const before = root.innerHTML;
    const text = root.textContent;
    const first = textOf("b-1", "Primeiro ");
    const second = textOf("b-2", "Segundo");
    const hide = showHighlight("teacher-material", [range([first, 3], [second, 4])]);
    const marks = [...root.querySelectorAll("mark[data-teacher-selection]")];
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((mark) => mark.textContent).join("")).toBe("meiro bloco de textoSegu");
    expect(root.textContent).toBe(text);
    hide();
    expect(root.querySelector("mark")).toBeNull();
    expect(root.innerHTML).toBe(before);
  });

  it("keeps the text as it is when the stretch is a part of one text node", () => {
    vi.stubGlobal("CSS", { escape: CSS.escape });
    const { root, textOf, range } = material();
    const text = root.textContent;
    const node = textOf("b-2", "Segundo");
    const hide = showHighlight("teacher-terminal", [range([node, 2], [node, 7])]);
    expect(root.querySelector("mark")!.textContent).toBe("gundo");
    expect(root.textContent).toBe(text);
    hide();
    expect(root.querySelector("mark")).toBeNull();
  });

  it("does nothing for a stretch that has no text, and its undo does nothing", () => {
    vi.stubGlobal("CSS", { escape: CSS.escape });
    const { root, textOf, range } = material();
    const node = textOf("b-2", "Segundo");
    const hide = showHighlight("teacher-terminal", [range([node, 2], [node, 2])]);
    expect(root.querySelector("mark")).toBeNull();
    expect(() => hide()).not.toThrow();
  });
});
