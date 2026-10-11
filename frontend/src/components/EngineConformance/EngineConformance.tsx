"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/Alert/Alert";
import { Button } from "@/components/Button/Button";
import { verifyEngine, type ConformanceProgress, type ConformanceReport, type ItemResult } from "@/engine/conformance";
import { messages } from "@/messages/pt-BR";
import styles from "./EngineConformance.module.scss";

type Verify = (onProgress?: (progress: ConformanceProgress) => void) => Promise<ConformanceReport>;

type State =
  | { phase: "running"; progress: ConformanceProgress | null }
  | { phase: "error"; reason: string }
  | { phase: "done"; report: ConformanceReport };

/**
 * The verification of the engine (SPEC-030): it runs when the screen opens, one click on the header is all the administrator does, and the seal
 * of conformance only appears when every item ran and passed (RN-06). An error of the engine shows the error, never a seal.
 */
export function EngineConformance({ verify = verifyEngine }: { verify?: Verify }) {
  const c = messages.conformance;
  const [state, setState] = useState<State>({ phase: "running", progress: null });
  const [run, setRun] = useState(0);
  const [onlyFailures, setOnlyFailures] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    verify((progress) => active && setState({ phase: "running", progress }))
      .then((report) => active && setState({ phase: "done", report }))
      .catch((error: unknown) => active && setState({ phase: "error", reason: error instanceof Error ? error.message : String(error) }));
    return () => {
      active = false;
    };
  }, [verify, run]);

  const again = () => {
    setState({ phase: "running", progress: null });
    setRun((n) => n + 1);
  };

  return (
    <section className={styles.container} aria-labelledby="conformance-title">
      <header className={styles.header}>
        <div>
          <h1 id="conformance-title" className={styles.title}>
            {c.title}
          </h1>
          <p className={styles.subtitle}>{c.subtitle}</p>
        </div>
        <Button variant="secondary" onClick={again} disabled={state.phase === "running"}>
          {c.runAgain}
        </Button>
      </header>
      {state.phase === "running" && <Running progress={state.progress} />}
      {state.phase === "error" && (
        <div className={styles.stack}>
          <Alert tone="danger">{c.engineError(state.reason)}</Alert>
          <div>
            <Button onClick={again}>{c.retry}</Button>
          </div>
        </div>
      )}
      {state.phase === "done" && <Result report={state.report} onlyFailures={onlyFailures} setOnlyFailures={setOnlyFailures} search={search} setSearch={setSearch} />}
    </section>
  );
}

function Running({ progress }: { progress: ConformanceProgress | null }) {
  const c = messages.conformance;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  // The screen reader hears every 10%, not every item.
  const announced = Math.floor(percent / 10) * 10;
  return (
    <div className={styles.stack}>
      <div
        className={`${styles.bar} ${progress ? "" : styles.indeterminate}`}
        role="progressbar"
        aria-label={c.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ? percent : undefined}
      >
        <div className={styles.barFill} style={progress ? { width: `${percent}%` } : undefined} />
      </div>
      <p className={styles.progressText}>{progress ? c.progress(progress.done, progress.total, progress.current) : c.preparing}</p>
      <p className={styles.srOnly} role="status" aria-live="polite">
        {progress ? c.progressAnnounce(announced) : c.preparing}
      </p>
    </div>
  );
}

function Result({
  report,
  onlyFailures,
  setOnlyFailures,
  search,
  setSearch,
}: {
  report: ConformanceReport;
  onlyFailures: boolean;
  setOnlyFailures: (value: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  const c = messages.conformance;
  const problems = report.failed + report.uncovered.length;
  // With failures the table starts on them (CA-15); with none the filter would hide everything, so it shows all.
  const filterFailures = onlyFailures && report.failed > 0;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...report.results]
      .filter((result) => (!filterFailures || !result.passed) && (!term || result.item.name.toLowerCase().includes(term)))
      .sort((a, b) => Number(a.passed) - Number(b.passed));
  }, [report, filterFailures, search]);

  return (
    <div className={styles.stack}>
      <div className={`${styles.seal} ${report.conformant ? styles.sealOk : styles.sealFail}`} role="status">
        <span aria-hidden="true" className={styles.sealIcon}>
          {report.conformant ? "✓" : "✕"}
        </span>
        <strong>{report.conformant ? c.conformant : c.nonConformant(problems)}</strong>
      </div>
      <dl className={styles.totals}>
        <div>
          <dt>{c.totals.checked}</dt>
          <dd>{report.results.length}</dd>
        </div>
        <div>
          <dt>{c.totals.passed}</dt>
          <dd>{report.passed}</dd>
        </div>
        <div>
          <dt>{c.totals.failed}</dt>
          <dd>{report.failed}</dd>
        </div>
      </dl>
      {report.uncovered.length > 0 && <Alert tone="danger">{c.uncovered(report.uncovered)}</Alert>}
      <div className={styles.filters}>
        <label className={styles.check}>
          <input type="checkbox" checked={filterFailures} disabled={report.failed === 0} onChange={(event) => setOnlyFailures(event.target.checked)} />
          {c.onlyFailures}
        </label>
        <label className={styles.search}>
          <span>{c.searchLabel}</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{c.noRows}</p>
      ) : (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={c.tableLabel}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{c.columns.name}</th>
                <th scope="col">{c.columns.kind}</th>
                <th scope="col">{c.columns.group}</th>
                <th scope="col">{c.columns.state}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((result) => (
                <Row key={`${result.item.kind}-${result.item.name}`} result={result} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ result }: { result: ItemResult }) {
  const c = messages.conformance;
  const { item, passed, failure } = result;
  return (
    <tr>
      <th scope="row" className={styles.name}>
        {item.name}
      </th>
      <td>{item.kind === "command" ? c.kind.command : c.kind.program}</td>
      <td>{item.group}</td>
      <td>
        <span className={passed ? styles.ok : styles.fail}>
          <span aria-hidden="true">{passed ? "✓ " : "✕ "}</span>
          {passed ? c.state.passed : c.state.failed}
        </span>
        {failure && (
          <dl className={styles.detail}>
            <dt>{c.detail.command}</dt>
            <dd>
              <code>{failure.command}</code>
            </dd>
            <dt>{c.detail.expected}</dt>
            <dd>{failure.expected}</dd>
            <dt>{c.detail.got}</dt>
            <dd>
              <code>{failure.got}</code>
            </dd>
          </dl>
        )}
      </td>
    </tr>
  );
}
