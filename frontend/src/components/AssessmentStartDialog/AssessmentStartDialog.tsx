"use client";

import { useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { formatHour } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { describeAssessmentError, type AssessmentSummary } from "@/services/assessmentService";

const m = messages.assessments.startDialog;

export interface AssessmentStartDialogProps {
  assessment: Pick<AssessmentSummary, "title">;
  /** The start before the time set, with the period it moves to (SPEC-099); absent on time. */
  early?: { setStart: string; newStart: string; newEnd: string };
  onClose: () => void;
  /** Starts the exam; it rejects with the error of the server, and whoever opened the dialog closes it when it resolves. */
  onConfirm: () => Promise<void>;
}

/**
 * Starts an exam (SPEC-083 RN-01, SPEC-089 RN-01): the teacher confirms, because the start cannot be undone. Everybody of the exam enters from
 * then on: there is no clearance since SPEC-091 RN-03.
 */
export function AssessmentStartDialog({ assessment, early, onClose, onConfirm }: AssessmentStartDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(describeAssessmentError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AssessmentDialog title={m.title} onClose={onClose}>
      <div className={dialog.field}>
        <p>{assessment.title}</p>
        {early && <p>{m.early(formatHour(early.setStart), formatHour(early.newStart), formatHour(early.newEnd))}</p>}
        <p className={dialog.warning}>{m.warningOpen}</p>
        {error && (
          <p role="alert" className={dialog.problem}>
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {m.back}
          </Button>
          <Button variant="primary" onClick={() => void start()} disabled={busy}>
            {m.confirm}
          </Button>
        </div>
      </div>
    </AssessmentDialog>
  );
}
