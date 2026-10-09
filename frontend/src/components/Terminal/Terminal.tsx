"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { NanoDialog } from "@/components/NanoDialog/NanoDialog";
import { createSession, type EditRequest, type EngineSession, type OutputChunk, type Prompt } from "@/engine/engine";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./Terminal.module.scss";

type Entry = { kind: "command"; prompt: Prompt; command: string } | { kind: "output"; chunk: OutputChunk };

interface Question {
  text: string;
  hidden: boolean;
  resolve: (answer: string) => void;
}

interface Edit {
  request: EditRequest;
  resolve: (saved: string | null) => void;
}

export interface TerminalHandle {
  /** Serialized machine state, or null while the engine is loading. */
  snapshot(): unknown;
}

export interface TerminalProps {
  snapshot: unknown;
  /** Injectable for tests; defaults to the legacy engine adapter. */
  create?: typeof createSession;
  onError?: (error: unknown) => void;
}

/** Colored bash prompt: user@host in green, path in blue, as in Ubuntu. */
function PromptView({ prompt }: { prompt: Prompt }) {
  return (
    <span className={styles.prompt}>
      <span className={styles.promptUser}>
        {prompt.user}@{prompt.host}
      </span>
      :<span className={styles.promptPath}>{prompt.path}</span>
      {prompt.isRoot ? "# " : "$ "}
    </span>
  );
}

/** Lines printed by sshd and the Ubuntu motd when the session opens. */
function welcome(user: string, now: Date): Entry[] {
  const lines: OutputChunk[] = [
    { text: contentMessages.practice.connected(user) + "\n", tone: "info" },
    { text: "Welcome to Ubuntu 24.04 LTS (GNU/Linux 6.8.0-45-generic x86_64)\n\n" },
    { text: " * Documentation:  https://help.ubuntu.com\n * Management:     https://landscape.canonical.com\n\n" },
    { text: `Last login: ${now.toString().substring(0, 24)} from 192.168.0.51\n` },
  ];
  return lines.map((chunk) => ({ kind: "output", chunk }));
}

/** Shell terminal backed by the legacy engine (SPEC-014). Keyboard operable. */
export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { snapshot, create = createSession, onError },
  ref,
) {
  const m = contentMessages.practice;
  const session = useRef<EngineSession | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState<Prompt | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({ snapshot: () => session.current?.snapshot() ?? null }), []);

  const append = useCallback((entry: Entry) => setEntries((prev) => [...prev, entry]), []);

  useEffect(() => {
    let active = true;
    create(snapshot, {
      ask: (text, hidden) => new Promise((resolve) => setQuestion({ text, hidden, resolve })),
      edit: (request) => new Promise((resolve) => setEdit({ request, resolve })),
      clear: () => setEntries([]),
    })
      .then((s) => {
        if (!active) return;
        session.current = s;
        const prompt = s.prompt();
        setCurrent(prompt);
        setEntries(welcome(prompt.user, new Date()));
        setReady(true);
      })
      .catch((error: unknown) => onError?.(error));
    return () => {
      active = false;
    };
  }, [snapshot, create, onError]);

  useEffect(() => {
    if (ready && !busy) input.current?.focus();
  }, [ready, busy, question, edit]);

  async function submit() {
    if (question) {
      append({ kind: "output", chunk: { text: question.text + (question.hidden ? "" : line) + "\n" } });
      question.resolve(line);
      setQuestion(null);
      setLine("");
      return;
    }
    const s = session.current;
    if (!s || busy) return;
    const command = line;
    append({ kind: "command", prompt: s.prompt(), command });
    setLine("");
    setCursor(null);
    if (command.trim()) setHistory((h) => [...h, command]);
    setBusy(true);
    try {
      await s.run(command, (chunk) => append({ kind: "output", chunk }));
    } finally {
      // Commands like cd, su and exit change the prompt.
      setCurrent(s.prompt());
      setBusy(false);
    }
  }

  function browse(step: -1 | 1) {
    if (history.length === 0) return;
    const next = cursor === null ? (step === -1 ? history.length - 1 : null) : cursor + step;
    if (next === null || next >= history.length) {
      setCursor(null);
      setLine("");
      return;
    }
    const index = Math.max(0, next);
    setCursor(index);
    setLine(history[index] ?? "");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "ArrowUp" && !question) {
      event.preventDefault();
      browse(-1);
    } else if (event.key === "ArrowDown" && !question) {
      event.preventDefault();
      browse(1);
    } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setEntries([]);
    } else if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      append({ kind: "output", chunk: { text: (question ? question.text : "") + line + "^C\n" } });
      question?.resolve("");
      setQuestion(null);
      setLine("");
    }
  }

  return (
    <div className={styles.window}>
      <div className={styles.bar}>
        <span className={`${styles.tab} ${current?.isRoot ? styles.tabRoot : ""}`}>
          <span className={styles.tabNumber}>1</span>
          <span className={styles.tabTitle}>
            {current ? `${current.user}@${current.host}: ${current.path}` : m.terminalLabel}
          </span>
        </span>
        <span className={styles.spacer} />
        <span className={styles.controls} role="img" aria-label={m.windowControls}>
          <i />
          <i />
          <i className={styles.closeControl} />
        </span>
      </div>
      <div className={styles.terminal} onClick={() => input.current?.focus()}>
        {!ready ? (
          <p className={styles.loading} role="status">
            {m.loadingTerminal}
          </p>
        ) : (
          <>
            <pre className={styles.screen} role="log" aria-live="polite" aria-label={m.terminalLabel}>
              {entries.map((entry, i) =>
                entry.kind === "command" ? (
                  <span key={i}>
                    <PromptView prompt={entry.prompt} />
                    {entry.command + "\n"}
                  </span>
                ) : (
                  <span key={i} className={entry.chunk.tone ? styles[entry.chunk.tone] : undefined}>
                    {entry.chunk.text}
                  </span>
                ),
              )}
            </pre>
            <label className={styles.inputRow}>
              {question ? (
                <span className={styles.prompt}>{question.text}</span>
              ) : (
                current && <PromptView prompt={current} />
              )}
              <input
                ref={input}
                className={styles.input}
                type={question?.hidden ? "password" : "text"}
                value={line}
                onChange={(e) => setLine(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
                aria-label={question?.hidden ? m.hiddenInput : m.inputLabel}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          </>
        )}
      </div>
      <ul className={styles.shortcuts} aria-label={m.shortcutsLabel}>
        {m.shortcuts.map(([keys, action]) => (
          <li key={action}>
            {keys.map((key, i) => (
              <span key={key}>
                {i > 0 && (keys[0] === "Ctrl" ? "+" : " ")}
                <kbd>{key}</kbd>
              </span>
            ))}{" "}
            {action}
          </li>
        ))}
      </ul>
      {edit && (
        <NanoDialog
          request={edit.request}
          onClose={(saved) => {
            edit.resolve(saved);
            setEdit(null);
          }}
        />
      )}
    </div>
  );
});
