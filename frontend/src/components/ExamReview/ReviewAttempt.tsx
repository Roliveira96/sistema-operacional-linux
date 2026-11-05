"use client";

import { useEffect, useState } from "react";
import { ChatThread } from "@/components/ExamChat/ExamChat";
import { AnswerOf, VerdictTag } from "@/components/ExamRoom/StudentAnswers";
import { formatDateTime, formatHour, formatScore } from "@/lib/assessment";
import { Button } from "@/components/Button/Button";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import { messages } from "@/messages/pt-BR";
import {
  assessmentService,
  type ExamChatMessage,
  type Review,
  type ReviewItem,
} from "@/services/assessmentService";
import styles from "./ExamReview.module.scss";

const t = messages.assessments.review;
const status = messages.assessments.room.status;
const kinds = authoringMessages.questionKinds.label as Record<string, string>;

export interface ReviewAttemptProps {
  classId: string;
  assessmentId: string;
  maxScore: number;
  review: Review;
  /** The attempt after an adjustment of points or the review reopened (T6, T7). */
  onChange?: (review: Review) => void;
  /** The review concluded (T7): the screen marks the student and opens the next one. */
  onFinished?: (review: Review) => void;
}

/**
 * The delivered attempt of one student in the correction (SPEC-097 T5): the header with the situation and the score, each question with the answer,
 * the key, the commands of a practical one, the expected answer of a written one and the points, the requests for help and the conversation.
 */
