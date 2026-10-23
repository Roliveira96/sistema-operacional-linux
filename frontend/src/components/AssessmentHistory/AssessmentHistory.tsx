import { formatDay, formatHour, formatMoment, formatPeriod } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentEvent } from "@/services/assessmentService";
import styles from "./AssessmentHistory.module.scss";

const m = messages.assessments.history;

/** One line of the history: what happened, by whom and when, with the old and new dates and the reason (SPEC-075 RN-15). */
function lineOf(e: AssessmentEvent): string {
  const who = e.actorName || m.removedUser; // the server gives no name for a removed user (SPEC-086 RN-01)
  const when = formatMoment(e.createdAt);
  const reason = e.reason ? ` ${m.reason(e.reason)}` : "";
  switch (e.kind) {
    case "CREATED":
      return m.created(who, when);
    case "UPDATED":
      // only the name of what changed, never its value
      return m.updated(who, when, (e.changedFields ?? []).map((f) => m.fields[f] ?? f).join(", "));
    case "RESCHEDULED":
      return m.rescheduled(who, when, formatPeriod(e.oldStartsAt ?? "", e.oldEndsAt ?? ""), formatPeriod(e.newStartsAt ?? "", e.newEndsAt ?? "")) + reason;
    case "CANCELED":
      return m.canceled(who, when) + reason;
    case "CLEARANCE_UPDATED":
      return m.clearanceUpdated(who, when);
  }
}

/** The clearances in a row, by the same author on the same day, as one line with the count and the first and last time (SPEC-086 RN-05). */
function joinedLine(run: AssessmentEvent[]): string {
  const [first, last] = [run[0]!, run[run.length - 1]!];
  const who = first.actorName || m.removedUser;
  const [from, to] = [formatHour(first.createdAt), formatHour(last.createdAt)];
  return from === to
    ? m.clearanceUpdatedSameMinute(who, formatMoment(first.createdAt), run.length)
    : m.clearanceUpdatedMany(who, formatDay(first.createdAt), run.length, from, to);
}

/** One line per event, except that a run of clearances is one line; the order is the server's (SPEC-086 RN-05). */
function linesOf(events: AssessmentEvent[]): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  for (let i = 0; i < events.length; ) {
    const e = events[i]!;
    let end = i + 1;
    while (e.kind === "CLEARANCE_UPDATED" && end < events.length) {
      const next = events[end]!;
      if (next.kind !== "CLEARANCE_UPDATED" || next.actorName !== e.actorName || formatDay(next.createdAt) !== formatDay(e.createdAt)) break;
      end++;
    }
    out.push({ key: `${e.createdAt}-${i}`, text: end - i > 1 ? joinedLine(events.slice(i, end)) : lineOf(e) });
    i = end;
  }
  return out;
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
          {linesOf(events).map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
