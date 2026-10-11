"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/Alert/Alert";
import { Button } from "@/components/Button/Button";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { downloadText, exportFilename, manifestSize, reportToText, transcriptFile, transcriptFilename, verifyEngine, type CaseResult, type ConformanceProgress, type ConformanceReport, type SuiteResult, type VerifyOptions } from "@/engine/conformance";
import { messages } from "@/messages/pt-BR";
import styles from "./EngineConformance.module.scss";

type Verify = (onProgress?: (progress: ConformanceProgress) => void, options?: VerifyOptions) => Promise<ConformanceReport>;


type State =
  | { phase: "idle" }
  | { phase: "running"; progress: ConformanceProgress | null }
  | { phase: "error"; reason: string }
  | { phase: "done"; report: ConformanceReport };

/**
 * The verification of the engine (SPEC-030): it runs when the screen opens, one click on the header is all the administrator does, and the seal
 * of conformance only appears when every case ran and passed (RN-06). An error of the engine shows the error, never a seal.
 */
export function EngineConformance({
  verify = verifyEngine,
  copyText = (text: string) => navigator.clipboard.writeText(text),
  download = downloadText,
}: {
  verify?: Verify;
  copyText?: (text: string) => Promise<void>;
  download?: (filename: string, text: string) => void;
}) {
  const c = messages.conformance;
  // Nothing runs when the screen opens: the administrator chooses to start (CA-03). `run` counts the runs, and zero is none yet.
  const [state, setState] = useState<State>({ phase: "idle" });
  const [run, setRun] = useState(0);
  const [onlyFailures, setOnlyFailures] = useState(true);
  const [search, setSearch] = useState("");
  // The terminal is drawn here, in front of the administrator, while the cases run, always at the fastest speed and with the typing animation on (RN-15).
  const terminal = useRef<HTMLDivElement>(null);
  // The window stays open after the run so its history can be read and copied (RN-16); it closes when the screen runs again or goes away.
  const opened = useRef<TerminalWindow | null>(null);
  useEffect(() => {
    if (run === 0) return;
    let active = true;
    verify((progress) => active && setState({ phase: "running", progress }), {
      host: terminal.current ?? undefined,
      onWindow: (win) => {
        opened.current = win;
      },
    })
      .then((report) => active && setState({ phase: "done", report }))
      .catch((error: unknown) => active && setState({ phase: "error", reason: error instanceof Error ? error.message : String(error) }));
    return () => {
      active = false;
      opened.current?.destroy();
      opened.current = null;
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
        {state.phase !== "idle" && (
          <Button variant="secondary" onClick={again} disabled={state.phase === "running"}>
            {c.runAgain}
          </Button>
        )}
      </header>
      {state.phase === "idle" && (
        <div className={styles.stack}>
          <p className={styles.intro}>{c.idleText(manifestSize.suites, manifestSize.cases)}</p>
          <div>
            <Button onClick={again}>{c.start}</Button>
          </div>
        </div>
      )}
      {state.phase === "running" && <Running progress={state.progress} />}
      {state.phase === "error" && (
        <div className={styles.stack}>
          <Alert tone="danger">{c.engineError(state.reason)}</Alert>
          <div>
            <Button onClick={again}>{c.retry}</Button>
          </div>
        </div>
      )}
      {state.phase === "done" && (
        <Result key={run} report={state.report} copyText={copyText} download={download} onlyFailures={onlyFailures} setOnlyFailures={setOnlyFailures} search={search} setSearch={setSearch} />
      )}
      {state.phase === "done" && <p className={styles.hint}>{c.terminalHint}</p>}
      <div ref={terminal} className={styles.terminal} hidden={state.phase === "error" || state.phase === "idle"} role="region" aria-label={c.terminalLabel} />
    </section>
  );
}

function Running({ progress }: { progress: ConformanceProgress | null }) {
  const c = messages.conformance;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  // The screen reader hears every 10%, not every case.
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
  copyText,
  download,
  onlyFailures,
  setOnlyFailures,
  search,
  setSearch,
}: {
  report: ConformanceReport;
  copyText: (text: string) => Promise<void>;
  download: (filename: string, text: string) => void;
  onlyFailures: boolean;
  setOnlyFailures: (value: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  const c = messages.conformance;
  const problems = report.casesFailed + report.uncovered.length;
  // With failures the list starts on them (CA-15); with none the filter would hide everything, so it shows all.
  const filterFailures = onlyFailures && report.failed > 0;
  // The suites that failed start open (CA-18); the administrator opens and closes the others.
  const [opened, setOpened] = useState<Record<string, boolean>>(() => Object.fromEntries(report.suites.filter((s) => !s.passed).map((s) => [s.suite.name, true])));
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return report.suites
      .filter((result) => !filterFailures || !result.passed)
      .filter((result) => !term || result.suite.name.toLowerCase().includes(term) || result.cases.some((test) => test.command.toLowerCase().includes(term)))
      .sort((a, b) => Number(a.passed) - Number(b.passed))
      .map((result) => ({ result, shown: casesShown(result, filterFailures, term) }));
  }, [report, filterFailures, search]);
  // Copying and exporting the commands, to send the ones that failed (RN-17).
  const [copied, setCopied] = useState<"all" | "failures" | "error" | null>(null);
  const copy = async (which: "all" | "failures") => {
    try {
      await copyText(reportToText(report, which === "failures"));
      setCopied(which);
    } catch {
      setCopied("error");
    }
  };
  const setAll = (value: boolean) => setOpened(Object.fromEntries(rows.map(({ result }) => [result.suite.name, value])));
  const downloadCommands = (which: "all" | "failures") => download(exportFilename(which === "all" ? "comandos" : "falhas"), reportToText(report, which === "failures"));

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
          <dt>{c.totals.suites}</dt>
          <dd>{report.suites.length}</dd>
        </div>
        <div>
          <dt>{c.totals.cases}</dt>
          <dd>{report.casesPassed + report.casesFailed}</dd>
        </div>
        <div>
          <dt>{c.totals.passed}</dt>
          <dd>{report.casesPassed}</dd>
        </div>
        <div>
          <dt>{c.totals.failed}</dt>
          <dd>{report.casesFailed}</dd>
        </div>
      </dl>
      {report.uncovered.length > 0 && <Alert tone="danger">{c.uncovered(report.uncovered)}</Alert>}
      <div className={styles.exportBar}>
        <Button onClick={() => void copy("all")}>{c.copyAll}</Button>
        <Button variant="secondary" onClick={() => void copy("failures")} disabled={report.casesFailed === 0}>
          {c.copyFailures}
        </Button>
        <Button variant="secondary" onClick={() => downloadCommands("all")}>
          {c.downloadAll}
        </Button>
        <Button variant="secondary" onClick={() => downloadCommands("failures")} disabled={report.casesFailed === 0}>
          {c.downloadFailures}
        </Button>
        <Button variant="secondary" onClick={() => download(transcriptFilename(), transcriptFile(report))}>
          {c.downloadTerminal}
        </Button>
        <span role="status" className={styles.copied}>
          {copied === "error" ? c.copyFailed : copied ? c.copied(copied === "all" ? c.copyAll : c.copyFailures) : ""}
        </span>
      </div>
      <div className={styles.filters}>
        <label className={styles.check}>
          <input type="checkbox" checked={filterFailures} disabled={report.failed === 0} onChange={(event) => setOnlyFailures(event.target.checked)} />
          {c.onlyFailures}
        </label>
        <label className={styles.search}>
          <span>{c.searchLabel}</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <Button variant="secondary" onClick={() => setAll(true)}>
          {c.openAll}
        </Button>
        <Button variant="secondary" onClick={() => setAll(false)}>
          {c.closeAll}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{c.noRows}</p>
      ) : (
        <ul className={styles.suites} aria-label={c.listLabel}>
          {rows.map(({ result, shown }) => (
            <Suite key={`${result.suite.kind}-${result.suite.name}`} result={result} shown={shown} open={Boolean(opened[result.suite.name])} onToggle={() => setOpened((now) => ({ ...now, [result.suite.name]: !now[result.suite.name] }))} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The cases of a suite the screen lists: with "only failures" the ones that failed, and with a search the ones that match it (the whole suite when its name does; RN-20). */
const casesShown = (result: SuiteResult, onlyFailures: boolean, term: string): CaseResult[] => {
  const byName = !term || result.suite.name.toLowerCase().includes(term);
  return result.cases.filter((test) => (!onlyFailures || !test.passed) && (byName || test.command.toLowerCase().includes(term)));
};

function Suite({ result, shown, open, onToggle }: { result: SuiteResult; shown: CaseResult[]; open: boolean; onToggle: () => void }) {
  const c = messages.conformance;
  const { suite, passed, cases } = result;
  const panel = `suite-${suite.kind}-${suite.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return (
    <li className={`${styles.suite} ${passed ? "" : styles.suiteFailed}`}>
      <button type="button" className={styles.suiteHead} aria-expanded={open} aria-controls={panel} aria-label={c.toggle(suite.name)} onClick={onToggle}>
        <span aria-hidden="true" className={styles.chevron}>
          {open ? "▾" : "▸"}
        </span>
        <span className={styles.name}>{suite.name}</span>
        <span className={styles.meta}>
          {suite.kind === "command" ? c.kind.command : c.kind.program} · {suite.group}
        </span>
        <span className={styles.count}>{c.suiteCount(cases.filter((test) => test.passed).length, cases.length)}</span>
        {shown.length !== cases.length && <span className={styles.count}>{c.suiteShowing(shown.length, cases.length)}</span>}
        <span className={passed ? styles.ok : styles.fail}>
          <span aria-hidden="true">{passed ? "✓ " : "✕ "}</span>
          {passed ? c.state.passed : c.state.failed}
        </span>
      </button>
      {open && (
        <ol id={panel} className={styles.cases} aria-label={c.casesLabel(suite.name)}>
          {shown.map((test, index) => (
            <Case key={`${index}-${test.command}`} test={test} />
          ))}
        </ol>
      )}
    </li>
  );
}

function Case({ test }: { test: CaseResult }) {
  const c = messages.conformance;
  return (
    <li className={styles.case}>
      <div className={styles.caseHead}>
        <code className={styles.command}>{test.command}</code>
        <span className={test.passed ? styles.ok : styles.fail}>
          <span aria-hidden="true">{test.passed ? "✓ " : "✕ "}</span>
          {test.passed ? c.state.passed : c.state.failed}
        </span>
      </div>
      <p className={styles.expected}>
        {c.case.expected}: {test.expected} · {c.case.status(test.status)}
      </p>
      <details open={!test.passed}>
        <summary>{c.case.output}</summary>
        <pre className={styles.output}>{test.output || c.case.empty}</pre>
        {test.truncated && <p className={styles.expected}>{c.case.truncated}</p>}
      </details>
    </li>
  );
}
