"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "@/components/TopicStudy/TerminalPane";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { emptySetup, type Setup, type SetupLayer, type SetupStep } from "@/lib/setup";
import { isPlainText, printfSteps, shellQuote, writtenFile } from "@/lib/setupContent";
import { isConflict, runLayers, type StepResult } from "@/lib/setupRunner";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder.setup;
const NEWLINE = String.fromCharCode(10);

interface SetupEditorProps {
  setup?: Setup;
  /** Messages of the place it is used (the card or the module); the default is the card's. */
  help?: string;
  onChange: (setup: Setup | undefined) => void;
  /** The machine the author starts from: the topic scenario (null for the default one). */
  loadBase: () => Promise<unknown>;
  /** The snapshots that run before this one: the module and the earlier cards. */
  before: SetupLayer[];
  /** Server errors by field, keyed `setup-<step>`. */
  errors?: Record<string, string[]>;
}

function StepRow({ step, index, total, onChange, onMove, onRemove }: { step: SetupStep; index: number; total: number; onChange: (patch: Partial<SetupStep>) => void; onMove: (to: number) => void; onRemove: () => void }) {
  const n = index + 1;
  const label = (text: string) => `${text} (${n})`;
  return (
    <div className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>{m.item(n)}</span>
        <div className={styles.tools}>
          <button type="button" className={styles.small} onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={label(m.up)}>
            ↑
          </button>
          <button type="button" className={styles.small} onClick={() => onMove(index + 1)} disabled={index === total - 1} aria-label={label(m.down)}>
            ↓
          </button>
          <button type="button" className={styles.small} onClick={onRemove} aria-label={label(m.remove)}>
            ✕
          </button>
        </div>
      </div>
      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`setup-terminal-${index}`}>
            {label(m.terminal)}
          </label>
          <select id={`setup-terminal-${index}`} className={styles.input} value={step.terminal ?? 1} onChange={(e) => onChange({ terminal: Number(e.target.value) })}>
            {[1, 2, 3].map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`setup-command-${index}`}>
            {label(m.command)}
          </label>
          <input id={`setup-command-${index}`} className={`${styles.input} ${styles.mono}`} value={step.command} placeholder="mkdir /financeiro" onChange={(e) => onChange({ command: e.target.value })} />
        </div>
      </div>
      <details className={styles.advanced}>
        <summary>{label(m.advanced)}</summary>
        <div className={styles.pair}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`setup-user-${index}`}>
              {label(m.user)}
            </label>
            <input id={`setup-user-${index}`} className={styles.input} value={step.login?.user ?? ""} onChange={(e) => onChange({ login: { user: e.target.value, password: step.login?.password ?? "" } })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`setup-password-${index}`}>
              {label(m.password)}
            </label>
            <input id={`setup-password-${index}`} className={styles.input} value={step.login?.password ?? ""} onChange={(e) => onChange({ login: { user: step.login?.user ?? "", password: e.target.value } })} />
          </div>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`setup-answers-${index}`}>
            {label(m.answers)}
          </label>
          <textarea id={`setup-answers-${index}`} className={styles.input} rows={2} value={(step.answers ?? []).join(NEWLINE)} onChange={(e) => onChange({ answers: e.target.value === "" ? [] : e.target.value.split(NEWLINE) })} />
        </div>
      </details>
    </div>
  );
}

/**
 * The snapshot of a card or of a module (SPEC-021): the commands that prepare the machine of the
 * student. They are typed in the list or recorded in the terminal of the application, which first
 * replays the snapshots that come before, so the author sees the machine the student will have.
 */
