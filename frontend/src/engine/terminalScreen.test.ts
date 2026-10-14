import { afterEach, describe, expect, it } from "vitest";
import { offsetAt, rangeAt, textLength, type ScreenElement, type TextRun } from "./terminalScreen";

afterEach(() => {
  document.body.replaceChildren();
});

/** The text nodes of a box as runs, with where each one starts in the text of the whole box: how the window and the copy of the student both count. */
function runsOf(root: Node): TextRun[] {
  const runs: TextRun[] = [];
  let start = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    runs.push({ node: text, start, length: text.data.length });
    start += text.data.length;
  }
  return runs;
}

function boxOf(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return { root, runs: runsOf(root) };
}

// SPEC-057 CA-20, CA-21: the selection is told in characters over the text of the picture, not over the nodes of the DOM
describe("textLength", () => {
  const tree: ScreenElement = { tag: "div", children: ["ab", { tag: "span", children: ["cde", { tag: "b", children: ["f"] }] }, { tag: "br" }, "gh"] };

  it("is the length of all the text of a node of the picture", () => {
    expect(textLength(tree)).toBe(8);
    expect(textLength("abc")).toBe(3);
    expect(textLength({ tag: "br" })).toBe(0);
  });
});

describe("offsetAt", () => {
  it("is where a point of a text node is in the text of the picture", () => {
    const { runs } = boxOf("<span>Hello</span> <b>wor</b>ld");
    expect(offsetAt(runs, runs[0]!.node, 2)).toBe(2);
    expect(offsetAt(runs, runs[1]!.node, 1)).toBe(6);
    expect(offsetAt(runs, runs[2]!.node, 3)).toBe(9);
    expect(offsetAt(runs, runs[3]!.node, 0)).toBe(9);
  });

  it("takes a point between two nodes as the start of the node that follows", () => {
    const { root, runs } = boxOf("<span>Hello</span><b>world</b>");
    expect(offsetAt(runs, root, 0)).toBe(0);
    expect(offsetAt(runs, root, 1)).toBe(5);
  });

  it("takes a point after all the text as the end of the text", () => {
    const { root, runs } = boxOf("<span>Hello</span><b>world</b>");
    expect(offsetAt(runs, root, 2)).toBe(10);
  });

  it("takes a point inside an element that holds text as the start of its first text", () => {
    const { root, runs } = boxOf("<i>ab</i><u><s>cd</s></u>");
    const underline = root.querySelector("u")!;
    expect(offsetAt(runs, underline, 0)).toBe(2);
  });

  it("takes a node that is not in the text as the place where it stands among the others", () => {
    const { root, runs } = boxOf("<p>aa</p><q>zz</q>");
    const mid = document.createElement("em");
    mid.textContent = "novo";
    root.insertBefore(mid, root.querySelector("q"));
    expect(offsetAt(runs, mid.firstChild!, 2)).toBe(2);
    const before = document.createElement("em");
    before.textContent = "antes";
    root.insertBefore(before, root.firstChild);
    expect(offsetAt(runs, before.firstChild!, 2)).toBe(0);
  });

  it("tells nothing when there is no text", () => {
    const { root } = boxOf("");
    expect(offsetAt([], root, 0)).toBeNull();
  });
});

describe("rangeAt", () => {
  it("is the range of the characters between two offsets, inside one node or across many", () => {
    const { runs } = boxOf("<span>Hello</span> <b>wor</b>ld");
    expect(rangeAt(runs, 1, 4)!.toString()).toBe("ell");
    expect(rangeAt(runs, 3, 8)!.toString()).toBe("lo wo");
    expect(rangeAt(runs, 0, 9)!.toString()).toBe("Hello wor");
  });

  it("starts in the node where the offset is, and ends in the node where the end is", () => {
    const { runs } = boxOf("<span>ab</span><b>cd</b>");
    const range = rangeAt(runs, 2, 4)!;
    expect(range.startContainer).toBe(runs[1]!.node);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(runs[1]!.node);
    expect(range.endOffset).toBe(2);
  });

  it("keeps the offsets inside the text", () => {
    const { runs } = boxOf("<span>Hello</span>");
    expect(rangeAt(runs, -5, 99)!.toString()).toBe("Hello");
    expect(rangeAt(runs, 2, 99)!.toString()).toBe("llo");
  });

  it("tells nothing when there is nothing between the offsets, or no text", () => {
    const { runs } = boxOf("<span>Hello</span>");
    expect(rangeAt(runs, 3, 3)).toBeNull();
    expect(rangeAt(runs, 4, 2)).toBeNull();
    expect(rangeAt(runs, 50, 60)).toBeNull();
    expect(rangeAt([], 0, 1)).toBeNull();
  });

  it("is the way back of offsetAt", () => {
    const { runs } = boxOf("<p>Primeira linha</p><p>Segunda <b>linha</b></p>");
    const range = rangeAt(runs, 4, 20)!;
    expect(offsetAt(runs, range.startContainer, range.startOffset)).toBe(4);
    expect(offsetAt(runs, range.endContainer, range.endOffset)).toBe(20);
  });
});
