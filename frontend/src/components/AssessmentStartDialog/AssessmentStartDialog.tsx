"use client";

import { useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { describeAssessmentError, type AssessmentSummary } from "@/services/assessmentService";

const m = messages.assessments.startDialog;

export interface AssessmentStartDialogProps {
  assessment: Pick<AssessmentSummary, "title" | "modality" | "requiresClearance">;
  onClose: () => void;
  /** Starts the exam; it rejects with the error of the server, and whoever opened the dialog closes it when it resolves. */
  onConfirm: () => Promise<void>;
}

/**
 * Starts an exam (SPEC-083 RN-01, SPEC-089 RN-01): the teacher confirms, because the start cannot be undone. With the clearance it is what lets
 * the clearance begin; without it (online, or in person without the requirement) everybody enters from then on (SPEC-089 D-03).
 */
export function AssessmentStartDialog({ assessment, onClose, onConfirm }: AssessmentStartDialogProps) {
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
        <p className={dialog.warning}>{assessment.modality === "IN_PERSON" && assessment.requiresClearance ? m.warning : m.warningOpen}</p>
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
