/**
 * The keys of the teacher on the terminal of a student (SPEC-071 RN-05): the takeover. The engine is not changed: it hears the keyboard through the
 * events of the page, so each key of the teacher is given to it as the same event that the key of the student would be. The shell and the live
 * commands (top, sleep) do everything themselves with the event. The editors (nano, vim) write in a text field of the page, which a made event does
 * not change by itself, so the adapter also does to the field what the key would do (write the character, erase, break the line, move the caret)
 * and tells the editor of the change. The events it makes are marked, so a lock of the keyboard of the student lets them through, and no other.
 */

/** A key of the teacher: its name as the browser gives it (a character or a name like "Enter") and the modifiers. */
export interface RemoteKey {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const made = new WeakSet<Event>();

/** Tells whether the event is a key of the teacher. */
export function isRemoteKey(event: Event): boolean {
  return made.has(event);
}

type Field = HTMLInputElement | HTMLTextAreaElement;

const isField = (el: Element | null): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

/**
 * Where the key goes: the element of the window that has the focus, when there is one; else, in the terminal that is active (the first one when none
 * says so), the field of the editor that is open (its question or its line of command first, then the text) or the screen of the shell.
 */
export function keyTarget(root: HTMLElement): HTMLElement | null {
  const focused = root.ownerDocument.activeElement;
  if (focused instanceof HTMLElement && focused !== root && root.contains(focused) && (isField(focused) || focused.classList.contains("term-tela"))) return focused;
  const term = root.querySelector<HTMLElement>(".term.ativo") ?? root.querySelector<HTMLElement>(".term");
  const scope = term ?? root;
  const editor = scope.querySelector<HTMLElement>(".term-editor:not([hidden])");
  if (editor) {
    return editor.querySelector<HTMLElement>("input:not([hidden])") ?? editor.querySelector<HTMLElement>("textarea") ?? editor;
  }
  return scope.querySelector<HTMLElement>(".term-tela");
}

function lineStart(value: string, at: number): number {
  return value.lastIndexOf("\n", at - 1) + 1;
}

function lineEnd(value: string, at: number): number {
  const end = value.indexOf("\n", at);
  return end === -1 ? value.length : end;
}

/** The caret one line up or down, at the same column or at the end of a shorter line. */
function otherLine(value: string, at: number, down: boolean): number {
  const start = lineStart(value, at);
  const column = at - start;
  if (down) {
    const end = lineEnd(value, at);
    if (end === value.length) return value.length;
    return Math.min(end + 1 + column, lineEnd(value, end + 1));
  }
  if (start === 0) return 0;
  const previous = lineStart(value, start - 1);
  return Math.min(previous + column, start - 1);
}

/** Does to the field what the key does when nothing stops it, and tells whether the text changed. */
function edit(field: Field, key: string): boolean {
  const value = field.value;
  const from = field.selectionStart ?? value.length;
  const to = field.selectionEnd ?? from;
  const put = (text: string, start: number, end: number) => {
    field.setRangeText(text, start, end, "end");
    return true;
  };
  const caret = (at: number) => {
    field.setSelectionRange(at, at);
    return false;
  };
  const multiline = field instanceof HTMLTextAreaElement;
  if (key.length === 1 || Array.from(key).length === 1) return field.readOnly ? false : put(key, from, to);
  switch (key) {
    case "Backspace":
      if (field.readOnly) return false;
      return from !== to ? put("", from, to) : from > 0 ? put("", from - 1, from) : false;
    case "Delete":
      if (field.readOnly) return false;
      return from !== to ? put("", from, to) : from < value.length ? put("", from, from + 1) : false;
    case "Enter":
      return multiline && !field.readOnly ? put("\n", from, to) : false;
    case "Tab":
      return multiline && !field.readOnly ? put("\t", from, to) : false;
    case "ArrowLeft":
      return caret(Math.max(0, from - 1));
    case "ArrowRight":
      return caret(Math.min(value.length, to + 1));
    case "ArrowUp":
      return caret(multiline ? otherLine(value, from, false) : 0);
    case "ArrowDown":
      return caret(multiline ? otherLine(value, from, true) : value.length);
    case "Home":
      return caret(multiline ? lineStart(value, from) : 0);
    case "End":
      return caret(multiline ? lineEnd(value, from) : value.length);
  }
  return false;
}

/** Gives one key of the teacher to the terminal in the root, as if it was typed there. */
export function deliverKey(root: HTMLElement, key: RemoteKey): void {
  const target = keyTarget(root);
  if (!target) return;
  const init = { key: key.key, ctrlKey: key.ctrl === true, altKey: key.alt === true, shiftKey: key.shift === true, bubbles: true, cancelable: true };
  const down = new KeyboardEvent("keydown", init);
  made.add(down);
  const free = target.dispatchEvent(down);
  // What the event did may have moved the focus (the line of command of vim, the question of nano); the edit is of the field that got the key.
  if (free && isField(target) && !init.ctrlKey && !init.altKey && edit(target, key.key)) {
    const input = new Event("input", { bubbles: true });
    made.add(input);
    target.dispatchEvent(input);
  }
  const up = new KeyboardEvent("keyup", init);
  made.add(up);
  target.dispatchEvent(up);
}

/** Gives a text that the teacher pasted, as the keys that type it: a line break is Enter, as a paste in a real terminal runs each line. */
export function deliverPaste(root: HTMLElement, text: string): void {
  for (const char of Array.from(text)) {
    if (char === "\r") continue;
    deliverKey(root, { key: char === "\n" ? "Enter" : char === "\t" ? "Tab" : char });
  }
}

/** The keys of the teacher for one terminal, in the order they came. */
export interface RemoteKeyboard {
  key(key: RemoteKey): void;
  paste(text: string): void;
  /** Drops what still waits. */
  stop(): void;
}

/** How often the keyboard looks again whether the command that runs is over. */
const WAIT_MS = 25;

/**
 * The keys of the teacher as a real terminal takes them: a key typed while a command runs waits for it to end, as the terminal of a real machine keeps what
 * is typed ahead; Ctrl and Alt go at once, so Ctrl+C stops the command that runs.
 */
export function remoteKeyboard(root: HTMLElement, running: () => boolean): RemoteKeyboard {
  const queue: RemoteKey[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pump = () => {
    timer = undefined;
    while (queue.length > 0) {
      if (running()) {
        timer = setTimeout(pump, WAIT_MS);
        return;
      }
      deliverKey(root, queue.shift()!);
    }
  };
  const push = (key: RemoteKey) => {
    if ((key.ctrl || key.alt) && running()) {
      deliverKey(root, key);
      return;
    }
    queue.push(key);
    if (timer === undefined) pump();
  };
  return {
    key: push,
    paste(text) {
      for (const char of Array.from(text)) {
        if (char !== "\r") push({ key: char === "\n" ? "Enter" : char === "\t" ? "Tab" : char });
      }
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
      queue.length = 0;
    },
  };
}
