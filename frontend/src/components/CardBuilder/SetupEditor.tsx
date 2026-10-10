"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "@/components/TopicStudy/TerminalPane";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { accountName, isCompleteMode, octalMode } from "@/lib/inputs";
import { bytesOf, emptySetup, MAX_FILE_BYTES, type Setup, type SetupFile, type SetupLayer, type SetupStep } from "@/lib/setup";
import { writtenFile } from "@/lib/setupContent";
import { reconcile, type MachineTree } from "@/lib/machineDiff";
import { replayMachine } from "@/lib/machineReplay";
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
  /**
   * Called with the snapshot after the commands typed in the terminal were adopted and checked against the terminal; when
   * `deriveFrom` is set it also gets the machine before what was recorded (the layers that come before) and the one after.
   */
  onAdopted?: (setup: Setup, machines?: { before: MachineTree; after: MachineTree }) => void;
  /** Asks for the machines before and after, to work out what changed (it builds one more machine). */
  deriveFrom?: boolean;
  /** The text of the button that opens the terminal. */
  recordLabel?: string;
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
export function SetupEditor({ setup, help, onChange, onAdopted, deriveFrom, recordLabel, loadBase, before, errors = {} }: SetupEditorProps) {
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
  const [checking, setChecking] = useState(false);
  const terminal = useRef<TerminalWindow | null>(null);
  const started = useRef(0);
  /** The machine the author started from, to build the same one again when checking the result. */
  const baseMachine = useRef<unknown>(null);
  const latest = useRef({ before, loadBase, steps: current });
  useEffect(() => {
    latest.current = { before, loadBase, steps: current };
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    latest
      .current.loadBase()
      .then((machine) => {
        if (!active) return;
        baseMachine.current = machine;
        setBase({ machine });
      })
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

  // The machine is prepared before the author types anything: the earlier snapshots and then the commands
  // already on this list, so a new command goes on top of what the list builds.
  const prepare = async (win: TerminalWindow) => {
    terminal.current = win;
    const own = latest.current.steps;
    const layers = own.steps.length > 0 ? [...latest.current.before, { id: "own", kind: "card" as const, label: m.ownLayer, setup: own }] : latest.current.before;
    const results = await runLayers(win, layers);
    setConflicts(results.filter(isConflict));
    started.current = win.history().length;
    setReady(true);
  };

  const setFiles = (files: SetupFile[]) => onChange({ ...current, files });
  const patchFile = (index: number, change: Partial<SetupFile>) => setFiles((current.files ?? []).map((f, i) => (i === index ? { ...f, ...change } : f)));
  const [uploadError, setUploadError] = useState<string | null>(null);

  // A file of the author's computer, as text: a script, a log, a page.
  const uploadFile = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = "";
    setUploadError(null);
    if (!chosen) return;
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(chosen);
      });
      if (content.includes(String.fromCharCode(0))) return setUploadError(m.uploadBinary(chosen.name));
      if (bytesOf(content) > MAX_FILE_BYTES) return setUploadError(m.uploadTooBig(chosen.name));
      const path = `/${chosen.name}`;
      const others = (current.files ?? []).filter((f) => f.path !== path);
      setFiles([...others, { path, content }]);
    } catch {
      setUploadError(m.uploadFailed(chosen.name));
    }
  };

  // The snapshot has to leave the student's machine exactly as the author left this one. What was typed inside an editor is
  // not a command, so those sessions are left out of the list; both machines are compared, and what the commands do not
  // reproduce (the text of a file, a permission, an owner) is added: files as data, the rest as commands.
  const adoptTyped = async () => {
    const win = terminal.current;
    setConverting(true);
    const notes: string[] = [];
    const kept = typed.filter((command) => writtenFile(command) === undefined);
    const editors = typed.length - kept.length;
    const list: SetupStep[] = [...current.steps, ...kept.map((command) => ({ command }))];
    const files: SetupFile[] = [...(current.files ?? [])];
    let machines: { before: MachineTree; after: MachineTree } | undefined;
    const recorded = typeof win?.snapshot === "function" ? win.snapshot() : undefined;
    close();
    if (editors > 0) notes.push(m.editorsLeftOut(editors));
    if (recorded !== undefined) {
      setChecking(true);
      try {
        const own = { id: "own", kind: "card" as const, label: m.ownLayer, setup: { summary: current.summary, steps: list, files } };
        const replayed = await replayMachine(baseMachine.current, [...latest.current.before, own]);
        const result = reconcile(recorded as MachineTree, replayed as MachineTree);
        list.push(...result.steps);
        for (const file of result.files) {
          const at = files.findIndex((f) => f.path === file.path);
          if (at >= 0) files[at] = file;
          else files.push(file);
        }
        if (result.steps.length + result.files.length > 0) notes.push(m.reconciled(result.steps.length, result.files.length));
        for (const text of result.inexact) notes.push(m.inexact(text));
        if (deriveFrom) machines = { before: (await replayMachine(baseMachine.current, latest.current.before)) as MachineTree, after: recorded as MachineTree };
      } catch {
        notes.push(m.notChecked);
      }
      setChecking(false);
    } else if (editors > 0) {
      notes.push(m.notChecked);
    }
    const adopted: Setup = { ...current, steps: list, ...(files.length > 0 ? { files } : {}) };
    onChange(adopted);
    setNotice(notes);
    setConverting(false);
    onAdopted?.(adopted, machines);
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

      {checking && (
        <p className={styles.hint} role="status">
          {m.checking}
        </p>
      )}
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

      <div className={styles.item}>
        <div className={styles.itemHead}>
          <span className={styles.itemTitle}>{m.filesTitle(current.files?.length ?? 0)}</span>
          <div className={styles.rowButtons}>
            <button type="button" className={styles.add} onClick={() => setFiles([...(current.files ?? []), { path: "", content: "" }])}>
              {m.addFile}
            </button>
            <label className={styles.add}>
              {m.uploadFile}
              <input type="file" hidden aria-label={m.uploadFile} onChange={(e) => void uploadFile(e.target)} />
            </label>
          </div>
        </div>
        <p className={styles.hint}>{m.filesHelp}</p>
        {uploadError && (
          <p className={styles.error} role="alert">
            {uploadError}
          </p>
        )}
        {(current.files?.length ?? 0) > 0 && (
          <ul className={styles.fileList} aria-label={m.filesTitle(current.files!.length)}>
            {current.files!.map((file, i) => (
              <li key={i}>
                <details className={styles.advanced}>
                  <summary>
                    <code>{file.path || m.noPath}</code> · {m.fileSize(bytesOf(file.content))}
                    {file.mode ? ` · ${file.mode}` : ""}
                    {file.owner ? ` · ${file.owner}:${file.group ?? ""}` : ""}
                  </summary>
                  <div className={styles.pair}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`setup-file-path-${i}`}>
                        {m.filePath} ({i + 1})
                      </label>
                      <input id={`setup-file-path-${i}`} className={`${styles.input} ${styles.mono}`} value={file.path} placeholder="/home/ricardo/financeiro/teste.sh" onChange={(e) => patchFile(i, { path: e.target.value })} aria-invalid={file.path !== "" && !file.path.startsWith("/")} />
                      {file.path !== "" && !file.path.startsWith("/") && <p className={styles.error}>{m.pathInvalid}</p>}
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`setup-file-mode-${i}`}>
                        {m.fileMode} ({i + 1})
                      </label>
                      <input
                        id={`setup-file-mode-${i}`}
                        className={`${styles.input} ${styles.mono}`}
                        value={file.mode ?? ""}
                        placeholder="644"
                        inputMode="numeric"
                        maxLength={4}
                        autoComplete="off"
                        aria-invalid={!isCompleteMode(file.mode ?? "")}
                        onChange={(e) => patchFile(i, { mode: octalMode(e.target.value) })}
                      />
                      {!isCompleteMode(file.mode ?? "") && <p className={styles.error}>{m.modeInvalid}</p>}
                    </div>
                  </div>
                  <div className={styles.pair}>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`setup-file-owner-${i}`}>
                        {m.fileOwner} ({i + 1})
                      </label>
                      <input id={`setup-file-owner-${i}`} className={styles.input} value={file.owner ?? ""} placeholder="root" maxLength={32} autoComplete="off" onChange={(e) => patchFile(i, { owner: accountName(e.target.value) })} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`setup-file-group-${i}`}>
                        {m.fileGroup} ({i + 1})
                      </label>
                      <input id={`setup-file-group-${i}`} className={styles.input} value={file.group ?? ""} placeholder="root" maxLength={32} autoComplete="off" onChange={(e) => patchFile(i, { group: accountName(e.target.value) })} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`setup-file-content-${i}`}>
                      {m.fileContent} ({i + 1})
                    </label>
                    <textarea id={`setup-file-content-${i}`} className={`${styles.input} ${styles.mono}`} rows={14} spellCheck={false} value={file.content} onChange={(e) => patchFile(i, { content: e.target.value })} />
                    {bytesOf(file.content) > MAX_FILE_BYTES && <p className={styles.error}>{m.fileTooBig}</p>}
                  </div>
                  <button type="button" className={styles.danger} onClick={() => setFiles(current.files!.filter((_, j) => j !== i))} aria-label={m.removeFile(file.path)}>
                    {m.removeFileShort}
                  </button>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!open && (
        <div className={styles.rowButtons}>
          <button type="button" className={styles.add} onClick={() => patch([...current.steps, { command: "" }])}>
            {m.add}
          </button>
          <button type="button" className={styles.add} onClick={start}>
            {recordLabel ?? m.record}
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
