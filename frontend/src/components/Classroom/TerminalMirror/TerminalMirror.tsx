"use client";

import { useEffect, useRef } from "react";
import { loadTerminalStyle, rangeAt, SCREEN_ATTRS, SCREEN_TAGS, textLength, type ScreenElement, type TextRun } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import type { StageSelection } from "@/services/classroomService";
import { showHighlight, TERMINAL_HIGHLIGHT } from "../selection/selection";
import styles from "./TerminalMirror.module.scss";

const m = messages.classroom.terminal;

/** No terminal window goes this deep; a tree that does is hostile or broken, and what lies below this is left out. */
const MAX_DEPTH = 40;

/** The tags whose content is not drawn: a field is its value, a line break is empty. */
const NO_CONTENT = new Set(["br", "input", "textarea"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Where the text is while the picture is drawn: the text nodes made, each with where it starts in the text of the whole picture. */
interface Drawing {
  runs: TextRun[];
  at: number;
}

/**
 * Draws a node of the picture with createElement and createTextNode, never with innerHTML, and only with the tags and the attributes of the list: the
 * sender is not trusted, so the list is applied here too. A tag out of the list is left and what it holds takes its place, as text. The text that is
 * not drawn (inside a line break or a field, or too deep) still counts, as it does for the teacher, so the offsets of a selection are where he has them.
 */
function draw(node: unknown, depth: number, drawing: Drawing): Node[] {
  if (depth > MAX_DEPTH) {
    drawing.at += textLength(node);
    return [];
  }
  if (typeof node === "string") {
    const text = document.createTextNode(node);
    drawing.runs.push({ node: text, start: drawing.at, length: node.length });
    drawing.at += node.length;
    return [text];
  }
  if (!isObject(node) || typeof node.tag !== "string") return [];
  const children = Array.isArray(node.children) ? node.children : [];
  if (!SCREEN_TAGS.has(node.tag)) return children.flatMap((child) => draw(child, depth + 1, drawing));

  const element = document.createElement(node.tag);
  const field = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement ? element : null;
  const attrs = isObject(node.attrs) ? node.attrs : {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!SCREEN_ATTRS.has(name)) continue;
    if (name === "hidden") element.hidden = Boolean(value);
    else if (typeof value !== "string") continue;
    else if (name !== "value") element.setAttribute(name, value);
    else if (field) field.value = value;
  }
  // The copy never takes what is typed: the fields only show.
  if (field) field.readOnly = true;
  if (NO_CONTENT.has(node.tag)) drawing.at += textLength(children);
  else element.append(...children.flatMap((child) => draw(child, depth + 1, drawing)));
  return [element];
}

/** What the picture does not carry, and the layout of the terminal needs: how many terminals each window body holds, and the end of every screen. */
function arrange(root: HTMLElement) {
  for (const body of root.querySelectorAll<HTMLElement>(".janela-corpo")) {
    // The side-by-side layout divides the body by this count, which the real window sets with a style; here it is counted, not taken from the tree.
    const terminals = Array.from(body.children).filter((child) => child.classList.contains("term")).length;
    body.style.setProperty("--quantidade", String(terminals));
  }
  for (const screen of root.querySelectorAll<HTMLElement>(".term-tela")) screen.scrollTop = screen.scrollHeight;
}

export interface TerminalMirrorProps {
  /** The picture of the teacher's terminal window, as the room tells it; null until the first one comes. */
  screen: ScreenElement | null;
  /** The text the teacher selected: when it is in the terminal, the stretch is marked on the copy, and again at every new picture (SPEC-057). */
  selection?: StageSelection | null;
}

/**
 * The student's copy of the teacher's terminal window (SPEC-056): the whole window as the teacher sees it, tabs and editors included, drawn from
 * the picture the room delivers, in an inert container, with the stylesheet of the terminal. It never mounts the engine and never runs anything.
 */
export function TerminalMirror({ screen, selection }: TerminalMirrorProps) {
  const host = useRef<HTMLDivElement>(null);
  const runs = useRef<TextRun[]>([]);

  useEffect(() => {
    loadTerminalStyle().catch(() => undefined);
  }, []);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const drawing: Drawing = { runs: [], at: 0 };
    root.replaceChildren(...(screen ? draw(screen, 0, drawing) : []));
    runs.current = drawing.runs;
    arrange(root);
  }, [screen]);

  // The mark goes on after the picture is drawn, and off before the next one replaces it, so it is always on the text that is there.
  useEffect(() => {
    if (!selection || selection.pane !== "terminal") return;
    const range = rangeAt(runs.current, selection.start, selection.end);
    if (range) return showHighlight(TERMINAL_HIGHLIGHT, [range]);
  }, [screen, selection]);

  return (
    <section className={styles.view}>
      <p className={styles.note}>{m.readOnly}</p>
      {!screen && (
        <p className={styles.note} role="status">
          {m.loading}
        </p>
      )}
      <div ref={host} className={styles.window} data-testid="terminal-mirror" inert />
    </section>
  );
}
