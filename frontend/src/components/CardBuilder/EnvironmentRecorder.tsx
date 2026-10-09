"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "@/components/TopicStudy/TerminalPane";
import type { CardEnvironment } from "@/lib/cardModel";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { ContentAuthoringService } from "@/services/contentAuthoringService";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder.environment;

interface EnvironmentRecorderProps {
  moduleId: string;
  environment?: CardEnvironment;
  /** The card has a title, which is where the environment is kept. */
  hasTitle: boolean;
  /** The machine the author starts from: the previous environment or the topic scenario (null for the default one). */
  loadBase: () => Promise<unknown>;
  onChange: (environment: CardEnvironment | undefined) => void;
  service: Pick<ContentAuthoringService, "createEnvironment">;
}

/**
 * Prepares the environment of a card (SPEC-020): opens the terminal of the application, lets the
 * author run commands (create folders, files, users, groups, settings) and records the final state
 * of the machine. The commands typed in terminal 1 are listed for consulting.
 */
export function EnvironmentRecorder({ moduleId, environment, hasTitle, loadBase, onChange, service }: EnvironmentRecorderProps) {
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<{ machine: unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const [summary, setSummary] = useState(environment?.summary ?? "");
  const [commands, setCommands] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminal = useRef<TerminalWindow | null>(null);
  const started = useRef(0);
  // The base is read when the terminal opens; a counter restarts the load on each opening.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadBase()
      .then((machine) => active && setBase({ machine }))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
    // loadBase is built by the parent each render; the opening (attempt) is what restarts the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  const start = () => {
    setBase(null);
    setReady(false);
    setFailed(false);
    setError(null);
    setCommands([]);
    setSummary(environment?.summary ?? "");
    setAttempt((n) => n + 1);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setBase(null);
    terminal.current = null;
  };

  const record = async () => {
    const win = terminal.current;
    if (!win) return;
    setRecording(true);
    setError(null);
    try {
      const scenarioId = await service.createEnvironment(moduleId, win.snapshot());
      onChange({ scenarioId, summary: summary.trim(), commands: win.history().slice(started.current) });
      close();
    } catch {
      setError(m.recordFailed);
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className={styles.environment}>
      <p className={styles.hint}>{m.help}</p>

      {!open && !environment && (
        <>
          <button type="button" className={styles.add} onClick={start} disabled={!hasTitle}>
            {m.open}
          </button>
          {!hasTitle && <p className={styles.hint}>{m.needsTitle}</p>}
        </>
      )}

      {!open && environment && (
        <div className={styles.item}>
          <p className={styles.recorded} role="status">
            {m.recorded(environment.commands.length)}
          </p>
          {environment.summary && (
            <p>
              <b>{m.summary}:</b> {environment.summary}
            </p>
          )}
          {environment.commands.length > 0 && (
            <details className={styles.advanced}>
              <summary>{m.commandsTitle}</summary>
              <ol className={styles.commandList}>
                {environment.commands.map((c, i) => (
                  <li key={i}>
                    <code>{c}</code>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className={styles.rowButtons}>
            <button type="button" className={styles.add} onClick={start}>
              {m.again}
            </button>
            <button type="button" className={styles.danger} onClick={() => onChange(undefined)}>
              {m.remove}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className={styles.recorder}>
          {failed && (
            <p className={styles.error} role="alert">
              {m.loadFailed}
            </p>
          )}
          {!base && !failed && <p className={styles.hint}>{m.loading}</p>}
          {base && (
            <div className={styles.terminalBox}>
              <TerminalPane
                key={attempt}
                snapshot={base.machine}
                onReady={(win) => {
                  terminal.current = win;
                  started.current = win.history().length;
                  setReady(true);
                }}
                onCommand={() => setCommands(terminal.current ? terminal.current.history().slice(started.current) : [])}
              />
            </div>
          )}

          <div className={styles.recorderSide}>
            <h4 className={styles.groupTitle}>{m.commandsTitle}</h4>
            {commands.length === 0 ? (
              <p className={styles.hint}>{m.noCommands}</p>
            ) : (
              <ol className={styles.commandList}>
                {commands.map((c, i) => (
                  <li key={i}>
                    <code>{c}</code>
                  </li>
                ))}
              </ol>
            )}
            <p className={styles.hint}>{m.otherTerminals}</p>
            <label className={styles.label} htmlFor="env-summary">
              {m.summaryLabel}
            </label>
            <input id="env-summary" className={styles.input} value={summary} placeholder={m.summaryPlaceholder} onChange={(e) => setSummary(e.target.value)} />
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <div className={styles.rowButtons}>
              <button type="button" className={styles.secondary} onClick={close}>
                {m.cancel}
              </button>
              <button type="button" className={styles.primary} onClick={() => void record()} disabled={!ready || recording}>
                {recording ? m.recording : m.record}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