export function SetupEditor({ setup, help, onChange, loadBase, before, errors = {} }: SetupEditorProps) {
  const current = setup ?? emptySetup();
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<{ machine: unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [typed, setTyped] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<StepResult[]>([]);
  const [notice, setNotice] = useState<string[]>([]);
  const [converting, setConverting] = useState(false);
  const terminal = useRef<TerminalWindow | null>(null);
  const started = useRef(0);
  const latest = useRef({ before, loadBase });
  useEffect(() => {
    latest.current = { before, loadBase };
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    latest
      .current.loadBase()
      .then((machine) => active && setBase({ machine }))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [open, attempt]);

  const patch = (steps: SetupStep[]) => onChange({ ...current, steps });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= current.steps.length) return;
    const next = [...current.steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as SetupStep);
    patch(next);
  };

  const start = () => {
    setBase(null);
    setReady(false);
    setFailed(false);
    setTyped([]);
    setConflicts([]);
    setAttempt((n) => n + 1);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setBase(null);
    terminal.current = null;
  };

  // The machine is prepared with the earlier snapshots before the author types anything.
  const prepare = async (win: TerminalWindow) => {
    terminal.current = win;
    const results = await runLayers(win, latest.current.before);
    setConflicts(results.filter(isConflict));
    started.current = win.history().length;
    setReady(true);
  };

  // What was typed inside an editor is not a command: the text is read back from the file and kept as printf.
  const adoptTyped = async () => {
    const win = terminal.current;
    setConverting(true);
    const notes: string[] = [];
    const steps: SetupStep[] = [];
    for (const command of typed) {
      const path = writtenFile(command);
      if (!path || !win) {
        steps.push({ command });
        continue;
      }
      if (!path.startsWith("/")) {
        steps.push({ command });
        notes.push(m.relativePath(command));
        continue;
      }
      const { status, output } = await win.execute({ command: `cat ${shellQuote(path)}` });
      if (status !== 0 || !isPlainText(output)) {
        steps.push({ command });
        notes.push(m.notConverted(command));
        continue;
      }
      steps.push(...printfSteps(path, output));
      notes.push(m.converted(command, path));
    }
    patch([...current.steps, ...steps]);
    setNotice(notes);
    setConverting(false);
    close();
  };

  return (
    <div className={styles.environment}>
      <p className={styles.hint}>{help ?? m.help}</p>
      <p className={styles.hint}>{m.fileTips}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="setup-summary">
          {m.summaryLabel}
        </label>
        <input id="setup-summary" className={styles.input} value={current.summary} placeholder={m.summaryPlaceholder} onChange={(e) => onChange({ ...current, summary: e.target.value })} />
      </div>

      {notice.length > 0 && (
        <ul className={styles.commandList} role="status" aria-label={m.noticeLabel}>
          {notice.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}

      {current.steps.length === 0 && <p className={styles.hint}>{m.empty}</p>}
      {current.steps.map((step, i) => (
        <div key={i}>
          <StepRow step={step} index={i} total={current.steps.length} onChange={(change) => patch(current.steps.map((s, j) => (j === i ? { ...s, ...change } : s)))} onMove={(to) => move(i, to)} onRemove={() => patch(current.steps.filter((_, j) => j !== i))} />
          {errors[`setup-${i}`]?.map((reason) => (
            <p key={reason} className={styles.error} role="alert">
              {reason === "required" ? m.required : reason}
            </p>
          ))}
        </div>
      ))}

      {!open && (
        <div className={styles.rowButtons}>
          <button type="button" className={styles.add} onClick={() => patch([...current.steps, { command: "" }])}>
            {m.add}
          </button>
          <button type="button" className={styles.add} onClick={start}>
            {m.record}
          </button>
          {setup && (
            <button type="button" className={styles.danger} onClick={() => onChange(undefined)}>
              {m.removeAll}
            </button>
          )}
        </div>
      )}

      {open && (
        <div className={styles.recorder}>
          <div>
            {failed && (
              <p className={styles.error} role="alert">
                {m.loadFailed}
              </p>
            )}
            {!base && !failed && <p className={styles.hint}>{m.loading}</p>}
            {base && (
              <div className={styles.terminalBox}>
                <TerminalPane key={attempt} snapshot={base.machine} onReady={(win) => void prepare(win)} onCommand={() => setTyped(terminal.current ? terminal.current.history().slice(started.current) : [])} />
              </div>
            )}
          </div>

          <div className={styles.recorderSide}>
            <h4 className={styles.groupTitle}>{m.typedTitle}</h4>
            {base && !ready && <p className={styles.hint}>{m.replaying}</p>}
            {conflicts.length > 0 && (
              <div className={styles.error} role="alert">
                {conflicts.map((c) => (
                  <p key={`${c.layer.id}-${c.index}`}>{m.replayConflict(c.layer.label, c.step.command)}</p>
                ))}
              </div>
            )}
            {typed.length === 0 ? (
              <p className={styles.hint}>{m.noTyped}</p>
            ) : (
              <ol className={styles.commandList}>
                {typed.map((c, i) => (
                  <li key={i}>
                    <code>{c}</code>
                  </li>
                ))}
              </ol>
            )}
            <p className={styles.hint}>{m.otherTerminals}</p>
            <div className={styles.rowButtons}>
              <button type="button" className={styles.secondary} onClick={close}>
                {m.cancel}
              </button>
              <button type="button" className={styles.primary} onClick={() => void adoptTyped()} disabled={!ready || typed.length === 0 || converting}>
                {converting ? m.converting : m.useTyped}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
