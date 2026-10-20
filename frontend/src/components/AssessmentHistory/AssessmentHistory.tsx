import { formatMoment, formatPeriod } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentEvent } from "@/services/assessmentService";
import styles from "./AssessmentHistory.module.scss";

const m = messages.assessments.history;

/** One line of the history: what happened, by whom and when, with the old and new dates and the reason (SPEC-075 RN-15). */
function lineOf(e: AssessmentEvent): string {
  const when = formatMoment(e.createdAt);
  const reason = e.reason ? ` ${m.reason(e.reason)}` : "";
  switch (e.kind) {
    case "CREATED":
      return m.created(e.actorName, when);
    case "UPDATED":
      // only the name of what changed, never its value
      return m.updated(e.actorName, when, (e.changedFields ?? []).map((f) => m.fields[f] ?? f).join(", "));
    case "RESCHEDULED":
      return m.rescheduled(e.actorName, when, formatPeriod(e.oldStartsAt ?? "", e.oldEndsAt ?? ""), formatPeriod(e.newStartsAt ?? "", e.newEndsAt ?? "")) + reason;
    case "CANCELED":
      return m.canceled(e.actorName, when) + reason;
  }
}

/** Who created, changed, rescheduled and canceled the assessment, in the order the server gives (SPEC-075 section 3.1). */
export function AssessmentHistory({ events }: { events: AssessmentEvent[] }) {
  return (
    <section className={styles.history}>
      <h2 className={styles.title}>{m.title}</h2>
      {events.length === 0 ? (
        <p className={styles.empty}>{m.empty}</p>
      ) : (
        <ul className={styles.list}>
          {events.map((e, i) => (
            <li key={`${e.createdAt}-${i}`}>{lineOf(e)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