export function ReviewAttempt({
  classId,
  assessmentId,
  maxScore,
  review,
  onChange,
  onFinished,
}: ReviewAttemptProps) {
  const editable = !review.reviewed;
  const adjust = (position: number, points: number | null, reason: string) =>
    assessmentService
      .adjustPoints(
        classId,
        assessmentId,
        review.attemptId,
        position,
        points,
        reason,
      )
      .then((got) => onChange?.(got));

  // concluding and reopening (T7): a written question without points keeps the review open (D-03)
  const pendingWritten = review.items.some(
    (it) =>
      it.kind === "DISCURSIVE" &&
      it.points === undefined &&
      it.adjustedPoints === undefined,
  );
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState(false);
  const close = async (reopen: boolean) => {
    setClosing(true);
    setCloseError(false);
    try {
      const got = reopen
        ? await assessmentService.reopenReview(
            classId,
            assessmentId,
            review.attemptId,
          )
        : await assessmentService.finishReview(
            classId,
            assessmentId,
            review.attemptId,
          );
      if (reopen) onChange?.(got);
      else onFinished?.(got);
    } catch {
      setCloseError(true);
    } finally {
      setClosing(false);
    }
  };

  // the notes, kept when the teacher leaves a field (T6)
  const [teacherNote, setTeacherNote] = useState(review.teacherNote);
  const [studentNote, setStudentNote] = useState(review.studentNote);
  const [notesState, setNotesState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const saveNotes = () =>
    assessmentService
      .saveReviewNotes(
        classId,
        assessmentId,
        review.attemptId,
        teacherNote,
        studentNote,
      )
      .then(
        () => setNotesState("saved"),
        () => setNotesState("error"),
      );
  const [chat, setChat] = useState<ExamChatMessage[] | null>(null);
  const [chatFailed, setChatFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    assessmentService.attemptChat(classId, assessmentId, review.attemptId).then(
      (got) => alive && setChat(got.messages),
      () => alive && setChatFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, review.attemptId]);

  const automatic = review.preliminaryScore;
  return (
    <div className={styles.attemptBody}>
      <h2 className={styles.studentName}>{review.studentName}</h2>
      <div className={styles.facts} role="group" aria-label={t.data}>
        <span>{t.academicId(review.academicId)}</span>
        <span className={styles.badge}>
          {status[review.status] ?? review.status}
        </span>
        <span>{t.started(formatDateTime(review.startedAt))}</span>
        {review.submittedAt && (
          <span>{t.delivered(formatDateTime(review.submittedAt))}</span>
        )}
        {review.endReason && (
          <span className={styles.wide}>
            {t.endedBy(review.endedByName ?? "", review.endReason)}
          </span>
        )}
        <span className={styles.score}>
          {t.scoreLabel}:{" "}
          <strong>
            {t.score(formatScore(review.score), formatScore(maxScore))}
          </strong>
          {automatic !== undefined && automatic !== review.score && (
            <> ({t.automatic(formatScore(automatic))})</>
          )}
        </span>
      </div>

      <h3 className={styles.sectionTitle}>{t.questions}</h3>
      {review.items.map((item) => (
        <Question
          key={item.position}
          item={item}
          editable={editable}
          onAdjust={adjust}
        />
      ))}

      <section className={styles.block} aria-label={t.helps}>
        <h3 className={styles.sectionTitle}>{t.helps}</h3>
        {review.helps.length === 0 ? (
          <p className={styles.muted}>{t.noHelps}</p>
        ) : (
          <ul className={styles.helps}>
            {review.helps.map((h) => (
              <li key={h.id}>
                <p className={styles.helpHead}>
                  {h.position !== undefined && (
                    <>{t.helpQuestion(h.position)} · </>
                  )}
                  {formatHour(h.createdAt)} ·{" "}
                  {t.helpStatus[h.status] ?? h.status}
                </p>
                <p className={styles.helpText}>{h.question}</p>
                {h.answer && (
                  <p className={styles.muted}>{t.helpAnswer(h.answer)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.block} aria-label={t.notes}>
        <h3 className={styles.sectionTitle}>{t.notes}</h3>
        <label className={styles.field}>
          {t.teacherNote}
          <textarea
            rows={3}
            maxLength={2000}
            value={teacherNote}
            onChange={(e) => setTeacherNote(e.target.value)}
            onBlur={() => void saveNotes()}
          />
        </label>
        <label className={styles.field}>
          {t.studentNote}
          <textarea
            rows={3}
            maxLength={2000}
            value={studentNote}
            onChange={(e) => setStudentNote(e.target.value)}
            onBlur={() => void saveNotes()}
          />
          <span className={styles.hint}>{t.studentNoteHint}</span>
        </label>
        {notesState === "saved" && (
          <p role="status" className={styles.muted}>
            {t.notesSaved}
          </p>
        )}
        {notesState === "error" && <p role="alert">{t.notesError}</p>}
      </section>

      <section className={styles.block} aria-label={t.chat}>
        <h3 className={styles.sectionTitle}>{t.chat}</h3>
        {chatFailed && <p role="alert">{t.chatError}</p>}
        {chat && (
          <ChatThread
            viewer="record"
            studentName={review.studentName}
            messages={chat}
            emptyText={t.noChat}
          />
        )}
      </section>
      <div className={styles.finish}>
        {review.reviewed ? (
          <>
            <p role="status" className={styles.doneText}>
              {t.done(
                formatScore(review.finalScore ?? review.score),
                formatScore(maxScore),
              )}
            </p>
            <Button
              variant="secondary"
              disabled={closing}
              onClick={() => void close(true)}
            >
              {t.reopen}
            </Button>
          </>
        ) : (
          <>
            {pendingWritten && (
              <p className={styles.muted}>{t.writtenPending}</p>
            )}
            <Button
              disabled={closing || pendingWritten}
              onClick={() => void close(false)}
            >
              {t.finish}
            </Button>
          </>
        )}
        {closeError && <p role="alert">{t.saveError}</p>}
      </div>
    </div>
  );
}

function Question({
  item,
  editable,
  onAdjust,
}: {
  item: ReviewItem;
  editable: boolean;
  onAdjust: (
    position: number,
    points: number | null,
    reason: string,
  ) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (points: number | null, why: string) => {
    setError(null);
    if (points !== null && Number.isNaN(points)) {
      setError(t.invalidPoints(formatScore(item.weight)));
      return;
    }
    setBusy(true);
    try {
      await onAdjust(item.position, points, why);
      setValue("");
      setReason("");
    } catch (cause) {
      setError(
        cause instanceof ApiProblemError && cause.type === "invalid-points"
          ? t.invalidPoints(formatScore(item.weight))
          : t.saveError,
      );
    } finally {
      setBusy(false);
    }
  };
  const practical = item.kind === "PRACTICAL";
  return (
    <article
      className={styles.question}
      aria-label={t.item(item.position, item.title)}
    >
      <div className={styles.questionHead}>
        <span className={styles.number} aria-hidden="true">
          {item.position}
        </span>
        <p className={styles.questionTitle}>{item.title}</p>
        <VerdictTag item={item} />
      </div>
      <p className={styles.muted}>
        {kinds[item.kind] ?? item.kind} · {t.weight(formatScore(item.weight))}
      </p>
      <details className={styles.statement}>
        <summary>{t.statement}</summary>
        {/* html the server filtered when the question was saved */}
        <div
          className={styles.rich}
          dangerouslySetInnerHTML={{ __html: item.studentView.statement }}
        />
      </details>
      <AnswerOf item={item} />
      {practical && (
        <>
          {item.commands.length === 0 ? (
            <p className={styles.muted}>{t.noCommands}</p>
          ) : (
            <ol className={styles.commands} aria-label={t.commands}>
              {item.commands.map((c, i) => (
                <li key={i}>
                  <span className={styles.time}>
                    {formatHour(c.executedAt)}
                  </span>
                  <code>{c.command}</code>
                  {c.output && (
                    <details>
                      <summary>{t.output}</summary>
                      <pre>{c.output}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {item.expectedAnswer && (
        <div className={styles.expected}>
          <p className={styles.expectedTitle}>{t.expected}</p>
          <div
            className={styles.rich}
            dangerouslySetInnerHTML={{ __html: item.expectedAnswer }}
          />
        </div>
      )}
      <p className={styles.points}>
        {t.pointsLabel}:{" "}
        {item.adjustedPoints !== undefined
          ? t.adjusted(
              item.points !== undefined ? formatScore(item.points) : "—",
              formatScore(item.adjustedPoints),
              item.adjustReason ?? "",
            )
          : item.points !== undefined
            ? t.points(formatScore(item.points), formatScore(item.weight))
            : "—"}
      </p>
      {editable && (
        <div className={styles.adjust}>
          <label className={styles.field}>
            {t.pointsField}
            <input
              inputMode="decimal"
              value={value}
              placeholder={formatScore(item.adjustedPoints ?? item.points ?? 0)}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.grow}`}>
            {t.reasonField}
            <input
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={busy || value.trim() === ""}
            onClick={() => void send(Number(value.replace(",", ".")), reason)}
          >
            {t.save}
          </Button>
          {item.adjustedPoints !== undefined && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void send(null, "")}
            >
              {t.undo}
            </Button>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
