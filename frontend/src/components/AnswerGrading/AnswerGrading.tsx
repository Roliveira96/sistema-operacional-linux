"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Html } from "@/components/ContentRenderer/blocks";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import {
  gradingService as defaultService,
  SCORE_BANDS,
  type AnswerStatus,
  type DescriptiveAnswer,
  type GradeInput,
  type GradingService,
} from "@/services/gradingService";
import styles from "./AnswerGrading.module.scss";

const m = authoringMessages.grading;

type Filter = AnswerStatus | "all";
const FILTERS: Filter[] = ["all", "PENDING", "SUGGESTED", "GRADED"];

interface AnswerGradingProps {
  moduleId: string;
  service?: Pick<GradingService, "list" | "grade">;
}

type State = { status: "loading" } | { status: "failed" } | { status: "ready"; items: DescriptiveAnswer[] };

/**
 * The correction of the descriptive answers of a module (SPEC-039): the teacher reads each answer with the correct one and the suggestion
 * of the AI, and gives the grade, a band of the percentage of what is right, with a note to the student and a private note. Changing a
 * grade already given needs a reason.
 */
export function AnswerGrading({ moduleId, service = defaultService }: AnswerGradingProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    service
      .list(moduleId, filter)
      .then((items) => alive && setState({ status: "ready", items }))
      .catch(() => alive && setState({ status: "failed" }));
    return () => {
      alive = false;
    };
  }, [moduleId, filter, service]);

  const replace = (saved: DescriptiveAnswer) =>
    setState((prev) => (prev.status === "ready" ? { ...prev, items: prev.items.map((it) => (it.id === saved.id ? saved : it)) } : prev));

  return (
    <div className={styles.page}>
      <Link href={`/app/modules/${moduleId}/edit?tab=exercises`} className={styles.back}>
        ← {m.back}
      </Link>
      <header className={styles.head}>
        <h1 className={styles.title}>{m.title}</h1>
        <p className={styles.hint}>{m.hint}</p>
        <p className={styles.mcp}>
          <span aria-hidden="true">🤖</span> {m.mcpHint}
        </p>
      </header>
      <div className={styles.filters} role="group" aria-label={m.filterLabel}>
        {FILTERS.map((f) => (
          <button key={f} type="button" className={`${styles.chip} ${filter === f ? styles.chipOn : ""}`} aria-pressed={filter === f} onClick={() => {
              setFilter(f);
              setState({ status: "loading" });
            }}>
            {m.filters[f]}
          </button>
        ))}
      </div>
      {state.status === "loading" && (
        <p className={styles.hint} role="status">
          {m.loading}
        </p>
      )}
      {state.status === "failed" && (
        <p className={styles.error} role="alert">
          {m.loadFailed}
        </p>
      )}
      {state.status === "ready" &&
        (state.items.length === 0 ? (
          <p className={styles.hint}>{m.empty}</p>
        ) : (
          <div className={styles.list}>
            {state.items.map((it) => (
              <AnswerCard key={it.id} answer={it} service={service} onSaved={replace} />
            ))}
          </div>
        ))}
    </div>
  );
}

const STATUS_CLASS: Record<AnswerStatus, string | undefined> = { PENDING: undefined, SUGGESTED: styles.statusSuggested, GRADED: styles.statusGraded };

const when = (iso: string) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");

