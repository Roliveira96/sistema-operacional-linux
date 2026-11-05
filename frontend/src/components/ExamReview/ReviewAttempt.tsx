"use client";

import { useEffect, useState } from "react";
import { ChatThread } from "@/components/ExamChat/ExamChat";
import { AnswerOf, VerdictTag } from "@/components/ExamRoom/StudentAnswers";
import { formatDateTime, formatHour, formatScore } from "@/lib/assessment";
import { authoringMessages } from "@/messages/authoring.pt-BR";
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
}: ReviewAttemptProps) {
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
        <Question key={item.position} item={item} />
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
    </div>
  );
}

function Question({ item }: { item: ReviewItem }) {
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
    </article>
  );
}
