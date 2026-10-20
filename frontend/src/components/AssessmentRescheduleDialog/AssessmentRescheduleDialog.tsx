"use client";

import { useState, type FormEvent } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { fromLocalInput, toLocalInput } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { describeAssessmentError, type AssessmentSummary, type RescheduleInput } from "@/services/assessmentService";

const m = messages.assessments.reschedule;

export interface AssessmentRescheduleDialogProps {
  assessment: Pick<AssessmentSummary, "title" | "type" | "phase" | "startsAt" | "endsAt">;
  onClose: () => void;
  /** Reschedules; it rejects with the error of the server, and whoever opened the dialog closes it when it resolves. */
  onConfirm: (input: RescheduleInput) => Promise<void>;
}

/**
 * Reschedules an assessment (SPEC-075 RN-11, D-07): before it starts both dates change and the reason is optional; while it runs the start is
 * locked, the term can only be pushed to later and the reason is required.
 */
export function AssessmentRescheduleDialog({ assessment, onClose, onConfirm }: AssessmentRescheduleDialogProps) {
  const running = assessment.phase === "RUNNING";
  const savedStart = toLocalInput(assessment.startsAt);
  const savedEnd = toLocalInput(assessment.endsAt);
  const [starts, setStarts] = useState(savedStart);
  const [ends, setEnds] = useState(savedEnd);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The fields hold "YYYY-MM-DDTHH:mm", which compare as text in the order of the time.
  const problem =
    starts && ends && ends <= starts
      ? messages.assessments.form.endAfterStart
      : starts && ends && assessment.type === "EXAM" && starts.slice(0, 10) !== ends.slice(0, 10)
        ? messages.assessments.form.examSameDay
        : running && ends && ends <= savedEnd
          ? m.afterCurrent
          : null;
  const changed = starts !== savedStart || ends !== savedEnd;
  const ready = Boolean(starts && ends) && changed && !problem && (!running || reason.trim() !== "") && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ startsAt: fromLocalInput(starts), endsAt: fromLocalInput(ends), reason: reason.trim() || undefined });
    } catch (cause) {
      setError(describeAssessmentError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AssessmentDialog title={m.title(assessment.title)} onClose={onClose}>
      <form onSubmit={submit} className={dialog.field}>
        {running && <p className={dialog.warning}>{m.running}</p>}
        <label htmlFor="reschedule-starts" className={dialog.label}>
          {m.starts}
        </label>
        <input id="reschedule-starts" type="datetime-local" className={dialog.input} value={starts} disabled={running} required autoFocus={!running} onChange={(e) => setStarts(e.target.value)} />
        <label htmlFor="reschedule-ends" className={dialog.label}>
          {m.ends}
        </label>
        <input id="reschedule-ends" type="datetime-local" className={dialog.input} value={ends} required autoFocus={running} onChange={(e) => setEnds(e.target.value)} />
        {problem && <p className={dialog.hint}>{problem}</p>}
        <label htmlFor="reschedule-reason" className={dialog.label}>
          {running ? m.reasonRequired : m.reason}
        </label>
        <textarea id="reschedule-reason" className={dialog.textarea} value={reason} maxLength={500} required={running} onChange={(e) => setReason(e.target.value)} />
        {error && (
          <p role="alert" className={dialog.problem}>
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {m.back}
          </Button>
          <Button variant="primary" type="submit" disabled={!ready}>
            {m.confirm}
          </Button>
        </div>
      </form>
    </AssessmentDialog>
  );
}
