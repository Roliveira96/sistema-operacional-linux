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
