"use client";

import { useState, type FormEvent } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { describeAssessmentError, type AssessmentSummary } from "@/services/assessmentService";

const m = messages.assessments.cancel;

/** The longest reason, as in the server (SPEC-075 RN-12). */
const REASON_MAX = 500;

export interface AssessmentCancelDialogProps {
  assessment: Pick<AssessmentSummary, "title">;
  onClose: () => void;
  /** Cancels with the reason; it rejects with the error of the server, and whoever opened the dialog closes it when it resolves. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Cancels an assessment (SPEC-075 RN-12): the reason is required and the teacher confirms that it cannot be undone. */
export function AssessmentCancelDialog({ assessment, onClose, onConfirm }: AssessmentCancelDialogProps) {
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reason.trim() !== "" && sure && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (cause) {
      setError(describeAssessmentError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AssessmentDialog title={m.title(assessment.title)} onClose={onClose}>
      <form onSubmit={submit} className={dialog.field}>
        <p className={dialog.warning}>{m.warning}</p>
        <label htmlFor="cancel-reason" className={dialog.label}>
          {m.reason} <span aria-hidden="true">*</span>
        </label>
        <textarea id="cancel-reason" className={dialog.textarea} value={reason} maxLength={REASON_MAX} required autoFocus onChange={(e) => setReason(e.target.value)} />
        <span className={dialog.counter}>{`${reason.length}/${REASON_MAX}`}</span>
        <label className={dialog.check}>
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          {m.sure}
        </label>
        {error && (
          <p role="alert" className={dialog.problem}>
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {m.back}
          </Button>
          <Button variant="danger" type="submit" disabled={!ready}>
            {m.confirm}
          </Button>
        </div>
      </form>
    </AssessmentDialog>
  );
}
