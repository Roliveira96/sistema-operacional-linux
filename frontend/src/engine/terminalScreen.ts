// The picture of the teacher's terminal window that goes to the class (SPEC-056). The window is copied as a tree of a closed list of tags and
// attributes; the student draws it again without innerHTML. This file holds the format and the lists, shared by the one that copies the
// screen (terminalWindow.ts) and the one that draws it (components/Classroom/TerminalMirror), and loads the stylesheet of the terminal,
// which only src/engine/ may import (SPEC-034). It does not load the engine, so a student's screen takes no part of it.

/** The attributes a node of the picture may carry; `hidden` is a flag, the others are text. */
export type ScreenAttrs = Record<string, string | boolean>;

/** An element of the picture: its tag, the attributes of the list and its children (a string is a text node). */
export interface ScreenElement {
  tag: string;
  attrs?: ScreenAttrs;
  children?: ScreenNode[];
}

export type ScreenNode = ScreenElement | string;

/** The tags that can be in the picture. Any other tag is left out and only its content stays. */
export const SCREEN_TAGS: ReadonlySet<string> = new Set(["div", "span", "b", "i", "em", "strong", "kbd", "code", "pre", "br", "button", "textarea", "input", "table", "tbody", "tr", "td", "th"]);

/** The attributes that can be in the picture: never an event, an address or a style. */
export const SCREEN_ATTRS: ReadonlySet<string> = new Set(["class", "hidden", "title", "aria-selected", "role", "value"]);

/** Loads the stylesheet of the terminal window (it is the same one the real terminal uses). */
export async function loadTerminalStyle(): Promise<void> {
  await import("@engine-core/estilos/terminal.css");
}

/** The characters of a text node of the picture, and where they start in the text of the whole picture (SPEC-057 CA-20, CA-21). */
export interface TextRun {
  node: Text;
  start: number;
  length: number;
}

/**
 * How to tell where a point of the window is in the text of the picture that was last delivered: the teacher selects text in the window, and the
 * selection goes to the students as offsets in characters over that text, not as places in a DOM they do not have.
 */
export interface ScreenLocator {
  /** The offset of a point (a node and an offset in it) in the text of the picture; null when the picture has no text. */
  offsetOf(node: Node, offset: number): number | null;
  /** The number of the terminal (from 1) a node is in; null when it is in none. */
  terminalOf(node: Node): number | null;
}

/**
 * How many characters of text a node of the picture holds, whatever the shape of what the sender gave: a string, a node with children, or a list
 * of nodes. It walks with its own stack, so a tree that is very deep cannot blow the stack of the browser.
 */
export function textLength(node: unknown): number {
  let total = 0;
  const pending: unknown[] = [node];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === "string") total += next.length;
    else if (Array.isArray(next)) pending.push(...next);
    else if (typeof next === "object" && next !== null && Array.isArray((next as { children?: unknown }).children)) pending.push(...(next as { children: unknown[] }).children);
  }
  return total;
}

/**
 * The offset in the text of the picture of a point of the DOM. A point in a text node of the runs is the start of the node plus the offset in it; a
 * point that is not (between two nodes, inside an element, or in a node that is not in the picture) is the start of the first run that comes after
 * it, or the end of the text when none does.
 */
export function offsetAt(runs: readonly TextRun[], node: Node, offset: number): number | null {
  if (runs.length === 0) return null;
  for (const run of runs) {
    const range = document.createRange();
    range.setStart(run.node, 0);
    range.setEnd(run.node, Math.min(run.length, run.node.data.length));
    let place: number;
    try {
      place = range.comparePoint(node, offset);
    } catch {
      return null;
    }
    if (place < 0) return run.start;
    if (place === 0) return node === run.node ? run.start + Math.min(offset, run.length) : run.start;
  }
  const last = runs[runs.length - 1]!;
  return last.start + last.length;
}

/** The range of the characters between two offsets of the text of the picture, kept inside the text; null when there is nothing between them. */
export function rangeAt(runs: readonly TextRun[], start: number, end: number): Range | null {
  const last = runs[runs.length - 1];
  if (!last) return null;
  const total = last.start + last.length;
  const from = Math.min(total, Math.max(0, start));
  const to = Math.min(total, Math.max(0, end));
  if (from >= to) return null;
  const first = runs.find((run) => from < run.start + run.length);
  const final = runs.find((run) => to > run.start && to <= run.start + run.length);
  if (!first || !final) return null;
  const range = document.createRange();
  range.setStart(first.node, Math.min(from - first.start, first.node.data.length));
  range.setEnd(final.node, Math.min(to - final.start, final.node.data.length));
  return range;
}
