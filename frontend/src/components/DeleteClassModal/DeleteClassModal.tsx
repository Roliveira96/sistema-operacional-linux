"use client";

import { useEffect } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./DeleteClassModal.module.scss";

const m = messages.classes.deleteModal;

export interface DeleteClassModalProps {
  isOpen: boolean;
  className: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  isSubmitting?: boolean;
  /** The refusal of the server, shown inside the dialog. */
  error?: string | null;
}

/** Confirmation to delete an archived class (SPEC-050, section 3.1). */
export function DeleteClassModal({ isOpen, className, onClose, onConfirm, isSubmitting = false, error }: DeleteClassModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="deleteModalTitle">
      <div className={styles.modal}>
        <h2 id="deleteModalTitle" className={styles.title}>
          {m.title}: {className}
        </h2>
        <p className={styles.warning}>{m.warning}</p>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {m.cancelButton}
          </Button>
          <Button variant="danger" onClick={() => void onConfirm()} disabled={isSubmitting}>
            {isSubmitting ? m.deleting : m.confirmButton}
          </Button>
        </div>
      </div>
    </div>
  );
}
