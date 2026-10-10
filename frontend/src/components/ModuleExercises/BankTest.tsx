"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import modal from "@/components/ContentTab/CardModal.module.scss";
import { testBank, type BankItem, type BankReport, type Dependency } from "@/lib/bankTest";
import { createEngineSandbox } from "@/lib/bankTestEngine";
import { hasSetup, type Setup, type SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { ExerciseBank, ModuleExerciseService } from "@/services/moduleExerciseService";
import styles from "./BankTest.module.scss";

const m = authoringMessages.bankTest;

interface BankTestProps {
  moduleId: string;
  bank: ExerciseBank;
  moduleSetup?: Setup;
  /** The machine of the topic the tests start from. */
  loadBase: () => Promise<unknown>;
  service: Pick<ModuleExerciseService, "update">;
  onClose: () => void;
  /** Called after a dependency is confirmed, so the tab reads the bank again. */
  onChanged: () => void;
}

type State =
  | { kind: "preparing" }
  | { kind: "running"; done: number; total: number; phase: string }
  | { kind: "done"; report: BankReport }
  | { kind: "baseFailed"; steps: string[] }
  | { kind: "error" };

/** The published exercises of the bank in the order the test runs them: the trail first, then the rest. */
export function bankItems(bank: ExerciseBank): BankItem[] {
  const published = bank.items.filter((it) => it.status === "PUBLISHED");
  const trail = published.filter((it) => it.practice).sort((a, b) => a.position - b.position);
  return [...trail, ...published.filter((it) => !it.practice)].map((it) => ({
    id: it.exercise.id,
    title: it.exercise.title.trim() || it.exercise.id,
    dependsOn: it.dependsOn,
    solution: it.exercise.solution,
    conditions: it.exercise.conditions,
  }));
}

/**
 * "Testar Banco de Exercícios" (SPEC-023 12): builds the machine from the snapshot of the module and the one of the bank, runs the
 * three batteries in the browser of the teacher and shows the report, where the dependencies the test found can be confirmed.
 */
export function BankTest({ moduleId, bank, moduleSetup, loadBase, service, onClose, onChanged }: BankTestProps) {
  const titleId = useId();
  const [state, setState] = useState<State>({ kind: "preparing" });
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [problem, setProblem] = useState(false);
  const latest = useRef({ bank, moduleSetup, loadBase });
  // Kept for the run to read, so a change in the bank while it runs does not start it over.
  useEffect(() => {
    latest.current = { bank, moduleSetup, loadBase };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    let destroy = () => {};
    void (async () => {
      try {
        const { bank: current, moduleSetup: moduleSnapshot, loadBase: base } = latest.current;
        const layers: SetupLayer[] = [
          ...(hasSetup(moduleSnapshot) ? [{ id: "module", kind: "module" as const, label: "Módulo", setup: moduleSnapshot }] : []),
          ...(hasSetup(current.bankSetup) ? [{ id: "bank", kind: "card" as const, label: authoringMessages.moduleExercisePage.bankLayer, setup: current.bankSetup }] : []),
        ];
        const engine = await createEngineSandbox(await base(), layers);
        destroy = engine.destroy;
        if (!active) return;
        if (!engine.sandbox) {
          setState({ kind: "baseFailed", steps: engine.conflicts.map((c) => m.baseStep(c.layer.label, c.step.command)) });
          return;
        }
        const report = await testBank(bankItems(current), engine.sandbox, {
          onProgress: (done, total, label) => {
            if (active) setState({ kind: "running", done, total, phase: m.phases[label as keyof typeof m.phases] ?? label });
          },
        });
        if (active) setState({ kind: "done", report });
      } catch {
        if (active) setState({ kind: "error" });
      } finally {
        destroy();
      }
    })();
    return () => {
      active = false;
      destroy();
    };
  }, [attempt]);

  const titles = useMemo(() => new Map(bank.items.map((it) => [it.exercise.id, it.exercise.title.trim() || it.exercise.id])), [bank]);
  const title = (id: string) => titles.get(id) ?? id;

  const confirm = async (dependency: Dependency) => {
    setProblem(false);
    const it = bank.items.find((x) => x.exercise.id === dependency.id);
    if (!it) return;
    try {
      await service.update(moduleId, dependency.id, it.exercise, it.updatedAt, false, dependency.on);
      setConfirmed((c) => [...c, dependency.id]);
      onChanged();
    } catch {
      setProblem(true);
    }
  };

  const again = () => {
    setState({ kind: "preparing" });
    setDismissed([]);
    setConfirmed([]);
    setAttempt((n) => n + 1);
  };

  const list = (ids: string[]) =>
    ids.length === 0 ? (
      <p className={styles.none}>{m.none}</p>
    ) : (
      <ul className={styles.list}>
        {ids.map((id) => (
          <li key={id}>{title(id)}</li>
        ))}
      </ul>
    );

  const report = state.kind === "done" ? state.report : null;
  const suggested = report?.suggested.filter((s) => !dismissed.includes(s.id) && !confirmed.includes(s.id)) ?? [];

  return createPortal(
    <div className={modal.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={modal.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={modal.head}>
          <h3 id={titleId} className={modal.kicker}>
            {m.title}
          </h3>
          <button type="button" className={modal.close} onClick={onClose}>
            {m.close}
          </button>
        </div>
        <div className={modal.body}>
          {state.kind === "preparing" && <p role="status">{m.preparing}</p>}
          {state.kind === "running" && (
            <p role="status">
              {m.running(state.done, state.total, state.phase)}
            </p>
          )}
          {state.kind === "error" && <p role="alert">{m.loadFailed}</p>}
          {state.kind === "baseFailed" && (
            <div role="alert">
              <p>{m.baseFailed}</p>
              <ul className={styles.list}>
                {state.steps.map((step, i) => (
                  <li key={i}>
                    <code>{step}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report && (
            <div className={styles.report}>
              {report.rounds.length > 0 && bankItems(bank).length === 0 ? (
                <p role="status">{m.empty}</p>
              ) : (
                <p role="status" className={report.status === "ok" ? styles.ok : styles.bad}>
                  <span aria-hidden="true">{report.status === "ok" ? "✅" : "❌"}</span> {report.status === "ok" ? m.ok : m.failed}
                </p>
              )}
              <p className={styles.seed}>{m.seed(report.seed)}</p>

              {report.untestable.length > 0 && (
                <section aria-label={m.untestable}>
                  <h4>{m.untestable}</h4>
                  {list(report.untestable)}
                </section>
              )}
              {report.conflicts.length > 0 && (
                <section aria-label={m.conflicts}>
                  <h4>{m.conflicts}</h4>
                  {list(report.conflicts)}
                </section>
              )}
              {report.isolated.length > 0 && (
                <section aria-label={m.isolated}>
                  <h4>{m.isolated}</h4>
                  {list(report.isolated)}
                </section>
              )}

              <section aria-label={m.dependencies}>
                <h4>{m.dependencies}</h4>
                <h5>{m.declared}</h5>
                {report.declared.length === 0 ? (
                  <p className={styles.none}>{m.none}</p>
                ) : (
                  <ul className={styles.list}>
                    {report.declared.map((d) => (
                      <li key={d.id}>{m.declaredLine(title(d.id), title(d.on))}</li>
                    ))}
                  </ul>
                )}
                <h5>{m.suggested}</h5>
                {suggested.length === 0 ? (
                  <p className={styles.none}>{m.none}</p>
                ) : (
                  <ul className={styles.list}>
                    {suggested.map((s) => (
                      <li key={s.id} className={styles.suggestion}>
                        <span>{m.suggestion(title(s.id), title(s.on))}</span>
                        <button type="button" className={styles.primary} onClick={() => void confirm(s)}>
                          {m.confirm}
                        </button>
                        <button type="button" className={styles.secondary} onClick={() => setDismissed((d) => [...d, s.id])}>
                          {m.dismiss}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {confirmed.length > 0 && <p role="status">{m.confirmed}</p>}
                {problem && <p role="alert">{m.confirmFailed}</p>}
              </section>

              <details>
                <summary>{m.rounds}</summary>
                <ol className={styles.rounds}>
                  {report.rounds.map((round, i) => (
                    <li key={i}>
                      <strong>{m.round(i + 1, m.phases[round.phase])}</strong>
                      <ul className={styles.list}>
                        {round.results.map((r) => (
                          <li key={r.id} className={r.ok ? styles.ok : styles.bad}>
                            <span aria-hidden="true">{r.ok ? "✅" : "❌"}</span> {title(r.id)} <span className={styles.none}>({r.ok ? m.passed : m.didNotPass})</span>
                          </li>
                        ))}
                        {round.pulled.map((p) => (
                          <li key={`${p.id}-${p.by}`} className={styles.none}>
                            {m.pulled(title(p.id), title(p.by))}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </div>
        {(state.kind === "done" || state.kind === "baseFailed" || state.kind === "error") && (
          <div className={modal.foot}>
            <button type="button" className={styles.secondary} onClick={again}>
              {m.again}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
