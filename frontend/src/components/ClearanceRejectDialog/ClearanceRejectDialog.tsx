"use client";

import { useState, type FormEvent } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { describeAssessmentError } from "@/services/assessmentService";

const m = messages.assessments.rejectDialog;

/** The longest reason of a refusal, as in the server (SPEC-076 RN-06). */
const REASON_MAX = 300;

export interface ClearanceRejectDialogProps {
  /** The name of the student, for the title. */
  student: string;
  onClose: () => void;
  /** Refuses with the reason, already trimmed and empty when there is none; it rejects with the error of the server. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Refuses the clearance of a student (SPEC-076 section 3.1, D-10): the reason is optional, and the dialog says what the student reads without one. */
export function ClearanceRejectDialog({ student, onClose, onConfirm }: ClearanceRejectDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
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
    <AssessmentDialog title={m.title(student)} onClose={onClose}>
      <form onSubmit={submit} className={dialog.field}>
        <label htmlFor="reject-reason" className={dialog.label}>
          {m.reason}
        </label>
        <textarea id="reject-reason" className={dialog.textarea} value={reason} maxLength={REASON_MAX} autoFocus onChange={(e) => setReason(e.target.value)} />
        <span className={dialog.counter}>{`${reason.length}/${REASON_MAX}`}</span>
        <p className={dialog.hint}>{m.hint(messages.assessments.access.defaultReason)}</p>
        {error && (
          <p role="alert" className={dialog.problem}>
            {error}
          </p>
        )}
        <div className={dialog.actions}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {m.back}
          </Button>
          <Button variant="danger" type="submit" disabled={busy}>
            {m.confirm}
          </Button>
        </div>
      </form>
    </AssessmentDialog>
  );
}
