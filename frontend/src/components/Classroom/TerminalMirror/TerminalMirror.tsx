"use client";

import { useEffect, useRef } from "react";
import { loadTerminalStyle, SCREEN_ATTRS, SCREEN_TAGS, type ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import styles from "./TerminalMirror.module.scss";

const m = messages.classroom.terminal;

/** No terminal window goes this deep; a tree that does is hostile or broken, and what lies below this is left out. */
const MAX_DEPTH = 40;

/** The tags whose content is not drawn: a field is its value, a line break is empty. */
const NO_CONTENT = new Set(["br", "input", "textarea"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Draws a node of the picture with createElement and createTextNode, never with innerHTML, and only with the tags and the attributes of the list: the
 * sender is not trusted, so the list is applied here too. A tag out of the list is left and what it holds takes its place, as text.
 */
function draw(node: unknown, depth: number): Node[] {
  if (depth > MAX_DEPTH) return [];
  if (typeof node === "string") return [document.createTextNode(node)];
  if (!isObject(node) || typeof node.tag !== "string") return [];
  const children = Array.isArray(node.children) ? node.children : [];
  if (!SCREEN_TAGS.has(node.tag)) return children.flatMap((child) => draw(child, depth + 1));

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
  if (!NO_CONTENT.has(node.tag)) element.append(...children.flatMap((child) => draw(child, depth + 1)));
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
}

/**
 * The student's copy of the teacher's terminal window (SPEC-056): the whole window as the teacher sees it, tabs and editors included, drawn from
 * the picture the room delivers, in an inert container, with the stylesheet of the terminal. It never mounts the engine and never runs anything.
 */
export function TerminalMirror({ screen }: TerminalMirrorProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTerminalStyle().catch(() => undefined);
  }, []);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    root.replaceChildren(...(screen ? draw(screen, 0) : []));
    arrange(root);
  }, [screen]);

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