/** One answer and the form of its grade. */
function AnswerCard({
  answer,
  service,
  onSaved,
}: {
  answer: DescriptiveAnswer;
  service: Pick<GradingService, "grade">;
  onSaved: (saved: DescriptiveAnswer) => void;
}) {
  const id = useId();
  const { grade, suggestion } = answer;
  /** The band chosen and whether it is the suggestion accepted as it is. */
  const [score, setScore] = useState<number | null>(grade?.score ?? null);
  const [accepted, setAccepted] = useState(false);
  const [studentNote, setStudentNote] = useState(grade?.studentNote ?? suggestion?.studentNote ?? "");
  const [privateNote, setPrivateNote] = useState(grade?.privateNote ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const revising = grade !== null;
  const changed = score !== null && (!revising || score !== grade.score || studentNote !== grade.studentNote || privateNote !== grade.privateNote);
  const ready = changed && (!revising || reason.trim() !== "") && saving !== "saving";

  const choose = (band: number) => {
    setScore(band);
    setAccepted(false);
    setSaving("idle");
  };

  const save = async () => {
    if (score === null) return;
    const input: GradeInput = accepted
      ? { useSuggestion: true, studentNote, privateNote }
      : { score, studentNote, privateNote, ...(revising ? { reason: reason.trim() } : {}) };
    if (accepted && revising) input.reason = reason.trim();
    setSaving("saving");
    try {
      const saved = await service.grade(answer.id, input);
      setSaving("saved");
      setReason("");
      setAccepted(false);
      onSaved(saved);
    } catch {
      setSaving("failed");
    }
  };

  return (
    <article className={`${styles.card} ${STATUS_CLASS[answer.status] ?? ""}`} aria-labelledby={`${id}-title`}>
      <header className={styles.cardHead}>
        <div>
          <h2 id={`${id}-title`} className={styles.cardTitle}>
            {answer.questionTitle}
          </h2>
          <p className={styles.meta}>
            <span className={styles.student}>{answer.studentName}</span> · {m.answeredAt(when(answer.answeredAt))}
          </p>
        </div>
        <span className={styles.badge}>{m.status[answer.status]}</span>
      </header>

      <details className={styles.block}>
        <summary className={styles.blockTitle}>{m.question}</summary>
        <Html html={answer.statement} />
      </details>
      <div className={styles.columns}>
        <section className={styles.block} aria-label={m.response}>
          <p className={styles.blockTitle}>{m.response}</p>
          <Html html={answer.response} />
        </section>
        <section className={styles.block} aria-label={m.expected}>
          <p className={styles.blockTitle}>{m.expected}</p>
          {answer.expectedAnswer ? <Html html={answer.expectedAnswer} /> : <p className={styles.hint}>{m.noExpected}</p>}
        </section>
      </div>

      {suggestion && (
        <section className={`${styles.block} ${styles.suggestion}`} aria-label={m.suggestion}>
          <p className={styles.blockTitle}>
            <span aria-hidden="true">🤖</span> {m.suggestion}
          </p>
          <p className={styles.suggested}>{m.suggested(suggestion.score)}</p>
          {suggestion.reason && <p className={styles.reasonText}>{suggestion.reason}</p>}
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setScore(suggestion.score);
              setAccepted(true);
              if (!studentNote && suggestion.studentNote) setStudentNote(suggestion.studentNote);
              setSaving("idle");
            }}
          >
            {m.useSuggestion(suggestion.score)}
          </button>
        </section>
      )}

      {grade && <p className={styles.graded}>{m.gradedAs(grade.score, m.source[grade.source])}</p>}

      <div className={styles.form}>
        <p id={`${id}-score`} className={styles.label}>
          {m.score}
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-score`} className={styles.bands}>
          {SCORE_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              role="radio"
              aria-checked={score === band}
              className={`${styles.band} ${score === band ? styles.bandOn : ""}`}
              onClick={() => choose(band)}
            >
              {band}%
            </button>
          ))}
        </div>
        <label className={styles.label} htmlFor={`${id}-student`}>
          {m.studentNote}
        </label>
        <textarea id={`${id}-student`} className={styles.textarea} rows={3} value={studentNote} onChange={(e) => setStudentNote(e.target.value)} aria-describedby={`${id}-student-help`} />
        <p id={`${id}-student-help`} className={styles.help}>
          {m.studentNoteHelp}
        </p>
        <label className={styles.label} htmlFor={`${id}-private`}>
          {m.privateNote}
        </label>
        <textarea id={`${id}-private`} className={styles.textarea} rows={2} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} aria-describedby={`${id}-private-help`} />
        <p id={`${id}-private-help`} className={styles.help}>
          {m.privateNoteHelp}
        </p>
        {revising && changed && (
          <>
            <label className={styles.label} htmlFor={`${id}-reason`}>
              {m.reason}
            </label>
            <textarea id={`${id}-reason`} className={styles.textarea} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-reason-help`} />
            <p id={`${id}-reason-help`} className={styles.help}>
              {m.reasonHelp}
            </p>
          </>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!ready} onClick={() => void save()}>
            {saving === "saving" ? m.saving : revising ? m.revise : m.confirm}
          </button>
        </div>
        {saving === "saved" && (
          <p className={styles.ok} role="status">
            {m.saved}
          </p>
        )}
        {saving === "failed" && (
          <p className={styles.error} role="alert">
            {m.failed}
          </p>
        )}
      </div>
    </article>
  );
}
