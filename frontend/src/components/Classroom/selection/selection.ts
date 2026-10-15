// The text the teacher selects, told to the students (SPEC-057 CA-20, CA-21): the stretch is described without depending on how the screen is drawn,
// and the student marks it again on his own copy. On the material the stretch is told by block and by characters in the text of the block; on the
// terminal, by characters over the text of the last picture of its window (see engine/terminalScreen).

import type { ScreenLocator } from "@/engine/terminalScreen";
import type { StageSelection } from "@/services/classroomService";

/** The names of the highlights of the browser: one for the material and one for the terminal, painted the same way. */
export const MATERIAL_HIGHLIGHT = "teacher-material";
export const TERMINAL_HIGHLIGHT = "teacher-terminal";

/** How many characters of text come before a point inside a block. */
function offsetIn(block: Element, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(container, offset);
  return range.toString().length;
}

/**
 * What the teacher selected in the material, as the first and the last block it touches and the characters in each. A selection that starts or ends
 * where there is no block (the title of a card) starts at the beginning of the first block, or ends at the end of the last. null when it touches
 * no block, is empty, or is not in the material.
 */
export function materialSelectionOf(root: HTMLElement, range: Range): StageSelection | null {
  if (range.collapsed || !root.contains(range.commonAncestorContainer)) return null;
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block]")).filter((block) => block.dataset.block && range.intersectsNode(block));
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first || !last) return null;
  const start = first.contains(range.startContainer) ? offsetIn(first, range.startContainer, range.startOffset) : 0;
  const end = last.contains(range.endContainer) ? offsetIn(last, range.endContainer, range.endOffset) : (last.textContent ?? "").length;
  if (first === last && start >= end) return null;
  return { pane: "material", start: { block: first.dataset.block!, offset: start }, end: { block: last.dataset.block!, offset: end } };
}

/** The place, as a text node and an offset in it, of a number of characters into a block; the end of the block when it has fewer. */
function placeIn(block: Element, characters: number): [Node, number] {
  let left = Math.max(0, characters);
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (left <= node.data.length) return [node, left];
    left -= node.data.length;
  }
  return [block, block.childNodes.length];
}

/** The range that a selection of the material stands for on this screen, or null when a block is not here or there is nothing between the points. */
export function materialRangeOf(root: HTMLElement, selection: StageSelection): Range | null {
  if (selection.pane !== "material") return null;
  const find = (id: string) => root.querySelector(`[data-block="${CSS.escape(id)}"]`);
  const from = find(selection.start.block);
  const to = find(selection.end.block);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(...placeIn(from, selection.start.offset));
  // An end before the start makes the range collapse, which is how it is told apart.
  range.setEnd(...placeIn(to, selection.end.offset));
  return range.collapsed ? null : range;
}

/**
 * What the teacher selected in the terminal, as the number of the terminal and the characters over the text of the last picture of the window.
 * null when the stretch is not in a terminal, is not in the picture, or is empty.
 */
export function terminalSelectionOf(locator: ScreenLocator, range: Range): StageSelection | null {
  if (range.collapsed) return null;
  const start = locator.offsetOf(range.startContainer, range.startOffset);
  const end = locator.offsetOf(range.endContainer, range.endOffset);
  const terminal = locator.terminalOf(range.startContainer);
  if (start === null || end === null || terminal === null || start >= end) return null;
  return { pane: "terminal", terminal: Math.min(3, Math.max(1, terminal)), start, end };
}

/**
 * Marks the stretches on the screen, and gives what takes the marks away. The browser paints them with the highlight API, which leaves the text as
 * it is; a browser without it gets marks around the text, which change no character of it.
 */
export function showHighlight(name: string, ranges: Range[]): () => void {
  const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (registry && Highlight) {
    registry.set(name, new Highlight(...ranges));
    return () => {
      registry.delete(name);
    };
  }
  return wrapInMarks(ranges);
}

/** The text nodes a range touches, each with the part of it the range holds. */
function textPartsOf(range: Range): Array<{ node: Text; from: number; to: number }> {
  const root = range.commonAncestorContainer;
  const nodes: Text[] = [];
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text);
  else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) if (range.intersectsNode(node)) nodes.push(node);
  }
  return nodes
    .map((node) => ({ node, from: node === range.startContainer ? range.startOffset : 0, to: node === range.endContainer ? range.endOffset : node.data.length }))
    .filter((part) => part.from < part.to);
}

/** Wraps the text of the ranges in marks; what it returns unwraps them and puts the text nodes back together as they were. */
function wrapInMarks(ranges: Range[]): () => void {
  const marks: HTMLElement[] = [];
  const fragments: Text[] = [];
  for (const range of ranges) {
    for (const { node, from, to } of textPartsOf(range)) {
      const middle = from > 0 ? node.splitText(from) : node;
      if (middle !== node) fragments.push(middle);
      if (to - from < middle.data.length) fragments.push(middle.splitText(to - from));
      const mark = document.createElement("mark");
      mark.setAttribute("data-teacher-selection", "");
      middle.replaceWith(mark);
      mark.append(middle);
      marks.push(mark);
    }
  }
  return () => {
    for (const mark of marks) mark.replaceWith(...Array.from(mark.childNodes));
    for (const fragment of fragments.reverse()) {
      const before = fragment.previousSibling;
      if (before instanceof Text) {
        before.data += fragment.data;
        fragment.remove();
      }
    }
  };
}
